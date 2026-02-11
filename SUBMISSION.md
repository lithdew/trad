# EasyA Consensus HK — Submission (Google Form)

This file mirrors the Google Form fields and contains **copy/paste-ready** answers where possible.

**Important**
- **Do not commit personal data** (emails, Twitter handles, LinkedIn URLs) if you don’t want them public. Those fields are marked `PRIVATE`.
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

## Link to your team’s tweet announcing your project (PRIVATE)

`TODO`

---

## Twitter handles of all team members (including yours) (PRIVATE)

`TODO`

---

## Link to your LinkedIn post (PRIVATE)

`TODO`

---

## Rate the EasyA app 5 stars + write an awesome review

- ✅ Confirmed: `TODO (Yes once done)`

---

## Short description (≤150 characters)

Pick one (all are under 150 chars):

1) **Primary**  
“Gives non‑technical traders plain‑English crypto automation—any strategy, low fees, and safe on‑chain execution via delegation.”

2) **More direct**  
“Offers plain‑English → deployable RobinPump bots with arbitrary strategies, dry‑run by default, and safe on‑chain execution.”

3) **DeFi angle**  
“Gives RobinPump traders AI-built bots for any strategy—execution on-chain with delegation, risk limits, slippage bounds, and monitoring UI.”

---

## College / Employer (PRIVATE-ish)

`TODO (e.g., University / Company)`

---

## Full description

**trad is a “Cursor for Trading Bots” for non‑technical users.** People have always wanted to automate bets and investments in the crypto market, but today they’re forced into:

- Template-locked “bot platforms” (e.g., only grid bots / a few preset strategies)
- High recurring platform fees
- Complex exchange APIs and infrastructure

trad removes those constraints. A user describes a strategy in plain English, and trad generates:

- **Working TypeScript strategy code** (the exact code that runs)
- A **visual dashboard** (WHEN → IF → THEN flow + parameters you can tweak)
- A **deployable bot** that runs on a schedule and logs its actions

This build is focused on **RobinPump.fun on Base**. It helps traders act faster on new launches by turning intent into an automated strategy with safety rails (risk limits, dry-run by default, slippage bounds, and a constrained strategy API surface) — without forcing users into a limited set of strategy templates.

---

## Technical explanation

trad is a full‑stack Bun + React app with an on‑chain execution path on **Base**:

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
    - Strategy code generation (chat → TypeScript strategy)
    - Dashboard UI generation (chat → json-render spec)
  - Strategies are persisted in SQLite (Prisma) and executed by a runtime with a constrained `StrategyAPI`

**Not template-locked:** strategies are generated as real code (with a constrained API surface), so users aren’t confined to a handful of preset bots — they can express new ideas and iterate quickly.

**Fee model (practical):** the app is open-source and doesn’t require a centralized “bot platform” subscription. Execution costs are the underlying venue’s fees + Base gas (and an optional delegate fee if configured).

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

- Work is original and satisfies judging criteria: ✅ `Yes`
- Submission requirements satisfied: ✅ `Yes! 100%`

