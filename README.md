# trad — Cursor for Trading Bots

> **Tell trad how you want to trade. It builds and runs your strategy automatically — no coding, no templates, no subscriptions.**

trad turns plain-English intent into real, deployable trading strategies on [RobinPump.fun](https://robinpump.fun) (Base). Describe what you want in chat, get working TypeScript strategy code + a live visual dashboard, and deploy it to run automatically with strict safety rails. Built solo in 24 hours at the [EasyA x Consensus Hong Kong Hackathon](https://consensus-hongkong.coindesk.com/hackathon/).

**TradDelegate smart contract on Base Mainnet:** [`0x06847d8d174454f36f31f1f6a22206e43032c0cb`](https://basescan.org/address/0x06847d8d174454f36f31f1f6a22206e43032c0cb)

---

## Demo

<!-- TODO: Replace with your Loom / YouTube link -->

**Demo video:** [Watch on Loom](#)

**Repo walkthrough video (with audio):** [Watch on Loom](#)

---

## Screenshots

| Dashboard                                     | Strategy Builder                                            |
| --------------------------------------------- | ----------------------------------------------------------- |
| ![Dashboard](assets/screenshot-dashboard.png) | ![Strategy Builder](assets/screenshot-strategy-builder.png) |

| AI Chat + Live Trades                                 | Strategy Logs                                         |
| ----------------------------------------------------- | ----------------------------------------------------- |
| ![Strategy Chat](assets/screenshot-strategy-chat.png) | ![Strategy Logs](assets/screenshot-strategy-logs.png) |

| Settings                                    |
| ------------------------------------------- |
| ![Settings](assets/screenshot-settings.png) |

---

## The Problem

Millions of financially literate people — teachers, lawyers, office workers — want to automate crypto trading. Their options today:

- **Template-locked bot platforms** that only offer grid bots, DCA, and a handful of presets
- **Expensive subscriptions** that eat into already-thin margins
- **Custom strategies require coding** — exchange APIs, infrastructure, key management, monitoring

The result: regular people can't compete. The strategies they actually want to run? They can't build them.

---

## The Solution

trad is **Cursor for trading bots**. The flow is simple:

```
Describe in plain English  →  Get real strategy code + live dashboard  →  Deploy with safety rails
```

1. **Describe any strategy** in the chat — "buy new coins under $5K market cap, sell at 2% profit"
2. **trad generates working TypeScript code** and a visual WHEN/IF/THEN dashboard you can inspect and tweak
3. **Deploy** and watch it execute live trades on-chain, with full logging, PnL tracking, and risk limits

No templates. No lock-in. No subscription fees. If you can describe it, you can trade it.

---

## How trad Uses the Blockchain

trad runs entirely on **Base** (Ethereum L2) and interacts with on-chain infrastructure in three ways:

### 1. On-Chain Trading via RobinPump Bonding Curves

Every trade is a real on-chain transaction against RobinPump's bonding-curve pair contracts. Strategies call `buy()` and `sell()` directly on the pair contracts using `viem`. Every trade produces a verifiable transaction hash on Base.

### 2. Market Data via RobinPump Subgraph

Strategy logic reads live coin data — prices, volumes, market caps, recent trades — from RobinPump's Goldsky subgraph. This gives strategies fast, reliable inputs without polling the chain directly.

### 3. TradDelegate: Delegation Without Custody

The key innovation is the **TradDelegate** smart contract ([source](contracts/TradDelegate.sol), [deployed](https://basescan.org/address/0x06847d8d174454f36f31f1f6a22206e43032c0cb)):

- Users **deposit ETH** into the contract
- An authorized **operator** (the trad server) executes trades on their behalf
- **Only the user can withdraw** their funds — the operator can never take them
- Pair contracts must be **allowlisted** (by address or runtime codehash) before they can be traded
- Emergency **pause** mechanism (guardian or owner) halts new trades instantly
- Withdrawals work **even when paused** — users always have an exit

This is **delegation without custody**: the server can trade for you, but it can never steal from you.

```
┌─────────────┐       deposit ETH        ┌──────────────────┐
│    User      │ ──────────────────────── │  TradDelegate    │
│  (wallet)    │ ◄── withdraw (anytime) ──│  (smart contract)│
└─────────────┘                           └────────┬─────────┘
                                                   │
                                          executeBuy / executeSell
                                          (operator only, allowlisted pairs)
                                                   │
                                                   ▼
                                          ┌──────────────────┐
                                          │ RobinPump Pair   │
                                          │ (bonding curve)  │
                                          └──────────────────┘
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                      Frontend (React 19 + Tailwind 4)          │
│  Strategy Builder: Chat → Code → Visual Dashboard (json-render)│
│  Dashboard: strategy list, market feed, performance metrics    │
│  Settings: wallet connection, trading balance, risk config     │
├────────────────────────────────────────────────────────────────┤
│                        Bun Server (serve())                    │
│  /api/chat         AI strategy code generation (streaming)     │
│  /api/generate     Dashboard UI spec generation (streaming)    │
│  /api/strategies   CRUD + deploy/stop + performance metrics    │
│  /api/robinpump    Coin data + manual trade endpoints          │
│  /api/settings     Admin-only configuration                    │
├────────────────────────────────────────────────────────────────┤
│  Prisma + SQLite                 │  Base Chain (on-chain)      │
│  Strategy, StrategyRun,          │  RobinPump bonding curves   │
│  StrategyTrade, StrategyPosition │  TradDelegate contract      │
└──────────────────────────────────┴─────────────────────────────┘
```

---

## Features

- **Natural language to strategy code** — describe any trading strategy in plain English, get working TypeScript
- **Not template-locked** — strategies are generated as real code with a constrained API surface, not picked from a dropdown
- **Visual dashboard** — auto-generated WHEN/IF/THEN flow diagram for every strategy
- **Live execution with logging** — deploy strategies on a schedule, see every trade as it happens
- **Performance tracking** — PnL charts, win rate, trade waterfall, detailed stats
- **Risk limits** — configurable max ETH per trade/run/day, max trades per run, slippage bounds
- **Dry-run by default** — production defaults to simulated trading unless explicitly enabled
- **Safe delegation** — TradDelegate smart contract ensures the operator can trade but never withdraw user funds
- **Strategy marketplace** — browse and fork community strategies (early)
- **Open source** — no platform fees, no subscriptions, no vendor lock-in

---

## Strategy API

The runtime injects a constrained `api` object into every strategy. Strategies can only call what's exposed — no raw imports, no `fetch`, no `eval`, no `process`.

```typescript
// Market data
api.robinpump.listCoins({ sort: "newest", limit: 20 });
api.robinpump.getPrice(pairAddress);
api.robinpump.getMarketCap(pairAddress);

// Trading
api.robinpump.buy(pairAddress, ethAmount);
api.robinpump.sell(pairAddress, tokenAmount);

// Portfolio
api.robinpump.getBalance(tokenAddress);
api.robinpump.getEthBalance();
api.robinpump.getEthUsdPrice();

// Scheduling & utilities
api.schedule("30s" | "5m" | "1h" | "cron:..." | "once");
api.log("message");
api.now();
api.utcTime();
api.isDryRun();
```

---

## Safety & Execution Model

| Layer                   | Protection                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Code validation**     | Strategy code is checked for unsafe features: imports, `process`, `eval`, `Function`, direct `fetch`, etc. |
| **Sandboxed execution** | TypeScript is transpiled then executed via `new Function(...)` with only the `StrategyAPI` in scope        |
| **Risk limits**         | Max ETH per trade, per run, per day. Max trades per run. All env-configurable.                             |
| **Slippage bounds**     | `minTokensOut` / `minEthOut` enforced on every on-chain trade                                              |
| **Dry-run default**     | Production defaults to simulated trading unless `TRAD_ALLOW_LIVE_TRADING=true`                             |
| **Delegation**          | TradDelegate contract: operator trades, only user withdraws. Pair allowlisting. Emergency pause.           |

---

## Tech Stack

| Component           | Technology                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Runtime             | [Bun](https://bun.sh)                                                                        |
| Frontend            | [React 19](https://react.dev) + [Tailwind CSS 4](https://tailwindcss.com)                    |
| UI Components       | [Radix UI](https://radix-ui.com) + [shadcn/ui](https://ui.shadcn.com)                        |
| AI                  | [Vercel AI SDK](https://sdk.vercel.ai) + [Anthropic Claude](https://anthropic.com)           |
| Database            | [Prisma](https://prisma.io) + SQLite (via [libSQL](https://github.com/tursodatabase/libsql)) |
| Blockchain          | [viem](https://viem.sh) + [wagmi](https://wagmi.sh) (Base chain)                             |
| Smart Contracts     | Solidity 0.8.20 + [Foundry](https://book.getfoundry.sh)                                      |
| Charts              | [Recharts](https://recharts.org)                                                             |
| Dashboard Rendering | [json-render](https://github.com/nicholasgriffintn/json-render)                              |
| Markdown (AI chat)  | [Streamdown](https://github.com/nicholasgriffintn/streamdown)                                |

---

## Project Structure

```
trad/
├── contracts/
│   ├── TradDelegate.sol        # Delegation smart contract (deployed on Base mainnet)
│   ├── test/TradDelegate.t.sol # Foundry tests
│   ├── abi.ts                  # Contract ABI
│   ├── deploy.ts               # Deployment script
│   └── smoke.ts                # Smoke test
├── prisma/
│   └── schema.prisma           # Database schema (Strategy, Run, Trade, Position)
├── src/
│   ├── index.ts                # Bun server entry point
│   ├── index.html              # SPA entry HTML
│   ├── frontend.tsx            # React entry (hydration)
│   ├── App.tsx                 # Client-side router + providers
│   ├── routes/
│   │   ├── chat.ts             # AI strategy generation (streaming)
│   │   ├── generate.ts         # Dashboard UI spec generation (streaming)
│   │   ├── strategies.ts       # Strategy CRUD + deploy/stop
│   │   ├── robinpump.ts        # Market data + trade endpoints
│   │   ├── settings.ts         # Admin settings
│   │   ├── contract.ts         # TradDelegate contract interactions
│   │   └── marketplace.ts      # Strategy marketplace
│   ├── lib/
│   │   ├── runtime.ts          # Strategy execution engine
│   │   ├── sandbox.ts          # Code validation + sandboxing
│   │   ├── risk.ts             # Risk limit enforcement
│   │   ├── api-types.d.ts      # StrategyAPI type definitions
│   │   ├── api.ts              # Client-side API helpers
│   │   ├── catalog.ts          # json-render component catalog
│   │   ├── wallet.tsx          # wagmi wallet config
│   │   └── trad-cli.ts         # TradDelegate client
│   ├── pages/
│   │   ├── dashboard/          # Main dashboard (strategies, market feed)
│   │   ├── strategy-builder/   # Strategy creation + AI chat + code/visual/perf tabs
│   │   ├── marketplace/        # Browse community strategies
│   │   └── settings/           # Wallet, trading balance, config
│   └── components/
│       ├── Layout.tsx           # App shell + navigation
│       ├── StrategyPerformance.tsx  # PnL charts + trade stats
│       └── ui/                 # shadcn/ui components
├── robinpump.ts                # RobinPump client library (subgraph + on-chain)
└── build.ts                    # Production build script
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.2+)

### Install & Run

```bash
git clone https://github.com/lithdew/trad.git
cd trad
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000) and use the **Strategy Builder** to create and deploy a strategy.

### Production

```bash
bun start
```

### Typecheck

```bash
bun run lint
```

---

## Environment Variables

### Required for public deployments

| Variable           | Description                                   |
| ------------------ | --------------------------------------------- |
| `TRAD_ADMIN_TOKEN` | Protects admin routes (settings, deploy/stop) |

### Common

| Variable                  | Description                      | Default                    |
| ------------------------- | -------------------------------- | -------------------------- |
| `NODE_ENV`                | `production` for production mode | —                          |
| `DRY_RUN`                 | `true` to simulate trades        | `true` in production       |
| `TRAD_ALLOW_LIVE_TRADING` | `true` to enable real trades     | `false`                    |
| `BASE_RPC_URL`            | Base chain RPC endpoint          | `https://mainnet.base.org` |

### Delegate mode (recommended)

| Variable                | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `TRAD_DELEGATE_ADDRESS` | Deployed TradDelegate contract address             |
| `OPERATOR_PRIVATE_KEY`  | Operator wallet private key (for executing trades) |

### Risk limits

| Variable                    | Description                                | Default      |
| --------------------------- | ------------------------------------------ | ------------ |
| `TRAD_MAX_ETH_PER_TRADE`    | Max ETH per single trade                   | —            |
| `TRAD_MAX_ETH_PER_RUN`      | Max ETH per strategy run                   | —            |
| `TRAD_MAX_ETH_PER_DAY`      | Max ETH per day                            | —            |
| `TRAD_MAX_TRADES_PER_RUN`   | Max trades per run                         | —            |
| `TRAD_DEFAULT_SLIPPAGE_BPS` | Default slippage tolerance in basis points | `1000` (10%) |

---

## Roadmap

- **Strategy marketplace** — share, browse, and fork community strategies
- **Backtesting** — test strategies against historical data before deploying
- **Richer analytics** — deeper performance metrics, drawdown analysis, risk scoring
- **More venues** — expand beyond RobinPump to other DEXs and chains
- **Simpler UI** — hide the code entirely for non-technical users; pure natural language interface
- **Mobile support** — responsive design for monitoring strategies on the go

---

## Built By

**Kenta Iwasaki** — solo, in 24 hours

- Founding Engineer @ [Superpower](https://superpower.com) (building an AI doctor)
- [Thiel Fellow](https://thielfellowship.org)
- ex-CTO, Perlin (Layer 1 blockchain)
- ex-Head of AI, NAVER

---

## License

Open source. This project was built at the EasyA x Consensus Hong Kong Hackathon (Feb 2025) and is required to remain open source per hackathon rules.
