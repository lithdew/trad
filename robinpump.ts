/**
 * robinpump.ts — RobinPump.fun on-chain trading library for Base chain.
 *
 * Covers: creating tokens, buying, selling, fetching prices, listing coins,
 * reading balances, and computing market caps — all via viem against the
 * RobinPump bonding-curve contracts on Base mainnet.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
  parseEther,
  getAddress,
  type Hash,
  type TransactionReceipt,
  type Log,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ─── Contract addresses ──────────────────────────────────────────────

/** Factory / router that creates new bonding-curve pairs. */
const FACTORY_ADDRESS = getAddress("0x07DFAEC8e182C5eF79844ADc70708C1c15aA60fb");

/** Receives the 1 % fee on every buy / sell. */
const FEE_RECEIVER_ADDRESS = getAddress("0xAEE44C38633f7eD683c0c61840663c04D6C4C937");

/** Clanker v4.0.0 — used for graduated token deployment to Uniswap V4. */
const CLANKER_ADDRESS = getAddress("0xe85a59c628f7d27878aceb4bf3b35733630083a9");

// ─── Trading constants ────────────────────────────────────────────────

const BPS = 10_000n;
// RobinPump charges a platform fee on buys/sells (1%).
const PLATFORM_FEE_BPS = 100n;
const PLATFORM_FEE_FACTOR_BPS = BPS - PLATFORM_FEE_BPS;

// ─── ABIs (minimal, only what we need) ───────────────────────────────

const factoryAbi = parseAbi([
  "function createToken(string _name, string _symbol, string _uri, uint256 _alpha) payable",
]);

const pairAbi = parseAbi([
  // Errors (for decoding bubbled-up reverts)
  "error SlippageExceeded()",

  "function buy(uint256 minTokensOut, uint256 deadline) payable",
  "function sell(uint256 tokensToSell, uint256 minEthOut, uint256 deadline)",
  "function token() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
]);

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// ─── Types ───────────────────────────────────────────────────────────

interface RobinPumpConfig {
  /** Wallet private key (hex with 0x prefix). */
  privateKey: `0x${string}`;
  /** Base-chain RPC URL. Defaults to https://mainnet.base.org */
  rpcUrl?: string;
}

interface TokenInfo {
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

interface PairInfo {
  pairAddress: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  ethBalance: bigint;
  tokenBalance: bigint;
  totalSupply: bigint;
}

interface PriceInfo {
  /** Price per token in ETH (human-readable). */
  priceEth: number;
  /** Price per token in USD (if ethUsdPrice provided). */
  priceUsd: number | null;
  /** ETH held in the bonding-curve pair. */
  ethReserve: bigint;
  /** Tokens held in the bonding-curve pair. */
  tokenReserve: bigint;
  /** Tokens in circulation (totalSupply - pairBalance). */
  circulatingSupply: bigint;
}

interface MarketCapInfo {
  /** Market cap in ETH. */
  marketCapEth: number;
  /** Market cap in USD (if ethUsdPrice provided). */
  marketCapUsd: number | null;
  pricePerTokenEth: number;
  circulatingSupply: bigint;
  totalSupply: bigint;
}

interface TxResult {
  hash: Hash;
  receipt: TransactionReceipt;
  approval?: { hash: Hash; receipt: TransactionReceipt };
}

interface CoinListing {
  pairAddress: string;
  tokenAddress: string;
  creator: string;
  blockNumber: bigint;
  ethDeposited: bigint;
  txHash: string;
}

/** Coin data returned from the RobinPump Goldsky subgraph. */
interface SubgraphCoin {
  /** Pair / bonding-curve contract address (lowercase). */
  pairAddress: string;
  /** ERC-20 token address (lowercase). */
  tokenAddress: string;
  name: string;
  symbol: string;
  /** IPFS URI for metadata (name, symbol, description, image). */
  uri: string;
  /** Creator wallet address. */
  creator: string;
  /** Unix timestamp of creation (seconds). */
  createdAt: number;
  graduated: boolean;
  /** Last traded price in ETH. */
  lastPriceEth: number;
  /** Last traded price in USD. */
  lastPriceUsd: number;
  /** Total trading volume in ETH. */
  totalVolumeEth: number;
  /** ETH currently held by the bonding curve. */
  ethCollected: number;
  /** Total number of trades. */
  tradeCount: number;
}

/** Metadata stored on IPFS (linked from SubgraphCoin.uri). */
interface CoinMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  showName: boolean;
  createdOn: string;
}

/** Trade data from the subgraph. */
interface SubgraphTrade {
  pairAddress: string;
  side: "buy" | "sell";
  amountEth: number;
  amountToken: number;
  priceEth: number;
  priceUsd: number;
  trader: string;
  timestamp: number;
  txHash: string;
}

// ─── Metadata cache ─────────────────────────────────────────────────

const metadataCache = new Map<string, CoinMetadata | null>();

// ─── Client ──────────────────────────────────────────────────────────

class RobinPump {
  readonly publicClient;
  readonly walletClient;
  readonly account;

  constructor(config: RobinPumpConfig) {
    const rpcUrl = config.rpcUrl ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
    this.account = privateKeyToAccount(config.privateKey);

    this.publicClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(rpcUrl),
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /** Current Unix timestamp + offset in seconds, as bigint. */
  private deadline(offsetSeconds = 3600) {
    return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds);
  }

  // ── Read: Wallet ─────────────────────────────────────────────────

  /** Get the connected wallet's ETH balance on Base. */
  async getEthBalance() {
    return this.publicClient.getBalance({
      address: this.account.address,
    });
  }

  /** Get the connected wallet's token balance for a specific ERC-20. */
  async getTokenBalance(tokenAddress: string) {
    return this.publicClient.readContract({
      address: getAddress(tokenAddress),
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.account.address],
    });
  }

  // ── Read: Token Info ─────────────────────────────────────────────

  /** Fetch basic ERC-20 metadata (batched into 1 RPC call via multicall). */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const addr = getAddress(tokenAddress);
    const results = await this.publicClient.multicall({
      contracts: [
        { address: addr, abi: erc20Abi, functionName: "name" },
        { address: addr, abi: erc20Abi, functionName: "symbol" },
        { address: addr, abi: erc20Abi, functionName: "decimals" },
        { address: addr, abi: erc20Abi, functionName: "totalSupply" },
      ],
    });

    if (results[0].status === "failure") throw new Error(`Failed to read token name for ${addr}`);
    if (results[1].status === "failure") throw new Error(`Failed to read token symbol for ${addr}`);
    if (results[2].status === "failure")
      throw new Error(`Failed to read token decimals for ${addr}`);
    if (results[3].status === "failure")
      throw new Error(`Failed to read token totalSupply for ${addr}`);

    return {
      tokenAddress: addr,
      name: results[0].result,
      symbol: results[1].result,
      decimals: results[2].result,
      totalSupply: results[3].result,
    };
  }

  // ── Read: Pair Info ──────────────────────────────────────────────

  /** Fetch bonding-curve pair data (reserves, balances, etc.). */
  async getPairInfo(pairAddress: string): Promise<PairInfo> {
    const pair = getAddress(pairAddress);

    // First batch: get pair metadata + token address (1 RPC call)
    const pairResults = await this.publicClient.multicall({
      contracts: [
        { address: pair, abi: pairAbi, functionName: "token" },
        { address: pair, abi: pairAbi, functionName: "name" },
        { address: pair, abi: pairAbi, functionName: "symbol" },
      ],
    });

    if (pairResults[0].status === "failure")
      throw new Error(`Failed to read token() on pair ${pair}`);
    if (pairResults[1].status === "failure")
      throw new Error(`Failed to read name() on pair ${pair}`);
    if (pairResults[2].status === "failure")
      throw new Error(`Failed to read symbol() on pair ${pair}`);

    const tokenAddress = pairResults[0].result;
    const name = pairResults[1].result;
    const symbol = pairResults[2].result;

    // Second batch: ETH balance + token reserves (1 RPC call)
    const [ethBalance, tokenResults] = await Promise.all([
      this.publicClient.getBalance({ address: pair }),
      this.publicClient.multicall({
        contracts: [
          { address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [pair] },
          { address: tokenAddress, abi: erc20Abi, functionName: "totalSupply" },
        ],
      }),
    ]);

    if (tokenResults[0].status === "failure") throw new Error("Failed to read token balanceOf");
    if (tokenResults[1].status === "failure") throw new Error("Failed to read token totalSupply");

    return {
      pairAddress: pair,
      tokenAddress,
      name,
      symbol,
      ethBalance,
      tokenBalance: tokenResults[0].result,
      totalSupply: tokenResults[1].result,
    };
  }

  // ── Read: Price ──────────────────────────────────────────────────

  /**
   * Compute the current spot price from on-chain reserves.
   *
   * Uses:  price = ethReserve / (totalSupply - tokenReserve)
   *
   * This is a *rough* spot price. For exact output amounts the bonding
   * curve's virtual-reserve constant-product formula applies, but this
   * is good enough for display and strategy logic.
   */
  async getPrice(pairAddress: string, ethUsdPrice: number | null = null): Promise<PriceInfo> {
    const pair = getAddress(pairAddress);

    const tokenAddress = await this.publicClient.readContract({
      address: pair,
      abi: pairAbi,
      functionName: "token",
    });

    // Batch reads into a single multicall + one getBalance
    const [ethBalance, mcResults] = await Promise.all([
      this.publicClient.getBalance({ address: pair }),
      this.publicClient.multicall({
        contracts: [
          { address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [pair] },
          { address: tokenAddress, abi: erc20Abi, functionName: "totalSupply" },
        ],
      }),
    ]);

    if (mcResults[0].status === "failure") throw new Error("Failed to read token balanceOf");
    if (mcResults[1].status === "failure") throw new Error("Failed to read token totalSupply");

    const tokenBalance = mcResults[0].result;
    const totalSupply = mcResults[1].result;

    const circulatingSupply = totalSupply - tokenBalance;

    // Avoid division by zero if nobody has bought yet
    const priceEth = circulatingSupply > 0n ? Number(ethBalance) / Number(circulatingSupply) : 0;

    const priceUsd = ethUsdPrice !== null && priceEth > 0 ? priceEth * ethUsdPrice : null;

    return {
      priceEth,
      priceUsd,
      ethReserve: ethBalance,
      tokenReserve: tokenBalance,
      circulatingSupply,
    };
  }

  // ── Read: Market Cap ─────────────────────────────────────────────

  async getMarketCap(
    pairAddress: string,
    ethUsdPrice: number | null = null,
  ): Promise<MarketCapInfo> {
    const price = await this.getPrice(pairAddress, ethUsdPrice);

    const totalSupply = price.tokenReserve + price.circulatingSupply;
    const marketCapEth = price.priceEth * Number(formatEther(totalSupply));
    const marketCapUsd = ethUsdPrice !== null ? marketCapEth * ethUsdPrice : null;

    return {
      marketCapEth,
      marketCapUsd,
      pricePerTokenEth: price.priceEth,
      circulatingSupply: price.circulatingSupply,
      totalSupply,
    };
  }

  // ── Write: Buy ───────────────────────────────────────────────────

  /**
   * Buy tokens on a bonding curve.
   *
   * @param pairAddress  The bonding-curve pair contract.
   * @param ethAmount    Human-readable ETH string, e.g. "0.001".
   * @param slippage     Fraction 0-1, e.g. 0.05 for 5 %. Defaults to no
   *                     slippage protection (0).
   */
  async buy(pairAddress: string, ethAmount: string, slippage = 0): Promise<TxResult> {
    const pair = getAddress(pairAddress);
    const value = parseEther(ethAmount);

    let slippageBps = 0;
    if (Number.isFinite(slippage) && slippage > 0) {
      slippageBps = Math.round(slippage * 10_000);
      if (slippageBps < 0) slippageBps = 0;
      if (slippageBps > 5000) slippageBps = 5000;
    }

    let minTokensOut = 0n;
    if (slippageBps > 0) {
      const info = await this.getPairInfo(pairAddress);
      const ethReserve = info.ethBalance;
      const tokenReserve = info.tokenBalance;

      // Constant-product estimate (best-effort) with platform fee.
      const ethInAfterFee = (value * PLATFORM_FEE_FACTOR_BPS) / BPS;
      const k = ethReserve * tokenReserve;
      const newEthReserve = ethReserve + ethInAfterFee;
      const newTokenReserve = newEthReserve > 0n ? k / newEthReserve : 0n;

      let expectedTokensOut = 0n;
      if (newTokenReserve < tokenReserve) expectedTokensOut = tokenReserve - newTokenReserve;

      minTokensOut = (expectedTokensOut * BigInt(10_000 - slippageBps)) / BPS;
      if (minTokensOut > 0n) minTokensOut -= 1n; // rounding safety
    }

    const hash = await this.walletClient.writeContract({
      address: pair,
      abi: pairAbi,
      functionName: "buy",
      args: [minTokensOut, this.deadline()],
      value,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });
    return { hash, receipt };
  }

  // ── Write: Sell ──────────────────────────────────────────────────

  /**
   * Sell tokens back to the bonding curve.
   *
   * Handles ERC-20 approval automatically if needed.
   *
   * @param pairAddress   The bonding-curve pair contract.
   * @param tokenAddress  The ERC-20 token address.
   * @param tokenAmount   Raw token amount (bigint with 18 decimals).
   *                      Pass the result of getTokenBalance() to sell all.
   * @param slippage      Fraction 0-1, e.g. 0.05 for 5 %. Defaults to 0.
   */
  async sell(
    pairAddress: string,
    tokenAddress: string,
    tokenAmount: bigint,
    slippage = 0,
  ): Promise<TxResult> {
    const pair = getAddress(pairAddress);
    const token = getAddress(tokenAddress);

    // Check and set approval if needed
    const currentAllowance = await this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [this.account.address, pair],
    });

    let approval: TxResult["approval"] = undefined;
    if (currentAllowance < tokenAmount) {
      const approveHash = await this.walletClient.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [pair, tokenAmount],
      });
      const approveReceipt = await this.publicClient.waitForTransactionReceipt({
        hash: approveHash,
      });
      approval = { hash: approveHash, receipt: approveReceipt };
    }

    let slippageBps = 0;
    if (Number.isFinite(slippage) && slippage > 0) {
      slippageBps = Math.round(slippage * 10_000);
      if (slippageBps < 0) slippageBps = 0;
      if (slippageBps > 5000) slippageBps = 5000;
    }

    let minEthOut = 0n;
    if (slippageBps > 0) {
      const info = await this.getPairInfo(pairAddress);
      const ethReserve = info.ethBalance;
      const tokenReserve = info.tokenBalance;

      // Constant-product estimate (best-effort) with platform fee.
      const tokenInAfterFee = (tokenAmount * PLATFORM_FEE_FACTOR_BPS) / BPS;
      const k = ethReserve * tokenReserve;
      const newTokenReserve = tokenReserve + tokenInAfterFee;
      const newEthReserve = newTokenReserve > 0n ? k / newTokenReserve : 0n;

      let expectedEthOut = 0n;
      if (newEthReserve < ethReserve) expectedEthOut = ethReserve - newEthReserve;

      minEthOut = (expectedEthOut * BigInt(10_000 - slippageBps)) / BPS;
      if (minEthOut > 0n) minEthOut -= 1n; // rounding safety
    }

    // Execute sell
    const hash = await this.walletClient.writeContract({
      address: pair,
      abi: pairAbi,
      functionName: "sell",
      args: [tokenAmount, minEthOut, this.deadline()],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });
    return { hash, receipt, approval };
  }

  /**
   * Convenience: sell entire token balance back to the pair.
   */
  async sellAll(pairAddress: string, tokenAddress: string) {
    const balance = await this.getTokenBalance(tokenAddress);
    if (balance === 0n) {
      throw new Error("No tokens to sell");
    }
    return this.sell(pairAddress, tokenAddress, balance);
  }

  // ── Write: Create Token ──────────────────────────────────────────

  /**
   * Launch a new token on RobinPump.
   *
   * @param name          Token name, e.g. "Awesome Coin"
   * @param symbol        Ticker, e.g. "AWESOME"
   * @param uri           IPFS URI for metadata (or empty string)
   * @param initialBuyEth Optional initial purchase in ETH (string).
   *                      If provided, the creator is the first buyer.
   */
  async createToken(
    name: string,
    symbol: string,
    uri = "",
    initialBuyEth: string | null = null,
  ): Promise<TxResult & { pairAddress: string | null; tokenAddress: string | null }> {
    const alpha = BigInt(Math.floor(Date.now() / 1000));
    const value = initialBuyEth !== null ? parseEther(initialBuyEth) : 0n;

    const hash = await this.walletClient.writeContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "createToken",
      args: [name, symbol, uri, alpha],
      value,
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
    });

    // Parse internal "Contract Creation" events from the receipt.
    // The factory creates two contracts: pair first, then ERC-20 token.
    let pairAddress: string | null = null;
    let tokenAddress: string | null = null;

    // The Transfer event from the null address reveals the token, and the
    // pair is discoverable from the token's first Transfer destination.
    // But the simplest approach: iterate receipt logs for Transfer(0x0 → pair).
    const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const nullTopic = "0x0000000000000000000000000000000000000000000000000000000000000000";

    for (const log of receipt.logs) {
      if (
        log.topics[0] === transferTopic &&
        log.topics[1] === nullTopic &&
        log.topics.length >= 3
      ) {
        // Mint event: from=0x0, to=pair, token contract is log.address
        tokenAddress = log.address;
        const toPadded = log.topics[2];
        if (toPadded !== undefined) {
          pairAddress = getAddress("0x" + toPadded.slice(26));
        }
        break;
      }
    }

    return { hash, receipt, pairAddress, tokenAddress };
  }

  // ── Discovery: List Coins ────────────────────────────────────────

  /**
   * Discover coins created on RobinPump by scanning factory events.
   *
   * Scans the last `blockRange` blocks (default 50 000 ≈ ~1 day on Base).
   * Paginates in small chunks to work within Alchemy free-tier limits.
   */
  async listCoins(blockRange = 50_000): Promise<CoinListing[]> {
    const latestBlock = await this.publicClient.getBlockNumber();
    const fromBlock = latestBlock > BigInt(blockRange) ? latestBlock - BigInt(blockRange) : 0n;

    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as `0x${string}`;
    const nullTopic =
      "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    // Use Alchemy's alchemy_getAssetTransfers for efficient discovery.
    // This endpoint supports large block ranges even on the free tier.
    // Falls back to eth_getLogs in tiny 10-block chunks for other RPCs.
    const rpcUrl =
      this.walletClient.transport.url ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

    const factoryTxHashes = new Set<string>();

    if (rpcUrl.includes("alchemy.com")) {
      // Alchemy-specific: getAssetTransfers supports huge ranges
      try {
        const body = {
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [
            {
              fromBlock: "0x" + fromBlock.toString(16),
              toBlock: "latest",
              toAddress: FACTORY_ADDRESS,
              category: ["external"],
              maxCount: "0x3e8", // 1000
              order: "desc",
            },
          ],
        };
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        const transfers = json?.result?.transfers;
        if (Array.isArray(transfers)) {
          for (const tx of transfers) {
            if (typeof tx.hash === "string") {
              factoryTxHashes.add(tx.hash);
            }
          }
        }
      } catch {
        // Fall through to generic approach
      }
    }

    // Generic fallback: scan with tiny 10-block chunks (slow but works)
    if (factoryTxHashes.size === 0) {
      const chunkSize = 10n;
      // Only scan the most recent portion to keep it feasible
      const scanFrom = latestBlock - 2_000n > fromBlock ? latestBlock - 2_000n : fromBlock;
      for (let start = scanFrom; start <= latestBlock; start += chunkSize) {
        const end = start + chunkSize - 1n > latestBlock ? latestBlock : start + chunkSize - 1n;
        try {
          const logs = await this.publicClient.getLogs({
            address: FACTORY_ADDRESS,
            fromBlock: start,
            toBlock: end,
          });
          for (const log of logs) {
            if (log.transactionHash !== null) {
              factoryTxHashes.add(log.transactionHash);
            }
          }
        } catch {
          // Skip chunk on failure
        }
      }
    }

    const oneBillion = 1_000_000_000n * 10n ** 18n;
    const coins: CoinListing[] = [];
    const seen = new Set<string>();

    // For each factory tx, fetch the receipt and extract mint events
    for (const txHash of factoryTxHashes) {
      try {
        const receipt = await this.publicClient.getTransactionReceipt({
          hash: txHash as Hash,
        });

        for (const rlog of receipt.logs) {
          if (rlog.topics[0] !== transferTopic || rlog.topics[1] !== nullTopic) continue;

          const mintedAmount = BigInt(rlog.data);
          if (mintedAmount !== oneBillion) continue;

          const tokenAddress = getAddress(rlog.address);
          if (seen.has(tokenAddress)) continue;
          seen.add(tokenAddress);

          const toPadded = rlog.topics[2];
          if (toPadded === undefined) continue;
          const pairAddress = getAddress("0x" + toPadded.slice(26));

          coins.push({
            pairAddress,
            tokenAddress,
            creator: receipt.from,
            blockNumber: receipt.blockNumber,
            ethDeposited: 0n,
            txHash,
          });
        }
      } catch {
        // skip on failure
      }
    }

    // Sort newest first
    coins.sort((a, b) =>
      a.blockNumber > b.blockNumber ? -1 : a.blockNumber < b.blockNumber ? 1 : 0,
    );

    return coins;
  }

  // ── Volume Bot Helper ────────────────────────────────────────────

  /**
   * Execute a buy-then-sell cycle for volume generation.
   *
   * Buys `ethAmount` worth of tokens, then immediately sells all back.
   * Generates 2 trades per cycle. Loses ~2% to fees per cycle.
   *
   * @returns Both transaction results.
   */
  async volumeCycle(pairAddress: string, ethAmount: string) {
    const pair = getAddress(pairAddress);

    // Get the token address
    const tokenAddress = await this.publicClient.readContract({
      address: pair,
      abi: pairAbi,
      functionName: "token",
    });

    // Buy
    const buyResult = await this.buy(pairAddress, ethAmount);

    // Small delay to let state settle
    await new Promise((r) => setTimeout(r, 500));

    // Sell everything we just bought
    const balance = await this.getTokenBalance(tokenAddress);
    if (balance === 0n) {
      return { buyResult, sellResult: null };
    }

    const sellResult = await this.sell(pairAddress, tokenAddress, balance);
    return { buyResult, sellResult };
  }

  // ── Subgraph: List Coins (fast, indexed) ──────────────────────────

  /**
   * List coins via the RobinPump Goldsky subgraph.
   *
   * Much faster than on-chain scanning and includes prices, volume,
   * trade counts, and graduation status.
   *
   * @param sort    "newest" | "marketCap" (default "newest")
   * @param limit   Max results (default 100, max 1000)
   * @param offset  Skip first N results for pagination
   */
  static async fetchCoins(
    sort: "newest" | "marketCap" = "newest",
    limit = 100,
    offset = 0,
  ): Promise<SubgraphCoin[]> {
    const orderBy = sort === "newest" ? "createdAt" : "ethCollected";
    const query = `{
      curves(
        first: ${limit}
        skip: ${offset}
        orderBy: ${orderBy}
        orderDirection: desc
      ) {
        id token name symbol uri creator createdAt
        graduated lastPriceEth lastPriceUsd
        totalVolumeEth ethCollected tradeCount
      }
    }`;

    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://robinpump.fun",
        Referer: "https://robinpump.fun/",
      },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    const curves = json?.data?.curves;
    if (!Array.isArray(curves)) return [];

    const coins: SubgraphCoin[] = [];
    for (const c of curves) {
      coins.push({
        pairAddress: c.id,
        tokenAddress: c.token,
        name: c.name,
        symbol: c.symbol,
        uri: c.uri,
        creator: c.creator,
        createdAt: parseInt(c.createdAt, 10),
        graduated: c.graduated,
        lastPriceEth: parseFloat(c.lastPriceEth),
        lastPriceUsd: parseFloat(c.lastPriceUsd),
        totalVolumeEth: parseFloat(c.totalVolumeEth),
        ethCollected: parseFloat(c.ethCollected),
        tradeCount: parseInt(c.tradeCount, 10),
      });
    }
    return coins;
  }

  /**
   * Fetch a single coin's subgraph data by pair address.
   */
  static async fetchCoin(pairAddress: string): Promise<SubgraphCoin | null> {
    const id = pairAddress.toLowerCase();
    const query = `{
      curve(id: "${id}") {
        id token name symbol uri creator createdAt
        graduated lastPriceEth lastPriceUsd
        totalVolumeEth ethCollected tradeCount
      }
    }`;

    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://robinpump.fun",
        Referer: "https://robinpump.fun/",
      },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    const c = json?.data?.curve;
    if (c === null || c === undefined) return null;

    return {
      pairAddress: c.id,
      tokenAddress: c.token,
      name: c.name,
      symbol: c.symbol,
      uri: c.uri,
      creator: c.creator,
      createdAt: parseInt(c.createdAt, 10),
      graduated: c.graduated,
      lastPriceEth: parseFloat(c.lastPriceEth),
      lastPriceUsd: parseFloat(c.lastPriceUsd),
      totalVolumeEth: parseFloat(c.totalVolumeEth),
      ethCollected: parseFloat(c.ethCollected),
      tradeCount: parseInt(c.tradeCount, 10),
    };
  }

  /**
   * Fetch recent trades for a coin from the subgraph.
   */
  static async fetchTrades(pairAddress: string, limit = 20): Promise<SubgraphTrade[]> {
    const id = pairAddress.toLowerCase();
    const query = `{
      trades(
        first: ${limit}
        orderBy: timestamp
        orderDirection: desc
        where: { curve: "${id}" }
      ) {
        id curve { id } side amountEth amountToken
        priceEth priceUsd trader timestamp txHash
      }
    }`;

    const res = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://robinpump.fun",
        Referer: "https://robinpump.fun/",
      },
      body: JSON.stringify({ query }),
    });
    const json = await res.json();
    const raw = json?.data?.trades;
    if (!Array.isArray(raw)) return [];

    const trades: SubgraphTrade[] = [];
    for (const t of raw) {
      trades.push({
        pairAddress: t.curve.id,
        side: t.side === "sell" ? "sell" : "buy",
        amountEth: parseFloat(t.amountEth),
        amountToken: parseFloat(t.amountToken),
        priceEth: parseFloat(t.priceEth),
        priceUsd: parseFloat(t.priceUsd),
        trader: t.trader,
        timestamp: parseInt(t.timestamp, 10),
        txHash: t.txHash,
      });
    }
    return trades;
  }

  /**
   * Fetch IPFS metadata (description, image, etc.) for a coin.
   *
   * @param uri  IPFS URI from SubgraphCoin.uri (e.g. "ipfs://bafy...")
   */
  static async fetchMetadata(uri: string): Promise<CoinMetadata | null> {
    if (!uri.startsWith("ipfs://")) return null;
    const cid = uri.slice(7);
    const gatewayUrl = `${IPFS_GATEWAY}/ipfs/${cid}`;
    try {
      const res = await fetch(gatewayUrl);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // ── Metadata: Cached + Batch ─────────────────────────────────────

  /**
   * Fetch IPFS metadata with in-memory caching.
   * Returns cached result if available, otherwise fetches and caches.
   */
  static async fetchMetadataCached(uri: string): Promise<CoinMetadata | null> {
    const cached = metadataCache.get(uri);
    if (cached !== undefined) return cached;
    const meta = await RobinPump.fetchMetadata(uri);
    metadataCache.set(uri, meta);
    return meta;
  }

  /**
   * Resolve an IPFS URI (or plain CID / HTTP URL) to a gateway URL.
   */
  static resolveImageUrl(ipfsUri: string): string {
    if (ipfsUri.startsWith("ipfs://")) {
      return `${IPFS_GATEWAY}/ipfs/${ipfsUri.slice(7)}`;
    }
    if (ipfsUri.startsWith("http")) return ipfsUri;
    return `${IPFS_GATEWAY}/ipfs/${ipfsUri}`;
  }

  /**
   * Fetch coins with their IPFS metadata attached.
   * Metadata is fetched in parallel batches of 10 and cached.
   */
  static async fetchCoinsWithMetadata(
    sort: "newest" | "marketCap" = "newest",
    limit = 50,
    offset = 0,
  ): Promise<(SubgraphCoin & { metadata: CoinMetadata | null })[]> {
    const coins = await RobinPump.fetchCoins(sort, limit, offset);
    const results: (SubgraphCoin & { metadata: CoinMetadata | null })[] = [];

    // Fetch metadata in parallel, batches of 10
    for (let i = 0; i < coins.length; i += 10) {
      const batch = coins.slice(i, i + 10);
      const promises: Promise<CoinMetadata | null>[] = [];
      for (const c of batch) {
        promises.push(RobinPump.fetchMetadataCached(c.uri));
      }
      const metas = await Promise.all(promises);
      for (let j = 0; j < batch.length; j++) {
        const coin = batch[j];
        const meta = metas[j];
        if (coin !== undefined) {
          results.push({ ...coin, metadata: meta ?? null });
        }
      }
    }

    return results;
  }

  /**
   * Fetch coins along with the current ETH/USD price.
   * Falls back to $2500 if the price fetch fails.
   */
  static async fetchCoinsWithEthPrice(
    sort: "newest" | "marketCap" = "newest",
    limit = 50,
    offset = 0,
  ): Promise<{ coins: SubgraphCoin[]; ethUsdPrice: number }> {
    const [coins, ethUsdPrice] = await Promise.all([
      RobinPump.fetchCoins(sort, limit, offset),
      RobinPump.getEthUsdPrice().catch(() => 2500),
    ]);
    return { coins, ethUsdPrice };
  }

  /**
   * Compute approximate market cap in USD from subgraph coin data.
   * Uses ethCollected as a proxy for bonding-curve value.
   */
  static computeMarketCapUsd(coin: SubgraphCoin, ethUsdPrice: number): number {
    return coin.ethCollected * ethUsdPrice;
  }

  // ── Utilities ────────────────────────────────────────────────────

  /** Fetch current ETH/USD price from Coinbase API (free, no key). */
  static async getEthUsdPrice() {
    const res = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=ETH");
    const data = await res.json();
    return parseFloat(data.data.rates.USD);
  }
}

// ─── Constants ──────────────────────────────────────────────────────

/** RobinPump Goldsky subgraph endpoint (GraphQL). */
const SUBGRAPH_URL =
  "https://api.goldsky.com/api/public/project_cmjjrebt3mxpt01rm9yi04vqq/subgraphs/pump-charts/v2/gn";

/** IPFS gateway used by RobinPump for coin metadata. */
const IPFS_GATEWAY = "https://olive-defensive-giraffe-83.mypinata.cloud";

export {
  RobinPump,
  FACTORY_ADDRESS,
  FEE_RECEIVER_ADDRESS,
  CLANKER_ADDRESS,
  SUBGRAPH_URL,
  IPFS_GATEWAY,
};
export type {
  RobinPumpConfig,
  TokenInfo,
  PairInfo,
  PriceInfo,
  MarketCapInfo,
  TxResult,
  CoinListing,
  SubgraphCoin,
  SubgraphTrade,
  CoinMetadata,
};
