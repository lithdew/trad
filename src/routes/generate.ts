import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { catalog } from "../lib/catalog";
import { isAdminRequest, rateLimit, requireAdmin } from "../lib/server/security";

/* ── UI-gen system prompt (Haiku 4.5) ────────────────────── */

function uiSystemPrompt() {
  return catalog.prompt({
    system: `You generate beautiful trading strategy dashboard UIs. You receive a strategy description and its configurable parameters, and you create a rich visual interface.

LAYOUT RULES — BENTO GRID:
- The ROOT element MUST be a Container with layout="grid" columns="2" — responsive bento grid
- Children MUST be in this EXACT order:
  1. StrategyHeader (auto spans full width)
  2. StatusIndicator (auto spans full width) — show current state at a glance
  3. ScheduleDisplay (auto spans full width) — interval + timing
  4. InfoBox with strategy tips (auto spans full width)
  5. StatRow with 2-4 Stat components (auto spans full width) — highlight the most important knobs/targets
  6. PriceChart — ONLY if the strategy targets a specific known pair address (auto spans full width). See CHART RULES below.
  7. MetricRow with MetricCards — a single full-width row of 4 cards directly below the chart/info (auto spans full width)
  8. Flow container — a Container with layout="flex" direction="horizontal" wrapping FlowBlocks connected by Connectors (auto spans full width)
  9. Params container — a Container with layout="flex" direction="horizontal" wrapping ALL ParameterGroup(s) (auto spans full width — one group fills 100%, two groups share 50/50)
  10. TradeHistory (optional, auto spans full width) — include when the strategy makes repeated trades

CHART RULES — when to include PriceChart:
- INCLUDE PriceChart with a specific pair prop ONLY when the strategy code explicitly targets a known, hardcoded pair address (e.g. "market make on pair 0xabc...").
- OMIT PriceChart entirely for strategies that dynamically discover coins at runtime (sniping new coins, scanning for coins matching criteria, DCA into latest coins, etc.). These strategies don't have a known pair at config time — the bot finds coins after deployment.
- When in doubt, OMIT the chart. The dashboard looks great without it — MetricRow, FlowBlocks, and ParameterGroups fill the bento grid cleanly.
- NEVER use PriceChart without a pair prop just to have a chart. No pair = no chart.

COMPONENT RULES:
- StrategyHeader: ALWAYS include name, exchange, status, and a description prop summarizing the strategy
- StatusIndicator: ALWAYS include with a short label and a helpful description
- ScheduleDisplay: ALWAYS include with the interval from the strategy (or a sensible default like "5m")
- FlowBlocks: use WHEN (blue, clock) → IF (violet, chart) → THEN (emerald, bolt) — wrap all in a HORIZONTAL flex Container with Connectors between them
- ParameterGroup: wrap the BEST matching input component for every @param (see PARAM TYPE MAPPING below). ALWAYS place ALL ParameterGroups inside a SINGLE horizontal flex Container (step 6 above) — never place them directly in the root grid
- MetricRow + MetricCard: key stats with live state bindings (see DATA BINDING below)
- InfoBox: strategy tips or important notes

PARAM TYPE MAPPING (choose the safest input):
- eth → EthInput
- usd → UsdInput
- bps → BpsInput
- pct → PercentInput
- int → IntegerInput
- interval → IntervalInput
- address/pair/token → AddressInput
- enum[...] → SelectInput (options must match the enum values exactly)
- boolean → ToggleInput
- number → NumberInput
- string → TextInput

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
      "Keep element keys short: root, header, flow, params, metrics, info, etc.",
      "ROOT Container MUST use layout='grid' columns='2' gap='md' for bento layout",
      "CRITICAL: Flow blocks MUST be inside a Container with layout='flex' direction='horizontal' align='center' — this creates a WHEN → IF → THEN horizontal pipeline",
      "CRITICAL: include an input for EVERY @param from the strategy, using the PARAM TYPE MAPPING (EthInput/UsdInput/BpsInput/etc.)",
      "CRITICAL: NEVER invent extra params. Every input's paramKey MUST match an @param key EXACTLY (case-sensitive).",
      "CRITICAL: Always include StatusIndicator and ScheduleDisplay directly under StrategyHeader",
      "CRITICAL: Include a StatRow with 2-4 Stat components to highlight the most important knobs/targets (market cap, buy amount, interval, etc.)",
      "CRITICAL: StrategyHeader MUST always include a description prop that summarizes what the strategy does",
      'CRITICAL: MetricCard values that correspond to @param values MUST use state path bindings like {"path":"/paramKey"} — this makes them update live when the user changes inputs. Include the unit prop separately (e.g. unit=\'USD\').',
      "CRITICAL: In FlowBlock labels, embed {paramKey} tokens for any parameter value — e.g. 'Every {interval}', 'Market cap < {maxMarketCap}', 'Buy {buyAmount} ETH'. The UI auto-interpolates these from live state so labels update when users change inputs.",
      "CRITICAL: Only include PriceChart when the strategy has a specific, known pair address in its code. For coin-discovery strategies (sniping, scanning, DCA into newest), OMIT PriceChart entirely — the bento grid looks clean without it.",
      "CRITICAL: If you include TradeHistory, do NOT invent TradeRow entries or tx hashes. TradeHistory is auto-populated in the app once the strategy is deployed. Include the TradeHistory container only.",
      "NEVER wrap output in ```json or ``` — output raw JSON patch lines only",
      "CRITICAL: Use single braces {paramKey} for template variables in FlowBlock labels, NEVER double braces {{ }} or Mustache/Handlebars syntax",
      "CRITICAL: Every spec MUST include at minimum: 1 StrategyHeader, 1 Container with FlowBlocks, and 1 ParameterGroup with inputs",
      'CRITICAL: The FIRST patch line must ALWAYS be: {"op":"add","path":"/root","value":"root"} — set the root element ID first',
    ],
  });
}

/* ── Route ────────────────────────────────────────────────── */

export const generateRoutes = {
  "/api/generate": {
    async POST(req: Request) {
      const authErr = requireAdmin(req);
      if (authErr !== null) return authErr;

      try {
        if (!isAdminRequest(req)) {
          const rl = rateLimit(req, {
            key: "generate",
            limit: 20,
            windowMs: 60_000,
          });
          if (!rl.allowed) {
            return Response.json(
              { error: "Ratelimited" },
              {
                status: 429,
                headers: {
                  "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
                },
              },
            );
          }
        }

        const body: unknown = await req.json();
        if (typeof body !== "object" || body === null) {
          return Response.json({ error: "Bad request" }, { status: 400 });
        }

        const rawPrompt = (body as { prompt?: unknown }).prompt;
        if (typeof rawPrompt !== "string" || rawPrompt.trim() === "") {
          return Response.json({ error: "Bad request: prompt required" }, { status: 400 });
        }
        if (rawPrompt.length > 30_000) {
          return Response.json({ error: "Request too large" }, { status: 413 });
        }
        const prompt = rawPrompt;

        const rawCurrentSpec = (body as { currentSpec?: unknown }).currentSpec;
        const currentSpec =
          typeof rawCurrentSpec === "object" && rawCurrentSpec !== null
            ? (rawCurrentSpec as Record<string, unknown>)
            : null;

        let currentSpecJson = "";
        let hasCurrentSpecRoot = false;
        if (currentSpec !== null) {
          const root = currentSpec.root;
          hasCurrentSpecRoot = typeof root === "string" && root !== "";
          if (hasCurrentSpecRoot) {
            currentSpecJson = JSON.stringify(currentSpec, null, 2);
            if (currentSpecJson.length > 200_000) {
              return Response.json({ error: "Request too large" }, { status: 413 });
            }
          }
        }

        const result = streamText({
          model: anthropic("claude-sonnet-4-5"),
          system: uiSystemPrompt(),
          messages: [
            ...(hasCurrentSpecRoot
              ? [
                  {
                    role: "user" as const,
                    content: `Current UI spec:\n${currentSpecJson}\n\nRefine it based on: ${prompt}`,
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

        const textStream = result.textStream;
        const enc = new TextEncoder();
        let lineBuf = "";

        const processLine = (
          raw: string,
          controller: ReadableStreamDefaultController<Uint8Array>,
        ) => {
          if (raw === "" || raw === "```json" || raw === "```" || raw === "```jsonl") return;
          const fixed = raw.replace(/\{\{\s*(\w+)\s*\}\}/g, "{$1}");
          try {
            JSON.parse(fixed);
            controller.enqueue(enc.encode(fixed + "\n"));
          } catch {
            console.warn("[/api/generate] Skipping malformed spec line:", fixed.slice(0, 100));
          }
        };

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of textStream) {
                lineBuf += chunk;
                let idx = lineBuf.indexOf("\n");
                while (idx !== -1) {
                  processLine(lineBuf.slice(0, idx).trim(), controller);
                  lineBuf = lineBuf.slice(idx + 1);
                  idx = lineBuf.indexOf("\n");
                }
              }
              processLine(lineBuf.trim(), controller);
            } catch (e) {
              console.error("[/api/generate] Stream error:", e);
            }
            controller.close();
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (e) {
        console.error("POST /api/generate error:", e);
        return Response.json({ error: String(e) }, { status: 500 });
      }
    },
  },
};
