import { useState, useEffect, type ReactNode } from "react";

/* ══════════════════════════════════════════════════════════════
   Settings — exchange API key management with Prisma persistence.
   ══════════════════════════════════════════════════════════════ */

interface Fields {
  apiKey: string;
  apiSecret: string;
  walletAddress: string;
}

interface Connection {
  connected: boolean;
  updatedAt?: string;
}

const EMPTY: Fields = { apiKey: "", apiSecret: "", walletAddress: "" };

export function Settings() {
  const [binance, setBinance] = useState<Fields>({ ...EMPTY });
  const [robinpump, setRobinpump] = useState<Fields>({ ...EMPTY });
  const [conns, setConns] = useState<Record<string, Connection>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    msg: string;
    ok: boolean;
  } | null>(null);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  /* ── Load existing connections on mount ─────────────────── */
  useEffect(() => {
    loadConns();
  }, []);

  async function loadConns() {
    try {
      const res = await fetch("/api/settings");
      const data: { exchange: string; connected: boolean; updatedAt: string }[] = await res.json();
      const map: Record<string, Connection> = {};
      for (const s of data) {
        map[s.exchange] = { connected: s.connected, updatedAt: s.updatedAt };
      }
      setConns(map);
    } catch {
      /* not configured yet */
    }
  }

  /* ── Save ───────────────────────────────────────────────── */
  async function save(exchange: string, fields: Fields) {
    setSaving(exchange);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          apiKey: fields.apiKey,
          apiSecret: fields.apiSecret,
          walletAddress: fields.walletAddress || null,
        }),
      });
      flash("Connection saved!", true);
      if (exchange === "binance") setBinance({ ...EMPTY });
      if (exchange === "robinpump") setRobinpump({ ...EMPTY });
      await loadConns();
    } catch {
      flash("Failed to save — check console", false);
    } finally {
      setSaving(null);
    }
  }

  /* ── Disconnect ─────────────────────────────────────────── */
  async function disconnect(exchange: string) {
    try {
      await fetch(`/api/settings/${exchange}`, { method: "DELETE" });
      flash("Disconnected", true);
      await loadConns();
    } catch {
      flash("Failed to disconnect", false);
    }
  }

  function flash(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 2500);
  }

  function toggleReveal(key: string) {
    setReveal((p) => ({ ...p, [key]: !p[key] }));
  }

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="h-full overflow-y-auto relative">
      {/* subtle gold wash */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-gold/[0.02] to-transparent" />

      <div className="relative max-w-2xl mx-auto px-8 py-10">
        {/* header */}
        <div className="mb-10 animate-fade-in">
          <h1 className="font-display text-[3.2rem] leading-none text-text tracking-wide">
            Settings
          </h1>
          <p className="mt-2 text-text-secondary text-sm">
            Connect your exchange accounts to enable live trading
          </p>
        </div>

        <div className="space-y-6">
          {/* ── Binance ────────────────────────────────────── */}
          <ExchangeCard
            name="Binance"
            desc="The world's largest centralized exchange"
            icon="🟡"
            accent="amber"
            connected={conns.binance?.connected ?? false}
            isSaving={saving === "binance"}
            canSave={!!binance.apiKey && !!binance.apiSecret}
            onSave={() => save("binance", binance)}
            onDisconnect={() => disconnect("binance")}
            delay={0}
          >
            <SecretField
              label="API Key"
              value={binance.apiKey}
              onChange={(v) => setBinance((p) => ({ ...p, apiKey: v }))}
              placeholder="Enter your Binance API key"
              revealed={reveal["b-key"]}
              onToggle={() => toggleReveal("b-key")}
            />
            <SecretField
              label="API Secret"
              value={binance.apiSecret}
              onChange={(v) => setBinance((p) => ({ ...p, apiSecret: v }))}
              placeholder="Enter your Binance API secret"
              revealed={reveal["b-sec"]}
              onToggle={() => toggleReveal("b-sec")}
            />
          </ExchangeCard>

          {/* ── RobinPump ──────────────────────────────────── */}
          <ExchangeCard
            name="RobinPump"
            desc="Fair-launch token launchpad on Base — trade idea coins on bonding curves"
            icon="🚀"
            accent="green"
            connected={conns.robinpump?.connected ?? false}
            isSaving={saving === "robinpump"}
            canSave={!!robinpump.apiKey}
            onSave={() =>
              save("robinpump", {
                ...robinpump,
                apiSecret: robinpump.apiSecret || "https://mainnet.base.org",
              })
            }
            onDisconnect={() => disconnect("robinpump")}
            delay={1}
          >
            <SecretField
              label="Wallet Private Key"
              value={robinpump.apiKey}
              onChange={(v) => setRobinpump((p) => ({ ...p, apiKey: v }))}
              placeholder="Your Base wallet private key (0x…)"
              revealed={reveal["rp-key"]}
              onToggle={() => toggleReveal("rp-key")}
            />
            <SecretField
              label="Base RPC URL"
              value={robinpump.apiSecret}
              onChange={(v) => setRobinpump((p) => ({ ...p, apiSecret: v }))}
              placeholder="https://mainnet.base.org (default)"
            />
            <div className="p-3 bg-emerald-500/[0.04] border border-emerald-500/10 rounded-lg">
              <p className="text-[11px] text-emerald-400/80 leading-relaxed">
                <strong className="text-emerald-400">Hackathon track:</strong> Highest trading
                volume wins the prize. Strategies that generate volume (DCA, market making, etc.)
                are rewarded.
              </p>
            </div>
          </ExchangeCard>
        </div>

        {/* ── Security note ──────────────────────────────── */}
        <div
          className="mt-8 p-4 bg-amber-500/[0.04] border border-amber-500/10 rounded-xl
                     opacity-0 animate-fade-in"
          style={{ animationDelay: "0.3s" }}
        >
          <p className="text-[12px] text-amber-400/80 leading-relaxed">
            <strong className="text-amber-400">⚠ Security Note:</strong> Keys are stored locally in
            your SQLite database. Never share your database file. In production these would be
            encrypted at rest.
          </p>
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl border shadow-2xl animate-slide-up z-50 ${
            toast.ok
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}
        >
          <span className="text-sm font-semibold">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

/* ── Exchange card ────────────────────────────────────────── */

function ExchangeCard({
  name,
  desc,
  icon,
  accent,
  connected,
  isSaving,
  canSave,
  onSave,
  onDisconnect,
  delay,
  children,
}: {
  name: string;
  desc: string;
  icon: string;
  accent: "amber" | "green";
  connected: boolean;
  isSaving: boolean;
  canSave: boolean;
  onSave: () => void;
  onDisconnect: () => void;
  delay: number;
  children: ReactNode;
}) {
  const ACCENT_MAP = {
    amber: { ring: "border-amber-500/15", glow: "from-amber-500/[0.03] to-transparent" },
    green: { ring: "border-emerald-500/15", glow: "from-emerald-500/[0.03] to-transparent" },
  };
  const { ring, glow } = ACCENT_MAP[accent];

  return (
    <div
      className={`bg-surface/80 border ${ring} rounded-2xl overflow-hidden opacity-0 animate-fade-in`}
      style={{ animationDelay: `${delay * 60 + 80}ms` }}
    >
      {/* subtle gradient top */}
      <div className={`h-1 bg-gradient-to-r ${glow}`} />

      <div className="p-6">
        {/* header row */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <span className="text-xl">{icon}</span>
            <div>
              <h3 className="text-[15px] font-semibold text-text">{name}</h3>
              <p className="text-[12px] text-text-muted mt-0.5">{desc}</p>
            </div>
          </div>
          {connected ? (
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
              <span className="w-[5px] h-[5px] rounded-full bg-emerald-400" />
              Connected
            </span>
          ) : (
            <span className="text-[11px] font-bold text-text-muted bg-surface-3 px-2.5 py-1 rounded-full">
              Not connected
            </span>
          )}
        </div>

        {/* fields */}
        <div className="mt-5 space-y-3">{children}</div>

        {/* actions */}
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={!canSave || isSaving}
            className="px-5 py-2 bg-gold text-obsidian text-[13px] font-bold rounded-xl
                       hover:bg-gold-bright transition-all cursor-pointer
                       disabled:opacity-30 disabled:cursor-not-allowed
                       hover:shadow-[0_0_16px_rgba(229,160,13,0.18)]"
          >
            {isSaving ? "Saving…" : connected ? "Update Keys" : "Connect"}
          </button>
          {connected && (
            <button
              onClick={onDisconnect}
              className="px-4 py-2 border border-border text-[13px] font-semibold text-text-muted rounded-xl
                         hover:text-red-400 hover:border-red-500/30 transition-all cursor-pointer"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Secret input field ───────────────────────────────────── */

function SecretField({
  label,
  value,
  onChange,
  placeholder,
  revealed,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  revealed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.06em] mb-1.5 block">
        {label}
      </label>
      <div className="relative">
        <input
          type={revealed === false || revealed === undefined ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-surface-2 border border-border rounded-lg px-3.5 py-2.5
                     text-sm text-text placeholder-text-muted/60 font-mono
                     focus:outline-none focus:border-gold/30 transition-colors"
        />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          >
            {revealed ? (
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 16 16"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 2.5l11 11M6.5 6.8a2 2 0 002.7 2.7" />
                <path d="M4.2 4.5C2.8 5.6 1.8 7.2 1.2 8c1.2 1.8 3.4 4.5 6.8 4.5.9 0 1.7-.2 2.4-.5M8 3.5c3.4 0 5.6 2.7 6.8 4.5-.3.5-.8 1.2-1.4 1.8" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 16 16"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1.2 8c1.2-1.8 3.4-4.5 6.8-4.5s5.6 2.7 6.8 4.5c-1.2 1.8-3.4 4.5-6.8 4.5S2.4 9.8 1.2 8z" />
                <circle cx="8" cy="8" r="2" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
