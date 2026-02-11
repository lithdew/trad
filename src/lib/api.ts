import {
  QueryClient,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

/* ══════════════════════════════════════════════════════════════
   Shared API layer — all fetch() calls in one place,
   plus React Query hooks for data-fetching and mutations.
   ══════════════════════════════════════════════════════════════ */

/* ── Types ─────────────────────────────────────────────────── */

export interface CoinData {
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

export interface TradeData {
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

export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  exchange: string;
  status: string;
  code: string | null;
  config: string | null;
  parameters: string | null;
  chatHistory: string | null;
  lastRun: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyPayload {
  name: string;
  description: string | null;
  exchange: string;
  status?: string;
  code: string | null;
  config: string | null;
  parameters: string | null;
  chatHistory?: string;
}

export interface SettingsConnection {
  id: string;
  exchange: string;
  apiKey: string;
  apiSecret: string;
  walletAddress: string | null;
  connected: boolean;
  updatedAt: string;
}

function getAdminAuthHeaders() {
  const headers: Record<string, string> = {};
  if (typeof window === "undefined") return headers;
  const token = localStorage.getItem("trad_admin_token");
  if (token === null || token === "") return headers;
  headers.Authorization = `Bearer ${token}`;
  return headers;
}

/* ── Query Client ──────────────────────────────────────────── */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

/* ── Query Keys ────────────────────────────────────────────── */

export const queryKeys = {
  coins: ["coins"] as const,
  coinTrades: (pair: string) => ["coinTrades", pair] as const,
  strategies: ["strategies"] as const,
  strategy: (id: string) => ["strategy", id] as const,
  strategyRuns: (id: string) => ["strategyRuns", id] as const,
  strategyPerformance: (id: string, range: string, runId: string) =>
    ["strategyPerformance", id, range, runId] as const,
  settings: ["settings"] as const,
};

/* ══════════════════════════════════════════════════════════════
   API Functions — raw fetch wrappers
   ══════════════════════════════════════════════════════════════ */

/* ── RobinPump ─────────────────────────────────────────────── */

export async function fetchCoins(limit = 50) {
  const res = await fetch(`/api/robinpump/coins?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch coins");
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [] as CoinData[];
  return data as CoinData[];
}

/** Fetches trades for a coin pair, returned in chronological order. */
export async function fetchCoinTrades(pairAddress: string, limit = 50) {
  const res = await fetch(
    `/api/robinpump/coins/${pairAddress}/trades?limit=${limit}`,
  );
  if (!res.ok) throw new Error("Failed to fetch trades");
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [] as TradeData[];
  const chronological: TradeData[] = [];
  for (let i = data.length - 1; i >= 0; i--) {
    chronological.push(data[i] as TradeData);
  }
  return chronological;
}

/* ── Strategies ────────────────────────────────────────────── */

export async function fetchStrategies() {
  const res = await fetch("/api/strategies");
  if (!res.ok) throw new Error("Failed to fetch strategies");
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [] as Strategy[];
  return data as Strategy[];
}

export async function fetchStrategy(id: string) {
  const res = await fetch(`/api/strategies/${id}`);
  if (!res.ok) throw new Error("Strategy not found");
  return (await res.json()) as Strategy;
}

export async function createStrategy(payload: StrategyPayload) {
  const res = await fetch("/api/strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Failed to create strategy (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body?.error === "string" && body.error.trim() !== "") msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as Strategy;
}

export async function updateStrategy(id: string, payload: StrategyPayload) {
  const res = await fetch(`/api/strategies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Failed to update strategy (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body?.error === "string" && body.error.trim() !== "") msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as Strategy;
}

export async function deleteStrategy(id: string) {
  const res = await fetch(`/api/strategies/${id}`, { method: "DELETE", headers: getAdminAuthHeaders() });
  if (!res.ok) throw new Error("Failed to delete strategy");
}

export async function deployStrategy(id: string) {
  const res = await fetch(`/api/strategies/${id}/deploy`, { method: "POST", headers: getAdminAuthHeaders() });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Deploy failed");
  }
  return (await res.json()) as Strategy;
}

export async function stopStrategy(id: string) {
  const res = await fetch(`/api/strategies/${id}/stop`, { method: "POST", headers: getAdminAuthHeaders() });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Stop failed");
  }
  return (await res.json()) as Strategy;
}

/* ── Strategy Performance ─────────────────────────────────── */

export type PerformanceRange = "1h" | "4h" | "1d" | "7d" | "all";

export interface StrategyRunInfo {
  id: string;
  strategyId: string;
  startedAt: string;
  stoppedAt: string | null;
  initialCapitalEth: number;
  isDryRun: boolean;
  executionMode: string;
  userAddress: string | null;
}

export interface StrategyRunListItem extends StrategyRunInfo {
  totalTrades: number;
  totalPnlEth: number;
}

export interface StrategyEquityPoint {
  timestamp: number;
  pnlEth: number;
}

export interface StrategyPerformanceTrade {
  timestamp: number;
  side: "buy" | "sell";
  pnlEth: number;
  pnlPct: number;
  amountEth: number;
  pairAddress: string;
  txHash: string;
  cumulativePnlEth: number;
  idx: number;
}

export interface StrategyPerformanceSummary {
  totalPnlEth: number;
  totalPnlPct: number;
  winRate: number;
  totalTrades: number;
  maxDrawdownPct: number;
  avgTradePnlEth: number;
  bestTradeEth: number;
  worstTradeEth: number;
}

export interface StrategyPerformanceData {
  run: StrategyRunInfo | null;
  equityCurve: StrategyEquityPoint[];
  trades: StrategyPerformanceTrade[];
  summary: StrategyPerformanceSummary;
}

export async function fetchStrategyRuns(id: string) {
  const res = await fetch(`/api/strategies/${id}/runs`, { headers: getAdminAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch runs");
  const data = (await res.json()) as { runs?: StrategyRunListItem[] };
  if (data.runs === undefined) return [];
  return data.runs;
}

export async function fetchStrategyPerformance(params: {
  id: string;
  range: PerformanceRange;
  runId?: string;
}) {
  const qs = new URLSearchParams();
  qs.set("range", params.range);
  if (params.runId !== undefined && params.runId !== "") {
    qs.set("runId", params.runId);
  }
  const res = await fetch(`/api/strategies/${params.id}/performance?${qs.toString()}`, {
    headers: getAdminAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch performance");
  return (await res.json()) as StrategyPerformanceData;
}

/* ── Settings ──────────────────────────────────────────────── */

export async function fetchSettings() {
  const res = await fetch("/api/settings", { headers: getAdminAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return (await res.json()) as SettingsConnection[];
}

export async function saveSettings(params: {
  exchange: string;
  apiKey: string;
  apiSecret: string;
  walletAddress: string | null;
}) {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to save settings");
}

export async function deleteSettings(exchange: string) {
  const res = await fetch(`/api/settings/${exchange}`, { method: "DELETE", headers: getAdminAuthHeaders() });
  if (!res.ok) throw new Error("Failed to delete settings");
}

/* ══════════════════════════════════════════════════════════════
   React Query Hooks
   ══════════════════════════════════════════════════════════════ */

/* ── Queries ───────────────────────────────────────────────── */

export function useCoins(limit = 50) {
  return useQuery({
    queryKey: queryKeys.coins,
    queryFn: () => fetchCoins(limit),
    refetchInterval: 30_000,
  });
}

export function useCoinTrades(pairAddress: string | undefined, limit = 50) {
  return useQuery({
    queryKey: queryKeys.coinTrades(pairAddress ?? ""),
    queryFn: () => fetchCoinTrades(pairAddress!, limit),
    enabled: pairAddress !== undefined && pairAddress !== "",
  });
}

export function useStrategies() {
  return useQuery({
    queryKey: queryKeys.strategies,
    queryFn: fetchStrategies,
  });
}

export function useStrategy(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.strategy(id ?? ""),
    queryFn: () => fetchStrategy(id!),
    enabled: id !== undefined,
  });
}

export function useStrategyRuns(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.strategyRuns(id ?? ""),
    queryFn: () => fetchStrategyRuns(id!),
    enabled: id !== undefined && enabled,
    staleTime: 5000,
  });
}

interface StrategyPerformanceQueryParams {
  id: string | undefined;
  range: PerformanceRange;
  runId?: string;
  enabled: boolean;
  pollMs?: number;
}

export function useStrategyPerformance(params: StrategyPerformanceQueryParams) {
  const runKey = params.runId ?? "";
  return useQuery({
    queryKey: queryKeys.strategyPerformance(params.id ?? "", params.range, runKey),
    queryFn: () => fetchStrategyPerformance({ id: params.id!, range: params.range, runId: params.runId }),
    enabled: params.id !== undefined && params.enabled,
    refetchInterval: params.pollMs ?? false,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettings,
  });
}

/* ── Mutations ─────────────────────────────────────────────── */

export function useDeleteStrategyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteStrategy(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.strategies });
    },
  });
}

export function useSaveSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      exchange: string;
      apiKey: string;
      apiSecret: string;
      walletAddress: string | null;
    }) => saveSettings(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

export function useDeleteSettingsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exchange: string) => deleteSettings(exchange),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.settings });
    },
  });
}

/* ── Trading ──────────────────────────────────────────────── */

export async function executeTrade(params: {
  pairAddress: string;
  action: "buy" | "sell";
  amount: string;
}) {
  const res = await fetch("/api/robinpump/trade", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Trade failed");
  }
  return (await res.json()) as { hash: string; status: string };
}

export function useTradeMutation() {
  return useMutation({
    mutationFn: (params: { pairAddress: string; action: "buy" | "sell"; amount: string }) =>
      executeTrade(params),
  });
}

/* ══════════════════════════════════════════════════════════════
   Enriched Coin Data — client-side IPFS metadata resolution
   ══════════════════════════════════════════════════════════════ */

const IPFS_GATEWAY = "https://olive-defensive-giraffe-83.mypinata.cloud";

export interface CoinMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  showName?: boolean;
  createdOn?: string;
}

export interface CoinWithMetadata extends CoinData {
  metadata?: CoinMetadata | null;
  imageUrl?: string;
}

/** Resolve IPFS URI to gateway URL. */
export function resolveIpfsUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) return `${IPFS_GATEWAY}/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("http")) return uri;
  return `${IPFS_GATEWAY}/ipfs/${uri}`;
}

/** Client-side metadata cache (survives across re-renders). */
const _metaCache = new Map<string, CoinMetadata | null>();

async function fetchCoinMetadata(uri: string): Promise<CoinMetadata | null> {
  const cached = _metaCache.get(uri);
  if (cached !== undefined) return cached;
  if (!uri.startsWith("ipfs://")) {
    _metaCache.set(uri, null);
    return null;
  }
  const cid = uri.slice(7);
  try {
    const res = await fetch(`${IPFS_GATEWAY}/ipfs/${cid}`);
    if (!res.ok) {
      _metaCache.set(uri, null);
      return null;
    }
    const meta: CoinMetadata = await res.json();
    _metaCache.set(uri, meta);
    return meta;
  } catch {
    _metaCache.set(uri, null);
    return null;
  }
}

export function useCoinsEnriched(limit = 50) {
  return useQuery({
    queryKey: ["coinsEnriched", limit],
    queryFn: async (): Promise<CoinWithMetadata[]> => {
      const coins = await fetchCoins(limit);
      const enriched: CoinWithMetadata[] = [];
      for (let i = 0; i < coins.length; i += 10) {
        const batch = coins.slice(i, i + 10);
        const promises: Promise<CoinMetadata | null>[] = [];
        for (const c of batch) {
          promises.push(fetchCoinMetadata(c.uri));
        }
        const metas = await Promise.all(promises);
        for (let j = 0; j < batch.length; j++) {
          const coin = batch[j];
          const meta = metas[j];
          if (coin !== undefined) {
            let imageUrl: string | undefined;
            if (meta?.image !== undefined && meta.image !== "") {
              imageUrl = resolveIpfsUrl(meta.image);
            }
            enriched.push({ ...coin, metadata: meta ?? null, imageUrl });
          }
        }
      }
      return enriched;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/* ── Strategy Logs ─────────────────────────────────────────── */

export interface StrategyLogEntry {
  timestamp: number;
  message: string;
  level: string;
}

export interface StrategyLogsData {
  strategyId: string;
  startedAt: number;
  runCount: number;
  logs: StrategyLogEntry[];
  isRunning: boolean;
}

export function useStrategyLogs(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["strategyLogs", id],
    queryFn: async (): Promise<StrategyLogsData> => {
      const res = await fetch(`/api/strategies/${id}/logs`);
      if (!res.ok) {
        return { strategyId: id ?? "", startedAt: 0, runCount: 0, logs: [], isRunning: false };
      }
      return (await res.json()) as StrategyLogsData;
    },
    enabled: id !== undefined && enabled,
    refetchInterval: 2000,
  });
}

/* ══════════════════════════════════════════════════════════════
   Marketplace — browse, list, and purchase strategy templates
   ══════════════════════════════════════════════════════════════ */

export interface MarketplacePerformance {
  totalPnlEth: number;
  totalPnlPct: number;
  winRate: number;
  totalTrades: number;
  isActive: boolean;
}

export interface MarketplaceListing {
  id: string;
  strategyId: string;
  sellerAddress: string;
  title: string;
  description: string | null;
  category: string;
  priceEth: number;
  purchaseCount: number;
  createdAt: string;
  updatedAt: string;
  performance: MarketplacePerformance;
  owned: boolean;
}

export interface MarketplacePurchaseResult {
  purchase: { id: string; listingId: string; pricePaidEth: number };
  strategy: { id: string; name: string };
}

export type MarketplaceSort = "newest" | "popular" | "price-low" | "price-high";

function getWalletHeaders() {
  const headers: Record<string, string> = {};
  /* The connected wallet address is stored in localStorage by the settings page */
  if (typeof window === "undefined") return headers;
  const addr = localStorage.getItem("trad_wallet_address");
  if (addr !== null && addr !== "") headers["x-wallet-address"] = addr;
  return headers;
}

/* ── Fetch fns ─────────────────────────────────────────────── */

export async function fetchMarketplaceListings(params?: {
  category?: string;
  sort?: MarketplaceSort;
  search?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.category !== undefined && params.category !== "") qs.set("category", params.category);
  if (params?.sort !== undefined) qs.set("sort", params.sort);
  if (params?.search !== undefined && params.search !== "") qs.set("search", params.search);

  const res = await fetch(`/api/marketplace?${qs.toString()}`, { headers: getWalletHeaders() });
  if (!res.ok) throw new Error("Failed to fetch marketplace");
  return (await res.json()) as MarketplaceListing[];
}

export async function fetchMarketplaceListing(id: string) {
  const res = await fetch(`/api/marketplace/${id}`, { headers: getWalletHeaders() });
  if (!res.ok) throw new Error("Listing not found");
  return (await res.json()) as MarketplaceListing;
}

export async function createMarketplaceListing(params: {
  strategyId: string;
  title?: string;
  description?: string;
  category?: string;
  priceEth: number;
}) {
  const res = await fetch("/api/marketplace", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getWalletHeaders() },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to create listing");
  }
  return (await res.json()) as MarketplaceListing;
}

export async function delistMarketplaceListing(id: string) {
  const res = await fetch(`/api/marketplace/${id}/delist`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getWalletHeaders() },
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Delist failed");
  }
  return (await res.json()) as { success: boolean };
}

export async function purchaseMarketplaceListing(id: string) {
  const res = await fetch(`/api/marketplace/${id}/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getWalletHeaders() },
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Purchase failed");
  }
  return (await res.json()) as MarketplacePurchaseResult;
}

/* ── Query keys ────────────────────────────────────────────── */

export const marketplaceKeys = {
  listings: (category: string, sort: string, search: string) =>
    ["marketplace", category, sort, search] as const,
  listing: (id: string) => ["marketplace", id] as const,
};

/* ── Hooks ─────────────────────────────────────────────────── */

export function useMarketplaceListings(params?: {
  category?: string;
  sort?: MarketplaceSort;
  search?: string;
}) {
  const cat = params?.category ?? "";
  const sort = params?.sort ?? "newest";
  const search = params?.search ?? "";
  return useQuery({
    queryKey: marketplaceKeys.listings(cat, sort, search),
    queryFn: () => fetchMarketplaceListings(params),
    staleTime: 15_000,
  });
}

export function useMarketplaceListing(id: string | undefined) {
  return useQuery({
    queryKey: marketplaceKeys.listing(id ?? ""),
    queryFn: () => fetchMarketplaceListing(id!),
    enabled: id !== undefined,
  });
}

export function usePurchaseListingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => purchaseMarketplaceListing(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace"] });
      qc.invalidateQueries({ queryKey: queryKeys.strategies });
    },
  });
}

export function useDelistMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => delistMarketplaceListing(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}

export function useCreateListingMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      strategyId: string;
      title?: string;
      description?: string;
      category?: string;
      priceEth: number;
    }) => createMarketplaceListing(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}
