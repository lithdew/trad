import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { ExternalLink, Plus, Trash2, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "../../App";
import {
  useCoins,
  useCoinsEnriched,
  useCoinTrades,
  useStrategies,
  useDeleteStrategyMutation,
  useTradeMutation,
  type CoinData,
  type CoinWithMetadata,
  type TradeData,
  type Strategy,
} from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ══════════════════════════════════════════════════════════════
   Dashboard — Strategy management + RobinPump market feed
   ══════════════════════════════════════════════════════════════ */

type SortMode = "newest" | "volume" | "trades";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400",
  paused: "bg-amber-500/10 text-amber-400",
  draft: "bg-secondary text-muted-foreground",
  error: "bg-destructive/10 text-destructive",
};

const STATUS_BAR: Record<string, string> = {
  active: "bg-emerald-400",
  paused: "bg-amber-400",
  draft: "bg-border-light",
  error: "bg-destructive",
};

export function Dashboard() {
  const { navigate } = useRouter();
  const [selectedCoin, setSelectedCoin] = useState<CoinData | null>(null);
  const [sort, setSort] = useState<SortMode>("newest");
  const [deleteTarget, setDeleteTarget] = useState<Strategy | null>(null);

  const [tradeAmount, setTradeAmount] = useState("0.001");

  /* ── Wallet ───────────────────────────────────────────── */
  const { address, isConnected } = useAccount();
  const { data: walletBalance } = useBalance({ address });

  /* ── Data Fetching ──────────────────────────────────── */
  const { data: coins = [], isLoading: coinsLoading } = useCoins();
  const { data: enrichedCoins } = useCoinsEnriched();
  const { data: trades = [], isLoading: tradesLoading } = useCoinTrades(selectedCoin?.pairAddress);
  const { data: strategies = [] } = useStrategies();
  const deleteMutation = useDeleteStrategyMutation();
  const tradeMutation = useTradeMutation();

  /* Build metadata enrichment lookup */
  const enrichmentMap = new Map<string, CoinWithMetadata>();
  if (enrichedCoins !== undefined) {
    for (const ec of enrichedCoins) {
      enrichmentMap.set(ec.pairAddress, ec);
    }
  }

  useEffect(() => {
    if (selectedCoin !== null || coins.length === 0) return;
    setSelectedCoin(coins[0]!);
  }, [coins, selectedCoin]);

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null || deleteMutation.isPending) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
    } catch (e) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteMutation]);

  const handleTrade = async (action: "buy" | "sell") => {
    if (selectedCoin === null) return;
    try {
      const result = await tradeMutation.mutateAsync({
        pairAddress: selectedCoin.pairAddress,
        action,
        amount: tradeAmount,
      });
      toast.success(`${action === "buy" ? "Bought" : "Sold"} — tx: ${result.hash.slice(0, 10)}…`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Trade failed");
    }
  };

  /* Sort coins client-side */
  let sortedCoins: CoinData[];
  if (sort === "volume") {
    sortedCoins = [...coins].sort((a, b) => b.totalVolumeEth - a.totalVolumeEth);
  } else if (sort === "trades") {
    sortedCoins = [...coins].sort((a, b) => b.tradeCount - a.tradeCount);
  } else {
    sortedCoins = coins;
  }

  /* Strategy stats */
  let activeCount = 0;
  let draftCount = 0;
  let errorCount = 0;
  for (const s of strategies) {
    if (s.status === "active") activeCount++;
    if (s.status === "draft") draftCount++;
    if (s.status === "error") errorCount++;
  }

  /* Market stats */
  let totalVolume = 0;
  for (const c of coins) {
    totalVolume += c.totalVolumeEth;
  }

  /* Selected coin enrichment */
  const selectedEnriched =
    selectedCoin !== null ? enrichmentMap.get(selectedCoin.pairAddress) : undefined;

  /* Build strategy card elements */
  const strategyCards: React.ReactNode[] = [];
  for (let idx = 0; idx < strategies.length; idx++) {
    const s = strategies[idx]!;
    strategyCards.push(
      <div key={s.id} className="animate-fadeSlideUp" style={{ animationDelay: `${idx * 60}ms` }}>
        <StrategyCard
          s={s}
          onClick={() => navigate(`/strategy/${s.id}`)}
          onDelete={(e) => {
            e.stopPropagation();
            setDeleteTarget(s);
          }}
        />
      </div>,
    );
  }

  /* Build coin list elements */
  const coinItems: React.ReactNode[] = [];
  if (coinsLoading) {
    for (let i = 0; i < 14; i++) {
      coinItems.push(
        <div key={i} className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
          <Skeleton className="size-9 rounded-xl shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-20 ml-auto" />
            <Skeleton className="h-2.5 w-14 ml-auto" />
          </div>
        </div>,
      );
    }
  } else {
    for (let idx = 0; idx < sortedCoins.length; idx++) {
      const coin = sortedCoins[idx]!;
      const enriched = enrichmentMap.get(coin.pairAddress);
      coinItems.push(
        <div
          key={coin.pairAddress}
          className="animate-fadeSlideUp"
          style={{ animationDelay: `${idx * 30}ms` }}
        >
          <CoinCard
            coin={coin}
            imageUrl={enriched?.imageUrl}
            selected={selectedCoin?.pairAddress === coin.pairAddress}
            onClick={() => setSelectedCoin(coin)}
          />
        </div>,
      );
    }
  }

  /* Build sort buttons */
  const sortBtns: React.ReactNode[] = [];
  const sortModes: SortMode[] = ["newest", "volume", "trades"];
  for (const mode of sortModes) {
    sortBtns.push(
      <Button
        key={mode}
        variant={sort === mode ? "secondary" : "ghost"}
        size="xs"
        onClick={() => setSort(mode)}
        className={
          sort === mode
            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            : "text-muted-foreground"
        }
      >
        {mode.charAt(0).toUpperCase() + mode.slice(1)}
      </Button>,
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto md:overflow-hidden relative">
      {/* ── Ambient glow (clipped so it can't cause horizontal scroll) ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-56 bg-linear-to-b from-primary/3 to-transparent" />
        <div className="absolute -top-32 left-1/4 w-[500px] h-[500px] bg-primary/2.5 rounded-full blur-[160px]" />
      </div>

      {/* ── Delete confirmation dialog ───────────────────── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Strategy?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="text-foreground font-medium">"{deleteTarget?.name}"</span> will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Header ───────────────────────────────────────── */}
      <header className="relative shrink-0 flex flex-wrap items-end justify-between gap-3 px-4 md:px-8 pt-5 md:pt-6 pb-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[1.75rem] sm:text-[2.4rem] leading-none tracking-wider bg-linear-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent select-none">
              trad.
            </h1>
            <Badge className="hidden sm:inline-flex bg-primary/10 text-primary border-primary/20 text-[9px] uppercase tracking-widest font-bold">
              Dashboard
            </Badge>
          </div>
          <p className="text-muted-foreground text-[11px] sm:text-[13px] mt-1 tracking-wide">
            AI-powered trading strategies for RobinPump.fun
          </p>
        </div>
        <Button
          onClick={() => navigate("/strategy")}
          className="gap-2 shadow-[0_0_24px_rgba(229,160,13,0.12)]"
        >
          <Plus className="size-4" />
          New Strategy
        </Button>
      </header>

      {/* ── Stats Row ────────────────────────────────────── */}
      <div className="relative shrink-0 px-4 md:px-8 py-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card
            className="relative py-3.5 overflow-hidden animate-fadeSlideUp"
            style={{ animationDelay: "0ms" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-emerald-400" />
            <div className="absolute inset-0 bg-linear-to-r from-emerald-400/3 to-transparent pointer-events-none" />
            <CardContent className="px-4 pl-5 relative">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] block mb-1">
                Active Bots
              </span>
              <span className="flex items-center gap-1.5">
                {activeCount > 0 && (
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
                <span className="font-display text-[1.5rem] leading-none text-emerald-400">
                  {activeCount}
                </span>
              </span>
            </CardContent>
          </Card>
          <Card
            className="relative py-3.5 overflow-hidden animate-fadeSlideUp"
            style={{ animationDelay: "40ms" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary" />
            <div className="absolute inset-0 bg-linear-to-r from-primary/3 to-transparent pointer-events-none" />
            <CardContent className="px-4 pl-5 relative">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] block mb-1">
                Strategies
              </span>
              <span className="font-display text-[1.5rem] leading-none text-foreground">
                {strategies.length}
              </span>
            </CardContent>
          </Card>
          <Card
            className="relative py-3.5 overflow-hidden animate-fadeSlideUp"
            style={{ animationDelay: "80ms" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-border-light" />
            <CardContent className="px-4 pl-5 relative">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] block mb-1">
                Draft
              </span>
              <span className="font-display text-[1.5rem] leading-none text-text-secondary">
                {draftCount}
              </span>
            </CardContent>
          </Card>
          <Card
            className="relative py-3.5 overflow-hidden animate-fadeSlideUp"
            style={{ animationDelay: "120ms" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-destructive" />
            <div className="absolute inset-0 bg-linear-to-r from-destructive/2 to-transparent pointer-events-none" />
            <CardContent className="px-4 pl-5 relative">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] block mb-1">
                Errored
              </span>
              <span className="font-display text-[1.5rem] leading-none text-destructive">
                {errorCount}
              </span>
            </CardContent>
          </Card>
          <Card
            className="relative py-3.5 overflow-hidden animate-fadeSlideUp"
            style={{ animationDelay: "160ms" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-400" />
            <div className="absolute inset-0 bg-linear-to-r from-blue-400/3 to-transparent pointer-events-none" />
            <CardContent className="px-4 pl-5 relative">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] block mb-1">
                Market Vol
              </span>
              <span className="flex items-center gap-1.5">
                <TrendingUp className="size-3.5 text-blue-400" />
                <span className="font-display text-[1.3rem] leading-none text-blue-400">
                  {totalVolume >= 1 ? totalVolume.toFixed(1) : totalVolume.toFixed(3)}
                </span>
                <span className="text-[9px] text-muted-foreground/60 font-bold">ETH</span>
              </span>
            </CardContent>
          </Card>
          <Card
            className="relative py-3.5 overflow-hidden animate-fadeSlideUp"
            style={{ animationDelay: "200ms" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-violet-400" />
            <div className="absolute inset-0 bg-linear-to-r from-violet-400/3 to-transparent pointer-events-none" />
            <CardContent className="px-4 pl-5 relative">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] block mb-1">
                Portfolio
              </span>
              <span className="flex items-center gap-1.5">
                <Wallet className="size-3.5 text-violet-400" />
                {isConnected === true && walletBalance != null ? (
                  <>
                    <span className="font-display text-[1.3rem] leading-none text-violet-400">
                      {parseFloat(formatUnits(walletBalance.value, walletBalance.decimals)).toFixed(
                        4,
                      )}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60 font-bold">ETH</span>
                  </>
                ) : (
                  <span className="font-mono text-[11px] text-violet-400/70">Connect wallet</span>
                )}
              </span>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Main content (two-column) ────────────────────── */}
      <div className="relative flex-none md:flex-1 md:min-h-0 flex flex-col md:flex-row gap-6 md:gap-0 px-4 md:px-8 pb-5">
        {/* ── Left column: Strategy List (~58%) ───────────── */}
        <div className="w-full md:w-[58%] flex flex-col md:min-h-0 md:pr-5">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h2 className="font-display text-lg text-foreground tracking-wide">Your Strategies</h2>
            <span className="text-muted-foreground text-[11px] font-medium">
              {activeCount} active &middot; {strategies.length} total
            </span>
          </div>

          <div className="md:flex-1 md:overflow-y-auto md:pr-1.5 space-y-2.5">
            {strategyCards}

            {/* Create new strategy CTA */}
            <button
              onClick={() => navigate("/strategy")}
              className="group w-full border-2 border-dashed border-border hover:border-primary/25 rounded-2xl p-5
                         flex items-center justify-center gap-3 min-h-[68px]
                         transition-all hover:bg-primary/2 cursor-pointer"
            >
              <div
                className="size-9 rounded-full border-2 border-dashed border-border group-hover:border-primary/30
                              flex items-center justify-center transition-colors"
              >
                <Plus className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className="text-muted-foreground text-sm font-medium group-hover:text-foreground/70 transition-colors">
                Create new strategy
              </span>
            </button>

            {/* Empty state */}
            {strategies.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div
                  className="size-16 rounded-2xl bg-primary/5 border border-primary/10
                                flex items-center justify-center mb-5"
                >
                  <Plus className="size-7 text-primary/40" />
                </div>
                <h3 className="font-display text-xl text-foreground mb-2">No strategies yet</h3>
                <p className="text-muted-foreground text-sm max-w-[300px] leading-relaxed">
                  Create your first AI-powered trading strategy to begin automating on RobinPump.fun
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Divider ────────────────────────────────────── */}
        <Separator className="md:hidden" />
        <div className="hidden md:block w-px bg-border shrink-0" />

        {/* ── Right column: Market Feed (~42%) ────────────── */}
        <div className="w-full md:w-[42%] flex flex-col md:min-h-0 md:pl-5">
          {/* Selected coin chart */}
          {selectedCoin !== null && (
            <div className="shrink-0 mb-3">
              <div className="flex items-center gap-2.5 mb-2.5">
                <CoinAvatar
                  symbol={selectedCoin.symbol}
                  imageUrl={selectedEnriched?.imageUrl}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://robinpump.fun/project/${selectedCoin.tokenAddress}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-display text-[15px] text-foreground inline-flex items-center gap-1 hover:underline underline-offset-4"
                      title="Open on RobinPump.fun"
                    >
                      {selectedCoin.symbol}
                      <ExternalLink className="size-3 opacity-60" />
                    </a>
                    <span className="text-muted-foreground text-xs truncate">
                      {selectedCoin.name}
                    </span>
                    {selectedCoin.graduated && (
                      <Badge
                        variant="outline"
                        className="text-[8px] text-amber-400 border-amber-500/20 bg-amber-500/10 px-1.5 py-0"
                      >
                        Graduated
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 mt-0.5">
                    <span className="font-mono text-foreground text-sm font-semibold">
                      {fmtEth(selectedCoin.lastPriceEth)} ETH
                    </span>
                    <span className="font-mono text-muted-foreground text-[11px]">
                      {fmtUsd(selectedCoin.lastPriceUsd)}
                    </span>
                  </div>
                  {/* Coin description from metadata */}
                  {selectedEnriched?.metadata?.description !== undefined &&
                    selectedEnriched.metadata.description !== "" && (
                      <p className="text-muted-foreground/70 text-[10px] mt-1 line-clamp-2 leading-relaxed max-w-[280px]">
                        {selectedEnriched.metadata.description}
                      </p>
                    )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <MiniStat label="Volume" value={`${selectedCoin.totalVolumeEth.toFixed(3)}`} />
                  <MiniStat label="Trades" value={String(selectedCoin.tradeCount)} />
                </div>
              </div>
              {tradesLoading ? (
                <Skeleton className="h-[160px] w-full rounded-xl" />
              ) : (
                <TradeChart trades={trades} height={160} />
              )}

              {/* ── Quick Trade ─────────────────── */}
              <div className="mt-3 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
                <div className="flex items-center gap-2.5 px-3 py-2">
                  <span className="text-[9px] font-bold text-muted-foreground/70 uppercase tracking-widest shrink-0 select-none">
                    Trade
                  </span>
                  <div className="h-4 w-px bg-border/40" />
                  <div className="flex items-center bg-secondary/60 rounded-lg border border-border/30 flex-1 max-w-[120px]">
                    <input
                      type="number"
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(e.target.value)}
                      className="w-full bg-transparent font-mono text-[13px] text-foreground px-2 py-1 focus:outline-none tabular-nums
                                 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      step="0.001"
                      min="0.0001"
                    />
                    <span className="text-muted-foreground/40 text-[9px] font-bold pr-2 shrink-0 select-none">
                      ETH
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      onClick={() => handleTrade("buy")}
                      disabled={tradeMutation.isPending}
                      className="px-3.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider
                                 bg-emerald-500/10 text-emerald-400 border border-emerald-500/15
                                 hover:bg-emerald-500/20 hover:border-emerald-400/25
                                 hover:shadow-[0_0_12px_rgba(34,197,94,0.1)]
                                 active:scale-[0.97]
                                 transition-all disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {tradeMutation.isPending && tradeMutation.variables?.action === "buy" ? (
                        <span className="flex items-center gap-1">
                          <span className="size-1 rounded-full bg-emerald-400 animate-pulse" />
                          Buying…
                        </span>
                      ) : (
                        "Buy"
                      )}
                    </button>
                    <button
                      onClick={() => handleTrade("sell")}
                      disabled={tradeMutation.isPending}
                      className="px-3.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider
                                 bg-red-500/10 text-red-400 border border-red-500/15
                                 hover:bg-red-500/20 hover:border-red-400/25
                                 hover:shadow-[0_0_12px_rgba(239,68,68,0.1)]
                                 active:scale-[0.97]
                                 transition-all disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {tradeMutation.isPending && tradeMutation.variables?.action === "sell" ? (
                        <span className="flex items-center gap-1">
                          <span className="size-1 rounded-full bg-red-400 animate-pulse" />
                          Selling…
                        </span>
                      ) : (
                        "Sell"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Separator className="shrink-0" />

          {/* Sort controls + feed header */}
          <div className="flex items-center gap-2 py-3 shrink-0">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
              Market Feed
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/60 ml-0.5">
              {coins.length}
            </span>
            <div className="flex-1" />
            {sortBtns}
          </div>

          {/* Scrollable coin list */}
          <div className="max-h-[400px] md:max-h-none md:flex-1 overflow-y-auto -mx-1 px-1 space-y-0.5">
            {coinItems}
            {!coinsLoading && coins.length === 0 && (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">
                  No coins found. The subgraph may be loading.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════════ */

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">
        {label}
      </span>
      <span className="font-mono text-[12px] text-text-secondary">{value}</span>
    </div>
  );
}

/* ── Coin card (compact sidebar variant) ────────────────── */

function CoinCard({
  coin,
  imageUrl,
  selected,
  onClick,
}: {
  coin: CoinData;
  imageUrl?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer
                  transition-all duration-200 ${
                    selected
                      ? "bg-emerald-500/6 ring-1 ring-inset ring-emerald-500/25"
                      : "hover:bg-secondary/60 hover:scale-[1.015] hover:border-border-light"
                  }`}
      onClick={onClick}
    >
      <CoinAvatar symbol={coin.symbol} imageUrl={imageUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <a
            href={`https://robinpump.fun/project/${coin.tokenAddress}`}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-[12px] text-foreground truncate inline-flex items-center gap-1 hover:underline underline-offset-4"
            title="Open on RobinPump.fun"
          >
            {coin.symbol}
            <ExternalLink className="size-3 opacity-60" />
          </a>
          {coin.graduated && <span className="text-amber-400 text-[8px]">★</span>}
        </div>
        <p className="text-muted-foreground text-[10px] truncate">{coin.name}</p>
      </div>
      <div className="text-right shrink-0">
        <span className="font-mono text-[11px] text-foreground font-semibold block leading-tight">
          {fmtEth(coin.lastPriceEth)}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground leading-tight">
          {fmtUsd(coin.lastPriceUsd)}
        </span>
      </div>
    </div>
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
];

function CoinAvatar({
  symbol,
  imageUrl,
  size = "sm",
}: {
  symbol: string;
  imageUrl?: string;
  size?: "sm" | "lg";
}) {
  const [imgError, setImgError] = useState(false);
  const dim = size === "lg" ? "size-10" : "size-8";
  const radius = size === "lg" ? "rounded-xl" : "rounded-lg";
  const textSize = size === "lg" ? "text-[12px]" : "text-[10px]";

  if (imageUrl !== undefined && imageUrl !== "" && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={symbol}
        onError={() => setImgError(true)}
        className={`${dim} ${radius} shrink-0 object-cover border border-border/50
                    ring-1 ring-inset ring-white/5`}
        loading="lazy"
      />
    );
  }

  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0;
  }
  return (
    <div
      className={`${dim} ${radius} flex items-center justify-center shrink-0 ${AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]}`}
    >
      <span className={`${textSize} font-bold`}>{symbol.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

/* ── Trade chart (Recharts) ──────────────────────────────── */

function TradeChart({ trades, height = 160 }: { trades: TradeData[]; height?: number }) {
  if (trades.length < 2) {
    return (
      <div
        className="w-full flex items-center justify-center text-muted-foreground text-sm bg-secondary/30 rounded-xl"
        style={{ height }}
      >
        {trades.length === 0 ? "No trades yet" : "Not enough data for chart"}
      </div>
    );
  }

  const isUp = trades[trades.length - 1]!.priceEth >= trades[0]!.priceEth;
  const color = isUp ? "#22c55e" : "#ef4444";
  const gradId = isUp ? "dashGradUp" : "dashGradDn";

  const refDots: React.ReactNode[] = [];
  for (let i = 0; i < trades.length; i++) {
    if (i % 4 === 0 || i === trades.length - 1) {
      const t = trades[i]!;
      refDots.push(
        <ReferenceDot
          key={i}
          x={t.timestamp}
          y={t.priceEth}
          r={2}
          fill={t.side === "buy" ? "#22c55e" : "#ef4444"}
          fillOpacity={0.6}
          stroke="none"
        />,
      );
    }
  }

  return (
    <div
      className="w-full rounded-xl bg-secondary/30 transition-[height] duration-300"
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={trades} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="dashGradUp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.18} />
              <stop offset="85%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="dashGradDn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.18} />
              <stop offset="85%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 4"
            stroke="var(--border)"
            strokeOpacity={0.4}
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
            tick={{ fill: "var(--muted-foreground)", fontSize: 9, fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={60}
          />
          <YAxis
            dataKey="priceEth"
            domain={["auto", "auto"]}
            tickFormatter={fmtEth}
            tick={{ fill: "var(--muted-foreground)", fontSize: 9, fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            width={60}
            orientation="right"
          />
          <RTooltip
            content={<TradeTooltip />}
            cursor={{ stroke: "var(--gold-dim)", strokeWidth: 1, strokeDasharray: "4 4" }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="priceEth"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={false}
            activeDot={(p: { cx?: number; cy?: number; payload?: TradeData }) => {
              if (p.cx === undefined || p.cy === undefined || p.payload === undefined) return <g />;
              const f = p.payload.side === "buy" ? "#22c55e" : "#ef4444";
              return (
                <g>
                  <circle cx={p.cx} cy={p.cy} r="5" fill={f} opacity="0.12" />
                  <circle cx={p.cx} cy={p.cy} r="2.5" fill={f} opacity="0.8" />
                </g>
              );
            }}
            animationDuration={600}
            animationEasing="ease-out"
          />
          {refDots}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TradeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TradeData }>;
}) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const d = payload[0]!.payload;
  return (
    <div className="bg-popover/95 backdrop-blur-md border border-border-light rounded-xl px-3.5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`size-1.5 rounded-full ${d.side === "buy" ? "bg-emerald-400" : "bg-red-400"}`}
        />
        <span
          className={`text-[10px] font-bold uppercase tracking-wider ${d.side === "buy" ? "text-emerald-400" : "text-red-400"}`}
        >
          {d.side}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {new Date(d.timestamp * 1000).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </div>
      <div className="font-mono text-sm font-semibold text-foreground">
        {fmtEth(d.priceEth)}{" "}
        <span className="text-muted-foreground text-[10px] font-normal">ETH</span>
      </div>
    </div>
  );
}

/* ── Strategy card ───────────────────────────────────────── */

function StrategyCard({
  s,
  onClick,
  onDelete,
}: {
  s: Strategy;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const isActive = s.status === "active";

  return (
    <div
      className={`group relative flex rounded-2xl border bg-card cursor-pointer
                   transition-all duration-200 overflow-hidden
                   hover:bg-secondary/80 hover:border-border-light hover:scale-[1.01]
                   hover:shadow-[0_0_24px_rgba(229,160,13,0.03)]
                   ${isActive ? "animate-pulseGlow" : ""}`}
      onClick={onClick}
    >
      {/* Status accent bar */}
      <div
        className={`w-1 group-hover:w-1.5 shrink-0 transition-all ${STATUS_BAR[s.status] ?? "bg-border-light"}`}
      />

      <div className="flex-1 px-5 py-4 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[16px] leading-snug text-foreground group-hover:text-primary transition-colors truncate">
              {s.name}
            </h3>
            {s.description !== null && (
              <p className="text-text-secondary text-[13px] leading-relaxed mt-1 line-clamp-2">
                {s.description}
              </p>
            )}
          </div>
          <Badge
            className={`shrink-0 capitalize text-[10px] mt-0.5 flex items-center gap-1 ${STATUS_STYLES[s.status] ?? "bg-secondary text-muted-foreground"}`}
          >
            {isActive && <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            {s.status}
          </Badge>
        </div>

        <div className="flex items-center gap-2.5 mt-3">
          <Badge className="bg-emerald-500/10 text-emerald-400 border-transparent text-[10px] tracking-wide">
            RobinPump
          </Badge>
          <span className="text-border-light text-xs">&middot;</span>
          <span className="text-muted-foreground text-[11px]">
            {s.lastRun !== null ? `Ran ${ago(new Date(s.lastRun))}` : "Never run"}
          </span>
          {isActive && (
            <>
              <span className="text-border-light text-xs">&middot;</span>
              <span className="text-emerald-400/70 text-[11px] font-medium">Running</span>
            </>
          )}
        </div>
      </div>

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        className="absolute top-3 right-3 md:opacity-0 md:group-hover:opacity-100 text-muted-foreground
                   hover:text-destructive hover:bg-destructive/10 z-10 transition-opacity"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

const SUB = "₀₁₂₃₄₅₆₇₈₉";

function fmtTiny(price: number, sig: number): string {
  const str = price.toExponential(sig - 1);
  const eIdx = str.indexOf("e");
  const coeff = str.slice(0, eIdx);
  const exp = parseInt(str.slice(eIdx + 1));
  let sub = "";
  for (const ch of String(-(exp + 1))) sub += SUB[Number(ch)];
  return `0.0${sub}${coeff.replace(".", "")}`;
}

function fmtEth(p: number): string {
  if (p === 0) return "0";
  if (p >= 1) return p.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (p >= 0.001) return p.toFixed(6);
  if (p >= 0.000001) return p.toFixed(9);
  return fmtTiny(p, 4);
}

function fmtUsd(p: number): string {
  if (p === 0) return "$0.00";
  if (p >= 1)
    return "$" + p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.01) return "$" + p.toFixed(4);
  if (p >= 0.0001) return "$" + p.toFixed(6);
  return "$" + fmtTiny(p, 3);
}

function ago(d: Date): string {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
