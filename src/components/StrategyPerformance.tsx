/* ═══════════════════════════════════════════════════════════════
   StrategyPerformance — Equity Curve + Trade Waterfall

   Shows:
   • Hero PnL with animated counting + gold glow
   • Equity curve (gold/red AreaChart with SVG glow)
   • Stat band (win rate, trades, drawdown, avg PnL)
   • Trade waterfall (green/red bars per trade)
   • Time-range filter + LIVE indicator
   ═══════════════════════════════════════════════════════════════ */

import { useState, useEffect, useRef } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useStrategyPerformance, type PerformanceRange } from "../lib/api";

/* ── Types ─────────────────────────────────────────────────── */

interface PerformanceTrade {
  timestamp: number;
  side: "buy" | "sell";
  pnlEth: number;
  pnlPct: number;
  amountEth: number;
  txHash: string;
  cumulativePnlEth: number;
  idx: number;
}

interface EquityPoint {
  timestamp: number;
  pnlEth: number;
}

interface PerformanceSummary {
  totalPnlEth: number;
  totalPnlPct: number;
  winRate: number;
  totalTrades: number;
  maxDrawdownPct: number;
  avgTradePnlEth: number;
  bestTradeEth: number;
  worstTradeEth: number;
}

interface PerformanceData {
  equityCurve: EquityPoint[];
  trades: PerformanceTrade[];
  summary: PerformanceSummary;
}

/* ── Animated number hook ────────────────────────────────── */

function useAnimatedNumber(target: number, duration = 1400) {
  const [value, setValue] = useState(0);
  const prev = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const from = prev.current;
    const start = performance.now();

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      setValue(v);
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        prev.current = target;
      }
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);

  return value;
}

/* ── Time range config ───────────────────────────────────── */

const TIME_RANGES = [
  { key: "1h", label: "1H" },
  { key: "4h", label: "4H" },
  { key: "1d", label: "1D" },
  { key: "7d", label: "7D" },
  { key: "all", label: "ALL" },
] as const;

/* ── Format helpers ──────────────────────────────────────── */

function fmtPnl(v: number): string {
  const sign = v >= 0 ? "+" : "";
  if (Math.abs(v) >= 1) return `${sign}${v.toFixed(4)}`;
  if (Math.abs(v) >= 0.001) return `${sign}${v.toFixed(6)}`;
  return `${sign}${v.toFixed(8)}`;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function fmtTimeFull(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ══════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════ */

export function StrategyPerformance({
  strategyId,
  isActive = false,
}: {
  strategyId: string;
  isActive?: boolean;
}) {
  const [range, setRange] = useState<PerformanceRange>("all");

  const perfQuery = useStrategyPerformance({
    id: strategyId,
    range,
    enabled: true,
    pollMs: isActive ? 2000 : undefined,
  });

  const perf = perfQuery.data;

  const summary: PerformanceSummary = perf?.summary ?? {
    totalPnlEth: 0,
    totalPnlPct: 0,
    winRate: 0,
    totalTrades: 0,
    maxDrawdownPct: 0,
    avgTradePnlEth: 0,
    bestTradeEth: 0,
    worstTradeEth: 0,
  };

  const equity: EquityPoint[] = perf?.equityCurve ?? [];
  const trades: PerformanceTrade[] = perf?.trades ?? [];

  let loadError: string | null = null;
  if (perfQuery.isError) {
    loadError =
      perfQuery.error instanceof Error ? perfQuery.error.message : "Failed to load performance";
  }

  const animatedPnl = useAnimatedNumber(summary.totalPnlEth);
  const isPositive = summary.totalPnlEth >= 0;

  /* Time range buttons */
  const rangeBtns: React.ReactNode[] = [];
  for (const r of TIME_RANGES) {
    rangeBtns.push(
      <button
        key={r.key}
        onClick={() => setRange(r.key)}
        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
          range === r.key
            ? "bg-primary/15 text-primary border border-primary/25 shadow-[0_0_8px_rgba(229,160,13,0.1)]"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
        }`}
      >
        {r.label}
      </button>,
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 sm:px-5 py-4 sm:py-5 animate-fadeSlideUp">
      {/* ── Hero PnL + controls ────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em]">
              Strategy Performance
            </span>
            {isActive && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest animate-livePulse">
                  Live
                </span>
              </span>
            )}
            {loadError !== null && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20">
                <span className="size-1.5 rounded-full bg-red-400/80" />
                <span className="text-[9px] font-bold text-red-400 uppercase tracking-widest">
                  API Error
                </span>
              </span>
            )}
          </div>

          {/* Hero number */}
          <div className="flex items-end gap-3">
            <span
              className={`font-display text-[2rem] sm:text-[2.6rem] leading-none font-bold tracking-tight tabular-nums ${
                isPositive
                  ? "text-emerald-400 animate-pnlGlowGreen"
                  : "text-red-400 animate-pnlGlowRed"
              }`}
            >
              {fmtPnl(animatedPnl)}
            </span>
            <span className="text-muted-foreground text-sm font-mono mb-1">ETH</span>
            <span
              className={`text-sm font-bold font-mono mb-1 ${isPositive ? "text-emerald-400" : "text-red-400"}`}
            >
              {fmtPct(summary.totalPnlPct)}
            </span>
          </div>
        </div>

        {/* Time range pills */}
        <div className="flex items-center gap-1">{rangeBtns}</div>
      </div>

      {/* ── Equity Curve ────────────────────────────────────── */}
      <EquityCurveChart data={equity} strategyId={strategyId} />

      {/* ── Stat Band ───────────────────────────────────────── */}
      <StatBand summary={summary} />

      {/* ── Trade Waterfall ─────────────────────────────────── */}
      <WaterfallChart trades={trades} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Equity Curve Chart
   ══════════════════════════════════════════════════════════════ */

function EquityCurveChart({ data, strategyId }: { data: EquityPoint[]; strategyId: string }) {
  if (data.length < 2) {
    return (
      <div className="w-full h-[180px] rounded-xl bg-secondary/30 flex items-center justify-center text-muted-foreground text-sm">
        Not enough data for equity curve
      </div>
    );
  }

  const last = data[data.length - 1]!;
  const isPositive = last.pnlEth >= 0;
  const strokeColor = isPositive ? "#22c55e" : "#ef4444";
  const gradId = `eq-grad-${strategyId.slice(-6)}`;
  const glowId = `eq-glow-${strategyId.slice(-6)}`;

  return (
    <div
      className="w-full rounded-xl bg-card/60 border border-border/50 overflow-hidden animate-fadeSlideUp"
      style={{ animationDelay: "80ms" }}
    >
      <div className="px-3 pt-2.5 pb-0 flex items-center justify-between">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
          Cumulative PnL
        </span>
        <span
          className={`text-[10px] font-mono font-bold ${isPositive ? "text-emerald-400" : "text-red-400"}`}
        >
          {fmtPnl(last.pnlEth)} ETH
        </span>
      </div>
      <div className="h-[180px] sm:h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 12 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.2} />
                <stop offset="50%" stopColor={strokeColor} stopOpacity={0.06} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
              </linearGradient>
              <filter id={glowId}>
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid
              strokeDasharray="3 6"
              stroke="var(--border)"
              strokeOpacity={0.25}
              vertical={false}
            />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={fmtTime}
              tick={{
                fill: "var(--muted-foreground)",
                fontSize: 9,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={false}
              tickLine={false}
              minTickGap={60}
              dy={4}
            />
            <YAxis
              dataKey="pnlEth"
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => fmtPnl(v)}
              tick={{
                fill: "var(--muted-foreground)",
                fontSize: 9,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={false}
              tickLine={false}
              width={70}
              orientation="right"
            />
            <ReferenceLine
              y={0}
              stroke="var(--gold-dim)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <Tooltip
              content={<EquityTooltip />}
              cursor={{ stroke: "var(--gold-dim)", strokeWidth: 1, strokeDasharray: "4 4" }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="pnlEth"
              stroke={strokeColor}
              strokeWidth={2.5}
              fill={`url(#${gradId})`}
              filter={`url(#${glowId})`}
              dot={false}
              activeDot={(p: { cx?: number; cy?: number; payload?: EquityPoint }) => {
                if (p.cx === undefined || p.cy === undefined || p.payload === undefined)
                  return <g />;
                const c = p.payload.pnlEth >= 0 ? "#22c55e" : "#ef4444";
                return (
                  <g>
                    <circle cx={p.cx} cy={p.cy} r="8" fill={c} opacity="0.08" />
                    <circle cx={p.cx} cy={p.cy} r="4" fill={c} opacity="0.2" />
                    <circle cx={p.cx} cy={p.cy} r="2" fill={c} opacity="0.9" />
                  </g>
                );
              }}
              animationDuration={1000}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Equity Tooltip ─────────────────────────────────────── */

function EquityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: EquityPoint }>;
}) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const d = payload[0]!.payload;
  const isPos = d.pnlEth >= 0;
  return (
    <div className="bg-popover/95 backdrop-blur-xl border border-border-light/50 rounded-xl px-3.5 py-2.5 shadow-[0_12px_48px_rgba(0,0,0,0.65)]">
      <span className="text-[9px] text-muted-foreground block mb-1">
        {fmtTimeFull(d.timestamp)}
      </span>
      <span
        className={`font-mono text-sm font-bold ${isPos ? "text-emerald-400" : "text-red-400"}`}
      >
        {fmtPnl(d.pnlEth)} <span className="text-muted-foreground text-[9px] font-normal">ETH</span>
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Stat Band
   ══════════════════════════════════════════════════════════════ */

function StatBand({ summary }: { summary: PerformanceSummary }) {
  const winPct = Math.max(0, Math.min(100, summary.winRate));
  const lossPct = 100 - winPct;

  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 animate-fadeSlideUp"
      style={{ animationDelay: "160ms" }}
    >
      {/* Win Rate */}
      <div className="bg-card/60 border border-border/50 rounded-xl p-3">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">
          Win Rate
        </span>
        <span
          className={`font-display text-lg font-bold leading-none ${
            winPct >= 50 ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {winPct.toFixed(1)}%
        </span>
        {/* Segmented bar */}
        <div className="flex mt-2 h-[4px] rounded-full overflow-hidden gap-px">
          <div
            className="bg-emerald-400/80 rounded-l-full transition-all duration-700"
            style={{ width: `${winPct}%` }}
          />
          <div
            className="bg-red-400/50 rounded-r-full transition-all duration-700"
            style={{ width: `${lossPct}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[8px] font-mono text-emerald-400/60">
            {summary.totalTrades > 0 ? Math.round((winPct * summary.totalTrades) / 100) : 0}W
          </span>
          <span className="text-[8px] font-mono text-red-400/60">
            {summary.totalTrades > 0
              ? summary.totalTrades - Math.round((winPct * summary.totalTrades) / 100)
              : 0}
            L
          </span>
        </div>
      </div>

      {/* Total Trades */}
      <div className="bg-card/60 border border-border/50 rounded-xl p-3">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">
          Total Trades
        </span>
        <span className="font-display text-lg font-bold text-foreground leading-none">
          {summary.totalTrades}
        </span>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[9px] font-mono text-muted-foreground">
            Avg:{" "}
            <span className={summary.avgTradePnlEth >= 0 ? "text-emerald-400" : "text-red-400"}>
              {fmtPnl(summary.avgTradePnlEth)}
            </span>
          </span>
        </div>
      </div>

      {/* Max Drawdown */}
      <div className="bg-card/60 border border-border/50 rounded-xl p-3">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">
          Max Drawdown
        </span>
        <span className="font-display text-lg font-bold text-red-400 leading-none">
          {summary.maxDrawdownPct > 0 ? `-${summary.maxDrawdownPct.toFixed(1)}%` : "0%"}
        </span>
        <div className="mt-2 h-[4px] rounded-full bg-red-400/10 overflow-hidden">
          <div
            className="h-full bg-red-400/60 rounded-full transition-all duration-700"
            style={{ width: `${Math.min(summary.maxDrawdownPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Best / Worst */}
      <div className="bg-card/60 border border-border/50 rounded-xl p-3">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">
          Best / Worst
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[13px] font-bold text-emerald-400">
            {summary.bestTradeEth > 0 ? `+${summary.bestTradeEth.toFixed(5)}` : "—"}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="font-mono text-[13px] font-bold text-red-400">
            {summary.worstTradeEth < 0 ? summary.worstTradeEth.toFixed(5) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Trade Waterfall Chart
   ══════════════════════════════════════════════════════════════ */

function WaterfallChart({ trades }: { trades: PerformanceTrade[] }) {
  if (trades.length === 0) {
    return (
      <div className="w-full h-[200px] rounded-xl bg-secondary/30 flex items-center justify-center text-muted-foreground text-sm">
        No trades in this time range
      </div>
    );
  }

  /* Determine bar size based on trade count */
  const barSize = trades.length > 35 ? 6 : trades.length > 20 ? 10 : 14;

  const idxToTimestamp = new Map<number, number>();
  let winCount = 0;
  let lossCount = 0;
  for (const t of trades) {
    idxToTimestamp.set(t.idx, t.timestamp);
    if (t.pnlEth >= 0) winCount++;
    else lossCount++;
  }

  const cells: React.ReactNode[] = [];
  const recentCutoff = trades.length - 3;
  let i = 0;
  for (const t of trades) {
    const isProfit = t.pnlEth >= 0;
    const isRecent = i >= recentCutoff;
    cells.push(
      <Cell
        key={t.idx}
        fill={isProfit ? "#22c55e" : "#ef4444"}
        fillOpacity={isRecent ? 0.9 : 0.65}
        stroke={isRecent ? (isProfit ? "#22c55e" : "#ef4444") : "none"}
        strokeWidth={isRecent ? 1 : 0}
        strokeOpacity={0.4}
      />,
    );
    i++;
  }

  return (
    <div
      className="w-full rounded-xl bg-card/60 border border-border/50 overflow-hidden animate-fadeSlideUp"
      style={{ animationDelay: "240ms" }}
    >
      <div className="px-3 pt-2.5 pb-0 flex items-center justify-between">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
          Trade PnL Waterfall
        </span>
        <div className="flex items-center gap-3 text-[9px]">
          <span className="flex items-center gap-1">
            <span className="size-[6px] rounded-sm bg-emerald-400" />
            <span className="text-muted-foreground">Profit</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="size-[6px] rounded-sm bg-red-400" />
            <span className="text-muted-foreground">Loss</span>
          </span>
        </div>
      </div>
      <div className="h-[200px] sm:h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={trades} margin={{ top: 12, right: 12, bottom: 4, left: 12 }}>
            <CartesianGrid
              strokeDasharray="3 6"
              stroke="var(--border)"
              strokeOpacity={0.2}
              vertical={false}
            />
            <XAxis
              dataKey="idx"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(idx: number) => {
                const ts = idxToTimestamp.get(idx);
                if (ts === undefined) return "";
                return fmtTime(ts);
              }}
              tick={{
                fill: "var(--muted-foreground)",
                fontSize: 9,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              dataKey="pnlEth"
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => {
                if (v === 0) return "0";
                const sign = v > 0 ? "+" : "";
                return `${sign}${(v * 1000).toFixed(1)}`;
              }}
              tick={{
                fill: "var(--muted-foreground)",
                fontSize: 9,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={false}
              tickLine={false}
              width={50}
              orientation="right"
              label={{
                value: "mETH",
                position: "top",
                offset: -2,
                style: {
                  fill: "var(--muted-foreground)",
                  fontSize: 8,
                  fontFamily: "var(--font-mono)",
                },
              }}
            />
            <ReferenceLine
              y={0}
              stroke="var(--gold-dim)"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              strokeOpacity={0.6}
            />
            <Tooltip
              content={<WaterfallTooltip />}
              cursor={{ fill: "var(--border)", fillOpacity: 0.15 }}
              isAnimationActive={false}
            />
            <Bar
              dataKey="pnlEth"
              radius={[3, 3, 0, 0]}
              barSize={barSize}
              animationDuration={800}
              animationEasing="ease-out"
            >
              {cells}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer: trade activity summary */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border/30">
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="size-[5px] rounded-full bg-emerald-400" />
            <span className="text-emerald-400 font-bold">{winCount}</span>
            <span className="text-muted-foreground">wins</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="size-[5px] rounded-full bg-red-400" />
            <span className="text-red-400 font-bold">{lossCount}</span>
            <span className="text-muted-foreground">losses</span>
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {trades.length} trades
        </span>
      </div>
    </div>
  );
}

/* ── Waterfall Tooltip ──────────────────────────────────── */

function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: PerformanceTrade }>;
}) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const d = payload[0]!.payload;
  const isProfit = d.pnlEth >= 0;

  return (
    <div className="bg-popover/95 backdrop-blur-xl border border-border-light/50 rounded-xl px-3.5 py-2.5 shadow-[0_12px_48px_rgba(0,0,0,0.65)] min-w-[180px]">
      {/* Header: side + time */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`size-2 rounded-full ${d.side === "buy" ? "bg-emerald-400" : "bg-red-400"}`}
        />
        <span
          className={`text-[10px] font-bold uppercase tracking-wider ${d.side === "buy" ? "text-emerald-400" : "text-red-400"}`}
        >
          {d.side}
        </span>
        <span className="text-[9px] text-muted-foreground ml-auto">{fmtTimeFull(d.timestamp)}</span>
      </div>

      {/* PnL */}
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-[15px] font-bold leading-tight ${isProfit ? "text-emerald-400" : "text-red-400"}`}
        >
          {fmtPnl(d.pnlEth)} ETH
        </span>
        <span
          className={`font-mono text-[11px] ${isProfit ? "text-emerald-400/70" : "text-red-400/70"}`}
        >
          {fmtPct(d.pnlPct)}
        </span>
      </div>

      {/* Details */}
      <div className="border-t border-border/40 mt-2 pt-1.5 flex items-center gap-3 text-[9px] text-muted-foreground">
        <span>Size: {d.amountEth.toFixed(4)} ETH</span>
        <span className="text-border-light">·</span>
        <a
          href={`https://basescan.org/tx/${d.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-gold-dim hover:text-gold-bright transition-colors"
        >
          {d.txHash.slice(0, 6)}…{d.txHash.slice(-4)}
        </a>
      </div>

      {/* Cumulative PnL at this point */}
      <div className="mt-1.5 text-[9px] text-muted-foreground/60">
        Cumulative:{" "}
        <span
          className={`font-mono font-bold ${d.cumulativePnlEth >= 0 ? "text-emerald-400/60" : "text-red-400/60"}`}
        >
          {fmtPnl(d.cumulativePnlEth)} ETH
        </span>
      </div>
    </div>
  );
}
