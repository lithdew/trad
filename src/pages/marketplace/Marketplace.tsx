import { useState, useCallback } from "react";
import {
  Search, ShoppingBag, TrendingUp, ArrowUpRight, Users,
  Clock, Sparkles, Tag, ChevronRight, Star, Zap, Plus, Trash2,
} from "lucide-react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useRouter } from "../../App";
import {
  useMarketplaceListings, useStrategies, usePurchaseListingMutation,
  useCreateListingMutation, useDelistMutation,
  type MarketplaceListing, type MarketplaceSort,
} from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ══════════════════════════════════════════════════════════════
   Marketplace — Strategy Store
   "Browse strategies made by other traders. Get one, run it."
   ══════════════════════════════════════════════════════════════ */

const CATEGORIES = [
  { key: "all", label: "All Strategies", icon: Sparkles },
  { key: "momentum", label: "Momentum", icon: TrendingUp },
  { key: "dip-buying", label: "Dip Buying", icon: ArrowUpRight },
  { key: "new-launches", label: "New Launches", icon: Zap },
  { key: "swing", label: "Swing", icon: Star },
  { key: "general", label: "General", icon: Tag },
] as const;

const SORTS: { key: MarketplaceSort; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "popular", label: "Most Used" },
  { key: "price-low", label: "Price ↑" },
  { key: "price-high", label: "Price ↓" },
];

const CATEGORY_COLORS: Record<string, string> = {
  momentum: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "dip-buying": "text-blue-400 bg-blue-500/10 border-blue-500/20",
  "new-launches": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  swing: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  general: "text-text-secondary bg-secondary border-border",
};

export function Marketplace() {
  const { navigate } = useRouter();
  const { address, isConnected } = useAccount();
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<MarketplaceSort>("newest");
  const [search, setSearch] = useState("");
  const [purchaseTarget, setPurchaseTarget] = useState<MarketplaceListing | null>(null);
  const [showSellDialog, setShowSellDialog] = useState(false);
  const [sellStrategyId, setSellStrategyId] = useState("");
  const [sellPrice, setSellPrice] = useState("0.001");
  const [sellCategory, setSellCategory] = useState("general");

  const [delistTarget, setDelistTarget] = useState<MarketplaceListing | null>(null);

  const { data: listings = [], isLoading } = useMarketplaceListings({ category, sort, search });
  const { data: myStrategies = [] } = useStrategies();
  const purchaseMutation = usePurchaseListingMutation();
  const createListingMutation = useCreateListingMutation();
  const delistMutation = useDelistMutation();

  /* Store wallet address for API calls */
  if (isConnected && address !== undefined) {
    localStorage.setItem("trad_wallet_address", address);
  }

  const confirmDelist = useCallback(async () => {
    if (delistTarget === null || delistMutation.isPending) return;
    try {
      await delistMutation.mutateAsync(delistTarget.id);
      toast.success(`"${delistTarget.title}" removed from marketplace`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delist failed");
    } finally {
      setDelistTarget(null);
    }
  }, [delistTarget, delistMutation]);

  const confirmPurchase = useCallback(async () => {
    if (purchaseTarget === null || purchaseMutation.isPending) return;
    try {
      const result = await purchaseMutation.mutateAsync(purchaseTarget.id);
      toast.success(`Got "${purchaseTarget.title}"! Copied to your strategies.`);
      navigate(`/strategy/${result.strategy.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setPurchaseTarget(null);
    }
  }, [purchaseTarget, purchaseMutation, navigate]);

  const handleSell = useCallback(async () => {
    if (sellStrategyId === "" || createListingMutation.isPending) return;
    try {
      await createListingMutation.mutateAsync({
        strategyId: sellStrategyId,
        priceEth: parseFloat(sellPrice) || 0,
        category: sellCategory,
      });
      toast.success("Strategy listed on the marketplace!");
      setShowSellDialog(false);
      setSellStrategyId("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to list");
    }
  }, [sellStrategyId, sellPrice, sellCategory, createListingMutation]);

  /* Separate featured (top PnL) from the rest */
  let featured: MarketplaceListing | null = null;
  const gridListings: MarketplaceListing[] = [];
  if (listings.length > 0 && category === "all" && search === "" && sort === "newest") {
    let bestIdx = 0;
    let bestPnl = -Infinity;
    for (let i = 0; i < listings.length; i++) {
      if (listings[i]!.performance.totalPnlEth > bestPnl) {
        bestPnl = listings[i]!.performance.totalPnlEth;
        bestIdx = i;
      }
    }
    if (bestPnl > 0) {
      featured = listings[bestIdx]!;
    }
    for (let i = 0; i < listings.length; i++) {
      if (i !== bestIdx || featured === null) {
        gridListings.push(listings[i]!);
      }
    }
  } else {
    for (const l of listings) gridListings.push(l);
  }

  /* Build category pills */
  const categoryPills: React.ReactNode[] = [];
  for (const cat of CATEGORIES) {
    const Icon = cat.icon;
    const active = category === cat.key;
    categoryPills.push(
      <button
        key={cat.key}
        onClick={() => setCategory(cat.key)}
        className={`group flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold
                    transition-all whitespace-nowrap cursor-pointer
                    ${active
            ? "bg-primary/12 text-primary border border-primary/25 shadow-[0_0_12px_rgba(229,160,13,0.08)]"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60 border border-transparent"
          }`}
      >
        <Icon className={`size-3.5 ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"} transition-colors`} />
        {cat.label}
      </button>,
    );
  }

  /* Build sort buttons */
  const sortBtns: React.ReactNode[] = [];
  for (const s of SORTS) {
    sortBtns.push(
      <button
        key={s.key}
        onClick={() => setSort(s.key)}
        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
          sort === s.key
            ? "bg-primary/15 text-primary border border-primary/25"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
        }`}
      >
        {s.label}
      </button>,
    );
  }

  /* Build strategy cards */
  const cards: React.ReactNode[] = [];
  if (isLoading) {
    for (let i = 0; i < 6; i++) {
      cards.push(<SkeletonCard key={i} delay={i * 80} />);
    }
  } else {
    for (let idx = 0; idx < gridListings.length; idx++) {
      const listing = gridListings[idx]!;
      const isSeller = isConnected && address !== undefined && listing.sellerAddress.toLowerCase() === address.toLowerCase();
      cards.push(
        <div key={listing.id} className="animate-fadeSlideUp" style={{ animationDelay: `${idx * 60}ms` }}>
          <StrategyStoreCard
            listing={listing}
            isSeller={isSeller}
            onGet={() => {
              if (!isConnected) {
                toast.error("Connect your wallet first (Settings → Wallet)");
                return;
              }
              if (listing.owned) {
                toast("You already own this strategy");
                return;
              }
              setPurchaseTarget(listing);
            }}
            onDelist={() => setDelistTarget(listing)}
          />
        </div>,
      );
    }
  }

  /* ── Sellable strategies (user's strategies with code that aren't already listed) ── */
  const listedStrategyIds = new Set<string>();
  for (const l of listings) {
    if (address !== undefined && l.sellerAddress.toLowerCase() === address.toLowerCase()) {
      listedStrategyIds.add(l.strategyId);
    }
  }
  const sellableStrategies: { id: string; name: string }[] = [];
  for (const s of myStrategies) {
    if (s.code !== null && s.code !== "" && !listedStrategyIds.has(s.id)) {
      sellableStrategies.push({ id: s.id, name: s.name });
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* ── Ambient background ──────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-64 bg-linear-to-b from-primary/3 to-transparent" />
        <div className="absolute -top-40 right-1/4 w-[600px] h-[600px] bg-primary/2 rounded-full blur-[180px]" />
        <div className="absolute -bottom-20 left-1/3 w-[400px] h-[400px] bg-emerald-500/1.5 rounded-full blur-[140px]" />
      </div>

      {/* ── Purchase confirmation dialog ───────────────────── */}
      <AlertDialog open={purchaseTarget !== null} onOpenChange={(open) => { if (!open) setPurchaseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Get this strategy?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="text-foreground font-medium">"{purchaseTarget?.title}"</span> will be copied
              to your strategies. You can then customize and run it.
              {purchaseTarget !== null && purchaseTarget.priceEth > 0 && (
                <span className="block mt-2 font-display text-lg text-primary">
                  {purchaseTarget.priceEth} ETH
                </span>
              )}
              {purchaseTarget !== null && purchaseTarget.priceEth === 0 && (
                <span className="block mt-2 font-display text-lg text-emerald-400">
                  Free
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPurchase} disabled={purchaseMutation.isPending}>
              {purchaseMutation.isPending ? "Getting…" : "Get Strategy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delist confirmation dialog ──────────────────────── */}
      <AlertDialog open={delistTarget !== null} onOpenChange={(open) => { if (!open) setDelistTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove listing?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="text-foreground font-medium">"{delistTarget?.title}"</span> will be removed
              from the marketplace. Existing buyers keep their copies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelist} disabled={delistMutation.isPending}>
              {delistMutation.isPending ? "Removing…" : "Remove Listing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Sell/List dialog ───────────────────────────────── */}
      <AlertDialog open={showSellDialog} onOpenChange={setShowSellDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>List a strategy</AlertDialogTitle>
            <AlertDialogDescription>
              Share one of your strategies on the marketplace. Others can get a copy — your original stays untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            {/* Strategy picker */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">Strategy</label>
              <select
                value={sellStrategyId}
                onChange={(e) => setSellStrategyId(e.target.value)}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Select a strategy…</option>
                {sellableStrategies.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {sellableStrategies.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  No strategies available. Create one with code first.
                </p>
              )}
            </div>
            {/* Price */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">Price (ETH)</label>
              <div className="flex items-center bg-secondary border border-border rounded-lg overflow-hidden">
                <input
                  type="number"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  className="flex-1 bg-transparent px-3 py-2 text-sm font-mono text-foreground focus:outline-none
                             [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  step="0.001"
                  min="0"
                />
                <span className="text-muted-foreground text-[10px] font-bold pr-3 select-none">ETH</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Set to 0 to offer it for free.</p>
            </div>
            {/* Category */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block mb-1.5">Category</label>
              <select
                value={sellCategory}
                onChange={(e) => setSellCategory(e.target.value)}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="general">General</option>
                <option value="momentum">Momentum</option>
                <option value="dip-buying">Dip Buying</option>
                <option value="new-launches">New Launches</option>
                <option value="swing">Swing</option>
              </select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSell}
              disabled={sellStrategyId === "" || createListingMutation.isPending}
            >
              {createListingMutation.isPending ? "Listing…" : "List Strategy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="relative shrink-0 px-4 md:px-8 pt-5 md:pt-6 pb-1">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-[1.75rem] sm:text-[2.4rem] leading-none tracking-wider bg-linear-to-r from-foreground via-foreground to-primary bg-clip-text text-transparent select-none">
                Strategy Store
              </h1>
              <Badge className="hidden sm:inline-flex bg-primary/10 text-primary border-primary/20 text-[9px] uppercase tracking-widest font-bold">
                Marketplace
              </Badge>
            </div>
            <p className="text-muted-foreground text-[11px] sm:text-[13px] mt-1 tracking-wide">
              Browse strategies made by other traders. Get one, make it yours, run it.
            </p>
          </div>

          <Button
            onClick={() => {
              if (!isConnected) {
                toast.error("Connect your wallet first (Settings → Wallet)");
                return;
              }
              setShowSellDialog(true);
            }}
            variant="outline"
            className="gap-2 border-primary/25 text-primary hover:bg-primary/10 hover:text-primary"
          >
            <Plus className="size-4" />
            Sell Strategy
          </Button>
        </div>

        {/* ── Search ────────────────────────────────────────── */}
        <div className="mt-4 relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search strategies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-secondary/60 border border-border/60 rounded-xl pl-9 pr-4 py-2.5
                       text-sm text-foreground placeholder:text-muted-foreground/50
                       focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30
                       transition-all"
          />
        </div>

        {/* ── Category pills (scrollable) ────────────────────── */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {categoryPills}
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-y-auto px-4 md:px-8 pt-3 pb-6">
        {/* Sort controls */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mr-1">Sort</span>
          {sortBtns}
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground font-mono">
            {listings.length} {listings.length === 1 ? "strategy" : "strategies"}
          </span>
        </div>

        {/* ── Featured banner ──────────────────────────────── */}
        {featured !== null && (
          <div className="animate-fadeSlideUp mb-5">
            <FeaturedCard
              listing={featured}
              isSeller={isConnected && address !== undefined && featured.sellerAddress.toLowerCase() === address.toLowerCase()}
              onGet={() => {
                if (!isConnected) {
                  toast.error("Connect your wallet first (Settings → Wallet)");
                  return;
                }
                if (featured!.owned) {
                  toast("You already own this strategy");
                  return;
                }
                setPurchaseTarget(featured);
              }}
              onDelist={() => setDelistTarget(featured)}
            />
          </div>
        )}

        {/* ── Card Grid ───────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards}
        </div>

        {/* ── Empty state ──────────────────────────────────── */}
        {!isLoading && listings.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="size-20 rounded-2xl bg-primary/5 border border-primary/10
                            flex items-center justify-center mb-6">
              <ShoppingBag className="size-9 text-primary/30" />
            </div>
            <h3 className="font-display text-xl text-foreground mb-2">No strategies listed yet</h3>
            <p className="text-muted-foreground text-sm max-w-[340px] leading-relaxed mb-5">
              Be the first to share a strategy! Create one in the Strategy Builder, then list it here for other traders.
            </p>
            <div className="flex gap-3">
              <Button onClick={() => navigate("/strategy")} className="gap-2">
                <Plus className="size-4" />
                Create Strategy
              </Button>
              {isConnected && sellableStrategies.length > 0 && (
                <Button variant="outline" onClick={() => setShowSellDialog(true)} className="gap-2 border-primary/25 text-primary hover:bg-primary/10">
                  <Tag className="size-4" />
                  List Existing
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Featured Card — highlighted top performer
   ══════════════════════════════════════════════════════════════ */

function FeaturedCard({ listing, isSeller, onGet, onDelist }: {
  listing: MarketplaceListing;
  isSeller: boolean;
  onGet: () => void;
  onDelist: () => void;
}) {
  const pnl = listing.performance.totalPnlEth;
  const isPositive = pnl >= 0;

  return (
    <div
      className="group relative rounded-2xl border border-primary/15 bg-card overflow-hidden
                 transition-all duration-300 hover:border-primary/30
                 hover:shadow-[0_0_40px_rgba(229,160,13,0.06)]"
    >
      {/* Decorative gradient wash */}
      <div className="absolute inset-0 bg-linear-to-br from-primary/4 via-transparent to-emerald-500/2 pointer-events-none" />
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/3 rounded-full blur-[80px] pointer-events-none" />

      <div className="relative flex flex-col sm:flex-row gap-4 sm:gap-6 p-5 sm:p-6">
        {/* Left: info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] uppercase tracking-widest font-bold gap-1">
              <Star className="size-2.5" />
              Top Performer
            </Badge>
            <CategoryBadge category={listing.category} />
          </div>

          <h3 className="font-display text-xl sm:text-2xl text-foreground leading-tight mb-1.5 group-hover:text-primary transition-colors">
            {listing.title}
          </h3>

          {listing.description !== null && (
            <p className="text-text-secondary text-[13px] leading-relaxed line-clamp-2 mb-3 max-w-lg">
              {listing.description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <WalletBadge address={listing.sellerAddress} />
            <span className="text-border-light">·</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Users className="size-3" />
              {listing.purchaseCount} {listing.purchaseCount === 1 ? "trader" : "traders"}
            </span>
            <span className="text-border-light">·</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="size-3" />
              {ago(new Date(listing.createdAt))}
            </span>
          </div>
        </div>

        {/* Right: stats + CTA */}
        <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 sm:gap-4 shrink-0">
          {/* PnL hero */}
          <div className="text-right">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest block mb-1">Performance</span>
            <span className={`font-display text-2xl sm:text-3xl leading-none font-bold tabular-nums ${
              isPositive ? "text-emerald-400" : "text-red-400"
            }`}>
              {isPositive ? "+" : ""}{pnl.toFixed(4)}
            </span>
            <span className="text-muted-foreground text-[11px] font-mono ml-1.5">ETH</span>
            <div className="flex items-center gap-2 mt-1 justify-end">
              <StatPill label="Win" value={`${listing.performance.winRate.toFixed(0)}%`} positive={listing.performance.winRate >= 50} />
              <StatPill label="Trades" value={String(listing.performance.totalTrades)} />
            </div>
          </div>

          {/* Price + CTA */}
          <div className="flex flex-col items-end gap-2">
            <PriceTag priceEth={listing.priceEth} />
            <div className="flex items-center gap-2">
              {isSeller && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onDelist(); }}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-[11px] gap-1"
                >
                  <Trash2 className="size-3" />
                  Delist
                </Button>
              )}
              <Button
                onClick={onGet}
                className={`gap-2 min-w-[140px] shadow-[0_0_20px_rgba(229,160,13,0.1)] ${
                  listing.owned ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15 shadow-none" : ""
                }`}
                variant={listing.owned ? "outline" : "default"}
              >
                {listing.owned ? (
                  <>{isSeller ? "Your Listing" : "Owned"}</>
                ) : (
                  <>
                    Get Strategy
                    <ChevronRight className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Strategy Store Card
   ══════════════════════════════════════════════════════════════ */

function StrategyStoreCard({ listing, isSeller, onGet, onDelist }: {
  listing: MarketplaceListing;
  isSeller: boolean;
  onGet: () => void;
  onDelist: () => void;
}) {
  const pnl = listing.performance.totalPnlEth;
  const isPositive = pnl >= 0;

  return (
    <div
      className="group relative flex flex-col rounded-2xl border bg-card overflow-hidden
                 transition-all duration-200
                 hover:bg-secondary/60 hover:border-border-light hover:scale-[1.015]
                 hover:shadow-[0_0_28px_rgba(229,160,13,0.04)]"
    >
      {/* Subtle top accent — color reflects performance */}
      <div className={`h-[3px] w-full ${isPositive ? "bg-linear-to-r from-emerald-500/60 via-emerald-400/30 to-transparent" : "bg-linear-to-r from-red-500/40 via-red-400/20 to-transparent"}`} />

      <div className="flex-1 p-5">
        {/* Category + active badge */}
        <div className="flex items-center gap-2 mb-3">
          <CategoryBadge category={listing.category} />
          {listing.performance.isActive && (
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] gap-1 px-1.5">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </Badge>
          )}
        </div>

        {/* Title */}
        <h3 className="font-display text-[16px] leading-snug text-foreground group-hover:text-primary transition-colors mb-1.5 line-clamp-1">
          {listing.title}
        </h3>

        {/* Description */}
        {listing.description !== null && (
          <p className="text-text-secondary text-[12px] leading-relaxed line-clamp-2 mb-3">
            {listing.description}
          </p>
        )}
        {listing.description === null && <div className="mb-3" />}

        {/* Performance stats row */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 rounded-xl bg-secondary/50 border border-border/30 px-3 py-2">
            <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest block mb-0.5">PnL</span>
            <span className={`font-mono text-[14px] font-bold leading-none tabular-nums ${
              isPositive ? "text-emerald-400" : "text-red-400"
            }`}>
              {isPositive ? "+" : ""}{pnl >= 1 || pnl <= -1 ? pnl.toFixed(3) : pnl.toFixed(5)}
            </span>
            <span className="text-muted-foreground/50 text-[9px] ml-1">ETH</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <StatPill label="Win" value={`${listing.performance.winRate.toFixed(0)}%`} positive={listing.performance.winRate >= 50} />
            <StatPill label="Trades" value={String(listing.performance.totalTrades)} />
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <WalletBadge address={listing.sellerAddress} />
          <span className="text-border-light">·</span>
          <span className="flex items-center gap-1">
            <Users className="size-2.5" />
            {listing.purchaseCount}
          </span>
          <span className="text-border-light">·</span>
          <span>{ago(new Date(listing.createdAt))}</span>
        </div>
      </div>

      {/* Footer: price + CTA */}
      <div className="border-t border-border/40 px-5 py-3.5 flex items-center justify-between">
        <PriceTag priceEth={listing.priceEth} />
        <div className="flex items-center gap-2">
          {isSeller && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); onDelist(); }}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-[11px] gap-1"
            >
              <Trash2 className="size-3" />
              Delist
            </Button>
          )}
          <Button
            size="sm"
            onClick={onGet}
            className={listing.owned
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15 shadow-none text-[11px]"
              : "gap-1.5 text-[11px] shadow-[0_0_16px_rgba(229,160,13,0.08)]"
            }
            variant={listing.owned ? "outline" : "default"}
          >
            {listing.owned ? (isSeller ? "Your Listing" : "Owned") : (
              <>
                Get Strategy
                <ChevronRight className="size-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Small sub-components
   ══════════════════════════════════════════════════════════════ */

function CategoryBadge({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general!;
  return (
    <Badge className={`text-[9px] capitalize border ${colors}`}>
      {category.replace("-", " ")}
    </Badge>
  );
}

function WalletBadge({ address }: { address: string }) {
  return (
    <span className="font-mono text-[10px] text-muted-foreground bg-secondary/80 px-1.5 py-0.5 rounded">
      {address.slice(0, 6)}…{address.slice(-4)}
    </span>
  );
}

function StatPill({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  let color = "text-foreground";
  if (positive === true) color = "text-emerald-400";
  if (positive === false) color = "text-red-400";
  return (
    <span className="flex items-center gap-1.5 text-[10px]">
      <span className="text-muted-foreground/60 font-bold uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-bold ${color}`}>{value}</span>
    </span>
  );
}

function PriceTag({ priceEth }: { priceEth: number }) {
  if (priceEth === 0) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="font-display text-[15px] font-bold text-emerald-400">Free</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-display text-[15px] font-bold text-foreground tabular-nums">{priceEth}</span>
      <span className="text-muted-foreground text-[10px] font-bold">ETH</span>
    </span>
  );
}

function SkeletonCard({ delay }: { delay: number }) {
  return (
    <div className="rounded-2xl border bg-card overflow-hidden animate-fadeSlideUp" style={{ animationDelay: `${delay}ms` }}>
      <Skeleton className="h-[3px] w-full" />
      <div className="p-5 space-y-3">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-3">
          <Skeleton className="h-14 flex-1 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <div className="border-t border-border/40 px-5 py-3.5 flex justify-between">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────── */

function ago(d: Date): string {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}
