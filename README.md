# trad

**trad** is a “Cursor for Trading Bots” aimed at non-technical users: describe a strategy in plain English, get working strategy code + a live dashboard, then deploy it to run automatically — **without being locked into template bots or expensive platform subscriptions**.

This codebase currently targets **RobinPump.fun on Base**.

---

## Quickstart

```bash
bun install
bun dev
```

Open the app, then use **Strategy Builder** to create and deploy a strategy.

---

## Environment variables (minimum)

For any public deployment:

- `TRAD_ADMIN_TOKEN` (required in production; protects admin routes)

Common:

- `NODE_ENV=production`
- `DRY_RUN=true` (recommended default)
- `TRAD_ALLOW_LIVE_TRADING=true` (required to disable dry-run)
- `BASE_RPC_URL` (defaults to `https://mainnet.base.org`)

Delegate mode (recommended):

- `TRAD_DELEGATE_ADDRESS=0x...`
- `OPERATOR_PRIVATE_KEY=0x...`

Risk limits:

- `TRAD_MAX_ETH_PER_TRADE`
- `TRAD_MAX_ETH_PER_RUN`
- `TRAD_MAX_ETH_PER_DAY`
- `TRAD_MAX_TRADES_PER_RUN`
- `TRAD_DEFAULT_SLIPPAGE_BPS` (default: 1000 = 10%)

---

## Typecheck

```bash
bun run lint
```

---

## Docs

- `TRAD.md` — architecture + runtime overview
- `ROBINPUMP.md` — RobinPump integration notes

