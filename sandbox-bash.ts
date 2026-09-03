/**
 * Sandboxed read-only bash for review/explore child sessions.
 *
 * One tool replaces the former read/grep/find/ls allowlist plus the git
 * tool's policy table: a just-bash interpreter over a composed filesystem
 * (see createSandboxFs), with just-git providing git inside the sandbox.
 * Read-only is enforced at the capability layer — see DESIGN.md.
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

import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Bash, InMemoryFs, MountableFs, OverlayFs, type ExecResult } from "just-bash";
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
  /^(EROFS|EACCES|EPERM|ENOENT|EFBIG|ENOSPC|EISDIR|ENOTDIR|ELOOP|ENOTEMPTY|EEXIST|EINVAL|EBUSY|EXDEV|EIO)\b/;

function truncateOutput(output: string): string {
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
    "Run a command in a sandboxed, read-only bash environment. " +
    "The working directory is the project root (mounted at /repo); use relative paths with forward slashes. " +
    "Standard utilities are available (grep, find, sed, awk, head, tail, sort, uniq, wc, cat, ls, ...) " +
    "plus git for repository inspection (log, diff, show, blame, grep, ls-files, branch/tag listing; " +
    "note: git status is slow in large repos — prefer the targeted commands). " +
    "The environment has no network access and the project directory is read-only by design: all writes to it fail. " +
    "Paths outside /repo (like /tmp) are in-memory scratch, discarded after each call. " +
    "Each call runs in a fresh shell — cd and environment variables do not persist between calls; " +
    "use compound commands (cd dir && command) for multi-step work.",
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
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const bash = new Bash({
      fs: createSandboxFs(path.resolve(ctx.cwd)),
      cwd: MOUNT_POINT,
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

async function execSafely(
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
