/**
 * Strategy Runtime — eval()s user strategies with an injected `api` object.
 *
 * Manages the full lifecycle: start → run → schedule → repeat → stop.
 * Reads the RobinPump private key from Prisma ExchangeSecret on boot.
 */

import { prisma } from "../db";
import { RobinPump } from "../../robinpump";
import {
  decodeEventLog,
  formatEther,
  parseEther,
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { tradDelegateAbi } from "../../contracts/abi";
import { readRiskLimitsFromEnv, type RiskLimits } from "./risk";
import { isHexPrivateKey } from "./hex";

// ─── TypeScript transpiler (strips type annotations for new Function()) ─
const tsTranspiler = new Bun.Transpiler({ loader: "ts" });

// ─── TradDelegate contract (optional — falls back to direct trading) ────

function createDelegateConfig() {
  const addr = process.env.TRAD_DELEGATE_ADDRESS ?? null;
  const key = process.env.OPERATOR_PRIVATE_KEY ?? null;
  if (addr === null || key === null) return null;
  if (!isHexPrivateKey(key)) return null;

  let delegateAddress: `0x${string}`;
  try {
    delegateAddress = getAddress(addr);
  } catch {
    return null;
  }

  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    account = privateKeyToAccount(key);
  } catch {
    return null;
  }

  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

  return {
    publicClient: createPublicClient({ chain: base, transport: http(rpcUrl) }),
    walletClient: createWalletClient({ account, chain: base, transport: http(rpcUrl) }),
    delegateAddress,
    account,
    operatorPrivateKey: key,
    writeGate: Promise.resolve(),
  };
}

const delegateConfig = createDelegateConfig();
if (delegateConfig !== null) {
  console.log(`🔗 TradDelegate configured at ${delegateConfig.delegateAddress}`);
}

// ─── Dry-run mode ─────────────────────────────────────────────────────

const allowLiveTrading = process.env.TRAD_ALLOW_LIVE_TRADING === "true";
const envDryRun = process.env.DRY_RUN === "true";

let globalDryRun = envDryRun;
if (process.env.NODE_ENV === "production" && allowLiveTrading !== true) {
  globalDryRun = true;
}

function setDryRun(enabled: boolean) {
  if (enabled === false && allowLiveTrading !== true) {
    console.warn("⚠ Live trading blocked: set TRAD_ALLOW_LIVE_TRADING=true to disable dry-run.");
    globalDryRun = true;
    return;
  }
  globalDryRun = enabled;
}

function isDryRun() {
  return globalDryRun;
}

// ─── Runtime budgets ──────────────────────────────────────────────────

interface RuntimeBudgets {
  dayKey: string;
  ethSpentToday: number;
  tradesThisRun: number;
  ethSpentThisRun: number;
}

// ─── Types ───────────────────────────────────────────────────────────

interface StrategyLog {
  timestamp: number;
  message: string;
  level: "info" | "error" | "trade";
}

type ExecutionMode = "delegate" | "direct";

interface PositionState {
  tokenHeld: number;
  costBasisEth: number;
  tokenAddress: string | null;
}

interface RunningStrategy {
  strategyId: string;
  timerId: ReturnType<typeof setTimeout> | null;
  logs: StrategyLog[];
  startedAt: number;
  runCount: number;
  robinpump: RobinPump | null;
  userAddress: string | null;

  runId: string;
  tradeIdx: number;
  cumulativePnlEth: number;
  initialCapitalEth: number;
  executionMode: ExecutionMode;

  positions: Map<string, PositionState>;
  pairTokenCache: Map<string, string>;

  risk: RiskLimits;
  budgets: RuntimeBudgets;

  /** Last schedule label set by api.schedule(), if any. */
  lastScheduleInterval: string | null;

  /** Set to true when a stop is requested. */
  stopRequested: boolean;

  /** Resolved when stopRequested becomes true (used to interrupt sleep). */
  stopPromise: Promise<void>;
  stopPromiseResolve: (() => void) | null;
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

// ─── Cron parsing ────────────────────────────────────────────────────

/**
 * Parse a single cron field into an array of allowed values.
 *
 * Supports:
 *   - `*`    → every value in [min..max]
 *   - `*​/N`  → every N-th value starting from min
 *   - `N`    → specific value
 */
function parseCronField(field: string, min: number, max: number) {
  // Wildcard: every value
  if (field === "*") {
    const values: number[] = [];
    for (let i = min; i <= max; i++) {
      values.push(i);
    }
    return values;
  }

  // Step: */N
  const stepMatch = field.match(/^\*\/(\d+)$/);
  if (stepMatch !== null) {
    const step = parseInt(stepMatch[1] ?? "1", 10);
    if (step <= 0) return [min];
    const values: number[] = [];
    for (let i = min; i <= max; i += step) {
      values.push(i);
    }
    return values;
  }

  // Specific number
  const num = parseInt(field, 10);
  if (!Number.isNaN(num) && num >= min && num <= max) {
    return [num];
  }

  return [min]; // fallback
}

/**
 * Compute milliseconds until the next matching cron time (UTC).
 *
 * Fields: minute hour dayOfMonth month dayOfWeek
 */
function nextCronMs(cronExpr: string) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return 60_000; // fallback 1 minute

  const allowedMinutes = parseCronField(parts[0] ?? "*", 0, 59);
  const allowedHours = parseCronField(parts[1] ?? "*", 0, 23);
  const allowedDays = parseCronField(parts[2] ?? "*", 1, 31);
  const allowedMonths = parseCronField(parts[3] ?? "*", 1, 12);
  const allowedWeekdays = parseCronField(parts[4] ?? "*", 0, 6);

  const now = Date.now();
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Search up to 400 days ahead (covers leap year + buffer)
  const maxIterations = 400 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (
      allowedMinutes.includes(candidate.getUTCMinutes()) &&
      allowedHours.includes(candidate.getUTCHours()) &&
      allowedDays.includes(candidate.getUTCDate()) &&
      allowedMonths.includes(candidate.getUTCMonth() + 1) &&
      allowedWeekdays.includes(candidate.getUTCDay())
    ) {
      return candidate.getTime() - now;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return 60_000; // fallback
}

// Compute the delay in ms for the next scheduled run.
//
// Supported formats:
//   - Simple intervals: '30s', '5m', '1h', '1d'
//   - Cron: 'cron:*/5 * * * *' (every 5 minutes)
//   - One-shot: 'once' (returns null — don't reschedule)
function computeScheduleMs(schedule: string) {
  if (schedule === "once") return null;
  if (schedule.startsWith("cron:")) return nextCronMs(schedule.slice(5));
  return parseInterval(schedule);
}

function validateStrategyCode(raw: string) {
  if (raw.length > 120_000) return "Strategy code too large";
  if (!raw.includes("function main") && !raw.includes("async function main")) {
    return "Strategy must define `async function main(api: StrategyAPI)`";
  }

  const banned: { re: RegExp; message: string }[] = [
    { re: /^\s*import\s+/m, message: "Imports are not allowed in strategies" },
    { re: /\bimport\s*\(/, message: "Dynamic imports are not allowed in strategies" },
    { re: /\brequire\s*\(/, message: "require() is not allowed in strategies" },
    { re: /\bprocess\b/, message: "process access is not allowed in strategies" },
    { re: /\bBun\b/, message: "Bun globals are not allowed in strategies" },
    { re: /\bglobalThis\b/, message: "globalThis access is not allowed in strategies" },
    { re: /\beval\b/, message: "eval is not allowed in strategies" },
    { re: /\bFunction\b/, message: "Function constructor is not allowed in strategies" },
    { re: /\bfetch\s*\(/, message: "Direct fetch() is not allowed — use api.* helpers instead" },
    { re: /\bWebSocket\b/, message: "WebSocket is not allowed in strategies" },
    { re: /\bXMLHttpRequest\b/, message: "XMLHttpRequest is not allowed in strategies" },
    { re: /\bDeno\b/, message: "Deno globals are not allowed in strategies" },
    { re: /\b__proto__\b/, message: "__proto__ is not allowed in strategies" },
    {
      re: /\bconstructor\s*\.\s*constructor\b/,
      message: "constructor.constructor is not allowed in strategies",
    },
  ];

  for (const rule of banned) {
    if (rule.re.test(raw)) return rule.message;
  }

  return null;
}

// ─── Running strategies map ──────────────────────────────────────────

const running = new Map<string, RunningStrategy>();

// Logs preserved after a strategy stops — so the UI can still show them
const stoppedLogs = new Map<string, { logs: StrategyLog[]; startedAt: number; runCount: number }>();

// ─── Build the `api` object for a strategy ───────────────────────────

function buildApi(state: RunningStrategy) {
  let nextScheduleMs: number | null = null;
  let nextScheduleLabel: string | null = null;

  function addLog(message: string, level: StrategyLog["level"] = "info") {
    if (state.stopRequested) return;
    const entry: StrategyLog = { timestamp: Date.now(), message, level };
    state.logs.push(entry);
    // Keep max 500 logs in memory
    if (state.logs.length > 500) state.logs.shift();
    const prefix = level === "error" ? "ERROR" : level === "trade" ? "TRADE" : "LOG";
    console.log(`  [${state.strategyId}] ${prefix}: ${message}`);
  }

  const SIMULATED_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

  // ── robinpump sub-api ──────────────────────────────────────────

  const robinpumpApi = {
    async listCoins(opts?: { sort?: "newest" | "marketCap"; limit?: number }) {
      const sort = opts?.sort ?? "newest";
      const limit = opts?.limit ?? 50;
      const coins = await RobinPump.fetchCoins(sort, limit);
      const result: {
        address: string;
        tokenAddress: string;
        name: string;
        symbol: string;
        marketCap: number;
        priceEth: number;
        priceUsd: number;
        volume: number;
        trades: number;
        graduated: boolean;
        creator: string;
        createdAt: number;
      }[] = [];
      for (const c of coins) {
        result.push({
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
        });
      }
      return result;
    },

    async getPrice(pairAddress: string) {
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");
      const price = await state.robinpump.getPrice(pairAddress);
      return price.priceEth;
    },

    async getMarketCap(pairAddress: string) {
      const coin = await RobinPump.fetchCoin(pairAddress);
      if (coin === null) return 0;
      try {
        const ethUsd = await RobinPump.getEthUsdPrice();
        return coin.ethCollected * ethUsd * 100; // bonding curve valuation
      } catch {
        return coin.ethCollected * 2000 * 100; // fallback $2000/ETH
      }
    },

    async buy(pairAddress: string, ethAmount: number) {
      if (state.stopRequested) throw new Error("Strategy stopped");
      if (!Number.isFinite(ethAmount) || ethAmount <= 0) {
        throw new Error("Invalid ethAmount (must be a positive number)");
      }

      const ts = Math.floor(Date.now() / 1000);

      let pair = pairAddress;
      try {
        pair = getAddress(pairAddress);
      } catch {
        // keep raw (strategy may pass invalid address)
      }

      const todayKey = new Date().toISOString().slice(0, 10);
      if (state.budgets.dayKey !== todayKey) {
        state.budgets.dayKey = todayKey;
        state.budgets.ethSpentToday = 0;
      }

      const risk = state.risk;
      const nextTradeCount = state.budgets.tradesThisRun + 1;

      if (nextTradeCount > risk.maxTradesPerRun) {
        throw new Error(`Trade limit reached (maxTradesPerRun=${risk.maxTradesPerRun})`);
      }
      if (ethAmount > risk.maxEthPerTrade) {
        throw new Error(
          `Risk limit: ethAmount (${ethAmount}) > maxEthPerTrade (${risk.maxEthPerTrade})`,
        );
      }
      if (state.budgets.ethSpentThisRun + ethAmount > risk.maxEthPerRun) {
        throw new Error(
          `Risk limit: run spend (${(state.budgets.ethSpentThisRun + ethAmount).toFixed(6)} ETH) > maxEthPerRun (${risk.maxEthPerRun})`,
        );
      }
      if (state.budgets.ethSpentToday + ethAmount > risk.maxEthPerDay) {
        throw new Error(
          `Risk limit: daily spend (${(state.budgets.ethSpentToday + ethAmount).toFixed(6)} ETH) > maxEthPerDay (${risk.maxEthPerDay})`,
        );
      }

      if (!globalDryRun) {
        const availableEth = await robinpumpApi.getEthBalance();
        if (availableEth < ethAmount) {
          throw new Error(
            `Insufficient ETH balance: have ${availableEth.toFixed(6)} ETH, need ${ethAmount.toFixed(6)} ETH`,
          );
        }
      }

      state.budgets.tradesThisRun = nextTradeCount;
      state.budgets.ethSpentThisRun += ethAmount;
      state.budgets.ethSpentToday += ethAmount;

      if (globalDryRun) {
        addLog(`DRY RUN: Would buy ${ethAmount} ETH on pair ${pairAddress.slice(0, 10)}…`, "trade");

        const idx = state.tradeIdx;
        state.tradeIdx++;

        try {
          await prisma.strategyTrade.create({
            data: {
              runId: state.runId,
              timestamp: ts,
              side: "buy",
              pairAddress: pair,
              tokenAddress: null,
              txHash: SIMULATED_HASH,
              status: "simulated",
              amountEth: ethAmount,
              tokenAmount: 0,
              feeEth: 0,
              gasEth: 0,
              pnlEth: 0,
              pnlPct: 0,
              cumulativePnlEth: state.cumulativePnlEth,
              idx,
            },
          });
        } catch (e) {
          addLog(
            `Performance tracking: failed to persist DRY RUN buy: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
        }

        return { hash: SIMULATED_HASH, status: "simulated" };
      }

      // Delegate path: trade through TradDelegate contract
      if (delegateConfig !== null && state.userAddress !== null) {
        const ethAmountStr = ethAmount.toLocaleString("en-US", {
          useGrouping: false,
          maximumFractionDigits: 18,
        });
        let ethWei = parseEther(ethAmountStr);

        // Clamp to the user's deposited ETH to avoid 1-wei rounding issues
        // when strategies use `getEthBalance()` and try to spend "all".
        let availableWei = 0n;
        try {
          const bal = await delegateConfig.publicClient.readContract({
            address: delegateConfig.delegateAddress,
            abi: tradDelegateAbi,
            functionName: "balanceOf",
            args: [getAddress(state.userAddress)],
          });
          availableWei = typeof bal === "bigint" ? bal : 0n;
        } catch {
          availableWei = 0n;
        }

        if (availableWei > 0n && ethWei > availableWei) {
          addLog(
            `BUY (delegate): clamping ethAmount from ${formatEther(ethWei)} to ${formatEther(availableWei)} (deposited balance)`,
            "info",
          );
          ethWei = availableWei;
        }
        if (ethWei === 0n) throw new Error("Insufficient ETH balance");
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const slippageBps = risk.defaultSlippageBps;

        let minTokensOut = 0n;
        if (slippageBps > 0 && state.robinpump !== null) {
          // TradDelegate takes its own fee (bps) from ethWei before calling pair.buy().
          let delegateFeeBps = 0n;
          try {
            const fee = await delegateConfig.publicClient.readContract({
              address: delegateConfig.delegateAddress,
              abi: tradDelegateAbi,
              functionName: "fee",
            });
            delegateFeeBps = typeof fee === "bigint" ? fee : 0n;
          } catch {
            delegateFeeBps = 0n;
          }

          const BPS = 10_000n;
          const PLATFORM_FEE_FACTOR_BPS = 9900n;
          const feeTakenWei = (ethWei * delegateFeeBps) / BPS;
          const buyWei = ethWei - feeTakenWei;

          try {
            const pairInfo = await state.robinpump.getPairInfo(pair);
            const ethReserve = pairInfo.ethBalance;
            const tokenReserve = pairInfo.tokenBalance;

            const ethInAfterFee = (buyWei * PLATFORM_FEE_FACTOR_BPS) / BPS;
            const k = ethReserve * tokenReserve;
            const newEthReserve = ethReserve + ethInAfterFee;
            const newTokenReserve = newEthReserve > 0n ? k / newEthReserve : 0n;

            let expectedTokensOut = 0n;
            if (newTokenReserve < tokenReserve) expectedTokensOut = tokenReserve - newTokenReserve;

            const slip = BigInt(slippageBps);
            minTokensOut = (expectedTokensOut * (BPS - slip)) / BPS;
            if (minTokensOut > 0n) minTokensOut -= 1n;
          } catch {
            // If we can't quote, fall back to 0 (no on-chain slippage bound).
            minTokensOut = 0n;
          }
        }

        const prevGate = delegateConfig.writeGate;
        let releaseGate = () => {};
        delegateConfig.writeGate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });

        await prevGate;
        try {
          if (state.stopRequested) throw new Error("Strategy stopped");

          if (minTokensOut > 0n) {
            addLog(
              `BUY (delegate) ${ethAmount} ETH on pair ${pairAddress.slice(0, 10)}… (minTokensOut=${minTokensOut.toString()})`,
              "trade",
            );
          } else {
            addLog(`BUY (delegate) ${ethAmount} ETH on pair ${pairAddress.slice(0, 10)}…`, "trade");
          }

          let hash: `0x${string}` | null = null;
          let attempts = 0;
          let nonceRetries = 0;
          while (true) {
            if (state.stopRequested) throw new Error("Strategy stopped");
            try {
              const nonceRaw = await delegateConfig.publicClient.getTransactionCount({
                address: delegateConfig.account.address,
                blockTag: "pending",
              });
              const nonce = typeof nonceRaw === "bigint" ? Number(nonceRaw) : nonceRaw;

              hash = await delegateConfig.walletClient.writeContract({
                address: delegateConfig.delegateAddress,
                abi: tradDelegateAbi,
                functionName: "executeBuy",
                args: [
                  getAddress(state.userAddress),
                  getAddress(pair),
                  ethWei,
                  minTokensOut,
                  deadline,
                ],
                nonce,
              });
              break;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const isSlippageExceeded =
                msg.includes("SlippageExceeded") || msg.includes("0x8199f5f3");
              if (!isSlippageExceeded) {
                const isNonceIssue =
                  msg.includes("nonce too low") ||
                  msg.includes("Nonce provided for the transaction") ||
                  msg.includes("replacement transaction underpriced") ||
                  msg.includes("underpriced");

                if (isNonceIssue) {
                  nonceRetries++;
                  if (nonceRetries >= 4) throw e;
                  addLog(
                    "BUY (delegate): nonce issue detected. Retrying with fresh pending nonce…",
                    "info",
                  );
                  continue;
                }

                throw e;
              }
              if (minTokensOut === 0n) throw e;

              attempts++;
              if (attempts >= 5) {
                addLog(
                  "BUY (delegate): SlippageExceeded persists after relaxing minTokensOut; aborting trade.",
                  "error",
                );
                throw e;
              }

              const nextMinTokensOut = minTokensOut / 2n;
              addLog(
                `BUY (delegate): SlippageExceeded with minTokensOut=${minTokensOut.toString()}. Retrying with minTokensOut=${nextMinTokensOut.toString()}…`,
                "info",
              );
              minTokensOut = nextMinTokensOut;
            }
          }

          if (hash === null) throw new Error("BUY (delegate): failed to send transaction");
          const receipt = await delegateConfig.publicClient.waitForTransactionReceipt({ hash });
          addLog(`BUY (delegate) confirmed: ${hash}`, "trade");

          let tokenAddress: string | null = null;
          const cachedToken = state.pairTokenCache.get(pair);
          if (cachedToken !== undefined) tokenAddress = cachedToken;

          let amountEth = 0;
          let tokenAmount = 0;
          let feeEth = 0;

          if (receipt.status === "success") {
            for (const log of receipt.logs) {
              if (log.address.toLowerCase() !== delegateConfig.delegateAddress.toLowerCase())
                continue;
              try {
                const decoded = decodeEventLog({
                  abi: tradDelegateAbi,
                  data: log.data,
                  topics: log.topics,
                });
                if (decoded.eventName !== "BuyExecuted") continue;
                if (
                  decoded.args === undefined ||
                  decoded.args === null ||
                  typeof decoded.args !== "object"
                )
                  continue;

                const args = decoded.args as Record<string, unknown>;
                const ethSpentWei = args.ethSpent;
                const tokensReceivedWei = args.tokensReceived;
                const feeTakenWei = args.feeTaken;
                const pairArg = args.pair;

                if (typeof pairArg === "string") {
                  try {
                    pair = getAddress(pairArg);
                  } catch {
                    // ignore
                  }
                }
                if (typeof ethSpentWei === "bigint") amountEth = Number(formatEther(ethSpentWei));
                if (typeof tokensReceivedWei === "bigint")
                  tokenAmount = Number(formatEther(tokensReceivedWei));
                if (typeof feeTakenWei === "bigint") feeEth = Number(formatEther(feeTakenWei));
                break;
              } catch {
                // ignore non-matching logs
              }
            }
          }

          const investedEth = Math.max(0, amountEth - feeEth);
          const pnlEth = -feeEth;
          const pnlPct = amountEth !== 0 ? (pnlEth / amountEth) * 100 : 0;

          const idx = state.tradeIdx;
          state.tradeIdx++;
          state.cumulativePnlEth += pnlEth;

          if (receipt.status === "success" && tokenAmount > 0) {
            let pos = state.positions.get(pair);
            if (pos === undefined) {
              pos = { tokenHeld: 0, costBasisEth: 0, tokenAddress };
              state.positions.set(pair, pos);
            }
            pos.tokenHeld += tokenAmount;
            pos.costBasisEth += investedEth;
            if (tokenAddress !== null) pos.tokenAddress = tokenAddress;

            try {
              await prisma.strategyPosition.upsert({
                where: { runId_pairAddress: { runId: state.runId, pairAddress: pair } },
                create: {
                  runId: state.runId,
                  pairAddress: pair,
                  tokenAddress,
                  tokenHeld: pos.tokenHeld,
                  costBasisEth: pos.costBasisEth,
                },
                update: {
                  tokenAddress,
                  tokenHeld: pos.tokenHeld,
                  costBasisEth: pos.costBasisEth,
                },
              });
            } catch (e) {
              addLog(
                `Performance tracking: failed to persist position: ${e instanceof Error ? e.message : String(e)}`,
                "error",
              );
            }
          }

          try {
            await prisma.strategyTrade.create({
              data: {
                runId: state.runId,
                timestamp: ts,
                side: "buy",
                pairAddress: pair,
                tokenAddress,
                txHash: hash,
                status: receipt.status,
                amountEth,
                tokenAmount,
                feeEth,
                gasEth: 0,
                pnlEth,
                pnlPct,
                cumulativePnlEth: state.cumulativePnlEth,
                idx,
              },
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (
              msg.includes("Unique constraint failed") &&
              msg.includes("runId") &&
              msg.includes("idx")
            ) {
              try {
                const last = await prisma.strategyTrade.findFirst({
                  where: { runId: state.runId },
                  orderBy: { idx: "desc" },
                });
                if (last !== null) state.tradeIdx = last.idx + 1;
              } catch {
                // ignore
              }
            }
            addLog(`Performance tracking: failed to persist trade: ${msg}`, "error");
          }

          return { hash, status: receipt.status };
        } finally {
          releaseGate();
        }
      }

      // Fallback: direct trading via RobinPump
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");

      const ethStr = ethAmount.toString();
      const pairInfo = await state.robinpump.getPairInfo(pair);
      const tokenAddress = getAddress(pairInfo.tokenAddress);
      state.pairTokenCache.set(pair, tokenAddress);

      let tokenBefore = 0n;
      try {
        tokenBefore = await state.robinpump.getTokenBalance(tokenAddress);
      } catch {
        // ignore
      }

      addLog(`BUY ${ethStr} ETH on pair ${pairAddress.slice(0, 10)}…`, "trade");
      const result = await state.robinpump.buy(pair, ethStr, risk.defaultSlippageBps / 10_000);
      addLog(`BUY confirmed: ${result.hash}`, "trade");

      let tokenAfter = tokenBefore;
      try {
        tokenAfter = await state.robinpump.getTokenBalance(tokenAddress);
      } catch {
        // ignore
      }

      const tokenDelta = tokenAfter >= tokenBefore ? tokenAfter - tokenBefore : 0n;
      const tokenAmount = result.receipt.status === "success" ? Number(formatEther(tokenDelta)) : 0;

      const gasPrice = (result.receipt as { effectiveGasPrice?: bigint }).effectiveGasPrice ?? null;
      const gasWei = gasPrice === null ? 0n : result.receipt.gasUsed * gasPrice;
      const gasEth = Number(formatEther(gasWei));

      const pnlEth = -gasEth;
      const pnlPct = ethAmount !== 0 ? (pnlEth / ethAmount) * 100 : 0;

      const idx = state.tradeIdx;
      state.tradeIdx++;
      state.cumulativePnlEth += pnlEth;

      if (result.receipt.status === "success" && tokenAmount > 0) {
        let pos = state.positions.get(pair);
        if (pos === undefined) {
          pos = { tokenHeld: 0, costBasisEth: 0, tokenAddress };
          state.positions.set(pair, pos);
        }
        pos.tokenHeld += tokenAmount;
        pos.costBasisEth += ethAmount;
        pos.tokenAddress = tokenAddress;

        try {
          await prisma.strategyPosition.upsert({
            where: { runId_pairAddress: { runId: state.runId, pairAddress: pair } },
            create: {
              runId: state.runId,
              pairAddress: pair,
              tokenAddress,
              tokenHeld: pos.tokenHeld,
              costBasisEth: pos.costBasisEth,
            },
            update: {
              tokenAddress,
              tokenHeld: pos.tokenHeld,
              costBasisEth: pos.costBasisEth,
            },
          });
        } catch (e) {
          addLog(
            `Performance tracking: failed to persist position: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
        }
      }

      try {
        await prisma.strategyTrade.create({
          data: {
            runId: state.runId,
            timestamp: ts,
            side: "buy",
            pairAddress: pair,
            tokenAddress,
            txHash: result.hash,
            status: result.receipt.status,
            amountEth: result.receipt.status === "success" ? ethAmount : 0,
            tokenAmount,
            feeEth: 0,
            gasEth,
            pnlEth,
            pnlPct,
            cumulativePnlEth: state.cumulativePnlEth,
            idx,
          },
        });
      } catch (e) {
        addLog(
          `Performance tracking: failed to persist trade: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }

      return { hash: result.hash, status: result.receipt.status };
    },

    async sell(pairAddress: string, tokenAmount: number) {
      if (state.stopRequested) throw new Error("Strategy stopped");
      if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
        throw new Error("Invalid tokenAmount (must be a positive number)");
      }

      const risk = state.risk;
      const nextTradeCount = state.budgets.tradesThisRun + 1;
      if (nextTradeCount > risk.maxTradesPerRun) {
        throw new Error(`Trade limit reached (maxTradesPerRun=${risk.maxTradesPerRun})`);
      }
      state.budgets.tradesThisRun = nextTradeCount;

      const ts = Math.floor(Date.now() / 1000);

      let pair = pairAddress;
      try {
        pair = getAddress(pairAddress);
      } catch {
        // keep raw
      }

      if (globalDryRun) {
        addLog(
          `DRY RUN: Would sell ${tokenAmount} tokens on pair ${pairAddress.slice(0, 10)}…`,
          "trade",
        );

        const idx = state.tradeIdx;
        state.tradeIdx++;

        try {
          await prisma.strategyTrade.create({
            data: {
              runId: state.runId,
              timestamp: ts,
              side: "sell",
              pairAddress: pair,
              tokenAddress: null,
              txHash: SIMULATED_HASH,
              status: "simulated",
              amountEth: 0,
              tokenAmount,
              feeEth: 0,
              gasEth: 0,
              pnlEth: 0,
              pnlPct: 0,
              cumulativePnlEth: state.cumulativePnlEth,
              idx,
            },
          });
        } catch (e) {
          addLog(
            `Performance tracking: failed to persist DRY RUN sell: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
        }

        return { hash: SIMULATED_HASH, status: "simulated" };
      }

      // Delegate path: sell through TradDelegate contract
      if (delegateConfig !== null && state.userAddress !== null && state.robinpump !== null) {
        const pairInfo = await state.robinpump.getPairInfo(pair);
        const tokenAddress = getAddress(pairInfo.tokenAddress);
        state.pairTokenCache.set(pair, tokenAddress);

        const tokenAmountStr = tokenAmount.toLocaleString("en-US", {
          useGrouping: false,
          maximumFractionDigits: 18,
        });
        let tokenWei = parseEther(tokenAmountStr);

        // Clamp to the delegate-held user token balance to avoid rounding errors
        // when strategies sell values derived from `getBalance()`.
        let availableTokenWei: bigint | null = null;
        try {
          const bal = await delegateConfig.publicClient.readContract({
            address: delegateConfig.delegateAddress,
            abi: tradDelegateAbi,
            functionName: "tokenBalanceOf",
            args: [getAddress(state.userAddress), tokenAddress],
          });
          availableTokenWei = typeof bal === "bigint" ? bal : 0n;
        } catch {
          availableTokenWei = null;
        }

        if (availableTokenWei !== null && tokenWei > availableTokenWei) {
          addLog(
            `SELL (delegate): clamping tokenAmount from ${formatEther(tokenWei)} to ${formatEther(availableTokenWei)} (delegate balance)`,
            "info",
          );
          tokenWei = availableTokenWei;
        }
        if (tokenWei === 0n) throw new Error("SELL (delegate): no token balance");
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const slippageBps = risk.defaultSlippageBps;

        let minEthOut = 0n;
        if (slippageBps > 0) {
          const BPS = 10_000n;
          const PLATFORM_FEE_FACTOR_BPS = 9900n;

          const ethReserve = pairInfo.ethBalance;
          const tokenReserve = pairInfo.tokenBalance;
          const tokenInAfterFee = (tokenWei * PLATFORM_FEE_FACTOR_BPS) / BPS;

          const k = ethReserve * tokenReserve;
          const newTokenReserve = tokenReserve + tokenInAfterFee;
          const newEthReserve = newTokenReserve > 0n ? k / newTokenReserve : 0n;

          let expectedEthOut = 0n;
          if (newEthReserve < ethReserve) expectedEthOut = ethReserve - newEthReserve;

          const slip = BigInt(slippageBps);
          minEthOut = (expectedEthOut * (BPS - slip)) / BPS;
          if (minEthOut > 0n) minEthOut -= 1n;
        }

        const prevGate = delegateConfig.writeGate;
        let releaseGate = () => {};
        delegateConfig.writeGate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });

        await prevGate;
        try {
          if (state.stopRequested) throw new Error("Strategy stopped");

          if (minEthOut > 0n) {
            addLog(
              `SELL (delegate) ${tokenAmount} tokens on pair ${pairAddress.slice(0, 10)}… (minEthOut=${minEthOut.toString()})`,
              "trade",
            );
          } else {
            addLog(
              `SELL (delegate) ${tokenAmount} tokens on pair ${pairAddress.slice(0, 10)}…`,
              "trade",
            );
          }

          let hash: `0x${string}` | null = null;
          let attempts = 0;
          let nonceRetries = 0;
          while (true) {
            if (state.stopRequested) throw new Error("Strategy stopped");
            try {
              const nonceRaw = await delegateConfig.publicClient.getTransactionCount({
                address: delegateConfig.account.address,
                blockTag: "pending",
              });
              const nonce = typeof nonceRaw === "bigint" ? Number(nonceRaw) : nonceRaw;

              hash = await delegateConfig.walletClient.writeContract({
                address: delegateConfig.delegateAddress,
                abi: tradDelegateAbi,
                functionName: "executeSell",
                args: [
                  getAddress(state.userAddress),
                  getAddress(pair),
                  tokenWei,
                  minEthOut,
                  deadline,
                ],
                nonce,
              });
              break;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              const isSlippageExceeded =
                msg.includes("SlippageExceeded") || msg.includes("0x8199f5f3");
              if (!isSlippageExceeded) {
                const isNonceIssue =
                  msg.includes("nonce too low") ||
                  msg.includes("Nonce provided for the transaction") ||
                  msg.includes("replacement transaction underpriced") ||
                  msg.includes("underpriced");

                if (isNonceIssue) {
                  nonceRetries++;
                  if (nonceRetries >= 4) throw e;
                  addLog(
                    "SELL (delegate): nonce issue detected. Retrying with fresh pending nonce…",
                    "info",
                  );
                  continue;
                }

                throw e;
              }
              if (minEthOut === 0n) throw e;

              attempts++;
              if (attempts >= 5) {
                addLog(
                  "SELL (delegate): SlippageExceeded persists after relaxing minEthOut; aborting trade.",
                  "error",
                );
                throw e;
              }

              const nextMinEthOut = minEthOut / 2n;
              addLog(
                `SELL (delegate): SlippageExceeded with minEthOut=${minEthOut.toString()}. Retrying with minEthOut=${nextMinEthOut.toString()}…`,
                "info",
              );
              minEthOut = nextMinEthOut;
            }
          }

          if (hash === null) throw new Error("SELL (delegate): failed to send transaction");
          const receipt = await delegateConfig.publicClient.waitForTransactionReceipt({ hash });
          addLog(`SELL (delegate) confirmed: ${hash}`, "trade");

          let tokensSold = 0;
          let ethReceived = 0;
          let feeEth = 0;

          if (receipt.status === "success") {
            for (const log of receipt.logs) {
              if (log.address.toLowerCase() !== delegateConfig.delegateAddress.toLowerCase())
                continue;
              try {
                const decoded = decodeEventLog({
                  abi: tradDelegateAbi,
                  data: log.data,
                  topics: log.topics,
                });
                if (decoded.eventName !== "SellExecuted") continue;
                if (
                  decoded.args === undefined ||
                  decoded.args === null ||
                  typeof decoded.args !== "object"
                )
                  continue;

                const args = decoded.args as Record<string, unknown>;
                const tokensSoldWei = args.tokensSold;
                const ethReceivedWei = args.ethReceived;
                const feeTakenWei = args.feeTaken;
                const pairArg = args.pair;

                if (typeof pairArg === "string") {
                  try {
                    pair = getAddress(pairArg);
                  } catch {
                    // ignore
                  }
                }

                if (typeof tokensSoldWei === "bigint")
                  tokensSold = Number(formatEther(tokensSoldWei));
                if (typeof ethReceivedWei === "bigint")
                  ethReceived = Number(formatEther(ethReceivedWei));
                if (typeof feeTakenWei === "bigint") feeEth = Number(formatEther(feeTakenWei));
                break;
              } catch {
                // ignore
              }
            }
          }

          const netProceeds = Math.max(0, ethReceived - feeEth);

          let pos = state.positions.get(pair);
          if (pos === undefined) {
            pos = { tokenHeld: 0, costBasisEth: 0, tokenAddress };
            state.positions.set(pair, pos);
          }

          let costSold = 0;
          if (pos.tokenHeld > 0 && tokensSold > 0) {
            if (tokensSold >= pos.tokenHeld) {
              costSold = pos.costBasisEth;
            } else {
              costSold = (pos.costBasisEth / pos.tokenHeld) * tokensSold;
            }
          }

          const pnlEth = receipt.status === "success" ? netProceeds - costSold : 0;
          const amountEth = receipt.status === "success" ? ethReceived : 0;
          const pnlPct = amountEth !== 0 ? (pnlEth / amountEth) * 100 : 0;

          const idx = state.tradeIdx;
          state.tradeIdx++;
          state.cumulativePnlEth += pnlEth;

          if (receipt.status === "success" && tokensSold > 0) {
            pos.tokenHeld = Math.max(0, pos.tokenHeld - tokensSold);
            pos.costBasisEth = Math.max(0, pos.costBasisEth - costSold);
            pos.tokenAddress = tokenAddress;

            try {
              await prisma.strategyPosition.upsert({
                where: { runId_pairAddress: { runId: state.runId, pairAddress: pair } },
                create: {
                  runId: state.runId,
                  pairAddress: pair,
                  tokenAddress,
                  tokenHeld: pos.tokenHeld,
                  costBasisEth: pos.costBasisEth,
                },
                update: {
                  tokenAddress,
                  tokenHeld: pos.tokenHeld,
                  costBasisEth: pos.costBasisEth,
                },
              });
            } catch (e) {
              addLog(
                `Performance tracking: failed to persist position: ${e instanceof Error ? e.message : String(e)}`,
                "error",
              );
            }
          }

          try {
            await prisma.strategyTrade.create({
              data: {
                runId: state.runId,
                timestamp: ts,
                side: "sell",
                pairAddress: pair,
                tokenAddress,
                txHash: hash,
                status: receipt.status,
                amountEth,
                tokenAmount: tokensSold,
                feeEth,
                gasEth: 0,
                pnlEth,
                pnlPct,
                cumulativePnlEth: state.cumulativePnlEth,
                idx,
              },
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (
              msg.includes("Unique constraint failed") &&
              msg.includes("runId") &&
              msg.includes("idx")
            ) {
              try {
                const last = await prisma.strategyTrade.findFirst({
                  where: { runId: state.runId },
                  orderBy: { idx: "desc" },
                });
                if (last !== null) state.tradeIdx = last.idx + 1;
              } catch {
                // ignore
              }
            }
            addLog(`Performance tracking: failed to persist trade: ${msg}`, "error");
          }

          return { hash, status: receipt.status };
        } finally {
          releaseGate();
        }
      }

      // Fallback: direct trading via RobinPump
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");

      const pairInfo = await state.robinpump.getPairInfo(pair);
      const tokenAddress = getAddress(pairInfo.tokenAddress);
      state.pairTokenCache.set(pair, tokenAddress);

      let ethBefore = 0n;
      try {
        ethBefore = await state.robinpump.getEthBalance();
      } catch {
        // ignore
      }

      const amount = parseEther(tokenAmount.toString());
      addLog(`SELL ${tokenAmount} tokens on pair ${pairAddress.slice(0, 10)}…`, "trade");
      const result = await state.robinpump.sell(
        pair,
        tokenAddress,
        amount,
        risk.defaultSlippageBps / 10_000,
      );
      addLog(`SELL confirmed: ${result.hash}`, "trade");

      let ethAfter = ethBefore;
      try {
        ethAfter = await state.robinpump.getEthBalance();
      } catch {
        // ignore
      }

      let gasWei = 0n;
      const sellReceiptGasPrice =
        (result.receipt as { effectiveGasPrice?: bigint }).effectiveGasPrice ?? null;
      if (sellReceiptGasPrice !== null) {
        gasWei += result.receipt.gasUsed * sellReceiptGasPrice;
      }
      if (result.approval !== undefined) {
        const approvalGasPrice =
          (result.approval.receipt as { effectiveGasPrice?: bigint }).effectiveGasPrice ?? null;
        if (approvalGasPrice !== null) {
          gasWei += result.approval.receipt.gasUsed * approvalGasPrice;
        }
      }

      const gasEth = Number(formatEther(gasWei));
      const netDeltaWei = ethAfter - ethBefore;
      const grossProceedsWei = netDeltaWei + gasWei;
      const amountEth =
        result.receipt.status === "success" && grossProceedsWei > 0n
          ? Number(formatEther(grossProceedsWei))
          : 0;
      const netProceedsEth =
        result.receipt.status === "success" ? Number(formatEther(netDeltaWei)) : 0;

      let pos = state.positions.get(pair);
      if (pos === undefined) {
        pos = { tokenHeld: 0, costBasisEth: 0, tokenAddress };
        state.positions.set(pair, pos);
      }

      let costSold = 0;
      if (pos.tokenHeld > 0 && tokenAmount > 0) {
        if (tokenAmount >= pos.tokenHeld) {
          costSold = pos.costBasisEth;
        } else {
          costSold = (pos.costBasisEth / pos.tokenHeld) * tokenAmount;
        }
      }

      const pnlEth = result.receipt.status === "success" ? netProceedsEth - costSold : 0;
      const pnlPct = amountEth !== 0 ? (pnlEth / amountEth) * 100 : 0;

      const idx = state.tradeIdx;
      state.tradeIdx++;
      state.cumulativePnlEth += pnlEth;

      if (result.receipt.status === "success" && tokenAmount > 0) {
        pos.tokenHeld = Math.max(0, pos.tokenHeld - tokenAmount);
        pos.costBasisEth = Math.max(0, pos.costBasisEth - costSold);
        pos.tokenAddress = tokenAddress;

        try {
          await prisma.strategyPosition.upsert({
            where: { runId_pairAddress: { runId: state.runId, pairAddress: pair } },
            create: {
              runId: state.runId,
              pairAddress: pair,
              tokenAddress,
              tokenHeld: pos.tokenHeld,
              costBasisEth: pos.costBasisEth,
            },
            update: {
              tokenAddress,
              tokenHeld: pos.tokenHeld,
              costBasisEth: pos.costBasisEth,
            },
          });
        } catch (e) {
          addLog(
            `Performance tracking: failed to persist position: ${e instanceof Error ? e.message : String(e)}`,
            "error",
          );
        }
      }

      try {
        await prisma.strategyTrade.create({
          data: {
            runId: state.runId,
            timestamp: ts,
            side: "sell",
            pairAddress: pair,
            tokenAddress,
            txHash: result.hash,
            status: result.receipt.status,
            amountEth,
            tokenAmount: result.receipt.status === "success" ? tokenAmount : 0,
            feeEth: 0,
            gasEth,
            pnlEth,
            pnlPct,
            cumulativePnlEth: state.cumulativePnlEth,
            idx,
          },
        });
      } catch (e) {
        addLog(
          `Performance tracking: failed to persist trade: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }

      return { hash: result.hash, status: result.receipt.status };
    },

    async getBalance(tokenAddress: string) {
      if (state.stopRequested) throw new Error("Strategy stopped");

      // Accept either token address OR pair address (common mistake in strategies).
      // If a pair address is passed, resolve its token() address first.
      let resolvedTokenAddress = tokenAddress;
      let resolvedPairAddress: string | null = null;
      if (state.robinpump !== null) {
        try {
          const info = await state.robinpump.getPairInfo(tokenAddress);
          resolvedTokenAddress = info.tokenAddress;
          try {
            resolvedPairAddress = getAddress(tokenAddress);
          } catch {
            resolvedPairAddress = null;
          }
        } catch {
          // tokenAddress is probably already a token
          resolvedTokenAddress = tokenAddress;
          resolvedPairAddress = null;
        }
      }

      if (resolvedPairAddress !== null) {
        try {
          state.pairTokenCache.set(resolvedPairAddress, getAddress(resolvedTokenAddress));
        } catch {
          // ignore invalid addresses
        }
      }

      // Delegate: read token balance from contract
      if (delegateConfig !== null && state.userAddress !== null) {
        const balance = await delegateConfig.publicClient.readContract({
          address: delegateConfig.delegateAddress,
          abi: tradDelegateAbi,
          functionName: "tokenBalanceOf",
          args: [getAddress(state.userAddress), getAddress(resolvedTokenAddress)],
        });
        return Number(formatEther(balance));
      }
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");
      const balance = await state.robinpump.getTokenBalance(resolvedTokenAddress);
      return Number(formatEther(balance));
    },

    async getEthBalance() {
      // Delegate: read deposited ETH balance from contract
      if (delegateConfig !== null && state.userAddress !== null) {
        const balance = await delegateConfig.publicClient.readContract({
          address: delegateConfig.delegateAddress,
          abi: tradDelegateAbi,
          functionName: "balanceOf",
          args: [getAddress(state.userAddress)],
        });
        return Number(formatEther(balance));
      }
      if (state.robinpump === null) throw new Error("RobinPump wallet not configured");
      const balance = await state.robinpump.getEthBalance();
      return Number(formatEther(balance));
    },

    async getEthUsdPrice() {
      return RobinPump.getEthUsdPrice();
    },
  };

  // ── main api object ────────────────────────────────────────────

  const api = {
    robinpump: robinpumpApi,

    // ── Legacy helpers (unsupported) ───────────────────────────────
    // This runtime is RobinPump-only. Keep these methods so older
    // strategies fail with a clear error instead of silently "mock trading".
    async getPrice() {
      throw new Error("Unsupported: use api.robinpump.getPrice(pairAddress)");
    },
    async getBalance() {
      throw new Error(
        "Unsupported: use api.robinpump.getEthBalance() or api.robinpump.getBalance(tokenAddress)",
      );
    },
    async buy() {
      throw new Error("Unsupported: use api.robinpump.buy(pairAddress, ethAmount)");
    },
    async sell() {
      throw new Error("Unsupported: use api.robinpump.sell(pairAddress, tokenAmount)");
    },

    schedule(when: unknown) {
      if (typeof when === "string") {
        const raw = when.trim();
        if (raw === "") return;

        // Relative schedule formats supported by computeScheduleMs():
        // - 30s / 5m / 1h / 1d
        // - cron:*/5 * * * *
        // - once
        if (raw === "once" || raw.startsWith("cron:") || /^(\d+)(s|m|h|d)$/.test(raw)) {
          nextScheduleMs = computeScheduleMs(raw);
          nextScheduleLabel = raw;
          state.lastScheduleInterval = raw;
          return;
        }

        // Absolute schedule: ISO time string
        const parsed = Date.parse(raw);
        if (Number.isFinite(parsed)) {
          const now = Date.now();
          const delta = parsed - now;
          nextScheduleMs = Math.max(1000, delta);
          nextScheduleLabel = raw;
          state.lastScheduleInterval = raw;
        }
        return;
      }

      if (typeof when === "number") {
        if (!Number.isFinite(when) || when < 0) return;

        // Heuristic:
        // - >= 1e12  → epoch ms
        // - >= 1e9   → epoch seconds
        // - else     → relative ms
        const now = Date.now();
        let atMs: number | null = null;
        if (when >= 1_000_000_000_000) atMs = when;
        else if (when >= 1_000_000_000) atMs = when * 1000;

        if (atMs !== null) {
          const delta = atMs - now;
          nextScheduleMs = Math.max(1000, delta);
          nextScheduleLabel = new Date(atMs).toISOString();
          state.lastScheduleInterval = nextScheduleLabel;
          return;
        }

        nextScheduleMs = Math.max(0, when);
        nextScheduleLabel = `${Math.round(when)}ms`;
        state.lastScheduleInterval = nextScheduleLabel;
        return;
      }

      if (typeof when === "object" && when !== null) {
        const obj = when as Record<string, unknown>;

        if ("in" in obj) {
          const v = obj.in;
          if (typeof v === "string") {
            const raw = v.trim();
            if (raw === "") return;
            if (raw === "once" || raw.startsWith("cron:") || /^(\d+)(s|m|h|d)$/.test(raw)) {
              nextScheduleMs = computeScheduleMs(raw);
              nextScheduleLabel = raw;
              state.lastScheduleInterval = raw;
            }
            return;
          }
          if (typeof v === "number") {
            if (!Number.isFinite(v) || v < 0) return;
            nextScheduleMs = Math.max(0, v);
            nextScheduleLabel = `${Math.round(v)}ms`;
            state.lastScheduleInterval = nextScheduleLabel;
          }
          return;
        }

        if ("at" in obj) {
          const v = obj.at;
          const now = Date.now();
          if (typeof v === "string") {
            const parsed = Date.parse(v);
            if (!Number.isFinite(parsed)) return;
            nextScheduleMs = Math.max(1000, parsed - now);
            nextScheduleLabel = v.trim();
            state.lastScheduleInterval = nextScheduleLabel;
            return;
          }
          if (typeof v === "number") {
            if (!Number.isFinite(v) || v < 0) return;
            const atMs = v >= 1_000_000_000_000 ? v : v >= 1_000_000_000 ? v * 1000 : now + v;
            nextScheduleMs = Math.max(1000, atMs - now);
            nextScheduleLabel = new Date(atMs).toISOString();
            state.lastScheduleInterval = nextScheduleLabel;
            return;
          }
        }
      }
    },

    // Backward compatibility for existing strategies.
    scheduleNext(interval: string) {
      api.schedule(interval);
    },

    log(message: string) {
      addLog(message);
    },

    // ── Time ──────────────────────────────────────────────────────

    now() {
      return Date.now();
    },

    utcTime() {
      return new Date().toISOString();
    },

    // ── Utilities ────────────────────────────────────────────────

    // NOTE: Strategies should not sleep. Use api.schedule(...) and return.
    // We keep this for now to fail loudly on older strategies.
    async sleep() {
      state.stopRequested = true;
      if (state.stopPromiseResolve !== null) {
        state.stopPromiseResolve();
        state.stopPromiseResolve = null;
      }
      throw new Error("Unsupported: use api.schedule(...) instead of api.sleep()");
    },

    isDryRun() {
      return globalDryRun;
    },
  };

  return {
    api,
    getNextSchedule: () =>
      nextScheduleLabel !== null ? { ms: nextScheduleMs, label: nextScheduleLabel } : null,
  };
}

// ─── Execute a single run of a strategy ──────────────────────────────

async function executeRun(strategyId: string) {
  const state = running.get(strategyId);
  if (state === undefined) return;

  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
  if (strategy === null || strategy.code === null) {
    state.logs.push({
      timestamp: Date.now(),
      message: "Strategy or code not found",
      level: "error",
    });
    return;
  }

  const { api, getNextSchedule } = buildApi(state);
  state.runCount++;
  state.budgets.tradesThisRun = 0;
  state.budgets.ethSpentThisRun = 0;

  try {
    // Strip the TypeScript type annotations that eval can't handle,
    // and extract just the function body from the strategy code.
    let code = strategy.code;

    // Remove ```typescript fences if present
    code = code.replace(/^```typescript\s*/m, "").replace(/```\s*$/m, "");

    // Parse + sanitize parameters:
    // - Read declared params from `// @param key type default ...`
    // - Parse defaults by type
    // - Overlay saved params but drop unknown keys and reset invalid values to defaults
    //
    // This prevents "stuck" strategies when the UI/spec accidentally writes extra keys,
    // and avoids trading with nonsensical types (e.g. string where number expected).
    const paramDefs: { key: string; type: string; defaultVal: string; options?: string[] }[] = [];
    for (const m of code.matchAll(/\/\/ @param (\S+) (\S+) (\S+) (.+)/g)) {
      const key = m[1] ?? "";
      const type = m[2] ?? "";
      const defaultVal = m[3] ?? "";
      if (key === "") continue;

      let options: string[] | undefined = undefined;
      if (type.startsWith("enum[") && type.endsWith("]")) {
        const inside = type.slice(5, -1);
        const rawOpts = inside.split("|");
        const next: string[] = [];
        for (const opt of rawOpts) {
          const t = opt.trim();
          if (t !== "") next.push(t);
        }
        if (next.length > 0) options = next;
      }

      paramDefs.push({ key, type, defaultVal, options });
    }

    let rawSavedParams: Record<string, unknown> | null = null;
    let rawSavedParamsParseFailed = false;
    const rawParamText = strategy.parameters;
    if (rawParamText !== null && rawParamText.trim() !== "") {
      try {
        rawSavedParams = JSON.parse(rawParamText) as Record<string, unknown>;
      } catch {
        rawSavedParams = null;
        rawSavedParamsParseFailed = true;
      }
    }

    const savedFlat: Record<string, unknown> = {};
    if (rawSavedParams !== null) {
      for (const [key, val] of Object.entries(rawSavedParams)) {
        let extracted: unknown = val;
        if (
          val !== null &&
          typeof val === "object" &&
          "value" in (val as Record<string, unknown>)
        ) {
          extracted = (val as Record<string, unknown>).value;
        }
        if (extracted === undefined || extracted === null) continue;
        savedFlat[key] = extracted;
      }
    }

    const codeKeySet = new Set<string>();
    for (const d of paramDefs) codeKeySet.add(d.key);

    const defaults: Record<string, unknown> = {};
    for (const d of paramDefs) {
      const t = d.type;
      if (t === "boolean") {
        defaults[d.key] = d.defaultVal === "true";
        continue;
      }
      if (t === "int" || t === "bps") {
        const parsed = Number.parseInt(d.defaultVal, 10);
        let n = Number.isFinite(parsed) ? parsed : 0;
        if (t === "bps") {
          if (n < 0) n = 0;
          if (n > 5000) n = 5000;
        }
        defaults[d.key] = n;
        continue;
      }
      if (t === "number" || t === "eth" || t === "usd" || t === "pct") {
        const parsed = Number.parseFloat(d.defaultVal);
        let n = Number.isFinite(parsed) ? parsed : 0;
        if (t === "pct") {
          if (n < 0) n = 0;
          if (n > 100) n = 100;
        }
        defaults[d.key] = n;
        continue;
      }
      if (d.options !== undefined && d.options.length > 0) {
        let ok = false;
        for (const opt of d.options) {
          if (opt === d.defaultVal) {
            ok = true;
            break;
          }
        }
        defaults[d.key] = ok ? d.defaultVal : d.options[0]!;
        continue;
      }
      defaults[d.key] = d.defaultVal;
    }

    const cleaned: Record<string, unknown> = {};
    const extraKeys: string[] = [];
    const fixedKeys: string[] = [];
    let changed = false;

    if (rawSavedParamsParseFailed) changed = true;

    // Drop extras (keys not declared in code)
    for (const k of Object.keys(savedFlat)) {
      if (k.startsWith("__")) continue;
      if (!codeKeySet.has(k)) {
        extraKeys.push(k);
        changed = true;
      }
    }

    if (paramDefs.length === 0) {
      // No declared params — preserve whatever is stored.
      for (const [k, v] of Object.entries(savedFlat)) {
        cleaned[k] = v;
      }
    } else {
      for (const d of paramDefs) {
        cleaned[d.key] = defaults[d.key];

        const raw = savedFlat[d.key];
        if (raw === undefined || raw === null) {
          if (rawSavedParams !== null) changed = true; // missing key — fill default
          continue;
        }

        const t = d.type;
        if (t === "boolean") {
          if (typeof raw === "boolean") cleaned[d.key] = raw;
          else if (typeof raw === "string") {
            if (raw === "true") cleaned[d.key] = true;
            else if (raw === "false") cleaned[d.key] = false;
            else {
              fixedKeys.push(d.key);
              changed = true;
            }
          } else {
            fixedKeys.push(d.key);
            changed = true;
          }
          continue;
        }

        if (t === "int" || t === "bps") {
          let parsed: number | null = null;
          if (typeof raw === "number" && Number.isFinite(raw)) parsed = Math.trunc(raw);
          else if (typeof raw === "string") {
            const n = Number.parseInt(raw, 10);
            if (Number.isFinite(n)) parsed = n;
          }
          if (parsed === null) {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          let n = parsed;
          if (t === "bps") {
            if (n < 0) n = 0;
            if (n > 5000) n = 5000;
          }
          cleaned[d.key] = n;
          continue;
        }

        if (t === "number" || t === "eth" || t === "usd" || t === "pct") {
          let parsed: number | null = null;
          if (typeof raw === "number" && Number.isFinite(raw)) parsed = raw;
          else if (typeof raw === "string") {
            const n = Number.parseFloat(raw);
            if (Number.isFinite(n)) parsed = n;
          }
          if (parsed === null) {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          let n = parsed;
          if (t === "pct") {
            if (n < 0) n = 0;
            if (n > 100) n = 100;
          }
          cleaned[d.key] = n;
          continue;
        }

        if (d.options !== undefined && d.options.length > 0) {
          if (typeof raw !== "string") {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          let ok = false;
          for (const opt of d.options) {
            if (opt === raw) {
              ok = true;
              break;
            }
          }
          if (!ok) {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          cleaned[d.key] = raw;
          continue;
        }

        // interval / address / string-like
        if (t === "interval") {
          if (typeof raw !== "string") {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          const ok = raw === "once" || /^(\d+)(s|m|h|d)$/.test(raw);
          if (!ok) {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          cleaned[d.key] = raw;
          continue;
        }

        if (t === "address" || t === "pair" || t === "token") {
          if (typeof raw !== "string") {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          const ok = raw === "" || /^0x[a-fA-F0-9]{40}$/.test(raw);
          if (!ok) {
            fixedKeys.push(d.key);
            changed = true;
            continue;
          }
          cleaned[d.key] = raw;
          continue;
        }

        if (typeof raw === "string") {
          cleaned[d.key] = raw;
        } else {
          fixedKeys.push(d.key);
          changed = true;
        }
      }
    }

    if (changed && paramDefs.length > 0) {
      await prisma.strategy
        .update({
          where: { id: strategyId },
          data: { parameters: JSON.stringify(cleaned) },
        })
        .catch(() => {});

      if (extraKeys.length > 0 || fixedKeys.length > 0) {
        const extraLabel = extraKeys.length > 0 ? extraKeys.join(", ") : "(none)";
        const fixedLabel = fixedKeys.length > 0 ? fixedKeys.join(", ") : "(none)";
        api.log(`Parameters auto-repaired. Removed: ${extraLabel}. Reset/filled: ${fixedLabel}.`);
      } else if (rawSavedParamsParseFailed) {
        api.log("Parameters auto-repaired: saved parameters JSON was invalid; reset to defaults.");
      }
    }

    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cleaned)) {
      if (paramDefs.length > 0 && !codeKeySet.has(k) && !k.startsWith("__")) continue;
      params[k] = v;
    }

    // Feature: Inject current time into PARAMS
    params.__currentTime = new Date().toISOString();
    params.__currentTimestamp = Date.now();

    const validationErr = validateStrategyCode(code);
    if (validationErr !== null) {
      state.logs.push({
        timestamp: Date.now(),
        message: `Unsafe strategy rejected: ${validationErr}`,
        level: "error",
      });
      await prisma.strategy
        .update({
          where: { id: strategyId },
          data: { status: "error" },
        })
        .catch(() => {});
      return;
    }

    // Transpile TypeScript → JavaScript (strips type annotations so new Function() works)
    try {
      code = tsTranspiler.transformSync(code);
    } catch (transpileErr) {
      const msg = transpileErr instanceof Error ? transpileErr.message : String(transpileErr);
      state.logs.push({
        timestamp: Date.now(),
        message: `TypeScript transpile error: ${msg}`,
        level: "error",
      });
      await prisma.strategy
        .update({ where: { id: strategyId }, data: { status: "error" } })
        .catch(() => {});
      return;
    }

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
    const next = getNextSchedule();
    if (next !== null && running.has(strategyId)) {
      if (next.ms === null) {
        state.logs.push({
          timestamp: Date.now(),
          message: "Run complete (one-shot)",
          level: "info",
        });
      } else {
        const ms = next.ms;
        state.logs.push({
          timestamp: Date.now(),
          message: `Next run scheduled: ${next.label} (${ms}ms)`,
          level: "info",
        });
        state.timerId = setTimeout(() => executeRun(strategyId), ms);
      }
    } else {
      // Strategy didn't call scheduleNext — mark as complete
      state.logs.push({
        timestamp: Date.now(),
        message: "Run complete (no reschedule)",
        level: "info",
      });
    }
  } catch (e) {
    if (state.stopRequested) return;
    const errMsg = e instanceof Error ? e.message : String(e);
    state.logs.push({ timestamp: Date.now(), message: `Runtime error: ${errMsg}`, level: "error" });
    console.error(`[${strategyId}] Runtime error:`, e);

    // Mark strategy as errored
    await prisma.strategy
      .update({
        where: { id: strategyId },
        data: { status: "error" },
      })
      .catch(() => {});
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
  let userAddr: string | null = null;
  if (strategy.exchange === "robinpump") {
    const secret = await prisma.exchangeSecret.findUnique({
      where: { exchange: "robinpump" },
    });
    if (secret === null) {
      throw new Error("RobinPump not configured. Go to Settings and connect your wallet.");
    }

    const hasWallet = secret.walletAddress !== null && secret.walletAddress !== "";
    const hasDirectKey = isHexPrivateKey(secret.apiKey);
    if (!hasWallet && !hasDirectKey) {
      throw new Error("RobinPump not configured. Go to Settings and connect your wallet.");
    }

    userAddr = secret.walletAddress ?? null;

    // Delegate path: use operator key for on-chain reads, contract for writes
    if (delegateConfig !== null && userAddr !== null) {
      rp = new RobinPump({ privateKey: delegateConfig.operatorPrivateKey });
      console.log(`  Using TradDelegate for user ${userAddr}`);
    }
    // Legacy path: direct private key trading
    else if (isHexPrivateKey(secret.apiKey)) {
      rp = new RobinPump({ privateKey: secret.apiKey });
    }
    // Wallet address set but no delegate configured — cannot trade server-side.
    else if (delegateConfig === null && userAddr !== null) {
      throw new Error(
        "TradDelegate contract not configured. Set TRAD_DELEGATE_ADDRESS and OPERATOR_PRIVATE_KEY in .env",
      );
    }
  }

  let executionMode: ExecutionMode = "direct";
  if (delegateConfig !== null && userAddr !== null) executionMode = "delegate";

  let run = await prisma.strategyRun.findFirst({
    where: { strategyId, stoppedAt: null },
    orderBy: { startedAt: "desc" },
  });

  if (run === null) {
    let initialCapitalEth = 0;
    if (executionMode === "delegate" && delegateConfig !== null && userAddr !== null) {
      try {
        const bal = await delegateConfig.publicClient.readContract({
          address: delegateConfig.delegateAddress,
          abi: tradDelegateAbi,
          functionName: "balanceOf",
          args: [getAddress(userAddr)],
        });
        initialCapitalEth = Number(formatEther(bal));
      } catch {
        initialCapitalEth = 0;
      }
    } else if (executionMode === "direct" && rp !== null) {
      try {
        const bal = await rp.getEthBalance();
        initialCapitalEth = Number(formatEther(bal));
      } catch {
        initialCapitalEth = 0;
      }
    }

    let runUserAddress: string | null = null;
    if (executionMode === "delegate") {
      runUserAddress = userAddr;
    } else if (rp !== null) {
      runUserAddress = rp.account.address;
    } else {
      runUserAddress = userAddr;
    }

    run = await prisma.strategyRun.create({
      data: {
        strategyId,
        initialCapitalEth,
        isDryRun: globalDryRun,
        executionMode,
        userAddress: runUserAddress,
      },
    });
  } else {
    executionMode = run.executionMode === "delegate" ? "delegate" : "direct";
  }

  const positions = new Map<string, PositionState>();
  try {
    const rows = await prisma.strategyPosition.findMany({
      where: { runId: run.id },
    });
    for (const r of rows) {
      positions.set(r.pairAddress, {
        tokenHeld: r.tokenHeld,
        costBasisEth: r.costBasisEth,
        tokenAddress: r.tokenAddress ?? null,
      });
    }
  } catch {
    // ignore
  }

  let tradeIdx = 0;
  let cumulativePnlEth = 0;
  try {
    const last = await prisma.strategyTrade.findFirst({
      where: { runId: run.id },
      orderBy: { idx: "desc" },
    });
    if (last !== null) {
      tradeIdx = last.idx + 1;
      cumulativePnlEth = last.cumulativePnlEth;
    }
  } catch {
    // ignore
  }

  let stopPromiseResolve: (() => void) | null = null;
  const stopPromise = new Promise<void>((resolve) => {
    stopPromiseResolve = resolve;
  });

  const state: RunningStrategy = {
    strategyId,
    timerId: null,
    logs: [],
    startedAt: Date.now(),
    runCount: 0,
    robinpump: rp,
    userAddress: userAddr,

    runId: run.id,
    tradeIdx,
    cumulativePnlEth,
    initialCapitalEth: run.initialCapitalEth,
    executionMode,

    positions,
    pairTokenCache: new Map<string, string>(),

    risk: readRiskLimitsFromEnv(),
    budgets: {
      dayKey: new Date().toISOString().slice(0, 10),
      ethSpentToday: 0,
      tradesThisRun: 0,
      ethSpentThisRun: 0,
    },

    lastScheduleInterval: null,

    stopRequested: false,
    stopPromise,
    stopPromiseResolve,
  };

  running.set(strategyId, state);
  stoppedLogs.delete(strategyId); // Clear stale logs from previous run

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

  state.stopRequested = true;
  if (state.stopPromiseResolve !== null) {
    state.stopPromiseResolve();
    state.stopPromiseResolve = null;
  }

  // Clear scheduled timer
  if (state.timerId !== null) {
    clearTimeout(state.timerId);
  }

  // Preserve logs so they remain visible after stop
  state.logs.push({ timestamp: Date.now(), message: "Strategy stopped", level: "info" });
  stoppedLogs.set(strategyId, {
    logs: state.logs,
    startedAt: state.startedAt,
    runCount: state.runCount,
  });

  running.delete(strategyId);

  // Mark as paused in DB
  await prisma.strategy.update({
    where: { id: strategyId },
    data: { status: "paused" },
  });

  await prisma.strategyRun
    .update({
      where: { id: state.runId },
      data: { stoppedAt: new Date() },
    })
    .catch(() => {});

  console.log(`⏹ Strategy ${strategyId} stopped`);
}

/** Get logs and status for a running strategy. */
function getStrategyRuntime(strategyId: string) {
  const state = running.get(strategyId);
  if (state !== undefined) {
    return {
      strategyId: state.strategyId,
      startedAt: state.startedAt,
      runCount: state.runCount,
      logs: state.logs.slice(-100),
      isRunning: true,
    };
  }

  // Fallback: show preserved logs from a stopped strategy
  const stopped = stoppedLogs.get(strategyId);
  if (stopped !== undefined) {
    return {
      strategyId,
      startedAt: stopped.startedAt,
      runCount: stopped.runCount,
      logs: stopped.logs.slice(-100),
      isRunning: false,
    };
  }

  return null;
}

/** List all currently running strategy IDs. */
function listRunning() {
  return [...running.keys()];
}

// ─── Job resume ──────────────────────────────────────────────────────

/** Resume all strategies that were active before the server restarted. */
async function resumeActiveStrategies() {
  const activeStrategies = await prisma.strategy.findMany({
    where: { status: "active" },
  });
  for (const strategy of activeStrategies) {
    try {
      console.log(`♻ Resuming strategy ${strategy.id} (${strategy.name})`);
      await startStrategy(strategy.id);
    } catch (e) {
      console.error(`Failed to resume ${strategy.id}:`, e);
    }
  }
  if (activeStrategies.length > 0) {
    console.log(`♻ Resumed ${activeStrategies.length} active strategies`);
  }
}

// ─── Exports ─────────────────────────────────────────────────────────

export {
  startStrategy,
  stopStrategy,
  getStrategyRuntime,
  listRunning,
  resumeActiveStrategies,
  setDryRun,
  isDryRun,
};
