import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react";
import { z } from "zod";

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
        exchange: z.enum(["binance", "robinpump"]),
        status: z.enum(["draft", "active", "paused", "error"]).default("draft"),
      }),
      description: "Header showing the strategy name, description, target exchange badge, and status. Always include a description summarizing what the strategy does.",
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
        value: z.string(),
        unit: z.string().optional(),
        trend: z.enum(["up", "down", "neutral"]).optional(),
      }),
      description: "Displays a single metric like price, amount, or percentage",
    },
    MetricRow: {
      props: z.object({}),
      slots: ["default"],
      description: "Horizontal row of MetricCards or interactive inputs",
    },

    /* ── Charts ──────────────────────────────────────────── */
    PriceChart: {
      props: z.object({
        pair: z.string(),
        exchange: z.enum(["binance", "robinpump"]),
        height: z.enum(["sm", "md", "lg"]).default("md"),
      }),
      description:
        "Candlestick / line chart showing price history for a trading pair. Shows demo data in draft mode.",
    },

    /* ── Interactive inputs (user-configurable parameters) ─ */
    NumberInput: {
      props: z.object({
        label: z.string(),
        paramKey: z.string(),
        defaultValue: z.number(),
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        unit: z.string().optional(),
        description: z.string().optional(),
      }),
      description:
        "Numeric input field for a configurable strategy parameter. paramKey is used to store the value in strategy state.",
    },
    SelectInput: {
      props: z.object({
        label: z.string(),
        paramKey: z.string(),
        defaultValue: z.string(),
        options: z.array(z.object({ label: z.string(), value: z.string() })),
        description: z.string().optional(),
      }),
      description:
        "Dropdown select input for choosing from predefined options. paramKey is used to store the value.",
    },
    ToggleInput: {
      props: z.object({
        label: z.string(),
        paramKey: z.string(),
        defaultValue: z.boolean().default(false),
        description: z.string().optional(),
      }),
      description:
        "On/off toggle switch for boolean strategy parameters. paramKey is used to store the value.",
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
