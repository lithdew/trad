# RobinPump.fun — Integration Analysis

> **URL:** https://robinpump.fun/
> **Chain:** Base (Coinbase L2 on Ethereum)
> **Type:** Decentralized token launchpad with bonding curve pricing (similar to pump.fun on Solana, but EVM-based)

## What is RobinPump?

RobinPump is a **fair-launch token launchpad** on Base chain. It allows anyone to create "idea coins" — tokens representing startup ideas — and trade them on an automated **bonding curve**. Everyone has equal access to buy and sell from the moment a coin is created.

### How it works

1. **Pick a startup idea** you believe in
2. **Buy its coin** on the bonding curve (price goes up as more people buy)
3. **Sell anytime** to lock in profits or losses

### Key mechanics

- **Bonding curve:** Tokens trade on an automated pricing curve. As ETH flows in, price increases. As ETH flows out, price decreases. This is based on a Uniswap V2 style constant-product formula with virtual reserves.
- **Graduation:** When a token hits a certain market cap threshold, it "graduates" — meaning liquidity migrates to a standard DEX pool and RobinPump stops charging fees.
- **Fair launch:** No presale, no insider allocation. Everyone buys at the same price on the curve.

## Fee Structure

| Fee Type        | Amount | Notes                                          |
| --------------- | ------ | ---------------------------------------------- |
| Buy fee         | 1%     | Deducted from purchase amount on bonding curve |
| Sell fee        | 1%     | Deducted from sale proceeds on bonding curve   |
| Token creation  | Free   | Only blockchain gas fees (~$0.01 on Base)      |
| Post-graduation | 0%     | RobinPump charges nothing; DEX fees apply      |
| Gas fees        | Varies | Base L2 gas fees (very cheap, usually <$0.01)  |

## Hackathon Context

The leaderboard at https://robinpump.fun/leaderboard tracks **top traders by volume** (and P&L). The hackathon prize goes to the trader with the highest trading volume by the end. Winner announced in-person on Thursday.

**This means strategies that generate high volume are rewarded**, not just P&L. This opens up interesting strategies like high-frequency small trades, market making, etc.

## Technical Architecture

### Blockchain

- **Network:** Base (Chain ID: 8453)
- **Base Mainnet RPC:** `https://mainnet.base.org`
- **Block explorer:** https://basescan.org
- **Native currency:** ETH (bridged from Ethereum)

### Smart Contracts

RobinPump uses a bonding curve smart contract system typical of EVM pump.fun clones:

- **Token Factory:** Creates new ERC-20 tokens with bonding curve parameters
- **Bonding Curve:** Manages buy/sell operations with price determined by reserves
- **Graduation:** Migrates liquidity to Uniswap V3 (or equivalent DEX on Base) when threshold is met

> **TODO:** The exact contract addresses need to be discovered. Options:
>
> 1. Inspect network requests on robinpump.fun when executing a trade
> 2. Check Base block explorer for the factory contract
> 3. Ask the RobinPump team at the hackathon directly
> 4. Look at the "Log in" flow to find the contract interaction

### Authentication

RobinPump uses **Web3 wallet authentication** (not API keys like Binance). Users connect their Ethereum wallet (MetaMask, Coinbase Wallet, etc.) to sign transactions. This means:

- **No API key/secret needed** — authentication is done via wallet private key signing
- Trades are submitted as **on-chain transactions** directly to the bonding curve smart contract
- The user needs an **Ethereum wallet with ETH on Base** to pay for gas and trading

## Integration Plan for trad

### Settings Required

For a user to trade on RobinPump through trad, they need to configure:

| Setting            | Type   | Required | Description                                                  |
| ------------------ | ------ | -------- | ------------------------------------------------------------ |
| Wallet Private Key | Secret | Yes      | Private key of the Ethereum wallet to sign transactions      |
| Base RPC URL       | String | No       | RPC endpoint for Base chain (defaults to `mainnet.base.org`) |

### Integration Approach

Since RobinPump is fully on-chain, integration means interacting with smart contracts directly:

```
User describes strategy in trad
  → LLM generates strategy code
    → Strategy code uses trad's API:
        api.robinpump.buy(tokenAddress, ethAmount)
        api.robinpump.sell(tokenAddress, tokenAmount)
        api.robinpump.getPrice(tokenAddress)
        api.robinpump.getMarketCap(tokenAddress)
        api.robinpump.listCoins({ sort: 'newest' | 'marketCap' })
```

Under the hood, each of these calls would:

1. Build the appropriate smart contract transaction
2. Sign it with the user's wallet private key
3. Submit it to Base via the RPC endpoint
4. Wait for confirmation

### Libraries Needed

For the actual trading implementation, you'll want:

```bash
bun add viem    # Modern, lightweight Ethereum library (better than ethers.js for Bun)
```

**viem** is the recommended choice because:

- First-class TypeScript support
- Smaller bundle size than ethers.js
- Better performance
- Works great with Bun

### Example Strategy Code (what the LLM would generate)

```javascript
async function main(api) {
  // Get list of newest coins on RobinPump
  const coins = await api.robinpump.listCoins({ sort: "newest", limit: 10 });

  for (const coin of coins) {
    // Buy coins with market cap under $3000 (early entry)
    if (coin.marketCap < 3000) {
      await api.robinpump.buy(coin.address, 0.001); // Buy 0.001 ETH worth
      api.log(`Bought ${coin.name} at MC $${coin.marketCap}`);
    }
  }

  // Check again in 5 minutes
  api.scheduleNext("5m");
}
```

### Example: Market Making Strategy

```javascript
async function main(api) {
  const TOKEN = "0x..."; // specific token address

  const price = await api.robinpump.getPrice(TOKEN);
  const balance = await api.robinpump.getBalance(TOKEN);

  // Simple spread strategy for volume generation
  if (balance > 0) {
    // Sell small amount
    await api.robinpump.sell(TOKEN, balance * 0.1);
    api.log(`Sold 10% at price ${price}`);
  }

  // Buy back
  await api.robinpump.buy(TOKEN, 0.0005);
  api.log(`Bought back at price ${price}`);

  // High frequency: run again in 1 minute
  api.scheduleNext("1m");
}
```

## Key Differences from Binance/Uniswap

| Aspect          | Binance                    | Uniswap               | RobinPump                         |
| --------------- | -------------------------- | --------------------- | --------------------------------- |
| Type            | CEX                        | DEX                   | Token launchpad + DEX             |
| Chain           | N/A (centralized)          | Ethereum/L2s          | Base only                         |
| Auth            | API key + secret           | Wallet private key    | Wallet private key                |
| Trading         | REST API / WebSocket       | Smart contract calls  | Smart contract calls              |
| Fee             | 0.1%                       | 0.3% (pool dependent) | 1% on bonding curve, 0% graduated |
| Assets          | Established cryptos        | Any ERC-20 token      | Idea coins (new tokens)           |
| Unique feature  | High liquidity, many pairs | Permissionless pools  | Fair-launch bonding curves        |
| Hackathon angle | N/A                        | N/A                   | Volume-based leaderboard prize    |

## Next Steps

1. **Get contract addresses** — Ask the RobinPump team or inspect browser network tab during a trade
2. **Get the ABI** — Either from verified contracts on BaseScan or from their source
3. **Implement the viem client** — Create a Base wallet client that can sign and send transactions
4. **Build the trad API wrapper** — `api.robinpump.buy()`, `api.robinpump.sell()`, etc.
5. **Implement coin discovery** — Scrape or API-call to get list of available coins and their prices
6. **Test with small amounts** — Base gas is cheap, start with 0.0001 ETH trades

## Useful Resources

- Base chain docs: https://docs.base.org
- viem docs: https://viem.sh
- Base block explorer: https://basescan.org
- RobinPump: https://robinpump.fun
- EVM pump.fun contract examples: https://github.com/Immutal0/EVM-Pumpfun-Smart-Contract
