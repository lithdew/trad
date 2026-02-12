import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react";
import { z } from "zod";

const paramKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "paramKey must be a simple identifier");

/**
 * Strategy UI catalog — defines every component the AI can use
 * to visualize a trading strategy. This is the guardrail:
 * Claude can ONLY use these components with these exact props.
 */
export const catalog = defineCatalog(schema, {
  components: {
    /* ── Layout ──────────────────────────────────────────── */
    Container: {
      props: z.object({
        direction: z.enum(["vertical", "horizontal"]).default("vertical"),
        layout: z.enum(["flex", "grid"]).default("flex"),
        gap: z.enum(["none", "sm", "md", "lg"]).default("md"),
        padding: z.enum(["none", "sm", "md", "lg"]).default("none"),
        align: z.enum(["start", "center", "end", "stretch"]).default("stretch"),
        columns: z.enum(["1", "2", "3", "auto"]).default("auto"),
      }),
      slots: ["default"],
      description:
        "Layout container. Use layout='grid' with columns for bento-grid dashboard layouts. Use layout='flex' for linear flows.",
    },

    /* ── Strategy identity ───────────────────────────────── */
    StrategyHeader: {
      props: z.object({
        name: z.string(),
        description: z.string().optional(),
        exchange: z.enum(["robinpump"]),
        status: z.enum(["draft", "active", "paused", "error"]).default("draft"),
      }),
      description:
        "Header showing the strategy name, description, target exchange badge, and status. Always include a description summarizing what the strategy does.",
    },

    /* ── Flow blocks (WHEN → IF → THEN) ─────────────────── */
    FlowBlock: {
      props: z.object({
        tag: z.enum(["WHEN", "IF", "THEN", "AND", "OR", "ELSE"]),
        label: z.string(),
        color: z.enum(["blue", "violet", "emerald", "amber", "red"]),
        icon: z.enum(["clock", "chart", "bolt", "coins", "alert", "repeat"]).default("bolt"),
      }),
      description:
        "A single step in the strategy flow. Use tag to indicate the step type: WHEN for triggers, IF for conditions, THEN for actions.",
    },
    Connector: {
      props: z.object({
        style: z.enum(["solid", "dashed", "arrow"]).default("solid"),
      }),
      description: "Visual connector line between flow blocks",
    },

    /* ── Data display ────────────────────────────────────── */
    MetricCard: {
      props: z.object({
        label: z.string(),
        value: z.union([z.string(), z.object({ path: z.string() })]),
        unit: z.string().optional(),
        trend: z.enum(["up", "down", "neutral"]).optional(),
      }),
      description: "Displays a single metric like price, amount, or percentage",
    },
    MetricRow: {
      props: z.object({}),
      slots: ["default"],
      description:
        "Full-width row of MetricCards displayed in a single 4-column row directly below the chart. Place exactly 4 MetricCards inside.",
    },

    /* ── Charts ──────────────────────────────────────────── */
    PriceChart: {
      props: z.object({
        pair: z.string().optional(),
        exchange: z.enum(["robinpump"]),
        height: z.enum(["sm", "md", "lg"]).default("md"),
      }),
      description:
        "Interactive line chart showing real price history for a trading pair. Only include when the strategy targets a KNOWN, specific pair address. Omit for strategies that dynamically discover coins (sniping, scanning). When pair is omitted or has no trades yet, displays a market-readiness status panel instead.",
    },

    /* ── Interactive inputs (user-configurable parameters) ─ */
    NumberInput: {
      props: z
        .object({
          label: z.string(),
          paramKey: paramKeySchema,
          defaultValue: z.number(),
          min: z.number().optional(),
          max: z.number().optional(),
          step: z.number().optional(),
          unit: z.string().optional(),
          description: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (!Number.isFinite(v.defaultValue)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be a finite number",
              path: ["defaultValue"],
            });
          }
          if (v.min !== undefined && !Number.isFinite(v.min)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be finite",
              path: ["min"],
            });
          }
          if (v.max !== undefined && !Number.isFinite(v.max)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "max must be finite",
              path: ["max"],
            });
          }
          if (v.step !== undefined && (!Number.isFinite(v.step) || v.step <= 0)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "step must be > 0",
              path: ["step"],
            });
          }
          if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be <= max",
              path: ["min"],
            });
          }
          if (v.min !== undefined && v.defaultValue < v.min) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be >= min",
              path: ["defaultValue"],
            });
          }
          if (v.max !== undefined && v.defaultValue > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be <= max",
              path: ["defaultValue"],
            });
          }
        }),
      description:
        "Numeric input field for a configurable strategy parameter. paramKey is used to store the value in strategy state.",
    },
    TextInput: {
      props: z.object({
        label: z.string(),
        paramKey: paramKeySchema,
        defaultValue: z.string().default(""),
        placeholder: z.string().optional(),
        unit: z.string().optional(),
        description: z.string().optional(),
      }),
      description:
        "Free-form text input for string parameters like pair addresses, token names, or wallet addresses. paramKey is used to store the value in strategy state.",
    },
    SelectInput: {
      props: z
        .object({
          label: z.string(),
          paramKey: paramKeySchema,
          defaultValue: z.string(),
          options: z.array(z.object({ label: z.string(), value: z.string() })).min(1),
          description: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          let ok = false;
          for (const opt of v.options) {
            if (opt.value === v.defaultValue) {
              ok = true;
              break;
            }
          }
          if (!ok) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be one of options[].value",
              path: ["defaultValue"],
            });
          }
        }),
      description:
        "Dropdown select input for choosing from predefined options. paramKey is used to store the value.",
    },
    ToggleInput: {
      props: z.object({
        label: z.string(),
        paramKey: paramKeySchema,
        defaultValue: z.boolean().default(false),
        description: z.string().optional(),
      }),
      description:
        "On/off toggle switch for boolean strategy parameters. paramKey is used to store the value.",
    },

    /* ── Safer specialized parameter inputs ───────────────── */
    EthInput: {
      props: z
        .object({
          label: z.string(),
          paramKey: paramKeySchema,
          defaultValue: z.number(),
          min: z.number().optional(),
          max: z.number().optional(),
          step: z.number().optional(),
          description: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (!Number.isFinite(v.defaultValue)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be a finite number",
              path: ["defaultValue"],
            });
          }
          if (v.min !== undefined && !Number.isFinite(v.min)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be finite",
              path: ["min"],
            });
          }
          if (v.max !== undefined && !Number.isFinite(v.max)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "max must be finite",
              path: ["max"],
            });
          }
          if (v.step !== undefined && (!Number.isFinite(v.step) || v.step <= 0)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "step must be > 0",
              path: ["step"],
            });
          }
          if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be <= max",
              path: ["min"],
            });
          }
        }),
      description:
        "ETH amount input (NumberInput with unit fixed to ETH). Use for trade sizing like buyAmount/tradeAmount.",
    },
    UsdInput: {
      props: z
        .object({
          label: z.string(),
          paramKey: paramKeySchema,
          defaultValue: z.number(),
          min: z.number().optional(),
          max: z.number().optional(),
          step: z.number().optional(),
          description: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (!Number.isFinite(v.defaultValue)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be a finite number",
              path: ["defaultValue"],
            });
          }
          if (v.min !== undefined && !Number.isFinite(v.min)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be finite",
              path: ["min"],
            });
          }
          if (v.max !== undefined && !Number.isFinite(v.max)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "max must be finite",
              path: ["max"],
            });
          }
          if (v.step !== undefined && (!Number.isFinite(v.step) || v.step <= 0)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "step must be > 0",
              path: ["step"],
            });
          }
          if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be <= max",
              path: ["min"],
            });
          }
        }),
      description:
        "USD amount input (NumberInput with unit fixed to USD). Use for market cap thresholds and USD-denominated limits.",
    },
    BpsInput: {
      props: z
        .object({
          label: z.string(),
          paramKey: paramKeySchema,
          defaultValue: z.number().int().min(0).max(5000),
          min: z.number().int().min(0).max(5000).optional().default(0),
          max: z.number().int().min(0).max(5000).optional().default(5000),
          step: z.number().int().min(1).max(500).optional().default(25),
          description: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (v.min > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be <= max",
              path: ["min"],
            });
          }
          if (v.defaultValue < v.min || v.defaultValue > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be within [min,max]",
              path: ["defaultValue"],
            });
          }
        }),
      description:
        "Basis points input (0-5000). Use for slippage, spreads, fee thresholds, etc. 100 bps = 1%.",
    },
    PercentInput: {
      props: z
        .object({
          label: z.string(),
          paramKey: paramKeySchema,
          defaultValue: z.number().min(0).max(100),
          min: z.number().min(0).max(100).optional().default(0),
          max: z.number().min(0).max(100).optional().default(100),
          step: z.number().min(0.01).max(100).optional().default(1),
          description: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (v.min > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be <= max",
              path: ["min"],
            });
          }
          if (v.defaultValue < v.min || v.defaultValue > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be within [min,max]",
              path: ["defaultValue"],
            });
          }
        }),
      description:
        "Percent input (0-100). Use for allocations, take-profit percentages, stop-loss percentages, etc.",
    },
    IntegerInput: {
      props: z
        .object({
          label: z.string(),
          paramKey: paramKeySchema,
          defaultValue: z.number().int(),
          min: z.number().int().optional(),
          max: z.number().int().optional(),
          step: z.number().int().min(1).optional().default(1),
          unit: z.string().optional(),
          description: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (v.min !== undefined && v.max !== undefined && v.min > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "min must be <= max",
              path: ["min"],
            });
          }
          if (v.min !== undefined && v.defaultValue < v.min) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be >= min",
              path: ["defaultValue"],
            });
          }
          if (v.max !== undefined && v.defaultValue > v.max) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "defaultValue must be <= max",
              path: ["defaultValue"],
            });
          }
        }),
      description:
        "Integer input. Use for counts, limits, sample sizes, and other whole-number knobs.",
    },
    AddressInput: {
      props: z.object({
        label: z.string(),
        paramKey: paramKeySchema,
        defaultValue: z.union([z.string().regex(/^0x[a-fA-F0-9]{40}$/), z.literal("")]).default(""),
        placeholder: z.string().optional(),
        description: z.string().optional(),
        allowEmpty: z.boolean().optional().default(true),
      }),
      description:
        "EVM address input. Use for Base pair/token addresses. Prefer leaving blank only when the strategy can auto-discover.",
    },
    IntervalInput: {
      props: z.object({
        label: z.string(),
        paramKey: paramKeySchema,
        defaultValue: z.string().regex(/^(?:\d+(?:s|m|h|d)|once)$/),
        description: z.string().optional(),
      }),
      description:
        "Schedule interval input. Allowed formats: 30s, 5m, 1h, 1d, or once. Use for strategy cadence.",
    },
    ParameterGroup: {
      props: z.object({
        title: z.string(),
        description: z.string().optional(),
      }),
      slots: ["default"],
      description:
        "Groups related parameters under a section heading. Contains NumberInput, SelectInput, or ToggleInput children.",
    },

    /* ── Text & typography ───────────────────────────────── */
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(["h1", "h2", "h3"]).default("h2"),
      }),
      description: "Heading text",
    },
    Text: {
      props: z.object({
        content: z.string(),
        variant: z.enum(["body", "caption", "code", "mono"]).default("body"),
      }),
      description: "Text paragraph or inline content",
    },

    /* ── Status & badges ─────────────────────────────────── */
    Badge: {
      props: z.object({
        label: z.string(),
        color: z.enum(["green", "amber", "red", "blue", "violet", "zinc"]).default("zinc"),
      }),
      description: "Small colored badge/pill for status or tags",
    },

    /* ── Informational ───────────────────────────────────── */
    InfoBox: {
      props: z.object({
        title: z.string().optional(),
        content: z.string(),
        variant: z.enum(["info", "warning", "success", "error"]).default("info"),
      }),
      description: "Informational callout box for tips, warnings, or status messages",
    },

    /* ── Divider ─────────────────────────────────────────── */
    Divider: {
      props: z.object({}),
      description: "Horizontal line separator",
    },

    /* ── Trade history ───────────────────────────────────── */
    TradeHistory: {
      props: z.object({
        maxItems: z.number().default(5),
      }),
      slots: ["default"],
      description:
        "Recent strategy trade log container. In the app this auto-populates from real strategy trades when deployed (so you typically do NOT need to add TradeRow children).",
    },
    TradeRow: {
      props: z.object({
        side: z.enum(["buy", "sell"]),
        amount: z.string(),
        pair: z.string(),
        time: z.string(),
        hash: z.string().optional(),
      }),
      description:
        "Single trade entry row. Color-coded: emerald for buy, red for sell. If hash is provided, it should be the FULL 0x-prefixed transaction hash (the UI will truncate it); never pre-truncate with '...'.",
    },

    /* ── Progress & gauges ───────────────────────────────── */
    ProgressBar: {
      props: z.object({
        label: z.string(),
        value: z.number(),
        color: z.enum(["emerald", "blue", "amber", "red", "violet"]),
        unit: z.string().optional(),
      }),
      description:
        "Horizontal progress/gauge bar (0-100). Use for allocation percentages, progress toward goals, risk exposure, or any bounded numeric metric.",
    },

    /* ── Status ──────────────────────────────────────────── */
    StatusIndicator: {
      props: z.object({
        label: z.string(),
        status: z.enum(["active", "paused", "waiting", "error", "success"]),
        description: z.string().optional(),
      }),
      description:
        "Colored dot + label showing current strategy state. Animated pulse for active/waiting states. ALWAYS include to show current strategy status.",
    },

    /* ── Coin display ────────────────────────────────────── */
    CoinCard: {
      props: z.object({
        symbol: z.string(),
        name: z.string(),
        pairAddress: z.string().optional(),
        priceEth: z.string().optional(),
        priceUsd: z.string().optional(),
        imageUrl: z.string().optional(),
      }),
      description:
        "Compact coin display card with avatar, name, ticker, and price. Use when the strategy targets a specific known coin to show its details. Handles IPFS image URIs. Place inside CoinList.",
    },
    CoinList: {
      props: z.object({
        title: z.string().optional(),
        layout: z.enum(["grid", "list"]).default("list"),
      }),
      slots: ["default"],
      description:
        "Grid or list container for CoinCard children. Use to display coins the strategy is tracking or targeting.",
    },

    /* ── Alerts ──────────────────────────────────────────── */
    AlertBanner: {
      props: z.object({
        message: z.string(),
        variant: z.enum(["info", "warning", "success", "error"]),
        dismissible: z.boolean().optional(),
      }),
      description:
        "Prominent banner for important messages at the top of the dashboard. Use for critical alerts, risk warnings, or success confirmations.",
    },

    /* ── Schedule ────────────────────────────────────────── */
    ScheduleDisplay: {
      props: z.object({
        interval: z.string(),
        nextRun: z.string().optional(),
        lastRun: z.string().optional(),
        runCount: z.number().optional(),
      }),
      description:
        "Shows strategy timing: interval, next run, last run, and total run count. ALWAYS include to show the strategy's timing and execution schedule.",
    },

    /* ── Hero stats ──────────────────────────────────────── */
    Stat: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        description: z.string().optional(),
        icon: z.enum(["wallet", "chart", "bolt", "clock", "coins", "trending"]).optional(),
        color: z.enum(["emerald", "blue", "amber", "red", "violet", "gold"]).optional(),
      }),
      description:
        "Large, prominent single statistic with icon and optional description. Use for hero stats at the top of a dashboard instead of MetricCard when emphasis is needed.",
    },
    StatRow: {
      props: z.object({}),
      slots: ["default"],
      description:
        "Full-width row for Stat children with auto grid layout. Place 2-4 Stat components inside for a prominent stats bar.",
    },
  },

  actions: {
    deploy: {
      params: z.object({ strategyId: z.string().optional() }),
      description: "Deploy the current strategy to start live trading",
    },
    pause: {
      params: z.object({ strategyId: z.string().optional() }),
      description: "Pause a running strategy",
    },
    updateParam: {
      params: z.object({
        key: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
      description: "Update a strategy parameter value when user changes an input",
    },
  },
});

export type Catalog = typeof catalog;
