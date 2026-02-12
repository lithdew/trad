# TradDelegate — On-Chain Delegation Contract

TradDelegate allows users to deposit ETH into a smart contract and authorize the trad server (the "operator") to execute RobinPump bonding-curve trades on their behalf. Users retain full withdrawal rights at all times.

## Architecture

```
User deposits ETH
    │
    ▼
┌──────────────────┐
│  TradDelegate.sol │  ← holds ETH + token balances per user
│                    │
│  executeBuy()      │  ← operator buys tokens on bonding curve
│  executeSell()     │  ← operator sells tokens on bonding curve
│                    │
│  withdraw()        │  ← user can always withdraw
└──────────────────┘
    │                         ▲
    │  ETH for buy            │  ETH from sell
    ▼                         │
┌──────────────────┐
│  RobinPump Pair   │  ← bonding curve contract
└──────────────────┘
```

### Operator pattern

The **operator** is a server-side wallet controlled by trad. It can execute buy/sell trades using deposited user funds, but it **cannot**:

- Withdraw user ETH to arbitrary addresses
- Move tokens out of the contract
- Trade more than a user's deposited balance

Only the contract owner can set or change the operator address.

### Pair allowlist (critical)

TradDelegate **does not allow the operator to call arbitrary contracts**. Trading is restricted by an **owner-managed allowlist**:

- `allowedPairs[pair] = true` (explicitly allow a specific pair address), OR
- `allowedPairCodehashes[codehash] = true` (allow _all_ pairs that share the same runtime bytecode hash)

For production, you almost always want the **codehash allowlist**, so the operator can trade across all RobinPump pair instances without per-pair updates.

### Fee structure

A platform fee (in basis points) is deducted from every trade:

- **Buy**: fee is deducted from the ETH amount _before_ buying tokens
- **Sell**: fee is deducted from the ETH proceeds _after_ selling tokens
- Fees are sent to a configurable `feeReceiver` address

## Compile

### With solc (standalone)

```bash
# Install solc
brew install solidity   # macOS
# or: https://docs.soliditylang.org/en/latest/installing-solidity.html

# Compile
solc --overwrite --optimize --bin --abi contracts/TradDelegate.sol -o contracts/out/

# Artifacts:
# - contracts/out/TradDelegate.abi
# - contracts/out/TradDelegate.bin
```

### With Foundry (forge)

```bash
# Install foundry: https://book.getfoundry.sh/getting-started/installation
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Compile
forge build

# Artifacts are in contracts/out/
# Bytecode is in contracts/out/TradDelegate.sol/TradDelegate.json under .bytecode.object
```

## Deploy

### Testnet (Base Sepolia)

```bash
# Set environment variables
export CHAIN=base-sepolia
export BASE_SEPOLIA_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
export DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Optional: customize fee receiver and fee
export FEE_RECEIVER=0x...     # defaults to deployer address
export FEE_BPS=50             # defaults to 50 (0.5%)

# Compile (required — deploy script reads contracts/out/TradDelegate.bin)
solc --overwrite --optimize --bin --abi contracts/TradDelegate.sol -o contracts/out/

# Deploy
bun contracts/deploy.ts
```

Get testnet ETH from the [Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia).

### Mainnet (Base)

```bash
export CHAIN=base
export BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
export DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# Optional
export FEE_RECEIVER=0x...
export FEE_BPS=50

solc --overwrite --optimize --bin --abi contracts/TradDelegate.sol -o contracts/out/
bun contracts/deploy.ts
```

## Post-deployment setup

After deploying, configure the operator:

```bash
# Using cast (foundry)
cast send <CONTRACT_ADDRESS> "setOperator(address)" <OPERATOR_ADDRESS> \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Or via the trad server, which can call `setOperator()` programmatically using viem.

### Enable trading (pair allowlist)

Before the operator can trade, you must allow RobinPump pairs. Recommended (codehash-based):

```bash
# Pick any known-good RobinPump pair address and compute its runtime codehash
cast codehash <SAMPLE_ROBINPUMP_PAIR_ADDRESS> --rpc-url $BASE_RPC_URL

# Allow that codehash
cast send <CONTRACT_ADDRESS> "setPairCodehashAllowed(bytes32,bool)" <PAIR_CODEHASH> true \
  --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Optional (guardian emergency pause key):

```bash
cast send <CONTRACT_ADDRESS> "setGuardian(address)" <GUARDIAN_ADDRESS> \
  --rpc-url $BASE_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY
```

## Mainnet smoke test (delegation proof)

This script performs a tiny **real** buy + sell through `TradDelegate` against a **real Base mainnet** RobinPump pair, and prints:

- decoded `BuyExecuted` / `SellExecuted` events (from `TradDelegate`)
- decoded ERC-20 `Transfer` logs (from the token contract), which proves the pair/token contracts were actually hit

```bash
export BASE_RPC_URL="https://base-mainnet.g.alchemy.com/v2/..."
export TRAD_DELEGATE_ADDRESS="0x..."

# Burner keys with tiny funds:
# - USER pays gas for deposit/withdraw and provides the deposit amount
# - OPERATOR pays gas for executeBuy/executeSell
export USER_PRIVATE_KEY="0x..."
export OPERATOR_PRIVATE_KEY="0x..."

# A RobinPump pair address on Base mainnet (preferred)
export PAIR_ADDRESS="0x..."

# Optional alternative (if you only know the token address)
# export TOKEN_ADDRESS="0x..."

# Optional tuning
export BUY_ETH="0.0001"
export SELL_BPS="10000"
export DEADLINE_SECONDS="3600"
export WITHDRAW_AFTER="true"

bun contracts/smoke.ts
```

If your deployed contract hasn’t been configured yet (operator/allowlist), you can allow the script to do it (owner-only):

```bash
export DO_SETUP="true"
export OWNER_PRIVATE_KEY="0x..."  # must be TradDelegate.owner()

bun contracts/smoke.ts
```

## Safety guarantees

- **User-only withdrawals**: `withdraw()` and `withdrawAll()` send ETH only to `msg.sender`
- **Balance-checked trades**: operator cannot spend more than a user's deposited balance
- **Non-reentrant**: all state-changing functions use a reentrancy guard
- **Emergency pause**: owner can pause all trading; withdrawals remain active
- **Pair allowlist**: operator trading is restricted to owner-approved RobinPump pair contracts
- **Proceeds credited in-contract**: trade output (tokens from buy, ETH from sell) is always credited to the user's internal balance, never sent to external addresses
