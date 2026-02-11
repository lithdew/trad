#!/usr/bin/env bun
/**
 * robinpump-demo.ts — Interactive demo of the RobinPump library.
 *
 * Usage:
 *   bun robinpump-demo.ts <command> [args...]
 *
 * Commands:
 *   list       [newest|mc] [N]   List coins from subgraph (fast!)
 *   detail     <pair>            Subgraph data for a single coin
 *   trades     <pair> [N]        Recent trades for a coin
 *   meta       <pair>            Fetch IPFS metadata (description, image)
 *   wallet                       Show wallet address & ETH balance
 *   info       <pair>            Show pair info (reserves, token, etc.)
 *   price      <pair>            Get token price from pair
 *   mcap       <pair>            Get market cap from pair
 *   balance    <token>           Get your token balance
 *   coins      [blocks]          List recently created coins (default: last 10 000 blocks)
 *   buy        <pair> <eth>      Buy tokens (e.g. buy 0xPAIR 0.001)
 *   sell       <pair> [amount]   Sell tokens (omit amount = sell all)
 *   cycle      <pair> <eth>      Buy-then-sell volume cycle
 *   create     <name> <symbol> [ethBuy]  Create a new token
 *   ethprice                     Fetch current ETH/USD price
 *
 * Environment:
 *   ROBINPUMP_PRIVATE_KEY   Wallet private key (0x-prefixed hex)
 *   BASE_RPC_URL            Base-chain RPC (default: https://mainnet.base.org)
 *
 * Reads .env.local automatically (Bun built-in).
 */

import { formatEther, parseEther } from "viem";
import { RobinPump, FACTORY_ADDRESS, FEE_RECEIVER_ADDRESS } from "./robinpump";

// ─── Config ──────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.ROBINPUMP_PRIVATE_KEY;
const RPC_URL = process.env.BASE_RPC_URL;

// Known pairs for quick testing (from our research)
const KNOWN_PAIRS = {
  JEWDENG: {
    pair: "0xD7E30A7854c6Dd80082ed78972ECDD29C46eBa37",
    token: "0xd41eba5393ba7eac98b07ee804f5a8c4f5f0baf9",
  },
  ELSACLAWD: {
    pair: "0xC73Ba87D9b690B3077d47e06953DFA389C1a5B23",
    token: "0x50d1e92816d8a97bf5f76a29027c6c7c6cf8a6e4",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function usage() {
  console.log(`
RobinPump Demo — bun robinpump-demo.ts <command> [args...]

  Subgraph (fast, no RPC needed):
    list       [newest|mc] [N]        List coins (default: newest 50)
    detail     <pair>                 Full subgraph data for one coin
    trades     <pair> [N]             Recent trades (default: 20)
    meta       <pair>                 IPFS metadata (description, image)

  On-chain reads (uses RPC):
    info       <pair>                 Pair details (reserves, token info)
    price      <pair>                 Current token price
    mcap       <pair>                 Market cap
    coins      [blocks]               Discover coins from on-chain events
    ethprice                          ETH/USD from Coinbase
    known                             Show known test pairs

  Wallet (needs ROBINPUMP_PRIVATE_KEY):
    wallet                            Show address & balance
    balance    <token>                Your token balance
    buy        <pair> <ethAmount>     Buy tokens on bonding curve
    sell       <pair> [tokenAmount]   Sell tokens (omit = sell all)
    cycle      <pair> <ethAmount>     Buy + sell volume cycle
    create     <name> <sym> [ethBuy]  Create a new token

  Environment variables (in .env.local):
    ROBINPUMP_PRIVATE_KEY=0x...       Your wallet private key
    BASE_RPC_URL=https://...          RPC endpoint (optional)

  Known pair shortcuts (use name instead of address):
    JEWDENG, ELSACLAWD
`);
}

/** Resolve "JEWDENG" → address, or pass through if already an address. */
function resolvePair(input: string) {
  const upper = input.toUpperCase();
  const known = KNOWN_PAIRS[upper as keyof typeof KNOWN_PAIRS];
  if (known !== undefined) return known.pair;
  return input;
}

/** Resolve known token address from pair name. */
function resolveToken(input: string) {
  const upper = input.toUpperCase();
  const known = KNOWN_PAIRS[upper as keyof typeof KNOWN_PAIRS];
  if (known !== undefined) return known.token;
  return input;
}

function requireKey(): `0x${string}` {
  if (PRIVATE_KEY === undefined || PRIVATE_KEY === "") {
    console.error("Error: ROBINPUMP_PRIVATE_KEY not set. Add it to .env.local");
    process.exit(1);
  }
  return PRIVATE_KEY as `0x${string}`;
}

function fmt(wei: bigint, decimals = 18) {
  return formatEther(wei);
}

function fmtTokens(raw: bigint, decimals = 18) {
  const whole = raw / 10n ** BigInt(decimals);
  const frac = raw % 10n ** BigInt(decimals);
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4);
  return `${whole.toLocaleString()}.${fracStr}`;
}

function fmtUsd(val: number | null) {
  if (val === null) return "N/A";
  return `$${val.toFixed(val < 0.01 ? 8 : 2)}`;
}

// ─── Commands ────────────────────────────────────────────────────────

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function cmdList(sort: "newest" | "marketCap", limit: number) {
  console.log(`\nFetching ${limit} coins (${sort})...\n`);
  const coins = await RobinPump.fetchCoins(sort, limit);

  const padName = 28;
  const padSym = 12;
  console.log(
    `  ${"Name".padEnd(padName)} ${"Symbol".padEnd(padSym)} ${"Price (USD)".padStart(14)} ${"Vol (ETH)".padStart(11)} ${"Trades".padStart(7)} ${"Age".padStart(8)} Pair`
  );
  console.log("  " + "─".repeat(110));

  for (const c of coins) {
    const name = c.name.length > padName - 1 ? c.name.slice(0, padName - 2) + "…" : c.name;
    const sym = c.symbol.length > padSym - 1 ? c.symbol.slice(0, padSym - 2) + "…" : c.symbol;
    const priceStr = c.lastPriceUsd < 0.01
      ? c.lastPriceUsd.toExponential(2)
      : `$${c.lastPriceUsd.toFixed(4)}`;
    const volStr = c.totalVolumeEth.toFixed(4);
    const grad = c.graduated ? " [GRAD]" : "";

    console.log(
      `  ${name.padEnd(padName)} ${sym.padEnd(padSym)} ${priceStr.padStart(14)} ${volStr.padStart(11)} ${String(c.tradeCount).padStart(7)} ${timeAgo(c.createdAt).padStart(8)} ${c.pairAddress}${grad}`
    );
  }
  console.log(`\n  Total: ${coins.length} coins\n`);
}

async function cmdDetail(pairInput: string) {
  const pairAddr = resolvePair(pairInput).toLowerCase();
  const coin = await RobinPump.fetchCoin(pairAddr);
  if (coin === null) {
    console.error(`Coin not found for pair ${pairAddr}`);
    process.exit(1);
  }

  const meta = await RobinPump.fetchMetadata(coin.uri);

  console.log(`\n  ── ${coin.name} (${coin.symbol}) ──`);
  console.log(`  Pair:          ${coin.pairAddress}`);
  console.log(`  Token:         ${coin.tokenAddress}`);
  console.log(`  Creator:       ${coin.creator}`);
  console.log(`  Created:       ${new Date(coin.createdAt * 1000).toISOString()} (${timeAgo(coin.createdAt)})`);
  console.log(`  Graduated:     ${coin.graduated}`);
  console.log(`  Price (ETH):   ${coin.lastPriceEth.toExponential(4)}`);
  console.log(`  Price (USD):   $${coin.lastPriceUsd < 0.01 ? coin.lastPriceUsd.toExponential(4) : coin.lastPriceUsd.toFixed(6)}`);
  console.log(`  Volume (ETH):  ${coin.totalVolumeEth}`);
  console.log(`  ETH Collected: ${coin.ethCollected}`);
  console.log(`  Trade Count:   ${coin.tradeCount}`);
  console.log(`  URI:           ${coin.uri}`);
  if (meta !== null) {
    console.log(`  Description:   ${meta.description}`);
    console.log(`  Image:         ${meta.image}`);
  }
  console.log();
}

async function cmdTrades(pairInput: string, limit: number) {
  const pairAddr = resolvePair(pairInput).toLowerCase();
  const coin = await RobinPump.fetchCoin(pairAddr);
  const label = coin !== null ? `${coin.name} (${coin.symbol})` : pairAddr;

  console.log(`\nRecent trades for ${label}:\n`);
  const trades = await RobinPump.fetchTrades(pairAddr, limit);

  if (trades.length === 0) {
    console.log("  No trades found.\n");
    return;
  }

  console.log(
    `  ${"Side".padEnd(5)} ${"ETH".padStart(14)} ${"Tokens".padStart(18)} ${"Price (USD)".padStart(14)} ${"Trader".padEnd(12)} ${"When".padStart(8)} TX`
  );
  console.log("  " + "─".repeat(100));

  for (const t of trades) {
    const side = t.side === "buy" ? "\x1b[32mBUY\x1b[0m " : "\x1b[31mSELL\x1b[0m";
    const eth = t.amountEth.toFixed(6);
    const tokens = t.amountToken.toFixed(2);
    const price = t.priceUsd < 0.01 ? t.priceUsd.toExponential(2) : `$${t.priceUsd.toFixed(6)}`;
    const trader = t.trader.slice(0, 6) + "…" + t.trader.slice(-4);

    console.log(
      `  ${side} ${eth.padStart(14)} ${tokens.padStart(18)} ${price.padStart(14)} ${trader.padEnd(12)} ${timeAgo(t.timestamp).padStart(8)} ${t.txHash.slice(0, 18)}…`
    );
  }
  console.log();
}

async function cmdMeta(pairInput: string) {
  const pairAddr = resolvePair(pairInput).toLowerCase();
  const coin = await RobinPump.fetchCoin(pairAddr);
  if (coin === null) {
    console.error(`Coin not found for pair ${pairAddr}`);
    process.exit(1);
  }

  console.log(`\nMetadata for ${coin.name} (${coin.symbol}):`);
  console.log(`  URI: ${coin.uri}`);

  const meta = await RobinPump.fetchMetadata(coin.uri);
  if (meta === null) {
    console.log("  Could not fetch IPFS metadata.\n");
    return;
  }

  console.log(`  Name:        ${meta.name}`);
  console.log(`  Symbol:      ${meta.symbol}`);
  console.log(`  Description: ${meta.description}`);
  console.log(`  Image:       ${meta.image}`);
  console.log(`  Created On:  ${meta.createdOn}`);
  console.log();
}

async function cmdKnown() {
  console.log("\nKnown test pairs:");
  for (const [name, addrs] of Object.entries(KNOWN_PAIRS)) {
    console.log(`  ${name}:`);
    console.log(`    Pair:  ${addrs.pair}`);
    console.log(`    Token: ${addrs.token}`);
  }
  console.log();
}

async function cmdEthPrice() {
  const price = await RobinPump.getEthUsdPrice();
  console.log(`ETH/USD: $${price.toFixed(2)}`);
}

async function cmdInfo(pairInput: string) {
  const rp = new RobinPump({
    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
    rpcUrl: RPC_URL,
  });

  const pairAddr = resolvePair(pairInput);
  console.log(`\nFetching pair info for ${pairAddr}...\n`);

  const info = await rp.getPairInfo(pairAddr);
  const tokenInfo = await rp.getTokenInfo(info.tokenAddress);

  const circulatingSupply = info.totalSupply - info.tokenBalance;
  const pctCirculating = Number((circulatingSupply * 10000n) / info.totalSupply) / 100;

  console.log(`  Pair:             ${info.pairAddress}`);
  console.log(`  Token:            ${info.tokenAddress}`);
  console.log(`  Name:             ${tokenInfo.name} (${tokenInfo.symbol})`);
  console.log(`  Decimals:         ${tokenInfo.decimals}`);
  console.log(`  Total Supply:     ${fmtTokens(info.totalSupply)}`);
  console.log(`  ETH in Pair:      ${fmt(info.ethBalance)} ETH`);
  console.log(`  Tokens in Pair:   ${fmtTokens(info.tokenBalance)}`);
  console.log(`  Circulating:      ${fmtTokens(circulatingSupply)} (${pctCirculating}%)`);
  console.log();
}

async function cmdPrice(pairInput: string) {
  const rp = new RobinPump({
    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
    rpcUrl: RPC_URL,
  });

  const pairAddr = resolvePair(pairInput);

  let ethUsd: number | null = null;
  try {
    ethUsd = await RobinPump.getEthUsdPrice();
  } catch {
    // offline is fine
  }

  const price = await rp.getPrice(pairAddr, ethUsd);

  console.log(`\n  Price:         ${price.priceEth.toExponential(4)} ETH`);
  console.log(`  Price (USD):   ${fmtUsd(price.priceUsd)}`);
  console.log(`  ETH Reserve:   ${fmt(price.ethReserve)} ETH`);
  console.log(`  Token Reserve: ${fmtTokens(price.tokenReserve)}`);
  console.log(`  Circulating:   ${fmtTokens(price.circulatingSupply)}`);
  console.log();
}

async function cmdMcap(pairInput: string) {
  const rp = new RobinPump({
    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
    rpcUrl: RPC_URL,
  });

  const pairAddr = resolvePair(pairInput);

  let ethUsd: number | null = null;
  try {
    ethUsd = await RobinPump.getEthUsdPrice();
  } catch {
    // offline
  }

  const mcap = await rp.getMarketCap(pairAddr, ethUsd);

  console.log(`\n  Market Cap (ETH): ${mcap.marketCapEth.toFixed(4)} ETH`);
  console.log(`  Market Cap (USD): ${fmtUsd(mcap.marketCapUsd)}`);
  console.log(`  Price/Token:      ${mcap.pricePerTokenEth.toExponential(4)} ETH`);
  console.log(`  Circulating:      ${fmtTokens(mcap.circulatingSupply)}`);
  console.log(`  Total Supply:     ${fmtTokens(mcap.totalSupply)}`);
  console.log();
}

async function cmdWallet() {
  const rp = new RobinPump({
    privateKey: requireKey(),
    rpcUrl: RPC_URL,
  });

  const balance = await rp.getEthBalance();

  let ethUsd: number | null = null;
  try {
    ethUsd = await RobinPump.getEthUsdPrice();
  } catch {
    // offline
  }

  const ethBal = Number(formatEther(balance));
  const usdBal = ethUsd !== null ? ethBal * ethUsd : null;

  console.log(`\n  Address: ${rp.account.address}`);
  console.log(`  Balance: ${fmt(balance)} ETH`);
  if (usdBal !== null) {
    console.log(`  Value:   $${usdBal.toFixed(2)}`);
  }
  console.log();
}

async function cmdBalance(tokenInput: string) {
  const rp = new RobinPump({
    privateKey: requireKey(),
    rpcUrl: RPC_URL,
  });

  const tokenAddr = resolveToken(tokenInput);
  const balance = await rp.getTokenBalance(tokenAddr);
  const info = await rp.getTokenInfo(tokenAddr);

  console.log(`\n  Token:   ${info.name} (${info.symbol})`);
  console.log(`  Address: ${tokenAddr}`);
  console.log(`  Balance: ${fmtTokens(balance)}`);
  console.log();
}

async function cmdBuy(pairInput: string, ethAmount: string) {
  const rp = new RobinPump({
    privateKey: requireKey(),
    rpcUrl: RPC_URL,
  });

  const pairAddr = resolvePair(pairInput);
  console.log(`\nBuying ${ethAmount} ETH worth of tokens on pair ${pairAddr}...`);

  const result = await rp.buy(pairAddr, ethAmount);
  console.log(`  TX Hash: ${result.hash}`);
  console.log(`  Status:  ${result.receipt.status}`);
  console.log(`  Gas:     ${result.receipt.gasUsed}`);

  // Show resulting token balance
  const tokenAddr = await rp.publicClient.readContract({
    address: pairAddr as `0x${string}`,
    abi: [
      {
        type: "function",
        name: "token",
        inputs: [],
        outputs: [{ type: "address" }],
        stateMutability: "view",
      },
    ] as const,
    functionName: "token",
  });
  const balance = await rp.getTokenBalance(tokenAddr);
  console.log(`  Tokens:  ${fmtTokens(balance)}`);
  console.log(`\n  View: https://basescan.org/tx/${result.hash}\n`);
}

async function cmdSell(pairInput: string, amountStr: string | undefined) {
  const rp = new RobinPump({
    privateKey: requireKey(),
    rpcUrl: RPC_URL,
  });

  const pairAddr = resolvePair(pairInput);
  const pairInfo = await rp.getPairInfo(pairAddr);

  if (amountStr === undefined) {
    // Sell all
    console.log(`\nSelling ALL ${pairInfo.symbol} tokens back to pair ${pairAddr}...`);
    const result = await rp.sellAll(pairAddr, pairInfo.tokenAddress);
    console.log(`  TX Hash: ${result.hash}`);
    console.log(`  Status:  ${result.receipt.status}`);
    console.log(`\n  View: https://basescan.org/tx/${result.hash}\n`);
  } else {
    const amount = parseEther(amountStr);
    console.log(`\nSelling ${fmtTokens(amount)} ${pairInfo.symbol} tokens...`);
    const result = await rp.sell(pairAddr, pairInfo.tokenAddress, amount);
    console.log(`  TX Hash: ${result.hash}`);
    console.log(`  Status:  ${result.receipt.status}`);
    console.log(`\n  View: https://basescan.org/tx/${result.hash}\n`);
  }
}

async function cmdCycle(pairInput: string, ethAmount: string) {
  const rp = new RobinPump({
    privateKey: requireKey(),
    rpcUrl: RPC_URL,
  });

  const pairAddr = resolvePair(pairInput);
  console.log(`\nVolume cycle: buy ${ethAmount} ETH → sell all on pair ${pairAddr}...`);

  const ethBefore = await rp.getEthBalance();

  const { buyResult, sellResult } = await rp.volumeCycle(pairAddr, ethAmount);

  console.log(`  Buy TX:  ${buyResult.hash}  (${buyResult.receipt.status})`);
  if (sellResult !== null) {
    console.log(`  Sell TX: ${sellResult.hash}  (${sellResult.receipt.status})`);
  } else {
    console.log(`  Sell TX: skipped (no tokens received)`);
  }

  const ethAfter = await rp.getEthBalance();
  const diff = ethAfter - ethBefore;
  const sign = diff >= 0n ? "+" : "-";
  const absDiff = diff >= 0n ? diff : -diff;
  console.log(`  Net ETH: ${sign}${fmt(absDiff)} ETH`);
  console.log();
}

async function cmdCreate(name: string, symbol: string, initialBuyEth: string | null) {
  const rp = new RobinPump({
    privateKey: requireKey(),
    rpcUrl: RPC_URL,
  });

  console.log(`\nCreating token "${name}" (${symbol})...`);
  if (initialBuyEth !== null) {
    console.log(`  Initial buy: ${initialBuyEth} ETH`);
  }

  const result = await rp.createToken(name, symbol, "", initialBuyEth);

  console.log(`  TX Hash:  ${result.hash}`);
  console.log(`  Status:   ${result.receipt.status}`);
  console.log(`  Pair:     ${result.pairAddress ?? "unknown"}`);
  console.log(`  Token:    ${result.tokenAddress ?? "unknown"}`);
  console.log(`\n  View: https://basescan.org/tx/${result.hash}\n`);
}

async function cmdCoins(blockRange: number) {
  const rp = new RobinPump({
    privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
    rpcUrl: RPC_URL,
  });

  console.log(`\nScanning last ${blockRange.toLocaleString()} blocks for new coins...`);

  const coins = await rp.listCoins(blockRange);
  console.log(`Found ${coins.length} coins.\n`);

  for (const coin of coins.slice(0, 20)) {
    // Fetch name for each coin
    let name = "?";
    let symbol = "?";
    try {
      const info = await rp.getTokenInfo(coin.tokenAddress);
      name = info.name;
      symbol = info.symbol;
    } catch {
      // rate limited
    }

    console.log(`  ${name} (${symbol})`);
    console.log(`    Pair:    ${coin.pairAddress}`);
    console.log(`    Token:   ${coin.tokenAddress}`);
    console.log(`    Block:   ${coin.blockNumber}`);
    if (coin.creator) {
      console.log(`    Creator: ${coin.creator}`);
    }
    console.log();
  }
}

// ─── Main ────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

if (command === undefined || command === "help" || command === "--help") {
  usage();
  process.exit(0);
}

try {
  switch (command) {
    case "list":
    case "ls": {
      const sortArg = args[0] === "mc" || args[0] === "marketCap" ? "marketCap" : "newest";
      const limitIdx = sortArg !== "newest" || args[0] === "newest" ? 1 : 0;
      const limit = args[limitIdx] !== undefined ? parseInt(args[limitIdx], 10) : 50;
      await cmdList(sortArg, limit);
      break;
    }

    case "detail": {
      if (args[0] === undefined) {
        console.error("Usage: detail <pairAddress|JEWDENG|ELSACLAWD>");
        process.exit(1);
      }
      await cmdDetail(args[0]);
      break;
    }

    case "trades": {
      if (args[0] === undefined) {
        console.error("Usage: trades <pairAddress|JEWDENG|ELSACLAWD> [limit]");
        process.exit(1);
      }
      const limit = args[1] !== undefined ? parseInt(args[1], 10) : 20;
      await cmdTrades(args[0], limit);
      break;
    }

    case "meta": {
      if (args[0] === undefined) {
        console.error("Usage: meta <pairAddress|JEWDENG|ELSACLAWD>");
        process.exit(1);
      }
      await cmdMeta(args[0]);
      break;
    }

    case "known":
      await cmdKnown();
      break;

    case "ethprice":
      await cmdEthPrice();
      break;

    case "info": {
      if (args[0] === undefined) {
        console.error("Usage: info <pairAddress|JEWDENG|ELSACLAWD>");
        process.exit(1);
      }
      await cmdInfo(args[0]);
      break;
    }

    case "price": {
      if (args[0] === undefined) {
        console.error("Usage: price <pairAddress|JEWDENG|ELSACLAWD>");
        process.exit(1);
      }
      await cmdPrice(args[0]);
      break;
    }

    case "mcap": {
      if (args[0] === undefined) {
        console.error("Usage: mcap <pairAddress|JEWDENG|ELSACLAWD>");
        process.exit(1);
      }
      await cmdMcap(args[0]);
      break;
    }

    case "wallet":
      await cmdWallet();
      break;

    case "balance": {
      if (args[0] === undefined) {
        console.error("Usage: balance <tokenAddress|JEWDENG|ELSACLAWD>");
        process.exit(1);
      }
      await cmdBalance(args[0]);
      break;
    }

    case "buy": {
      if (args[0] === undefined || args[1] === undefined) {
        console.error("Usage: buy <pairAddress> <ethAmount>");
        process.exit(1);
      }
      await cmdBuy(args[0], args[1]);
      break;
    }

    case "sell": {
      if (args[0] === undefined) {
        console.error("Usage: sell <pairAddress> [tokenAmount]");
        process.exit(1);
      }
      await cmdSell(args[0], args[1]);
      break;
    }

    case "cycle": {
      if (args[0] === undefined || args[1] === undefined) {
        console.error("Usage: cycle <pairAddress> <ethAmount>");
        process.exit(1);
      }
      await cmdCycle(args[0], args[1]);
      break;
    }

    case "create": {
      if (args[0] === undefined || args[1] === undefined) {
        console.error("Usage: create <name> <symbol> [initialBuyEth]");
        process.exit(1);
      }
      await cmdCreate(args[0], args[1], args[2] ?? null);
      break;
    }

    case "coins": {
      const range = args[0] !== undefined ? parseInt(args[0], 10) : 10_000;
      await cmdCoins(range);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
} catch (e) {
  console.error("\nError:", e instanceof Error ? e.message : String(e));
  if (e instanceof Error && e.stack !== undefined) {
    console.error(e.stack);
  }
  process.exit(1);
}
