# EasyA Consensus HK — Submission (Google Form)

This file mirrors the Google Form fields and contains **copy/paste-ready** answers where possible.

**Important**

- **Do not commit personal data** (emails, Twitter handles, LinkedIn URLs) if you don't want them public. Those fields are marked `PRIVATE`.
- Do **not** paste secrets (private keys, admin tokens). Never include `.env` files in the submission.

---

## Email (PRIVATE)

- Your email: `TODO`

---

## Project name

**trad**

---

## Emails of all team members (including yours) (PRIVATE)

Separate emails using spaces:

`TODO`

---

## Link to your team's tweet announcing your project (PRIVATE)

`TODO`

**Copy-paste tweet:**

> Built trad at @EasyA_App x Consensus HK — Cursor for trading bots.
>
> Describe any strategy in plain English. trad writes the code, builds a live dashboard, and runs it on-chain. No templates. No subscriptions.
>
> 100+ real trades in minutes, built solo in 24 hours on Base.
>
> Repo: TODO
> Demo: TODO
>
> #EasyA #ConsensusHK #Base #DeFi

---

## Twitter handles of all team members (including yours) (PRIVATE)

`TODO`

---

## Link to your LinkedIn post (PRIVATE)

`TODO`

**Copy-paste LinkedIn post:**

> I just shipped trad at the EasyA x Consensus Hackathon in Hong Kong — built solo in 24 hours.
>
> The problem: millions of financially literate people (teachers, lawyers, office workers) want to automate crypto trading. But their options are terrible. Bot platforms lock you into the same 3 strategies everyone else uses. Custom strategies require coding. And everything costs a subscription fee.
>
> trad changes that. It's "Cursor for trading bots." You describe any trading strategy in plain English — and trad generates working TypeScript code, a live visual dashboard, and a deployable bot. No templates. No lock-in. No subscription fees. If you can describe it, you can trade it.
>
> The key innovation is the TradDelegate smart contract on Base: users deposit ETH into the contract, a server operator executes trades on their behalf, but only the user can ever withdraw their funds. Delegation without custody.
>
> In my first test session, I ran over 100 real on-chain trades in just a few minutes. Every trade is a real transaction on the Base blockchain, verifiable by anyone.
>
> Built with: Bun, React 19, Tailwind 4, Vercel AI SDK (Anthropic Claude), viem, Prisma, Solidity (Foundry), and the RobinPump subgraph.
>
> The code is fully open source: TODO
> Demo: TODO
>
> What's next: strategy marketplace for sharing/forking strategies, backtesting, more trading venues, and a simpler UI that hides the code entirely for non-technical users.
>
> #DeFi #Web3 #TradingBots #AI #Base #Hackathon #EasyA #ConsensusHK

---

## Rate the EasyA app 5 stars + write an awesome review

- Confirmed: `TODO (Yes once done)`

---

## Short description (<=150 characters)

Tell trad how you want to trade. It builds and runs your strategy automatically -- no coding, no templates, no subscriptions.

---

## College / Employer (PRIVATE-ish)

Superpower (Founding Engineer)

---

## Full description

trad is "Cursor for Trading Bots" — an AI-powered platform that lets anyone describe a trading strategy in plain English and get a fully working, deployable strategy running live on RobinPump.fun (Base), with no coding, no templates, and no subscription fees.

**The problem:** Millions of financially literate people — teachers, lawyers, office workers — want to automate crypto trading. But their options are terrible. "Bot platforms" lock you into the same three strategies everyone else uses (grid bots, DCA, trailing stops). Custom strategies require coding against complex exchange APIs. And everything charges a recurring subscription that eats into already-thin margins. The result: regular people can't compete, and the strategies they actually want to run, they can't build.

**What trad does:** A user opens trad, describes any strategy they want in natural language — "buy newly launched coins under $5K market cap and sell at 2% profit" — and trad generates:

- **Real TypeScript strategy code** (not a template — the exact code that executes, fully inspectable)
- **A live visual dashboard** showing the strategy's WHEN/IF/THEN logic and tunable parameters
- **A deployable, scheduled bot** that runs on-chain with full trade logging, PnL tracking, and performance analytics

Strategies aren't picked from a dropdown — they're generated as real code against a constrained API surface, so users can express genuinely novel ideas and iterate on them through conversation. The AI sees the full StrategyAPI type definitions, live market data, and the user's existing strategies, so it writes code that actually compiles and runs.

**Safety is built in at every layer.** User funds live in the TradDelegate smart contract on Base, where an authorized operator can execute trades on their behalf but can never withdraw their money — delegation without custody. The runtime enforces risk limits (max ETH per trade, per run, per day), applies slippage bounds on every on-chain trade, defaults to dry-run/simulated mode in production, and sandboxes strategy code so it can't access the network, filesystem, or runtime internals.

This build targets RobinPump.fun on Base — a fair-launch token launchpad where new coins trade on bonding curves. trad helps traders act faster on new launches by turning intent into automated execution, with guardrails that prevent catastrophic losses. In testing, a single strategy executed over 100 real on-chain trades in just a few minutes. Every trade is a verifiable transaction on the Base blockchain.

---

## Technical explanation

trad is a full-stack Bun + React 19 application with deep on-chain integration on **Base** (Ethereum L2). It uses DeFi primitives for trading execution, market data, and custodial delegation.

**1. On-chain trading via RobinPump bonding curves**

Every trade is a real on-chain transaction against RobinPump's bonding-curve pair contracts. The runtime calls `IRobinPumpPair.buy()` and `IRobinPumpPair.sell()` directly using `viem`, with slippage protection enforced via `minTokensOut` / `minEthOut` parameters calculated from the pair's constant-product reserves. This means strategies interact with open, permissionless on-chain liquidity — not a centralized order book or mock environment. Trades produce verifiable transaction hashes on Base with sub-cent gas costs.

**2. TradDelegate smart contract: delegation without custody (the key DeFi innovation)**

The biggest technical challenge in automated trading is the custody problem: how do you let a server trade on behalf of a user without giving it the ability to steal funds? trad solves this with the **TradDelegate** contract ([deployed on Base mainnet](https://basescan.org/address/0x06847d8d174454f36f31f1f6a22206e43032c0cb), Solidity 0.8.20 + Foundry):

- Users **deposit ETH** into the contract via `deposit()`
- An authorized **operator** (the trad server) executes `executeBuy()` and `executeSell()` on their behalf, routing trades to RobinPump pair contracts
- **Only the depositor can withdraw** — `withdraw()`, `withdrawAll()`, and `withdrawTokens()` are caller-restricted. The operator has zero withdrawal capability
- Pair contracts must be **allowlisted** (by address or by runtime `EXTCODEHASH`) before the operator can trade against them — preventing the operator from routing funds to malicious contracts
- An emergency **pause** mechanism (guardian or owner) halts new trades and deposits instantly, but **withdrawals always work**, even when paused — users always have an exit
- Reentrancy protection via a status guard on all state-changing functions
- Platform fees are taken in basis points (max 10%, configurable by owner) and sent to a separate fee receiver — fee extraction is transparent and on-chain

This design is uniquely enabled by smart contracts: the access control rules (operator can trade, only user can withdraw, pair allowlisting, emergency pause) are enforced by immutable on-chain code, not by trusting a server. No centralized backend could provide equivalent guarantees.

**3. Market data via RobinPump Goldsky subgraph**

Strategy logic reads live coin data — prices, volumes, market caps, trade counts, graduation status — from RobinPump's Goldsky subgraph via GraphQL. This gives strategies fast, reliable inputs without polling the chain directly, and enables the AI to query real market conditions when generating strategy code.

**4. Sandboxed strategy execution engine**

User-written strategy code is transpiled from TypeScript (via Bun's built-in transpiler), validated against a blocklist of unsafe patterns (no imports, no `eval`, no `fetch`, no `process`, no `globalThis`), and executed via `new Function()` with only a constrained `StrategyAPI` object in scope. The API exposes exactly: RobinPump market data reads, buy/sell execution, scheduling, logging, and time utilities — nothing else. Risk limits (max ETH per trade/run/day, max trades per run) are enforced server-side in the runtime, not in the user's code, so they cannot be bypassed.

**5. AI code generation with full context**

Two streaming AI routes (Anthropic Claude via Vercel AI SDK) power the UX: one generates strategy code from conversation, and one generates a visual dashboard spec. The strategy AI operates in a sandboxed environment with tool use — it can read the full `StrategyAPI` type definitions, query live market data, inspect existing strategies and their performance, and lint its own code before outputting it. This means the AI doesn't hallucinate API methods — it writes code that actually compiles and runs.

**Why blockchain makes this uniquely possible:**

- **Verifiability**: every trade is an on-chain transaction with a hash anyone can audit — there's no "trust me, the trade happened"
- **Permissionless liquidity**: strategies trade against open bonding curves, not a platform-controlled order book
- **Programmable custody**: the TradDelegate contract enforces delegation rules (operator trades, only user withdraws) in immutable code — this custody model is impossible to replicate with a traditional backend, where the server always has the database password
- **Composability**: the contract interacts directly with RobinPump's pair interface (`buy`/`sell`/`token`), ERC-20 token standards, and could be extended to any DeFi protocol with the same pattern

**Stack:** Bun, React 19, Tailwind CSS 4, Radix UI + shadcn/ui, Vercel AI SDK (Anthropic Claude), Prisma + SQLite, viem + wagmi (Base), Solidity 0.8.20 + Foundry, Recharts, json-render, Streamdown.

---

## URL to your demo site

`TODO (e.g., https://...)`

---

## Link to slides (Canva)

`TODO (public Canva link)`

---

## GitHub repo

`TODO (repo URL)`

---

## Confirmations

- Work is original and satisfies judging criteria: Yes
- Submission requirements satisfied: Yes! 100%
