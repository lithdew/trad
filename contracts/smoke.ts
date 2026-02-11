/**
 * contracts/smoke.ts — Base mainnet smoke test for TradDelegate delegation.
 *
 * Proves (on-chain) that:
 * - a user can deposit ETH into TradDelegate
 * - the configured operator can execute a buy + sell against a real RobinPump pair
 * - TradDelegate emits BuyExecuted/SellExecuted and the token Transfer logs show
 *   the pair/token contracts were actually hit on Base mainnet
 *
 * WARNING: This sends real mainnet transactions. Use burner keys and tiny amounts.
 *
 * Run:
 *   BASE_RPC_URL=... \
 *   TRAD_DELEGATE_ADDRESS=0x... \
 *   USER_PRIVATE_KEY=0x... \
 *   OPERATOR_PRIVATE_KEY=0x... \
 *   PAIR_ADDRESS=0x... \
 *   bun contracts/smoke.ts
 *
 *   # (Optional alternative) If you only know the token address, omit PAIR_ADDRESS:
 *   TOKEN_ADDRESS=0x...
 *
 * Optional:
 *   # Will attempt on-chain setup if needed (requires OWNER_PRIVATE_KEY == contract owner)
 *   DO_SETUP=true
 *   OWNER_PRIVATE_KEY=0x...
 *
 *   # Trade parameters (defaults shown)
 *   BUY_ETH=0.0001
 *   SELL_BPS=10000
 *   DEADLINE_SECONDS=3600
 *
 *   # After trading, withdraw leftover token/ETH back to USER (default true)
 *   WITHDRAW_AFTER=true
 *
 * If PAIR_ADDRESS is omitted, this script will try to auto-pick a non-graduated
 * RobinPump pair from the subgraph.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  parseEther,
  formatEther,
  formatUnits,
  decodeEventLog,
  parseAbi,
  keccak256,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { tradDelegateAbi } from "./abi";
import { RobinPump } from "../robinpump";

const rpcUrl = process.env.BASE_RPC_URL ?? null;
if (rpcUrl === null) {
  console.error("Error: BASE_RPC_URL is required (Base mainnet RPC).");
  process.exit(1);
}

const delegateAddrRaw = process.env.TRAD_DELEGATE_ADDRESS ?? null;
if (delegateAddrRaw === null) {
  console.error("Error: TRAD_DELEGATE_ADDRESS is required.");
  process.exit(1);
}

const userPrivateKeyRaw = process.env.USER_PRIVATE_KEY ?? null;
if (userPrivateKeyRaw === null || userPrivateKeyRaw.startsWith("0x") !== true) {
  console.error("Error: USER_PRIVATE_KEY is required and must start with 0x.");
  process.exit(1);
}

const operatorPrivateKeyRaw = process.env.OPERATOR_PRIVATE_KEY ?? null;
if (operatorPrivateKeyRaw === null || operatorPrivateKeyRaw.startsWith("0x") !== true) {
  console.error("Error: OPERATOR_PRIVATE_KEY is required and must start with 0x.");
  process.exit(1);
}

const doSetup = (process.env.DO_SETUP ?? "false") === "true";
const withdrawAfter = (process.env.WITHDRAW_AFTER ?? "true") === "true";

const buyEthStr = process.env.BUY_ETH ?? "0.0001";
const sellBpsStr = process.env.SELL_BPS ?? "10000";
const deadlineSecondsStr = process.env.DEADLINE_SECONDS ?? "3600";

let sellBps = parseInt(sellBpsStr, 10);
if (!Number.isFinite(sellBps)) sellBps = 10000;
if (sellBps < 1 || sellBps > 10000) {
  console.error("Error: SELL_BPS must be between 1 and 10000.");
  process.exit(1);
}

let deadlineSeconds = parseInt(deadlineSecondsStr, 10);
if (!Number.isFinite(deadlineSeconds)) deadlineSeconds = 3600;
if (deadlineSeconds < 60 || deadlineSeconds > 86400) {
  console.error("Error: DEADLINE_SECONDS must be between 60 and 86400.");
  process.exit(1);
}

let buyEthWei: bigint;
try {
  buyEthWei = parseEther(buyEthStr);
} catch {
  console.error('Error: BUY_ETH must be a decimal string like "0.0001".');
  process.exit(1);
}
if (buyEthWei <= 0n) {
  console.error("Error: BUY_ETH must be > 0.");
  process.exit(1);
}

const maxWei = parseEther("0.01");
if (buyEthWei > maxWei && (process.env.ALLOW_LARGE_TRADE ?? "false") !== "true") {
  console.error("Error: BUY_ETH is capped at 0.01 by default.");
  console.error("  If you really intend this, set ALLOW_LARGE_TRADE=true.");
  process.exit(1);
}

const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});

const delegateAddress = getAddress(delegateAddrRaw);

const userAccount = privateKeyToAccount(userPrivateKeyRaw as `0x${string}`);
const operatorAccount = privateKeyToAccount(operatorPrivateKeyRaw as `0x${string}`);

const userWallet = createWalletClient({
  account: userAccount,
  chain: base,
  transport: http(rpcUrl),
});

const operatorWallet = createWalletClient({
  account: operatorAccount,
  chain: base,
  transport: http(rpcUrl),
});

const ownerPrivateKeyRaw = process.env.OWNER_PRIVATE_KEY ?? null;
const ownerAccount =
  ownerPrivateKeyRaw !== null && ownerPrivateKeyRaw.startsWith("0x") === true
    ? privateKeyToAccount(ownerPrivateKeyRaw as `0x${string}`)
    : null;
const ownerWallet =
  ownerAccount !== null
    ? createWalletClient({
      account: ownerAccount,
      chain: base,
      transport: http(rpcUrl),
    })
    : null;

const pairAbi = parseAbi([
  "function token() view returns (address)",
]);

const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

console.log("═ TradDelegate mainnet smoke test ═");
console.log(`RPC:                ${rpcUrl}`);
console.log(`TradDelegate:        ${delegateAddress}`);
console.log(`User:               ${userAccount.address}`);
console.log(`Operator:           ${operatorAccount.address}`);
console.log(`DO_SETUP:           ${doSetup}`);
console.log(`BUY_ETH:            ${buyEthStr}`);
console.log(`SELL_BPS:           ${sellBps}`);
console.log(`WITHDRAW_AFTER:     ${withdrawAfter}`);
console.log();

const chainId = await publicClient.getChainId();
if (chainId !== base.id) {
  console.error(`Error: RPC chainId=${chainId}, expected Base mainnet chainId=${base.id}.`);
  process.exit(1);
}

// ── Preflight: delegate config ───────────────────────────────────────────────

const delegateOwner = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "owner",
});

const delegateOperator = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "operator",
});

const delegateGuardian = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "guardian",
});

const paused = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "paused",
});

const feeBps = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "fee",
});

const feeReceiver = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "feeReceiver",
});

console.log("Delegate config:");
console.log(`  owner:        ${delegateOwner}`);
console.log(`  operator:     ${delegateOperator}`);
console.log(`  guardian:     ${delegateGuardian}`);
console.log(`  paused:       ${paused}`);
console.log(`  feeReceiver:  ${feeReceiver}`);
console.log(`  fee (bps):    ${feeBps.toString()}`);
console.log();

if (paused === true) {
  if (doSetup !== true || ownerWallet === null || ownerAccount === null) {
    console.error("Error: TradDelegate is paused. Provide OWNER_PRIVATE_KEY and DO_SETUP=true to unpause.");
    process.exit(1);
  }
  if (ownerAccount.address.toLowerCase() !== delegateOwner.toLowerCase()) {
    console.error("Error: OWNER_PRIVATE_KEY is not the contract owner, cannot unpause.");
    process.exit(1);
  }

  console.log("Unpausing TradDelegate (owner)...");
  const hash = await ownerWallet.writeContract({
    address: delegateAddress,
    abi: tradDelegateAbi,
    functionName: "unpause",
    args: [],
  });
  console.log(`  tx: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  unpaused.");
  console.log();
}

if (delegateOperator.toLowerCase() !== operatorAccount.address.toLowerCase()) {
  if (doSetup !== true || ownerWallet === null || ownerAccount === null) {
    console.error("Error: TradDelegate.operator is not OPERATOR_PRIVATE_KEY's address.");
    console.error("  Fix: setOperator() from the owner, or rerun with OWNER_PRIVATE_KEY + DO_SETUP=true.");
    process.exit(1);
  }
  if (ownerAccount.address.toLowerCase() !== delegateOwner.toLowerCase()) {
    console.error("Error: OWNER_PRIVATE_KEY is not the contract owner, cannot set operator.");
    process.exit(1);
  }

  console.log("Setting operator (owner)...");
  const hash = await ownerWallet.writeContract({
    address: delegateAddress,
    abi: tradDelegateAbi,
    functionName: "setOperator",
    args: [operatorAccount.address],
  });
  console.log(`  tx: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  operator set.");
  console.log();
}

// ── Pick / validate RobinPump pair ───────────────────────────────────────────

let pairRaw = process.env.PAIR_ADDRESS ?? null;

const tokenHintRaw = process.env.TOKEN_ADDRESS ?? null;
if (pairRaw === null && tokenHintRaw !== null) {
  let tokenHint: `0x${string}` | null = null;
  try {
    tokenHint = getAddress(tokenHintRaw);
  } catch {
    console.error("Error: TOKEN_ADDRESS is not a valid address.");
    process.exit(1);
  }

  console.log("PAIR_ADDRESS not set. Searching subgraph for TOKEN_ADDRESS…");
  const coins = await RobinPump.fetchCoins("marketCap", 300, 0);
  for (const c of coins) {
    if (c.tokenAddress.toLowerCase() !== tokenHint.toLowerCase()) continue;
    pairRaw = c.pairAddress;
    console.log(`  found: ${c.name} (${c.symbol})`);
    console.log(`  pair:  ${c.pairAddress}`);
    break;
  }
  console.log();
}

if (pairRaw === null) {
  console.log("PAIR_ADDRESS not set. Auto-picking a non-graduated RobinPump pair from the subgraph…");
  const coins = await RobinPump.fetchCoins("newest", 80, 0);
  for (const c of coins) {
    if (c.graduated === true) continue;
    pairRaw = c.pairAddress;
    console.log(`  picked: ${c.name} (${c.symbol})`);
    console.log(`  pair:   ${c.pairAddress}`);
    console.log(`  token:  ${c.tokenAddress}`);
    break;
  }
  console.log();
}

if (pairRaw === null) {
  console.error("Error: Could not auto-pick a pair. Provide PAIR_ADDRESS.");
  process.exit(1);
}

let pairAddress: `0x${string}`;
try {
  pairAddress = getAddress(pairRaw);
} catch {
  console.error("Error: PAIR_ADDRESS is not a valid address.");
  process.exit(1);
}

const tokenAddress = await publicClient.readContract({
  address: pairAddress,
  abi: pairAbi,
  functionName: "token",
});

let tokenDecimals = 18;
try {
  const dec = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
  });
  tokenDecimals = Number(dec);
} catch {
  // assume 18
}

console.log("RobinPump pair:");
console.log(`  pair:       ${pairAddress}`);
console.log(`  token:      ${tokenAddress}`);
console.log(`  decimals:   ${tokenDecimals}`);
console.log();

let isAllowed = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "isPairAllowed",
  args: [pairAddress],
});

if (isAllowed !== true) {
  if (doSetup !== true || ownerWallet === null || ownerAccount === null) {
    console.error("Error: Pair is not allowlisted on TradDelegate.");
    console.error("  Fix: setPairCodehashAllowed() from owner, or rerun with OWNER_PRIVATE_KEY + DO_SETUP=true.");
    process.exit(1);
  }
  if (ownerAccount.address.toLowerCase() !== delegateOwner.toLowerCase()) {
    console.error("Error: OWNER_PRIVATE_KEY is not the contract owner, cannot set allowlist.");
    process.exit(1);
  }

  const pairBytecode = await publicClient.getBytecode({ address: pairAddress });
  if (pairBytecode == null || pairBytecode === "0x") {
    console.error("Error: Pair has no runtime code (not a contract?)");
    process.exit(1);
  }

  const codehash = keccak256(pairBytecode);
  console.log("Allowlisting RobinPump pair codehash (owner)...");
  console.log(`  codehash: ${codehash}`);

  const hash = await ownerWallet.writeContract({
    address: delegateAddress,
    abi: tradDelegateAbi,
    functionName: "setPairCodehashAllowed",
    args: [codehash, true],
  });
  console.log(`  tx: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });

  isAllowed = await publicClient.readContract({
    address: delegateAddress,
    abi: tradDelegateAbi,
    functionName: "isPairAllowed",
    args: [pairAddress],
  });

  if (isAllowed !== true) {
    console.error("Error: Pair still not allowlisted after tx.");
    process.exit(1);
  }
  console.log("  allowlisted.");
  console.log();
}

// ── Ensure user has enough deposited ETH ────────────────────────────────────

const userDepositedBefore = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "balanceOf",
  args: [userAccount.address],
});

console.log(`User deposited (before): ${formatEther(userDepositedBefore)} ETH`);

if (userDepositedBefore < buyEthWei) {
  const needed = buyEthWei - userDepositedBefore;
  console.log(`Depositing ${formatEther(needed)} ETH into TradDelegate (user)…`);

  const hash = await userWallet.writeContract({
    address: delegateAddress,
    abi: tradDelegateAbi,
    functionName: "deposit",
    args: [],
    value: needed,
  });
  console.log(`  tx: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("  deposit confirmed.");
} else {
  console.log("No deposit needed.");
}
console.log();

// ── Execute buy via operator ────────────────────────────────────────────────

const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

console.log(`Executing BUY via operator (ethAmount=${formatEther(buyEthWei)} ETH)…`);
const buyHash = await operatorWallet.writeContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "executeBuy",
  args: [userAccount.address, pairAddress, buyEthWei, 0n, deadline],
});
console.log(`  tx: ${buyHash}`);
const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });
console.log(`  confirmed in block ${buyReceipt.blockNumber} (status=${buyReceipt.status})`);

let tokensReceivedFromEvent: bigint | null = null;
let feeTakenFromEvent: bigint | null = null;

for (const log of buyReceipt.logs) {
  if (log.address.toLowerCase() !== delegateAddress.toLowerCase()) continue;
  try {
    const decoded = decodeEventLog({ abi: tradDelegateAbi, data: log.data, topics: log.topics });
    if (decoded.eventName !== "BuyExecuted") continue;
    const args = decoded.args as { tokensReceived: bigint; feeTaken: bigint; ethSpent: bigint; pair: string; user: string };
    console.log("BuyExecuted:");
    console.log(`  user:           ${args.user}`);
    console.log(`  pair:           ${args.pair}`);
    console.log(`  ethSpent:       ${formatEther(args.ethSpent)} ETH`);
    console.log(`  feeTaken:       ${formatEther(args.feeTaken)} ETH`);
    console.log(`  tokensReceived: ${formatUnits(args.tokensReceived, tokenDecimals)}`);
    tokensReceivedFromEvent = args.tokensReceived;
    feeTakenFromEvent = args.feeTaken;
    break;
  } catch {
    // ignore
  }
}

let tokenTransfersToDelegate = 0n;
for (const log of buyReceipt.logs) {
  if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;
  try {
    const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
    if (decoded.eventName !== "Transfer") continue;
    const args = decoded.args as { from: string; to: string; value: bigint };
    if (args.to.toLowerCase() !== delegateAddress.toLowerCase()) continue;
    tokenTransfersToDelegate += args.value;
  } catch {
    // ignore
  }
}

console.log(`Token Transfer → TradDelegate (sum): ${formatUnits(tokenTransfersToDelegate, tokenDecimals)}`);
console.log();

const userTokenBalAfterBuy = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "tokenBalanceOf",
  args: [userAccount.address, tokenAddress],
});

console.log(`User token balance in TradDelegate (after buy): ${formatUnits(userTokenBalAfterBuy, tokenDecimals)}`);

// ── Execute sell via operator ───────────────────────────────────────────────

const sellAmount = (userTokenBalAfterBuy * BigInt(sellBps)) / 10000n;
if (sellAmount <= 0n) {
  console.error("Error: sellAmount computed to 0. Aborting sell.");
  process.exit(1);
}

console.log();
console.log(`Executing SELL via operator (tokenAmount=${formatUnits(sellAmount, tokenDecimals)})…`);
const sellHash = await operatorWallet.writeContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "executeSell",
  args: [userAccount.address, pairAddress, sellAmount, 0n, deadline],
});
console.log(`  tx: ${sellHash}`);
const sellReceipt = await publicClient.waitForTransactionReceipt({ hash: sellHash });
console.log(`  confirmed in block ${sellReceipt.blockNumber} (status=${sellReceipt.status})`);

for (const log of sellReceipt.logs) {
  if (log.address.toLowerCase() !== delegateAddress.toLowerCase()) continue;
  try {
    const decoded = decodeEventLog({ abi: tradDelegateAbi, data: log.data, topics: log.topics });
    if (decoded.eventName !== "SellExecuted") continue;
    const args = decoded.args as { tokensSold: bigint; feeTaken: bigint; ethReceived: bigint; pair: string; user: string };
    console.log("SellExecuted:");
    console.log(`  user:        ${args.user}`);
    console.log(`  pair:        ${args.pair}`);
    console.log(`  tokensSold:  ${formatUnits(args.tokensSold, tokenDecimals)}`);
    console.log(`  ethReceived: ${formatEther(args.ethReceived)} ETH`);
    console.log(`  feeTaken:    ${formatEther(args.feeTaken)} ETH`);
    break;
  } catch {
    // ignore
  }
}

let tokenTransfersFromDelegate = 0n;
for (const log of sellReceipt.logs) {
  if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;
  try {
    const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
    if (decoded.eventName !== "Transfer") continue;
    const args = decoded.args as { from: string; to: string; value: bigint };
    if (args.from.toLowerCase() !== delegateAddress.toLowerCase()) continue;
    tokenTransfersFromDelegate += args.value;
  } catch {
    // ignore
  }
}

console.log(`Token Transfer from TradDelegate (sum): ${formatUnits(tokenTransfersFromDelegate, tokenDecimals)}`);
console.log();

const userDepositedAfter = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "balanceOf",
  args: [userAccount.address],
});

const userTokenBalAfterSell = await publicClient.readContract({
  address: delegateAddress,
  abi: tradDelegateAbi,
  functionName: "tokenBalanceOf",
  args: [userAccount.address, tokenAddress],
});

console.log(`User deposited (after): ${formatEther(userDepositedAfter)} ETH`);
console.log(`User token balance (after): ${formatUnits(userTokenBalAfterSell, tokenDecimals)}`);

if (withdrawAfter === true) {
  if (userTokenBalAfterSell > 0n) {
    console.log();
    console.log("Withdrawing leftover tokens to user…");
    const hash = await userWallet.writeContract({
      address: delegateAddress,
      abi: tradDelegateAbi,
      functionName: "withdrawTokens",
      args: [tokenAddress, userTokenBalAfterSell],
    });
    console.log(`  tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  if (userDepositedAfter > 0n) {
    console.log();
    console.log("Withdrawing all ETH to user…");
    const hash = await userWallet.writeContract({
      address: delegateAddress,
      abi: tradDelegateAbi,
      functionName: "withdrawAll",
      args: [],
    });
    console.log(`  tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

console.log();
console.log("Done.");
if (tokensReceivedFromEvent !== null && feeTakenFromEvent !== null) {
  console.log("Notes:");
  console.log("  - BuyExecuted/SellExecuted came from TradDelegate (proves operator path).");
  console.log("  - ERC-20 Transfer logs were decoded from the token contract (proves mainnet pair/token were hit).");
}

