/**
 * Sandboxed "python" tool for review/explore child sessions: stdlib-only
 * CPython (just-bash's WASM build) for dependency-free scripting and data
 * processing, over the same read-only real-layout filesystem as the
 * sandboxed bash (see sandbox-bash.ts).
 *
 * This is a SEPARATE tool on purpose, mirroring pi-overlayfs's design: a
 * bare `python3` on PATH inside bash implies the native interpreter
 * (project environment, pip, third-party packages) and the WASM CPython
 * is none of that — exposing it as a shell command sells a capability
 * that isn't there. The dedicated tool makes the stdlib-only contract
 * explicit in its description. The bash sandbox therefore has no
 * `python3`; scripts that need the real environment cannot run in a
 * read-only child at all (fail-closed, same as everything else).
 *
 * Per call a fresh interpreter and filesystem are constructed — the same
 * statelessness guarantee as the sandboxed bash. Inline code is staged to
 * a /tmp scratch file (in-memory, gone with the call).
 */

import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Bash, type ExecResult } from "@jerryan/just-bash";
import {
  computeTopology,
  createSandboxFs,
  execSafely,
  truncateOutput,
} from "./sandbox-bash.ts";

const DEFAULT_TIMEOUT_SECONDS = 300;

/** Scratch path inline code is staged at (per-call fs — no collision risk). */
const STAGED_SCRIPT = "/tmp/.pi-py-script.py";

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const UNC_PATH = /^[\\/]{2}/;

/** Single-quote escape for embedding an argument in a shell command line. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve a model-typed path to a virtual vfs path. Real-layout mounts
 * make host and virtual forms coincide, so: relative paths join the
 * project root; absolute paths map through the mounts when covered and
 * pass through unchanged otherwise (scratch like /tmp, or simply
 * invisible to the sandbox).
 */
function toVirtual(
  input: string,
  virtualCwd: string,
  hostToVirtual: (hostPath: string) => string | null,
): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("/") || WINDOWS_ABSOLUTE.test(trimmed) || UNC_PATH.test(trimmed)) {
    return hostToVirtual(trimmed) ?? trimmed.replace(/\\/g, "/");
  }
  return path.posix.normalize(path.posix.join(virtualCwd, trimmed));
}

export const sandboxPythonTool = defineTool({
  name: "python",
  label: "python (stdlib, read-only)",
  description:
    "Run Python 3 (standard library only) for scripting and data processing, in the same read-only sandbox as bash. " +
    "Provide exactly one of code (inline source) or path (a script). " +
    "This is not the project's Python environment: third-party packages and pip are unavailable. " +
    "Output is truncated to 2000 lines or 50KB (whichever is hit first).",
  promptSnippet: "Run Python 3 scripts (standard library only)",
  promptGuidelines: ["Use python for dependency-free scripting and data analysis."],
  parameters: Type.Object({
    code: Type.Optional(Type.String({ description: "Inline Python 3 source to execute" })),
    path: Type.Optional(Type.String({ description: "Path to a Python script (absolute or relative to the project)" })),
    args: Type.Optional(Type.Array(Type.String(), { description: "Arguments passed to the script" })),
    timeout: Type.Optional(
      Type.Number({ description: `Timeout in seconds (optional, defaults to ${DEFAULT_TIMEOUT_SECONDS})` }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const hasCode = typeof params.code === "string" && params.code.length > 0;
    const hasPath = typeof params.path === "string" && params.path.trim().length > 0;
    if (hasCode === hasPath) {
      throw new Error("python: exactly one of 'code' or 'path' is required");
    }
    const requested = params.timeout;
    // Clamp to [1, 3600]: NaN/0/negative would misbehave in setTimeout.
    const timeoutSeconds =
      typeof requested === "number" && Number.isFinite(requested)
        ? Math.min(Math.max(Math.floor(requested), 1), 3600)
        : DEFAULT_TIMEOUT_SECONDS;

    const topology = computeTopology(path.resolve(ctx.cwd), os.homedir());
    const fs = createSandboxFs(topology.mounts);
    const bash = new Bash({
      fs,
      cwd: topology.virtualCwd,
      env: { HOME: topology.virtualHome },
      python: true,
      // The interpreter's own caps (maxPythonTimeoutMs defaults to 30s,
      // maxExecutionTimeMs to 1h) must sit ABOVE this tool's timer so a
      // timeout surfaces as this tool's `timeout:N` error (via the abort
      // below) rather than a raw exit-124 the agent can't distinguish from
      // a script failure.
      executionLimits: {
        maxPythonTimeoutMs: timeoutSeconds * 1000 + 10_000,
        maxExecutionTimeMs: timeoutSeconds * 1000 + 15_000,
      },
    });

    // The CPython worker expects /tmp to exist in the vfs.
    await fs.mkdir("/tmp", { recursive: true });

    let scriptPath: string;
    if (hasCode) {
      scriptPath = STAGED_SCRIPT;
      await fs.writeFile(scriptPath, params.code as string, { encoding: "utf8" });
    } else {
      scriptPath = toVirtual(params.path as string, topology.virtualCwd, topology.hostToVirtual);
      if (!(await fs.exists(scriptPath))) {
        throw new Error(`python: script not found: ${params.path}`);
      }
    }

    const args = (params.args ?? []).map(shellQuote);
    const command = [`python3 ${shellQuote(scriptPath)}`, ...args].join(" ");

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    // A listener on an already-aborted signal never fires — check first.
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutSeconds * 1000);

    let result: ExecResult;
    try {
      result = await execSafely(bash, command, controller.signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (timedOut) {
      let detail = "";
      if (result!.stdout) detail += `\n${truncateOutput(result!.stdout)}`;
      if (result!.stderr) detail += `\n--- stderr ---\n${truncateOutput(result!.stderr)}`;
      throw new Error(`timeout:${timeoutSeconds}${detail}`);
    }

    const stdout = result!.stdout;
    const stderr = result!.stderr;
    const combined =
      stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr || "(no output)";
    const text =
      result!.exitCode === 0
        ? truncateOutput(combined)
        : `Exit code ${result!.exitCode}\n${truncateOutput(combined)}`;
    return {
      content: [{ type: "text" as const, text }],
      details: { exitCode: result!.exitCode },
    };
  },
});
