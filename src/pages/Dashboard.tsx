import { useState, useEffect, useCallback } from "react";
import { useRouter } from "../App";

/* ══════════════════════════════════════════════════════════════
   Dashboard — two halves:
     Top:    RobinPump.fun live price feeds (coins, chart, stats)
     Bottom: User's strategies (grid with delete, create CTA)
   ══════════════════════════════════════════════════════════════ */

/* ── Types ────────────────────────────────────────────────── */

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

type SortMode = "newest" | "volume" | "trades";

/* ── Placeholder strategies (shown when DB is empty) ─────── */

const PLACEHOLDERS: Strategy[] = [
  {
    id: "demo-1",
    name: "Idea Coin Sniper",
    description: "Auto-buy new RobinPump coins under $3k market cap, sell at 2x",
    exchange: "robinpump",
    status: "active",
    lastRun: new Date(Date.now() - 300_000).toISOString(),
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 300_000).toISOString(),
  },
  {
    id: "demo-2",
    name: "Volume Market Maker",
    description: "Buy and sell a coin in small increments to maximize trading volume",
    exchange: "robinpump",
    status: "active",
    lastRun: new Date(Date.now() - 720_000).toISOString(),
    createdAt: new Date(Date.now() - 604_800_000).toISOString(),
    updatedAt: new Date(Date.now() - 720_000).toISOString(),
  },
  {
    id: "demo-3",
    name: "New Coin DCA",
    description: "DCA 0.001 ETH into the newest RobinPump coin every 5 minutes",
    exchange: "robinpump",
    status: "draft",
    lastRun: null,
    createdAt: new Date(Date.now() - 7_200_000).toISOString(),
    updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
  },
];

/* ══════════════════════════════════════════════════════════════ */

export function Dashboard() {
  const { navigate } = useRouter();

  /* ── Coin state ────────────────────────────────────────── */
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [selectedCoin, setSelectedCoin] = useState<CoinData | null>(null);
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [sort, setSort] = useState<SortMode>("newest");
  const [coinsLoading, setCoinsLoading] = useState(true);
  const [tradesLoading, setTradesLoading] = useState(false);

  /* ── Strategy state ────────────────────────────────────── */
  const [strategies, setStrategies] = useState<Strategy[]>(PLACEHOLDERS);
  const [deleteTarget, setDeleteTarget] = useState<Strategy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  /* ── Toast auto-dismiss ────────────────────────────────── */
  useEffect(() => {
    if (toastMsg === null) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

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
        setSelectedCoin((prev) => {
          if (prev !== null) return prev;
          return data.length > 0 ? data[0] : null;
        });
      } catch {
        /* network error — keep existing data */
      } finally {
        if (!cancelled) setCoinsLoading(false);
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

  /* ── Fetch strategies ──────────────────────────────────── */
  const loadStrategies = useCallback(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((d: unknown) => {
        if (Array.isArray(d) && d.length > 0) setStrategies(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStrategies();
  }, [loadStrategies]);

  /* ── Delete strategy ───────────────────────────────────── */
  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/strategies/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setStrategies((prev) => {
        const filtered: Strategy[] = [];
        for (const s of prev) {
          if (s.id !== deleteTarget.id) filtered.push(s);
        }
        return filtered;
      });
      setToastMsg(`"${deleteTarget.name}" deleted`);
    } catch (e) {
      setToastMsg(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, isDeleting]);

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

  const activeCount = strategies.filter((s) => s.status === "active").length;

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
  if (coinsLoading) {
    for (let i = 0; i < 8; i++) {
      skeletonCards.push(<SkeletonCard key={`skel-${i}`} i={i} />);
    }
  }

  /* ══════════════════════════════════════════════════════════ */
  /* ── Render                                                 */
  /* ══════════════════════════════════════════════════════════ */
  return (
    <div className="h-full overflow-y-auto relative">
      {/* faint emerald wash at top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-emerald-500/[0.025] to-transparent" />

      {/* ── Toast ──────────────────────────────────────────── */}
      {toastMsg !== null && (
        <div className="fixed top-4 right-4 z-50 animate-slide-up">
          <div className="bg-surface-3 border border-border-light rounded-xl px-4 py-2.5 shadow-lg flex items-center gap-2.5">
            <span className="text-[13px] text-text">{toastMsg}</span>
            <button
              onClick={() => setToastMsg(null)}
              className="text-text-muted hover:text-text transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l6 6M10 4l-6 6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ─────────────────────────── */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian/70 backdrop-blur-sm">
          <div className="bg-surface-2 border border-border rounded-2xl p-6 w-[400px] shadow-2xl animate-fade-in">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-red-400">
                  <path d="M3 6h14M8 6V4a1 1 0 011-1h2a1 1 0 011 1v2M5 6v10a2 2 0 002 2h6a2 2 0 002-2V6" />
                  <path d="M8.5 9.5v5M11.5 9.5v5" />
                </svg>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-text">Delete Strategy?</h3>
                <p className="text-[13px] text-text-muted mt-0.5">
                  <span className="text-text-secondary font-medium">"{deleteTarget.name}"</span> will be permanently removed.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 justify-end mt-5">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-border rounded-xl text-[13px] font-semibold text-text-secondary hover:text-text hover:border-border-light transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-500/15 border border-red-500/20 text-red-400 rounded-xl text-[13px] font-semibold hover:bg-red-500/25 transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative max-w-7xl mx-auto px-8 py-10">
        {/* ═══════════════════════════════════════════════════
            TOP HALF — RobinPump.fun Price Feeds
            ═══════════════════════════════════════════════════ */}

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
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M7.5 2.5v10M2.5 7.5h10" />
            </svg>
            New Strategy
          </button>
        </div>

        {/* ── Stats ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Stat label="Coins" value={String(coins.length)} icon="🪙" i={0} />
          <Stat label="Volume" value={`${totalVolume.toFixed(2)} ETH`} icon="📊" i={1} />
          <Stat label="Trades" value={totalTrades.toLocaleString("en-US")} icon="⚡" i={2} />
          <Stat label="Active Bots" value={String(activeCount)} icon="🤖" i={3} />
        </div>

        {/* ── Featured Chart ─────────────────────────────── */}
        {selectedCoin !== null && (
          <div
            className="bg-surface/80 border border-border rounded-2xl mb-8 overflow-hidden opacity-0 animate-fade-in"
            style={{ animationDelay: "0.15s" }}
          >
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
          <span className="text-[11px] text-text-muted font-semibold uppercase tracking-wider mr-1">Sort by</span>
          <SortPill label="Newest" active={sort === "newest"} onClick={() => setSort("newest")} />
          <SortPill label="Volume" active={sort === "volume"} onClick={() => setSort("volume")} />
          <SortPill label="Trades" active={sort === "trades"} onClick={() => setSort("trades")} />
        </div>

        {/* ── Coin Grid ──────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {coinsLoading ? skeletonCards : coinCards}
        </div>

        {!coinsLoading && coins.length === 0 && (
          <div className="text-center py-12">
            <p className="text-text-muted text-sm">No coins found. The subgraph may be loading.</p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════
            BOTTOM HALF — Your Strategies
            ═══════════════════════════════════════════════════ */}

        <div className="mt-14 pt-10 border-t border-border">
          {/* section header */}
          <div className="flex items-end justify-between mb-8 animate-fade-in">
            <div>
              <h2 className="font-display text-[2rem] leading-none text-text tracking-wide">
                Your Strategies
              </h2>
              <p className="mt-2 text-text-secondary text-sm">
                {activeCount} active&ensp;&middot;&ensp;{strategies.length} total
              </p>
            </div>
          </div>

          {/* strategy grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {strategies.map((s, i) => (
              <StrategyCard
                key={s.id}
                s={s}
                i={i}
                onClick={() => navigate(`/strategy/${s.id}`)}
                onDelete={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(s);
                }}
              />
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
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Sub-components — Coin Feed
   ══════════════════════════════════════════════════════════════ */

function Stat({ label, value, icon, i }: { label: string; value: string; icon: string; i: number }) {
  return (
    <div
      className="bg-surface/80 border border-border rounded-2xl p-5 opacity-0 animate-fade-in"
      style={{ animationDelay: `${i * 60 + 60}ms` }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-base">{icon}</span>
        <span className="text-text-muted text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <span className="font-display text-[1.8rem] leading-none text-text">{value}</span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">{label}</span>
      <span className="font-mono text-[12px] text-text-secondary">{value}</span>
    </div>
  );
}

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

      <div className="mb-2.5">
        <span className="font-mono text-text text-[15px] font-semibold block">
          {formatEthPrice(coin.lastPriceEth)} <span className="text-text-muted text-[11px] font-normal">ETH</span>
        </span>
        <span className="font-mono text-text-muted text-[11px]">{formatUsdPrice(coin.lastPriceUsd)}</span>
      </div>

      <div className="flex items-center justify-between pt-2.5 border-t border-border">
        <span className="text-[10px] text-text-muted">
          <span className="font-semibold text-text-secondary">{coin.totalVolumeEth.toFixed(3)}</span> ETH vol
        </span>
        <span className="text-[10px] text-text-muted">{coin.tradeCount} trades</span>
      </div>

      <div className="mt-1.5 text-[10px] text-text-muted">{timeAgo(coin.createdAt)}</div>
    </button>
  );
}

/* ── Coin avatar ─────────────────────────────────────────── */

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
        {trades.length === 0 ? "No trades yet for this coin" : "Not enough trade data to draw chart"}
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
  const bottomY = (pad.t + ph).toFixed(1);
  const firstX = (pad.l + ((trades[0]!.timestamp - minT) / timeRange) * pw).toFixed(1);
  const lastX = (pad.l + ((trades[trades.length - 1]!.timestamp - minT) / timeRange) * pw).toFixed(1);
  const areaPath = `${linePath} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

  const isUp = trades[trades.length - 1]!.priceEth >= trades[0]!.priceEth;
  const color = isUp ? "#22c55e" : "#ef4444";

  const labelCount = 4;
  const priceLabels: React.ReactNode[] = [];
  for (let i = 0; i <= labelCount; i++) {
    const p = minP + (priceRange * i) / labelCount;
    const y = pad.t + ph - (i / labelCount) * ph;
    priceLabels.push(
      <text key={i} x={pad.l + 4} y={y - 4} className="fill-text-muted" fontSize="9" fontFamily="var(--font-mono)">
        {formatEthPrice(p)}
      </text>,
    );
    priceLabels.push(
      <line key={`line-${i}`} x1={pad.l} y1={y} x2={pad.l + pw} y2={y} stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.5" />,
    );
  }

  const tradeDots: React.ReactNode[] = [];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]!;
    const x = pad.l + ((t.timestamp - minT) / timeRange) * pw;
    const y = pad.t + ph - ((t.priceEth - minP) / priceRange) * ph;
    if (i % 3 === 0 || i === trades.length - 1) {
      tradeDots.push(
        <circle key={i} cx={x} cy={y} r="2.5" fill={t.side === "buy" ? "#22c55e" : "#ef4444"} opacity="0.7" />,
      );
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-surface-2/30" style={{ height }} preserveAspectRatio="none">
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

/* ══════════════════════════════════════════════════════════════
   Sub-components — Strategy Cards
   ══════════════════════════════════════════════════════════════ */

const STATUS: Record<string, { bg: string; fg: string; dot: string }> = {
  active: { bg: "bg-emerald-500/10", fg: "text-emerald-400", dot: "bg-emerald-400" },
  paused: { bg: "bg-amber-500/10", fg: "text-amber-400", dot: "bg-amber-400" },
  draft: { bg: "bg-zinc-500/10", fg: "text-zinc-400", dot: "bg-zinc-500" },
  error: { bg: "bg-red-500/10", fg: "text-red-400", dot: "bg-red-400" },
};

function StrategyCard({
  s,
  i,
  onClick,
  onDelete,
}: {
  s: Strategy;
  i: number;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const st = STATUS[s.status] ?? STATUS.draft!;

  return (
    <div
      onClick={onClick}
      className="group text-left bg-surface/80 border border-border rounded-2xl p-5
                 hover:border-border-light hover:bg-surface-2 transition-all duration-300
                 hover:shadow-[0_2px_24px_rgba(0,0,0,0.25)]
                 opacity-0 animate-fade-in cursor-pointer relative"
      style={{ animationDelay: `${i * 60 + 120}ms` }}
    >
      {/* Delete button — appears on hover (not for demo cards) */}
      {!s.id.startsWith("demo-") && (
        <button
          onClick={onDelete}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-text-muted opacity-0 group-hover:opacity-100
                     hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer z-10"
          title="Delete strategy"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2.5 4h9M5.5 4V3a.75.75 0 01.75-.75h1.5a.75.75 0 01.75.75v1M4 4v6.5a1.25 1.25 0 001.25 1.25h3.5A1.25 1.25 0 0010 10.5V4" />
            <path d="M5.75 6.5v2.5M8.25 6.5v2.5" />
          </svg>
        </button>
      )}

      {/* top row */}
      <div className="flex items-start justify-between mb-2.5">
        <h3 className="font-semibold text-[15px] text-text group-hover:text-gold transition-colors leading-snug pr-8">
          {s.name}
        </h3>
        <span className={`shrink-0 flex items-center gap-1.5 px-2 py-[3px] rounded-full ${st.bg}`}>
          <span className={`w-[5px] h-[5px] rounded-full ${st.dot}`} />
          <span className={`text-[10px] font-bold capitalize ${st.fg}`}>{s.status}</span>
        </span>
      </div>

      {/* description */}
      {s.description !== null && (
        <p className="text-text-muted text-[13px] leading-relaxed mb-4 line-clamp-2">{s.description}</p>
      )}

      {/* footer */}
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <span className="text-[11px] font-bold tracking-wide text-emerald-400">RobinPump</span>
        <span className="text-text-muted text-[11px]">
          {s.lastRun !== null ? ago(new Date(s.lastRun)) : "Never run"}
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════════════════════════ */

function formatEthPrice(price: number): string {
  if (price === 0) return "0";
  if (price >= 1) return price.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (price >= 0.001) return price.toFixed(6);
  if (price >= 0.000001) return price.toFixed(9);
  return price.toExponential(3);
}

function formatUsdPrice(price: number): string {
  if (price === 0) return "$0.00";
  if (price >= 1) return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  return `${Math.floor(h / 24)}d ago`;
}

function ago(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
