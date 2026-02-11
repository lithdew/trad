/**
 * deploy.ts — Deploy TradDelegate to Base or Base Sepolia.
 *
 * Usage:
 *   CHAIN=base-sepolia \
 *   BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/... \
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   bun contracts/deploy.ts
 *
 *   CHAIN=base \
 *   BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/... \
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   bun contracts/deploy.ts
 *
 * Optional env vars:
 *   FEE_RECEIVER   — address to receive trading fees (defaults to deployer)
 *   FEE_BPS        — fee in basis points, e.g. 50 = 0.5% (defaults to 50)
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { tradDelegateAbi } from "./abi";

// ── Validate environment ────────────────────────────────────────────────────

const chainName = (process.env.CHAIN ?? "base-sepolia").toLowerCase();
const chain =
  chainName === "base"
    ? base
    : chainName === "base-sepolia" || chainName === "base_sepolia"
      ? baseSepolia
      : null;

if (chain === null) {
  console.error('Error: CHAIN must be "base" or "base-sepolia".');
  process.exit(1);
}

const rpcUrl = chain.id === base.id ? (process.env.BASE_RPC_URL ?? null) : (process.env.BASE_SEPOLIA_RPC_URL ?? null);
if (rpcUrl == null) {
  if (chain.id === base.id) {
    console.error("Error: BASE_RPC_URL environment variable is required for CHAIN=base.");
    console.error("  Example: https://base-mainnet.g.alchemy.com/v2/YOUR_KEY");
  } else {
    console.error("Error: BASE_SEPOLIA_RPC_URL environment variable is required for CHAIN=base-sepolia.");
    console.error("  Example: https://base-sepolia.g.alchemy.com/v2/YOUR_KEY");
  }
  process.exit(1);
}

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (privateKey == null) {
  console.error("Error: DEPLOYER_PRIVATE_KEY environment variable is required.");
  console.error("  Must be a hex string starting with 0x.");
  process.exit(1);
}

if (!privateKey.startsWith("0x")) {
  console.error("Error: DEPLOYER_PRIVATE_KEY must start with 0x.");
  process.exit(1);
}

let tradDelegateBytecode: `0x${string}` | null = null;
try {
  const binUrl = new URL("./out/TradDelegate.bin", import.meta.url);
  const bin = (await Bun.file(binUrl).text()).trim();
  if (bin === "") throw new Error("empty");
  if (!/^[0-9a-fA-F]+$/.test(bin)) throw new Error("not hex");
  tradDelegateBytecode = `0x${bin}` as `0x${string}`;
} catch {
  console.error("Error: Missing compiled bytecode at contracts/out/TradDelegate.bin");
  console.error("Compile first (from repo root):");
  console.error("  solc --overwrite --optimize --abi --bin contracts/TradDelegate.sol -o contracts/out");
  process.exit(1);
}

// ── Setup clients ───────────────────────────────────────────────────────────

const account = privateKeyToAccount(privateKey as `0x${string}`);

const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain,
  transport: http(rpcUrl),
});

// ── Deployment parameters ───────────────────────────────────────────────────

const feeReceiverAddr = process.env.FEE_RECEIVER ?? account.address;
const feeBps = BigInt(process.env.FEE_BPS ?? "50");

// ── Deploy ──────────────────────────────────────────────────────────────────

console.log("Deploying TradDelegate...");
console.log(`  Network:      ${chain.name} (chain ${chain.id})`);
console.log(`  Deployer:     ${account.address}`);
console.log(`  Fee receiver: ${feeReceiverAddr}`);
console.log(`  Fee:          ${Number(feeBps) / 100}%`);
console.log();

const balance = await publicClient.getBalance({ address: account.address });
console.log(`  Deployer balance: ${Number(balance) / 1e18} ETH`);

if (balance === 0n) {
  if (chain.id === baseSepolia.id) {
    console.error("\nError: Deployer has no ETH. Get testnet ETH from:");
    console.error("  https://www.alchemy.com/faucets/base-sepolia");
  } else {
    console.error("\nError: Deployer has no ETH. Fund the deployer address on Base mainnet.");
  }
  process.exit(1);
}

console.log();

const hash = await walletClient.deployContract({
  abi: tradDelegateAbi,
  bytecode: tradDelegateBytecode,
  args: [feeReceiverAddr as `0x${string}`, feeBps],
});

console.log(`  Tx hash: ${hash}`);
console.log("  Waiting for confirmation...");

const receipt = await publicClient.waitForTransactionReceipt({ hash });

console.log();
console.log("Deployment successful!");
console.log(`  Contract: ${receipt.contractAddress}`);
console.log(`  Block:    ${receipt.blockNumber}`);
console.log(`  Gas used: ${receipt.gasUsed}`);
console.log();
console.log("Next steps:");
console.log(`  1. Allow RobinPump pair codehash:`);
console.log(`     cast codehash <SAMPLE_ROBINPUMP_PAIR_ADDRESS> --rpc-url ${rpcUrl}`);
console.log(`     cast send ${receipt.contractAddress} "setPairCodehashAllowed(bytes32,bool)" <PAIR_CODEHASH> true`);
console.log(`  2. Set the operator:`);
console.log(`     cast send ${receipt.contractAddress} "setOperator(address)" <OPERATOR_ADDRESS>`);
console.log(`  3. (Recommended) Set an emergency guardian that can pause:`);
console.log(`     cast send ${receipt.contractAddress} "setGuardian(address)" <GUARDIAN_ADDRESS>`);
console.log(`  4. Export the address: TRAD_DELEGATE_ADDRESS=${receipt.contractAddress}`);
const basescanHost = chain.id === base.id ? "basescan.org" : "sepolia.basescan.org";
console.log(`  5. Verify on BaseScan: https://${basescanHost}/address/${receipt.contractAddress}`);
