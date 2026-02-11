import { defineRegistry, useStateStore } from "@json-render/react";
import { catalog } from "./catalog";
import { useState, useEffect, type ReactNode } from "react";

/**
 * React component registry — maps every catalog component
 * to a real React component styled with our Obsidian Gold theme.
 */
export const { registry } = defineRegistry(catalog, {
  components: {
    /* ── Container ────────────────────────────────────────── */
    Container: ({ props, children }) => {
      const isGrid = props.layout === "grid";

      if (isGrid) {
        /* Fixed column grid — collapses to 1 column on narrow screens via CSS media query.
           Children that need full width use gridColumn: "1 / -1" on their own. */
        const gapPx = props.gap === "none" ? 0 : props.gap === "sm" ? 10 : props.gap === "lg" ? 20 : 14;
        const cols = props.columns === "1" ? 1 : props.columns === "3" ? 3 : 2;
        return (
          <div
            className="[&>*]:min-w-0 [&>*]:min-h-0 bento-grid"
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

      const gapPx = props.gap === "none" ? 0 : props.gap === "sm" ? 10 : props.gap === "lg" ? 20 : 14;
      const isHorizontal = props.direction === "horizontal";
      return (
        <div
          style={{
            display: "flex",
            flexDirection: isHorizontal ? "row" : "column",
            flexWrap: isHorizontal ? "wrap" : undefined,
            gap: `${gapPx}px`,
            alignItems: "stretch",
            width: "100%",
            height: isHorizontal ? undefined : "100%",
            minWidth: 0,
            gridColumn: isHorizontal ? "1 / -1" : undefined,
          }}
        >
          {children}
        </div>
      );
    },

    /* ── Strategy Header ─────────────────────────────────── */
    StrategyHeader: ({ props }) => {
      const exchangeColors: Record<string, string> = {
        robinpump: "bg-emerald-500/10 text-emerald-400",
      };
      const statusColors: Record<string, string> = {
        draft: "bg-zinc-500/10 text-zinc-400",
        active: "bg-emerald-500/10 text-emerald-400",
        paused: "bg-amber-500/10 text-amber-400",
        error: "bg-red-500/10 text-red-400",
      };
      return (
        <div style={{ gridColumn: "1 / -1" }}>
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.12em] mb-2 block">
            Strategy
          </span>
          <h2 className="font-display text-[1.5rem] leading-tight text-text mb-1">{props.name}</h2>
          {props.description && (
            <p className="text-sm text-text-secondary leading-relaxed mb-2">{props.description}</p>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold px-2 py-[3px] rounded-md uppercase tracking-wider ${exchangeColors[props.exchange] ?? "bg-zinc-500/10 text-zinc-400"}`}
            >
              {props.exchange}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-[3px] rounded-md capitalize ${statusColors[props.status ?? "draft"]}`}
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
        blue: {
          border: "border-blue-500/20",
          bg: "bg-blue-500/[0.04]",
          tag: "text-blue-400",
        },
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
        amber: {
          border: "border-amber-500/20",
          bg: "bg-amber-500/[0.04]",
          tag: "text-amber-400",
        },
        red: {
          border: "border-red-500/20",
          bg: "bg-red-500/[0.04]",
          tag: "text-red-400",
        },
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
        <div className={`flex-1 min-w-0 border ${c.border} ${c.bg} rounded-xl p-3 animate-fade-in flex items-center`}>
          <div className="flex items-center gap-2.5 w-full">
            <div className={`shrink-0 ${c.tag}`}>{icon}</div>
            <div>
              <span className={`text-[10px] font-bold uppercase tracking-[0.12em] ${c.tag}`}>
                {props.tag}
              </span>
              <p className="text-sm font-medium text-text mt-0.5">{
                /* Interpolate {paramKey} tokens in label with live state values */
                props.label.replace(/\{(\w+)\}/g, (_match, key: string) => {
                  const val = get(`/${key}`);
                  if (val == null) return _match;
                  if (typeof val === "number") return val.toLocaleString("en-US", { maximumFractionDigits: 10 });
                  return String(val);
                })
              }</p>
            </div>
          </div>
        </div>
      );
    },

    /* ── Connector ────────────────────────────────────────── */
    Connector: ({ props }) => (
      <div className="flex items-center justify-center shrink-0 px-0.5">
        {props.style === "arrow" ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-border-light/80">
            <path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
            : "text-text-muted";
      /* Resolve state path bindings: the AI may emit {"path":"/paramKey"}
         which json-render doesn't auto-resolve for prop values. */
      const rawValue: unknown = props.value;
      let resolved: unknown = rawValue;
      if (typeof rawValue === "object" && rawValue !== null && "path" in rawValue) {
        resolved = get((rawValue as { path: string }).path);
      }
      /* Format numbers nicely: 3000 → "3,000", 0.015 → "0.015" */
      let displayValue: string;
      if (resolved == null) {
        displayValue = "";
      } else if (typeof resolved === "number" || (typeof resolved === "string" && resolved !== "" && !isNaN(Number(resolved)))) {
        const num = Number(resolved);
        displayValue = Number.isFinite(num)
          ? num.toLocaleString("en-US", { maximumFractionDigits: 10 })
          : String(resolved);
      } else {
        displayValue = String(resolved);
      }
      return (
        <div className="w-full h-full bg-surface/80 border border-border rounded-xl p-2.5 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.1em] block mb-0.5">
            {props.label}
          </span>
          <span className={`text-lg font-bold ${trendColor}`}>
            {displayValue}
            {props.unit && (
              <span className="text-xs font-normal text-text-muted ml-1">{props.unit}</span>
            )}
          </span>
        </div>
      );
    },

    /* ── Metric Row ───────────────────────────────────────── */
    MetricRow: ({ children }) => (
      <div className="w-full h-full grid grid-cols-2 auto-rows-fr gap-2.5">{children}</div>
    ),

    /* ── Price Chart (real trade data) ────────────────────── */
    PriceChart: ({ props }) => {
      const heightPx = props.height === "sm" ? 128 : props.height === "lg" ? 256 : 180;

      interface TradePoint {
        priceEth: number;
        timestamp: number;
        side: string;
      }

      const [trades, setTrades] = useState<TradePoint[]>([]);
      const [chartLoading, setChartLoading] = useState(true);

      useEffect(() => {
        if (!props.pair) {
          setChartLoading(false);
          return;
        }
        let cancelled = false;
        setChartLoading(true);

        fetch(`/api/robinpump/coins/${props.pair}/trades?limit=50`)
          .then((r) => r.json())
          .then((data: unknown) => {
            if (cancelled || !Array.isArray(data)) return;
            /* Trades come desc — reverse for chronological */
            const chronological: TradePoint[] = [];
            for (let i = data.length - 1; i >= 0; i--) {
              chronological.push(data[i]);
            }
            setTrades(chronological);
          })
          .catch(() => {
            if (!cancelled) setTrades([]);
          })
          .finally(() => {
            if (!cancelled) setChartLoading(false);
          });

        return () => {
          cancelled = true;
        };
      }, [props.pair]);

      /* Build chart from trade data or fall back to demo */
      const hasTrades = trades.length >= 2;
      const W = 600;
      const chartH = heightPx - 28;

      let linePath = "";
      let areaPath = "";
      let lineColor = "#22c55e";
      const priceLabels: ReactNode[] = [];
      const tradeDots: ReactNode[] = [];

      if (hasTrades) {
        const pad = { t: 8, r: 8, b: 8, l: 8 };
        const pw = W - pad.l - pad.r;
        const ph = chartH - pad.t - pad.b;

        let minP = Infinity;
        let maxP = -Infinity;
        let minT = Infinity;
        let maxT = -Infinity;

        for (const t of trades) {
          if (t.priceEth < minP) minP = t.priceEth;
          if (t.priceEth > maxP) maxP = t.priceEth;
          if (t.timestamp < minT) minT = t.timestamp;
          if (t.timestamp > maxT) maxT = t.timestamp;
        }

        const tr = maxT - minT || 1;
        const rawPr = maxP - minP || maxP * 0.1 || 0.000001;
        minP -= rawPr * 0.1;
        maxP += rawPr * 0.1;
        const pr = maxP - minP;

        const points: string[] = [];
        for (const t of trades) {
          const x = pad.l + ((t.timestamp - minT) / tr) * pw;
          const y = pad.t + ph - ((t.priceEth - minP) / pr) * ph;
          points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }

        linePath = `M ${points.join(" L ")}`;
        const bottomY = (pad.t + ph).toFixed(1);
        const firstX = (pad.l + ((trades[0]!.timestamp - minT) / tr) * pw).toFixed(1);
        const lastX = (pad.l + ((trades[trades.length - 1]!.timestamp - minT) / tr) * pw).toFixed(1);
        areaPath = `${linePath} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

        const isUp = trades[trades.length - 1]!.priceEth >= trades[0]!.priceEth;
        lineColor = isUp ? "#22c55e" : "#ef4444";

        /* Scatter dots for buys/sells */
        for (let i = 0; i < trades.length; i++) {
          const t = trades[i]!;
          if (i % 4 === 0 || i === trades.length - 1) {
            const x = pad.l + ((t.timestamp - minT) / tr) * pw;
            const y = pad.t + ph - ((t.priceEth - minP) / pr) * ph;
            tradeDots.push(
              <circle
                key={i}
                cx={x}
                cy={y}
                r="2"
                fill={t.side === "buy" ? "#22c55e" : "#ef4444"}
                opacity="0.6"
              />,
            );
          }
        }
      } else if (!chartLoading) {
        /* Fallback: demo candles when no real data */
        const candles = generateDemoCandles(24);
        let maxH = -Infinity;
        let minL = Infinity;
        for (const c of candles) {
          if (c.high > maxH) maxH = c.high;
          if (c.low < minL) minL = c.low;
        }
        const range = maxH - minL || 1;

        for (let i = 0; i < candles.length; i++) {
          const c = candles[i]!;
          const x = i * 14 + 4;
          const yHigh = ((maxH - c.high) / range) * 90 + 5;
          const yLow = ((maxH - c.low) / range) * 90 + 5;
          const yOpen = ((maxH - c.open) / range) * 90 + 5;
          const yClose = ((maxH - c.close) / range) * 90 + 5;
          const isUp = c.close >= c.open;
          const color = isUp ? "#22c55e" : "#ef4444";
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
          tradeDots.push(
            <g key={`candle-${i}`}>
              <line x1={x + 3} y1={yHigh} x2={x + 3} y2={yLow} stroke={color} strokeWidth="0.8" opacity="0.5" />
              <rect x={x} y={bodyTop} width="6" height={bodyH} fill={color} rx="0.5" opacity="0.85" />
            </g>,
          );
        }
      }

      return (
        <div
          className="w-full h-full bg-surface/80 border border-border rounded-xl p-2.5 relative overflow-hidden"
          style={{ minHeight: `${heightPx}px`, gridColumn: "1 / -1" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.1em]">
              {props.pair}
            </span>
            <span className="text-[10px] font-bold px-1.5 py-[2px] rounded bg-emerald-500/10 text-emerald-400 uppercase">
              RobinPump
            </span>
          </div>
          {chartLoading ? (
            <div className="flex items-center justify-center" style={{ height: `${chartH}px` }}>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-text-muted text-[11px]">Loading price data…</span>
              </div>
            </div>
          ) : hasTrades ? (
            <svg
              viewBox={`0 0 ${W} ${chartH}`}
              style={{ width: "100%", height: `${chartH}px` }}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="pc-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.12" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              {priceLabels}
              <path d={areaPath} fill="url(#pc-grad)" />
              <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {tradeDots}
            </svg>
          ) : (
            <svg
              viewBox={`0 0 ${24 * 14} 100`}
              style={{ width: "100%", height: `${chartH}px` }}
              preserveAspectRatio="none"
            >
              {tradeDots}
            </svg>
          )}
        </div>
      );
    },

    /* ── Number Input ─────────────────────────────────────── */
    NumberInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const val = typeof stateVal === "number" ? stateVal : props.defaultValue;
      return (
        <div className="w-full">
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.08em] mb-1.5 block">
            {props.label}
          </label>
          {props.description && (
            <p className="text-[11px] text-text-muted/70 mb-1.5">{props.description}</p>
          )}
          <div className="relative">
            <input
              type="number"
              value={val}
              min={props.min}
              max={props.max}
              step={props.step ?? 1}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) {
                  setState(path, v);
                  emit?.("press");
                }
              }}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text font-mono focus:outline-none focus:border-gold/30 transition-colors"
            />
            {props.unit && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted font-medium">
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

      /* Build options list — handle missing/malformed options from AI */
      let options: { label: string; value: string }[] = [];
      if (Array.isArray(props.options) && props.options.length > 0) {
        for (const opt of props.options) {
          if (typeof opt === "object" && opt !== null && "value" in opt) {
            options.push({ label: String((opt as { label?: string }).label ?? (opt as { value: string }).value), value: String((opt as { value: string }).value) });
          } else if (typeof opt === "string") {
            options.push({ label: opt, value: opt });
          }
        }
      }
      /* If no valid options, generate from the default value */
      if (options.length === 0 && val !== undefined) {
        options.push({ label: String(val), value: String(val) });
      }

      return (
        <div className="w-full">
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-[0.08em] mb-1.5 block">
            {props.label}
          </label>
          {props.description && (
            <p className="text-[11px] text-text-muted/70 mb-1.5">{props.description}</p>
          )}
          <select
            value={val}
            onChange={(e) => {
              setState(path, e.target.value);
              emit?.("press");
            }}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-text focus:outline-none focus:border-gold/30 transition-colors appearance-none cursor-pointer"
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

    /* ── Toggle Input ─────────────────────────────────────── */
    ToggleInput: ({ props, emit }) => {
      const { get, set: setState } = useStateStore();
      const path = `/${props.paramKey}`;
      const stateVal = get(path);
      const on = typeof stateVal === "boolean" ? stateVal : (props.defaultValue ?? false);
      return (
        <div className="flex items-center justify-between gap-4 py-1">
          <div>
            <span className="text-sm font-medium text-text block">{props.label}</span>
            {props.description && (
              <span className="text-[11px] text-text-muted/70">{props.description}</span>
            )}
          </div>
          <button
            onClick={() => {
              setState(path, !on);
              emit?.("press");
            }}
            className={`relative shrink-0 w-10 h-[22px] rounded-full transition-colors cursor-pointer ${on ? "bg-gold" : "bg-surface-3 border border-border"}`}
          >
            <span
              className={`absolute top-[3px] w-4 h-4 rounded-full transition-transform bg-white shadow-sm ${on ? "left-[22px]" : "left-[3px]"}`}
            />
          </button>
        </div>
      );
    },

    /* ── Parameter Group ──────────────────────────────────── */
    ParameterGroup: ({ props, children }) => (
      <div className="w-full h-full bg-surface/60 border border-border rounded-xl p-3">
        <h3 className="text-xs font-bold text-text uppercase tracking-[0.08em] mb-1">
          {props.title}
        </h3>
        {props.description && (
          <p className="text-[11px] text-text-muted mb-2">{props.description}</p>
        )}
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    ),

    /* ── Heading ──────────────────────────────────────────── */
    Heading: ({ props }) => {
      const cls =
        props.level === "h1"
          ? "font-display text-[2rem] leading-tight text-text"
          : props.level === "h3"
            ? "text-sm font-semibold text-text"
            : "font-display text-xl text-text";
      return <div className={cls} style={{ gridColumn: "1 / -1" }}>{props.text}</div>;
    },

    /* ── Text ─────────────────────────────────────────────── */
    Text: ({ props }) => {
      const cls =
        props.variant === "caption"
          ? "text-xs text-text-muted"
          : props.variant === "code" || props.variant === "mono"
            ? "font-mono text-[13px] text-text-secondary bg-surface/80 rounded px-2 py-1"
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
        zinc: "bg-zinc-500/10 text-zinc-400",
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
      const VARIANT: Record<string, string> = {
        info: "bg-blue-500/[0.04] border-blue-500/15 text-blue-300",
        warning: "bg-amber-500/[0.04] border-amber-500/15 text-amber-300",
        success: "bg-emerald-500/[0.04] border-emerald-500/15 text-emerald-300",
        error: "bg-red-500/[0.04] border-red-500/15 text-red-300",
      };
      return (
        <div className={`border rounded-xl p-4 ${VARIANT[props.variant ?? "info"]}`} style={{ gridColumn: "1 / -1" }}>
          {props.title && <span className="text-xs font-bold block mb-1">{props.title}</span>}
          <p className="text-[13px] leading-relaxed opacity-90">{props.content}</p>
        </div>
      );
    },

    /* ── Divider ──────────────────────────────────────────── */
    Divider: () => <hr className="border-border my-1" style={{ gridColumn: "1 / -1" }} />,
  },
});

/* ── Demo chart data generator ─────────────────────────────── */
function generateDemoCandles(count: number) {
  const candles: { open: number; close: number; high: number; low: number }[] = [];
  let price = 58000 + Math.sin(Date.now() / 100000) * 5000;
  for (let i = 0; i < count; i++) {
    const volatility = price * 0.015;
    const change = (Math.sin(i * 0.7) + Math.cos(i * 0.3)) * volatility;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.abs(change) * 0.3;
    const low = Math.min(open, close) - Math.abs(change) * 0.3;
    candles.push({ open, close, high, low });
    price = close;
  }
  return candles;
}
