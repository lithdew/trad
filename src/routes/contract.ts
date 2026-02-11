import { createPublicClient, http, getAddress, formatEther } from "viem";
import { base } from "viem/chains";
import { tradDelegateAbi } from "../../contracts/abi";

/* ── TradDelegate contract reader (server-side) ─────────── */

function createDelegateReader() {
  const addr = process.env.TRAD_DELEGATE_ADDRESS ?? null;
  if (addr === null) return null;
  const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  return {
    client: createPublicClient({ chain: base, transport: http(rpcUrl) }),
    address: getAddress(addr),
  };
}

const delegateReader = createDelegateReader();

/* ── Routes ───────────────────────────────────────────────── */

export const contractRoutes = {
  "/api/contract/info": {
    async GET() {
      if (delegateReader === null) {
        return Response.json({ address: null, configured: false });
      }
      return Response.json({ address: delegateReader.address, configured: true });
    },
  },

  "/api/contract/balance/:address": {
    async GET(req: Request & { params: { address: string } }) {
      if (delegateReader === null) {
        return Response.json({ error: "TradDelegate contract not configured" }, { status: 404 });
      }
      try {
        const userAddr = getAddress(req.params.address);
        const balance = await delegateReader.client.readContract({
          address: delegateReader.address,
          abi: tradDelegateAbi,
          functionName: "balanceOf",
          args: [userAddr],
        });
        return Response.json({
          balance: formatEther(balance),
          balanceWei: balance.toString(),
        });
      } catch (e) {
        console.error("GET /api/contract/balance/:address error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },
};
