import { serve } from "bun";
import { resumeActiveStrategies } from "./lib/runtime";
import {
  spaRoutes,
  chatRoutes,
  generateRoutes,
  settingsRoutes,
  strategyRoutes,
  robinpumpRoutes,
  contractRoutes,
  marketplaceRoutes,
} from "./routes";

const server = serve({
  routes: {
    ...spaRoutes,
    ...chatRoutes,
    ...generateRoutes,
    ...settingsRoutes,
    ...strategyRoutes,
    ...robinpumpRoutes,
    ...contractRoutes,
    ...marketplaceRoutes,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 trad running at ${server.url}`);

// Resume strategies that were active before the server restarted
resumeActiveStrategies().catch(console.error);
