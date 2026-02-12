import { prisma } from "../db";

/* ═══════════════════════════════════════════════════════════════
   Marketplace API — browse, list, and purchase strategy templates.
   No admin auth required; wallet address is the identity.
   ═══════════════════════════════════════════════════════════════ */

function getWalletAddress(req: Request) {
  return req.headers.get("x-wallet-address") ?? null;
}

export const marketplaceRoutes = {
  /* ── Browse listings ──────────────────────────────────────── */
  "/api/marketplace": {
    async GET(req: Request) {
      try {
        const url = new URL(req.url);
        const category = url.searchParams.get("category");
        const sort = url.searchParams.get("sort") ?? "newest";
        const search = url.searchParams.get("search") ?? "";
        const wallet = getWalletAddress(req);

        const where: Record<string, unknown> = { status: "listed" };
        if (category !== null && category !== "" && category !== "all") {
          where.category = category;
        }
        if (search !== "") {
          where.OR = [{ title: { contains: search } }, { description: { contains: search } }];
        }

        let orderBy: Record<string, string>;
        if (sort === "price-low") orderBy = { priceEth: "asc" };
        else if (sort === "price-high") orderBy = { priceEth: "desc" };
        else if (sort === "popular") orderBy = { purchaseCount: "desc" };
        else orderBy = { createdAt: "desc" }; // newest

        const listings = await prisma.marketplaceListing.findMany({
          where,
          orderBy,
          include: { strategy: true },
          take: 50,
        });

        /* Enrich each listing with performance summary */
        const result: unknown[] = [];
        for (const listing of listings) {
          const perf = await getStrategyPerformanceSummary(listing.strategyId);
          let owned = false;
          if (wallet !== null && wallet !== "") {
            /* Check if the caller already owns it */
            if (listing.sellerAddress.toLowerCase() === wallet.toLowerCase()) {
              owned = true;
            } else {
              const purchase = await prisma.marketplacePurchase.findUnique({
                where: {
                  listingId_buyerAddress: {
                    listingId: listing.id,
                    buyerAddress: wallet.toLowerCase(),
                  },
                },
              });
              owned = purchase !== null;
            }
          }
          result.push({
            id: listing.id,
            strategyId: listing.strategyId,
            sellerAddress: listing.sellerAddress,
            title: listing.title,
            description: listing.description,
            category: listing.category,
            priceEth: listing.priceEth,
            purchaseCount: listing.purchaseCount,
            createdAt: listing.createdAt,
            updatedAt: listing.updatedAt,
            performance: perf,
            owned,
          });
        }

        return Response.json(result);
      } catch (e) {
        console.error("GET /api/marketplace error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },

    /* ── Create a listing ─────────────────────────────────────── */
    async POST(req: Request) {
      try {
        const wallet = getWalletAddress(req);
        if (wallet === null || wallet === "") {
          return Response.json({ error: "Connect wallet to list a strategy" }, { status: 401 });
        }

        const body = await req.json();
        const strategyId = body.strategyId as string | undefined;
        if (strategyId === undefined || strategyId === "") {
          return Response.json({ error: "strategyId is required" }, { status: 400 });
        }

        const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } });
        if (strategy === null) {
          return Response.json({ error: "Strategy not found" }, { status: 404 });
        }
        if (strategy.code === null || strategy.code === "") {
          return Response.json(
            { error: "Strategy has no code — generate code first" },
            { status: 400 },
          );
        }

        const priceEth = typeof body.priceEth === "number" ? body.priceEth : 0;
        const title =
          typeof body.title === "string" && body.title.trim() !== ""
            ? body.title.trim()
            : strategy.name;
        const description =
          typeof body.description === "string" && body.description.trim() !== ""
            ? body.description.trim()
            : (strategy.description ?? null);
        const category =
          typeof body.category === "string" && body.category.trim() !== ""
            ? body.category.trim()
            : "general";

        const listing = await prisma.marketplaceListing.create({
          data: {
            strategyId,
            sellerAddress: wallet.toLowerCase(),
            title,
            description,
            category,
            priceEth,
          },
        });

        return Response.json(listing);
      } catch (e) {
        console.error("POST /api/marketplace error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  /* ── Single listing detail ──────────────────────────────────── */
  "/api/marketplace/:id": {
    async GET(req: Request & { params: { id: string } }) {
      try {
        const wallet = getWalletAddress(req);
        const listing = await prisma.marketplaceListing.findUnique({
          where: { id: req.params.id },
          include: { strategy: true },
        });
        if (listing === null) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        const perf = await getStrategyPerformanceSummary(listing.strategyId);

        let owned = false;
        if (wallet !== null && wallet !== "") {
          if (listing.sellerAddress.toLowerCase() === wallet.toLowerCase()) {
            owned = true;
          } else {
            const purchase = await prisma.marketplacePurchase.findUnique({
              where: {
                listingId_buyerAddress: {
                  listingId: listing.id,
                  buyerAddress: wallet.toLowerCase(),
                },
              },
            });
            owned = purchase !== null;
          }
        }

        return Response.json({
          id: listing.id,
          strategyId: listing.strategyId,
          sellerAddress: listing.sellerAddress,
          title: listing.title,
          description: listing.description,
          category: listing.category,
          priceEth: listing.priceEth,
          purchaseCount: listing.purchaseCount,
          createdAt: listing.createdAt,
          updatedAt: listing.updatedAt,
          performance: perf,
          owned,
          /* Include strategy code + config only if the caller owns it */
          strategy: owned
            ? {
                id: listing.strategy.id,
                name: listing.strategy.name,
                description: listing.strategy.description,
                exchange: listing.strategy.exchange,
                code: listing.strategy.code,
                config: listing.strategy.config,
                parameters: listing.strategy.parameters,
              }
            : {
                id: listing.strategy.id,
                name: listing.strategy.name,
                exchange: listing.strategy.exchange,
              },
        });
      } catch (e) {
        console.error("GET /api/marketplace/:id error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  /* ── Delist a listing (seller only) ───────────────────────────── */
  "/api/marketplace/:id/delist": {
    async POST(req: Request & { params: { id: string } }) {
      try {
        const wallet = getWalletAddress(req);
        if (wallet === null || wallet === "") {
          return Response.json({ error: "Connect wallet to delist" }, { status: 401 });
        }

        const listing = await prisma.marketplaceListing.findUnique({
          where: { id: req.params.id },
        });
        if (listing === null) {
          return Response.json({ error: "Listing not found" }, { status: 404 });
        }
        if (listing.sellerAddress.toLowerCase() !== wallet.toLowerCase()) {
          return Response.json({ error: "Only the seller can delist" }, { status: 403 });
        }
        if (listing.status === "delisted") {
          return Response.json({ error: "Already delisted" }, { status: 400 });
        }

        await prisma.marketplaceListing.update({
          where: { id: listing.id },
          data: { status: "delisted" },
        });

        return Response.json({ success: true });
      } catch (e) {
        console.error("POST /api/marketplace/:id/delist error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  /* ── Purchase a listing ─────────────────────────────────────── */
  "/api/marketplace/:id/purchase": {
    async POST(req: Request & { params: { id: string } }) {
      try {
        const wallet = getWalletAddress(req);
        if (wallet === null || wallet === "") {
          return Response.json({ error: "Connect wallet to purchase" }, { status: 401 });
        }

        const listing = await prisma.marketplaceListing.findUnique({
          where: { id: req.params.id },
          include: { strategy: true },
        });
        if (listing === null || listing.status !== "listed") {
          return Response.json({ error: "Listing not found or delisted" }, { status: 404 });
        }

        /* Can't buy your own */
        if (listing.sellerAddress.toLowerCase() === wallet.toLowerCase()) {
          return Response.json({ error: "You can't purchase your own strategy" }, { status: 400 });
        }

        /* Check if already purchased */
        const existing = await prisma.marketplacePurchase.findUnique({
          where: {
            listingId_buyerAddress: {
              listingId: listing.id,
              buyerAddress: wallet.toLowerCase(),
            },
          },
        });
        if (existing !== null) {
          return Response.json({ error: "You already own this strategy" }, { status: 400 });
        }

        /* Record the purchase + clone the strategy for the buyer */
        const [purchase, clonedStrategy] = await prisma.$transaction(async (tx) => {
          const p = await tx.marketplacePurchase.create({
            data: {
              listingId: listing.id,
              buyerAddress: wallet.toLowerCase(),
              pricePaidEth: listing.priceEth,
            },
          });

          await tx.marketplaceListing.update({
            where: { id: listing.id },
            data: { purchaseCount: { increment: 1 } },
          });

          /* Clone the strategy so the buyer gets their own copy */
          const clone = await tx.strategy.create({
            data: {
              name: listing.title,
              description: listing.description,
              exchange: listing.strategy.exchange,
              status: "draft",
              code: listing.strategy.code,
              config: listing.strategy.config,
              parameters: listing.strategy.parameters,
            },
          });

          return [p, clone] as const;
        });

        return Response.json({
          purchase: {
            id: purchase.id,
            listingId: purchase.listingId,
            pricePaidEth: purchase.pricePaidEth,
          },
          strategy: {
            id: clonedStrategy.id,
            name: clonedStrategy.name,
          },
        });
      } catch (e) {
        console.error("POST /api/marketplace/:id/purchase error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  /* ── My purchases ───────────────────────────────────────────── */
  "/api/marketplace/purchases": {
    async GET(req: Request) {
      try {
        const wallet = getWalletAddress(req);
        if (wallet === null || wallet === "") {
          return Response.json([]);
        }

        const purchases = await prisma.marketplacePurchase.findMany({
          where: { buyerAddress: wallet.toLowerCase() },
          include: { listing: true },
          orderBy: { createdAt: "desc" },
        });

        return Response.json(purchases);
      } catch (e) {
        console.error("GET /api/marketplace/purchases error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },
};

/* ── Performance helper ─────────────────────────────────────── */

async function getStrategyPerformanceSummary(strategyId: string) {
  /* Find the latest (or active) run */
  const run = await prisma.strategyRun.findFirst({
    where: { strategyId },
    orderBy: { startedAt: "desc" },
  });

  if (run === null) {
    return {
      totalPnlEth: 0,
      totalPnlPct: 0,
      winRate: 0,
      totalTrades: 0,
      isActive: false,
    };
  }

  const trades = await prisma.strategyTrade.findMany({
    where: { runId: run.id },
    orderBy: { idx: "asc" },
  });

  let cum = 0;
  let sellCount = 0;
  let sellWins = 0;

  for (const t of trades) {
    cum += t.pnlEth;
    if (t.side !== "sell") continue;
    sellCount++;
    if (t.pnlEth > 0) sellWins++;
  }

  return {
    totalPnlEth: cum,
    totalPnlPct: run.initialCapitalEth > 0 ? (cum / run.initialCapitalEth) * 100 : 0,
    winRate: sellCount > 0 ? (sellWins / sellCount) * 100 : 0,
    totalTrades: trades.length,
    isActive: run.stoppedAt === null,
  };
}
