# trad — Cursor for Trading Bots

> **One-liner:** A no-code AI-powered trading bot builder where anyone can describe a strategy in plain English, see it visualized in real-time, and deploy it against Binance or RobinPump.

## The Problem

Creating automated trading strategies today requires:

1. **Programming knowledge** — writing code in Python/JS to interact with exchange APIs
2. **Understanding exchange APIs** — authentication, rate limits, order types, error handling
3. **Infrastructure** — running a server 24/7, handling crashes, scheduling jobs
4. **Existing platforms add fees** — CEXs like Binance charge extra on top of their normal fees for their built-in bot features, and they're not customizable

Most crypto traders have ideas like _"buy Bitcoin when it dips below $60k"_ or _"sell ETH when it hits $4k"_ but can't express them as code. They're stuck using expensive pre-built bots or missing opportunities entirely.

## The Solution

**trad** is Cursor, but for trading bots. Users describe their strategy in a chat interface, and the AI:

1. Generates a visual strategy breakdown (WHEN → IF → THEN)
2. Generates the underlying JavaScript code
3. Lets users iterate via conversation
4. Deploys and runs the strategy automatically

Users never need to see code (but can toggle it on if they want).

## Supported Exchanges

| Exchange      | Type                  | Chain | Integration                            |
| ------------- | --------------------- | ----- | -------------------------------------- |
| **Binance**   | Centralized (CEX)     | N/A   | REST API via API key + secret          |
| **RobinPump** | Token launchpad (DEX) | Base  | On-chain via wallet private key + viem |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                   │
│  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │  Chat Panel   │  │   Strategy Preview Panel     │  │
│  │  (Composer)   │  │   ┌─ Visual (WHEN/IF/THEN)  │  │
│  │              │  │   └─ Code   (strategy.js)    │  │
│  └──────────────┘  └──────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│                  Bun.serve() Server                   │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ /api/chat  │ │/api/strats │ │ /api/settings    │  │
│  │ (AI SDK)   │ │ (CRUD)     │ │ (secrets CRUD)   │  │
│  └─────┬──────┘ └─────┬──────┘ └────────┬─────────┘  │
│        │              │                 │             │
│  ┌─────▼──────────────▼─────────────────▼─────────┐  │
│  │              Prisma + SQLite                    │  │
│  │  ExchangeSecret | Strategy (code, config, etc) │  │
│  └────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│                  Strategy Runtime                     │
│  ┌─────────────────────────────────────────────────┐  │
│  │  eval(strategy.code)  →  api.buy() / api.sell() │  │
│  │  Scheduler: api.scheduleNext('1h')              │  │
│  └─────────────────────────────────────────────────┘  │
│                      │                                │
│         ┌────────────┼────────────┐                   │
│         ▼            ▼            ▼                   │
│    ┌─────────┐ ┌───────────┐                          │
│    │ Binance │ │ RobinPump │                          │
│    │ REST API│ │ Base chain│                          │
│    └─────────┘ └───────────┘                          │
└─────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer    | Tech                                      |
| -------- | ----------------------------------------- |
| Runtime  | Bun                                       |
| Server   | Bun.serve() (fullstack, no Express)       |
| Frontend | React 19 + TailwindCSS 4                  |
| Database | Prisma 7 + SQLite (bun:sqlite via libsql) |
| AI       | Vercel AI SDK v6 + Anthropic Claude       |
| Chain    | viem (for Base/RobinPump integration)     |
| Bundler  | Bun HTML imports (built-in, no Vite)      |

## Pages

### 1. Dashboard (`/`)

- Grid of existing strategies with status badges (Active / Paused / Draft / Error)
- Stats: active bots, total strategies, connected exchanges
- Quick-create CTA

### 2. Strategy Builder (`/strategy` or `/strategy/:id`)

- **Left panel:** Chat composer (describe strategy in plain English)
- **Right panel:** Live preview with two modes:
  - **Visual:** WHEN → IF → THEN flow blocks (non-coder friendly)
  - **Code:** Syntax-highlighted JavaScript with line numbers
- Action buttons: Save Draft, Deploy
- Exchange badge showing target platform

### 3. Settings (`/settings`)

- Exchange connection cards (Binance, RobinPump)
- Secret input fields with show/hide toggles
- Connection status indicators
- All persisted to SQLite via Prisma

## Strategy Runtime Design

Strategies are single JavaScript files with a `main(api)` entrypoint. The `api` object is injected by trad and provides:

```typescript
interface StrategyAPI {
  // ── Market Data ──────────────────────────
  getPrice(pair: string): Promise<number>;
  getBalance(asset: string): Promise<number>;

  // ── Trading ──────────────────────────────
  buy(opts: {
    pair: string;
    amount: number;
    type: "market" | "limit";
    price?: number;
  }): Promise<Order>;
  sell(opts: {
    pair: string;
    amount: number;
    type: "market" | "limit";
    price?: number;
  }): Promise<Order>;

  // ── RobinPump-specific ───────────────────
  robinpump: {
    listCoins(opts?: { sort: "newest" | "marketCap"; limit?: number }): Promise<Coin[]>;
    getPrice(tokenAddress: string): Promise<number>;
    getMarketCap(tokenAddress: string): Promise<number>;
    buy(tokenAddress: string, ethAmount: number): Promise<TxReceipt>;
    sell(tokenAddress: string, tokenAmount: number): Promise<TxReceipt>;
    getBalance(tokenAddress: string): Promise<number>;
  };

  // ── Scheduling ───────────────────────────
  scheduleNext(interval: string): void; // '1m', '5m', '1h', '1d'

  // ── Logging ──────────────────────────────
  log(message: string): void;
}
```

### Execution Model

```
1. User creates strategy via chat
2. LLM generates strategy.js code
3. User clicks "Deploy"
4. Server:
   a. Saves code to Strategy.code in SQLite
   b. Sets status = "active"
   c. eval()s the code with the api object injected
   d. When api.scheduleNext() is called, schedules next run
   e. Repeats until paused/stopped
```

For the hackathon, `eval()` is acceptable. Post-hackathon, strategies would run in isolated workers/sandboxes.

## RobinPump Hackathon Strategy

The RobinPump hackathon track rewards **highest trading volume**. Key insight: volume matters more than P&L for the prize.

### Winning strategies to suggest to users:

1. **DCA Bot** — Buy small amounts of a coin every N minutes (generates consistent volume)
2. **Market Maker** — Buy and sell the same coin in small increments (maximizes volume)
3. **New Coin Sniper** — Auto-buy every new coin launch, sell after small gain (high frequency)
4. **Spread Trader** — Buy at curve price, sell slightly higher (many small trades)

### Integration via viem:

```typescript
import { createWalletClient, http, publicActions } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(userPrivateKey);
const client = createWalletClient({
  account,
  chain: base,
  transport: http(rpcUrl),
}).extend(publicActions);

// Buy on bonding curve
const tx = await client.writeContract({
  address: ROBINPUMP_CONTRACT,
  abi: BONDING_CURVE_ABI,
  functionName: "buy",
  args: [tokenAddress],
  value: parseEther("0.001"),
});
```

## Implementation Roadmap (Hackathon)

### Phase 1: Done

- [x] UI: Dashboard, Strategy Builder (chat + visual/code preview), Settings
- [x] Prisma schema + SQLite persistence for secrets and strategies
- [x] Settings page with working Binance + RobinPump persistence
- [x] Server API: full CRUD for settings and strategies
- [x] Client-side routing
- [x] Beautiful Obsidian Gold design system

### Phase 2: AI Chat (next)

- [ ] Wire up Vercel AI SDK v6 with `useChat()` on the frontend
- [ ] System prompt that instructs Claude to generate strategy code + visual config
- [ ] Stream AI responses into the chat panel
- [ ] Parse AI output to update the visual preview in real-time
- [ ] Save generated code to Strategy.code

### Phase 3: Strategy Execution

- [ ] Build the `api` object that strategies call
- [ ] Implement Binance REST API wrapper (`api.buy()`, `api.sell()`, `api.getPrice()`)
- [ ] Implement RobinPump on-chain wrapper using viem (`api.robinpump.*`)
- [ ] `eval()` strategy code with injected api
- [ ] `api.scheduleNext()` implementation using `setTimeout` / Bun timers
- [ ] Strategy status management (active → running, error handling, pause/resume)

### Phase 4: Polish

- [ ] Strategy logs/history view
- [ ] Error display in the UI when a strategy fails
- [ ] Dashboard stats that reflect real data (active bots, trade count)
- [ ] Loading states and skeleton screens
- [ ] Demo with a live RobinPump strategy generating volume

## Example User Flows

### Flow 1: "I want to buy new RobinPump coins"

```
User: "Buy every new coin on RobinPump that launches, spend 0.001 ETH each time"

AI generates:
  Visual: WHEN new coin launches → IF market cap < $3k → THEN buy 0.001 ETH worth
  Code:   async function main(api) {
            const coins = await api.robinpump.listCoins({ sort: 'newest' });
            for (const coin of coins) {
              if (coin.marketCap < 3000 && !coin.alreadyBought) {
                await api.robinpump.buy(coin.address, 0.001);
              }
            }
            api.scheduleNext('1m');
          }

User: "Also sell if any of my holdings go above 2x"

AI updates strategy to include sell logic.
```

### Flow 2: "DCA into Bitcoin on Binance"

```
User: "Buy $25 of Bitcoin every day at market price"

AI generates:
  Visual: WHEN every 24 hours → THEN market-buy $25 of BTC/USDT
  Code:   async function main(api) {
            await api.buy({ pair: 'BTC/USDT', amount: 25, type: 'market' });
            api.scheduleNext('24h');
          }
```

## Project Structure

```
trad/
├── prisma/
│   └── schema.prisma          # ExchangeSecret + Strategy models
├── generated/prisma/           # Auto-generated Prisma client
├── src/
│   ├── index.html              # HTML entrypoint (Bun HTML import)
│   ├── index.ts                # Bun.serve() — API routes + SPA serving
│   ├── index.css               # TailwindCSS 4 theme + animations
│   ├── frontend.tsx            # React mount
│   ├── db.ts                   # Prisma client (libsql adapter)
│   ├── App.tsx                 # Router + page switching
│   ├── components/
│   │   └── Layout.tsx          # Sidebar navigation
│   └── pages/
│       ├── Dashboard.tsx       # Strategy grid + stats
│       ├── StrategyBuilder.tsx # Chat + visual/code preview
│       └── Settings.tsx        # Exchange secret management
├── TRAD.md                     # This file
├── ROBINPUMP.md                # RobinPump integration analysis
├── CLAUDE.md                   # Bun-specific coding rules
└── package.json
```

## Design System: "Obsidian Gold"

- **Background:** Deep black (#08080a) with subtle noise texture
- **Surfaces:** Layered dark grays (#0e0e11, #151518, #1c1c20)
- **Accent:** Warm amber-gold (#e5a00d) — evokes wealth and premium trading
- **Success:** Emerald green for RobinPump + positive states
- **Typography:** Syne (display) + Manrope (body) + JetBrains Mono (code)
- **Motion:** Staggered fade-in animations, smooth transitions, pulse effects
- **Details:** Dot grid patterns, glass morphism, gold glow on hover
