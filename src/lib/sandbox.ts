/**
 * Strategy sandbox — sandboxed coding environment for LLM strategy generation.
 *
 * Uses just-bash for an in-memory virtual filesystem and bash-tool for AI SDK
 * compatible tools (bash, readFile, writeFile). Includes custom commands:
 *   - `lint`       — TypeScript syntax checking via Bun's transpiler
 *   - `robinpump`  — comprehensive CLI for exploring RobinPump market data
 *   - `trad`       — CLI for introspecting the local Trad server (strategies, wallet, delegate)
 */

import { Bash, defineCommand } from "just-bash";
import { createBashTool } from "bash-tool";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { robinpumpCommand } from "./robinpump-cli";
import { tradCommand } from "./trad-cli";

// Load api.d.ts once at module scope — the type definitions that go into every sandbox
const API_TYPES = readFileSync(resolve(import.meta.dir, "api-types.d.ts"), "utf-8");

const DEFAULT_STRATEGY = [
  "// Strategy: Untitled",
  "// Exchange: robinpump",
  "// Description: ",
  "",
  "async function main(api: StrategyAPI) {",
  "  // Your strategy here",
  '  api.schedule("5m");',
  "}",
  "",
].join("\n");

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "ES2022",
      noEmit: true,
    },
    include: ["*.ts"],
  },
  null,
  2,
);

// Custom lint command — uses Bun's transpiler to catch syntax errors
const lintCommand = defineCommand("lint", async (args, ctx) => {
  const filePath = args[0] ?? "main.ts";
  const fullPath = filePath.startsWith("/") ? filePath : resolve(ctx.cwd, filePath);
  try {
    const content = await ctx.fs.readFile(fullPath, "utf-8");
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    transpiler.transformSync(content);
    return {
      stdout: `✓ ${filePath}: no syntax errors\n`,
      stderr: "",
      exitCode: 0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      stdout: "",
      stderr: `✗ ${filePath}: ${msg}\n`,
      exitCode: 1,
    };
  }
});

/**
 * Create a sandboxed coding environment for strategy generation.
 *
 * Returns AI SDK-compatible tools (bash, readFile, writeFile) and a sandbox
 * handle for reading files after tool execution completes.
 *
 * @param existingCode  Optional existing strategy code to pre-populate main.ts
 */
export async function createStrategySandbox(existingCode?: string) {
  const bash = new Bash({
    customCommands: [lintCommand, robinpumpCommand, tradCommand],
    cwd: "/home/user",
    defenseInDepth: true,
    executionLimits: {
      maxCallDepth: 80,
      maxCommandCount: 2500,
      maxLoopIterations: 2500,
      maxAwkIterations: 2500,
      maxSedIterations: 2500,
      maxJqIterations: 2500,
      maxGlobOperations: 50_000,
      maxStringLength: 2_000_000,
      maxArrayElements: 50_000,
      maxHeredocSize: 1_000_000,
      maxSubstitutionDepth: 30,
    },
    network: {
      // Allow curl for external price APIs the AI may want to query
      allowedUrlPrefixes: ["https://api.coinbase.com/"],
      allowedMethods: ["GET", "HEAD"],
      timeoutMs: 10_000,
      maxRedirects: 5,
      maxResponseSize: 1_000_000,
    },
  });

  const mainTs =
    existingCode !== undefined && existingCode !== "" ? existingCode : DEFAULT_STRATEGY;

  const { tools, sandbox } = await createBashTool({
    sandbox: bash,
    destination: "/home/user",
    maxOutputLength: 12_000,
    extraInstructions: [
      "Custom commands:",
      "  lint <file>                      # TypeScript syntax check (Bun transpiler)",
      "  robinpump <cmd> [...]             # RobinPump market data (JSON output)",
      "  trad <cmd> [...]                  # Trad server introspection (JSON output)",
      "",
      "Tip: bash stdout/stderr are truncated (~12KB). For large JSON, redirect to a file:",
      "  trad strategies get <id> --all > strategy.json",
      "  # then read it with readFile or `cat strategy.json`",
    ].join("\n"),
    files: {
      "api.d.ts": API_TYPES,
      "main.ts": mainTs,
      "tsconfig.json": TSCONFIG,
    },
  });

  return { tools, sandbox };
}
