import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import {
  Renderer,
  StateProvider,
  ActionProvider,
  VisibilityProvider,
  useUIStream,
  type Spec,
} from "@json-render/react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import "streamdown/styles.css";
import { useRouter } from "../App";
import { registry } from "../lib/registry";

/* ══════════════════════════════════════════════════════════════
   Strategy Builder — dual-model AI:
     Left:   Chat panel  → Sonnet 4.5 w/ extended thinking (code gen)
     Right:  Preview     → Haiku 4.5 (visual UI gen via json-render)
   ══════════════════════════════════════════════════════════════ */

interface Msg {
  role: "user" | "assistant" | "thinking";
  content: string;
  isStreaming?: boolean;
}

const WELCOME: Msg[] = [
  {
    role: "assistant",
    content:
      'Hey! Describe your trading strategy in plain English and I\'ll build it for you.\n\nTry something like **"Buy BTC every hour when price < $60k"** or **"Snipe new RobinPump coins under $3k market cap"**.\n\nI\'ll generate the code, and you\'ll see a live dashboard on the right with knobs you can tweak.',
  },
];

const SUGGESTIONS = [
  "Buy $50 of Bitcoin every hour when price < $60k",
  "Snipe new RobinPump coins under $3k market cap",
  "DCA into ETH $25 every day on Binance",
];

/* ── Shared streamdown config ─────────────────────────────── */
const sdCodePlugin = createCodePlugin({
  themes: ["github-dark-high-contrast", "github-dark-high-contrast"],
});
const sdPlugins = { code: sdCodePlugin };

/* ── Main Component ───────────────────────────────────────── */

export function StrategyBuilder({ strategyId }: { strategyId?: string }) {
  const { navigate } = useRouter();

  const [messages, setMessages] = useState<Msg[]>(WELCOME);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState("");

  const [strategyCode, setStrategyCode] = useState("");
  const [strategyParams, setStrategyParams] = useState<Record<string, unknown>>({});
  const [viewMode, setViewMode] = useState<"visual" | "code" | "spec">("visual");

  /* ── Persistence state ─────────────────────────────────── */
  const [savedId, setSavedId] = useState<string | undefined>(strategyId);
  const [strategyStatus, setStrategyStatus] = useState<string>("draft");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(strategyId !== undefined);

  const { spec, isStreaming: isUIStreaming, send: sendToGenerate } = useUIStream({
    api: "/api/generate",
    onError: (err) => console.error("UI gen error:", err),
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const thinkingEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ── Toast auto-dismiss ────────────────────────────────── */
  useEffect(() => {
    if (toastMsg === null) return;
    const t = setTimeout(() => setToastMsg(null), 3000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  /* ── Load existing strategy ────────────────────────────── */
  useEffect(() => {
    if (strategyId === undefined) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/strategies/${strategyId}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        if (cancelled) return;

        setSavedId(data.id);
        setStrategyStatus(data.status);

        if (data.code !== null && data.code !== "") {
          setStrategyCode(data.code);
        }

        if (data.parameters !== null) {
          try {
            setStrategyParams(JSON.parse(data.parameters));
          } catch { /* ignore parse error */ }
        }

        if (data.chatHistory !== null) {
          try {
            const history = JSON.parse(data.chatHistory) as Msg[];
            if (history.length > 0) setMessages(history);
          } catch { /* ignore parse error */ }
        }

        /* If strategy has code, trigger UI generation to restore the visual */
        if (data.code !== null && data.code !== "") {
          const meta = parseStrategyMeta(data.code);
          const paramState = buildParamState(meta.params);
          setStrategyParams(paramState);

          const uiPrompt = `Strategy: "${meta.name}" on ${meta.exchange}.
${meta.description}

Parameters (use these EXACT default values in FlowBlock labels and MetricCard values):
${meta.params.map((p) => `- ${p.key}: ${p.type}, default=${p.defaultVal}, ${p.desc}`).join("\n")}

Strategy code summary:
${data.code.slice(0, 800)}`;

          sendToGenerate(uiPrompt);
        }
      } catch {
        setToastMsg("Failed to load strategy");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [strategyId]);

  /* Auto-scroll chat to bottom */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* Auto-scroll thinking text as it grows */
  useEffect(() => {
    thinkingEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thinkingText]);

  /* ── Parse helpers ──────────────────────────────────────── */

  const extractCode = (text: string): string | null => {
    const match = text.match(/```typescript\n([\s\S]*?)```/);
    return match ? match[1]!.trim() : null;
  };

  const parseStrategyMeta = (code: string) => {
    const name = code.match(/\/\/ Strategy: (.+)/)?.[1] ?? "Untitled";
    const exchange = code.match(/\/\/ Exchange: (.+)/)?.[1]?.trim() ?? "binance";
    const description = code.match(/\/\/ Description: (.+)/)?.[1] ?? "";
    const params: { key: string; type: string; defaultVal: string; desc: string }[] = [];
    for (const m of code.matchAll(/\/\/ @param (\S+) (\S+) (\S+) (.+)/g)) {
      params.push({ key: m[1]!, type: m[2]!, defaultVal: m[3]!, desc: m[4]! });
    }
    return { name, exchange, description, params };
  };

  /** Build a state object from @param defaults for json-render data binding */
  const buildParamState = (params: { key: string; type: string; defaultVal: string }[]) => {
    const state: Record<string, unknown> = {};
    for (const p of params) {
      if (p.type === "number") state[p.key] = parseFloat(p.defaultVal) || 0;
      else if (p.type === "boolean") state[p.key] = p.defaultVal === "true";
      else state[p.key] = p.defaultVal;
    }
    return state;
  };

  /* ── Build the payload for save/deploy ─────────────────── */
  const buildPayload = () => {
    const meta = strategyCode ? parseStrategyMeta(strategyCode) : null;
    return {
      name: meta?.name ?? "Untitled Strategy",
      description: meta?.description ?? null,
      exchange: meta?.exchange ?? "binance",
      code: strategyCode || null,
      config: spec ? JSON.stringify(spec) : null,
      parameters: Object.keys(strategyParams).length > 0 ? JSON.stringify(strategyParams) : null,
      chatHistory: JSON.stringify(messages),
    };
  };

  /* ── Save as draft ─────────────────────────────────────── */
  const saveDraft = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const payload = { ...buildPayload(), status: "draft" };

      if (savedId !== undefined) {
        const res = await fetch(`/api/strategies/${savedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Save failed");
        const data = await res.json();
        setStrategyStatus(data.status);
        setToastMsg("Strategy saved as draft");
      } else {
        const res = await fetch("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Save failed");
        const data = await res.json();
        setSavedId(data.id);
        setStrategyStatus(data.status);
        setToastMsg("Strategy saved as draft");
        /* Update URL to include the new ID so refresh preserves state */
        window.history.replaceState(null, "", `/strategy/${data.id}`);
      }
    } catch (e) {
      setToastMsg(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, savedId, strategyCode, strategyParams, messages, spec]);

  /* ── Deploy strategy ───────────────────────────────────── */
  const deploy = useCallback(async () => {
    if (isDeploying || !strategyCode) return;
    setIsDeploying(true);
    try {
      const payload = buildPayload();

      /* Save first (create or update) */
      let id = savedId;
      if (id === undefined) {
        const res = await fetch("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, status: "draft" }),
        });
        if (!res.ok) throw new Error("Save failed");
        const data = await res.json();
        id = data.id;
        setSavedId(id);
        window.history.replaceState(null, "", `/strategy/${id}`);
      } else {
        const res = await fetch(`/api/strategies/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Save failed");
      }

      /* Now deploy */
      const deployRes = await fetch(`/api/strategies/${id}/deploy`, { method: "POST" });
      if (!deployRes.ok) {
        const err = await deployRes.json();
        throw new Error(err.error ?? "Deploy failed");
      }
      const deployedData = await deployRes.json();
      setStrategyStatus(deployedData.status ?? "active");
      setToastMsg("Strategy deployed and running!");
    } catch (e) {
      setToastMsg(`Deploy failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeploying(false);
    }
  }, [isDeploying, savedId, strategyCode, strategyParams, messages, spec]);

  /* ── Stop a running strategy ───────────────────────────── */
  const stopRunning = useCallback(async () => {
    if (isStopping || savedId === undefined) return;
    setIsStopping(true);
    try {
      const res = await fetch(`/api/strategies/${savedId}/stop`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Stop failed");
      }
      const data = await res.json();
      setStrategyStatus(data.status ?? "paused");
      setToastMsg("Strategy stopped");
    } catch (e) {
      setToastMsg(`Stop failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsStopping(false);
    }
  }, [isStopping, savedId]);

  /* ── Delete strategy ───────────────────────────────────── */
  const deleteStrategy = useCallback(async () => {
    if (isDeleting || savedId === undefined) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/strategies/${savedId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setToastMsg("Strategy deleted");
      navigate("/");
    } catch (e) {
      setToastMsg(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [isDeleting, savedId, navigate]);

  /* ── Send chat message → Sonnet 4.5 with thinking ────── */
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: Msg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsThinking(true);
    setThinkingText("");

    let fullText = "";
    let fullThinking = "";

    /* Add a streaming assistant message that we'll update live */
    const streamingMsgIndex = { current: -1 };

    try {
      const chatMessages = [...messages.filter((m) => m.role !== "thinking"), userMsg].map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatMessages, currentCode: strategyCode || undefined }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let addedAssistantMsg = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "thinking") {
              fullThinking += data.text;
              setThinkingText(fullThinking);
            } else if (data.type === "text") {
              fullText += data.text;

              /* Stream the assistant message live */
              if (!addedAssistantMsg) {
                addedAssistantMsg = true;
                /* First: add thinking collapse if we had thinking */
                if (fullThinking) {
                  setMessages((prev) => [...prev, { role: "thinking", content: fullThinking }]);
                }
                setThinkingText("");
                /* Then add the streaming assistant message */
                setMessages((prev) => {
                  streamingMsgIndex.current = prev.length;
                  return [...prev, { role: "assistant", content: fullText, isStreaming: true }];
                });
              } else {
                /* Update the existing streaming message */
                setMessages((prev) =>
                  prev.map((m, i) =>
                    i === streamingMsgIndex.current ? { ...m, content: fullText } : m
                  )
                );
              }
            }
          } catch {
            /* skip malformed */
          }
        }
      }

      /* Finalize: mark streaming done */
      setMessages((prev) =>
        prev.map((m, i) =>
          i === streamingMsgIndex.current ? { ...m, isStreaming: false } : m
        )
      );

      /* If we had thinking but no text started streaming yet, add it now */
      if (fullThinking && !fullText) {
        setMessages((prev) => [...prev, { role: "thinking", content: fullThinking }]);
      }

      /* If no assistant message was added yet */
      if (!fullText) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "I couldn't generate a response. Try again?" },
        ]);
      }

      /* Extract code and trigger UI generation */
      const code = extractCode(fullText);
      if (code) {
        setStrategyCode(code);
        const meta = parseStrategyMeta(code);
        const paramState = buildParamState(meta.params);
        setStrategyParams(paramState);

        const uiPrompt = `Strategy: "${meta.name}" on ${meta.exchange}.
${meta.description}

Parameters (use these EXACT default values in FlowBlock labels and MetricCard values):
${meta.params.map((p) => `- ${p.key}: ${p.type}, default=${p.defaultVal}, ${p.desc}`).join("\n")}

Strategy code summary:
${code.slice(0, 800)}`;

        sendToGenerate(uiPrompt, spec?.root ? { previousSpec: spec } : undefined);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e instanceof Error ? e.message : String(e)}. Try again?` },
      ]);
    } finally {
      setIsThinking(false);
      setThinkingText("");
    }
  }, [input, isThinking, messages, strategyCode, sendToGenerate, spec]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const hasStrategy = !!(spec?.root && Object.keys(spec.elements ?? {}).length > 0);
  const hasCode = strategyCode.length > 0;
  const isBusy = isThinking || isUIStreaming;
  const isRunning = strategyStatus === "active";

  /* ── Status badge config ───────────────────────────────── */
  const STATUS_CFG: Record<string, { bg: string; fg: string; dot: string }> = {
    active: { bg: "bg-emerald-500/10", fg: "text-emerald-400", dot: "bg-emerald-400" },
    paused: { bg: "bg-amber-500/10", fg: "text-amber-400", dot: "bg-amber-400" },
    draft: { bg: "bg-zinc-500/10", fg: "text-zinc-400", dot: "bg-zinc-500" },
    error: { bg: "bg-red-500/10", fg: "text-red-400", dot: "bg-red-400" },
  };
  const statusCfg = STATUS_CFG[strategyStatus] ?? STATUS_CFG.draft!;

  /* ── Render ──────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          <span className="text-text-muted text-sm">Loading strategy…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* ════════════════ Toast ════════════════════════════ */}
      {toastMsg !== null && (
        <div className="fixed top-4 right-4 z-50 animate-slide-up">
          <div className="bg-surface-3 border border-border-light rounded-xl px-4 py-2.5 shadow-lg flex items-center gap-2.5">
            <span className="text-[13px] text-text">{toastMsg}</span>
            <button onClick={() => setToastMsg(null)} className="text-text-muted hover:text-text transition-colors cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l6 6M10 4l-6 6" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ════════════════ Delete Confirm Modal ════════════ */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian/70 backdrop-blur-sm">
          <div className="bg-surface-2 border border-border rounded-2xl p-6 w-[380px] shadow-2xl animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-red-400">
                  <path d="M3 6h14M8 6V4a1 1 0 011-1h2a1 1 0 011 1v2M5 6v10a2 2 0 002 2h6a2 2 0 002-2V6" />
                  <path d="M8.5 9.5v5M11.5 9.5v5" />
                </svg>
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-text">Delete Strategy?</h3>
                <p className="text-[13px] text-text-muted">This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 justify-end mt-5">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 border border-border rounded-xl text-[13px] font-semibold text-text-secondary hover:text-text hover:border-border-light transition-all cursor-pointer"
              >Cancel</button>
              <button
                onClick={deleteStrategy}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-500/15 border border-red-500/20 text-red-400 rounded-xl text-[13px] font-semibold hover:bg-red-500/25 transition-all cursor-pointer disabled:opacity-50"
              >{isDeleting ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ Chat Panel ═══════════════════════ */}
      <div className="w-[420px] min-w-[340px] h-full flex flex-col border-r border-border bg-surface/40 shrink-0">
        {/* header */}
        <div className="h-[52px] border-b border-border flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate("/")} className="text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12L6 8l4-4" /></svg>
            </button>
            <h2 className="text-sm font-semibold text-text">{savedId !== undefined ? "Edit Strategy" : "New Strategy"}</h2>
            {savedId !== undefined && (
              <span className={`flex items-center gap-1.5 px-2 py-[3px] rounded-full ${statusCfg.bg}`}>
                <span className={`w-[5px] h-[5px] rounded-full ${statusCfg.dot}`} />
                <span className={`text-[10px] font-bold capitalize ${statusCfg.fg}`}>{strategyStatus}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Delete button — only for saved strategies */}
            {savedId !== undefined && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                title="Delete strategy"
              >
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2.5 4.5h10M6 4.5V3a.75.75 0 01.75-.75h1.5A.75.75 0 019 3v1.5M4 4.5v7.25a1.5 1.5 0 001.5 1.5h4a1.5 1.5 0 001.5-1.5V4.5" />
                  <path d="M6.25 7v3.5M8.75 7v3.5" />
                </svg>
              </button>
            )}
            {isBusy ? (
              <>
                <span className="w-[6px] h-[6px] rounded-full bg-gold animate-pulse" />
                <span className="text-[11px] text-gold font-medium">{isThinking ? "Thinking…" : "Rendering…"}</span>
              </>
            ) : (
              <>
                <span className="w-[6px] h-[6px] rounded-full bg-emerald-400" />
                <span className="text-[11px] text-text-muted font-medium">AI Ready</span>
              </>
            )}
          </div>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
          {messages.map((m, i) => (
            <ChatBubble key={i} msg={m} />
          ))}

          {/* Live thinking indicator */}
          {isThinking && thinkingText && (
            <ThinkingBubble text={thinkingText} endRef={thinkingEndRef} />
          )}

          {/* Suggestion chips */}
          {messages.length === 1 && (
            <div className="pl-7 flex flex-wrap gap-2 animate-fade-in stagger-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="text-[12px] text-text-muted border border-border rounded-full px-3 py-1.5 hover:border-gold/30 hover:text-gold transition-colors cursor-pointer"
                >{s}</button>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* input */}
        <div className="p-3 border-t border-border shrink-0">
          <div className="relative bg-surface-2 border border-border rounded-xl focus-within:border-gold/30 transition-colors">
            <textarea
              ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
              placeholder="Describe your trading strategy…" rows={3}
              className="w-full bg-transparent px-4 pt-3 pb-10 text-sm text-text placeholder-text-muted resize-none focus:outline-none"
            />
            <div className="absolute bottom-2.5 left-4 right-3 flex items-center justify-between">
              <span className="text-[10px] text-text-muted select-none">↵ Send&ensp;·&ensp;Shift + ↵ newline</span>
              <button
                onClick={send} disabled={!input.trim() || isBusy}
                className="bg-gold text-obsidian px-3.5 py-1 rounded-lg text-[12px] font-bold hover:bg-gold-bright transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
              >Send</button>
            </div>
          </div>
        </div>
      </div>

      {/* ════════════════ Preview Panel ════════════════════ */}
      <div className="flex-1 h-full flex flex-col bg-obsidian relative">
        <div className="absolute inset-0 dot-grid opacity-60 pointer-events-none" />

        {/* header with tabs */}
        <div className="relative z-10 h-[52px] border-b border-border flex items-center justify-between px-5 shrink-0 bg-obsidian/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-text">Preview</h2>
            {isUIStreaming && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
                <span className="text-[10px] text-gold font-medium">Streaming…</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex bg-surface border border-border rounded-lg p-[3px]">
              <TabBtn active={viewMode === "visual"} onClick={() => setViewMode("visual")}>Visual</TabBtn>
              <TabBtn active={viewMode === "code"} onClick={() => setViewMode("code")}>Code</TabBtn>
              <TabBtn active={viewMode === "spec"} onClick={() => setViewMode("spec")}>Spec</TabBtn>
            </div>
            {hasCode && (
              <>
                <button
                  onClick={saveDraft}
                  disabled={isSaving || isBusy}
                  className="px-3.5 py-1.5 border border-border rounded-lg text-[12px] font-semibold text-text-secondary hover:text-text hover:border-border-light transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >{isSaving ? "Saving…" : "Save Draft"}</button>

                {isRunning ? (
                  <button
                    onClick={stopRunning}
                    disabled={isStopping}
                    className="px-3.5 py-1.5 bg-red-500/15 border border-red-500/20 text-red-400 rounded-lg text-[12px] font-bold hover:bg-red-500/25 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="2" y="2" width="6" height="6" rx="1" /></svg>
                    {isStopping ? "Stopping…" : "Stop"}
                  </button>
                ) : (
                  <button
                    onClick={deploy}
                    disabled={isDeploying || isBusy}
                    className="px-3.5 py-1.5 bg-gold text-obsidian rounded-lg text-[12px] font-bold hover:bg-gold-bright transition-all hover:shadow-[0_0_16px_rgba(229,160,13,0.18)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1l7 4-7 4V1z" /></svg>
                    {isDeploying ? "Deploying…" : "Deploy"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* content */}
        <div className="relative z-10 flex-1 overflow-y-auto">
          {viewMode === "visual" ? (
            !hasStrategy && !isUIStreaming ? (
              <EmptyPreview />
            ) : (
              <div className="px-4 py-4">
                <StateProvider initialState={strategyParams}>
                  <VisibilityProvider>
                    <ActionProvider
                      handlers={{
                        deploy: async (p) => console.log("Deploy:", p),
                        pause: async (p) => console.log("Pause:", p),
                        updateParam: async (p) => {
                          console.log("Param update:", p);
                          /* Update local param state */
                          if (p && typeof p === "object" && "key" in p && "value" in p) {
                            setStrategyParams((prev) => ({
                              ...prev,
                              [(p as any).key]: (p as any).value,
                            }));
                          }
                        },
                      }}
                    >
                      <Renderer spec={spec} registry={registry} loading={isUIStreaming} />
                    </ActionProvider>
                  </VisibilityProvider>
                </StateProvider>
              </div>
            )
          ) : viewMode === "code" ? (
            <StrategyCodeView code={strategyCode} />
          ) : (
            <SpecJsonView spec={spec} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Chat Bubble ──────────────────────────────────────────── */

function ChatBubble({ msg }: { msg: Msg }) {
  const [expanded, setExpanded] = useState(false);
  const isAI = msg.role === "assistant";
  const isThinkingMsg = msg.role === "thinking";

  if (isThinkingMsg) {
    return (
      <div className="animate-fade-in">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 mb-1 cursor-pointer group"
        >
          <div className="w-5 h-5 rounded-md bg-violet-500/15 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-violet-400">
              <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 3v2.5L6.5 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-[10px] font-bold text-violet-400/70 uppercase tracking-[0.08em]">Thinking</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={`text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}>
            <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        {expanded && (
          <div className="text-[12.5px] leading-[1.7] text-violet-300/70 max-h-52 overflow-y-auto border-l-2 border-violet-400/20 pl-3.5 ml-2.5 mt-1">
            <Streamdown
              animated={{ animation: "blurIn", duration: 100 }}
              isAnimating={false}
              mode="static"
            >
              {msg.content.length > 3000 ? msg.content.slice(0, 3000) + "…" : msg.content}
            </Streamdown>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`animate-fade-in ${isAI ? "animate-slide-left" : "animate-slide-right"}`}>
      <div className="flex items-center gap-2 mb-1.5">
        {isAI ? (
          <div className="w-5 h-5 rounded-md bg-gold/15 flex items-center justify-center">
            <span className="font-display text-gold text-[10px]">t</span>
          </div>
        ) : (
          <div className="w-5 h-5 rounded-md bg-surface-3 flex items-center justify-center">
            <span className="text-text-muted text-[10px] font-bold">U</span>
          </div>
        )}
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.08em]">
          {isAI ? "trad" : "You"}
        </span>
      </div>
      <div className={`text-[13.5px] leading-[1.65] pl-7 ${isAI ? "text-text-secondary" : "text-text"}`}>
        <Streamdown
          plugins={sdPlugins}
          animated={{ animation: "blurIn", duration: 200, easing: "ease-out" }}
          isAnimating={!!msg.isStreaming}
        >
          {msg.content}
        </Streamdown>
      </div>
    </div>
  );
}

/* ── Live Thinking Bubble ─────────────────────────────────── */

function ThinkingBubble({ text, endRef }: { text: string; endRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-5 h-5 rounded-md bg-violet-500/15 flex items-center justify-center">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-violet-400 animate-pulse">
            <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 3v2.5L6.5 7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-[10px] font-bold text-violet-400/70 uppercase tracking-[0.08em]">Thinking…</span>
      </div>
      <div className="text-[12.5px] leading-[1.7] text-violet-300/60 max-h-32 overflow-y-auto border-l-2 border-violet-400/15 pl-3.5 ml-2.5">
        <Streamdown
          animated={{ animation: "blurIn", duration: 150, easing: "ease-out" }}
          isAnimating={true}
        >
          {text.slice(-800)}
        </Streamdown>
        <div ref={endRef} />
      </div>
    </div>
  );
}

/* ── Strategy Code View ───────────────────────────────────── */

function StrategyCodeView({ code: stratCode }: { code: string }) {
  if (!stratCode) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Strategy code will appear here after you describe your strategy.
      </div>
    );
  }
  const md = "```typescript\n" + stratCode + "\n```";
  return (
    <div className="p-5 animate-fade-in max-h-[calc(100vh-100px)] overflow-y-auto">
      <Streamdown plugins={sdPlugins} mode="static">{md}</Streamdown>
    </div>
  );
}

/* ── Spec JSON View ───────────────────────────────────────── */

function SpecJsonView({ spec }: { spec: Spec | null }) {
  const json = spec ? JSON.stringify(spec, null, 2) : "// No spec generated yet";
  const md = "```json\n" + json + "\n```";
  return (
    <div className="p-5 animate-fade-in max-h-[calc(100vh-100px)] overflow-y-auto">
      <Streamdown plugins={sdPlugins} mode="static">{md}</Streamdown>
    </div>
  );
}

/* ── Shared sub-components ────────────────────────────────── */

function EmptyPreview() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-10 text-center animate-fade-in">
      <div className="w-16 h-16 rounded-2xl bg-gold/[0.08] border border-gold/10 flex items-center justify-center mb-6">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-gold">
          <path d="M14 3v22M3 14h22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <rect x="6" y="6" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-text mb-2">No strategy yet</h3>
      <p className="text-text-muted text-sm max-w-xs leading-relaxed">
        Describe your strategy in the chat and watch the dashboard appear in real-time.
      </p>
    </div>
  );
}

function TabBtn({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${
        active ? "bg-surface-3 text-text shadow-sm" : "text-text-muted hover:text-text-secondary"
      }`}
    >{children}</button>
  );
}
