import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
  useUIStream,
} from "@json-render/react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import "streamdown/styles.css";
import {
  Play,
  Square,
  Trash2,
  ChevronDown,
  Loader2,
  Terminal,
  RotateCw,
  ArrowDown,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "../../App";
import { registry } from "../../lib/registry";
import {
  useStrategy,
  useStrategyLogs,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  deployStrategy,
  stopStrategy,
  queryClient,
  queryKeys,
  type StrategyPayload,
} from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChatBubble } from "./ChatBubble";
import { EmptyPreview } from "./EmptyPreview";
import { StrategyPerformance } from "../../components/StrategyPerformance";

/* ══════════════════════════════════════════════════════════════
   Strategy Builder — dual-model AI:
     Left:  Chat  → Sonnet 4.5 w/ extended thinking (code gen)
     Right: Preview → Haiku 4.5 (visual UI gen via json-render)
   ══════════════════════════════════════════════════════════════ */

const WELCOME_MESSAGES: UIMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: 'Hey! Describe your trading strategy for **RobinPump.fun** in plain English and I\'ll build it for you.\n\nTry something like **"Snipe new coins under $3k market cap"** or **"Market make on a coin to generate volume"**.\n\nI\'ll generate the code, and you\'ll see a live dashboard on the right with knobs you can tweak.\n\nSafety note: the runtime enforces strict risk limits (ETH per trade/run/day + max trades per run), and production defaults to **dry-run** unless live trading is explicitly enabled.',
      },
    ],
  },
];

const TEMPLATES = [
  {
    name: "Volume Bot",
    prompt:
      "Create a volume-generating bot that buys and sells the same coin in small amounts every minute to maximize trading volume",
    icon: "⚡",
  },
  {
    name: "Coin Sniper",
    prompt:
      "Snipe new coins launched on RobinPump under $3k market cap, buy 0.001 ETH worth of each",
    icon: "🎯",
  },
  {
    name: "DCA Bot",
    prompt: "Dollar-cost average into a coin with 0.001 ETH every 5 minutes",
    icon: "📊",
  },
  {
    name: "Market Maker",
    prompt:
      "Market make on a specific coin — buy low, sell high with tight spreads to generate volume",
    icon: "💰",
  },
];

const sdCodePlugin = createCodePlugin({
  themes: ["github-dark-high-contrast", "github-dark-high-contrast"],
});
const sdPlugins = { code: sdCodePlugin };

/* ── Parse helpers ──────────────────────────────────────────── */

function extractCode(text: string): string | null {
  const match = text.match(/```typescript\n([\s\S]*?)```/);
  return match ? match[1]!.trim() : null;
}

function parseStrategyMeta(code: string) {
  const name = code.match(/\/\/ Strategy: (.+)/)?.[1] ?? "Untitled";
  const exchange = code.match(/\/\/ Exchange: (.+)/)?.[1]?.trim() ?? "robinpump";
  const description = code.match(/\/\/ Description: (.+)/)?.[1] ?? "";
  const params: {
    key: string;
    type: string;
    defaultVal: string;
    desc: string;
    options?: string[];
  }[] = [];
  for (const m of code.matchAll(/\/\/ @param (\S+) (\S+) (\S+) (.+)/g)) {
    const key = m[1]!;
    const type = m[2]!;
    const defaultVal = m[3]!;
    const desc = m[4]!;

    let options: string[] | undefined = undefined;
    if (type.startsWith("enum[") && type.endsWith("]")) {
      const inside = type.slice(5, -1);
      const rawOpts = inside.split("|");
      const next: string[] = [];
      for (const opt of rawOpts) {
        const t = opt.trim();
        if (t !== "") next.push(t);
      }
      if (next.length > 0) options = next;
    }

    params.push({ key, type, defaultVal, desc, options });
  }
  return { name, exchange, description, params };
}

function buildParamState(
  params: { key: string; type: string; defaultVal: string; options?: string[] }[],
) {
  const state: Record<string, unknown> = {};
  for (const p of params) {
    const t = p.type;

    if (t === "boolean") {
      state[p.key] = p.defaultVal === "true";
      continue;
    }

    if (t === "int" || t === "bps") {
      const parsed = Number.parseInt(p.defaultVal, 10);
      let n = Number.isFinite(parsed) ? parsed : 0;
      if (t === "bps") {
        if (n < 0) n = 0;
        if (n > 5000) n = 5000;
      }
      state[p.key] = n;
      continue;
    }

    if (t === "number" || t === "eth" || t === "usd" || t === "pct") {
      const parsed = Number.parseFloat(p.defaultVal);
      let n = Number.isFinite(parsed) ? parsed : 0;
      if (t === "pct") {
        if (n < 0) n = 0;
        if (n > 100) n = 100;
      }
      state[p.key] = n;
      continue;
    }

    if (p.options !== undefined && p.options.length > 0) {
      let ok = false;
      for (const opt of p.options) {
        if (opt === p.defaultVal) {
          ok = true;
          break;
        }
      }
      state[p.key] = ok ? p.defaultVal : p.options[0]!;
      continue;
    }

    state[p.key] = p.defaultVal;
  }
  return state;
}

function parseStoredParams(parameters: string | null | undefined) {
  const flat: Record<string, unknown> = {};
  if (parameters === null || parameters === undefined || parameters === "") return flat;
  try {
    const raw = JSON.parse(parameters) as Record<string, unknown>;
    for (const [key, val] of Object.entries(raw)) {
      if (val !== null && typeof val === "object" && "value" in (val as Record<string, unknown>)) {
        flat[key] = (val as Record<string, unknown>).value;
      } else {
        flat[key] = val;
      }
    }
  } catch {
    // ignore
  }
  return flat;
}

function reconcileParamState(code: string, storedParamsJson: string | null | undefined) {
  const meta = parseStrategyMeta(code);
  const defaults = buildParamState(meta.params);
  const stored = parseStoredParams(storedParamsJson);

  // If the code declares no params, preserve whatever is stored.
  if (meta.params.length === 0) return stored;

  // Otherwise: only keep keys declared by `// @param ...`.
  const next: Record<string, unknown> = {};
  for (const p of meta.params) {
    next[p.key] = defaults[p.key];

    const raw = stored[p.key];
    if (raw === undefined || raw === null) continue;

    const t = p.type;
    if (t === "boolean") {
      if (typeof raw === "boolean") next[p.key] = raw;
      else if (typeof raw === "string") {
        if (raw === "true") next[p.key] = true;
        else if (raw === "false") next[p.key] = false;
      }
      continue;
    }

    if (t === "int" || t === "bps") {
      let parsed: number | null = null;
      if (typeof raw === "number" && Number.isFinite(raw)) parsed = Math.trunc(raw);
      else if (typeof raw === "string") {
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n)) parsed = n;
      }
      if (parsed === null) continue;

      let n = parsed;
      if (t === "bps") {
        if (n < 0) n = 0;
        if (n > 5000) n = 5000;
      }
      next[p.key] = n;
      continue;
    }

    if (t === "number" || t === "eth" || t === "usd" || t === "pct") {
      let parsed: number | null = null;
      if (typeof raw === "number" && Number.isFinite(raw)) parsed = raw;
      else if (typeof raw === "string") {
        const n = Number.parseFloat(raw);
        if (Number.isFinite(n)) parsed = n;
      }
      if (parsed === null) continue;

      let n = parsed;
      if (t === "pct") {
        if (n < 0) n = 0;
        if (n > 100) n = 100;
      }
      next[p.key] = n;
      continue;
    }

    if (p.options !== undefined && p.options.length > 0) {
      if (typeof raw !== "string") continue;
      let ok = false;
      for (const opt of p.options) {
        if (opt === raw) {
          ok = true;
          break;
        }
      }
      if (ok) next[p.key] = raw;
      continue;
    }

    // string-like types: string, interval, address, pair, token, enum[...] (handled above), etc.
    if (typeof raw === "string") next[p.key] = raw;
  }
  return next;
}

function getMessageText(msg: UIMessage): string {
  let text = "";
  for (const part of msg.parts) {
    if (part.type === "text") text += part.text;
  }
  return text;
}

/** Extract code written to main.ts from tool invocation parts in a message. */
function extractCodeFromToolParts(msg: UIMessage, opts?: { allowStreaming?: boolean }) {
  const allowStreaming = opts?.allowStreaming === true;

  let bestContent: string | null = null;
  let bestRank = -1;

  for (const part of msg.parts) {
    const raw = part as Record<string, unknown>;
    const partType = raw.type;
    if (typeof partType !== "string") continue;
    if (!partType.startsWith("tool-") && partType !== "dynamic-tool") continue;

    const state = raw.state;
    let rank = -1;
    if (state === "output-available") rank = 3;
    else if (state === "input-available") rank = 2;
    else if (allowStreaming && state === "input-streaming") rank = 1;
    else continue;

    const input = raw.input as Record<string, unknown> | undefined;
    if (input === undefined) continue;

    const toolName = partType === "dynamic-tool" ? raw.toolName : partType.slice(5);
    if (toolName !== "writeFile" && toolName !== "write_file") continue;

    const filePath = input.path ?? input.filename;
    if (typeof filePath !== "string" || !filePath.endsWith("main.ts")) continue;

    const content = input.content;
    if (typeof content !== "string") continue;
    if (content.trim() === "") continue;

    if (rank > bestRank) {
      bestRank = rank;
      bestContent = content;
      continue;
    }
    if (rank === bestRank && bestContent !== null && content.length > bestContent.length) {
      bestContent = content;
    }
  }

  return bestContent;
}

function extractLatestMainTs(messages: UIMessage[], opts?: { allowStreaming?: boolean }) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg === undefined) continue;
    const code = extractCodeFromToolParts(msg, opts);
    if (code !== null) return code;
  }
  return null;
}

function extractLatestMainTsFromChatHistory(chatHistory: string | null | undefined) {
  if (chatHistory === null || chatHistory === undefined || chatHistory === "") return null;
  try {
    const parsed = JSON.parse(chatHistory) as UIMessage[];
    if (!Array.isArray(parsed)) return null;
    return extractLatestMainTs(parsed, { allowStreaming: false });
  } catch {
    return null;
  }
}

/* ── Status badge styles ─────────────────────────────────────── */

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400",
  paused: "bg-amber-500/10 text-amber-400",
  draft: "bg-secondary text-muted-foreground",
  error: "bg-destructive/10 text-destructive",
};

/* ── Outer wrapper — loads strategy data, then renders inner ── */

export function StrategyBuilder({ strategyId }: { strategyId?: string }) {
  const strategyQuery = useStrategy(strategyId);

  // Show loading while fetching an existing strategy
  if (strategyId !== undefined && strategyQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 text-primary animate-spin" />
          <span className="text-muted-foreground text-sm">Loading strategy…</span>
        </div>
      </div>
    );
  }

  return <StrategyBuilderInner strategyId={strategyId} initialData={strategyQuery.data} />;
}

/* ── Inner component — useChat called with correct initial messages ── */

function StrategyBuilderInner({
  strategyId,
  initialData,
}: {
  strategyId?: string;
  initialData?: ReturnType<typeof useStrategy>["data"];
}) {
  const { navigate } = useRouter();

  const [strategyCode, setStrategyCode] = useState(() => {
    const recovered = extractLatestMainTsFromChatHistory(initialData?.chatHistory);
    if (recovered !== null) return recovered;
    return initialData?.code ?? "";
  });

  const [paramsVersion, setParamsVersion] = useState(0);
  const [strategyParams, setStrategyParams] = useState<Record<string, unknown>>(() => {
    const recovered = extractLatestMainTsFromChatHistory(initialData?.chatHistory);
    const code = recovered ?? initialData?.code ?? "";
    if (code !== "") return reconcileParamState(code, initialData?.parameters);
    return parseStoredParams(initialData?.parameters);
  });
  const [input, setInput] = useState("");

  /* Persistence state */
  const [savedId, setSavedId] = useState<string | undefined>(strategyId);
  const [strategyStatus, setStrategyStatus] = useState(initialData?.status ?? "draft");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("strategyBuilderTab") ?? "visual";
    }
    return "visual";
  });

  const {
    spec,
    isStreaming: isUIStreaming,
    send: sendToGenerate,
  } = useUIStream({
    api: "/api/generate",
    onError: (err) => {
      console.error("UI gen error:", err);
      toast.error("Dashboard generation failed — try sending another message");
    },
  });

  /* Saved spec — restored from DB on load; used until a fresh spec is streamed */
  const [savedSpec, setSavedSpec] = useState<typeof spec>(() => {
    if (
      initialData?.config !== null &&
      initialData?.config !== undefined &&
      initialData.config !== ""
    ) {
      try {
        return JSON.parse(initialData.config);
      } catch {
        return null;
      }
    }
    return null;
  });
  const activeSpec = spec !== null && spec.root !== "" ? spec : savedSpec;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const strategyCodeRef = useRef(strategyCode);
  strategyCodeRef.current = strategyCode;
  const activeSpecRef = useRef(activeSpec);
  activeSpecRef.current = activeSpec;
  const needsAutoSaveRef = useRef(false);
  const needsChatSaveRef = useRef(false);
  const prevIsUIStreamingRef = useRef(false);
  const paramAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSaveErrorAtRef = useRef(0);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);

  // Compute initial messages — use saved history if available, otherwise welcome
  const initialMessages = useMemo((): UIMessage[] => {
    if (initialData?.chatHistory !== null && initialData?.chatHistory !== undefined) {
      try {
        const parsed = JSON.parse(initialData.chatHistory) as UIMessage[];
        if (parsed.length > 0) return parsed;
      } catch {
        /* fallback */
      }
    }
    return WELCOME_MESSAGES;
  }, []);

  const { messages, sendMessage, status } = useChat({
    transport,
    messages: initialMessages,
    onFinish: ({ message }) => {
      // Extract code from writeFile tool parts (primary path — no text extraction needed)
      const code = extractCodeFromToolParts(message, { allowStreaming: false });
      if (code !== null) {
        setStrategyCode(code);
        strategyCodeRef.current = code;
        const meta = parseStrategyMeta(code);
        const scheduleMatch = code.match(/api\.schedule(?:Next)?\(\s*["'`](.+?)["'`]\s*\)/);
        const scheduleInterval = scheduleMatch?.[1] ?? null;
        const paramState = buildParamState(meta.params);
        setStrategyParams(paramState);
        setParamsVersion((v) => v + 1);

        const uiPrompt = `Strategy: "${meta.name}" on ${meta.exchange}.
${meta.description}

Schedule interval (from code): ${scheduleInterval ?? "unspecified"}

Parameters (use these EXACT default values in FlowBlock labels and MetricCard values):
${meta.params.map((p) => `- ${p.key}: ${p.type}, default=${p.defaultVal}, ${p.desc}`).join("\n")}

Strategy code summary:
${code.slice(0, 800)}`;

        const prevSpec = activeSpecRef.current;
        sendToGenerate(uiPrompt, prevSpec?.root ? { previousSpec: prevSpec } : undefined);
        needsAutoSaveRef.current = true;
        return;
      }

      // Fallback: extract from text response (in case AI didn't use tools)
      const textCode = extractCode(getMessageText(message));
      if (textCode !== null) {
        setStrategyCode(textCode);
        strategyCodeRef.current = textCode;
        const meta = parseStrategyMeta(textCode);
        const scheduleMatch = textCode.match(/api\.schedule(?:Next)?\(\s*["'`](.+?)["'`]\s*\)/);
        const scheduleInterval = scheduleMatch?.[1] ?? null;
        const paramState = buildParamState(meta.params);
        setStrategyParams(paramState);
        setParamsVersion((v) => v + 1);

        const prevSpec = activeSpecRef.current;
        sendToGenerate(
          `Strategy: "${meta.name}" on ${meta.exchange}.\n${meta.description}\n\nSchedule interval (from code): ${scheduleInterval ?? "unspecified"}\n\nParameters:\n${meta.params.map((p) => `- ${p.key}: ${p.type}, default=${p.defaultVal}, ${p.desc}`).join("\n")}\n\nCode summary:\n${textCode.slice(0, 800)}`,
          prevSpec?.root ? { previousSpec: prevSpec } : undefined,
        );
        needsAutoSaveRef.current = true;
        return;
      }

      needsChatSaveRef.current = true;
    },
    onError: (err) => console.error("Chat error:", err),
  });

  // Live code extraction: update code from the latest *completed* writeFile(main.ts).
  //
  // IMPORTANT: we intentionally ignore input-streaming tool parts when persisting
  // and when updating the canonical strategy code. This prevents partial tool
  // payloads from truncating code in SQLite when auto-save runs.
  useEffect(() => {
    if (messages.length === 0) return;
    const code = extractLatestMainTs(messages, { allowStreaming: false });
    if (code === null) return;
    if (code === strategyCodeRef.current) return;
    setStrategyCode(code);
    strategyCodeRef.current = code;
  }, [messages]);

  // One-time repair on load: if DB code is truncated but chatHistory contains a
  // completed writeFile(main.ts), restore it and persist the fix.
  const repairedFromChatHistoryRef = useRef(false);
  useEffect(() => {
    if (repairedFromChatHistoryRef.current) return;
    if (savedId === undefined) return;
    const recovered = extractLatestMainTsFromChatHistory(initialData?.chatHistory);
    if (recovered === null) return;

    const stored = initialData?.code ?? "";
    if (stored.trim() === recovered.trim()) return;

    // Only auto-repair if the stored code looks shorter (common truncation case).
    if (stored.length >= recovered.length) return;

    repairedFromChatHistoryRef.current = true;
    setStrategyCode(recovered);
    strategyCodeRef.current = recovered;

    updateStrategy(savedId, {
      ...buildPayload(),
      code: recovered || null,
      status: strategyStatus,
    }).catch(() => {});
  }, [savedId, initialData?.chatHistory, initialData?.code, strategyStatus]);

  // One-time repair on load: if stored parameters drifted from the code's @param list,
  // reconcile (drop extras, add missing defaults) and persist.
  const repairedParamsFromCodeRef = useRef(false);
  useEffect(() => {
    if (repairedParamsFromCodeRef.current) return;
    if (savedId === undefined) return;
    if (strategyCode === "") return;
    if (isUIStreaming) return;

    const meta = parseStrategyMeta(strategyCode);
    if (meta.params.length === 0) return;

    const stored = parseStoredParams(initialData?.parameters);
    const codeKeySet = new Set<string>();
    for (const p of meta.params) codeKeySet.add(p.key);

    let mismatch = false;
    for (const k of Object.keys(stored)) {
      if (k.startsWith("__")) continue;
      if (!codeKeySet.has(k)) {
        mismatch = true;
        break;
      }
    }
    if (!mismatch) {
      for (const p of meta.params) {
        const v = stored[p.key];
        if (v === undefined || v === null) {
          mismatch = true;
          break;
        }
      }
    }
    if (!mismatch) return;

    const cleaned = reconcileParamState(strategyCode, initialData?.parameters);
    repairedParamsFromCodeRef.current = true;
    setStrategyParams(cleaned);
    setParamsVersion((v) => v + 1);
    updateStrategy(savedId, {
      ...buildPayload(),
      parameters: JSON.stringify(cleaned),
      status: strategyStatus,
    }).catch(() => {});
  }, [savedId, strategyCode, initialData?.parameters, strategyStatus, isUIStreaming]);

  // Regenerate spec on load if we have code but no saved spec
  const specRegeneratedRef = useRef(false);
  useEffect(() => {
    if (specRegeneratedRef.current) return;
    if (savedSpec !== null) return; // already have a spec
    if (strategyCode === "") return;
    specRegeneratedRef.current = true;
    const meta = parseStrategyMeta(strategyCode);
    const scheduleMatch = strategyCode.match(/api\.schedule(?:Next)?\(\s*["'`](.+?)["'`]\s*\)/);
    const scheduleInterval = scheduleMatch?.[1] ?? null;
    const paramState = buildParamState(meta.params);
    setStrategyParams(paramState);
    setParamsVersion((v) => v + 1);
    sendToGenerate(
      `Strategy: "${meta.name}" on ${meta.exchange}.\n${meta.description}\n\nSchedule interval (from code): ${scheduleInterval ?? "unspecified"}\n\nParameters:\n${meta.params.map((p: { key: string; type: string; defaultVal: string; desc: string }) => `- ${p.key}: ${p.type}, default=${p.defaultVal}, ${p.desc}`).join("\n")}\n\nCode summary:\n${strategyCode.slice(0, 800)}`,
    );
  }, [strategyCode, savedSpec]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    localStorage.setItem("strategyBuilderTab", activeTab);
  }, [activeTab]);

  /* Auto-save after UI spec finishes streaming */
  useEffect(() => {
    const wasStreaming = prevIsUIStreamingRef.current;
    prevIsUIStreamingRef.current = isUIStreaming;
    if (!wasStreaming || isUIStreaming || !needsAutoSaveRef.current) return;
    needsAutoSaveRef.current = false;

    if (strategyCode === "") return;

    const meta = parseStrategyMeta(strategyCode);
    const payload: StrategyPayload = {
      name: meta.name,
      description: meta.description ?? null,
      exchange: meta.exchange,
      code: strategyCode,
      config: activeSpec !== null ? JSON.stringify(activeSpec) : null,
      parameters: Object.keys(strategyParams).length > 0 ? JSON.stringify(strategyParams) : null,
      chatHistory: JSON.stringify(messages),
      status: "draft",
    };

    if (savedId !== undefined) {
      updateStrategy(savedId, payload).catch(() => {});
    } else {
      createStrategy(payload)
        .then((created) => {
          setSavedId(created.id);
          window.history.replaceState(null, "", `/strategy/${created.id}`);
        })
        .catch(() => {});
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.strategies });
  }, [isUIStreaming, strategyCode, strategyParams, messages, savedId, activeSpec]);

  /* Auto-save chat history for non-code assistant responses */
  useEffect(() => {
    if (!needsChatSaveRef.current) return;
    needsChatSaveRef.current = false;
    if (savedId === undefined) return;
    updateStrategy(savedId, { ...buildPayload(), status: strategyStatus }).catch(() => {});
  }, [messages]);

  /* Build payload */
  const buildPayload = () => {
    const meta = strategyCode !== "" ? parseStrategyMeta(strategyCode) : null;
    return {
      name: meta?.name ?? "Untitled Strategy",
      description: meta?.description ?? null,
      exchange: meta?.exchange ?? "robinpump",
      code: strategyCode || null,
      config: activeSpec !== null ? JSON.stringify(activeSpec) : null,
      parameters: Object.keys(strategyParams).length > 0 ? JSON.stringify(strategyParams) : null,
      chatHistory: JSON.stringify(messages),
    };
  };

  /* Persist param tweaks (debounced) */
  useEffect(() => {
    if (savedId === undefined) return;
    if (strategyCode === "") return;
    if (isUIStreaming) return;

    let hasParam = false;
    for (const _k in strategyParams) {
      hasParam = true;
      break;
    }
    if (!hasParam) return;

    if (paramAutoSaveTimerRef.current !== null) {
      clearTimeout(paramAutoSaveTimerRef.current);
    }
    paramAutoSaveTimerRef.current = setTimeout(() => {
      updateStrategy(savedId, buildPayload()).catch((e) => {
        const now = Date.now();
        if (now - lastAutoSaveErrorAtRef.current < 5000) return;
        lastAutoSaveErrorAtRef.current = now;
        toast.error(`Auto-save failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, 800);

    return () => {
      if (paramAutoSaveTimerRef.current !== null) {
        clearTimeout(paramAutoSaveTimerRef.current);
      }
      paramAutoSaveTimerRef.current = null;
    };
  }, [strategyParams, savedId, strategyCode, isUIStreaming]);

  const saveDraft = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const payload: StrategyPayload = { ...buildPayload(), status: "draft" };
      if (savedId !== undefined) {
        await updateStrategy(savedId, payload);
      } else {
        const data = await createStrategy(payload);
        setSavedId(data.id);
        window.history.replaceState(null, "", `/strategy/${data.id}`);
      }
      toast.success("Strategy saved as draft");
      queryClient.invalidateQueries({ queryKey: queryKeys.strategies });
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, savedId, strategyCode, strategyParams, messages, activeSpec]);

  const deploy = useCallback(async () => {
    if (isDeploying || strategyCode === "") return;
    setIsDeploying(true);
    try {
      let id = savedId;
      if (id === undefined) {
        const data = await createStrategy({ ...buildPayload(), status: "draft" });
        id = data.id;
        setSavedId(id);
        window.history.replaceState(null, "", `/strategy/${id}`);
      } else {
        await updateStrategy(id, buildPayload());
      }
      const deployed = await deployStrategy(id!);
      setStrategyStatus(deployed.status ?? "active");
      toast.success("Strategy deployed and running!");
      queryClient.invalidateQueries({ queryKey: queryKeys.strategies });
    } catch (e) {
      toast.error(`Deploy failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeploying(false);
    }
  }, [isDeploying, savedId, strategyCode, strategyParams, messages, activeSpec]);

  const stopRunning = useCallback(async () => {
    if (isStopping || savedId === undefined) return;
    setIsStopping(true);
    try {
      const data = await stopStrategy(savedId);
      setStrategyStatus(data.status ?? "paused");
      toast.success("Strategy stopped");
      queryClient.invalidateQueries({ queryKey: queryKeys.strategies });
    } catch (e) {
      toast.error(`Stop failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsStopping(false);
    }
  }, [isStopping, savedId]);

  const handleDelete = useCallback(async () => {
    if (isDeleting || savedId === undefined) return;
    setIsDeleting(true);
    try {
      await deleteStrategy(savedId);
      toast.success("Strategy deleted");
      queryClient.invalidateQueries({ queryKey: queryKeys.strategies });
      navigate("/");
    } catch (e) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [isDeleting, savedId, navigate]);

  const send = () => {
    const text = input.trim();
    if (text === "" || status === "streaming" || status === "submitted") return;
    sendMessage({ text }, { body: { currentCode: strategyCodeRef.current || undefined } });
    setInput("");
  };

  const sendTemplate = (prompt: string) => {
    if (status === "streaming" || status === "submitted") return;
    sendMessage({ text: prompt }, { body: { currentCode: strategyCodeRef.current || undefined } });
  };

  const regenerateUI = useCallback(() => {
    if (strategyCode === "" || isUIStreaming) return;
    const meta = parseStrategyMeta(strategyCode);
    const scheduleMatch = strategyCode.match(/api\.schedule(?:Next)?\(\s*["'`](.+?)["'`]\s*\)/);
    const scheduleInterval = scheduleMatch?.[1] ?? null;
    const prevSpec = activeSpecRef.current;
    const paramDesc: string[] = [];
    for (const p of meta.params) {
      paramDesc.push(`- ${p.key}: ${p.type}, default=${p.defaultVal}, ${p.desc}`);
    }
    const uiPrompt = `Strategy: "${meta.name}" on ${meta.exchange}.\n${meta.description}\n\nSchedule interval (from code): ${scheduleInterval ?? "unspecified"}\n\nParameters:\n${paramDesc.join("\n")}\n\nCode summary:\n${strategyCode.slice(0, 800)}`;
    sendToGenerate(uiPrompt, prevSpec?.root ? { previousSpec: prevSpec } : undefined);
  }, [strategyCode, isUIStreaming, sendToGenerate]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const renderedSpec = useMemo(() => {
    if (activeSpec === null) return null;
    if (activeSpec.root === "") return activeSpec;
    if (activeSpec.elements === undefined) return activeSpec;

    const scheduleMatch = strategyCode.match(/api\.schedule(?:Next)?\(\s*["'`](.+?)["'`]\s*\)/);
    const scheduleInterval = scheduleMatch?.[1] ?? null;

    let changed = false;
    const nextElements = { ...activeSpec.elements };
    for (const elKey in nextElements) {
      const el = nextElements[elKey];
      if (el === undefined) continue;

      if (el.type === "StrategyHeader") {
        if (el.props.status === strategyStatus) continue;
        nextElements[elKey] = { ...el, props: { ...el.props, status: strategyStatus } };
        changed = true;
        continue;
      }

      if (el.type === "StatusIndicator") {
        let uiStatus: string = "waiting";
        if (strategyStatus === "active") uiStatus = "active";
        else if (strategyStatus === "paused") uiStatus = "paused";
        else if (strategyStatus === "error") uiStatus = "error";

        if (el.props.status === uiStatus) continue;
        nextElements[elKey] = { ...el, props: { ...el.props, status: uiStatus } };
        changed = true;
        continue;
      }

      if (el.type === "ScheduleDisplay" && scheduleInterval !== null) {
        if (el.props.interval === scheduleInterval) continue;
        nextElements[elKey] = { ...el, props: { ...el.props, interval: scheduleInterval } };
        changed = true;
        continue;
      }
    }

    if (!changed) return activeSpec;
    return { ...activeSpec, elements: nextElements };
  }, [activeSpec, strategyStatus, strategyCode]);

  const hasStrategy = !!(activeSpec?.root && Object.keys(activeSpec.elements ?? {}).length > 0);
  let hasHeader = false;
  let hasParams = false;
  let hasFlow = false;
  if (hasStrategy && activeSpec !== null) {
    for (const el of Object.values(activeSpec.elements ?? {})) {
      if (typeof el !== "object" || el === null || !("type" in el)) continue;
      const t = (el as { type?: unknown }).type;
      if (typeof t !== "string") continue;
      if (t === "StrategyHeader") hasHeader = true;
      else if (t === "ParameterGroup") hasParams = true;
      else if (t === "FlowBlock") hasFlow = true;
      if (hasHeader && hasParams && hasFlow) break;
    }
  }
  const specIsIncomplete = hasStrategy && (!hasHeader || !hasParams || !hasFlow);
  const hasCode = strategyCode.length > 0;
  const isBusy = status === "streaming" || status === "submitted" || isUIStreaming;
  const isRunning = strategyStatus === "active";
  const declaredParamKeySet = useMemo(() => {
    const meta = parseStrategyMeta(strategyCode);
    const set = new Set<string>();
    for (const p of meta.params) set.add(p.key);
    return set;
  }, [strategyCode]);

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      {/* ── Delete dialog ─────────────────────────────── */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Strategy?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ═══════════ Chat Panel ═══════════════════════════ */}
      <div className="w-full md:w-[420px] md:min-w-[340px] flex-3 min-h-0 md:flex-none md:h-full flex flex-col border-b md:border-b-0 md:border-r bg-card/40">
        {/* Header */}
        <div className="h-[52px] border-b flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <Button variant="ghost" size="icon-xs" onClick={() => navigate("/")}>
              <ChevronDown className="size-4 rotate-90" />
            </Button>
            <h2 className="text-sm font-semibold text-foreground">
              {savedId !== undefined ? "Edit Strategy" : "New Strategy"}
            </h2>
            {savedId !== undefined && (
              <Badge
                className={`capitalize ${STATUS_STYLES[strategyStatus] ?? STATUS_STYLES.draft}`}
              >
                {strategyStatus}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {savedId !== undefined && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            {isBusy ? (
              <>
                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                <span className="text-[11px] text-primary font-medium">
                  {status === "submitted"
                    ? "Sending…"
                    : status === "streaming"
                      ? "Thinking…"
                      : "Rendering…"}
                </span>
              </>
            ) : (
              <>
                <span className="size-1.5 rounded-full bg-emerald-400" />
                <span className="text-[11px] text-muted-foreground font-medium">AI Ready</span>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
          {messages.map((msg) => (
            <ChatBubble
              key={msg.id}
              msg={msg}
              isLastAssistant={msg === messages[messages.length - 1] && msg.role === "assistant"}
              chatStatus={status}
            />
          ))}
          {messages.length === 1 && (
            <div className="pl-7 space-y-3">
              {/* Template cards */}
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => sendTemplate(t.prompt)}
                    disabled={isBusy}
                    className="text-left p-3 rounded-xl border border-border/60 bg-card/50
                               hover:bg-secondary/80 hover:border-primary/20
                               transition-all cursor-pointer group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-lg block mb-1">{t.icon}</span>
                    <span className="text-[12px] font-semibold text-foreground group-hover:text-primary transition-colors block">
                      {t.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                      {t.prompt}
                    </span>
                  </button>
                ))}
              </div>
              {/* Quick type hint */}
              <p className="text-[10px] text-muted-foreground/50 text-center">
                or describe anything in the chat below
              </p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t shrink-0">
          <div className="relative bg-secondary border rounded-xl focus-within:border-ring transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Describe your trading strategy…"
              rows={3}
              className="w-full bg-transparent px-4 pt-3 pb-10 text-sm text-foreground placeholder-muted-foreground resize-none focus:outline-none"
            />
            <div className="absolute bottom-2.5 left-4 right-3 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground select-none">
                ↵ Send&ensp;·&ensp;Shift + ↵ newline
              </span>
              <Button size="xs" onClick={send} disabled={input.trim() === "" || isBusy}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ Preview Panel ════════════════════════ */}
      <div className="flex-2 md:flex-1 min-w-0 min-h-0 flex flex-col bg-background relative">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col gap-0"
        >
          {/* Header */}
          <div className="relative z-10 border-b shrink-0 bg-background/80 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 md:px-5 py-2">
              {/* Left: title + streaming indicator */}
              <div className="flex items-center gap-2 min-w-0 mr-auto">
                {hasCode ? (
                  <h2 className="text-sm font-semibold text-foreground truncate max-w-[160px] md:max-w-none">
                    {parseStrategyMeta(strategyCode).name}
                  </h2>
                ) : (
                  <h2 className="text-sm font-semibold text-foreground">Preview</h2>
                )}
                {isUIStreaming && (
                  <div className="flex items-center gap-1.5">
                    <div className="size-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="text-[10px] text-primary font-medium">Streaming…</span>
                  </div>
                )}
              </div>

              {/* Right: tabs + actions */}
              <div className="flex items-center gap-2 shrink-0">
                <TabsList>
                  <TabsTrigger value="visual">Visual</TabsTrigger>
                  <TabsTrigger value="code">Code</TabsTrigger>
                  <TabsTrigger value="logs" className="gap-1">
                    <Terminal className="size-3" />
                    Logs
                  </TabsTrigger>
                  <TabsTrigger value="performance" className="gap-1">
                    <BarChart3 className="size-3" />
                    Performance
                  </TabsTrigger>
                </TabsList>
                {hasCode && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={regenerateUI}
                      disabled={isUIStreaming || strategyCode === ""}
                      title="Regenerate dashboard"
                    >
                      <RotateCw className={`size-3.5 ${isUIStreaming ? "animate-spin" : ""}`} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={saveDraft} disabled={isSaving}>
                      {isSaving ? "Saving…" : "Save Draft"}
                    </Button>
                    {isRunning ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={stopRunning}
                        disabled={isStopping}
                        className="gap-1.5"
                      >
                        <Square className="size-3" />
                        {isStopping ? "Stopping…" : "Stop"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={deploy}
                        disabled={isDeploying || isBusy}
                        className="gap-1.5"
                      >
                        <Play className="size-3" />
                        {isDeploying ? "Deploying…" : "Deploy"}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <TabsContent value="visual" className="flex-1 overflow-y-auto">
            {!hasStrategy && !isUIStreaming ? (
              <EmptyPreview />
            ) : (
              <div className="px-4 py-4">
                {specIsIncomplete && !isUIStreaming && (
                  <div className="mb-3 rounded-xl bg-amber-500/8 border border-amber-500/15 p-3">
                    <div className="flex items-start gap-2.5">
                      <Loader2 className="size-4 text-amber-400 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          Dashboard is incomplete
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          The generated layout is missing key pieces (header, flow, or params).
                          Click Regenerate or send another message.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <StateProvider
                  key={`${paramsVersion}:${savedId ?? "new"}`}
                  initialState={{ ...strategyParams, __strategyId: savedId ?? "" }}
                  onStateChange={(path, value) => {
                    if (!path.startsWith("/")) return;
                    const key = path.slice(1);
                    if (key === "") return;
                    if (!declaredParamKeySet.has(key)) return;
                    setStrategyParams((prev) => ({ ...prev, [key]: value }));
                  }}
                >
                  <VisibilityProvider>
                    <ActionProvider
                      handlers={{
                        deploy: async () => {
                          await deploy();
                        },
                        pause: async () => {
                          await stopRunning();
                        },
                      }}
                    >
                      <Renderer spec={renderedSpec} registry={registry} loading={isUIStreaming} />
                    </ActionProvider>
                  </VisibilityProvider>
                </StateProvider>
              </div>
            )}
          </TabsContent>

          <TabsContent value="code" className="flex-1 overflow-y-auto">
            {strategyCode === "" ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Strategy code will appear here after you describe your strategy.
              </div>
            ) : (
              <div className="p-5 max-h-[calc(100vh-100px)] overflow-y-auto overflow-x-hidden">
                <div className="mb-4 rounded-xl bg-card/60 border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.12em]">
                        Parameters
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        These are saved separately from code and override the{" "}
                        <span className="font-mono">{"// @param"}</span> defaults at runtime.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          navigator.clipboard.writeText(strategyCode).then(
                            () => toast.success("Code copied"),
                            () => toast.error("Failed to copy code"),
                          );
                        }}
                        disabled={isBusy}
                      >
                        Copy code
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          const json = JSON.stringify(strategyParams, null, 2);
                          navigator.clipboard.writeText(json).then(
                            () => toast.success("Parameters copied"),
                            () => toast.error("Failed to copy parameters"),
                          );
                        }}
                        disabled={isBusy}
                      >
                        Copy JSON
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 text-xs font-mono text-foreground/90 whitespace-pre-wrap wrap-break-word">
                    {JSON.stringify(strategyParams, null, 2)}
                  </pre>
                </div>
                <div className="min-w-0 [&_pre]:overflow-x-auto">
                  <Streamdown plugins={sdPlugins} mode="static">
                    {"```typescript\n" + strategyCode + "\n```"}
                  </Streamdown>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="flex-1 relative">
            <LogsPanel strategyId={savedId} isActive={strategyStatus === "active"} />
          </TabsContent>

          <TabsContent value="performance" className="flex-1 overflow-y-auto">
            {savedId !== undefined ? (
              <StrategyPerformance strategyId={savedId} isActive={strategyStatus === "active"} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center px-10 text-center">
                <div className="size-16 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mb-5">
                  <BarChart3 className="size-7 text-primary/40" />
                </div>
                <h3 className="font-display text-lg text-foreground mb-2">No Performance Data</h3>
                <p className="text-muted-foreground text-sm max-w-[300px] leading-relaxed">
                  Save and deploy your strategy to see live performance metrics, PnL tracking, and
                  trade history.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ── Logs Panel ──────────────────────────────────────────── */

function LogsPanel({
  strategyId,
  isActive,
}: {
  strategyId: string | undefined;
  isActive: boolean;
}) {
  const { data: logsData } = useStrategyLogs(strategyId, strategyId !== undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const logs = logsData?.logs ?? [];

  useEffect(() => {
    if (isAtBottom && containerRef.current !== null) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length, isAtBottom]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (el === null) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setIsAtBottom(atBottom);
  };

  const scrollToBottom = () => {
    if (containerRef.current !== null) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setIsAtBottom(true);
    }
  };

  if (strategyId === undefined) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-10 text-center">
        <Terminal className="size-8 text-muted-foreground/30 mb-4" />
        <p className="text-muted-foreground text-sm">Deploy your strategy to see live logs here.</p>
      </div>
    );
  }

  const runCount = logsData?.runCount ?? 0;
  const isRunning = logsData?.isRunning ?? false;
  const startedAt = logsData?.startedAt ?? 0;

  let uptime = "";
  if (startedAt > 0) {
    const mins = Math.floor((Date.now() - startedAt * 1000) / 60_000);
    if (mins < 60) uptime = `${mins}m`;
    else uptime = `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0a0c] overflow-hidden relative">
      {/* Stats bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 shrink-0">
        {isRunning && <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          {isRunning ? "Running" : isActive ? "Starting…" : "Stopped"}
        </span>
        {uptime !== "" && (
          <>
            <span className="text-border-light text-xs">&middot;</span>
            <span className="text-muted-foreground text-[11px] font-mono">{uptime}</span>
          </>
        )}
        <div className="flex-1" />
        <span className="text-muted-foreground text-[11px]">{runCount} runs</span>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[12px] leading-relaxed space-y-0.5"
      >
        {logs.length === 0 && (
          <div className="text-muted-foreground/50 text-center py-8">
            {isRunning || isActive
              ? "Waiting for logs…"
              : "No logs yet. Deploy your strategy to start."}
          </div>
        )}
        {logs.map((log, i) => {
          const ts = new Date(log.timestamp * 1000).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          const levelColor =
            log.level === "error"
              ? "text-red-400"
              : log.level === "trade"
                ? "text-emerald-400"
                : "text-muted-foreground/70";
          return (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground/40 shrink-0 tabular-nums">{ts}</span>
              <span className={`uppercase text-[10px] font-bold w-10 shrink-0 ${levelColor}`}>
                {log.level.slice(0, 5)}
              </span>
              <span className={levelColor}>{log.message}</span>
            </div>
          );
        })}
      </div>

      {/* Scroll-to-bottom button */}
      {!isAtBottom && logs.length > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 size-8 rounded-full bg-secondary border border-border
                     flex items-center justify-center hover:bg-accent transition-colors cursor-pointer"
        >
          <ArrowDown className="size-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
