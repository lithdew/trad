/**
 * Strategy Runtime — eval()s user strategies with an injected `api` object.
 *
 * Manages the full lifecycle: start → run → schedule → repeat → stop.
 * Reads the RobinPump private key from Prisma ExchangeSecret on boot.
 */

import { prisma } from "../db";
import { RobinPump } from "../../robinpump";
import type { SubgraphCoin } from "../../robinpump";
import { formatEther, parseEther } from "viem";

// ─── Types ───────────────────────────────────────────────────────────

interface StrategyLog {
  timestamp: number;
  message: string;
  level: "info" | "error" | "trade";
}

interface RunningStrategy {
  strategyId: string;
  timerId: ReturnType<typeof setTimeout> | null;
  logs: StrategyLog[];
  startedAt: number;
  runCount: number;
  robinpump: RobinPump | null;
}

// ─── Interval parsing ────────────────────────────────────────────────

function parseInterval(interval: string) {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (match === null) return 60_000; // default 1 minute

  const value = parseInt(match[1] ?? "1", 10);
  const unit = match[2] ?? "m";
  if (unit === "s") return value * 1_000;
  if (unit === "m") return value * 60_000;
  if (unit === "h") return value * 3_600_000;
  if (unit === "d") return value * 86_400_000;
  return 60_000;
}

// ─── Running strategies map ──────────────────────────────────────────

const running = new Map<string, RunningStrategy>();

// ─── Build the `api` object for a strategy ───────────────────────────

function buildApi(state: RunningStrategy) {
  let nextInterval: string | null = null;

  function addLog(message: string, level: StrategyLog["level"] = "info") {
    const entry: StrategyLog = { timestamp: Date.now(), message, level };
    state.logs.push(entry);
    // Keep max 500 logs in memory
    if (state.logs.length > 500) state.logs.shift();
    const prefix = level === "error" ? "ERROR" : level === "trade" ? "TRADE" : "LOG";
    console.log(`  [${state.strategyId}] ${prefix}: ${message}`);
  }

  // ── robinpump sub-api ──────────────────────────────────────────

  const robinpumpApi = {
    async listCoins(opts?: { sort?: "newest" | "marketCap"; limit?: number }) {
      const sort = opts?.sort ?? "newest";
      const limit = opts?.limit ?? 50;
      const coins = await RobinPump.fetchCoins(sort, limit);
      // Map to the shape the LLM-generated strategies expect
      return coins.map((c) => ({
        address: c.pairAddress,
        tokenAddress: c.tokenAddress,
        name: c.name,
        symbol: c.symbol,
        marketCap: c.ethCollected * 1_000, // rough USD estimate
        priceEth: c.lastPriceEth,
        priceUsd: c.lastPriceUsd,
        volume: c.totalVolumeEth,
        trades: c.tradeCount,
        graduated: c.graduated,
        creator: c.creator,
        createdAt: c.createdAt,
      }));
    },

    async getPrice(pairAddress: string) {
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");
      const price = await state.robinpump.getPrice(pairAddress);
      return price.priceEth;
    },

    async getMarketCap(pairAddress: string) {
      const coin = await RobinPump.fetchCoin(pairAddress);
      if (coin === null) return 0;
      // ethCollected * ethUsd gives a rough market cap
      try {
        const ethUsd = await RobinPump.getEthUsdPrice();
        return coin.ethCollected * ethUsd * 100; // bonding curve valuation
      } catch {
        return coin.ethCollected * 2000 * 100; // fallback $2000/ETH
      }
    },

    async buy(pairAddress: string, ethAmount: number) {
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");
      const ethStr = ethAmount.toString();
      addLog(`BUY ${ethStr} ETH on pair ${pairAddress.slice(0, 10)}…`, "trade");
      const result = await state.robinpump.buy(pairAddress, ethStr);
      addLog(`BUY confirmed: ${result.hash}`, "trade");
      return { hash: result.hash, status: result.receipt.status };
    },

    async sell(pairAddress: string, tokenAmount: number) {
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");
      // Look up the token address from the pair
      const pairInfo = await state.robinpump.getPairInfo(pairAddress);
      const amount = parseEther(tokenAmount.toString());
      addLog(`SELL ${tokenAmount} tokens on pair ${pairAddress.slice(0, 10)}…`, "trade");
      const result = await state.robinpump.sell(pairAddress, pairInfo.tokenAddress, amount);
      addLog(`SELL confirmed: ${result.hash}`, "trade");
      return { hash: result.hash, status: result.receipt.status };
    },

    async getBalance(tokenAddress: string) {
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");
      const balance = await state.robinpump.getTokenBalance(tokenAddress);
      return Number(formatEther(balance));
    },
  };

  // ── main api object ────────────────────────────────────────────

  const api = {
    // Generic market data (placeholder — Binance or CoinGecko)
    async getPrice(pair: string) {
      // For hackathon: use Coinbase rate API for major pairs
      const [base] = pair.split("/");
      try {
        const res = await fetch(`https://api.coinbase.com/v2/exchange-rates?currency=${base}`);
        const data = await res.json();
        return parseFloat(data.data.rates.USD);
      } catch {
        return 0;
      }
    },

    async getBalance(asset: string) {
      if (state.robinpump !== null && asset === "ETH") {
        const bal = await state.robinpump.getEthBalance();
        return Number(formatEther(bal));
      }
      return 0;
    },

    async buy(opts: { pair: string; amount: number; type: string; price?: number }) {
      addLog(`BUY ${opts.amount} on ${opts.pair} (${opts.type})`, "trade");
      // Binance placeholder — not implemented for hackathon
      return { orderId: "mock", status: "filled", pair: opts.pair, amount: opts.amount };
    },

    async sell(opts: { pair: string; amount: number; type: string; price?: number }) {
      addLog(`SELL ${opts.amount} on ${opts.pair} (${opts.type})`, "trade");
      return { orderId: "mock", status: "filled", pair: opts.pair, amount: opts.amount };
    },

    robinpump: robinpumpApi,

    scheduleNext(interval: string) {
      nextInterval = interval;
    },

    log(message: string) {
      addLog(message);
    },
  };

  return { api, getNextInterval: () => nextInterval };
}

// ─── Execute a single run of a strategy ──────────────────────────────

async function executeRun(strategyId: string) {
  const state = running.get(strategyId);
  if (state === undefined) return;

  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
  if (strategy === null || strategy.code === null) {
    state.logs.push({ timestamp: Date.now(), message: "Strategy or code not found", level: "error" });
    return;
  }

  // Parse user parameters
  let params: Record<string, unknown> = {};
  if (strategy.parameters !== null) {
    try {
      const raw = JSON.parse(strategy.parameters);
      // Parameters stored as { key: { value, type, ... } }
      for (const [key, def] of Object.entries(raw)) {
        const paramDef = def as { value?: unknown };
        params[key] = paramDef.value ?? paramDef;
      }
    } catch {
      // use empty params
    }
  }

  const { api, getNextInterval } = buildApi(state);
  state.runCount++;

  try {
    // Strip the TypeScript type annotations that eval can't handle,
    // and extract just the function body from the strategy code.
    let code = strategy.code;

    // Remove ```typescript fences if present
    code = code.replace(/^```typescript\s*/m, "").replace(/```\s*$/m, "");

    // Wrap in an async IIFE that provides PARAMS and calls main(api)
    const wrapped = `
      "use strict";
      const PARAMS = ${JSON.stringify(params)};
      const api = __api__;
      ${code}
      return main(api);
    `;

    const fn = new Function("__api__", wrapped);
    await fn(api);

    // Update lastRun
    await prisma.strategy.update({
      where: { id: strategyId },
      data: { lastRun: new Date() },
    });

    // Schedule next run if requested
    const nextInterval = getNextInterval();
    if (nextInterval !== null && running.has(strategyId)) {
      const ms = parseInterval(nextInterval);
      state.logs.push({
        timestamp: Date.now(),
        message: `Next run in ${nextInterval} (${ms}ms)`,
        level: "info",
      });
      state.timerId = setTimeout(() => executeRun(strategyId), ms);
    } else {
      // Strategy didn't call scheduleNext — mark as complete
      state.logs.push({ timestamp: Date.now(), message: "Run complete (no reschedule)", level: "info" });
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    state.logs.push({ timestamp: Date.now(), message: `Runtime error: ${errMsg}`, level: "error" });
    console.error(`[${strategyId}] Runtime error:`, e);

    // Mark strategy as errored
    await prisma.strategy.update({
      where: { id: strategyId },
      data: { status: "error" },
    }).catch(() => {});
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/** Start running a strategy. Reads wallet key from DB. */
async function startStrategy(strategyId: string) {
  // Don't double-start
  if (running.has(strategyId)) {
    throw new Error(`Strategy ${strategyId} is already running`);
  }

  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
  if (strategy === null) throw new Error("Strategy not found");
  if (strategy.code === null || strategy.code.trim() === "") {
    throw new Error("Strategy has no code to execute");
  }

  // Try to load RobinPump wallet
  let rp: RobinPump | null = null;
  if (strategy.exchange === "robinpump") {
    const secret = await prisma.exchangeSecret.findUnique({
      where: { exchange: "robinpump" },
    });
    if (secret === null || secret.apiKey === "") {
      throw new Error("RobinPump wallet not configured. Go to Settings → RobinPump and enter your private key.");
    }
    rp = new RobinPump({ privateKey: secret.apiKey as `0x${string}` });
  }

  const state: RunningStrategy = {
    strategyId,
    timerId: null,
    logs: [],
    startedAt: Date.now(),
    runCount: 0,
    robinpump: rp,
  };

  running.set(strategyId, state);

  // Mark as active in DB
  await prisma.strategy.update({
    where: { id: strategyId },
    data: { status: "active" },
  });

  state.logs.push({ timestamp: Date.now(), message: "Strategy started", level: "info" });
  console.log(`▶ Strategy ${strategyId} started`);

  // Kick off first run
  executeRun(strategyId);
}

/** Stop a running strategy. */
async function stopStrategy(strategyId: string) {
  const state = running.get(strategyId);
  if (state === undefined) {
    throw new Error(`Strategy ${strategyId} is not running`);
  }

  // Clear scheduled timer
  if (state.timerId !== null) {
    clearTimeout(state.timerId);
  }

  running.delete(strategyId);

  // Mark as paused in DB
  await prisma.strategy.update({
    where: { id: strategyId },
    data: { status: "paused" },
  });

  console.log(`⏹ Strategy ${strategyId} stopped`);
}

/** Get logs and status for a running strategy. */
function getStrategyRuntime(strategyId: string) {
  const state = running.get(strategyId);
  if (state === undefined) return null;

  return {
    strategyId: state.strategyId,
    startedAt: state.startedAt,
    runCount: state.runCount,
    logs: state.logs.slice(-100), // last 100 logs
    isRunning: true,
  };
}

/** List all currently running strategy IDs. */
function listRunning() {
  return [...running.keys()];
}

export { startStrategy, stopStrategy, getStrategyRuntime, listRunning };
