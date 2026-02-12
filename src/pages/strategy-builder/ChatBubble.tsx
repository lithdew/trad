import { useState, useRef, useEffect, type ComponentType } from "react";
import {
  type UIMessage,
  type UIMessagePart,
  type UIDataTypes,
  type UITools,
  isToolUIPart,
  getToolName,
} from "ai";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import "streamdown/styles.css";
import {
  Loader2,
  Terminal,
  FileText,
  Eye,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Minus,
  type LucideProps,
} from "lucide-react";
import { LiveReasoning } from "./LiveReasoning";
import { CollapsedReasoning } from "./CollapsedReasoning";

/* ── Streamdown config (only used for chat text, NOT tool output) ── */

const sdCodePlugin = createCodePlugin({
  themes: ["github-dark-high-contrast", "github-dark-high-contrast"],
});
const sdPlugins = { code: sdCodePlugin };

/* ── Tool invocation data (properly typed) ────────────────── */

interface ToolInvocation {
  toolName: string;
  state: "input-streaming" | "input-available" | "output-available" | "error" | string;
  input: Record<string, unknown> | undefined;
  output: Record<string, unknown> | string | undefined;
}

/* ── Part groups ──────────────────────────────────────────── */

interface ReasoningGroup {
  kind: "reasoning";
  text: string;
  hasStreaming: boolean;
}
interface TextGroup {
  kind: "text";
  text: string;
  isStreaming: boolean;
}
interface ToolGroup {
  kind: "tool";
  invocations: ToolInvocation[];
}

type PartGroup = ReasoningGroup | TextGroup | ToolGroup;

function extractToolInvocation(part: UIMessagePart<UIDataTypes, UITools>): ToolInvocation {
  const name = getToolName(part as Parameters<typeof getToolName>[0]);

  // Access the runtime object directly — AI SDK union types make typed access impractical
  const raw = part as Record<string, unknown>;

  let input: Record<string, unknown> | undefined;
  const rawInput = raw.input;
  if (rawInput !== null && rawInput !== undefined && typeof rawInput === "object") {
    input = rawInput as Record<string, unknown>;
  }

  let output: Record<string, unknown> | string | undefined;
  const rawOutput = raw.output;
  if (typeof rawOutput === "string") {
    output = rawOutput;
  } else if (rawOutput !== null && rawOutput !== undefined && typeof rawOutput === "object") {
    output = rawOutput as Record<string, unknown>;
  }

  return {
    toolName: name,
    state: typeof raw.state === "string" ? raw.state : "input-available",
    input,
    output,
  };
}

function buildPartGroups(parts: UIMessage["parts"]): PartGroup[] {
  const groups: PartGroup[] = [];

  for (const part of parts) {
    if (part.type === "reasoning") {
      const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
      if (last !== undefined && last.kind === "reasoning") {
        last.text += part.text;
        if (part.state === "streaming") last.hasStreaming = true;
      } else {
        groups.push({
          kind: "reasoning",
          text: part.text,
          hasStreaming: part.state === "streaming",
        });
      }
    } else if (part.type === "text") {
      const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
      if (last !== undefined && last.kind === "text") {
        last.text += part.text;
        if (part.state === "streaming") last.isStreaming = true;
      } else {
        groups.push({ kind: "text", text: part.text, isStreaming: part.state === "streaming" });
      }
    } else if (isToolUIPart(part)) {
      const inv = extractToolInvocation(part);
      const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
      if (last !== undefined && last.kind === "tool") {
        last.invocations.push(inv);
      } else {
        groups.push({ kind: "tool", invocations: [inv] });
      }
    }
  }

  return groups;
}

function getMessageText(msg: UIMessage): string {
  let text = "";
  for (const part of msg.parts) {
    if (part.type === "text") text += part.text;
  }
  return text;
}

/* ── Chat Bubble ─────────────────────────────────────────── */

export function ChatBubble({
  msg,
  isLastAssistant,
  chatStatus,
}: {
  msg: UIMessage;
  isLastAssistant: boolean;
  chatStatus: string;
}) {
  const isStreaming = isLastAssistant && (chatStatus === "streaming" || chatStatus === "submitted");

  if (msg.role === "user") {
    return (
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <div className="size-5 rounded-md bg-muted flex items-center justify-center">
            <span className="text-muted-foreground text-[10px] font-bold">U</span>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            You
          </span>
        </div>
        <div className="text-[13.5px] leading-[1.65] pl-7 text-foreground">
          <Streamdown plugins={sdPlugins} mode="static">
            {getMessageText(msg)}
          </Streamdown>
        </div>
      </div>
    );
  }

  const groups = buildPartGroups(msg.parts);
  const hasAnyContent = groups.length > 0;

  return (
    <div className="space-y-3">
      {groups.map((group, i) => {
        if (group.kind === "reasoning") {
          return group.hasStreaming ? (
            <LiveReasoning key={i} text={group.text} />
          ) : (
            <CollapsedReasoning key={i} text={group.text} />
          );
        }
        if (group.kind === "text") {
          return (
            <div key={i}>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="size-5 rounded-md bg-primary/15 flex items-center justify-center">
                  <span className="font-display text-primary text-[10px]">t</span>
                </div>
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
                  trad
                </span>
              </div>
              <div className="text-[13.5px] leading-[1.65] pl-7 text-text-secondary">
                <Streamdown
                  plugins={sdPlugins}
                  animated={{ animation: "blurIn", duration: 200, easing: "ease-out" }}
                  isAnimating={group.isStreaming}
                >
                  {group.text}
                </Streamdown>
              </div>
            </div>
          );
        }
        if (group.kind === "tool") {
          return <ToolSteps key={i} invocations={group.invocations} />;
        }
        return null;
      })}

      {!hasAnyContent && isStreaming && (
        <div className="flex items-center gap-2">
          <div className="size-5 rounded-md bg-primary/15 flex items-center justify-center">
            <span className="font-display text-primary text-[10px]">t</span>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">
            trad
          </span>
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Tool Steps
   ═════════════════════════════════════════════════════════════ */

function ToolSteps({ invocations }: { invocations: ToolInvocation[] }) {
  return (
    <div className="pl-7 my-2 space-y-2">
      {invocations.map((inv, i) => (
        <ToolCard key={i} inv={inv} />
      ))}
    </div>
  );
}

function ToolCard({ inv }: { inv: ToolInvocation }) {
  const [collapsed, setCollapsed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const prevStateRef = useRef(inv.state);

  const done = inv.state === "output-available";
  const active = inv.state === "input-available";
  const preparing = inv.state === "input-streaming";
  const errored = inv.state === "error";

  // Auto-scroll into view when output first arrives
  useEffect(() => {
    if (prevStateRef.current !== inv.state && done && cardRef.current !== null) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    prevStateRef.current = inv.state;
  }, [inv.state, done]);

  const Icon = resolveIcon(inv.toolName);
  const action = resolveAction(inv.toolName);
  const target = resolveTarget(inv);
  const outputText = resolveOutput(inv);
  const hasOutput = outputText !== null;

  const borderColor = active
    ? "border-l-cyan-400 shadow-[inset_2px_0_8px_-4px_rgba(34,211,238,0.2)]"
    : errored
      ? "border-l-red-400"
      : done
        ? "border-l-emerald-400"
        : "border-l-foreground/10";

  const iconColor = active
    ? "text-cyan-400"
    : errored
      ? "text-red-400"
      : done
        ? "text-emerald-400"
        : "text-foreground/30";

  return (
    <div
      ref={cardRef}
      className={`border-l-2 ${borderColor} rounded-r-lg bg-[#09090c] overflow-hidden transition-all duration-300`}
    >
      {/* Header — always clickable */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-white/2 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronRight
          className={`size-3 text-foreground/30 transition-transform duration-200 shrink-0 ${collapsed ? "" : "rotate-90"}`}
        />

        {active ? (
          <Loader2 className="size-3.5 text-cyan-400 animate-spin shrink-0" />
        ) : (
          <Icon className={`size-3.5 shrink-0 ${iconColor}`} />
        )}

        <span
          className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-px rounded shrink-0 ${
            active
              ? "bg-cyan-400/10 text-cyan-400"
              : errored
                ? "bg-red-400/10 text-red-400"
                : done
                  ? "bg-emerald-400/8 text-emerald-400/80"
                  : "bg-foreground/5 text-foreground/30"
          }`}
        >
          {action}
        </span>

        <span
          className={`text-[12px] font-mono min-w-0 truncate ${
            active ? "text-cyan-200" : errored ? "text-red-200" : "text-foreground/70"
          }`}
        >
          {target}
        </span>

        <div className="ml-auto shrink-0 flex items-center gap-1.5">
          {preparing && <Loader2 className="size-3 text-foreground/20 animate-spin" />}
          {active && <span className="text-[9px] text-cyan-400/60 font-medium">running</span>}
          {done && !errored && <CheckCircle2 className="size-3.5 text-emerald-400/70" />}
          {errored && <XCircle className="size-3.5 text-red-400/70" />}
        </div>
      </div>

      {/* Output — plain <pre>, no Streamdown chrome */}
      {!collapsed && hasOutput && (
        <div className="px-3 pb-2.5">
          <pre
            className="font-mono text-[10.5px] leading-[1.7] whitespace-pre-wrap wrap-break-word
            bg-black/40 rounded-md px-3 py-2.5 max-h-52 overflow-y-auto overflow-x-hidden text-foreground/50"
          >
            {outputText}
          </pre>
        </div>
      )}

      {collapsed && hasOutput && (
        <div className="flex items-center gap-1.5 px-3 pb-2">
          <Minus className="size-3 text-foreground/15" />
          <span className="text-[10px] text-foreground/20 italic">output hidden</span>
        </div>
      )}
    </div>
  );
}

/* ── Resolvers (no `as` casts — typed guards) ─────────────── */

const ICON_MAP: Record<string, ComponentType<LucideProps>> = {
  bash: Terminal,
  readFile: Eye,
  read_file: Eye,
  writeFile: FileText,
  write_file: FileText,
};

function resolveIcon(toolName: string) {
  return ICON_MAP[toolName] ?? Terminal;
}

function resolveAction(toolName: string) {
  if (toolName === "bash") return "run";
  if (toolName === "readFile" || toolName === "read_file") return "read";
  if (toolName === "writeFile" || toolName === "write_file") return "write";
  return toolName;
}

function resolveTarget(inv: ToolInvocation) {
  const input = inv.input;
  if (input === undefined) return "";

  if (inv.toolName === "writeFile" || inv.toolName === "write_file") {
    const filePath = stringField(input, "path") ?? stringField(input, "filename");
    if (filePath === null) return "file";
    const name = filePath.split("/").pop() ?? filePath;
    const content = stringField(input, "content");
    if (content === null) return name;
    return `${name}  (${content.split("\n").length} lines)`;
  }

  if (inv.toolName === "readFile" || inv.toolName === "read_file") {
    const filePath = stringField(input, "path") ?? stringField(input, "filename");
    if (filePath === null) return "file";
    const name = filePath.split("/").pop() ?? filePath;
    const done = inv.state === "output-available";
    if (done) {
      const content =
        getOutputString(inv.output, "content") ??
        (typeof inv.output === "string" ? inv.output : null);
      if (content !== null) return `${name}  (${content.split("\n").length} lines)`;
    }
    return name;
  }

  if (inv.toolName === "bash") {
    return stringField(input, "command") ?? "command";
  }

  return "";
}

function resolveOutput(inv: ToolInvocation): string | null {
  const done = inv.state === "output-available";

  // ── Bash: stdout + stderr ──
  if (inv.toolName === "bash" && done) {
    if (typeof inv.output === "string") return inv.output;
    if (inv.output === undefined) return null;
    const stdout = stringField(inv.output, "stdout")?.trim() ?? "";
    const stderr = stringField(inv.output, "stderr")?.trim() ?? "";
    const parts: string[] = [];
    if (stdout !== "") parts.push(stdout);
    if (stderr !== "") parts.push(stderr);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  // ── Write: show written content ──
  if (inv.toolName === "writeFile" || inv.toolName === "write_file") {
    if (inv.input === undefined) return null;
    return stringField(inv.input, "content") ?? null;
  }

  // ── Read: show read content ──
  if ((inv.toolName === "readFile" || inv.toolName === "read_file") && done) {
    // Output can be { content: string } or a direct string
    if (typeof inv.output === "string") return inv.output;
    if (inv.output === undefined) return null;
    return stringField(inv.output, "content") ?? null;
  }

  return null;
}

/* ── Type-safe field accessors ────────────────────────────── */

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  return typeof val === "string" ? val : null;
}

function getOutputString(output: ToolInvocation["output"], key: string): string | null {
  if (output === undefined || typeof output === "string") return null;
  return stringField(output, key);
}
