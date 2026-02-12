import { http, createConfig } from "wagmi";
import { base } from "viem/chains";
import { coinbaseWallet, injected, metaMask } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [coinbaseWallet({ appName: "trad" }), injected(), metaMask()],
  transports: {
    [base.id]: http(),
  },
});
