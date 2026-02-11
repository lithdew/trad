import type { ReactNode } from "react";
import { useRouter } from "../App";

/* ══════════════════════════════════════════════════════════════
   Layout — narrow icon sidebar + main content area.
   Mirrors the feel of Cursor / VS Code / Figma.
   ══════════════════════════════════════════════════════════════ */

export function Layout({ children, activePage }: { children: ReactNode; activePage: string }) {
  const { navigate } = useRouter();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-obsidian">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <nav className="w-[60px] h-full bg-surface/60 border-r border-border flex flex-col items-center py-3.5 gap-1.5 shrink-0 z-20">
        {/* Logo */}
        <button
          onClick={() => navigate("/")}
          className="group w-10 h-10 rounded-xl bg-gradient-to-br from-gold/20 to-gold/5 flex items-center justify-center mb-5 hover:from-gold/30 hover:to-gold/10 transition-all duration-300 active:scale-95"
        >
          <span className="font-display text-gold text-[22px] tracking-wider group-hover:scale-110 transition-transform duration-200">
            t
          </span>
        </button>

        {/* Dashboard */}
        <SidebarBtn
          active={activePage === "dashboard"}
          onClick={() => navigate("/")}
          tip="Dashboard"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
            <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
            <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
            <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
          </svg>
        </SidebarBtn>

        {/* New Strategy */}
        <SidebarBtn
          active={activePage === "builder"}
          onClick={() => navigate("/strategy")}
          tip="New Strategy"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M10 4v12M4 10h12" />
          </svg>
        </SidebarBtn>

        <div className="flex-1" />

        {/* Settings */}
        <SidebarBtn
          active={activePage === "settings"}
          onClick={() => navigate("/settings")}
          tip="Settings"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="10" cy="10" r="2.5" />
            <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.2 4.2l1.8 1.8M14 14l1.8 1.8M4.2 15.8L6 14M14 6l1.8-1.8" />
          </svg>
        </SidebarBtn>
      </nav>

      {/* ── Main content ─────────────────────────────────── */}
      <main className="flex-1 overflow-hidden relative">{children}</main>
    </div>
  );
}

/* ── Sidebar button ───────────────────────────────────────── */

function SidebarBtn({
  children,
  active,
  onClick,
  tip,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  tip: string;
}) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`
          relative w-10 h-10 rounded-xl flex items-center justify-center
          transition-all duration-200 cursor-pointer
          ${
            active
              ? "bg-gold/[0.12] text-gold"
              : "text-text-muted hover:text-text-secondary hover:bg-white/[0.04]"
          }
        `}
      >
        {children}
        {/* Active indicator bar */}
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-gold rounded-r-full" />
        )}
      </button>

      {/* Tooltip */}
      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2.5 py-1 bg-surface-3 border border-border-light rounded-lg text-[11px] font-semibold text-text-secondary whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-xl">
        {tip}
      </div>
    </div>
  );
}
