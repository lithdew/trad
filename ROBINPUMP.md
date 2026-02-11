# RobinPump.fun — Integration Notes

RobinPump.fun is a **Base**-chain token launchpad where “idea coins” trade on **bonding-curve pair contracts**.

This repo integrates RobinPump in two ways:

1. **Fast market data** via the RobinPump **Goldsky subgraph** (coin list, prices, volume, trades)
2. **On-chain trading** via `viem` against the bonding-curve pair contracts

---

## Key mechanics (for strategy authors)

- **Pairs**: each coin has a **pair contract** (the bonding curve). Strategies trade by pair address.
- **Native currency**: ETH (on Base).
- **Fees**: buys/sells incur a platform fee (the pair contract enforces it).
- **Graduation**: coins may “graduate” from the bonding curve into a standard DEX pool (strategies should handle both states).

---

## Code pointers

- **Client library**: `robinpump.ts`
  - `RobinPump.fetchCoins(...)` (subgraph)
  - `RobinPump.fetchTrades(...)` (subgraph)
  - `new RobinPump({ privateKey, rpcUrl })` (on-chain)
  - `getPairInfo()`, `getPrice()`, `getMarketCap()`, `buy()`, `sell()`
- **Runtime API surface**: `src/lib/api-types.d.ts`
- **Server endpoints**: `src/routes/robinpump.ts`

---

## Production considerations

- **Slippage protection**: buys/sells must set `minTokensOut` / `minEthOut` when trading on-chain.
- **Key management**:
  - Prefer **TradDelegate** (users deposit ETH; server operator executes trades within contract constraints)
  - Avoid storing raw user private keys in the DB for public deployments
- **RPC reliability**: configure `BASE_RPC_URL` to a production RPC with good rate limits.

