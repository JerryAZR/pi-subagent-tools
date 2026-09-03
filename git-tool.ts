/**
 * Read-only git tool for review/explore subagents.
 *
 * Provided as a customTool so read-only agents can inspect repository
 * history without a shell. Read-only is enforced as per-subcommand policy
 * (data), not a single verb check: each subcommand declares the flags that
 * would make it mutating, and whether positional arguments are allowed
 * ("git branch <name>" creates a branch).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

interface GitPolicy {
  /** Flags that make the subcommand mutating. Matches the token, or the part before "=". */
  forbiddenFlags?: string[];
  /** Whether positional (non-flag) arguments are allowed. Default: true. */
  allowPositionals?: boolean;
}

const READONLY_GIT: Record<string, GitPolicy> = {
  log: { forbiddenFlags: ["--output"] },
  diff: { forbiddenFlags: ["--output"] },
  show: { forbiddenFlags: ["--output"] },
  status: {},
  branch: {
    // A positional arg creates/renames a branch; these flags delete, move,
    // copy, force, or (un)set upstreams.
    allowPositionals: false,
    forbiddenFlags: [
      "-d", "-D", "-m", "-M", "-c", "-C", "-f", "-u",
      "--delete", "--move", "--copy", "--force",
      "--set-upstream-to", "--unset-upstream", "--edit-description",
    ],
  },
  blame: {},
  "rev-parse": {},
  "rev-list": {},
  "ls-tree": {},
  "ls-files": {},
  grep: {},
  describe: {},
  shortlog: {},
  whatchanged: {},
};

/**
 * Validate a git argument vector against the read-only policy.
 * Returns an error message, or null if the invocation is read-only.
 * Exported for tests.
 */
export function gitPolicyError(args: string[]): string | null {
  const policy = READONLY_GIT[args[0]];
  if (!policy) {
    return `git ${args[0] || "(no command)"} is not allowed (read-only commands only).`;
  }
  const allowPositional = policy.allowPositionals !== false;
  for (const token of args.slice(1)) {
    if (token.startsWith("-")) {
      const flag = token.split("=")[0];
      if (policy.forbiddenFlags?.includes(flag)) {
        return `git ${args[0]} ${flag} is not read-only.`;
      }
    } else if (!allowPositional) {
      return `git ${args[0]} with arguments is not read-only.`;
    }
  }
  return null;
}

export const gitTool = defineTool({
  name: "git",
  label: "Git",
  description:
    "Run read-only git commands (log, diff, status, show, branch, blame).",
  promptSnippet: "Run a read-only git command",
  parameters: Type.Object({
    command: Type.String({
      description:
        "Git command with arguments (e.g. 'log --oneline -10', 'diff HEAD~1', 'status').",
    }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    // Errors are reported by throwing (the agent loop marks the result).
    const args = params.command.trim().split(/\s+/);
    const policyError = gitPolicyError(args);
    if (policyError) throw new Error(policyError);
    try {
      // Async: subagents run in-process, so a blocking exec would freeze
      // the parent session's event loop (and TUI) for the duration.
      const { stdout } = await execFileAsync("git", args, {
        cwd: ctx.cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });
      return { content: [{ type: "text" as const, text: stdout }], details: {} };
    } catch (err: any) {
      throw new Error(`git ${params.command}\n\n${err.stderr || err.message}`);
    }
  },
});
