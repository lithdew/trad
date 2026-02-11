import { useState, useEffect } from "react";
import { useRouter } from "../App";

/* ══════════════════════════════════════════════════════════════
   Dashboard — RobinPump.fun live price feed dashboard.
   Shows the latest coins, prices, volumes, and trade charts.
   ══════════════════════════════════════════════════════════════ */

interface CoinData {
  pairAddress: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  createdAt: number;
  graduated: boolean;
  lastPriceEth: number;
  lastPriceUsd: number;
  totalVolumeEth: number;
  ethCollected: number;
  tradeCount: number;
}

interface TradeData {
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

type SortMode = "newest" | "volume" | "trades";

export function Dashboard() {
  const { navigate } = useRouter();
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<CoinData | null>(null);
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [sort, setSort] = useState<SortMode>("newest");
  const [loading, setLoading] = useState(true);
  const [tradesLoading, setTradesLoading] = useState(false);

  /* ── Fetch coins on mount + auto-refresh every 30s ─────── */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/robinpump/coins?limit=50");
        if (cancelled) return;
        const data: unknown = await res.json();
        if (!Array.isArray(data)) return;
        setCoins(data);
        /* Auto-select first coin if nothing selected */
        setSelectedCoin((prev) => {
          if (prev !== null) return prev;
          return data.length > 0 ? data[0] : null;
        });
      } catch {
        /* network error — keep existing data */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  /* ── Fetch trades when selected coin changes ───────────── */
  useEffect(() => {
    if (selectedCoin === null) return;
    let cancelled = false;
    setTradesLoading(true);

    async function loadTrades() {
      try {
        const res = await fetch(
          `/api/robinpump/coins/${selectedCoin!.pairAddress}/trades?limit=50`,
        );
        if (cancelled) return;
        const data: unknown = await res.json();
        if (!Array.isArray(data)) return;
        /* Trades come desc — reverse for chronological order */
        const chronological: TradeData[] = [];
        for (let i = data.length - 1; i >= 0; i--) {
          chronological.push(data[i]);
        }
        setTrades(chronological);
      } catch {
        if (!cancelled) setTrades([]);
      } finally {
        if (!cancelled) setTradesLoading(false);
      }
    }

    loadTrades();
    return () => {
      cancelled = true;
    };
  }, [selectedCoin?.pairAddress]);

  /* ── Sort coins (client-side) ──────────────────────────── */
  let sortedCoins: CoinData[];
  if (sort === "volume") {
    sortedCoins = [...coins];
    sortedCoins.sort((a, b) => b.totalVolumeEth - a.totalVolumeEth);
  } else if (sort === "trades") {
    sortedCoins = [...coins];
    sortedCoins.sort((a, b) => b.tradeCount - a.tradeCount);
  } else {
    sortedCoins = coins;
  }

  /* ── Aggregate stats ───────────────────────────────────── */
  let totalVolume = 0;
  let totalTrades = 0;
  let graduatedCount = 0;
  for (const c of coins) {
    totalVolume += c.totalVolumeEth;
    totalTrades += c.tradeCount;
    if (c.graduated) graduatedCount++;
  }

  /* ── Build coin card elements ──────────────────────────── */
  const coinCards: React.ReactNode[] = [];
  for (const coin of sortedCoins) {
    coinCards.push(
      <CoinCard
        key={coin.pairAddress}
        coin={coin}
        selected={selectedCoin?.pairAddress === coin.pairAddress}
        onClick={() => setSelectedCoin(coin)}
      />,
    );
  }

  /* ── Build skeleton cards ──────────────────────────────── */
  const skeletonCards: React.ReactNode[] = [];
  if (loading) {
    for (let i = 0; i < 12; i++) {
      skeletonCards.push(<SkeletonCard key={`skel-${i}`} i={i} />);
    }
  }

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div className="h-full overflow-y-auto relative">
      {/* faint emerald wash at top (RobinPump brand) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-emerald-500/[0.025] to-transparent" />

      <div className="relative max-w-7xl mx-auto px-8 py-10">
        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-end justify-between mb-9 animate-fade-in">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="font-display text-[2.8rem] leading-none text-text tracking-wide">
                RobinPump<span className="text-emerald-400">.fun</span>
              </h1>
              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold rounded-full uppercase tracking-wider">
                Live
              </span>
            </div>
            <p className="text-text-secondary text-sm">
              Real-time price feeds from Base chain &middot; auto-refreshes every 30s
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
        <div className="grid grid-cols-4 gap-4 mb-8">
          <Stat label="Coins" value={String(coins.length)} icon="🪙" i={0} />
          <Stat label="Volume" value={`${totalVolume.toFixed(2)} ETH`} icon="📊" i={1} />
          <Stat label="Trades" value={totalTrades.toLocaleString("en-US")} icon="⚡" i={2} />
          <Stat label="Graduated" value={String(graduatedCount)} icon="🎓" i={3} />
        </div>

        {/* ── Featured Chart ─────────────────────────────── */}
        {selectedCoin !== null && (
          <div
            className="bg-surface/80 border border-border rounded-2xl mb-8 overflow-hidden
                       opacity-0 animate-fade-in"
            style={{ animationDelay: "0.15s" }}
          >
            {/* chart header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div className="flex items-center gap-3">
                <CoinAvatar symbol={selectedCoin.symbol} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg text-text">{selectedCoin.symbol}</span>
                    <span className="text-text-muted text-sm">{selectedCoin.name}</span>
                    {selectedCoin.graduated && (
                      <span className="text-[9px] font-bold px-1.5 py-[2px] rounded bg-amber-500/10 text-amber-400 uppercase">
                        Graduated
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="font-mono text-text text-sm font-semibold">
                      {formatEthPrice(selectedCoin.lastPriceEth)} ETH
                    </span>
                    <span className="font-mono text-text-muted text-xs">
                      {formatUsdPrice(selectedCoin.lastPriceUsd)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <MiniStat label="Volume" value={`${selectedCoin.totalVolumeEth.toFixed(3)} ETH`} />
                <MiniStat label="Trades" value={String(selectedCoin.tradeCount)} />
                <MiniStat label="Collected" value={`${selectedCoin.ethCollected.toFixed(3)} ETH`} />
                <button
                  onClick={() => navigate("/strategy")}
                  className="px-3.5 py-1.5 border border-border rounded-lg text-[12px] font-semibold text-text-secondary
                             hover:text-gold hover:border-gold/30 transition-all cursor-pointer"
                >
                  Create Bot
                </button>
              </div>
            </div>

            {/* chart area */}
            <div className="px-3 pb-3">
              {tradesLoading ? (
                <div className="h-[200px] flex items-center justify-center">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-text-muted text-sm">Loading chart…</span>
                  </div>
                </div>
              ) : (
                <TradeChart trades={trades} height={200} />
              )}
            </div>
          </div>
        )}

        {/* ── Sort Controls ──────────────────────────────── */}
        <div className="flex items-center gap-2 mb-5">
          <span className="text-[11px] text-text-muted font-semibold uppercase tracking-wider mr-1">
            Sort by
          </span>
          <SortPill label="Newest" active={sort === "newest"} onClick={() => setSort("newest")} />
          <SortPill label="Volume" active={sort === "volume"} onClick={() => setSort("volume")} />
          <SortPill label="Trades" active={sort === "trades"} onClick={() => setSort("trades")} />
        </div>

        {/* ── Coin Grid ──────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {loading ? skeletonCards : coinCards}
        </div>

        {/* empty state */}
        {!loading && coins.length === 0 && (
          <div className="text-center py-20">
            <p className="text-text-muted text-sm">No coins found. The subgraph may be loading.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Stat card ────────────────────────────────────────────── */

function Stat({ label, value, icon, i }: { label: string; value: string; icon: string; i: number }) {
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
      <span className="font-display text-[1.8rem] leading-none text-text">{value}</span>
    </div>
  );
}

/* ── Mini stat (inside chart header) ─────────────────────── */

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">{label}</span>
      <span className="font-mono text-[12px] text-text-secondary">{value}</span>
    </div>
  );
}

/* ── Sort pill ───────────────────────────────────────────── */

function SortPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${
        active
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          : "text-text-muted border border-border hover:text-text-secondary hover:border-border-light"
      }`}
    >
      {label}
    </button>
  );
}

/* ── Coin card ───────────────────────────────────────────── */

function CoinCard({
  coin,
  selected,
  onClick,
}: {
  coin: CoinData;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group text-left bg-surface/80 border rounded-2xl p-4
                 hover:bg-surface-2 transition-all duration-300
                 hover:shadow-[0_2px_24px_rgba(0,0,0,0.25)]
                 opacity-0 animate-fade-in cursor-pointer ${
                   selected
                     ? "border-emerald-500/30 bg-emerald-500/[0.03]"
                     : "border-border hover:border-border-light"
                 }`}
      style={{ animationDelay: "0.1s" }}
    >
      {/* top row */}
      <div className="flex items-center gap-3 mb-3">
        <CoinAvatar symbol={coin.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[13px] text-text group-hover:text-emerald-400 transition-colors truncate">
              {coin.symbol}
            </span>
            {coin.graduated && (
              <span className="text-[8px] font-bold px-1 py-[1px] rounded bg-amber-500/10 text-amber-400 shrink-0">
                GRAD
              </span>
            )}
          </div>
          <p className="text-text-muted text-[11px] truncate">{coin.name}</p>
        </div>
      </div>

      {/* price */}
      <div className="mb-2.5">
        <span className="font-mono text-text text-[15px] font-semibold block">
          {formatEthPrice(coin.lastPriceEth)} <span className="text-text-muted text-[11px] font-normal">ETH</span>
        </span>
        <span className="font-mono text-text-muted text-[11px]">
          {formatUsdPrice(coin.lastPriceUsd)}
        </span>
      </div>

      {/* footer stats */}
      <div className="flex items-center justify-between pt-2.5 border-t border-border">
        <span className="text-[10px] text-text-muted">
          <span className="font-semibold text-text-secondary">{coin.totalVolumeEth.toFixed(3)}</span> ETH vol
        </span>
        <span className="text-[10px] text-text-muted">
          {coin.tradeCount} trades
        </span>
      </div>

      {/* age */}
      <div className="mt-1.5 text-[10px] text-text-muted">
        {timeAgo(coin.createdAt)}
      </div>
    </button>
  );
}

/* ── Coin avatar (letter-based) ──────────────────────────── */

const AVATAR_COLORS = [
  "bg-emerald-500/20 text-emerald-400",
  "bg-blue-500/20 text-blue-400",
  "bg-violet-500/20 text-violet-400",
  "bg-amber-500/20 text-amber-400",
  "bg-rose-500/20 text-rose-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-pink-500/20 text-pink-400",
  "bg-teal-500/20 text-teal-400",
];

function CoinAvatar({ symbol }: { symbol: string }) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0;
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;

  return (
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
      <span className="text-xs font-bold">{symbol.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

/* ── Trade chart (SVG line chart) ────────────────────────── */

function TradeChart({ trades, height = 200 }: { trades: TradeData[]; height?: number }) {
  if (trades.length < 2) {
    return (
      <div
        className="w-full flex items-center justify-center text-text-muted text-sm bg-surface-2/50 rounded-xl"
        style={{ height }}
      >
        {trades.length === 0
          ? "No trades yet for this coin"
          : "Not enough trade data to draw chart"}
      </div>
    );
  }

  const W = 800;
  const H = height;
  const pad = { t: 12, r: 12, b: 12, l: 12 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

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

  const timeRange = maxT - minT || 1;
  /* Add 10% padding to price range */
  const rawPriceRange = maxP - minP || maxP * 0.1 || 0.000001;
  const pPad = rawPriceRange * 0.1;
  minP -= pPad;
  maxP += pPad;
  const priceRange = maxP - minP;

  const points: string[] = [];
  for (const t of trades) {
    const x = pad.l + ((t.timestamp - minT) / timeRange) * pw;
    const y = pad.t + ph - ((t.priceEth - minP) / priceRange) * ph;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  const linePath = `M ${points.join(" L ")}`;

  /* Area fill path: close to bottom */
  const bottomY = (pad.t + ph).toFixed(1);
  const firstX = (pad.l + ((trades[0]!.timestamp - minT) / timeRange) * pw).toFixed(1);
  const lastX = (pad.l + ((trades[trades.length - 1]!.timestamp - minT) / timeRange) * pw).toFixed(
    1,
  );
  const areaPath = `${linePath} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

  const isUp = trades[trades.length - 1]!.priceEth >= trades[0]!.priceEth;
  const color = isUp ? "#22c55e" : "#ef4444";

  /* Price labels on left */
  const labelCount = 4;
  const priceLabels: React.ReactNode[] = [];
  for (let i = 0; i <= labelCount; i++) {
    const p = minP + (priceRange * i) / labelCount;
    const y = pad.t + ph - (i / labelCount) * ph;
    priceLabels.push(
      <text
        key={i}
        x={pad.l + 4}
        y={y - 4}
        className="fill-text-muted"
        fontSize="9"
        fontFamily="var(--font-mono)"
      >
        {formatEthPrice(p)}
      </text>,
    );
    /* grid line */
    priceLabels.push(
      <line
        key={`line-${i}`}
        x1={pad.l}
        y1={y}
        x2={pad.l + pw}
        y2={y}
        stroke="var(--color-border)"
        strokeWidth="0.5"
        strokeDasharray="4 4"
        opacity="0.5"
      />,
    );
  }

  /* Buy/sell dots on trades */
  const tradeDots: React.ReactNode[] = [];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]!;
    const x = pad.l + ((t.timestamp - minT) / timeRange) * pw;
    const y = pad.t + ph - ((t.priceEth - minP) / priceRange) * ph;
    if (i % 3 === 0 || i === trades.length - 1) {
      tradeDots.push(
        <circle
          key={i}
          cx={x}
          cy={y}
          r="2.5"
          fill={t.side === "buy" ? "#22c55e" : "#ef4444"}
          opacity="0.7"
        />,
      );
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded-xl bg-surface-2/30"
      style={{ height }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {priceLabels}
      <path d={areaPath} fill="url(#chart-grad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {tradeDots}
    </svg>
  );
}

/* ── Skeleton card ───────────────────────────────────────── */

function SkeletonCard({ i }: { i: number }) {
  return (
    <div
      className="bg-surface/80 border border-border rounded-2xl p-4 animate-pulse opacity-0 animate-fade-in"
      style={{ animationDelay: `${i * 40 + 80}ms` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-surface-3" />
        <div>
          <div className="h-3.5 w-14 rounded bg-surface-3 mb-1.5" />
          <div className="h-3 w-24 rounded bg-surface-3" />
        </div>
      </div>
      <div className="h-5 w-28 rounded bg-surface-3 mb-1" />
      <div className="h-3.5 w-16 rounded bg-surface-3 mb-3" />
      <div className="flex justify-between pt-2.5 border-t border-border">
        <div className="h-3 w-16 rounded bg-surface-3" />
        <div className="h-3 w-14 rounded bg-surface-3" />
      </div>
    </div>
  );
}

/* ── Formatting helpers ──────────────────────────────────── */

function formatEthPrice(price: number): string {
  if (price === 0) return "0";
  if (price >= 1) return price.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (price >= 0.001) return price.toFixed(6);
  if (price >= 0.000001) return price.toFixed(9);
  return price.toExponential(3);
}

function formatUsdPrice(price: number): string {
  if (price === 0) return "$0.00";
  if (price >= 1)
    return (
      "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  if (price >= 0.01) return "$" + price.toFixed(4);
  if (price >= 0.0001) return "$" + price.toFixed(6);
  return "$" + price.toExponential(2);
}

function timeAgo(unixSeconds: number): string {
  const ms = Date.now() - unixSeconds * 1000;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
