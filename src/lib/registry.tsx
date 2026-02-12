import { defineRegistry, useStateStore } from "@json-render/react";
import { catalog } from "./catalog";
import { type ReactNode, useState } from "react";
import { useCoinTrades, type TradeData, useStrategyPerformance } from "./api";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * React component registry — maps every catalog component
 * to a real React component styled with shadcn + Tailwind.
 */
export const { registry } = defineRegistry(catalog, {
  components: {
    /* ── Container ────────────────────────────────────────── */
    Container: ({ props, children }) => {
      if (props.layout === "grid") {
        const gapPx =
          props.gap === "none" ? 0 : props.gap === "sm" ? 10 : props.gap === "lg" ? 20 : 14;
        const cols = props.columns === "1" ? 1 : props.columns === "3" ? 3 : 2;
        return (
          <div
            className="*:min-w-0 *:min-h-0 bento-grid"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: `${gapPx}px`,
              width: "100%",
            }}
          >
            {children}
          </div>
        );
      }
      const gapPx =
        props.gap === "none" ? 0 : props.gap === "sm" ? 10 : props.gap === "lg" ? 20 : 14;
      const isH = props.direction === "horizontal";
      return (
        <div
          style={{
            display: "flex",
            flexDirection: isH ? "row" : "column",
            flexWrap: isH ? "wrap" : undefined,
            gap: `${gapPx}px`,
            alignItems: "stretch",
            width: "100%",
            height: isH ? undefined : "100%",
            minWidth: 0,
            gridColumn: isH ? "1 / -1" : undefined,
          }}
        >
          {children}
        </div>
      );
    },

    /* ── Strategy Header ─────────────────────────────────── */
    StrategyHeader: ({ props }) => {
      const exchangeCls: Record<string, string> = {
        robinpump: "bg-emerald-500/10 text-emerald-400",
      };
      const statusCls: Record<string, string> = {
        draft: "bg-secondary text-muted-foreground",
        active: "bg-emerald-500/10 text-emerald-400",
        paused: "bg-amber-500/10 text-amber-400",
        error: "bg-red-500/10 text-red-400",
      };
      return (
        <div style={{ gridColumn: "1 / -1" }}>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em] mb-2 block">
            Strategy
          </span>
          <h2 className="font-display text-[1.5rem] leading-tight text-foreground mb-1">
            {props.name}
          </h2>
          {props.description && (
            <p className="text-sm text-text-secondary leading-relaxed mb-2">{props.description}</p>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold px-2 py-[3px] rounded-md uppercase tracking-wider ${exchangeCls[props.exchange] ?? "bg-secondary text-muted-foreground"}`}
            >
              {props.exchange}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-[3px] rounded-md capitalize ${statusCls[props.status ?? "draft"]}`}
            >
              {props.status ?? "draft"}
            </span>
          </div>
        </div>
      );
    },

    /* ── Flow Block ───────────────────────────────────────── */
    FlowBlock: ({ props }) => {
      const { get } = useStateStore();
      const COLORS: Record<string, { border: string; bg: string; tag: string }> = {
        blue: { border: "border-blue-500/20", bg: "bg-blue-500/[0.04]", tag: "text-blue-400" },
        violet: {
          border: "border-violet-500/20",
          bg: "bg-violet-500/[0.04]",
          tag: "text-violet-400",
        },
        emerald: {
          border: "border-emerald-500/20",
          bg: "bg-emerald-500/[0.04]",
          tag: "text-emerald-400",
        },
        amber: { border: "border-amber-500/20", bg: "bg-amber-500/[0.04]", tag: "text-amber-400" },
        red: { border: "border-red-500/20", bg: "bg-red-500/[0.04]", tag: "text-red-400" },
      };
      const ICONS: Record<string, ReactNode> = {
        clock: (
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 18 18"
          >
            <circle cx="9" cy="9" r="7" />
            <path d="M9 5v4l2.5 2.5" />
          </svg>
        ),
        chart: (
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 18 18"
          >
            <path d="M2 13l5-8 4 5 5-7" />
          </svg>
        ),
        bolt: (
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 18 18"
          >
            <path d="M9 2v14M4 7l5-5 5 5" />
          </svg>
        ),
        coins: (
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 18 18"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M11.5 7.5a5 5 0 11-4-4" />
          </svg>
        ),
        alert: (
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 18 18"
          >
            <path d="M9 2L2 15h14L9 2z" />
            <path d="M9 7v3M9 13h.01" />
          </svg>
        ),
        repeat: (
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 18 18"
          >
            <path d="M3 9a6 6 0 0112 0M15 9a6 6 0 01-12 0" />
            <path d="M13 7l2 2 2-2M5 11l-2-2-2 2" />
          </svg>
        ),
      };
      const c = COLORS[props.color] ?? COLORS.blue!;
      const icon = ICONS[props.icon ?? "bolt"] ?? ICONS.bolt;
      return (
        <div
          className={`flex-1 min-w-[140px] border ${c.border} ${c.bg} rounded-xl p-3 flex items-center`}
        >
          <div className="flex items-center gap-2.5 w-full">
            <div className={`shrink-0 ${c.tag}`}>{icon}</div>
            <div className="min-w-0">
              <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${c.tag}`}>
                {props.tag}
              </span>
              <p className="text-sm font-medium text-foreground mt-0.5 wrap-break-word">
                {props.label.replace(/\{(\w+)\}/g, (_m, key: string) => {
                  const val = get(`/${key}`);
                  if (val == null) return _m;
                  if (typeof val === "string" && val.startsWith("0x"))
                    return val.length > 14 ? `${val.slice(0, 6)}…${val.slice(-4)}` : val;
                  if (typeof val === "number")
                    return val.toLocaleString("en-US", { maximumFractionDigits: 10 });
                  return String(val);
                })}
              </p>
            </div>
          </div>
        </div>
      );
    },

    /* ── Connector ────────────────────────────────────────── */
    Connector: ({ props }) => (
      <div className="hidden sm:flex items-center justify-center shrink-0 px-0.5">
        {props.style === "arrow" ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-border-light/80"
          >
            <path
              d="M3 8h10M10 5l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <div
            className={`h-px w-4 ${props.style === "dashed" ? "border-t border-dashed border-border-light/60" : "bg-border-light/60"}`}
          />
        )}
      </div>
    ),

    /* ── Metric Card ──────────────────────────────────────── */
    MetricCard: ({ props }) => {
      const { get } = useStateStore();
      const trendColor =
        props.trend === "up"
          ? "text-emerald-400"
          : props.trend === "down"
            ? "text-red-400"
            : "text-muted-foreground";
      const rawValue: unknown = props.value;
      let resolved: unknown = rawValue;
      if (rawValue !== null && typeof rawValue === "object" && !Array.isArray(rawValue)) {
        const path = (rawValue as Record<string, unknown>).path;
        if (typeof path === "string") {
          resolved = get(path);
        }
      }
      let displayValue: string;
      let isAddress = false;
      if (resolved == null) {
        displayValue = "";
      } else if (typeof resolved === "string" && resolved.startsWith("0x")) {
        isAddress = true;
        displayValue =
          resolved.length > 14 ? `${resolved.slice(0, 6)}…${resolved.slice(-4)}` : resolved;
      } else if (
        typeof resolved === "number" ||
        (typeof resolved === "string" && resolved !== "" && !isNaN(Number(resolved)))
      ) {
        const num = Number(resolved);
        displayValue = Number.isFinite(num)
          ? num.toLocaleString("en-US", { maximumFractionDigits: 10 })
          : String(resolved);
      } else {
        displayValue = String(resolved);
      }
      return (
        <div className="w-full h-full bg-card/80 border rounded-xl p-2.5 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-0.5">
            {props.label}
          </span>
          <span
            className={`font-bold ${trendColor} ${isAddress ? "text-sm font-mono" : "text-lg"}`}
            title={isAddress ? String(resolved) : undefined}
          >
            {displayValue}
            {props.unit && (
              <span className="text-xs font-normal text-muted-foreground ml-1">{props.unit}</span>
            )}
          </span>
        </div>
      );
    },

    /* ── Metric Row ───────────────────────────────────────── */
    MetricRow: ({ children }) => (
      <div
        className="w-full grid grid-cols-2 gap-2.5 sm:grid-cols-4"
        style={{ gridColumn: "1 / -1" }}
      >
        {children}
      </div>
    ),

    /* ── Price Chart (real trade data via Recharts) ───────── */
    PriceChart: ({ props }) => {
      const heightPx = props.height === "sm" ? 200 : props.height === "lg" ? 400 : 320;
      const pairAddress =
        typeof props.pair === "string" && props.pair !== "" ? props.pair : undefined;
      const { data: trades = [], isLoading } = useCoinTrades(pairAddress);
      const hasTrades = trades.length >= 2;

      /* ── Compute stats from trade data ───────────────────── */
      let highEth = 0;
      let lowEth = Infinity;
      let totalVolEth = 0;
      let buyCount = 0;
      let sellCount = 0;
      if (hasTrades) {
        for (const t of trades) {
          if (t.priceEth > highEth) highEth = t.priceEth;
          if (t.priceEth < lowEth) lowEth = t.priceEth;
          totalVolEth += t.amountEth;
          if (t.side === "buy") buyCount++;
          else sellCount++;
        }
      }
      const lastTrade = hasTrades ? trades[trades.length - 1]! : null;
      const firstTrade = hasTrades ? trades[0]! : null;
      const changePct =
        firstTrade !== null && firstTrade.priceEth > 0
          ? ((lastTrade!.priceEth - firstTrade.priceEth) / firstTrade.priceEth) * 100
          : 0;
      const isUp = changePct >= 0;
      const strokeColor = isUp ? "#22c55e" : "#ef4444";
      const accentCls = isUp ? "text-emerald-400" : "text-red-400";
      const gradId = `pc-${(pairAddress ?? "x").slice(-6)}-${isUp ? "u" : "d"}`;
      const glowId = `pcGlow-${(pairAddress ?? "x").slice(-6)}`;

      /* ── Price range position (0-100%) ───────────────────── */
      const priceRange = highEth - lowEth;
      const rangePct =
        lastTrade !== null && priceRange > 0
          ? Math.max(2, Math.min(98, ((lastTrade.priceEth - lowEth) / priceRange) * 100))
          : 50;

      /* ── Time span ───────────────────────────────────────── */
      let timeSpan = "";
      if (firstTrade !== null && lastTrade !== null) {
        const sec = lastTrade.timestamp - firstTrade.timestamp;
        if (sec < 60) timeSpan = "<1m";
        else if (sec < 3600) timeSpan = `${Math.round(sec / 60)}m`;
        else if (sec < 86400) {
          const h = Math.floor(sec / 3600);
          const m = Math.round((sec % 3600) / 60);
          timeSpan = m > 0 ? `${h}h ${m}m` : `${h}h`;
        } else timeSpan = `${Math.round(sec / 86400)}d`;
      }

      /* ── Formatting ──────────────────────────────────────── */
      const fmtEth = (v: number) => {
        if (v === 0) return "0";
        if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
        if (v >= 0.001) return v.toFixed(6);
        if (v >= 0.000001) return v.toFixed(9);
        return v.toExponential(2);
      };
      const fmtUsd = (v: number) => {
        if (v >= 1) return `$${v.toFixed(2)}`;
        if (v >= 0.01) return `$${v.toFixed(4)}`;
        if (v >= 0.0001) return `$${v.toFixed(6)}`;
        return `$${v.toExponential(2)}`;
      };

      /* ── Address truncation ──────────────────────────────── */
      const truncAddr =
        pairAddress != null && pairAddress.length > 14
          ? `${pairAddress.slice(0, 6)}…${pairAddress.slice(-4)}`
          : pairAddress;

      /* ── Trade dots for the chart ────────────────────────── */
      const tradeDots: ReactNode[] = [];
      if (hasTrades) {
        for (let i = 0; i < trades.length; i++) {
          const t = trades[i]!;
          const isLast = i === trades.length - 1;
          tradeDots.push(
            <ReferenceDot
              key={`td-${i}`}
              x={t.timestamp}
              y={t.priceEth}
              r={isLast ? 4 : 2.5}
              fill={t.side === "buy" ? "#22c55e" : "#ef4444"}
              fillOpacity={isLast ? 0.9 : 0.5}
              stroke={isLast ? (t.side === "buy" ? "#22c55e" : "#ef4444") : "none"}
              strokeWidth={isLast ? 1 : 0}
              strokeOpacity={0.3}
            />,
          );
        }
      }

      /* ── Tooltip ─────────────────────────────────────────── */
      const ChartTooltip = ({
        active,
        payload,
      }: {
        active?: boolean;
        payload?: Array<{ payload: TradeData }>;
      }) => {
        if (active !== true || payload === undefined || payload.length === 0) return null;
        const d = payload[0]!.payload;
        return (
          <div className="bg-popover/95 backdrop-blur-xl border border-border-light/50 rounded-xl px-3.5 py-2.5 shadow-[0_12px_48px_rgba(0,0,0,0.65)]">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`size-2 rounded-full ${d.side === "buy" ? "bg-emerald-400" : "bg-red-400"}`}
              />
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${d.side === "buy" ? "text-emerald-400" : "text-red-400"}`}
              >
                {d.side}
              </span>
              <span className="text-[9px] text-muted-foreground ml-auto">
                {new Date(d.timestamp * 1000).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>
            <div className="font-mono text-[15px] font-bold text-foreground leading-tight">
              {fmtEth(d.priceEth)}{" "}
              <span className="text-muted-foreground text-[9px] font-normal">ETH</span>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
              {fmtUsd(d.priceUsd)}
            </div>
            <div className="border-t border-border/40 mt-2 pt-1.5 flex items-center gap-3 text-[9px] text-muted-foreground">
              <span>{d.amountEth.toFixed(4)} ETH</span>
              <span className="text-border-light">·</span>
              <span className="font-mono">
                {d.trader.slice(0, 6)}…{d.trader.slice(-4)}
              </span>
            </div>
          </div>
        );
      };

      /* ── Empty / loading state text ──────────────────────── */
      const emptyTitle = pairAddress === undefined ? "Market Monitor" : "Awaiting Trades";
      const emptyMsg =
        pairAddress === undefined
          ? "This strategy discovers coins dynamically. Deploy to start scanning."
          : "No trade data yet — the chart will populate once trades occur.";

      return (
        <div
          className="w-full h-full bg-card/80 border rounded-xl flex flex-col overflow-hidden"
          style={{ minHeight: `${heightPx}px`, gridColumn: "1 / -1" }}
        >
          {/* ── Header ─────────────────────────────────────── */}
          <div className="flex items-center justify-between px-4 pt-3 pb-0 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Price
              </span>
              {truncAddr != null && (
                <span
                  className="text-[10px] font-mono text-muted-foreground/50"
                  title={pairAddress}
                >
                  {truncAddr}
                </span>
              )}
            </div>
            <span className="text-[9px] font-bold px-1.5 py-[2px] rounded bg-emerald-500/10 text-emerald-400 uppercase tracking-wider">
              RobinPump
            </span>
          </div>

          {/* ── Hero price + stats (only when data exists) ─── */}
          {hasTrades && lastTrade !== null && (
            <div className="px-4 pt-2.5 pb-1 shrink-0">
              {/* Current price — large hero number */}
              <div className="flex items-end gap-2.5 mb-1.5">
                <span className="font-mono text-[1.75rem] font-bold text-foreground leading-none tracking-tight">
                  {fmtEth(lastTrade.priceEth)}
                </span>
                <span className="text-xs text-muted-foreground font-mono mb-1">ETH</span>
                <span className={`text-sm font-bold font-mono mb-0.5 ${accentCls}`}>
                  {isUp ? "+" : ""}
                  {changePct.toFixed(1)}%
                </span>
              </div>
              {/* USD price */}
              <div className="text-[11px] font-mono text-muted-foreground mb-3">
                {fmtUsd(lastTrade.priceUsd)}
              </div>
              {/* Stats row */}
              <div className="flex items-center gap-5 text-[10px] mb-2.5">
                <div>
                  <span className="text-muted-foreground/60 uppercase tracking-wider text-[9px]">
                    High
                  </span>
                  <span className="font-mono text-foreground ml-1.5">{fmtEth(highEth)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground/60 uppercase tracking-wider text-[9px]">
                    Low
                  </span>
                  <span className="font-mono text-foreground ml-1.5">{fmtEth(lowEth)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground/60 uppercase tracking-wider text-[9px]">
                    Vol
                  </span>
                  <span className="font-mono text-foreground ml-1.5">
                    {totalVolEth.toFixed(4)} ETH
                  </span>
                </div>
              </div>
              {/* Price range bar — shows where current price sits between high and low */}
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-mono text-muted-foreground/40 w-8 text-right shrink-0">
                  Low
                </span>
                <div className="flex-1 h-[3px] bg-border/20 rounded-full relative">
                  <div className="absolute inset-0 rounded-full bg-linear-to-r from-red-500/25 via-amber-500/15 to-emerald-500/25" />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 size-[7px] rounded-full bg-foreground shadow-[0_0_6px_rgba(255,255,255,0.3)] transition-all duration-500"
                    style={{ left: `calc(${rangePct}% - 3.5px)` }}
                  />
                </div>
                <span className="text-[8px] font-mono text-muted-foreground/40 w-8 shrink-0">
                  High
                </span>
              </div>
            </div>
          )}

          {/* ── Chart area ─────────────────────────────────── */}
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4">
              <div className="flex items-center gap-2">
                <div className="size-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-muted-foreground text-[11px]">Loading price data…</span>
              </div>
              <div className="w-full max-w-[240px] space-y-1.5 opacity-30">
                <div className="h-[2px] w-3/4 bg-border rounded-full animate-pulse" />
                <div
                  className="h-[2px] w-full bg-border rounded-full animate-pulse"
                  style={{ animationDelay: "100ms" }}
                />
                <div
                  className="h-[2px] w-2/3 bg-border rounded-full animate-pulse"
                  style={{ animationDelay: "200ms" }}
                />
              </div>
            </div>
          ) : hasTrades ? (
            <div className="flex-1 min-h-0 px-1 pb-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trades} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={strokeColor} stopOpacity={0.22} />
                      <stop offset="40%" stopColor={strokeColor} stopOpacity={0.08} />
                      <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
                    </linearGradient>
                    <filter id={glowId}>
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 6"
                    stroke="var(--border)"
                    strokeOpacity={0.2}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(ts: number) =>
                      new Date(ts * 1000).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }
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
                    dataKey="priceEth"
                    domain={["auto", "auto"]}
                    tickFormatter={fmtEth}
                    tick={{
                      fill: "var(--muted-foreground)",
                      fontSize: 9,
                      fontFamily: "var(--font-mono)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={60}
                    orientation="right"
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke: "var(--gold-dim)", strokeWidth: 1, strokeDasharray: "4 4" }}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="priceEth"
                    stroke={strokeColor}
                    strokeWidth={2}
                    fill={`url(#${gradId})`}
                    dot={false}
                    filter={`url(#${glowId})`}
                    activeDot={(p: { cx?: number; cy?: number; payload?: TradeData }) => {
                      if (p.cx === undefined || p.cy === undefined || p.payload === undefined)
                        return <g />;
                      const c = p.payload.side === "buy" ? "#22c55e" : "#ef4444";
                      return (
                        <g>
                          <circle cx={p.cx} cy={p.cy} r="8" fill={c} opacity="0.1" />
                          <circle cx={p.cx} cy={p.cy} r="4" fill={c} opacity="0.25" />
                          <circle cx={p.cx} cy={p.cy} r="2" fill={c} opacity="0.95" />
                        </g>
                      );
                    }}
                    animationDuration={800}
                    animationEasing="ease-out"
                  />
                  {tradeDots}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center px-8">
              <div className="relative mb-4">
                <div className="size-12 rounded-full bg-emerald-500/6 border border-emerald-500/15 flex items-center justify-center">
                  <svg
                    width="22"
                    height="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-emerald-400"
                  >
                    <path d="M2 11h4l2.5-6 3.5 12 2.5-6H19" />
                  </svg>
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-card border border-border flex items-center justify-center">
                  <div className="size-1.5 rounded-full bg-muted-foreground/40" />
                </div>
              </div>
              <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider mb-1">
                {emptyTitle}
              </span>
              <span className="text-[10px] text-muted-foreground text-center max-w-[260px] leading-relaxed">
                {emptyMsg}
              </span>
            </div>
          )}

          {/* ── Footer — trade activity summary ────────────── */}
          {hasTrades && (
            <div className="flex items-center justify-between px-4 py-2 border-t border-border/30 shrink-0">
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="size-[5px] rounded-full bg-emerald-400" />
                  <span className="text-emerald-400 font-bold">{buyCount}</span>
                  <span className="text-muted-foreground">buys</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-[5px] rounded-full bg-red-400" />
                  <span className="text-red-400 font-bold">{sellCount}</span>
                  <span className="text-muted-foreground">sells</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <span className="font-mono">{trades.length} trades</span>
                {timeSpan !== "" && (
                  <>
                    <span className="text-border-light">·</span>
                    <span className="font-mono">{timeSpan}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      );
    },

    /* ── Number Input (shadcn Input) ──────────────────────── */
    NumberInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "number" ? stateVal : props.defaultValue;
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="number"
              value={val}
              min={props.min}
              max={props.max}
              step={props.step ?? 1}
              className="font-mono"
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) {
                  setState(path, v);
                  emit?.("press");
                }
              }}
            />
            {props.unit && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-medium">
                {props.unit}
              </span>
            )}
          </div>
        </div>
      );
    },

    /* ── ETH Input ────────────────────────────────────────── */
    EthInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "number" ? stateVal : props.defaultValue;
      const step = props.step ?? 0.0001;
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="number"
              value={val}
              min={props.min}
              max={props.max}
              step={step}
              className="font-mono"
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) {
                  setState(path, v);
                  emit?.("press");
                }
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-medium">
              ETH
            </span>
          </div>
        </div>
      );
    },

    /* ── USD Input ────────────────────────────────────────── */
    UsdInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "number" ? stateVal : props.defaultValue;
      const step = props.step ?? 100;
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="number"
              value={val}
              min={props.min}
              max={props.max}
              step={step}
              className="font-mono"
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) {
                  setState(path, v);
                  emit?.("press");
                }
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-medium">
              USD
            </span>
          </div>
        </div>
      );
    },

    /* ── Basis Points Input ───────────────────────────────── */
    BpsInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "number" ? stateVal : props.defaultValue;
      const min = props.min ?? 0;
      const max = props.max ?? 5000;
      const step = props.step ?? 25;
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="number"
              value={val}
              min={min}
              max={max}
              step={step}
              className="font-mono"
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                if (Number.isNaN(parsed)) return;
                let next = parsed;
                if (next < min) next = min;
                if (next > max) next = max;
                setState(path, next);
                emit?.("press");
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-medium">
              bps
            </span>
          </div>
        </div>
      );
    },

    /* ── Percent Input ────────────────────────────────────── */
    PercentInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "number" ? stateVal : props.defaultValue;
      const min = props.min ?? 0;
      const max = props.max ?? 100;
      const step = props.step ?? 1;
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="number"
              value={val}
              min={min}
              max={max}
              step={step}
              className="font-mono"
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                if (Number.isNaN(parsed)) return;
                let next = parsed;
                if (next < min) next = min;
                if (next > max) next = max;
                setState(path, next);
                emit?.("press");
              }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-medium">
              %
            </span>
          </div>
        </div>
      );
    },

    /* ── Integer Input ────────────────────────────────────── */
    IntegerInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "number" ? stateVal : props.defaultValue;
      const step = props.step ?? 1;
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="number"
              value={val}
              min={props.min}
              max={props.max}
              step={step}
              className="font-mono"
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                if (Number.isNaN(parsed)) return;
                let next = parsed;
                if (props.min !== undefined && next < props.min) next = props.min;
                if (props.max !== undefined && next > props.max) next = props.max;
                setState(path, next);
                emit?.("press");
              }}
            />
            {props.unit && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-medium">
                {props.unit}
              </span>
            )}
          </div>
        </div>
      );
    },

    /* ── Text Input (shadcn Input) ───────────────────────── */
    TextInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "string" ? stateVal : (props.defaultValue ?? "");
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="text"
              value={val}
              placeholder={props.placeholder}
              className="font-mono"
              onChange={(e) => {
                setState(path, e.target.value);
                emit?.("press");
              }}
            />
            {props.unit && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground font-medium">
                {props.unit}
              </span>
            )}
          </div>
        </div>
      );
    },

    /* ── Select Input ─────────────────────────────────────── */
    SelectInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "string" ? stateVal : props.defaultValue;
      let options: { label: string; value: string }[] = [];
      if (Array.isArray(props.options) && props.options.length > 0) {
        for (const opt of props.options) {
          if (typeof opt === "object" && opt !== null && "value" in opt) {
            const obj = opt as Record<string, unknown>;
            const rawValue = obj.value;
            if (rawValue == null) continue;
            const value = String(rawValue);
            const rawLabel = obj.label;
            const label = typeof rawLabel === "string" && rawLabel !== "" ? rawLabel : value;
            options.push({ label, value });
          } else if (typeof opt === "string") {
            options.push({ label: opt, value: opt });
          }
        }
      }
      if (options.length === 0 && val !== undefined)
        options.push({ label: String(val), value: String(val) });
      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <select
            value={val}
            onChange={(e) => {
              setState(path, e.target.value);
              emit?.("press");
            }}
            className="w-full bg-transparent border border-input rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-ring transition-colors appearance-none cursor-pointer"
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    },

    /* ── Toggle Input (shadcn Switch) ─────────────────────── */
    ToggleInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const on = typeof stateVal === "boolean" ? stateVal : (props.defaultValue ?? false);
      return (
        <div className="flex items-center justify-between gap-4 py-1">
          <div>
            <span className="text-sm font-medium text-foreground block">{props.label}</span>
            {props.description && (
              <span className="text-[11px] text-muted-foreground/70">{props.description}</span>
            )}
          </div>
          <Switch
            checked={on}
            onCheckedChange={(checked) => {
              setState(path, checked);
              emit?.("press");
            }}
          />
        </div>
      );
    },

    /* ── Address Input ────────────────────────────────────── */
    AddressInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "string" ? stateVal : (props.defaultValue ?? "");

      const allowEmpty = props.allowEmpty ?? true;
      const isValid = (() => {
        if (val === "" && allowEmpty) return true;
        return /^0x[a-fA-F0-9]{40}$/.test(val);
      })();

      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="text"
              value={val}
              placeholder={props.placeholder ?? "0x…"}
              className="font-mono"
              onChange={(e) => {
                setState(path, e.target.value.trim());
                emit?.("press");
              }}
            />
            <span
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium ${isValid ? "text-emerald-400/80" : "text-red-400/80"}`}
            >
              {isValid ? "ok" : "bad"}
            </span>
          </div>
        </div>
      );
    },

    /* ── Interval Input ───────────────────────────────────── */
    IntervalInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "string" ? stateVal : props.defaultValue;

      const isValid = val === "once" || /^(\d+)(s|m|h|d)$/.test(val);

      return (
        <div className="w-full space-y-1.5">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            {props.label}
          </Label>
          {props.description && (
            <p className="text-[11px] text-muted-foreground/70">{props.description}</p>
          )}
          <div className="relative">
            <Input
              type="text"
              value={val}
              placeholder="5m"
              className="font-mono"
              onChange={(e) => {
                setState(path, e.target.value.trim());
                emit?.("press");
              }}
            />
            <span
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium ${isValid ? "text-emerald-400/80" : "text-red-400/80"}`}
            >
              {isValid ? "ok" : "bad"}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/70 font-mono">
            Format: 30s · 5m · 1h · 1d · once
          </p>
        </div>
      );
    },

    /* ── Parameter Group ──────────────────────────────────── */
    ParameterGroup: ({ props, children }) => (
      <div className="flex-1 min-w-0 bg-card/60 border rounded-xl p-3">
        <h3 className="text-xs font-bold text-foreground uppercase tracking-[0.08em] mb-1">
          {props.title}
        </h3>
        {props.description && (
          <p className="text-[11px] text-muted-foreground mb-2">{props.description}</p>
        )}
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    ),

    /* ── Heading ──────────────────────────────────────────── */
    Heading: ({ props }) => {
      const cls =
        props.level === "h1"
          ? "font-display text-[2rem] leading-tight text-foreground"
          : props.level === "h3"
            ? "text-sm font-semibold text-foreground"
            : "font-display text-xl text-foreground";
      return (
        <div className={cls} style={{ gridColumn: "1 / -1" }}>
          {props.text}
        </div>
      );
    },

    /* ── Text ─────────────────────────────────────────────── */
    Text: ({ props }) => {
      const cls =
        props.variant === "caption"
          ? "text-xs text-muted-foreground"
          : props.variant === "code" || props.variant === "mono"
            ? "font-mono text-[13px] text-text-secondary bg-card/80 rounded px-2 py-1"
            : "text-sm text-text-secondary leading-relaxed";
      return <p className={cls}>{props.content}</p>;
    },

    /* ── Badge ────────────────────────────────────────────── */
    Badge: ({ props }) => {
      const BADGE: Record<string, string> = {
        green: "bg-emerald-500/10 text-emerald-400",
        amber: "bg-amber-500/10 text-amber-400",
        red: "bg-red-500/10 text-red-400",
        blue: "bg-blue-500/10 text-blue-400",
        violet: "bg-violet-500/10 text-violet-400",
        zinc: "bg-secondary text-muted-foreground",
      };
      return (
        <span
          className={`inline-flex text-[10px] font-bold px-2 py-[3px] rounded-md ${BADGE[props.color ?? "zinc"]}`}
        >
          {props.label}
        </span>
      );
    },

    /* ── Info Box ─────────────────────────────────────────── */
    InfoBox: ({ props }) => {
      const V: Record<string, string> = {
        info: "bg-blue-500/[0.04] border-blue-500/15 text-blue-300",
        warning: "bg-amber-500/[0.04] border-amber-500/15 text-amber-300",
        success: "bg-emerald-500/[0.04] border-emerald-500/15 text-emerald-300",
        error: "bg-red-500/[0.04] border-red-500/15 text-red-300",
      };
      return (
        <div
          className={`border rounded-xl p-4 ${V[props.variant ?? "info"]}`}
          style={{ gridColumn: "1 / -1" }}
        >
          {props.title && <span className="text-xs font-bold block mb-1">{props.title}</span>}
          <p className="text-[13px] leading-relaxed opacity-90">{props.content}</p>
        </div>
      );
    },

    /* ── Divider ──────────────────────────────────────────── */
    Divider: () => <hr className="border-border my-1" style={{ gridColumn: "1 / -1" }} />,

    /* ── Trade History ────────────────────────────────────── */
    TradeHistory: ({ props }) => {
      const { get } = useStateStore();
      const rawId = get("/__strategyId");
      const strategyId = typeof rawId === "string" && rawId !== "" ? rawId : undefined;

      const perfQuery = useStrategyPerformance({
        id: strategyId,
        range: "all",
        enabled: strategyId !== undefined,
        pollMs: strategyId !== undefined ? 5000 : undefined,
      });

      const maxItems = props.maxItems;
      const rows: ReactNode[] = [];

      const trades = perfQuery.data?.trades ?? [];
      const nowSec = Math.floor(Date.now() / 1000);
      for (let i = trades.length - 1; i >= 0 && rows.length < maxItems; i--) {
        const t = trades[i]!;
        const isBuy = t.side === "buy";
        const truncHash =
          t.txHash.length > 14 ? `${t.txHash.slice(0, 6)}…${t.txHash.slice(-4)}` : t.txHash;
        const pairLabel =
          t.pairAddress.length > 14
            ? `${t.pairAddress.slice(0, 6)}…${t.pairAddress.slice(-4)}`
            : t.pairAddress;

        const ageSec = nowSec - t.timestamp;
        let timeLabel = "just now";
        if (ageSec >= 0) {
          if (ageSec < 60) timeLabel = `${ageSec}s ago`;
          else if (ageSec < 3600) timeLabel = `${Math.floor(ageSec / 60)} min ago`;
          else if (ageSec < 86400) timeLabel = `${Math.floor(ageSec / 3600)} hr ago`;
          else timeLabel = `${Math.floor(ageSec / 86400)} d ago`;
        }

        const amountLabel = `${t.amountEth.toLocaleString("en-US", { maximumFractionDigits: 8 })} ETH`;

        rows.push(
          <div key={`${t.idx}:${t.txHash}`} className="flex items-center gap-2 py-2 px-1">
            <span
              className={`size-1.5 rounded-full shrink-0 ${isBuy ? "bg-emerald-400" : "bg-red-400"}`}
            />
            <span
              className={`text-[10px] font-bold uppercase tracking-wider w-8 shrink-0 ${isBuy ? "text-emerald-400" : "text-red-400"}`}
            >
              {t.side}
            </span>
            <span className="text-sm font-mono text-foreground shrink-0">{amountLabel}</span>
            <span
              className="text-[11px] text-muted-foreground truncate min-w-0"
              title={t.pairAddress}
            >
              {pairLabel}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
              {timeLabel}
            </span>
            <a
              href={`https://basescan.org/tx/${t.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-gold-dim hover:text-gold-bright transition-colors shrink-0"
              title={t.txHash}
            >
              {truncHash}
            </a>
          </div>,
        );
      }

      let body: ReactNode = null;
      const isInitialLoad =
        strategyId !== undefined && perfQuery.data === undefined && perfQuery.isFetching;
      if (strategyId === undefined) {
        body = (
          <div className="py-3 px-1 text-[11px] text-muted-foreground">
            Deploy your strategy to see recent trades here.
          </div>
        );
      } else if (isInitialLoad) {
        const skels: ReactNode[] = [];
        for (let i = 0; i < Math.min(3, maxItems); i++) {
          skels.push(
            <div key={`skel:${i}`} className="py-2 px-1 flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-border/60 shrink-0" />
              <div className="h-3 w-8 rounded bg-border/40 shrink-0" />
              <div className="h-4 w-24 rounded bg-border/30 shrink-0" />
              <div className="h-3 flex-1 rounded bg-border/20 min-w-0" />
              <div className="h-3 w-14 rounded bg-border/30 shrink-0" />
              <div className="h-3 w-16 rounded bg-border/30 shrink-0" />
            </div>,
          );
        }
        body = skels;
      } else if (perfQuery.isError) {
        body = <div className="py-3 px-1 text-[11px] text-red-300">Failed to load trades</div>;
      } else if (rows.length === 0) {
        body = <div className="py-3 px-1 text-[11px] text-muted-foreground">No trades yet.</div>;
      } else {
        body = rows;
      }

      return (
        <div
          className="w-full bg-card/80 border border-border rounded-xl p-3 overflow-hidden"
          style={{ gridColumn: "1 / -1" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Recent Trades
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">Last {maxItems}</span>
          </div>
          <div className="flex flex-col divide-y divide-border/50">{body}</div>
        </div>
      );
    },

    /* ── Trade Row ────────────────────────────────────────── */
    TradeRow: ({ props }) => {
      const isBuy = props.side === "buy";
      const truncHash =
        props.hash != null && props.hash.length > 14
          ? `${props.hash.slice(0, 6)}…${props.hash.slice(-4)}`
          : props.hash;
      return (
        <div className="flex items-center gap-2 py-2 px-1">
          <span
            className={`size-1.5 rounded-full shrink-0 ${isBuy ? "bg-emerald-400" : "bg-red-400"}`}
          />
          <span
            className={`text-[10px] font-bold uppercase tracking-wider w-8 shrink-0 ${isBuy ? "text-emerald-400" : "text-red-400"}`}
          >
            {props.side}
          </span>
          <span className="text-sm font-mono text-foreground shrink-0">{props.amount}</span>
          <span className="text-[11px] text-muted-foreground truncate min-w-0">{props.pair}</span>
          <span className="ml-auto text-[10px] text-muted-foreground font-mono shrink-0">
            {props.time}
          </span>
          {truncHash != null && (
            <a
              href={`https://basescan.org/tx/${props.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-gold-dim hover:text-gold-bright transition-colors shrink-0"
              title={props.hash}
            >
              {truncHash}
            </a>
          )}
        </div>
      );
    },

    /* ── Progress Bar ─────────────────────────────────────── */
    ProgressBar: ({ props }) => {
      const COLORS: Record<string, { bar: string; bg: string; text: string }> = {
        emerald: { bar: "bg-emerald-400", bg: "bg-emerald-400/10", text: "text-emerald-400" },
        blue: { bar: "bg-blue-400", bg: "bg-blue-400/10", text: "text-blue-400" },
        amber: { bar: "bg-amber-400", bg: "bg-amber-400/10", text: "text-amber-400" },
        red: { bar: "bg-red-400", bg: "bg-red-400/10", text: "text-red-400" },
        violet: { bar: "bg-violet-400", bg: "bg-violet-400/10", text: "text-violet-400" },
      };
      const c = COLORS[props.color] ?? COLORS.emerald!;
      const clamped = Math.max(0, Math.min(100, props.value));
      return (
        <div className="w-full">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {props.label}
            </span>
            <span className={`text-xs font-mono font-bold ${c.text}`}>
              {clamped}
              {props.unit ?? "%"}
            </span>
          </div>
          <div className={`w-full h-1.5 rounded-full ${c.bg}`}>
            <div
              className={`h-full rounded-full ${c.bar} transition-all duration-500 ease-out`}
              style={{ width: `${clamped}%` }}
            />
          </div>
        </div>
      );
    },

    /* ── Status Indicator ─────────────────────────────────── */
    StatusIndicator: ({ props }) => {
      const STATUS: Record<string, { dot: string; text: string; pulse: boolean }> = {
        active: { dot: "bg-emerald-400", text: "text-emerald-400", pulse: true },
        paused: { dot: "bg-amber-400", text: "text-amber-400", pulse: false },
        waiting: { dot: "bg-blue-400", text: "text-blue-400", pulse: true },
        error: { dot: "bg-red-400", text: "text-red-400", pulse: false },
        success: { dot: "bg-emerald-400", text: "text-emerald-400", pulse: false },
      };
      const s = STATUS[props.status] ?? STATUS.active!;
      return (
        <div
          className="flex items-center gap-2.5 bg-card/80 border border-border rounded-xl p-3"
          style={{ gridColumn: "1 / -1" }}
        >
          <span className="relative flex size-2.5 shrink-0">
            {s.pulse && (
              <span
                className={`animate-ping absolute inline-flex size-full rounded-full ${s.dot} opacity-50`}
              />
            )}
            <span className={`relative inline-flex rounded-full size-2.5 ${s.dot}`} />
          </span>
          <div className="min-w-0">
            <span className={`text-xs font-bold capitalize ${s.text}`}>{props.status}</span>
            <span className="text-sm text-foreground ml-2">{props.label}</span>
            {props.description != null && (
              <p className="text-[11px] text-muted-foreground mt-0.5">{props.description}</p>
            )}
          </div>
        </div>
      );
    },

    /* ── Coin Card ────────────────────────────────────────── */
    CoinCard: ({ props }) => {
      let avatarUrl: string | undefined;
      if (props.imageUrl != null && props.imageUrl !== "") {
        if (props.imageUrl.startsWith("ipfs://")) {
          avatarUrl = `https://olive-defensive-giraffe-83.mypinata.cloud/ipfs/${props.imageUrl.slice(7)}`;
        } else {
          avatarUrl = props.imageUrl;
        }
      }
      const initials = props.symbol.slice(0, 2).toUpperCase();
      const truncAddr =
        props.pairAddress != null && props.pairAddress.length > 14
          ? `${props.pairAddress.slice(0, 6)}…${props.pairAddress.slice(-4)}`
          : props.pairAddress;
      return (
        <div className="flex items-center gap-3 bg-card/80 border border-border rounded-xl p-3">
          <div className="shrink-0 size-9 rounded-full bg-secondary border border-border flex items-center justify-center overflow-hidden">
            {avatarUrl != null ? (
              <img src={avatarUrl} alt={props.symbol} className="size-full object-cover" />
            ) : (
              <span className="text-[11px] font-bold text-muted-foreground">{initials}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground truncate">{props.name}</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase">
                {props.symbol}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {props.priceEth != null && (
                <span className="text-xs font-mono text-foreground">
                  {props.priceEth} <span className="text-muted-foreground text-[10px]">ETH</span>
                </span>
              )}
              {props.priceUsd != null && (
                <span className="text-[10px] font-mono text-muted-foreground">
                  ${props.priceUsd}
                </span>
              )}
            </div>
            {truncAddr != null && (
              <span
                className="text-[10px] font-mono text-muted-foreground/60 mt-0.5 block"
                title={props.pairAddress}
              >
                {truncAddr}
              </span>
            )}
          </div>
        </div>
      );
    },

    /* ── Coin List ────────────────────────────────────────── */
    CoinList: ({ props, children }) => (
      <div className="w-full" style={{ gridColumn: "1 / -1" }}>
        {props.title != null && (
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-2">
            {props.title}
          </span>
        )}
        <div className={props.layout === "grid" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
          {children}
        </div>
      </div>
    ),

    /* ── Alert Banner ─────────────────────────────────────── */
    AlertBanner: ({ props }) => {
      const [dismissed, setDismissed] = useState(false);
      if (dismissed) return null;
      const VARIANTS: Record<string, { bg: string; border: string; icon: string; text: string }> = {
        info: {
          bg: "bg-blue-500/[0.06]",
          border: "border-blue-500/20",
          icon: "text-blue-400",
          text: "text-blue-200",
        },
        warning: {
          bg: "bg-amber-500/[0.06]",
          border: "border-amber-500/20",
          icon: "text-amber-400",
          text: "text-amber-200",
        },
        success: {
          bg: "bg-emerald-500/[0.06]",
          border: "border-emerald-500/20",
          icon: "text-emerald-400",
          text: "text-emerald-200",
        },
        error: {
          bg: "bg-red-500/[0.06]",
          border: "border-red-500/20",
          icon: "text-red-400",
          text: "text-red-200",
        },
      };
      const ICONS: Record<string, ReactNode> = {
        info: (
          <svg width="16" height="16" fill="none" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 7v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="5" r="0.75" fill="currentColor" />
          </svg>
        ),
        warning: (
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 16 16"
          >
            <path d="M8 1.5L1 14h14L8 1.5z" />
            <path d="M8 6v3.5" />
            <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
          </svg>
        ),
        success: (
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 16 16"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M5.5 8l2 2 3-3.5" />
          </svg>
        ),
        error: (
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 16 16"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M6 6l4 4M10 6l-4 4" />
          </svg>
        ),
      };
      const v = VARIANTS[props.variant] ?? VARIANTS.info!;
      return (
        <div
          className={`${v.bg} border ${v.border} rounded-xl p-3 flex items-start gap-2.5`}
          style={{ gridColumn: "1 / -1" }}
        >
          <span className={`shrink-0 mt-0.5 ${v.icon}`}>{ICONS[props.variant]}</span>
          <p className={`text-[13px] leading-relaxed flex-1 ${v.text}`}>{props.message}</p>
          {props.dismissible === true && (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          )}
        </div>
      );
    },

    /* ── Schedule Display ─────────────────────────────────── */
    ScheduleDisplay: ({ props }) => (
      <div
        className="w-full bg-card/80 border border-border rounded-xl p-3"
        style={{ gridColumn: "1 / -1" }}
      >
        <div className="flex items-center gap-2 mb-2.5">
          <svg
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-gold-dim"
            viewBox="0 0 16 16"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 4.5v3.5l2.5 2" />
          </svg>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Schedule
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <div>
            <span className="text-[10px] text-muted-foreground block mb-0.5">Interval</span>
            <span className="text-sm font-mono font-bold text-foreground">{props.interval}</span>
          </div>
          {props.nextRun != null && (
            <div>
              <span className="text-[10px] text-muted-foreground block mb-0.5">Next Run</span>
              <span className="text-sm font-mono text-foreground">{props.nextRun}</span>
            </div>
          )}
          {props.lastRun != null && (
            <div>
              <span className="text-[10px] text-muted-foreground block mb-0.5">Last Run</span>
              <span className="text-sm font-mono text-foreground">{props.lastRun}</span>
            </div>
          )}
          {props.runCount != null && (
            <div>
              <span className="text-[10px] text-muted-foreground block mb-0.5">Total Runs</span>
              <span className="text-sm font-mono font-bold text-foreground">
                {props.runCount.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>
    ),

    /* ── Stat (Hero Statistic) ────────────────────────────── */
    Stat: ({ props }) => {
      const ICONS: Record<string, ReactNode> = {
        wallet: (
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 20 20"
          >
            <rect x="2" y="5" width="16" height="12" rx="2" />
            <path d="M2 9h16" />
            <circle cx="14.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        ),
        chart: (
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 20 20"
          >
            <path d="M2 15l5-8 4 5 7-9" />
          </svg>
        ),
        bolt: (
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 20 20"
          >
            <path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z" />
          </svg>
        ),
        clock: (
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 20 20"
          >
            <circle cx="10" cy="10" r="8" />
            <path d="M10 5v5l3.5 3.5" />
          </svg>
        ),
        coins: (
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            viewBox="0 0 20 20"
          >
            <circle cx="7.5" cy="10.5" r="5.5" />
            <path d="M13 5a5.5 5.5 0 010 11" />
          </svg>
        ),
        trending: (
          <svg
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 20 20"
          >
            <path d="M3 15l4-4 3 3 7-8" />
            <path d="M14 6h3v3" />
          </svg>
        ),
      };
      const COLORS: Record<string, { icon: string; value: string }> = {
        emerald: { icon: "text-emerald-400", value: "text-emerald-400" },
        blue: { icon: "text-blue-400", value: "text-blue-400" },
        amber: { icon: "text-amber-400", value: "text-amber-400" },
        red: { icon: "text-red-400", value: "text-red-400" },
        violet: { icon: "text-violet-400", value: "text-violet-400" },
        gold: { icon: "text-gold-bright", value: "text-gold-bright" },
      };
      const c = COLORS[props.color ?? "emerald"] ?? COLORS.emerald!;
      const icon = props.icon != null ? (ICONS[props.icon] ?? null) : null;
      return (
        <div className="flex-1 min-w-0 bg-card/80 border border-border rounded-xl p-3">
          {icon != null && <div className={`mb-1.5 ${c.icon}`}>{icon}</div>}
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-0.5">
            {props.label}
          </span>
          <span className={`text-2xl font-display font-bold ${c.value}`}>{props.value}</span>
          {props.description != null && (
            <p className="text-[11px] text-muted-foreground mt-1">{props.description}</p>
          )}
        </div>
      );
    },

    /* ── Stat Row ─────────────────────────────────────────── */
    StatRow: ({ children }) => (
      <div
        className="w-full grid grid-cols-2 gap-2.5 sm:grid-cols-4"
        style={{ gridColumn: "1 / -1" }}
      >
        {children}
      </div>
    ),
  },
});
