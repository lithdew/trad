import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { base } from "wagmi/chains";
import { formatUnits, formatEther, parseEther, getAddress } from "viem";
import {
  Wallet,
  ChevronDown,
  ExternalLink,
  Settings2,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { toast } from "sonner";
import { useSettings, useSaveSettingsMutation, useDeleteSettingsMutation } from "../../lib/api";
import { tradDelegateAbi } from "../../../contracts/abi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

/* ══════════════════════════════════════════════════════════════
   Settings — wallet connection & trading configuration
   ══════════════════════════════════════════════════════════════ */

export function Settings() {
  const [rpcUrl, setRpcUrl] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [adminToken, setAdminToken] = useState("");

  /* ── Wallet connection ─────────────────────────────── */
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const isOnBase = chainId === base.id;
  let connectedNetwork = `Chain ${chainId}`;
  if (chainId === 1) connectedNetwork = "Ethereum";
  if (chainId === base.id) connectedNetwork = "Base";
  const { connect, connectors } = useConnect();
  const { disconnect: disconnectWallet } = useDisconnect();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const { data: balance } = useBalance({ address, chainId: base.id });

  /* ── TradDelegate contract ──────────────────────────── */
  const [delegateAddress, setDelegateAddress] = useState<`0x${string}` | null>(null);
  const [depositAmount, setDepositAmount] = useState("");

  // Fetch contract info from server
  useEffect(() => {
    const stored = localStorage.getItem("trad_admin_token");
    if (stored !== null && stored !== "") setAdminToken(stored);

    fetch("/api/contract/info")
      .then((res) => res.json())
      .then((data: { address: string | null }) => {
        if (data.address === null || data.address === "") return;
        try {
          setDelegateAddress(getAddress(data.address));
        } catch {
          // ignore invalid server response
        }
      })
      .catch(() => {});
  }, []);

  // Read deposited balance from contract
  const { data: depositedBalanceRaw, refetch: refetchDeposited } = useReadContract({
    address: delegateAddress ?? undefined,
    abi: tradDelegateAbi,
    functionName: "balanceOf",
    args: address !== undefined ? [address] : undefined,
    chainId: base.id,
    query: { enabled: delegateAddress !== null && address !== undefined },
  });

  const depositedEth =
    depositedBalanceRaw !== undefined
      ? parseFloat(formatEther(depositedBalanceRaw)).toFixed(6)
      : "0.000000";

  // Deposit hook
  const {
    writeContract: doDeposit,
    data: depositHash,
    isPending: isDepositing,
  } = useWriteContract();
  const { isLoading: isDepositConfirming, isSuccess: isDepositConfirmed } =
    useWaitForTransactionReceipt({ hash: depositHash, chainId: base.id });

  // Withdraw hook
  const {
    writeContract: doWithdraw,
    data: withdrawHash,
    isPending: isWithdrawing,
  } = useWriteContract();
  const { isLoading: isWithdrawConfirming, isSuccess: isWithdrawConfirmed } =
    useWaitForTransactionReceipt({ hash: withdrawHash, chainId: base.id });

  // Refetch balance on confirmation
  const depositToastedRef = useRef<string | undefined>(undefined);
  const withdrawToastedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (
      isDepositConfirmed === true &&
      depositHash !== undefined &&
      depositToastedRef.current !== depositHash
    ) {
      depositToastedRef.current = depositHash;
      toast.success("Deposit confirmed!");
      refetchDeposited();
    }
  }, [isDepositConfirmed, depositHash, refetchDeposited]);

  useEffect(() => {
    if (
      isWithdrawConfirmed === true &&
      withdrawHash !== undefined &&
      withdrawToastedRef.current !== withdrawHash
    ) {
      withdrawToastedRef.current = withdrawHash;
      toast.success("Withdrawal confirmed!");
      refetchDeposited();
    }
  }, [isWithdrawConfirmed, withdrawHash, refetchDeposited]);

  /* ── Settings API ──────────────────────────────────── */
  const { data: settingsData = [] } = useSettings();
  const saveMutation = useSaveSettingsMutation();
  const disconnectMutation = useDeleteSettingsMutation();

  /* ── Auto-save wallet address on connect ───────────── */
  const savedAddressRef = useRef<string | undefined>(undefined);
  const saveMutateRef = useRef(saveMutation.mutate);
  saveMutateRef.current = saveMutation.mutate;
  const rpcUrlRef = useRef(rpcUrl);
  rpcUrlRef.current = rpcUrl;

  useEffect(() => {
    if (isConnected !== true || address === undefined) return;
    if (savedAddressRef.current === address) return;
    savedAddressRef.current = address;
    saveMutateRef.current({
      exchange: "robinpump",
      apiKey: "",
      apiSecret: rpcUrlRef.current !== "" ? rpcUrlRef.current : "https://mainnet.base.org",
      walletAddress: address,
    });
  }, [isConnected, address]);

  /* ── Hydrate RPC URL from existing settings ────────── */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current === true) return;
    if (settingsData.length === 0) return;
    hydratedRef.current = true;
    for (const s of settingsData) {
      if (s.exchange !== "robinpump") continue;
      if (s.apiSecret !== "" && s.apiSecret !== "https://mainnet.base.org") {
        setRpcUrl(s.apiSecret);
      }
      break;
    }
  }, [settingsData]);

  /* ── Connector buttons ─────────────────────────────── */
  const connectorButtons: ReactNode[] = [];
  for (const connector of connectors) {
    connectorButtons.push(
      <Button
        key={connector.uid}
        variant="outline"
        className="flex-1 h-14 gap-3 text-[15px] border-border-light hover:border-primary/30 hover:bg-primary/5 transition-all duration-200"
        onClick={() => connect({ connector, chainId: base.id })}
      >
        <Wallet className="size-5 text-muted-foreground" />
        {connector.name}
      </Button>,
    );
  }

  /* ── Handlers ──────────────────────────────────────── */

  function handleDeposit() {
    if (delegateAddress === null) return;
    if (isOnBase !== true) {
      toast.error("Wrong network. Switch to Base to deposit.");
      try {
        switchChain({ chainId: base.id });
      } catch {
        // ignore
      }
      return;
    }
    const trimmed = depositAmount.trim();
    if (trimmed === "" || parseFloat(trimmed) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    doDeposit({
      chainId: base.id,
      address: delegateAddress,
      abi: tradDelegateAbi,
      functionName: "deposit",
      value: parseEther(trimmed),
    });
    setDepositAmount("");
  }

  function handleWithdrawAll() {
    if (delegateAddress === null) return;
    if (isOnBase !== true) {
      toast.error("Wrong network. Switch to Base to withdraw.");
      try {
        switchChain({ chainId: base.id });
      } catch {
        // ignore
      }
      return;
    }
    doWithdraw({
      chainId: base.id,
      address: delegateAddress,
      abi: tradDelegateAbi,
      functionName: "withdrawAll",
    });
  }

  async function handleDisconnect() {
    try {
      disconnectWallet();
      savedAddressRef.current = undefined;
      await disconnectMutation.mutateAsync("robinpump");
      toast.success("Wallet disconnected");
    } catch {
      toast.error("Failed to disconnect");
    }
  }

  async function toggleDryRun(enabled: boolean) {
    const prev = dryRun;
    setDryRun(enabled);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = localStorage.getItem("trad_admin_token");
      if (token !== null && token !== "") {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch("/api/settings/dry-run", {
        method: "POST",
        headers,
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(enabled === true ? "Dry run enabled" : "Dry run disabled");
    } catch {
      setDryRun(prev);
      toast.error("Failed to update dry run setting");
    }
  }

  async function saveAdvanced() {
    if (address === undefined) {
      toast.error("Connect your wallet first");
      return;
    }
    try {
      await saveMutation.mutateAsync({
        exchange: "robinpump",
        apiKey: "",
        apiSecret: rpcUrl !== "" ? rpcUrl : "https://mainnet.base.org",
        walletAddress: address,
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    }
  }

  function saveAdminToken() {
    const trimmed = adminToken.trim();
    if (trimmed === "") {
      localStorage.removeItem("trad_admin_token");
      toast.success("Admin token cleared");
      return;
    }
    localStorage.setItem("trad_admin_token", trimmed);
    toast.success("Admin token saved locally");
  }

  /* ── Render ────────────────────────────────────────── */
  return (
    <div className="h-full overflow-y-auto relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-linear-to-b from-primary/2 to-transparent" />

      <div className="relative max-w-2xl mx-auto px-4 md:px-8 py-10">
        {/* ── Header ──────────────────────────────────── */}
        <div className="mb-10">
          <h1 className="font-display text-[2.2rem] md:text-[3.2rem] leading-none text-foreground tracking-wide">
            Settings
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Connect your Base wallet to start trading on RobinPump.fun
          </p>
        </div>

        {/* ── Getting Started callout ─────────────────── */}
        {isConnected !== true && (
          <div className="mb-6 p-4 bg-primary/5 border border-primary/15 rounded-xl flex items-start gap-3">
            <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-base">💡</span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">New to crypto wallets?</p>
              <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
                Download{" "}
                <a
                  href="https://www.coinbase.com/wallet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
                >
                  Coinbase Wallet
                  <ExternalLink className="size-3" />
                </a>{" "}
                to get started in 2 minutes.
              </p>
            </div>
          </div>
        )}

        {/* ── Connect Wallet — primary card ───────────── */}
        <Card
          className={
            isConnected !== true
              ? "mb-8 ring-1 ring-primary/25 shadow-[0_0_50px_-12px_rgba(229,160,13,0.18)] transition-all duration-500"
              : "mb-8 transition-all duration-500"
          }
        >
          <div
            className={
              isConnected === true
                ? "h-1 bg-linear-to-r from-emerald-500/50 via-emerald-500/20 to-transparent"
                : "h-1 bg-linear-to-r from-primary/50 via-primary/20 to-transparent"
            }
          />

          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={
                    isConnected === true
                      ? "size-11 rounded-xl bg-emerald-500/10 flex items-center justify-center transition-colors duration-300"
                      : "size-11 rounded-xl bg-primary/10 flex items-center justify-center transition-colors duration-300"
                  }
                >
                  <Wallet
                    className={
                      isConnected === true ? "size-5 text-emerald-400" : "size-5 text-primary"
                    }
                  />
                </div>
                <div>
                  <CardTitle className="text-lg font-semibold">Connect Wallet</CardTitle>
                  <CardDescription className="mt-0.5 text-[13px]">
                    {isConnected === true
                      ? "Your wallet is linked and ready to trade"
                      : "Link your Base wallet to enable live trading"}
                  </CardDescription>
                </div>
              </div>
              {isConnected === true && (
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1.5 pr-3">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Connected
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent>
            {isConnected === true && address !== undefined ? (
              <div className="space-y-4">
                <div className="p-5 bg-emerald-500/4 border border-emerald-500/10 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-widest">
                      Active Wallet
                    </span>
                  </div>
                  <p className="font-mono text-lg text-foreground tracking-wider">
                    {address.slice(0, 6)}…{address.slice(-4)}
                  </p>
                  {balance != null && (
                    <p className="font-mono text-sm text-muted-foreground mt-2">
                      {parseFloat(formatUnits(balance.value, balance.decimals)).toFixed(4)}{" "}
                      {balance.symbol} on Base
                    </p>
                  )}

                  {isOnBase !== true && (
                    <div className="mt-3 p-3 bg-amber-500/5 border border-amber-500/15 rounded-lg flex items-center justify-between gap-3">
                      <p className="text-[12px] text-amber-300">
                        Network mismatch: connected to{" "}
                        <span className="font-mono">{connectedNetwork}</span>. Switch to Base to
                        deposit/withdraw.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          try {
                            switchChain({ chainId: base.id });
                          } catch {
                            toast.error("Failed to switch network");
                          }
                        }}
                        disabled={isSwitchingChain === true}
                        className="shrink-0"
                      >
                        {isSwitchingChain === true ? "Switching…" : "Switch to Base"}
                      </Button>
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnectMutation.isPending}
                  className="text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                >
                  {disconnectMutation.isPending === true ? "Disconnecting…" : "Disconnect Wallet"}
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Connect your Base wallet to start trading on RobinPump.fun. Your wallet address
                  will be saved automatically.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">{connectorButtons}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Trading Balance (TradDelegate) ──────────── */}
        {isConnected === true && delegateAddress !== null && (
          <Card className="mb-8">
            <div className="h-1 bg-linear-to-r from-blue-500/50 via-blue-500/20 to-transparent" />

            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="size-11 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <ArrowDownToLine className="size-5 text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-lg font-semibold">Trading Balance</CardTitle>
                  <CardDescription className="mt-0.5 text-[13px]">
                    Deposit ETH to fund automated strategies
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {isOnBase !== true && (
                <div className="p-4 bg-amber-500/5 border border-amber-500/15 rounded-xl flex items-center justify-between gap-3">
                  <p className="text-[12px] text-amber-300">
                    Switch to Base to use your Trading Balance.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      try {
                        switchChain({ chainId: base.id });
                      } catch {
                        toast.error("Failed to switch network");
                      }
                    }}
                    disabled={isSwitchingChain === true}
                    className="shrink-0"
                  >
                    {isSwitchingChain === true ? "Switching…" : "Switch to Base"}
                  </Button>
                </div>
              )}

              {/* Current deposited balance */}
              <div className="p-5 bg-blue-500/4 border border-blue-500/10 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-widest">
                    Deposited Balance
                  </span>
                </div>
                <p className="font-mono text-2xl text-foreground tracking-wider">
                  {depositedEth} <span className="text-sm text-muted-foreground">ETH</span>
                </p>
              </div>

              {/* Deposit input + button */}
              <div className="space-y-3">
                <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  Deposit ETH
                </Label>
                <div className="flex gap-3">
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    disabled={isOnBase !== true || isSwitchingChain === true}
                    placeholder="0.01"
                    className="font-mono flex-1"
                  />
                  <Button
                    onClick={handleDeposit}
                    disabled={
                      isOnBase !== true ||
                      isSwitchingChain === true ||
                      isDepositing === true ||
                      isDepositConfirming === true
                    }
                    className="gap-2 min-w-[120px]"
                  >
                    <ArrowDownToLine className="size-4" />
                    {isDepositing === true
                      ? "Submitting…"
                      : isDepositConfirming === true
                        ? "Confirming…"
                        : "Deposit"}
                  </Button>
                </div>
              </div>

              {/* Withdraw button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleWithdrawAll}
                disabled={
                  isOnBase !== true ||
                  isSwitchingChain === true ||
                  isWithdrawing === true ||
                  isWithdrawConfirming === true ||
                  depositedEth === "0.000000"
                }
                className="gap-2"
              >
                <ArrowUpFromLine className="size-4" />
                {isWithdrawing === true
                  ? "Submitting…"
                  : isWithdrawConfirming === true
                    ? "Confirming…"
                    : "Withdraw All"}
              </Button>

              {/* Transaction status */}
              {isDepositConfirmed === true && depositHash !== undefined && (
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
                  <p className="text-[12px] text-emerald-400">
                    Deposit confirmed:{" "}
                    <a
                      href={`https://basescan.org/tx/${depositHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline inline-flex items-center gap-1"
                    >
                      {depositHash.slice(0, 10)}…{depositHash.slice(-6)}
                      <ExternalLink className="size-3" />
                    </a>
                  </p>
                </div>
              )}
              {isWithdrawConfirmed === true && withdrawHash !== undefined && (
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
                  <p className="text-[12px] text-emerald-400">
                    Withdrawal confirmed:{" "}
                    <a
                      href={`https://basescan.org/tx/${withdrawHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline inline-flex items-center gap-1"
                    >
                      {withdrawHash.slice(0, 10)}…{withdrawHash.slice(-6)}
                      <ExternalLink className="size-3" />
                    </a>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Advanced Settings (collapsed) ───────────── */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <Card className="mb-6">
            <CollapsibleTrigger className="w-full border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
              <CardHeader className="cursor-pointer select-none hover:bg-secondary/30 transition-colors rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg bg-secondary flex items-center justify-center">
                      <Settings2 className="size-4 text-muted-foreground" />
                    </div>
                    <div>
                      <CardTitle className="text-[15px]">Advanced Settings</CardTitle>
                      <CardDescription className="mt-0.5">
                        RPC endpoint, dry run mode, and other options
                      </CardDescription>
                    </div>
                  </div>
                  <ChevronDown
                    className={
                      advancedOpen === true
                        ? "size-4 text-muted-foreground transition-transform duration-200 rotate-180"
                        : "size-4 text-muted-foreground transition-transform duration-200"
                    }
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <CardContent className="space-y-5 pt-0">
                <div className="h-px bg-border" />

                {/* Admin token (local only) */}
                <div className="space-y-2">
                  <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    Admin Token (local)
                  </Label>
                  <Input
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    placeholder="Paste TRAD_ADMIN_TOKEN here to enable deploy/trade"
                    className="font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={saveAdminToken}>
                      Save Token
                    </Button>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Stored only in your browser. Required for live trading + server settings.
                    </p>
                  </div>
                </div>

                {/* Base RPC URL */}
                <div className="space-y-2">
                  <Label className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    Base RPC URL
                  </Label>
                  <Input
                    value={rpcUrl}
                    onChange={(e) => setRpcUrl(e.target.value)}
                    placeholder="https://mainnet.base.org (default)"
                    className="font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Optional. Override the default Base mainnet RPC endpoint.
                  </p>
                </div>

                {/* Dry Run Toggle */}
                <div className="flex items-center justify-between p-4 bg-secondary/50 rounded-xl border border-border">
                  <div className="space-y-0.5 mr-4">
                    <Label className="text-sm font-medium text-foreground">Dry Run Mode</Label>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Simulate trades without executing real transactions on-chain.
                    </p>
                  </div>
                  <Switch checked={dryRun} onCheckedChange={toggleDryRun} />
                </div>

                {/* Save button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={saveAdvanced}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending === true ? "Saving…" : "Save Settings"}
                </Button>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </div>
  );
}
