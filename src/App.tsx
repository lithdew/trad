import { useState, useEffect, createContext, useContext, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/api";
import { wagmiConfig } from "./lib/wallet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/dashboard";
import { StrategyBuilder } from "./pages/strategy-builder";
import { Settings } from "./pages/settings";
import { Marketplace } from "./pages/marketplace";

/* ── Tiny client-side router ──────────────────────────────── */

interface RouterCtx {
  path: string;
  navigate: (to: string) => void;
}

const RouterContext = createContext<RouterCtx>({
  path: "/",
  navigate: () => {},
});

export function useRouter() {
  return useContext(RouterContext);
}

/* ── App ──────────────────────────────────────────────────── */

export function App() {
  const [path, setPath] = useState(window.location.pathname);

  const navigate = (to: string) => {
    window.history.pushState(null, "", to);
    setPath(to);
  };

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  let activePage: "dashboard" | "builder" | "marketplace" | "settings" = "dashboard";
  if (path === "/settings") activePage = "settings";
  else if (path.startsWith("/marketplace")) activePage = "marketplace";
  else if (path.startsWith("/strategy")) activePage = "builder";

  let page: ReactNode = <Dashboard />;
  if (path === "/settings") page = <Settings />;
  else if (path.startsWith("/marketplace")) page = <Marketplace />;
  else if (path.startsWith("/strategy")) {
    const id = path.startsWith("/strategy/") ? path.split("/")[2] : undefined;
    page = <StrategyBuilder strategyId={id} />;
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterContext.Provider value={{ path, navigate }}>
            <Layout activePage={activePage}>{page}</Layout>
            <Toaster />
          </RouterContext.Provider>
        </TooltipProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
