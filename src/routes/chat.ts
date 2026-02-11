import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createStrategySandbox } from "../lib/sandbox";
import { isAdminRequest, rateLimit } from "../lib/server/security";

/* ── Strategy code-gen system prompt (Sonnet 4.5) ────────── */

const STRATEGY_SYSTEM = `You are trad's strategy AI — you help users design crypto trading strategies for RobinPump.fun on Base chain.

ABOUT ROBINPUMP:
RobinPump.fun is a fair-launch token launchpad on Base (like pump.fun on Solana). Tokens trade on bonding curves with 1% buy/sell fees. Gas on Base is < $0.01. Coins can "graduate" to Uniswap V4 DEX pools at a market cap threshold. All trading is on-chain via smart contracts.

SANDBOX TOOLS:
- readFile: Read files (start with api.d.ts for the full StrategyAPI)
- writeFile: Write files (write your final strategy to main.ts)
- bash: Run commands — use \`trad\`, \`robinpump\`, \`curl\`, and \`lint main.ts\`

TRAD CLI (bash) — LOCAL APP INTROSPECTION:
  trad strategies list [--limit N] [--offset N]
    List saved strategies in the local SQLite DB. Returns JSON.

  trad strategies get <id> [--code] [--params] [--config] [--chat] [--all]
    Inspect a saved strategy (metadata by default; add flags to include large fields). Returns JSON.

  trad strategies runs <id> [--limit N]
    Recent runs for a strategy (capital, mode, pnl, trade counts). Returns JSON.

  trad strategies trades <id> [--runId <id>] [--limit N]
    Recent trades for a run (defaults to latest run). Returns JSON.

  trad strategies positions <id> [--runId <id>]
    Current stored positions for a run (defaults to latest run). Returns JSON.

  trad strategies logs <id> [--limit N]
    Tail runtime logs (running or last-stopped). Returns JSON.

  trad wallet info
    Current configured wallet address + on-chain ETH balance + delegate deposit (if configured). Returns JSON.

  trad delegate status
    Current TradDelegate contract state (owner/operator/fee/paused). Returns JSON.

  trad delegate balance [--user 0x...]
    User's deposited ETH in TradDelegate. Returns JSON.

  trad dry-run
    Current dry-run state + risk limits. Returns JSON.

NOTE ON OUTPUT SIZE:
The bash tool truncates stdout/stderr for large output. For big JSON, redirect to a file and then read it:
  trad strategies get <id> --all > strategy.json
  # then use readFile or cat strategy.json

ROBINPUMP CLI (bash):
  robinpump coins [--sort newest|marketCap] [--limit N] [--offset N]
    List coins with prices, market cap, volume. Returns JSON.

  robinpump coin <pairAddress>
    Get full details for one coin. Returns JSON.

  robinpump trades <pairAddress> [--limit N]
    Recent trades for a coin. Returns JSON.

  robinpump metadata <pairAddress>
    IPFS metadata (description, image URL). Returns JSON.

  robinpump search <query>
    Search coins by name or symbol (case-insensitive). Returns JSON.

  robinpump eth-price
    Current ETH/USD price. Returns JSON.

EXTERNAL APIS (curl in bash):
  ETH/USD price: curl https://api.coinbase.com/v2/exchange-rates?currency=ETH
  Any crypto:    curl "https://api.coinbase.com/v2/exchange-rates?currency=BTC"

HOW TRAD WORKS (HIGH-LEVEL CONTEXT):
- Strategies are saved in SQLite (Prisma) with: name/description, code, parameters (JSON), config (UI spec JSON), chatHistory (JSON).
- The runtime transpiles your TypeScript to JS (Bun) and evals \`async function main(api)\` with a sandboxed \`StrategyAPI\`.
- Scheduling: call \`api.schedule("5m")\` (or \`cron:...\`, or an ISO time) to run again; omit it for one-off runs.
- Dry-run: the server may simulate trades depending on env (see \`trad dry-run\`).
- Trading execution modes:
  - Delegate (preferred): if \`TRAD_DELEGATE_ADDRESS\` + \`OPERATOR_PRIVATE_KEY\` are set and a user walletAddress is configured, trades go through the on-chain TradDelegate contract. Users deposit ETH; the operator can only trade allowlisted RobinPump pairs and cannot withdraw user funds.
  - Direct (legacy): if a private key is stored in the DB for exchange "robinpump", trades can execute directly from that wallet.

WORKFLOW:
1. Read api.d.ts to see the full StrategyAPI type definitions
2. Use \`trad\` CLI to inspect existing strategies, wallet balances, and delegate configuration as needed
3. Use \`robinpump\` CLI to explore coins, prices, and market data as needed
4. Write your strategy to main.ts
5. Run \`lint main.ts\` to check for syntax errors — fix any and re-lint
6. Reply with a concise explanation of what you built or changed

STRATEGY FORMAT (main.ts):
\`\`\`typescript
// Strategy: {name}
// Exchange: robinpump
// Description: {one-line}

// === Parameters (user-configurable) ===
// @param {name} {type} {default} {description}
//
// Allowed param types (use ONLY these):
// - number   (generic numeric)
// - int      (whole number)
// - eth      (numeric ETH amount)
// - usd      (numeric USD amount)
// - bps      (basis points, 0-5000; 100 bps = 1%)
// - pct      (percent, 0-100)
// - boolean
// - string
// - interval (30s/5m/1h/1d/once)
// - address  (0x... EVM address)
// - pair     (0x... RobinPump pair address)
// - token    (0x... ERC-20 token address)
// - enum[a|b|c] (string enum; default MUST be one of the options)
//
// Examples:
// @param tradeAmount eth 0.001 Amount in ETH per buy
// @param maxMarketCap usd 3000 Max market cap in USD
// @param slippageBps bps 250 Slippage tolerance (bps)
// @param interval interval 5m How often to run
// @param sort enum[newest|marketCap] newest Sort order
// @param pair pair 0x0000000000000000000000000000000000000000 Target pair address
// @param enableStopLoss boolean false Enable stop-loss

async function main(api: StrategyAPI) {
  // api.robinpump.* for trading
  // PARAMS.{name} for user-configurable values
  // api.schedule("5m") for recurring strategies (omit for one-off runs)
}
\`\`\`

RULES:
- Exchange is ALWAYS "robinpump" — this app only supports RobinPump.fun
- Include @param comments for every configurable value
- Use ONLY the allowed param types listed above. Do NOT invent new param types.
- When the user mentions a coin by name, run \`robinpump search <name>\` to find its pair address
- Use the pair address as a @param default so the dashboard shows real price data
- Do NOT use \`api.sleep()\` or \`while(true)\` loops. The strategy should run one "tick", then call \`api.schedule(...)\` and return.
- Call api.schedule() for recurring strategies; omit it for one-off executions
- Write real, functional strategy code — not pseudocode
- Do NOT include code blocks in your chat reply — the app displays main.ts in the Code panel automatically
- Be concise in your reply — explain what you built or changed in 2-3 sentences`;

/* ── Route ────────────────────────────────────────────────── */

export const chatRoutes = {
  "/api/chat": {
    async POST(req: Request) {
      try {
        if (!isAdminRequest(req)) {
          const rl = rateLimit(req, { key: "chat", limit: 12, windowMs: 60_000 });
          if (!rl.allowed) {
            return Response.json(
              { error: "Ratelimited" },
              {
                status: 429,
                headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
              },
            );
          }
        }

        const body: unknown = await req.json();
        if (typeof body !== "object" || body === null) {
          return Response.json({ error: "Bad request" }, { status: 400 });
        }

        const rawMessages = (body as { messages?: unknown }).messages;
        if (!Array.isArray(rawMessages)) {
          return Response.json({ error: "Bad request: messages must be an array" }, { status: 400 });
        }
        const messages = rawMessages as UIMessage[];

        const rawCurrentCode = (body as { currentCode?: unknown }).currentCode;
        const currentCode = typeof rawCurrentCode === "string" ? rawCurrentCode : undefined;

        let totalTextChars = 0;
        for (const msg of messages) {
          for (const part of msg.parts) {
            if (part.type !== "text") continue;
            totalTextChars += part.text.length;
            if (totalTextChars > 80_000) break;
          }
          if (totalTextChars > 80_000) break;
        }
        if (totalTextChars > 80_000) {
          return Response.json({ error: "Request too large" }, { status: 413 });
        }
        if (currentCode !== undefined && currentCode.length > 80_000) {
          return Response.json({ error: "Request too large" }, { status: 413 });
        }

        const modelMessages = await convertToModelMessages(messages);

        if (currentCode !== undefined && currentCode !== "") {
          modelMessages.unshift(
            {
              role: "user" as const,
              content: `Current strategy code:\n\`\`\`typescript\n${currentCode}\n\`\`\`\nPlease iterate on this strategy based on my next message.`,
            },
            {
              role: "assistant" as const,
              content: "I can see your current strategy. What would you like to change?",
            },
          );
        }

        const now = new Date();
        const timeContext = `\n\nCURRENT TIME: ${now.toISOString()} (UTC)`;

        const sandboxCode =
          currentCode !== undefined && currentCode !== ""
            ? currentCode
            : undefined;
        const { tools: sandboxTools, sandbox } =
          await createStrategySandbox(sandboxCode);

        const result = streamText({
          model: anthropic("claude-sonnet-4-5"),
          system: STRATEGY_SYSTEM + timeContext,
          messages: modelMessages,
          tools: sandboxTools,
          stopWhen: stepCountIs(15),
          maxOutputTokens: 16000,
          providerOptions: {
            anthropic: {
              thinking: { type: "enabled", budgetTokens: 10000 },
            },
          },
          onFinish: async () => {
            try {
              const code = await sandbox.readFile("/home/user/main.ts");
              console.log(`[chat] Sandbox main.ts: ${code.length} chars`);
            } catch {
              // LLM may not have written to main.ts
            }
          },
        });

        return result.toUIMessageStreamResponse({ sendReasoning: true });
      } catch (e) {
        console.error("POST /api/chat error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },
};
