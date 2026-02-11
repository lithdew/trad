# DESIGN.md — Frontend & Design Continuity Guide

> This document captures every design decision, architectural pattern, known issue, and implementation detail needed for continuity when working on trad's frontend. It is the single source of truth for any new instance or developer picking up this work.

---

## 1. Project Identity

**Name:** trad — "Cursor for Trading Bots"  
**Aesthetic:** "Obsidian Gold" — a premium dark trading terminal  
**Tagline:** Non-coders describe strategies in English, AI generates code + a live visual dashboard

---

## 2. Design System: Obsidian Gold

### 2.1 Color Tokens (defined in `src/index.css` via Tailwind v4 `@theme`)

| Token                    | Hex       | Usage                                            |
| ------------------------ | --------- | ------------------------------------------------ |
| `--color-obsidian`       | `#08080a` | Root background, deepest layer                   |
| `--color-surface`        | `#0e0e11` | Sidebar, card backgrounds                        |
| `--color-surface-2`      | `#151518` | Elevated cards, input backgrounds, code block bg |
| `--color-surface-3`      | `#1c1c20` | Highest elevation, active tab, tooltips          |
| `--color-surface-hover`  | `#222226` | Hover states                                     |
| `--color-border`         | `#252529` | Default borders                                  |
| `--color-border-light`   | `#38383e` | Emphasized borders, code block borders           |
| `--color-gold`           | `#e5a00d` | Primary accent — buttons, active states, brand   |
| `--color-gold-bright`    | `#f5c542` | Hover accent, inline code text                   |
| `--color-gold-dim`       | `#8b6914` | Blockquote borders, subtle gold                  |
| `--color-positive`       | `#22c55e` | Emerald — success, active, RobinPump             |
| `--color-negative`       | `#ef4444` | Red — errors, sell, danger                       |
| `--color-text`           | `#eaeaed` | Primary text (bright off-white)                  |
| `--color-text-secondary` | `#9898a3` | Body text, descriptions                          |
| `--color-text-muted`     | `#5b5b66` | Placeholders, metadata, disabled                 |

### 2.2 Typography (Google Fonts, loaded via `<link>` in `index.html`)

| Role    | Font Family        | Weights  | CSS Variable     | Usage                                   |
| ------- | ------------------ | -------- | ---------------- | --------------------------------------- |
| Display | **Syne**           | 700, 800 | `--font-display` | Strategy names, page headings, logo "t" |
| Body    | **Manrope**        | 400–800  | `--font-body`    | All UI text, buttons, labels            |
| Mono    | **JetBrains Mono** | 400–600  | `--font-mono`    | Code blocks, inline code, param inputs  |

### 2.3 Semantic Colors by Context

| Context         | Color          | Tailwind Class                                |
| --------------- | -------------- | --------------------------------------------- |
| Binance badge   | Yellow-500     | `bg-yellow-500/10 text-yellow-500`            |
| RobinPump badge | Emerald-400    | `bg-emerald-500/10 text-emerald-400`          |
| Status: active  | Emerald-400    | `bg-emerald-500/10 text-emerald-400`          |
| Status: paused  | Amber-400      | `bg-amber-500/10 text-amber-400`              |
| Status: draft   | Zinc-400       | `bg-zinc-500/10 text-zinc-400`                |
| Status: error   | Red-400        | `bg-red-500/10 text-red-400`                  |
| WHEN blocks     | Blue-400       | `border-blue-500/20 bg-blue-500/[0.04]`       |
| IF blocks       | Violet-400     | `border-violet-500/20 bg-violet-500/[0.04]`   |
| THEN blocks     | Emerald-400    | `border-emerald-500/20 bg-emerald-500/[0.04]` |
| Thinking UI     | Violet-300/400 | `text-violet-300/70`, `bg-violet-500/15`      |

### 2.4 Animations (defined in `index.css`)

- `animate-fade-in` — fade + slide up 8px, 0.45s
- `animate-slide-left` — slide from left 12px, 0.35s (AI messages)
- `animate-slide-right` — slide from right 12px, 0.35s (user messages)
- `animate-slide-up` — slide up 12px, 0.4s (toasts)
- `.stagger-1` through `.stagger-6` — `animation-delay` 0.06s–0.36s
- `pulse-gold` — gold box-shadow pulse for active indicators

### 2.5 Special Effects

- **Noise texture:** SVG fractalNoise overlay on `body::before`, `opacity: 0.025`, `z-index: 9999`
- **Dot grid:** `radial-gradient` 24px grid on preview panel backgrounds
- **Glass:** `backdrop-filter: blur(16px)` with semi-transparent bg
- **Gold gradient text:** `.text-gold-gradient` — linear gradient on text via `background-clip`

---

## 3. Dark Mode Configuration

**Critical setup:** `<html class="dark">` in `index.html` + `@variant dark (&:is(.dark *))` in `index.css`.

This is required because:

- Streamdown's code block component uses `dark:` Tailwind variants internally (e.g., `dark:text-[var(--shiki-dark,...)]`, `dark:bg-[var(--shiki-dark-bg,...)]`)
- Tailwind v4 defaults to `prefers-color-scheme` for the `dark:` variant
- Our app is always dark, so we force it with the class-based approach
- Without this, shiki syntax highlighting falls back to light theme colors (near-black on dark background = invisible)

The `--shiki-dark-bg` CSS variable is set to `var(--color-surface-2)` on `[data-streamdown="code-block"]` so code blocks match our surface colors.

---

## 4. Third-Party Library Integration

### 4.1 Streamdown (markdown rendering)

**Package:** `streamdown` v2.2.0 + `@streamdown/code` v1.0.2  
**Purpose:** Renders AI chat messages as rich markdown with streaming animation  
**Theme:** `github-dark-high-contrast` shiki theme (both slots in the tuple)

**Configuration in StrategyBuilder:**

```tsx
import { createCodePlugin } from "@streamdown/code";

// IMPORTANT: Must use createCodePlugin() with explicit themes.
// The default `code` export uses ["github-light","github-dark"] and
// plugin.getThemes() takes precedence over the shikiTheme prop.
const sdCodePlugin = createCodePlugin({
  themes: ["github-dark-high-contrast", "github-dark-high-contrast"],
});
const sdPlugins = { code: sdCodePlugin };

<Streamdown
  plugins={sdPlugins}
  animated={{ animation: "blurIn", duration: 200, easing: "ease-out" }}
  isAnimating={!!msg.isStreaming}
>
  {msg.content}
</Streamdown>;
```

**CSS setup required:**

- `@source "../node_modules/streamdown/dist/*.js"` in CSS for Tailwind to scan Streamdown classes
- `import "streamdown/styles.css"` for animation keyframes
- Custom dark theme overrides via `[data-streamdown="..."]` selectors in `index.css`

**Resolved issue — code block colors:** Fixed by using `createCodePlugin` with explicit themes (the default export ignores the `shikiTheme` prop) AND a CSS `!important` override to beat shiki's inline `color` style. See section 7.1 for full root cause analysis.

**Animation:** Uses `blurIn` animation (blur-to-sharp + opacity) instead of `fadeIn`. This masks batch token arrivals better with fast-streaming models. Duration is 200ms with `ease-out` easing for natural deceleration.

**Thinking blocks:** Streamdown in thinking blocks (both live `ThinkingBubble` and collapsed thinking chips) does NOT receive `plugins={sdPlugins}`. This prevents code blocks and other UI blocks from rendering inside thinking content, keeping it as simple formatted text. Only assistant chat messages get the full code plugin for rich rendering.

### 4.2 json-render (AI-generated UI)

**Packages:** `@json-render/core` v0.5.2, `@json-render/react` v0.5.2  
**Purpose:** Defines a component catalog, AI generates JSON specs, React renders them

**Architecture:**

1. `src/lib/catalog.ts` — Zod-schema catalog defining all components the AI can use
2. `src/lib/registry.tsx` — React implementation of each catalog component
3. Server: `catalog.prompt()` auto-generates the system prompt for Haiku
4. Client: `useUIStream({ api: "/api/generate" })` streams JSON patches into a `Spec`
5. `<Renderer spec={spec} registry={registry} loading={isUIStreaming} />` renders it

**Spec format:** Flat element tree with `root` key and `elements` map:

```json
{
  "root": "main",
  "elements": {
    "main": { "type": "Container", "props": { "layout": "grid", "columns": "2" }, "children": ["header", "chart", ...] },
    "header": { "type": "StrategyHeader", "props": { "name": "...", "exchange": "binance" } }
  }
}
```

**SpecStream protocol:** Each line is a JSON patch: `{"op":"add","path":"/elements/header","value":{...}}`  
The `useUIStream` hook applies patches progressively to build the spec.

**State/data binding:** `StateProvider` wraps the renderer with `initialState={strategyParams}`. The `strategyParams` object is built from `@param` defaults parsed from the generated code. json-render supports `$path` references in props for dynamic values, and the `useStateBinding` hook for two-way binding. Currently, parameter input components use local `useState` rather than state binding — this could be improved.

### 4.3 Vercel AI SDK v6

**Packages:** `ai` v6.0.78, `@ai-sdk/anthropic` v3.0.41, `@ai-sdk/react` v3.0.81  
**Two models:**

- **Claude Sonnet 4.5** (`claude-sonnet-4-5`) — strategy code gen + chat, with extended thinking (`budgetTokens: 10000`)
- **Claude Haiku 4.5** (`claude-haiku-4-5`) — UI spec generation (fast, cheap)

**Chat endpoint (`/api/chat`):** Uses `streamText().toUIMessageStreamResponse({ sendReasoning: true })` — the standard UIMessageStream data stream protocol (SSE with structured message parts: `text-start`, `text-delta`, `text-end`, `reasoning-start`, `reasoning-delta`, `reasoning-end`, `start`, `finish`, etc.). The server receives `UIMessage[]` from the client, converts them via `convertToModelMessages()`, and streams structured responses back.

**Frontend chat:** Uses `useChat` hook from `@ai-sdk/react` with `DefaultChatTransport` from `ai`. Messages are `UIMessage` objects with `parts` arrays containing `text` and `reasoning` part types. The hook manages message state, streaming status (`submitted` | `streaming` | `ready` | `error`), and automatic message updates.

**UI endpoint (`/api/generate`):** Standard `streamText.toTextStreamResponse()` — outputs raw SpecStream lines. This uses a text stream because it's consumed by `@json-render/react`'s `useUIStream` hook which expects plain text JSON patch lines.

---

## 5. Component Catalog (json-render)

### 5.1 Layout Components

| Component        | Key Props                                                                                          | Grid Behavior                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `Container`      | `layout: "flex"\|"grid"`, `columns: "1"\|"2"\|"3"\|"auto"`, `gap`, `padding`, `direction`, `align` | Root should be `layout="grid" columns="2"` for bento |
| `StrategyHeader` | `name`, `exchange`, `status`                                                                       | `gridColumn: "1 / -1"` (spans full width)            |
| `Heading`        | `text`, `level`                                                                                    | `gridColumn: "1 / -1"`                               |
| `Divider`        | —                                                                                                  | `gridColumn: "1 / -1"`                               |
| `InfoBox`        | `title`, `content`, `variant`                                                                      | `gridColumn: "1 / -1"`                               |

### 5.2 Strategy Flow Components

| Component   | Key Props                                                                                                                                                     | Notes                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `FlowBlock` | `tag: "WHEN"\|"IF"\|"THEN"\|...`, `label`, `color: "blue"\|"violet"\|"emerald"\|"amber"\|"red"`, `icon: "clock"\|"chart"\|"bolt"\|"coins"\|"alert"\|"repeat"` | Color-coded by step type         |
| `Connector` | `style: "solid"\|"dashed"\|"arrow"`                                                                                                                           | Vertical line between FlowBlocks |

### 5.3 Data Display

| Component    | Key Props                                                    | Notes                               |
| ------------ | ------------------------------------------------------------ | ----------------------------------- |
| `MetricCard` | `label`, `value`, `unit?`, `trend?: "up"\|"down"\|"neutral"` | Inside MetricRow                    |
| `MetricRow`  | — (slot)                                                     | Renders as `grid grid-cols-2 gap-2` |
| `PriceChart` | `pair`, `exchange`, `height: "sm"\|"md"\|"lg"`               | SVG candlestick with demo data      |
| `Badge`      | `label`, `color`                                             | Colored pill                        |
| `Text`       | `content`, `variant: "body"\|"caption"\|"code"\|"mono"`      | —                                   |

### 5.4 Interactive Parameter Components

| Component        | Key Props                                                                             | Notes                         |
| ---------------- | ------------------------------------------------------------------------------------- | ----------------------------- |
| `NumberInput`    | `label`, `paramKey`, `defaultValue`, `min?`, `max?`, `step?`, `unit?`, `description?` | For numeric strategy params   |
| `SelectInput`    | `label`, `paramKey`, `defaultValue`, `options: [{label,value}]`, `description?`       | Dropdown                      |
| `ToggleInput`    | `label`, `paramKey`, `defaultValue`, `description?`                                   | Boolean toggle switch         |
| `ParameterGroup` | `title`, `description?` (slot)                                                        | Groups inputs under a section |

### 5.5 Container Grid Layout (Important)

The `Container` component uses **inline CSS styles** (not Tailwind classes) for grid/flex layout. This was a deliberate decision because Tailwind v4's class scanning can't pick up dynamically-constructed class names like `md:grid-cols-2` from runtime props. Using `style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}` guarantees the layout works.

Components that should **span the full grid width** use `style={{ gridColumn: "1 / -1" }}`:

- `StrategyHeader`, `Heading`, `Divider`, `InfoBox`

---

## 6. Page Architecture

### 6.1 Routing

Client-side routing via `App.tsx` using `window.history.pushState` + `popstate`. No router library.

| Path            | Component         | Page                 |
| --------------- | ----------------- | -------------------- |
| `/`             | `Dashboard`       | Strategy grid, stats |
| `/strategy`     | `StrategyBuilder` | New strategy         |
| `/strategy/:id` | `StrategyBuilder` | Edit existing        |
| `/settings`     | `Settings`        | Exchange secrets     |

Server routes in `index.ts` mirror these for SPA fallback: `"/": index, "/dashboard": index, "/settings": index, "/strategy": index, "/strategy/:slug": index`.

### 6.2 Layout

`Layout.tsx` — 60px narrow sidebar (icon-based, Cursor/VS Code style) + main content.

Sidebar items:

- **Logo** ("t" in gold gradient square) → navigates to `/`
- **Dashboard** (4-square grid icon) → `/`
- **New Strategy** (+ icon) → `/strategy`
- **Settings** (gear icon, pinned to bottom) → `/settings`

Active state: gold background tint + gold left bar indicator + gold icon color.
Hover: tooltip appears to the right.

### 6.3 Strategy Builder (the core page)

Split view:

- **Left (420px):** Chat panel — messages, thinking display, input
- **Right (flex-1):** Preview panel — Visual | Code | Spec tabs

**Chat flow (using UIMessageStream + `useChat`):**

1. User types → `sendMessage({ text }, { body: { currentCode } })` via `useChat` hook
2. `DefaultChatTransport` sends `UIMessage[]` + body to `POST /api/chat`
3. Server converts with `convertToModelMessages()`, calls `streamText()`, returns `toUIMessageStreamResponse({ sendReasoning: true })`
4. `useChat` automatically manages message state via UIMessageStream protocol
5. Reasoning parts (type `reasoning`, state `streaming`) → shown as live `LiveReasoningBubble` (auto-scrolling, violet themed)
6. When reasoning completes → collapses to toggleable `CollapsedReasoning` chip
7. Text parts (type `text`, state `streaming`) → rendered progressively via Streamdown with `isAnimating={true}`
8. When stream finishes → `onFinish` callback fires with the completed `UIMessage`
9. Code extracted from text parts via regex (`/```typescript\n([\s\S]*?)```/`)
10. `@param` comments parsed → `strategyParams` state built → passed to `StateProvider`
11. Auto-trigger `POST /api/generate` with strategy summary → Haiku generates UI spec
12. `useUIStream` streams patches → `Renderer` renders bento grid

**Three tabs:**

- **Visual** — `<Renderer>` with json-render (the bento dashboard)
- **Code** — Strategy TypeScript code rendered via Streamdown
- **Spec** — Raw JSON spec rendered via Streamdown

---

## 7. Known Issues & Polish Needed

### 7.1 Code Block Colors (RESOLVED)

**Root cause (two compounding bugs):**

1. **Wrong themes used.** Streamdown's context prefers `plugins.code.getThemes()` over the `shikiTheme` prop. The default `code` export from `@streamdown/code` calls `createCodePlugin()` with no args, so `getThemes()` returns `["github-light", "github-dark"]` — ignoring the `sdTheme` prop entirely.

2. **Inline `color` overrides Tailwind dark: variant.** Shiki v3's `flatTokenVariants()` (in `@shikijs/core`) sets `mergedStyles["color"] = value` for the default theme's color key (`idx === 0` when `defaultColor` is truthy). This ends up in `token.htmlStyle`, which Streamdown spreads into the element's inline `style`. Inline styles always beat Tailwind class-based rules — so the light theme's `color: #24292e` overrides `dark:text-[var(--shiki-dark,...)]`.

**Fix applied:**

- Use `createCodePlugin({ themes: ["github-dark-high-contrast", "github-dark-high-contrast"] })` so `getThemes()` returns correct themes
- CSS override `[data-streamdown="code-block-body"] code > span > span { color: var(--shiki-dark, var(--sdm-c, inherit)) !important; }` to reclaim control from inline styles

### 7.2 Template Variables in FlowBlock Labels

The Haiku UI generation sometimes uses template syntax like `{{ interval }}` or `{{ buyAmount }}` in FlowBlock labels and MetricCard values instead of hardcoding defaults. The system prompt has rules against this, but LLMs occasionally ignore rules. More aggressive prompting or post-processing (regex-replace template vars with param defaults) would fix this.

### 7.3 Bento Grid Spacing & Responsiveness (SPACING RESOLVED)

**Spacing root cause:** Compound padding from three layers: preview wrapper (`px-5 py-6` = 20px/24px), Container default gap (`md` = 12px), and ParameterGroup padding (`p-4` = 16px) all stacking.

**Spacing fix applied:** Tightened all spacing layers:

- Preview wrapper: `px-5 py-6` → `px-3 py-3` (12px all around)
- Container grid gap: `sm=6, md=8, lg=12` (was 8/12/16)
- Container padding: `sm=6, md=10, lg=16` (was 8/16/24)
- ParameterGroup: `p-3 gap-2` (was `p-4 gap-3`)
- FlowBlock: `p-3 gap-2.5` (was `p-4 gap-3`)
- MetricCard: `p-2.5 mb-0.5` (was `p-3 mb-1`)
- MetricRow: `gap-1.5` (was `gap-2`)
- Connector: `h-4` no vertical padding (was `h-5 py-0.5`)

**Responsiveness still needed:** The grid uses `repeat(2, minmax(0, 1fr))` via inline styles. This gives a 2-column layout on all screen sizes. On mobile, the grid should become 1 column — adding `@media (max-width: 768px)` to force single column or using a ResizeObserver would fix this.

### 7.4 Parameter State Binding

Interactive inputs (NumberInput, SelectInput, ToggleInput) use local `useState` rather than json-render's `useStateBinding`. This means:

- Changing a param in the UI updates local component state
- But it doesn't flow back to `strategyParams` via the `updateParam` action (the action is logged but not wired to re-render other components)
- To fully close the loop: use json-render's `useStateBinding("/paramKey")` in each input, and have the spec reference state paths in FlowBlock labels

### 7.5 Chat Scroll

The chat auto-scrolls on new messages and thinking updates via `ref.scrollIntoView({ behavior: "smooth" })`. This works well but can fight with the user if they've manually scrolled up. A "scroll to bottom" button (like Cursor's) would improve UX.

### 7.6 Strategy Persistence

Currently the strategy code, parameters, and chat history are generated and held in React state but NOT automatically saved to Prisma. The "Save Draft" button is not wired up. Wiring it to `POST /api/strategies` or `PUT /api/strategies/:id` with the current state would persist strategies.

---

## 8. File Reference

| File                            | Purpose                                                   |
| ------------------------------- | --------------------------------------------------------- |
| `src/index.html`                | HTML shell. Has `class="dark"`, Google Fonts, SVG favicon |
| `src/index.css`                 | Tailwind v4 theme, animations, Streamdown dark overrides  |
| `src/frontend.tsx`              | React mount point                                         |
| `src/App.tsx`                   | Client-side router + page switching                       |
| `src/components/Layout.tsx`     | Sidebar + main content shell                              |
| `src/pages/Dashboard.tsx`       | Strategy grid, stats, create CTA                          |
| `src/pages/StrategyBuilder.tsx` | The core page — chat + preview                            |
| `src/pages/Settings.tsx`        | Exchange secret management (Binance, RobinPump)           |
| `src/lib/catalog.ts`            | json-render component catalog (Zod schemas)               |
| `src/lib/registry.tsx`          | React implementations for catalog components              |
| `src/lib/runtime.ts`            | Strategy execution runtime (eval-based)                   |
| `src/index.ts`                  | Bun.serve() — API routes + SPA serving                    |
| `src/db.ts`                     | Prisma client (libsql adapter)                            |
| `prisma/schema.prisma`          | Database schema (ExchangeSecret, Strategy)                |

---

## 9. Dependencies

| Package               | Version | Role                                        |
| --------------------- | ------- | ------------------------------------------- |
| `react` / `react-dom` | 19      | UI framework                                |
| `tailwindcss`         | 4.1     | Utility CSS (v4 with `@theme`)              |
| `bun-plugin-tailwind` | 0.1.2   | Tailwind integration for Bun                |
| `streamdown`          | 2.2.0   | Streaming markdown renderer                 |
| `@streamdown/code`    | 1.0.2   | Shiki syntax highlighting plugin            |
| `@json-render/core`   | 0.5.2   | Component catalog + spec system             |
| `@json-render/react`  | 0.5.2   | React renderer + hooks                      |
| `ai`                  | 6.0.78  | Vercel AI SDK (streamText, UIMessageStream) |
| `@ai-sdk/anthropic`   | 3.0.41  | Claude provider                             |
| `@ai-sdk/react`       | 3.0.81  | React hooks (useChat) for AI SDK UI         |
| `@prisma/client`      | 7.3.0   | Database ORM                                |
| `viem`                | 2.45.3  | Ethereum/Base chain interaction             |
| `zod`                 | 4.x     | Schema validation (required by json-render) |

---

## 10. AI Prompt Architecture

### 10.1 Strategy Code Generation (Sonnet 4.5)

System prompt in `STRATEGY_SYSTEM` constant. Key rules:

- Output is a chat reply + fenced TypeScript code block
- Code must have comment header: `// Strategy: {name}`, `// Exchange: {exchange}`, `// Description: {desc}`
- Every configurable value gets a `// @param {name} {type} {default} {description}` comment
- Code uses `PARAMS.{name}` to read parameters
- Must call `api.scheduleNext()` at the end
- Available API documented in the prompt

### 10.2 UI Generation (Haiku 4.5)

System prompt generated by `catalog.prompt()` + custom `system` and `customRules` overrides. Key rules:

- Output raw SpecStream (JSON patch lines, no markdown fences)
- Root Container must be `layout="grid" columns="2"` for bento layout
- Must include interactive inputs for every `@param`
- Must hardcode actual default values in labels (no template vars)
- Color coding: blue=timing, violet=analysis, emerald=buying, amber=alerts, red=selling

### 10.3 Strategy Metadata Parsing

After Sonnet generates code, the frontend extracts:

1. **Code:** regex `/ ```typescript\n([\s\S]*?)``` /`
2. **Name:** `// Strategy: (.+)`
3. **Exchange:** `// Exchange: (.+)`
4. **Description:** `// Description: (.+)`
5. **Params:** `// @param (\S+) (\S+) (\S+) (.+)` → `{ key, type, defaultVal, desc }`
6. **State object:** Built from params — numbers parsed to float, booleans parsed, strings kept as-is

This metadata is used to:

- Set `strategyParams` (passed to `StateProvider`)
- Construct the prompt for Haiku UI generation
- Display in the Code tab

---

## 11. Styling Patterns

### Component patterns used consistently:

```
/* Card-like container */
bg-surface/80 border border-border rounded-xl p-4

/* Subtle tinted background for status */
bg-emerald-500/10 text-emerald-400

/* Label text */
text-[10px] font-bold text-text-muted uppercase tracking-[0.08em]

/* Interactive focus ring */
focus:outline-none focus:border-gold/30 transition-colors

/* Gold CTA button */
bg-gold text-obsidian font-bold rounded-xl hover:bg-gold-bright hover:shadow-[0_0_16px_rgba(229,160,13,0.18)]

/* Muted secondary button */
border border-border text-text-secondary hover:text-text hover:border-border-light

/* Active sidebar indicator */
bg-gold/[0.12] text-gold + absolute left bar w-[3px] bg-gold rounded-r-full
```

### Icons

All icons are inline SVGs (no icon library). They use `stroke="currentColor"` with `strokeWidth="1.5"` and `strokeLinecap="round"`. The icon catalog in FlowBlock maps names to SVG elements: `clock`, `chart`, `bolt`, `coins`, `alert`, `repeat`.
