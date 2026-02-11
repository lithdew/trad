import index from "../index.html";

export { chatRoutes } from "./chat";
export { generateRoutes } from "./generate";
export { settingsRoutes } from "./settings";
export { strategyRoutes } from "./strategies";
export { robinpumpRoutes } from "./robinpump";
export { contractRoutes } from "./contract";
export { marketplaceRoutes } from "./marketplace";

export const spaRoutes = {
  "/": index,
  "/dashboard": index,
  "/settings": index,
  "/strategy": index,
  "/strategy/:slug": index,
  "/marketplace": index,
  "/marketplace/:slug": index,
};
