/**
 * Sandboxed read-only bash for review/explore child sessions.
 *
 * One tool replaces the former read/grep/find/ls allowlist plus the git
 * tool's policy table: a just-bash interpreter over an OverlayFs mounted
 * read-only at the child's cwd, with just-git providing git inside the
 * sandbox.
 *
 * Read-only is enforced at the capability layer, not by inspecting
 * commands: the filesystem itself rejects every write (EROFS), and git's
 * network policy blocks remote operations. The `disabled` list below is
 * UX only — it produces clean "not available" errors for pure-mutator
 * git verbs instead of EROFS noise. Dual-purpose verbs (branch, tag,
 * stash, config, remote, worktree) stay enabled so their read modes work;
 * their write modes fail at the filesystem.
 *
 * Each call runs in a freshly constructed interpreter: no cwd, env, or
 * shell state persists between calls (just-bash resets state per exec
 * anyway; per-call construction additionally avoids any shared-state
 * questions between parallel children).
 */

import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Bash, InMemoryFs, MountableFs, OverlayFs } from "just-bash";
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

/** Mount point of the project root inside the sandbox. */
const MOUNT_POINT = "/repo";

/**
 * Compose the sandbox filesystem: the project root mounted read-only at
 * /repo over a writable in-memory base. The base provides working /dev/null
 * (stderr silencing is a core shell idiom; on a real read-only mount the
 * device still works) and per-call in-memory scratch (/tmp, ...) that
 * evaporates with the interpreter. Note MountableFs strips the mount
 * prefix before delegating, so the inner OverlayFs mounts at "/".
 */
function createSandboxFs(projectRoot: string): MountableFs {
  const fs = new MountableFs({ base: new InMemoryFs() });
  fs.mount(
    MOUNT_POINT,
    new OverlayFs({ root: projectRoot, mountPoint: "/", readOnly: true }),
  );
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
  /^(EROFS|EACCES|EPERM|ENOENT|EFBIG|ENOSPC|EISDIR|ENOTDIR|ELOOP|ENOTEMPTY|EEXIST|EINVAL|EBADF|EIO)\b/;

function truncate(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES && output.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  const kept = lines.slice(0, MAX_OUTPUT_LINES).join("\n").slice(0, MAX_OUTPUT_CHARS);
  return `${kept}\n\n[output truncated: showing first ${MAX_OUTPUT_LINES} lines / ${MAX_OUTPUT_CHARS} chars]`;
}

export const sandboxBashTool = defineTool({
  name: "bash",
  label: "bash (read-only)",
  description:
    "Run a command in a sandboxed, read-only bash environment. " +
    "The working directory is the project root (mounted at /repo); use relative paths with forward slashes. " +
    "Standard utilities are available (grep, find, sed, awk, head, tail, sort, uniq, wc, cat, ls, ...) " +
    "plus git for repository inspection (log, diff, show, blame, grep, ls-files, branch/tag listing, ...). " +
    "The environment has no network access and the project directory is read-only by design: all writes to it fail. " +
    "Paths outside /repo (like /tmp) are in-memory scratch, discarded after each call. " +
    "Each call runs in a fresh shell — cd and environment variables do not persist between calls; " +
    "use compound commands (cd dir && command) for multi-step work. " +
    "Note: git status is slow in large repositories — prefer targeted commands (git log, git diff, git show, git ls-files).",
  promptSnippet: "Run a command in the read-only sandboxed shell",
  promptGuidelines: [
    "Use bash for searching, file inspection, and git history — never attempt to modify files; all writes fail by design.",
  ],
  parameters: Type.Object({
    command: Type.String({
      description:
        "The command line to execute (e.g. 'grep -rn \"pattern\" src/', 'git log --oneline -10', 'find . -name \"*.ts\" | head').",
    }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const bash = new Bash({
      fs: createSandboxFs(path.resolve(ctx.cwd)),
      cwd: MOUNT_POINT,
      customCommands: [createGit({ network: false, disabled: DISABLED_GIT })],
    });
    const result = await execSafely(bash, params.command);
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const combined =
      stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr || "(no output)";
    const text =
      result.exitCode === 0
        ? truncate(combined)
        : `Exit code ${result.exitCode}\n${truncate(combined)}`;
    return {
      content: [{ type: "text" as const, text }],
      details: { exitCode: result.exitCode },
    };
  },
});

async function execSafely(
  bash: Bash,
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    return await bash.exec(command);
  } catch (err: any) {
    if (FS_ERROR_PATTERN.test(err?.message ?? "")) {
      return { stdout: "", stderr: err.message, exitCode: 1 };
    }
    throw err;
  }
}
