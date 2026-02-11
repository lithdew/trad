import { prisma } from "../db";
import { startStrategy, stopStrategy, getStrategyRuntime, listRunning } from "../lib/runtime";
import { requireAdmin } from "../lib/server/security";

export const strategyRoutes = {
  "/api/strategies": {
    async GET() {
      try {
        const strategies = await prisma.strategy.findMany({
          orderBy: { updatedAt: "desc" },
        });
        return Response.json(strategies);
      } catch (e) {
        console.error("GET /api/strategies error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
    async POST(req: Request) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        const body = await req.json();
        const strategy = await prisma.strategy.create({
          data: {
            name: body.name ?? "Untitled Strategy",
            description: body.description,
            exchange: body.exchange ?? "robinpump",
            status: "draft",
            code: body.code,
            config: body.config,
            parameters: body.parameters,
            chatHistory: body.chatHistory,
          },
        });
        return Response.json(strategy);
      } catch (e) {
        console.error("POST /api/strategies error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/strategies/:id/runs": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const runs = await prisma.strategyRun.findMany({
          where: { strategyId: req.params.id },
          orderBy: { startedAt: "desc" },
          take: 25,
        });

        const out: {
          id: string;
          strategyId: string;
          startedAt: Date;
          stoppedAt: Date | null;
          initialCapitalEth: number;
          isDryRun: boolean;
          executionMode: string;
          userAddress: string | null;
          totalTrades: number;
          totalPnlEth: number;
        }[] = [];

        for (const run of runs) {
          const [totalTrades, lastTrade] = await Promise.all([
            prisma.strategyTrade.count({ where: { runId: run.id } }),
            prisma.strategyTrade.findFirst({
              where: { runId: run.id },
              orderBy: { idx: "desc" },
            }),
          ]);

          out.push({
            id: run.id,
            strategyId: run.strategyId,
            startedAt: run.startedAt,
            stoppedAt: run.stoppedAt,
            initialCapitalEth: run.initialCapitalEth,
            isDryRun: run.isDryRun,
            executionMode: run.executionMode,
            userAddress: run.userAddress,
            totalTrades,
            totalPnlEth: lastTrade?.cumulativePnlEth ?? 0,
          });
        }

        return Response.json({ runs: out });
      } catch (e) {
        console.error("GET /api/strategies/:id/runs error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/strategies/:id/performance": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const url = new URL(req.url);
        const range = url.searchParams.get("range") ?? "all";
        const runIdParam = url.searchParams.get("runId");

        const now = Math.floor(Date.now() / 1000);
        let rangeSeconds: number | null = null;
        if (range === "1h") rangeSeconds = 3600;
        else if (range === "4h") rangeSeconds = 4 * 3600;
        else if (range === "1d") rangeSeconds = 24 * 3600;
        else if (range === "7d") rangeSeconds = 7 * 24 * 3600;
        else rangeSeconds = null; // "all" (or unknown)

        let run = null as null | {
          id: string;
          strategyId: string;
          startedAt: Date;
          stoppedAt: Date | null;
          initialCapitalEth: number;
          isDryRun: boolean;
          executionMode: string;
          userAddress: string | null;
        };

        if (runIdParam !== null && runIdParam !== "") {
          const r = await prisma.strategyRun.findUnique({ where: { id: runIdParam } });
          if (r !== null && r.strategyId === req.params.id) {
            run = r;
          }
        } else {
          const open = await prisma.strategyRun.findFirst({
            where: { strategyId: req.params.id, stoppedAt: null },
            orderBy: { startedAt: "desc" },
          });
          if (open !== null) run = open;
          else {
            const latest = await prisma.strategyRun.findFirst({
              where: { strategyId: req.params.id },
              orderBy: { startedAt: "desc" },
            });
            if (latest !== null) run = latest;
          }
        }

        if (run === null) {
          return Response.json({
            run: null,
            equityCurve: [],
            trades: [],
            summary: {
              totalPnlEth: 0,
              totalPnlPct: 0,
              winRate: 0,
              totalTrades: 0,
              maxDrawdownPct: 0,
              avgTradePnlEth: 0,
              bestTradeEth: 0,
              worstTradeEth: 0,
            },
          });
        }

        const runStart = Math.floor(run.startedAt.getTime() / 1000);
        const cutoff = rangeSeconds === null ? 0 : Math.max(runStart, now - rangeSeconds);

        let baseCum = 0;
        if (cutoff > 0) {
          const prior = await prisma.strategyTrade.findFirst({
            where: { runId: run.id, timestamp: { lt: cutoff } },
            orderBy: { idx: "desc" },
          });
          if (prior !== null) baseCum = prior.cumulativePnlEth;
        }

        const dbTrades = await prisma.strategyTrade.findMany({
          where: rangeSeconds === null
            ? { runId: run.id }
            : { runId: run.id, timestamp: { gte: cutoff } },
          orderBy: { idx: "asc" },
        });

        const trades: {
          timestamp: number;
          side: "buy" | "sell";
          pnlEth: number;
          pnlPct: number;
          amountEth: number;
          pairAddress: string;
          txHash: string;
          cumulativePnlEth: number;
          idx: number;
        }[] = [];

        for (const t of dbTrades) {
          trades.push({
            timestamp: t.timestamp,
            side: t.side === "sell" ? "sell" : "buy",
            pnlEth: t.pnlEth,
            pnlPct: t.pnlPct,
            amountEth: t.amountEth,
            pairAddress: t.pairAddress,
            txHash: t.txHash,
            cumulativePnlEth: t.cumulativePnlEth - baseCum,
            idx: t.idx,
          });
        }

        const equityCurve: { timestamp: number; pnlEth: number }[] = [];
        const curveStart = rangeSeconds === null ? runStart : cutoff;
        equityCurve.push({ timestamp: curveStart, pnlEth: 0 });
        for (const t of trades) {
          equityCurve.push({ timestamp: t.timestamp, pnlEth: t.cumulativePnlEth });
        }
        const lastCum = trades.length > 0 ? trades[trades.length - 1]!.cumulativePnlEth : 0;
        equityCurve.push({ timestamp: now, pnlEth: lastCum });

        // Summary (win rate based on sells only)
        let cum = 0;
        let peak = 0;
        let maxDd = 0;
        let sellCount = 0;
        let sellWins = 0;
        let bestTrade = -Infinity;
        let worstTrade = Infinity;

        for (const t of trades) {
          cum += t.pnlEth;
          if (cum > peak) peak = cum;
          const dd = peak > 0 ? ((peak - cum) / peak) * 100 : 0;
          if (dd > maxDd) maxDd = dd;

          if (t.side !== "sell") continue;
          sellCount++;
          if (t.pnlEth > 0) sellWins++;
          if (t.pnlEth > bestTrade) bestTrade = t.pnlEth;
          if (t.pnlEth < worstTrade) worstTrade = t.pnlEth;
        }

        const totalPnlEth = cum;
        const totalPnlPct = run.initialCapitalEth > 0 ? (totalPnlEth / run.initialCapitalEth) * 100 : 0;
        const avgTradePnlEth = trades.length > 0 ? totalPnlEth / trades.length : 0;
        const winRate = sellCount > 0 ? (sellWins / sellCount) * 100 : 0;

        return Response.json({
          run: {
            id: run.id,
            strategyId: run.strategyId,
            startedAt: run.startedAt,
            stoppedAt: run.stoppedAt,
            initialCapitalEth: run.initialCapitalEth,
            isDryRun: run.isDryRun,
            executionMode: run.executionMode,
            userAddress: run.userAddress,
          },
          equityCurve,
          trades,
          summary: {
            totalPnlEth,
            totalPnlPct,
            winRate,
            totalTrades: trades.length,
            maxDrawdownPct: maxDd,
            avgTradePnlEth,
            bestTradeEth: bestTrade === -Infinity ? 0 : bestTrade,
            worstTradeEth: worstTrade === Infinity ? 0 : worstTrade,
          },
        });
      } catch (e) {
        console.error("GET /api/strategies/:id/performance error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/strategies/:id": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const strategy = await prisma.strategy.findUnique({
          where: { id: req.params.id },
        });
        if (!strategy) return Response.json({ error: "Not found" }, { status: 404 });
        return Response.json(strategy);
      } catch (e) {
        console.error("GET /api/strategies/:id error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
    async PUT(req: Request & { params: { id: string } }) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        const body = await req.json();
        const strategy = await prisma.strategy.update({
          where: { id: req.params.id },
          data: {
            name: body.name,
            description: body.description,
            exchange: body.exchange,
            code: body.code,
            config: body.config,
            parameters: body.parameters,
            chatHistory: body.chatHistory,
            lastRun: body.lastRun ? new Date(body.lastRun) : undefined,
          },
        });
        return Response.json(strategy);
      } catch (e) {
        console.error("PUT /api/strategies/:id error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
    async DELETE(req: Request & { params: { id: string } }) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        await prisma.strategy.delete({ where: { id: req.params.id } });
        return Response.json({ success: true });
      } catch (e) {
        console.error("DELETE /api/strategies/:id error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/strategies/:id/deploy": {
    async POST(req: Request & { params: { id: string } }) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        await startStrategy(req.params.id);
        const strategy = await prisma.strategy.findUnique({ where: { id: req.params.id } });
        return Response.json(strategy);
      } catch (e) {
        console.error("POST /api/strategies/:id/deploy error:", e);
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
    },
  },

  "/api/strategies/:id/stop": {
    async POST(req: Request & { params: { id: string } }) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        await stopStrategy(req.params.id);
        const strategy = await prisma.strategy.findUnique({ where: { id: req.params.id } });
        return Response.json(strategy);
      } catch (e) {
        console.error("POST /api/strategies/:id/stop error:", e);
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
    },
  },

  "/api/strategies/:id/logs": {
    async GET(req: Request & { params: { id: string } }) {
      const runtime = getStrategyRuntime(req.params.id);
      if (runtime === null) {
        return Response.json({ logs: [], isRunning: false });
      }
      return Response.json(runtime);
    },
  },

  "/api/strategies/running": {
    async GET() {
      return Response.json({ running: listRunning() });
    },
  },
};
