import { prisma } from "../db";
import { setDryRun, isDryRun } from "../lib/runtime";
import { requireAdmin } from "../lib/server/security";

function maskSecret(value: string): string {
  if (value === "") return "";
  if (value.length <= 4) return "••••";
  return "•".repeat(Math.min(value.length - 4, 24)) + value.slice(-4);
}

export const settingsRoutes = {
  "/api/settings": {
    async GET(req: Request) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        const secrets = await prisma.exchangeSecret.findMany();
        const out: {
          id: string;
          exchange: string;
          apiKey: string;
          apiSecret: string;
          walletAddress: string | null;
          connected: boolean;
          updatedAt: Date;
        }[] = [];

        for (const s of secrets) {
          let connected = false;
          if (s.exchange === "robinpump") {
            const hasWallet = s.walletAddress !== null && s.walletAddress !== "";
            const hasDirectKey = s.apiKey !== "" && s.apiKey.startsWith("0x");
            connected = hasWallet || hasDirectKey;
          } else {
            connected = s.apiKey !== "" && s.apiSecret !== "";
          }

          // For RobinPump, apiSecret is used as the Base RPC URL (not a secret).
          const apiSecretOut = s.exchange === "robinpump" ? s.apiSecret : maskSecret(s.apiSecret);

          out.push({
            id: s.id,
            exchange: s.exchange,
            apiKey: maskSecret(s.apiKey),
            apiSecret: apiSecretOut,
            walletAddress:
              s.walletAddress !== null && s.walletAddress !== "" ? s.walletAddress : null,
            connected,
            updatedAt: s.updatedAt,
          });
        }

        return Response.json(out);
      } catch (e) {
        console.error("GET /api/settings error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
    async POST(req: Request) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        const body = await req.json();
        const { exchange, apiKey, apiSecret, walletAddress } = body as {
          exchange: string;
          apiKey: string;
          apiSecret: string;
          walletAddress?: string;
        };
        if (exchange !== "robinpump") {
          return Response.json({ error: "Unsupported exchange" }, { status: 400 });
        }

        const secret = await prisma.exchangeSecret.upsert({
          where: { exchange },
          create: { exchange, apiKey, apiSecret, walletAddress: walletAddress ?? null },
          update: { apiKey, apiSecret, walletAddress: walletAddress ?? null },
        });
        return Response.json({
          id: secret.id,
          exchange: secret.exchange,
          connected: true,
          updatedAt: secret.updatedAt,
        });
      } catch (e) {
        console.error("POST /api/settings error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/settings/:exchange": {
    async DELETE(req: Request & { params: { exchange: string } }) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        await prisma.exchangeSecret.delete({
          where: { exchange: req.params.exchange },
        });
      } catch {
        /* not found — fine */
      }
      return Response.json({ success: true });
    },
  },

  "/api/settings/dry-run": {
    async POST(req: Request) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        const { enabled } = (await req.json()) as { enabled: boolean };
        setDryRun(enabled);
        return Response.json({ dryRun: isDryRun() });
      } catch (e) {
        console.error("POST /api/settings/dry-run error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
    async GET(req: Request) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      return Response.json({ dryRun: isDryRun() });
    },
  },
};
