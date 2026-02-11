import { serve } from "bun";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import index from "./index.html";
import { prisma } from "./db";
import { catalog } from "./lib/catalog";
import { startStrategy, stopStrategy, getStrategyRuntime, listRunning } from "./lib/runtime";
import { RobinPump } from "../robinpump";

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "•".repeat(Math.min(value.length - 4, 24)) + value.slice(-4);
}

/* ── Strategy code-gen system prompt (Sonnet 4.5) ────────── */

const STRATEGY_SYSTEM = `You are trad's strategy AI — you help non-technical users design crypto trading strategies.

You communicate in two parts:
1. A friendly, concise chat reply explaining what you've built or changed
2. A fenced code block containing the strategy as a single TypeScript file

STRATEGY FILE FORMAT:
The strategy must be a single async function. Use this exact template:

\`\`\`typescript
// Strategy: {name}
// Exchange: {binance | robinpump}
// Description: {one-line description}

// === Parameters (user-configurable) ===
// @param {paramName} {type} {default} {description}
// Example: @param buyAmount number 50 Amount in USD to buy each time
// Example: @param priceTrigger number 60000 Buy when price drops below this
// Example: @param interval string 1h How often to check
// Example: @param enableStopLoss boolean false Enable stop-loss protection

async function main(api: StrategyAPI) {
  // Strategy logic here using api.*
  // Use PARAMS.paramName to access user-configurable values
  
  api.scheduleNext(PARAMS.interval);
}
\`\`\`

AVAILABLE API:
- api.getPrice(pair: string): Promise<number> — get current price
- api.buy({ pair, amount, type: 'market'|'limit' }): Promise<Order>
- api.sell({ pair, amount, type: 'market'|'limit' }): Promise<Order>
- api.getBalance(asset: string): Promise<number>
- api.log(message: string): void
- api.scheduleNext(interval: string): void — '1m', '5m', '1h', '1d'
- api.robinpump.listCoins({ sort, limit }): Promise<Coin[]>
- api.robinpump.buy(tokenAddress, ethAmount): Promise<TxReceipt>
- api.robinpump.sell(tokenAddress, tokenAmount): Promise<TxReceipt>
- api.robinpump.getPrice(tokenAddress): Promise<number>
- api.robinpump.getMarketCap(tokenAddress): Promise<number>
- PARAMS.{paramName} — access user-configurable parameters

RULES:
- Always include @param comments for every configurable value
- Use "binance" for major crypto (BTC, ETH, SOL, etc.)
- Use "robinpump" for memecoins, idea coins, bonding curve tokens, or if user mentions RobinPump
- Keep code simple and readable — these users are non-coders
- Always call api.scheduleNext() at the end
- Write real, functional strategy code — not pseudocode
- Be concise in chat — max 2-3 sentences, then the code block`;

/* ── UI-gen system prompt (Haiku 4.5) ────────────────────── */

function uiSystemPrompt() {
  return catalog.prompt({
    system: `You generate beautiful trading strategy dashboard UIs. You receive a strategy description and its configurable parameters, and you create a rich visual interface.

LAYOUT RULES — BENTO GRID:
- The ROOT element MUST be a Container with layout="grid" columns="2" — responsive bento grid
- Children MUST be in this EXACT order:
  1. StrategyHeader (auto spans full width)
  2. InfoBox with strategy tips (auto spans full width)
  3. PriceChart (auto spans full width)
  4. Flow container — a Container with layout="flex" direction="horizontal" wrapping FlowBlocks connected by Connectors (auto spans full width)
  5. ParameterGroup(s) with inputs — regular grid items (fill columns)
  6. MetricRow with MetricCards — regular grid items (fill columns)

COMPONENT RULES:
- StrategyHeader: ALWAYS include name, exchange, status, and a description prop summarizing the strategy
- PriceChart: show chart for the main trading pair
- FlowBlocks: use WHEN (blue, clock) → IF (violet, chart) → THEN (emerald, bolt) — wrap all in a HORIZONTAL flex Container with Connectors between them
- ParameterGroup: wrap NumberInput/SelectInput/ToggleInput for every @param
- MetricRow + MetricCard: key stats with live state bindings (see DATA BINDING below)
- InfoBox: strategy tips or important notes

DATA BINDING — interactive MetricCards:
- Each @param is stored in the state store at path "/{paramKey}"
- MetricCard values that show a parameter MUST use a $path binding so they update when the user changes an input
- Example: for @param maxMarketCap, set MetricCard value to {"path":"/maxMarketCap"} instead of hardcoding "$3,000"
- FlowBlock labels MUST use {paramKey} template tokens for any value that corresponds to a @param, embedded in readable text
- Example: for @param maxMarketCap with default 3000, write the label as "Market cap < {maxMarketCap} USD" — the UI will interpolate {maxMarketCap} with the live value
- Example: for @param interval with default "5m", write "Check for new coins every {interval}"`,

    customRules: [
      "Output SpecStream format — one JSON patch per line, RAW lines only, NO markdown code fences",
      "First patch must set /root, then build elements one at a time",
      "Each element needs type and props at minimum",
      "Keep element keys short: root, header, chart, flow, params, metrics, info, etc.",
      "ROOT Container MUST use layout='grid' columns='2' gap='md' for bento layout",
      "CRITICAL: Flow blocks MUST be inside a Container with layout='flex' direction='horizontal' align='center' — this creates a WHEN → IF → THEN horizontal pipeline",
      "CRITICAL: include NumberInput/SelectInput/ToggleInput for EVERY @param from the strategy",
      "CRITICAL: StrategyHeader MUST always include a description prop that summarizes what the strategy does",
      "CRITICAL: MetricCard values that correspond to @param values MUST use state path bindings like {\"path\":\"/paramKey\"} — this makes them update live when the user changes inputs. Include the unit prop separately (e.g. unit='USD').",
      "CRITICAL: In FlowBlock labels, embed {paramKey} tokens for any parameter value — e.g. 'Every {interval}', 'Market cap < {maxMarketCap}', 'Buy {buyAmount} ETH'. The UI auto-interpolates these from live state so labels update when users change inputs.",
      "NEVER wrap output in ```json or ``` — output raw JSON patch lines only",
    ],
  });
}

const server = serve({
  routes: {
    // ── SPA pages ────────────────────────────────────────
    "/": index,
    "/dashboard": index,
    "/settings": index,
    "/strategy": index,
    "/strategy/:slug": index,

    // ── Chat (Sonnet 4.5 with extended thinking) ─────────
    "/api/chat": {
      async POST(req) {
        try {
          const { messages, currentCode } = (await req.json()) as {
            messages: { role: string; content: string }[];
            currentCode?: string;
          };

          // Build messages for the AI
          const aiMessages = messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

          // If there's existing code, prepend context
          if (currentCode) {
            aiMessages.unshift({
              role: "user" as const,
              content: `Current strategy code:\n\`\`\`typescript\n${currentCode}\n\`\`\`\nPlease iterate on this strategy based on my next message.`,
            });
            aiMessages.unshift({
              role: "assistant" as const,
              content: "I can see your current strategy. What would you like to change?",
            });
          }

          const result = streamText({
            model: anthropic("claude-sonnet-4-5"),
            system: STRATEGY_SYSTEM,
            messages: aiMessages,
            maxOutputTokens: 16000,
            providerOptions: {
              anthropic: {
                thinking: { type: "enabled", budgetTokens: 10000 },
              },
            },
          });

          // Stream a custom SSE format: thinking, text, and reasoning deltas
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              try {
                for await (const part of result.fullStream) {
                  if (part.type === "reasoning-delta") {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "thinking", text: part.text })}\n\n`,
                      ),
                    );
                  } else if (part.type === "text-delta") {
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "text", text: part.text })}\n\n`,
                      ),
                    );
                  } else if (part.type === "finish") {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
                    );
                  }
                }
                controller.close();
              } catch (e) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "error", text: String(e) })}\n\n`),
                );
                controller.close();
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (e) {
          console.error("POST /api/chat error:", e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
    },

    // ── UI Generation (Haiku 4.5 — fast) ─────────────────
    "/api/generate": {
      async POST(req) {
        try {
          const { prompt, currentSpec } = await req.json();

          const result = streamText({
            model: anthropic("claude-haiku-4-5"),
            system: uiSystemPrompt(),
            messages: [
              ...(currentSpec?.root
                ? [
                    {
                      role: "user" as const,
                      content: `Current UI spec:\n${JSON.stringify(currentSpec, null, 2)}\n\nRefine it based on: ${prompt}`,
                    },
                  ]
                : [
                    {
                      role: "user" as const,
                      content: prompt,
                    },
                  ]),
            ],
            maxOutputTokens: 4096,
            temperature: 0.7,
          });

          return result.toTextStreamResponse();
        } catch (e) {
          console.error("POST /api/generate error:", e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
    },

    // ── Settings (Exchange Secrets) ────────────────────────
    "/api/settings": {
      async GET() {
        try {
          const secrets = await prisma.exchangeSecret.findMany();
          return Response.json(
            secrets.map((s) => ({
              id: s.id,
              exchange: s.exchange,
              apiKey: maskSecret(s.apiKey),
              apiSecret: maskSecret(s.apiSecret),
              walletAddress: s.walletAddress ? maskSecret(s.walletAddress) : null,
              connected: !!(s.apiKey && s.apiSecret),
              updatedAt: s.updatedAt,
            })),
          );
        } catch (e) {
          console.error("GET /api/settings error:", e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
      async POST(req) {
        try {
          const body = await req.json();
          const { exchange, apiKey, apiSecret, walletAddress } = body as {
            exchange: string;
            apiKey: string;
            apiSecret: string;
            walletAddress?: string;
          };
          const secret = await prisma.exchangeSecret.upsert({
            where: { exchange },
            create: { exchange, apiKey, apiSecret, walletAddress },
            update: { apiKey, apiSecret, walletAddress },
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
      async DELETE(req) {
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

    // ── Strategies ─────────────────────────────────────────
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
      async POST(req) {
        try {
          const body = await req.json();
          const strategy = await prisma.strategy.create({
            data: {
              name: body.name ?? "Untitled Strategy",
              description: body.description,
              exchange: body.exchange ?? "binance",
              status: body.status ?? "draft",
              code: body.code,
              config: body.config,
              parameters: body.parameters,
            },
          });
          return Response.json(strategy);
        } catch (e) {
          console.error("POST /api/strategies error:", e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
    },

    "/api/strategies/:id": {
      async GET(req) {
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
      async PUT(req) {
        try {
          const body = await req.json();
          const strategy = await prisma.strategy.update({
            where: { id: req.params.id },
            data: {
              name: body.name,
              description: body.description,
              exchange: body.exchange,
              status: body.status,
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
      async DELETE(req) {
        try {
          await prisma.strategy.delete({ where: { id: req.params.id } });
          return Response.json({ success: true });
        } catch (e) {
          console.error("DELETE /api/strategies/:id error:", e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
    },

    // ── Strategy Deploy / Stop ─────────────────────────────
    "/api/strategies/:id/deploy": {
      async POST(req) {
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
      async POST(req) {
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
      async GET(req) {
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

    // ── RobinPump Data (subgraph proxies) ──────────────────
    "/api/robinpump/coins": {
      async GET(req) {
        try {
          const url = new URL(req.url);
          const sort = url.searchParams.get("sort") === "mc" ? "marketCap" : "newest";
          const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
          const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
          const coins = await RobinPump.fetchCoins(
            sort as "newest" | "marketCap",
            Math.min(limit, 200),
            offset,
          );
          return Response.json(coins);
        } catch (e) {
          console.error("GET /api/robinpump/coins error:", e);
          return Response.json({ error: String(e) }, { status: 500 });
        }
      },
    },

    "/api/robinpump/coins/:pair": {
      async GET(req) {
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
      async GET(req) {
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
      async GET(req) {
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
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 trad running at ${server.url}`);
