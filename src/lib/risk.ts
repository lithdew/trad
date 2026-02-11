export interface RiskLimits {
  maxEthPerTrade: number;
  maxEthPerRun: number;
  maxEthPerDay: number;
  maxTradesPerRun: number;
  /** Default slippage tolerance in basis points (0-5000). */
  defaultSlippageBps: number;
}

export function readRiskLimitsFromEnv() {
  const defaults: RiskLimits = {
    maxEthPerTrade: 0.002,
    maxEthPerRun: 0.01,
    maxEthPerDay: 0.03,
    maxTradesPerRun: 50,
    defaultSlippageBps: 1000,
  };

  const maxEthPerTradeRaw = process.env.TRAD_MAX_ETH_PER_TRADE;
  const maxEthPerRunRaw = process.env.TRAD_MAX_ETH_PER_RUN;
  const maxEthPerDayRaw = process.env.TRAD_MAX_ETH_PER_DAY;
  const maxTradesPerRunRaw = process.env.TRAD_MAX_TRADES_PER_RUN;
  const defaultSlippageBpsRaw = process.env.TRAD_DEFAULT_SLIPPAGE_BPS;

  const parsed: Partial<RiskLimits> = {};

  if (typeof maxEthPerTradeRaw === "string" && maxEthPerTradeRaw.trim() !== "") {
    const v = Number.parseFloat(maxEthPerTradeRaw);
    if (Number.isFinite(v) && v > 0) parsed.maxEthPerTrade = v;
  }
  if (typeof maxEthPerRunRaw === "string" && maxEthPerRunRaw.trim() !== "") {
    const v = Number.parseFloat(maxEthPerRunRaw);
    if (Number.isFinite(v) && v > 0) parsed.maxEthPerRun = v;
  }
  if (typeof maxEthPerDayRaw === "string" && maxEthPerDayRaw.trim() !== "") {
    const v = Number.parseFloat(maxEthPerDayRaw);
    if (Number.isFinite(v) && v > 0) parsed.maxEthPerDay = v;
  }
  if (typeof maxTradesPerRunRaw === "string" && maxTradesPerRunRaw.trim() !== "") {
    const v = Number.parseInt(maxTradesPerRunRaw, 10);
    if (Number.isFinite(v) && v > 0) parsed.maxTradesPerRun = v;
  }
  if (typeof defaultSlippageBpsRaw === "string" && defaultSlippageBpsRaw.trim() !== "") {
    const v = Number.parseInt(defaultSlippageBpsRaw, 10);
    if (Number.isFinite(v) && v >= 0 && v <= 5000) parsed.defaultSlippageBps = v;
  }

  return {
    maxEthPerTrade: parsed.maxEthPerTrade ?? defaults.maxEthPerTrade,
    maxEthPerRun: parsed.maxEthPerRun ?? defaults.maxEthPerRun,
    maxEthPerDay: parsed.maxEthPerDay ?? defaults.maxEthPerDay,
    maxTradesPerRun: parsed.maxTradesPerRun ?? defaults.maxTradesPerRun,
    defaultSlippageBps: parsed.defaultSlippageBps ?? defaults.defaultSlippageBps,
  } satisfies RiskLimits;
}

