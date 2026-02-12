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

**trad is a "Cursor for Trading Bots" for non-technical users.** People have always wanted to automate bets and investments in the crypto market, but today they're forced into:

- Template-locked "bot platforms" (e.g., only grid bots / a few preset strategies)
- High recurring platform fees
- Complex exchange APIs and infrastructure

trad removes those constraints. A user describes a strategy in plain English, and trad generates:

- **Working TypeScript strategy code** (the exact code that runs)
- A **visual dashboard** (WHEN -> IF -> THEN flow + parameters you can tweak)
- A **deployable bot** that runs on a schedule and logs its actions

This build is focused on **RobinPump.fun on Base**. It helps traders act faster on new launches by turning intent into an automated strategy with safety rails (risk limits, dry-run by default, slippage bounds, and a constrained strategy API surface) -- without forcing users into a limited set of strategy templates.

---

## Technical explanation

trad is a full-stack Bun + React app with an on-chain execution path on **Base**:

- **On-chain integration (DeFi)**:
  - Executes RobinPump trades against bonding-curve pair contracts using `viem`
  - Fetches coin market data (prices/volume/trades) via the RobinPump subgraph (fast UI + strategy logic inputs)

- **Safety + wallet model**:
  - **TradDelegate** smart contract lets users deposit ETH; a server operator executes trades **without withdrawal rights**
  - Risk limits enforced server-side (max ETH/trade, max ETH/run/day, max trades/run)
  - Dry-run defaults for production unless live trading is explicitly enabled
  - Slippage bounds applied via `minTokensOut` / `minEthOut` when trading

- **AI + UX**:
  - Two streaming AI routes:
    - Strategy code generation (chat -> TypeScript strategy)
    - Dashboard UI generation (chat -> json-render spec)
  - Strategies are persisted in SQLite (Prisma) and executed by a runtime with a constrained `StrategyAPI`

**Not template-locked:** strategies are generated as real code (with a constrained API surface), so users aren't confined to a handful of preset bots -- they can express new ideas and iterate quickly.

**Fee model (practical):** the app is open-source and doesn't require a centralized "bot platform" subscription. Execution costs are the underlying venue's fees + Base gas (and an optional delegate fee if configured).

**Why blockchain is uniquely useful here:** execution is verifiable (tx hashes), the strategy interacts with open on-chain liquidity, and delegated-contract custody enables safer automation without handing the server full withdrawal power.

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
