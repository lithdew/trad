import {
  useState,
  useEffect,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { StrategyBuilder } from "./pages/StrategyBuilder";
import { Settings } from "./pages/Settings";

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

  /* Determine active page key for the sidebar */
  const activePage = path.startsWith("/strategy")
    ? "builder"
    : path === "/settings"
      ? "settings"
      : "dashboard";

  /* Route → component */
  let page: ReactNode;
  if (path === "/settings") {
    page = <Settings />;
  } else if (path.startsWith("/strategy")) {
    const id = path.startsWith("/strategy/") ? path.split("/")[2] : undefined;
    page = <StrategyBuilder strategyId={id} />;
  } else {
    page = <Dashboard />;
  }

  return (
    <RouterContext.Provider value={{ path, navigate }}>
      <Layout activePage={activePage}>{page}</Layout>
    </RouterContext.Provider>
  );
}

export default App;
