import type { ReactNode } from "react";
import { LayoutDashboard, Plus, ShoppingBag, Settings } from "lucide-react";
import { useRouter } from "../App";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/* ── Layout — narrow icon sidebar + main content area ─────── */

interface LayoutProps {
  children: ReactNode;
  activePage: "dashboard" | "builder" | "marketplace" | "settings";
}

export function Layout({ children, activePage }: LayoutProps) {
  const { navigate } = useRouter();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <nav className="w-[60px] h-full bg-card/60 border-r flex flex-col items-center py-3.5 gap-1.5 shrink-0 z-20">
        {/* Logo */}
        <button
          onClick={() => navigate("/")}
          className="group size-10 rounded-xl bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-5 hover:from-primary/30 hover:to-primary/10 transition-all active:scale-95"
        >
          <span className="font-display text-primary text-[22px] tracking-wider group-hover:scale-110 transition-transform">
            t
          </span>
        </button>

        <NavBtn active={activePage === "dashboard"} onClick={() => navigate("/")} tip="Dashboard">
          <LayoutDashboard className="size-5" />
        </NavBtn>

        <NavBtn active={activePage === "builder"} onClick={() => navigate("/strategy")} tip="New Strategy">
          <Plus className="size-5" />
        </NavBtn>

        <NavBtn active={activePage === "marketplace"} onClick={() => navigate("/marketplace")} tip="Strategy Store">
          <ShoppingBag className="size-5" />
        </NavBtn>

        <div className="flex-1" />

        <NavBtn active={activePage === "settings"} onClick={() => navigate("/settings")} tip="Settings">
          <Settings className="size-5" />
        </NavBtn>
      </nav>

      <main className="flex-1 overflow-hidden relative">{children}</main>
    </div>
  );
}

/* ── Sidebar button with tooltip ─────────────────────────── */

function NavBtn({
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
  const activeCls = active
    ? "bg-primary/12 text-primary hover:bg-primary/12 hover:text-primary"
    : "text-muted-foreground hover:text-foreground";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          className={`relative size-10 rounded-xl ${activeCls}`}
        >
          {children}
          {active && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-primary rounded-r-full" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}
