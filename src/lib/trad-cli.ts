/**
 * Trad CLI — a custom just-bash command for introspecting the local Trad server.
 *
 * Intended for LLM strategy generation: enumerate existing strategies, inspect
 * wallet + TradDelegate state, and fetch runs/trades/logs for context.
 *
 * All data subcommands output JSON for easy parsing.
 */

import { defineCommand } from "just-bash";
import { Database } from "bun:sqlite";
import path from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient, formatEther, getAddress, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getStrategyRuntime, isDryRun, listRunning } from "./runtime";
import { isHexPrivateKey } from "./hex";
import { readRiskLimitsFromEnv } from "./risk";
import { tradDelegateAbi } from "../../contracts/abi";

const HELP = `Usage: trad <command> [subcommand] [options]

Commands:
  routes
    List available Trad HTTP routes. Returns JSON.

  strategies list [--limit N] [--offset N]
    List strategies (most recently updated first). Returns JSON.

  strategies get <strategyId> [--code] [--config] [--params] [--chat] [--all]
    Get a strategy. By default returns metadata only. Returns JSON.

  strategies running
    List currently running strategy IDs. Returns JSON.

  strategies logs <strategyId> [--limit N]
    Tail runtime logs (running or last-stopped). Returns JSON.

  strategies runs <strategyId> [--limit N]
    List recent runs with summary fields. Returns JSON.

  strategies trades <strategyId> [--runId <id>] [--limit N]
    List recent trades for a run (defaults to latest run). Returns JSON.

  strategies positions <strategyId> [--runId <id>]
    List stored positions for a run (defaults to latest run). Returns JSON.

  settings
    Show configured exchanges (secrets redacted). Returns JSON.

  dry-run
    Show current dry-run state + risk limits. Returns JSON.

  wallet info
    Show RobinPump wallet configuration + on-chain balances. Returns JSON.

  wallet eth-balance <address>
    Get Base ETH balance for an address. Returns JSON.

  delegate info
    Show TradDelegate configuration (address). Returns JSON.

  delegate status
    Query TradDelegate contract state (owner/operator/fee/paused). Returns JSON.

  delegate balance [--user <address>]
    Get deposited ETH balance for a user (defaults to configured walletAddress). Returns JSON.

  delegate token-balance --token <address> [--user <address>]
    Get deposited token balance for a user. Returns JSON.

  delegate is-pair-allowed <pairAddress>
    Check if a RobinPump pair is allowlisted. Returns JSON.

  help
    Show this help message.

Notes:
- Data commands output JSON.
- No secrets (private keys, api secrets) are ever returned.
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object") return false;
  if (value === null) return false;
  if (Array.isArray(value)) return false;
  return true;
}

function safeJsonParseObject(raw: string) {
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return null;
    return v;
  } catch {
    return null;
  }
}

function safeJsonParseParamState(raw: string) {
  const obj = safeJsonParseObject(raw);
  if (obj === null) return null;

  const out: Record<string, string | number | boolean> = {};
  for (const k in obj) {
    const v = obj[k];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

function maskAddress(addr: string) {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
// NOTE: just-bash defense-in-depth blocks setTimeout during sandbox execution.
// viem's default RPC transport uses setTimeout for retries/timeouts, so we
// explicitly disable both to keep Trad introspection working inside the sandbox.
const baseClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 0 }),
});

const envAllowLiveTrading = process.env.TRAD_ALLOW_LIVE_TRADING === "true";
const envDryRunFlag = process.env.DRY_RUN === "true";
const envDelegateAddress = process.env.TRAD_DELEGATE_ADDRESS ?? null;
const envOperatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY ?? null;
const hasBaseRpcUrlEnv = process.env.BASE_RPC_URL !== undefined && process.env.BASE_RPC_URL !== "";
const riskLimitsFromEnv = readRiskLimitsFromEnv();

const dbPath = path.resolve(import.meta.dir, "..", "..", "dev.db");
let db: Database | null = null;
let dbInitError: string | null = null;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  db = null;
  dbInitError = e instanceof Error ? e.message : String(e);
}

interface StrategyListRow {
  id: string;
  name: string;
  description: string | null;
  exchange: string;
  status: string;
  lastRun: string | null;
  createdAt: string;
  updatedAt: string;
  hasCode: number;
  hasConfig: number;
  parameters: string | null;
}

interface StrategyGetRow {
  id: string;
  name: string;
  description: string | null;
  exchange: string;
  status: string;
  code: string | null;
  config: string | null;
  parameters: string | null;
  chatHistory: string | null;
  lastRun: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StrategyRunSummaryRow {
  id: string;
  strategyId: string;
  startedAt: string;
  stoppedAt: string | null;
  initialCapitalEth: number;
  isDryRun: number;
  executionMode: string;
  userAddress: string | null;
  totalTrades: number;
  totalPnlEth: number | null;
}

interface StrategyRunLookupRow {
  id: string;
  startedAt: string;
}

interface StrategyTradeRow {
  idx: number;
  timestamp: number;
  side: string;
  pairAddress: string;
  tokenAddress: string | null;
  txHash: string;
  status: string;
  amountEth: number;
  tokenAmount: number;
  feeEth: number;
  gasEth: number;
  pnlEth: number;
  pnlPct: number;
  cumulativePnlEth: number;
}

interface StrategyPositionRow {
  pairAddress: string;
  tokenAddress: string | null;
  tokenHeld: number;
  costBasisEth: number;
  updatedAt: string;
}

interface ExchangeSecretRow {
  id: string;
  exchange: string;
  apiKey: string;
  apiSecret: string;
  walletAddress: string | null;
  updatedAt: string;
}

export const tradCommand = defineCommand("trad", async (args, ctx) => {
  const subcommand = args[0] ?? "help";
  const subArgs = args.slice(1);

  try {
    if (subcommand === "routes") {
      const routes = [
        { method: "GET", path: "/api/strategies", description: "List strategies" },
        { method: "POST", path: "/api/strategies", description: "Create strategy (admin)" },
        { method: "GET", path: "/api/strategies/:id", description: "Get strategy" },
        { method: "PUT", path: "/api/strategies/:id", description: "Update strategy (admin)" },
        { method: "DELETE", path: "/api/strategies/:id", description: "Delete strategy (admin)" },
        { method: "GET", path: "/api/strategies/:id/runs", description: "List strategy runs" },
        {
          method: "GET",
          path: "/api/strategies/:id/performance",
          description: "Strategy performance summary + curve",
        },
        {
          method: "GET",
          path: "/api/strategies/:id/logs",
          description: "Runtime logs (running or last-stopped)",
        },
        {
          method: "POST",
          path: "/api/strategies/:id/deploy",
          description: "Start strategy runtime (admin)",
        },
        {
          method: "POST",
          path: "/api/strategies/:id/stop",
          description: "Stop strategy runtime (admin)",
        },
        { method: "GET", path: "/api/strategies/running", description: "List running strategies" },
        {
          method: "GET",
          path: "/api/settings",
          description: "List masked exchange secrets (admin)",
        },
        { method: "POST", path: "/api/settings", description: "Upsert exchange secret (admin)" },
        {
          method: "DELETE",
          path: "/api/settings/:exchange",
          description: "Delete exchange secret (admin)",
        },
        { method: "GET", path: "/api/settings/dry-run", description: "Dry-run state (admin)" },
        { method: "POST", path: "/api/settings/dry-run", description: "Toggle dry-run (admin)" },
        { method: "GET", path: "/api/contract/info", description: "TradDelegate configuration" },
        {
          method: "GET",
          path: "/api/contract/balance/:address",
          description: "TradDelegate deposited ETH for user",
        },
        { method: "POST", path: "/api/chat", description: "Strategy code-gen chat (Sonnet 4.5)" },
        { method: "POST", path: "/api/generate", description: "UI spec generation" },
        { method: "GET", path: "/api/robinpump/coins", description: "RobinPump coin list" },
        {
          method: "GET",
          path: "/api/robinpump/coins/:pair",
          description: "RobinPump coin details",
        },
        {
          method: "GET",
          path: "/api/robinpump/coins/:pair/trades",
          description: "RobinPump trades",
        },
        {
          method: "GET",
          path: "/api/robinpump/coins/:pair/metadata",
          description: "Coin + IPFS metadata",
        },
        {
          method: "GET",
          path: "/api/robinpump/coins-enriched",
          description: "Coin list enriched with market cap",
        },
        { method: "POST", path: "/api/robinpump/trade", description: "Execute trade (admin)" },
      ];

      return {
        stdout: JSON.stringify({ routes }, null, 2) + "\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (subcommand === "strategies") {
      const action = subArgs[0] ?? "list";
      const actionArgs = subArgs.slice(1);

      if (action === "list") {
        const { values } = parseArgs({
          args: actionArgs,
          options: {
            limit: { type: "string", default: "50", short: "l" },
            offset: { type: "string", default: "0", short: "o" },
          },
          strict: false,
        });

        const limit = Math.min(Number.parseInt(String(values.limit ?? "50"), 10) || 50, 200);
        const offset = Number.parseInt(String(values.offset ?? "0"), 10) || 0;

        const running = listRunning();
        const runningSet = new Set<string>();
        for (const id of running) runningSet.add(id);

        if (db === null) {
          const err = dbInitError ?? "Database not available";
          return { stdout: "", stderr: `Error: failed to open dev.db (${err})\n`, exitCode: 1 };
        }

        const rows = db
          .query<StrategyListRow, [number, number]>(
            `SELECT
            id,
            name,
            description,
            exchange,
            status,
            lastRun,
            createdAt,
            updatedAt,
            CASE WHEN code IS NOT NULL AND length(trim(code)) > 0 THEN 1 ELSE 0 END AS hasCode,
            CASE WHEN config IS NOT NULL AND length(trim(config)) > 0 THEN 1 ELSE 0 END AS hasConfig,
            parameters
          FROM Strategy
          ORDER BY updatedAt DESC
          LIMIT ? OFFSET ?`,
          )
          .all(limit, offset);

        const out: Record<string, unknown>[] = [];
        for (const s of rows) {
          const paramKeys: string[] = [];
          if (s.parameters !== null && s.parameters !== "") {
            const obj = safeJsonParseObject(s.parameters);
            if (obj !== null) {
              for (const k in obj) paramKeys.push(k);
            }
          }

          out.push({
            id: s.id,
            name: s.name,
            description: s.description,
            exchange: s.exchange,
            status: s.status,
            lastRun: s.lastRun,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            isRunning: runningSet.has(s.id),
            hasCode: s.hasCode === 1,
            hasConfig: s.hasConfig === 1,
            paramKeys,
          });
        }

        return {
          stdout: JSON.stringify({ count: out.length, strategies: out }, null, 2) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      if (action === "get") {
        const strategyId = actionArgs[0] ?? null;
        if (strategyId === null || strategyId === "") {
          return {
            stdout: "",
            stderr: "Error: strategyId required\nUsage: trad strategies get <strategyId>\n",
            exitCode: 1,
          };
        }

        const { values } = parseArgs({
          args: actionArgs.slice(1),
          options: {
            code: { type: "boolean", default: false },
            config: { type: "boolean", default: false },
            params: { type: "boolean", default: false },
            chat: { type: "boolean", default: false },
            all: { type: "boolean", default: false },
          },
          strict: false,
        });

        const includeCode = values.all === true || values.code === true;
        const includeConfig = values.all === true || values.config === true;
        const includeParams = values.all === true || values.params === true;
        const includeChat = values.all === true || values.chat === true;

        if (db === null) {
          const err = dbInitError ?? "Database not available";
          return { stdout: "", stderr: `Error: failed to open dev.db (${err})\n`, exitCode: 1 };
        }

        const s = db
          .query<StrategyGetRow, [string]>(
            `SELECT
            id,
            name,
            description,
            exchange,
            status,
            code,
            config,
            parameters,
            chatHistory,
            lastRun,
            createdAt,
            updatedAt
          FROM Strategy
          WHERE id = ?
          LIMIT 1`,
          )
          .get(strategyId);

        if (s === null) {
          return { stdout: "", stderr: `Error: strategy not found: ${strategyId}\n`, exitCode: 1 };
        }

        const out: Record<string, unknown> = {
          id: s.id,
          name: s.name,
          description: s.description,
          exchange: s.exchange,
          status: s.status,
          lastRun: s.lastRun,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          hasCode: s.code !== null && s.code.trim() !== "",
          hasConfig: s.config !== null && s.config.trim() !== "",
          hasParams: s.parameters !== null && s.parameters.trim() !== "",
          hasChat: s.chatHistory !== null && s.chatHistory.trim() !== "",
        };

        if (includeParams) {
          out.parameters =
            s.parameters !== null ? (safeJsonParseParamState(s.parameters) ?? s.parameters) : null;
        }
        if (includeConfig) out.config = s.config;
        if (includeChat) out.chatHistory = s.chatHistory;
        if (includeCode) out.code = s.code;

        return { stdout: JSON.stringify(out, null, 2) + "\n", stderr: "", exitCode: 0 };
      }

      if (action === "running") {
        const running = listRunning();
        return { stdout: JSON.stringify({ running }, null, 2) + "\n", stderr: "", exitCode: 0 };
      }

      if (action === "logs") {
        const strategyId = actionArgs[0] ?? null;
        if (strategyId === null || strategyId === "") {
          return {
            stdout: "",
            stderr:
              "Error: strategyId required\nUsage: trad strategies logs <strategyId> [--limit N]\n",
            exitCode: 1,
          };
        }

        const { values } = parseArgs({
          args: actionArgs.slice(1),
          options: {
            limit: { type: "string", default: "100", short: "l" },
          },
          strict: false,
        });
        const limit = Math.min(Number.parseInt(String(values.limit ?? "100"), 10) || 100, 200);

        const rt = getStrategyRuntime(strategyId);
        if (rt === null) {
          return {
            stdout: JSON.stringify({ strategyId, isRunning: false, logs: [] }, null, 2) + "\n",
            stderr: "",
            exitCode: 0,
          };
        }

        const logs = rt.logs.slice(-limit);
        return { stdout: JSON.stringify({ ...rt, logs }, null, 2) + "\n", stderr: "", exitCode: 0 };
      }

      if (action === "runs") {
        const strategyId = actionArgs[0] ?? null;
        if (strategyId === null || strategyId === "") {
          return {
            stdout: "",
            stderr:
              "Error: strategyId required\nUsage: trad strategies runs <strategyId> [--limit N]\n",
            exitCode: 1,
          };
        }

        const { values } = parseArgs({
          args: actionArgs.slice(1),
          options: {
            limit: { type: "string", default: "25", short: "l" },
          },
          strict: false,
        });
        const limit = Math.min(Number.parseInt(String(values.limit ?? "25"), 10) || 25, 100);

        if (db === null) {
          const err = dbInitError ?? "Database not available";
          return { stdout: "", stderr: `Error: failed to open dev.db (${err})\n`, exitCode: 1 };
        }

        const runs = db
          .query<StrategyRunSummaryRow, [string, number]>(
            `SELECT
            r.id,
            r.strategyId,
            r.startedAt,
            r.stoppedAt,
            r.initialCapitalEth,
            r.isDryRun,
            r.executionMode,
            r.userAddress,
            (SELECT COUNT(*) FROM StrategyTrade t WHERE t.runId = r.id) AS totalTrades,
            (SELECT cumulativePnlEth FROM StrategyTrade t WHERE t.runId = r.id ORDER BY idx DESC LIMIT 1) AS totalPnlEth
          FROM StrategyRun r
          WHERE r.strategyId = ?
          ORDER BY r.startedAt DESC
          LIMIT ?`,
          )
          .all(strategyId, limit);

        const out: Record<string, unknown>[] = [];
        for (const run of runs) {
          out.push({
            id: run.id,
            strategyId: run.strategyId,
            startedAt: run.startedAt,
            stoppedAt: run.stoppedAt,
            initialCapitalEth: run.initialCapitalEth,
            isDryRun: run.isDryRun === 1,
            executionMode: run.executionMode,
            userAddress: run.userAddress,
            totalTrades: run.totalTrades,
            totalPnlEth: run.totalPnlEth ?? 0,
          });
        }

        return { stdout: JSON.stringify({ runs: out }, null, 2) + "\n", stderr: "", exitCode: 0 };
      }

      if (action === "trades") {
        const strategyId = actionArgs[0] ?? null;
        if (strategyId === null || strategyId === "") {
          return {
            stdout: "",
            stderr:
              "Error: strategyId required\nUsage: trad strategies trades <strategyId> [--runId <id>] [--limit N]\n",
            exitCode: 1,
          };
        }

        const { values } = parseArgs({
          args: actionArgs.slice(1),
          options: {
            runId: { type: "string" },
            limit: { type: "string", default: "50", short: "l" },
          },
          strict: false,
        });

        const limit = Math.min(Number.parseInt(String(values.limit ?? "50"), 10) || 50, 500);
        const runId = typeof values.runId === "string" && values.runId !== "" ? values.runId : null;

        if (db === null) {
          const err = dbInitError ?? "Database not available";
          return { stdout: "", stderr: `Error: failed to open dev.db (${err})\n`, exitCode: 1 };
        }

        let run = null as null | StrategyRunLookupRow;
        if (runId !== null) {
          run = db
            .query<StrategyRunLookupRow, [string, string]>(
              `SELECT id, startedAt
            FROM StrategyRun
            WHERE id = ? AND strategyId = ?
            LIMIT 1`,
            )
            .get(runId, strategyId);
        } else {
          run = db
            .query<StrategyRunLookupRow, [string]>(
              `SELECT id, startedAt
            FROM StrategyRun
            WHERE strategyId = ? AND stoppedAt IS NULL
            ORDER BY startedAt DESC
            LIMIT 1`,
            )
            .get(strategyId);
          if (run === null) {
            run = db
              .query<StrategyRunLookupRow, [string]>(
                `SELECT id, startedAt
              FROM StrategyRun
              WHERE strategyId = ?
              ORDER BY startedAt DESC
              LIMIT 1`,
              )
              .get(strategyId);
          }
        }

        if (run === null) {
          return {
            stdout: JSON.stringify({ strategyId, run: null, trades: [] }, null, 2) + "\n",
            stderr: "",
            exitCode: 0,
          };
        }

        const trades = db
          .query<StrategyTradeRow, [string, number]>(
            `SELECT
            idx,
            timestamp,
            side,
            pairAddress,
            tokenAddress,
            txHash,
            status,
            amountEth,
            tokenAmount,
            feeEth,
            gasEth,
            pnlEth,
            pnlPct,
            cumulativePnlEth
          FROM StrategyTrade
          WHERE runId = ?
          ORDER BY idx DESC
          LIMIT ?`,
          )
          .all(run.id, limit);

        const out: Record<string, unknown>[] = [];
        for (let i = trades.length - 1; i >= 0; i--) {
          const t = trades[i]!;
          out.push({
            idx: t.idx,
            timestamp: t.timestamp,
            side: t.side,
            pairAddress: t.pairAddress,
            tokenAddress: t.tokenAddress,
            txHash: t.txHash,
            status: t.status,
            amountEth: t.amountEth,
            tokenAmount: t.tokenAmount,
            feeEth: t.feeEth,
            gasEth: t.gasEth,
            pnlEth: t.pnlEth,
            pnlPct: t.pnlPct,
            cumulativePnlEth: t.cumulativePnlEth,
          });
        }

        return {
          stdout:
            JSON.stringify({ strategyId, runId: run.id, count: out.length, trades: out }, null, 2) +
            "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      if (action === "positions") {
        const strategyId = actionArgs[0] ?? null;
        if (strategyId === null || strategyId === "") {
          return {
            stdout: "",
            stderr:
              "Error: strategyId required\nUsage: trad strategies positions <strategyId> [--runId <id>]\n",
            exitCode: 1,
          };
        }

        const { values } = parseArgs({
          args: actionArgs.slice(1),
          options: {
            runId: { type: "string" },
          },
          strict: false,
        });

        const runId = typeof values.runId === "string" && values.runId !== "" ? values.runId : null;

        if (db === null) {
          const err = dbInitError ?? "Database not available";
          return { stdout: "", stderr: `Error: failed to open dev.db (${err})\n`, exitCode: 1 };
        }

        let run = null as null | StrategyRunLookupRow;
        if (runId !== null) {
          run = db
            .query<StrategyRunLookupRow, [string, string]>(
              `SELECT id, startedAt
            FROM StrategyRun
            WHERE id = ? AND strategyId = ?
            LIMIT 1`,
            )
            .get(runId, strategyId);
        } else {
          run = db
            .query<StrategyRunLookupRow, [string]>(
              `SELECT id, startedAt
            FROM StrategyRun
            WHERE strategyId = ? AND stoppedAt IS NULL
            ORDER BY startedAt DESC
            LIMIT 1`,
            )
            .get(strategyId);
          if (run === null) {
            run = db
              .query<StrategyRunLookupRow, [string]>(
                `SELECT id, startedAt
              FROM StrategyRun
              WHERE strategyId = ?
              ORDER BY startedAt DESC
              LIMIT 1`,
              )
              .get(strategyId);
          }
        }

        if (run === null) {
          return {
            stdout: JSON.stringify({ strategyId, run: null, positions: [] }, null, 2) + "\n",
            stderr: "",
            exitCode: 0,
          };
        }

        const rows = db
          .query<StrategyPositionRow, [string]>(
            `SELECT
            pairAddress,
            tokenAddress,
            tokenHeld,
            costBasisEth,
            updatedAt
          FROM StrategyPosition
          WHERE runId = ?
          ORDER BY updatedAt DESC`,
          )
          .all(run.id);
        const out: Record<string, unknown>[] = [];
        for (const p of rows) {
          out.push({
            pairAddress: p.pairAddress,
            tokenAddress: p.tokenAddress,
            tokenHeld: p.tokenHeld,
            costBasisEth: p.costBasisEth,
            updatedAt: p.updatedAt,
          });
        }

        return {
          stdout:
            JSON.stringify(
              { strategyId, runId: run.id, count: out.length, positions: out },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      return {
        stdout: "",
        stderr: `Unknown command: strategies ${action}\nRun 'trad help' for usage.\n`,
        exitCode: 1,
      };
    }

    if (subcommand === "settings") {
      if (db === null) {
        const err = dbInitError ?? "Database not available";
        return { stdout: "", stderr: `Error: failed to open dev.db (${err})\n`, exitCode: 1 };
      }

      const secrets = db
        .query<ExchangeSecretRow, []>(
          `SELECT
          id,
          exchange,
          apiKey,
          apiSecret,
          walletAddress,
          updatedAt
        FROM ExchangeSecret
        ORDER BY updatedAt DESC`,
        )
        .all();
      const out: Record<string, unknown>[] = [];
      for (const s of secrets) {
        const hasApiKey = s.apiKey !== "";
        const hasApiSecret = s.apiSecret !== "";
        out.push({
          id: s.id,
          exchange: s.exchange,
          walletAddress: s.walletAddress,
          walletAddressMasked: s.walletAddress ? maskAddress(s.walletAddress) : null,
          connected: hasApiKey && hasApiSecret,
          hasApiKey,
          hasApiSecret,
          updatedAt: s.updatedAt,
        });
      }

      return {
        stdout: JSON.stringify({ exchanges: out }, null, 2) + "\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (subcommand === "dry-run") {
      return {
        stdout:
          JSON.stringify(
            {
              dryRun: isDryRun(),
              allowLiveTradingEnv: envAllowLiveTrading,
              envDryRun: envDryRunFlag,
              risk: riskLimitsFromEnv,
            },
            null,
            2,
          ) + "\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (subcommand === "wallet") {
      const action = subArgs[0] ?? "info";
      const actionArgs = subArgs.slice(1);

      if (action === "eth-balance") {
        const addrRaw = actionArgs[0] ?? null;
        if (addrRaw === null || addrRaw === "") {
          return {
            stdout: "",
            stderr: "Error: address required\nUsage: trad wallet eth-balance <address>\n",
            exitCode: 1,
          };
        }

        let addr: `0x${string}`;
        try {
          addr = getAddress(addrRaw);
        } catch {
          return { stdout: "", stderr: "Error: invalid address\n", exitCode: 1 };
        }

        const bal = await baseClient.getBalance({ address: addr });
        return {
          stdout:
            JSON.stringify(
              {
                address: addr,
                chainId: base.id,
                eth: formatEther(bal),
                wei: bal.toString(),
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      if (action === "info") {
        if (db === null) {
          const err = dbInitError ?? "Database not available";
          return { stdout: "", stderr: `Error: failed to open dev.db (${err})\n`, exitCode: 1 };
        }

        const secret = db
          .query<ExchangeSecretRow, [string]>(
            `SELECT
            id,
            exchange,
            apiKey,
            apiSecret,
            walletAddress,
            updatedAt
          FROM ExchangeSecret
          WHERE exchange = ?
          LIMIT 1`,
          )
          .get("robinpump");
        const walletAddressRaw = secret?.walletAddress ?? null;

        let walletAddress = null as null | `0x${string}`;
        let walletAddressSource: "none" | "db" | "derived" = "none";
        if (walletAddressRaw !== null && walletAddressRaw !== "") {
          try {
            walletAddress = getAddress(walletAddressRaw);
            walletAddressSource = "db";
          } catch {
            walletAddress = null;
          }
        }

        const delegateAddressRaw = envDelegateAddress;
        const operatorKeyRaw = envOperatorPrivateKey;

        let delegateAddress = null as null | `0x${string}`;
        if (delegateAddressRaw !== null && delegateAddressRaw !== "") {
          try {
            delegateAddress = getAddress(delegateAddressRaw);
          } catch {
            delegateAddress = null;
          }
        }

        const operatorKeyOk = operatorKeyRaw !== null && isHexPrivateKey(operatorKeyRaw);
        let operatorAddress = null as null | string;
        if (operatorKeyOk) {
          try {
            operatorAddress = privateKeyToAccount(operatorKeyRaw).address;
          } catch {
            operatorAddress = null;
          }
        }

        let mode: "unconfigured" | "delegate" | "direct" = "unconfigured";
        const hasDirectKey = secret !== null && isHexPrivateKey(secret.apiKey);
        if (walletAddress === null && secret !== null && isHexPrivateKey(secret.apiKey)) {
          try {
            walletAddress = privateKeyToAccount(secret.apiKey).address;
            walletAddressSource = "derived";
          } catch {
            walletAddress = null;
            walletAddressSource = "none";
          }
        }

        const hasWalletAddressInDb = walletAddressSource === "db";
        if (hasWalletAddressInDb && delegateAddress !== null && operatorAddress !== null)
          mode = "delegate";
        else if (hasDirectKey) mode = "direct";

        let walletEth = null as null | { eth: string; wei: string };
        if (walletAddress !== null) {
          try {
            const bal = await baseClient.getBalance({ address: walletAddress });
            walletEth = { eth: formatEther(bal), wei: bal.toString() };
          } catch {
            walletEth = null;
          }
        }

        let delegateEth = null as null | { eth: string; wei: string };
        if (delegateAddress !== null && walletAddress !== null && hasWalletAddressInDb) {
          try {
            const bal = await baseClient.readContract({
              address: delegateAddress,
              abi: tradDelegateAbi,
              functionName: "balanceOf",
              args: [walletAddress],
            });
            delegateEth = { eth: formatEther(bal), wei: bal.toString() };
          } catch {
            delegateEth = null;
          }
        }

        return {
          stdout:
            JSON.stringify(
              {
                exchange: "robinpump",
                mode,
                walletAddress: walletAddress,
                walletAddressMasked: walletAddress ? maskAddress(walletAddress) : null,
                walletAddressSource,
                configured: {
                  hasDbSecret: secret !== null,
                  hasWalletAddress: hasWalletAddressInDb,
                  hasDerivedWalletAddress: walletAddressSource === "derived",
                  hasDirectPrivateKey: hasDirectKey,
                  hasDelegateAddressEnv: delegateAddress !== null,
                  hasOperatorKeyEnv: operatorAddress !== null,
                },
                balances: {
                  walletEth,
                  delegateEth,
                },
                rpc: {
                  chainId: base.id,
                  hasBaseRpcUrlEnv,
                  urlIsDefault: rpcUrl === "https://mainnet.base.org",
                },
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      return {
        stdout: "",
        stderr: `Unknown command: wallet ${action}\nRun 'trad help' for usage.\n`,
        exitCode: 1,
      };
    }

    if (subcommand === "delegate") {
      const action = subArgs[0] ?? "info";
      const actionArgs = subArgs.slice(1);

      const delegateAddressRaw = envDelegateAddress;
      let delegateAddress = null as null | `0x${string}`;
      if (delegateAddressRaw !== null && delegateAddressRaw !== "") {
        try {
          delegateAddress = getAddress(delegateAddressRaw);
        } catch {
          delegateAddress = null;
        }
      }

      if (action === "info") {
        return {
          stdout:
            JSON.stringify(
              { configured: delegateAddress !== null, address: delegateAddress },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      if (delegateAddress === null) {
        return {
          stdout: "",
          stderr: "Error: TradDelegate not configured (missing/invalid TRAD_DELEGATE_ADDRESS)\n",
          exitCode: 1,
        };
      }

      if (action === "status") {
        const [owner, operator, guardian, paused, fee, feeReceiver] = await Promise.all([
          baseClient.readContract({
            address: delegateAddress,
            abi: tradDelegateAbi,
            functionName: "owner",
          }),
          baseClient.readContract({
            address: delegateAddress,
            abi: tradDelegateAbi,
            functionName: "operator",
          }),
          baseClient.readContract({
            address: delegateAddress,
            abi: tradDelegateAbi,
            functionName: "guardian",
          }),
          baseClient.readContract({
            address: delegateAddress,
            abi: tradDelegateAbi,
            functionName: "paused",
          }),
          baseClient.readContract({
            address: delegateAddress,
            abi: tradDelegateAbi,
            functionName: "fee",
          }),
          baseClient.readContract({
            address: delegateAddress,
            abi: tradDelegateAbi,
            functionName: "feeReceiver",
          }),
        ]);

        return {
          stdout:
            JSON.stringify(
              {
                address: delegateAddress,
                chainId: base.id,
                owner,
                operator,
                guardian,
                paused,
                feeBps: Number(fee),
                feePct: Number(fee) / 100,
                feeReceiver,
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      if (action === "balance") {
        const { values } = parseArgs({
          args: actionArgs,
          options: {
            user: { type: "string", short: "u" },
          },
          strict: false,
        });

        const userRaw = typeof values.user === "string" && values.user !== "" ? values.user : null;
        let fallbackUser = null as null | string;
        if (userRaw === null) {
          if (db === null) {
            const err = dbInitError ?? "Database not available";
            return {
              stdout: "",
              stderr: `Error: missing --user and failed to open dev.db (${err})\n`,
              exitCode: 1,
            };
          }
          const secret = db
            .query<ExchangeSecretRow, [string]>(
              `SELECT
              id,
              exchange,
              apiKey,
              apiSecret,
              walletAddress,
              updatedAt
            FROM ExchangeSecret
            WHERE exchange = ?
            LIMIT 1`,
            )
            .get("robinpump");
          fallbackUser = secret?.walletAddress ?? null;
        }
        const targetRaw = userRaw ?? fallbackUser;
        if (targetRaw === null || targetRaw === "") {
          return {
            stdout: "",
            stderr: "Error: missing user address (pass --user 0x... or configure walletAddress)\n",
            exitCode: 1,
          };
        }

        let user: `0x${string}`;
        try {
          user = getAddress(targetRaw);
        } catch {
          return { stdout: "", stderr: "Error: invalid user address\n", exitCode: 1 };
        }

        const bal = await baseClient.readContract({
          address: delegateAddress,
          abi: tradDelegateAbi,
          functionName: "balanceOf",
          args: [user],
        });

        return {
          stdout:
            JSON.stringify(
              {
                contract: delegateAddress,
                user,
                balanceEth: formatEther(bal),
                balanceWei: bal.toString(),
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      if (action === "token-balance") {
        const { values } = parseArgs({
          args: actionArgs,
          options: {
            user: { type: "string", short: "u" },
            token: { type: "string", short: "t" },
          },
          strict: false,
        });

        const tokenRaw =
          typeof values.token === "string" && values.token !== "" ? values.token : null;
        if (tokenRaw === null) {
          return {
            stdout: "",
            stderr:
              "Error: missing --token 0x...\nUsage: trad delegate token-balance --token <address> [--user <address>]\n",
            exitCode: 1,
          };
        }

        let token: `0x${string}`;
        try {
          token = getAddress(tokenRaw);
        } catch {
          return { stdout: "", stderr: "Error: invalid token address\n", exitCode: 1 };
        }

        const userRaw = typeof values.user === "string" && values.user !== "" ? values.user : null;
        let fallbackUser = null as null | string;
        if (userRaw === null) {
          if (db === null) {
            const err = dbInitError ?? "Database not available";
            return {
              stdout: "",
              stderr: `Error: missing --user and failed to open dev.db (${err})\n`,
              exitCode: 1,
            };
          }
          const secret = db
            .query<ExchangeSecretRow, [string]>(
              `SELECT
              id,
              exchange,
              apiKey,
              apiSecret,
              walletAddress,
              updatedAt
            FROM ExchangeSecret
            WHERE exchange = ?
            LIMIT 1`,
            )
            .get("robinpump");
          fallbackUser = secret?.walletAddress ?? null;
        }
        const targetRaw = userRaw ?? fallbackUser;
        if (targetRaw === null || targetRaw === "") {
          return {
            stdout: "",
            stderr: "Error: missing user address (pass --user 0x... or configure walletAddress)\n",
            exitCode: 1,
          };
        }

        let user: `0x${string}`;
        try {
          user = getAddress(targetRaw);
        } catch {
          return { stdout: "", stderr: "Error: invalid user address\n", exitCode: 1 };
        }

        const bal = await baseClient.readContract({
          address: delegateAddress,
          abi: tradDelegateAbi,
          functionName: "tokenBalanceOf",
          args: [user, token],
        });

        return {
          stdout:
            JSON.stringify(
              {
                contract: delegateAddress,
                user,
                token,
                balance: formatEther(bal),
                balanceWei: bal.toString(),
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      if (action === "is-pair-allowed") {
        const pairRaw = actionArgs[0] ?? null;
        if (pairRaw === null || pairRaw === "") {
          return {
            stdout: "",
            stderr:
              "Error: pair address required\nUsage: trad delegate is-pair-allowed <pairAddress>\n",
            exitCode: 1,
          };
        }

        let pair: `0x${string}`;
        try {
          pair = getAddress(pairRaw);
        } catch {
          return { stdout: "", stderr: "Error: invalid pair address\n", exitCode: 1 };
        }

        const allowed = await baseClient.readContract({
          address: delegateAddress,
          abi: tradDelegateAbi,
          functionName: "isPairAllowed",
          args: [pair],
        });

        return {
          stdout:
            JSON.stringify(
              { contract: delegateAddress, pair, allowed, timestamp: new Date().toISOString() },
              null,
              2,
            ) + "\n",
          stderr: "",
          exitCode: 0,
        };
      }

      return {
        stdout: "",
        stderr: `Unknown command: delegate ${action}\nRun 'trad help' for usage.\n`,
        exitCode: 1,
      };
    }

    if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
      return { stdout: HELP, stderr: "", exitCode: 0 };
    }

    return {
      stdout: "",
      stderr: `Unknown command: ${subcommand}\nRun 'trad help' for usage.\n`,
      exitCode: 1,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cwd = ctx.cwd;
    return { stdout: "", stderr: `Error: ${msg}\n(cwd: ${cwd})\n`, exitCode: 1 };
  }
});
