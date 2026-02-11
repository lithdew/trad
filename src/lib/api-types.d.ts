/** trad Strategy Runtime API — available as `api` in main() */
interface StrategyAPI {
  // ── RobinPump Trading ──────────────────────
  robinpump: {
    listCoins(opts?: { sort?: "newest" | "marketCap"; limit?: number }): Promise<Coin[]>;
    getPrice(pairAddress: string): Promise<number>;
    getMarketCap(pairAddress: string): Promise<number>;
    buy(pairAddress: string, ethAmount: number): Promise<TxResult>;
    sell(pairAddress: string, tokenAmount: number): Promise<TxResult>;
    getBalance(tokenAddress: string): Promise<number>;
    getEthBalance(): Promise<number>;
    getEthUsdPrice(): Promise<number>;
  };

  // ── Scheduling ─────────────────────────────
  /**
   * Schedule the next run.
   *
   * Relative:
   * - "30s" | "5m" | "1h" | "1d" | "cron:<expression>" | "once"
   * - { in: "5m" } or { in: 3000 } (ms)
   *
   * Absolute:
   * - ISO string, e.g. "2026-02-11T12:34:56.000Z"
   * - { at: "2026-02-11T12:34:56.000Z" } or { at: 1730000000 } (unix seconds) or { at: 1730000000000 } (unix ms)
   */
  schedule(when: string | number | { in: string | number } | { at: string | number }): void;

  /** Back-compat alias (prefer schedule()). */
  scheduleNext(interval: string): void;

  // ── Utilities ──────────────────────────────
  now(): number;
  utcTime(): string;
  log(message: string): void;
  isDryRun(): boolean;
}

interface Coin {
  address: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  marketCap: number;
  priceEth: number;
  priceUsd: number;
  volume: number;
  trades: number;
  graduated: boolean;
  creator: string;
  createdAt: number;
}

interface TxResult {
  hash: string;
  status: string;
}

/** User-configurable parameters. Access via PARAMS.paramName */
declare const PARAMS: Record<string, string | number | boolean>;

/** Entry point — implement your strategy here */
declare function main(api: StrategyAPI): Promise<void>;
