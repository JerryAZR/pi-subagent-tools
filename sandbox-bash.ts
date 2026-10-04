/**
 * Sandboxed read-only bash for review/explore child sessions.
 *
 * One tool replaces the former read/grep/find/ls allowlist plus the git
 * tool's policy table: a just-bash interpreter over a composed filesystem
 * (see computeTopology), with just-git providing git inside the sandbox.
 * Read-only is enforced at the capability layer — see DESIGN.md.
 *
 * Mounts are REAL-LAYOUT: on posix, $HOME at its own path (plus the
 * project root when the cwd is outside home — read-only agents may read
 * other projects); on win32, every existing drive at MSYS form
 * ("C:\" -> "/c"). Sandbox paths therefore match host paths one-to-one,
 * so a path printed by bash works verbatim with the read tool and vice
 * versa. Everything outside the mounts is per-call in-memory scratch
 * (/dev/null, /tmp) that evaporates with the interpreter.
 *
 * The `disabled` git list below is UX only (clean "not available" errors
 * for pure mutators); enforcement is the read-only filesystem. Dual-purpose
 * verbs (branch, tag, stash, config, remote, worktree) stay enabled so
 * their read modes work; their write modes fail at the filesystem.
 *
 * Each call runs in a freshly constructed interpreter: per-call
 * construction is the statelessness guarantee, and it avoids any
 * shared-state questions between parallel children.
 */

import { existsSync, realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Bash, InMemoryFs, MountableFs, OverlayFs, type ExecResult } from "@jerryan/just-bash";
import { createGit, type GitCommandName } from "just-git";

/** Pure-mutator git verbs, disabled for clean UX errors. FS enforces the rest. */
const DISABLED_GIT: GitCommandName[] = [
  "init",
  "add",
  "commit",
  "checkout",
  "switch",
  "restore",
  "reset",
  "merge",
  "cherry-pick",
  "revert",
  "rebase",
  "mv",
  "rm",
  "clean",
  "bisect",
  "gc",
  "repack",
];

// ---------------------------------------------------------------------------
// Real-layout mount topology
// ---------------------------------------------------------------------------

type Platform = "win32" | "posix";
const PLATFORM: Platform = process.platform === "win32" ? "win32" : "posix";

function toSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Canonical on-disk spelling (symlinks, casing); falls back to the input. */
function canonicalize(p: string): string {
  try {
    const real = realpathSync.native(p);
    // Strip Windows extended-length prefixes so paths stay comparable.
    if (real.startsWith("\\\\?\\UNC\\")) return `\\${real.slice(8)}`;
    if (real.startsWith("\\\\?\\")) return real.slice(4);
    return real;
  } catch {
    return p;
  }
}

/**
 * Virtual mount point for a host root: posix roots map to themselves;
 * win32 roots map to MSYS form ("C:\Users\jerry" -> "/c/Users/jerry").
 * One path form is therefore understood by both the sandbox and pi's
 * native tools (pi's native shell on Windows is an MSYS-family bash).
 */
export function virtualMountPointFor(hostRoot: string, platform: Platform): string {
  const normalized = toSlashes(hostRoot);
  if (platform !== "win32") return normalized;
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!drive) return normalized; // UNC
  const rest = drive[2]!.replace(/\/+$/, "");
  return `/${drive[1]!.toLowerCase()}${rest ? `/${rest}` : ""}`;
}

/** Boundary-aware prefix check; slash-normalized, case-insensitive on win32. */
function isWithin(root: string, child: string, platform: Platform): boolean {
  const form = (p: string) => {
    let out = toSlashes(p);
    while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
    return platform === "win32" ? out.toLowerCase() : out;
  };
  const r = form(root);
  const c = form(child);
  return c === r || c.startsWith(`${r}/`);
}

/**
 * Resolve candidate host roots to a minimal, non-overlapping mount set
 * (overlapping mounts are rejected by MountableFs). "home" and "cwd" are
 * just candidates — neither is special. For each candidate, in order:
 *  (1) "/" is dropped (a read-only overlay at the fs root would shadow
 *      the scratch /dev/null and /tmp; MountableFs rejects it anyway),
 *  (2) a candidate within an already-kept root is dropped,
 *  (3) a candidate that CONTAINS kept roots replaces them.
 */
export function resolveMountRoots(candidates: string[], platform: Platform = PLATFORM): string[] {
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (toSlashes(candidate) === "/") continue; // (1)
    if (roots.some((root) => isWithin(root, candidate, platform))) continue; // (2)
    for (let i = roots.length - 1; i >= 0; i--) {
      if (isWithin(candidate, roots[i]!, platform)) roots.splice(i, 1); // (3)
    }
    roots.push(candidate);
  }
  return roots;
}

/** Existing drive roots ("C:\", "D:\", ...); A/B skipped (floppy probes hang). */
function probeWindowsDrives(): string[] {
  const drives: string[] = [];
  for (let code = 67; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (existsSync(root)) drives.push(root);
  }
  return drives;
}

// Probing drives touches every letter (a disconnected mapped drive can stall
// for seconds), so it happens once per process, not per tool call. Node has
// no drive-list API; the npm "list-drives" alternatives all spawn
// wmic/powershell, which is worse per call than this probe.
let cachedWindowsDrives: string[] | undefined;
function windowsDrives(): string[] {
  return (cachedWindowsDrives ??= probeWindowsDrives());
}

export interface SandboxTopology {
  mounts: { at: string; root: string }[];
  virtualCwd: string;
  virtualHome: string;
  /** Host absolute path -> virtual vfs path, or null when under no mount. */
  hostToVirtual(hostPath: string): string | null;
}

export function computeTopology(
  cwdInput: string,
  homeInput: string,
  options?: { platform?: Platform; drives?: string[]; canonicalize?: (p: string) => string },
): SandboxTopology {
  const platform = options?.platform ?? PLATFORM;
  const canon = options?.canonicalize ?? canonicalize;
  const cwd = canon(cwdInput);
  const home = canon(homeInput);
  // win32: home is of course on one of the drives, so only cwd is worth
  // adding — and only matters for a UNC working directory, which no drive
  // letter covers.
  const spelled =
    platform === "win32" ? [...(options?.drives ?? windowsDrives()), cwdInput] : [homeInput, cwdInput];
  // Mounts are string-matched, so a symlinked path must be mounted under
  // BOTH its spelled and canonical forms (macOS /var -> /private/var
  // firmlinks) — otherwise a path typed in the spelled form misses the
  // mount while pi's read tool (host-resolved) sees the file fine.
  const candidates = [...spelled, ...spelled.map(canon)];
  const mounts = resolveMountRoots(candidates, platform).map((root) => ({
    at: virtualMountPointFor(root, platform),
    root,
  }));
  const hostToVirtual = (hostPath: string): string | null => {
    const canonical = canon(hostPath);
    let best: { at: string; root: string } | null = null;
    for (const mount of mounts) {
      if (isWithin(mount.root, canonical, platform) && (!best || mount.root.length > best.root.length)) {
        best = mount;
      }
    }
    if (!best) return null;
    const rel = toSlashes(
      (platform === "win32" ? path.win32 : path.posix).relative(best.root, canonical),
    );
    return rel ? path.posix.join(best.at, rel) : best.at;
  };
  return {
    mounts,
    virtualCwd: hostToVirtual(cwd) ?? "/",
    virtualHome: hostToVirtual(home) ?? "/",
    hostToVirtual,
  };
}

/**
 * Compose the sandbox filesystem: real-layout read-only overlays over a
 * writable in-memory base. The base provides working /dev/null (stderr
 * silencing is a core shell idiom; on a real read-only mount the device
 * still works) and per-call in-memory scratch (/tmp, ...) that evaporates
 * with the interpreter. Note MountableFs strips the mount prefix before
 * delegating, so the inner OverlayFs mounts at "/".
 *
 * allowSymlinks: with the default (false) any real-FS path traversing a
 * symlink is rejected — fine for a project-only mount, but home is full
 * of intentional symlinks (stow/chezmoi dotfiles, ~/.config, pnpm
 * node_modules). Read-only enforcement is unaffected (writes fail with
 * EROFS either way) and there is no confidentiality boundary to protect:
 * the read tool is unrestricted.
 */
export function createSandboxFs(mounts: { at: string; root: string }[]): MountableFs {
  const fs = new MountableFs({ base: new InMemoryFs() });
  for (const mount of mounts) {
    try {
      fs.mount(
        mount.at,
        new OverlayFs({ root: mount.root, mountPoint: "/", readOnly: true, allowSymlinks: true }),
      );
    } catch {
      // A cached drive that vanished since the probe (USB pulled, mapped
      // drive dropped) must not brick every call for the process lifetime.
    }
  }
  return fs;
}

const MAX_OUTPUT_CHARS = 50_000;
const MAX_OUTPUT_LINES = 2_000;

/**
 * Filesystem-style error codes the sandbox can raise. just-bash reports
 * command-level failures (touch, rm) as exit codes, but interpreter-level
 * failures — output redirections write through the interpreter's own FS
 * path — REJECT the exec promise with these. Both shapes mean the same
 * thing to the caller: the command failed. Anything outside this taxonomy
 * is a genuine interpreter bug and is rethrown, loudly.
 */
const FS_ERROR_PATTERN =
  /^(EROFS|EACCES|EPERM|ENOENT|EFBIG|ENOSPC|EISDIR|ENOTDIR|ELOOP|ENOTEMPTY|EEXIST|EINVAL|EBUSY|EXDEV|EIO|ENAMETOOLONG|EMFILE|ENFILE|EPIPE)\b/;

export function truncateOutput(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES && output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  const kept = lines.slice(0, MAX_OUTPUT_LINES).join("\n").slice(0, MAX_OUTPUT_CHARS);
  const keptLines = kept.split("\n").length;
  return `${kept}\n\n[output truncated: showing ${keptLines} lines, ${kept.length} chars]`;
}

export const sandboxBashTool = defineTool({
  name: "bash",
  label: "bash (read-only)",
  description:
    "Execute a bash command in a sandboxed, read-only filesystem (standard utilities plus git; no network; writes to real paths fail by design; absolute host paths work verbatim). " +
    "Returns stdout and stderr. Output is truncated to 2000 lines or 50KB (whichever is hit first). " +
    "Each call runs in a fresh shell — cd and environment variables do not persist between calls.",
  promptSnippet: "Run a command in the read-only sandboxed shell",
  promptGuidelines: ["Use bash for searching, file inspection, and git history."],
  parameters: Type.Object({
    command: Type.String({
      description:
        "The command line to execute (e.g. 'grep -rn \"pattern\" src/', 'git log --oneline -10', 'find . -name \"*.ts\" | head').",
    }),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const topology = computeTopology(path.resolve(ctx.cwd), os.homedir());
    const bash = new Bash({
      fs: createSandboxFs(topology.mounts),
      cwd: topology.virtualCwd,
      env: { HOME: topology.virtualHome },
      // Deliberately NO python here: a bare `python3` on PATH implies the
      // native interpreter (project env, pip). Sandboxed stdlib-only CPython
      // is a separate tool with that contract made explicit — see
      // sandbox-python.ts.
      customCommands: [createGit({ network: false, disabled: DISABLED_GIT })],
    });
    const result = await execSafely(bash, params.command, signal);
    const stdout = result.stdout;
    const stderr = result.stderr;
    const combined =
      stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr || "(no output)";
    const text =
      result.exitCode === 0
        ? truncateOutput(combined)
        : `Exit code ${result.exitCode}\n${truncateOutput(combined)}`;
    return {
      content: [{ type: "text" as const, text }],
      details: { exitCode: result.exitCode },
    };
  },
});

export async function execSafely(
  bash: Bash,
  command: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  try {
    return await bash.exec(command, { signal });
  } catch (err: any) {
    if (FS_ERROR_PATTERN.test(err?.message ?? "")) {
      return { stdout: "", stderr: err.message, exitCode: 1 };
    }
    throw err;
  }
}
