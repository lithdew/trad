# trad — Cursor for Trading Bots

**trad** turns plain-English intent into **real, deployable trading strategies** for **RobinPump.fun on Base** — without forcing users into template bots.

- **Describe a strategy** in chat (non-technical friendly)
- **Get working TypeScript strategy code** + a live dashboard (WHEN → IF → THEN)
- **Deploy** and run on a schedule with strict risk limits
- **Dry-run by default** in production unless live trading is explicitly enabled

---

## What’s in this repo

- **Frontend**: React 19 + Tailwind 4 (`src/pages/*`)
- **Server**: Bun `serve()` routes (`src/routes/*`)
- **DB**: Prisma + SQLite (`prisma/schema.prisma`)
- **Runtime**: Executes strategies safely with a constrained `StrategyAPI` (`src/lib/runtime.ts`)
- **RobinPump integration**: on-chain reads + trades + subgraph market data (`robinpump.ts`)
- **Optional safety rail**: `TradDelegate` contract (funds delegated; operator can’t withdraw user funds)

---

## Architecture (high level)

```
┌──────────────────────────────────────────────────────────┐
│                      Frontend (React)                    │
│  Strategy Builder: Chat → Code → Dashboard (json-render)  │
├──────────────────────────────────────────────────────────┤
│                        Bun Server                        │
│  /api/chat     (strategy code-gen, streamed)             │
│  /api/generate  (dashboard UI spec-gen, streamed)        │
│  /api/strategies (CRUD + deploy/stop + perf)             │
│  /api/settings  (admin-only settings)                    │
│  /api/robinpump  (coin data + manual trade endpoint)     │
├──────────────────────────────────────────────────────────┤
│                       Prisma + SQLite                    │
│  Strategy, StrategyRun, StrategyTrade, StrategyPosition  │
└──────────────────────────────────────────────────────────┘
```

---

## Strategy API (what user code can call)

The runtime injects a single object named `api` into `async function main(api)`.

See `src/lib/api-types.d.ts` for the source-of-truth typings.

Core capabilities:

- `api.robinpump.*` market data + trading:
  - `listCoins({ sort, limit })`
  - `getPrice(pairAddress)`
  - `getMarketCap(pairAddress)`
  - `buy(pairAddress, ethAmount)`
  - `sell(pairAddress, tokenAmount)`
  - `getBalance(tokenAddress)`
  - `getEthBalance()`
  - `getEthUsdPrice()`
- `api.schedule("30s" | "5m" | "1h" | "cron:..." | "once" | "2026-02-11T12:34:56.000Z")`
- `api.log("...")`, `api.now()`, `api.utcTime()`, `api.isDryRun()`

---

## Safety & execution model

- **Validation**: strategy code is checked for unsafe features (imports, `process`, `eval`, `Function`, direct `fetch`, etc.)
- **Execution**: TypeScript is transpiled (type-stripped) then executed via `new Function(...)` with a narrow `StrategyAPI`
- **Risk limits**: max ETH per trade/run/day + max trades per run (env-configurable)
- **Dry-run**: production defaults to dry-run unless explicitly allowed
- **Trading modes**:
  - **Delegate (recommended)**: if `TRAD_DELEGATE_ADDRESS` + `OPERATOR_PRIVATE_KEY` are set and a user wallet address is configured
  - **Direct (legacy/admin-only)**: server trades using a private key stored in DB (not recommended for public deploys)

---

## Environment variables

Required for public deploys:

- `TRAD_ADMIN_TOKEN`: protects admin routes (settings, deploy/stop, etc.)

Common:

- `NODE_ENV=production`
- `DRY_RUN=true|false`
- `TRAD_ALLOW_LIVE_TRADING=true` (required to disable dry-run)
- `BASE_RPC_URL` (default `https://mainnet.base.org`)

Delegate mode (recommended for users):

- `TRAD_DELEGATE_ADDRESS=0x...`
- `OPERATOR_PRIVATE_KEY=0x...`

Risk limits:

- `TRAD_MAX_ETH_PER_TRADE`
- `TRAD_MAX_ETH_PER_RUN`
- `TRAD_MAX_ETH_PER_DAY`
- `TRAD_MAX_TRADES_PER_RUN`
- `TRAD_DEFAULT_SLIPPAGE_BPS` (default: 1000 = 10%)

---

## Development

```bash
bun install
bun dev
```

Typecheck:

```bash
bun run lint
```
