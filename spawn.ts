/**
 * Shared subagent spawn logic.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { UsageStats } from "./tui.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnOptions {
  cwd: string;
  task: string;
  skills?: string[];
  allowedTools?: string[];
  extensionFile?: string;
  systemPromptFile?: string;
  childRole?: "review" | "explore" | "delegate";
  signal?: AbortSignal;
  onUpdate?: (result: AgentToolResult) => void;
}

export interface SpawnResult {
  output: string;
  isError: boolean;
  exitCode: number;
  tokens?: { input: number; output: number; total: number };
  turns: number;
  toolCalls: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const READONLY_TOOLS = ["read", "grep", "find", "ls", "git"];

// ---------------------------------------------------------------------------
// Pi process detection
// ---------------------------------------------------------------------------

export function getPiInvocation(args: string[]): {
  command: string;
  args: string[];
} {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const npmGlobalRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules")
    : process.env.HOME
      ? path.join(process.env.HOME, ".npm-global", "node_modules")
      : null;
  if (npmGlobalRoot) {
    const cliPath = path.join(npmGlobalRoot, "@earendil-works", "pi-coding-agent", "dist", "cli.js");
    if (fs.existsSync(cliPath)) {
      return { command: process.execPath, args: [cliPath, ...args] };
    }
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

// ---------------------------------------------------------------------------
// Argument construction
// ---------------------------------------------------------------------------

export function buildSpawnArgs(opts: SpawnOptions): string[] {
  const args: string[] = ["--mode", "json", "-p"];

  args.push("--no-session");

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push("--tools", opts.allowedTools.join(","));
  }

  for (const skill of opts.skills ?? []) {
    args.push("--skill", skill);
  }

  if (opts.extensionFile) {
    args.push("--extension", opts.extensionFile);
  }

  if (opts.systemPromptFile) {
    args.push("--append-system-prompt", opts.systemPromptFile);
  }

  args.push(opts.task);
  return args;
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text ?? "";
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Main spawn function
// ---------------------------------------------------------------------------

export async function runSubagent(opts: SpawnOptions): Promise<SpawnResult> {
  const args = buildSpawnArgs(opts);
  const invocation = getPiInvocation(args);

  let buffer = "";
  let stderr = "";
  let spawnError: string | null = null;
  const messages: Message[] = [];
  let turnCount = 0;
  let tokens = { input: 0, output: 0, total: 0 };
  const toolCallNames: string[] = [];
  const env: Record<string, string> = { ...process.env };
  if (opts.childRole) env.PI_SUBAGENT_TOOLS_ROLE = opts.childRole;

  const startTime = Date.now();

  let previousTurnsText = "";
  let streamText = "";

  const displayText = () => previousTurnsText + (previousTurnsText && streamText ? "\n" : "") + streamText;
  const proc = spawn(invocation.command, invocation.args, {
    cwd: opts.cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });

  let lastUpdate = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const UPDATE_INTERVAL = 200;

  const doUpdate = () => {
    if (!opts.onUpdate) return;
    const bottom = displayText();
    opts.onUpdate({
      content: [{ type: "text", text: bottom }],
      details: { usage: { turns: turnCount, input: tokens.input, output: tokens.output, total: tokens.total, durationMs: Date.now() - startTime } satisfies UsageStats, toolCalls: [...toolCallNames] },
    });
  };

  const fireUpdate = () => {
    if (!opts.onUpdate) return;
    const now = Date.now();
    if (now - lastUpdate >= UPDATE_INTERVAL) {
      lastUpdate = now;
      doUpdate();
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        lastUpdate = Date.now();
        doUpdate();
      }, UPDATE_INTERVAL - (now - lastUpdate));
    }
  };

  const processLine = (line: string) => {
    if (!line.trim()) return;
    let event: any;
    try { event = JSON.parse(line); } catch { return; }

    // Per-token streaming: show text on every message_update
    if (event.type === "message_update" && event.message) {
      const text = (event.message.content ?? [])
        .filter((c: any) => c.type === "text" || c.type === "thinking")
        .map((c: any) => c[c.type]).join("");
      streamText = text;
      fireUpdate();
    }

    if (event.type === "message_end" && event.message) {
      const msg = event.message as Message & { content: any[] };
      messages.push(msg);
      if (msg.role === "assistant") {
        turnCount++;
        if (msg.usage) {
          tokens.input += msg.usage.input || 0;
          tokens.output += msg.usage.output || 0;
          tokens.total += msg.usage.totalTokens || 0;
        }
        if (streamText) {
          previousTurnsText = previousTurnsText ? previousTurnsText + "\n" + streamText : streamText;
          streamText = "";
        } else {
          const text = (msg.content ?? []).filter((c: any) => c.type === "text" || c.type === "thinking").map((c: any) => c[c.type]).join("");
          if (text) previousTurnsText = previousTurnsText ? previousTurnsText + "\n" + text : text;
        }
        for (const tc of (msg.content ?? []).filter((c: any) => c.type === "toolCall")) {
          toolCallNames.push(tc.name);
          const parts = [`▸ ${tc.name}`];
          if (tc.input) {
            for (const [k, v] of Object.entries(tc.input)) {
              const val = typeof v === "string" ? v : JSON.stringify(v);
              const short = val.length > 40 ? val.slice(0, 37) + "..." : val;
              parts.push(`${k}=${short}`);
            }
          }
          let line = parts.join(" ");
          if (line.length > 80) line = line.slice(0, 77) + "...";
          previousTurnsText = previousTurnsText ? previousTurnsText + `\n${line}` : line;
        }
        fireUpdate();
      }
    }
  };

  const exitCode = await new Promise<number>((resolve) => {
    const killProc = () => { proc.kill("SIGTERM"); setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000); };
    if (opts.signal) {
      if (opts.signal.aborted) killProc();
      else opts.signal.addEventListener("abort", killProc, { once: true });
    }
    proc.stdout.on("data", (data) => { buffer += data.toString(); const lines = buffer.split("\n"); buffer = lines.pop() || ""; for (const line of lines) processLine(line); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => { if (opts.signal) opts.signal.removeEventListener("abort", killProc); if (buffer.trim()) processLine(buffer); resolve(code ?? 0); });
    proc.on("error", (err) => { if (opts.signal) opts.signal.removeEventListener("abort", killProc); spawnError = err.message; resolve(1); });
  });

  if (opts.signal?.aborted) return { output: "Subagent was aborted", isError: true, exitCode: 1, tokens, turns: turnCount, toolCalls: toolCallNames, durationMs: Date.now() - startTime };
  if (spawnError) return { output: `Failed to start subagent: ${spawnError}`, isError: true, exitCode: 1, tokens, turns: turnCount, toolCalls: toolCallNames, durationMs: Date.now() - startTime };
  if (exitCode !== 0) return { output: stderr || `Subagent exited with code ${exitCode}`, isError: true, exitCode, tokens, turns: turnCount, toolCalls: toolCallNames, durationMs: Date.now() - startTime };

  const output = getFinalOutput(messages);
  return { output: output || "(no output)", isError: false, exitCode: 0, tokens, turns: turnCount, toolCalls: toolCallNames, durationMs: Date.now() - startTime };
}
