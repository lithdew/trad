import { useState, useEffect } from "react";
import { useRouter } from "../App";

/* ══════════════════════════════════════════════════════════════
   Dashboard — strategy overview grid with live stats.
   ══════════════════════════════════════════════════════════════ */

interface Strategy {
  id: string;
  name: string;
  description: string | null;
  exchange: string;
  status: string;
  lastRun: string | null;
  createdAt: string;
  updatedAt: string;
}

/* placeholder strategies so the page never looks empty */
const PLACEHOLDERS: Strategy[] = [
  {
    id: "demo-1",
    name: "Bitcoin DCA Bot",
    description: "Buy $50 of BTC every hour when price dips below $60 000",
    exchange: "binance",
    status: "active",
    lastRun: new Date(Date.now() - 720_000).toISOString(),
    createdAt: new Date(Date.now() - 604_800_000).toISOString(),
    updatedAt: new Date(Date.now() - 720_000).toISOString(),
  },
  {
    id: "demo-2",
    name: "Idea Coin Sniper",
    description: "Auto-buy new RobinPump coins under $3k market cap, sell at 2x",
    exchange: "robinpump",
    status: "active",
    lastRun: new Date(Date.now() - 300_000).toISOString(),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 300_000).toISOString(),
  },
  {
    id: "demo-3",
    name: "Altcoin Rotation",
    description: "Weekly rebalance across SOL, AVAX, and MATIC — equal weight",
    exchange: "binance",
    status: "draft",
    lastRun: null,
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
];

export function Dashboard() {
  const { navigate } = useRouter();
  const [strategies, setStrategies] = useState<Strategy[]>(PLACEHOLDERS);

  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((d: unknown) => {
        if (Array.isArray(d) && d.length > 0) setStrategies(d);
      })
      .catch(() => {});
  }, []);

  const activeCount = strategies.filter((s) => s.status === "active").length;

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="h-full overflow-y-auto relative">
      {/* faint gold wash at top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-gold/[0.025] to-transparent" />

      <div className="relative max-w-6xl mx-auto px-8 py-10">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-end justify-between mb-10 animate-fade-in">
          <div>
            <h1 className="font-display text-[3.2rem] leading-none text-text tracking-wide">
              Your Strategies
            </h1>
            <p className="mt-2 text-text-secondary text-sm">
              {activeCount} active&ensp;·&ensp;{strategies.length} total
            </p>
          </div>
          <button
            onClick={() => navigate("/strategy")}
            className="flex items-center gap-2 px-5 py-2.5 bg-gold text-obsidian font-bold text-sm rounded-xl
                       hover:bg-gold-bright transition-all duration-200
                       hover:shadow-[0_0_24px_rgba(229,160,13,0.25)] active:scale-[0.97] cursor-pointer"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M7.5 2.5v10M2.5 7.5h10" />
            </svg>
            New Strategy
          </button>
        </div>

        {/* ── Stats ──────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4 mb-9">
          <Stat label="Active Bots" value={String(activeCount)} icon="⚡" i={0} />
          <Stat label="Total Strategies" value={String(strategies.length)} icon="📊" i={1} />
          <Stat label="Exchanges" value="2" icon="🔗" i={2} />
        </div>

        {/* ── Grid ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {strategies.map((s, i) => (
            <StrategyCard key={s.id} s={s} i={i} onClick={() => navigate(`/strategy/${s.id}`)} />
          ))}

          {/* "Add" ghost card */}
          <button
            onClick={() => navigate("/strategy")}
            className="group border-2 border-dashed border-border hover:border-gold/25 rounded-2xl p-6
                       flex flex-col items-center justify-center gap-3 min-h-[196px]
                       transition-all duration-300 hover:bg-gold/[0.02]
                       opacity-0 animate-fade-in cursor-pointer"
            style={{ animationDelay: `${strategies.length * 60 + 60}ms` }}
          >
            <div className="w-12 h-12 rounded-full border-2 border-dashed border-border group-hover:border-gold/30 flex items-center justify-center transition-colors">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="text-text-muted group-hover:text-gold transition-colors"
              >
                <path d="M10 4v12M4 10h12" />
              </svg>
            </div>
            <span className="text-text-muted text-sm font-medium group-hover:text-text-secondary transition-colors">
              Create new strategy
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Stat card ────────────────────────────────────────────── */

function Stat({
  label,
  value,
  icon,
  i,
}: {
  label: string;
  value: string;
  icon: string;
  i: number;
}) {
  return (
    <div
      className="bg-surface/80 border border-border rounded-2xl p-5 opacity-0 animate-fade-in"
      style={{ animationDelay: `${i * 60 + 60}ms` }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-base">{icon}</span>
        <span className="text-text-muted text-[10px] font-bold uppercase tracking-[0.1em]">
          {label}
        </span>
      </div>
      <span className="font-display text-[2rem] leading-none text-text">{value}</span>
    </div>
  );
}

/* ── Strategy card ────────────────────────────────────────── */

const STATUS: Record<string, { bg: string; fg: string; dot: string }> = {
  active: {
    bg: "bg-emerald-500/10",
    fg: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  paused: {
    bg: "bg-amber-500/10",
    fg: "text-amber-400",
    dot: "bg-amber-400",
  },
  draft: {
    bg: "bg-zinc-500/10",
    fg: "text-zinc-400",
    dot: "bg-zinc-500",
  },
  error: {
    bg: "bg-red-500/10",
    fg: "text-red-400",
    dot: "bg-red-400",
  },
};

const EXCHANGE: Record<string, { label: string; color: string }> = {
  binance: { label: "Binance", color: "text-yellow-500" },
  robinpump: { label: "RobinPump", color: "text-emerald-400" },
};

function StrategyCard({ s, i, onClick }: { s: Strategy; i: number; onClick: () => void }) {
  const st = STATUS[s.status] ?? STATUS.draft!;
  const ex = EXCHANGE[s.exchange] ?? {
    label: s.exchange,
    color: "text-text-muted",
  };

  return (
    <button
      onClick={onClick}
      className="group text-left bg-surface/80 border border-border rounded-2xl p-5
                 hover:border-border-light hover:bg-surface-2 transition-all duration-300
                 hover:shadow-[0_2px_24px_rgba(0,0,0,0.25)]
                 opacity-0 animate-fade-in cursor-pointer"
      style={{ animationDelay: `${i * 60 + 120}ms` }}
    >
      {/* top row */}
      <div className="flex items-start justify-between mb-2.5">
        <h3 className="font-semibold text-[15px] text-text group-hover:text-gold transition-colors leading-snug pr-3">
          {s.name}
        </h3>
        <span className={`shrink-0 flex items-center gap-1.5 px-2 py-[3px] rounded-full ${st.bg}`}>
          <span className={`w-[5px] h-[5px] rounded-full ${st.dot}`} />
          <span className={`text-[10px] font-bold capitalize ${st.fg}`}>{s.status}</span>
        </span>
      </div>

      {/* description */}
      {s.description && (
        <p className="text-text-muted text-[13px] leading-relaxed mb-4 line-clamp-2">
          {s.description}
        </p>
      )}

      {/* footer */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <span className={`text-[11px] font-bold tracking-wide ${ex.color}`}>{ex.label}</span>
        <span className="text-text-muted text-[11px]">
          {s.lastRun ? ago(new Date(s.lastRun)) : "Never run"}
        </span>
      </div>
    </button>
  );
}

/* ── Helpers ──────────────────────────────────────────────── */

function ago(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
