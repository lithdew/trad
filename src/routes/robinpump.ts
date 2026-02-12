import { parseEther, getAddress } from "viem";
import { prisma } from "../db";
import { RobinPump } from "../../robinpump";
import { requireAdmin } from "../lib/server/security";
import { isDryRun } from "../lib/runtime";
import { readRiskLimitsFromEnv } from "../lib/risk";
import { isHexPrivateKey } from "../lib/hex";
import { tradDelegateAbi } from "../../contracts/abi";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http } from "viem";

export const robinpumpRoutes = {
  "/api/robinpump/coins": {
    async GET(req: Request) {
      try {
        const url = new URL(req.url);
        const sort: "newest" | "marketCap" =
          url.searchParams.get("sort") === "mc" ? "marketCap" : "newest";
        const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
        const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
        const coins = await RobinPump.fetchCoins(sort, Math.min(limit, 200), offset);
        return Response.json(coins);
      } catch (e) {
        console.error("GET /api/robinpump/coins error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/robinpump/coins/:pair": {
    async GET(req: Request & { params: { pair: string } }) {
      try {
        const coin = await RobinPump.fetchCoin(req.params.pair);
        if (coin === null) return Response.json({ error: "Coin not found" }, { status: 404 });
        return Response.json(coin);
      } catch (e) {
        console.error("GET /api/robinpump/coins/:pair error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/robinpump/coins/:pair/trades": {
    async GET(req: Request & { params: { pair: string } }) {
      try {
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
        const trades = await RobinPump.fetchTrades(req.params.pair, Math.min(limit, 100));
        return Response.json(trades);
      } catch (e) {
        console.error("GET /api/robinpump/coins/:pair/trades error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/robinpump/coins/:pair/metadata": {
    async GET(req: Request & { params: { pair: string } }) {
      try {
        const coin = await RobinPump.fetchCoin(req.params.pair);
        if (coin === null) return Response.json({ error: "Coin not found" }, { status: 404 });
        const metadata = await RobinPump.fetchMetadata(coin.uri);
        return Response.json({ ...coin, metadata });
      } catch (e) {
        console.error("GET /api/robinpump/coins/:pair/metadata error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/robinpump/coins-enriched": {
    async GET(req: Request) {
      try {
        const url = new URL(req.url);
        const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
        const [coins, ethUsdPrice] = await Promise.all([
          RobinPump.fetchCoins("marketCap", Math.min(limit, 200)),
          RobinPump.getEthUsdPrice(),
        ]);
        const enriched: {
          pairAddress: string;
          tokenAddress: string;
          name: string;
          symbol: string;
          lastPriceEth: number;
          lastPriceUsd: number;
          totalVolumeEth: number;
          ethCollected: number;
          tradeCount: number;
          graduated: boolean;
          marketCapUsd: number;
        }[] = [];
        for (const coin of coins) {
          enriched.push({
            pairAddress: coin.pairAddress,
            tokenAddress: coin.tokenAddress,
            name: coin.name,
            symbol: coin.symbol,
            lastPriceEth: coin.lastPriceEth,
            lastPriceUsd: coin.lastPriceUsd,
            totalVolumeEth: coin.totalVolumeEth,
            ethCollected: coin.ethCollected,
            tradeCount: coin.tradeCount,
            graduated: coin.graduated,
            marketCapUsd: coin.ethCollected * ethUsdPrice,
          });
        }
        return Response.json({ coins: enriched, ethUsdPrice });
      } catch (e) {
        console.error("GET /api/robinpump/coins-enriched error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },

  "/api/robinpump/trade": {
    async POST(req: Request) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;
      try {
        const body: unknown = await req.json();
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        const obj = body as Record<string, unknown>;
        const pairAddressRaw = obj.pairAddress;
        const actionRaw = obj.action;
        const amountRaw = obj.amount;

        if (typeof pairAddressRaw !== "string") {
          return Response.json({ error: "Invalid pairAddress" }, { status: 400 });
        }
        if (actionRaw !== "buy" && actionRaw !== "sell") {
          return Response.json({ error: "Invalid action" }, { status: 400 });
        }
        if (typeof amountRaw !== "string") {
          return Response.json({ error: "Invalid amount" }, { status: 400 });
        }

        const pairAddress = pairAddressRaw;
        const action = actionRaw;
        const amount = amountRaw;

        const risk = readRiskLimitsFromEnv();

        let pair: `0x${string}`;
        try {
          pair = getAddress(pairAddress);
        } catch {
          return Response.json({ error: "Invalid pairAddress" }, { status: 400 });
        }

        const numericAmount = Number.parseFloat(amount);
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
          return Response.json({ error: "Invalid amount" }, { status: 400 });
        }

        if (action === "buy" && numericAmount > risk.maxEthPerTrade) {
          return Response.json(
            {
              error: `Risk limit: amount (${numericAmount}) > maxEthPerTrade (${risk.maxEthPerTrade})`,
            },
            { status: 400 },
          );
        }

        if (isDryRun()) {
          return Response.json({
            hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
            status: "simulated",
          });
        }

        const secret = await prisma.exchangeSecret.findUnique({ where: { exchange: "robinpump" } });
        if (secret === null) {
          return Response.json(
            { error: "RobinPump not configured. Go to Settings to connect." },
            { status: 400 },
          );
        }
        const hasWallet = secret.walletAddress !== null && secret.walletAddress !== "";
        const hasDirectKey = isHexPrivateKey(secret.apiKey);
        if (!hasWallet && !hasDirectKey) {
          return Response.json(
            { error: "RobinPump not configured. Go to Settings to connect." },
            { status: 400 },
          );
        }

        // Delegate mode: trade via TradDelegate using OPERATOR_PRIVATE_KEY
        const delegateAddress = process.env.TRAD_DELEGATE_ADDRESS ?? null;
        const operatorKey = process.env.OPERATOR_PRIVATE_KEY ?? null;
        const walletAddress = secret.walletAddress;
        if (
          delegateAddress !== null &&
          operatorKey !== null &&
          isHexPrivateKey(operatorKey) &&
          walletAddress !== null &&
          walletAddress !== ""
        ) {
          const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
          const account = privateKeyToAccount(operatorKey);
          const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
          const walletClient = createWalletClient({
            account,
            chain: base,
            transport: http(rpcUrl),
          });

          const userAddr = getAddress(walletAddress);
          const delegate = getAddress(delegateAddress);
          const slippageBps = risk.defaultSlippageBps;
          const rp = new RobinPump({ privateKey: operatorKey, rpcUrl });

          if (action === "buy") {
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
            const ethWei = parseEther(amount);
            const BPS = 10_000n;
            const PLATFORM_FEE_FACTOR_BPS = 9900n;

            let minTokensOut = 0n;
            if (slippageBps > 0) {
              let delegateFeeBps = 0n;
              try {
                const fee = await publicClient.readContract({
                  address: delegate,
                  abi: tradDelegateAbi,
                  functionName: "fee",
                });
                delegateFeeBps = typeof fee === "bigint" ? fee : 0n;
              } catch {
                delegateFeeBps = 0n;
              }

              const feeTakenWei = (ethWei * delegateFeeBps) / BPS;
              const buyWei = ethWei - feeTakenWei;

              const pairInfo = await rp.getPairInfo(pair);
              const ethReserve = pairInfo.ethBalance;
              const tokenReserve = pairInfo.tokenBalance;

              const ethInAfterFee = (buyWei * PLATFORM_FEE_FACTOR_BPS) / BPS;
              const k = ethReserve * tokenReserve;
              const newEthReserve = ethReserve + ethInAfterFee;
              const newTokenReserve = newEthReserve > 0n ? k / newEthReserve : 0n;

              let expectedTokensOut = 0n;
              if (newTokenReserve < tokenReserve)
                expectedTokensOut = tokenReserve - newTokenReserve;

              const slip = BigInt(slippageBps);
              minTokensOut = (expectedTokensOut * (BPS - slip)) / BPS;
              if (minTokensOut > 0n) minTokensOut -= 1n;
            }

            const hash = await walletClient.writeContract({
              address: delegate,
              abi: tradDelegateAbi,
              functionName: "executeBuy",
              args: [userAddr, pair, ethWei, minTokensOut, deadline],
            });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            return Response.json({ hash, status: receipt.status });
          }

          const tokenAmount = parseEther(amount);
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
          const BPS = 10_000n;
          const PLATFORM_FEE_FACTOR_BPS = 9900n;

          let minEthOut = 0n;
          if (slippageBps > 0) {
            const pairInfo = await rp.getPairInfo(pair);
            const ethReserve = pairInfo.ethBalance;
            const tokenReserve = pairInfo.tokenBalance;

            const tokenInAfterFee = (tokenAmount * PLATFORM_FEE_FACTOR_BPS) / BPS;
            const k = ethReserve * tokenReserve;
            const newTokenReserve = tokenReserve + tokenInAfterFee;
            const newEthReserve = newTokenReserve > 0n ? k / newTokenReserve : 0n;

            let expectedEthOut = 0n;
            if (newEthReserve < ethReserve) expectedEthOut = ethReserve - newEthReserve;

            const slip = BigInt(slippageBps);
            minEthOut = (expectedEthOut * (BPS - slip)) / BPS;
            if (minEthOut > 0n) minEthOut -= 1n;
          }

          const hash = await walletClient.writeContract({
            address: delegate,
            abi: tradDelegateAbi,
            functionName: "executeSell",
            args: [userAddr, pair, tokenAmount, minEthOut, deadline],
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          return Response.json({ hash, status: receipt.status });
        }

        // Direct mode: private key stored in DB (admin-only).
        if (!isHexPrivateKey(secret.apiKey)) {
          return Response.json(
            { error: "Direct trading not configured. Use TradDelegate or set a private key." },
            { status: 400 },
          );
        }

        const rp = new RobinPump({ privateKey: secret.apiKey });

        if (action === "buy") {
          const result = await rp.buy(pair, amount, risk.defaultSlippageBps / 10_000);
          return Response.json({ hash: result.hash, status: result.receipt.status });
        }

        const pairInfo = await rp.getPairInfo(pair);
        const tokenAmount = parseEther(amount);
        const result = await rp.sell(
          pair,
          pairInfo.tokenAddress,
          tokenAmount,
          risk.defaultSlippageBps / 10_000,
        );
        return Response.json({ hash: result.hash, status: result.receipt.status });
      } catch (e) {
        console.error("POST /api/robinpump/trade error:", e);
        return Response.json(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 500 },
        );
      }
    },
  },
};
