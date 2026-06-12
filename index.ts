/**
 * pi-subagent-tools — Specialized subagent delegation for pi
 *
 * Registers three tools for the "agent as project manager" workflow:
 *   review   — Read-only code review in the current project
 *   explore  — Read-only exploration of external projects (requires cwd)
 *   delegate — General-purpose worker with optional readonly and context inheritance
 *
 * Recursion guard via PI_SUBAGENT_TOOLS_ROLE env var:
 *   - Parent (unset): all three tools active
 *   - Delegate child: review/explore active, delegate registered but rejects at runtime
 *   - Review/explore child: no subagent tools registered
 */

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  runSubagent,
  READONLY_TOOLS,
} from "./spawn.ts";
import { shortenPath } from "./tui.ts";

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(EXTENSION_DIR, "prompts");
const REVIEW_PROMPT_FILE = path.join(PROMPTS_DIR, "review.md");
const EXPLORE_PROMPT_FILE = path.join(PROMPTS_DIR, "explore.md");
const EXTENSION_FILE = path.join(EXTENSION_DIR, "index.ts");

// Role guard
// ---------------------------------------------------------------------------

export const ROLE_ENV = "PI_SUBAGENT_TOOLS_ROLE";

export type SubagentRole = "delegate" | "review" | "explore";

export function getCurrentRole(): SubagentRole | undefined {
  const value = process.env[ROLE_ENV];
  if (value === "delegate" || value === "review" || value === "explore") {
    return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared parameter types
// ---------------------------------------------------------------------------

export const TaskParam = Type.String({
  description: "Task to delegate to the subagent",
});

export const SkillsParam = Type.Optional(
  Type.Array(Type.String(), {
    description: "Optional startup skills to load via --skill",
  }),
);

export const CwdParam = Type.Optional(
  Type.String({
    description:
      "Working directory for the subagent. Defaults to the parent's cwd.",
  }),
);

export const ContextParam = Type.Optional(
  Type.String({
    enum: ["fresh", "inherit"],
    description:
      'Context mode. "fresh" (default): isolated process with no parent history. "inherit": forks parent session so child sees conversation history.',
  }),
);

// Tool-specific parameter schemas
export const ReviewParams = Type.Object({
  task: TaskParam,
  skills: SkillsParam,
});

export const ExploreParams = Type.Object({
  task: TaskParam,
  cwd: Type.String({
    description:
      "Working directory for the explorer. Required — the explorer runs in the target project to pick up its settings, skills, and context files.",
  }),
  skills: SkillsParam,
});

export const DelegateParams = Type.Object({
  task: TaskParam,
  cwd: CwdParam,
  skills: SkillsParam,
  context: ContextParam,
});

// ---------------------------------------------------------------------------
// Shared execute helper
// ---------------------------------------------------------------------------

async function subagentExecute(
  cwd: string,
  task: string,
  skills: string[] | undefined,
  allowedTools: string[] | undefined,
  extensionFile: string | undefined,
  systemPromptFile: string | undefined,
  childRole: "review" | "explore" | "delegate" | undefined,
  signal: AbortSignal | undefined,
  onUpdate: ((result: any) => void) | undefined,
) {
  // Validate cwd exists before spawning
  try {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) {
      return {
        content: [{
          type: "text" as const,
          text: `Cannot spawn subagent: "${cwd}" is not a directory.`,
        }],
        isError: true,
      };
    }
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Cannot spawn subagent: cwd "${cwd}" does not exist or is not accessible (${err.message}).`,
      }],
      isError: true,
    };
  }

  try {
    const result = await runSubagent({
      cwd,
      task,
      skills,
      allowedTools,
      extensionFile,
      systemPromptFile,
      childRole,
      signal,
      onUpdate,
    });
    return {
      content: [{ type: "text" as const, text: result.output }],
      isError: result.isError,
    };
  } catch (err: any) {
    return {
      content: [{
        type: "text" as const,
        text: `Subagent failed: ${err.message || String(err)}`,
      }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const role = getCurrentRole();

  // Review/explore children: register git tool only, then return
  if (role === "review" || role === "explore") {
    pi.registerTool({
      name: "git",
      label: "Git",
      description: "Run read-only git commands (log, diff, status, show, branch, blame).",
      promptSnippet: "Run a read-only git command",
      parameters: Type.Object({
        command: Type.String({
          description: "Git command with arguments (e.g. 'log --oneline -10', 'diff HEAD~1', 'status').",
        }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const { execSync } = await import("node:child_process");
          const output = execSync(`git ${params.command}`, {
            cwd: ctx.cwd,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
            timeout: 30_000,
          });
          return { content: [{ type: "text" as const, text: output }] };
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `git ${params.command}\n\n${err.stderr || err.message}` }],
            isError: true,
          };
        }
      },
    });
    return;
  }


  // Delegate tool: always registered (cache compatibility), rejects in delegate children
  pi.registerTool({
    name: "delegate",
    label: "Delegate",
    description:
      "Delegate a task to an isolated subagent process. " +
      "For general-purpose work that doesn't fit the review or explore tools.",
    promptSnippet: "Delegate a task to a worker subagent",
    promptGuidelines: [
      "Use the delegate tool for non-trivial, self-contained implementation tasks — it has full tool access unlike the read-only review and explore tools.",
    ],
    parameters: DelegateParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (role === "delegate") {
        return {
          content: [
            {
              type: "text" as const,
              text: "Delegation not available in delegate subagents. Use review or explore instead.",
            },
          ],
          isError: true,
        };
      }
      return subagentExecute(
        params.cwd ?? ctx.cwd,
        params.task,
        params.skills,
        undefined, // no tool filtering — cache-compatible
        undefined, // no extension — delegate children don't need git tool
        undefined, // no system prompt — cache-compatible
        "delegate", // delegate children can spawn review/explore but not delegate further
        signal,
        onUpdate,
      );
    },
    renderCall(args, theme) {
      const preview = args.task.length > 60 ? args.task.slice(0, 60) + "..." : args.task;
      const cwdPart = args.cwd ? ` ${theme.fg("muted", shortenPath(args.cwd))}` : "";
      return new Text(`${theme.fg("toolTitle", theme.bold("delegate "))}${theme.fg("dim", preview)}${cwdPart}`, 0, 0);
    },
    renderResult(result, _options, theme) {
      const output = result.content.find((c: any) => c.type === "text")?.text ?? "";
      return new Text(`${theme.fg("success", "✓")} ${output}`, 0, 0);
    },
  });

  // Review tool
  pi.registerTool({
    name: "review",
    label: "Review",
    description:
      "Review code changes or files in the current project. " +
      "The reviewer is always read-only and runs in the parent's working directory. " +
      "Use for code review, diff inspection, issue analysis, and quality checks.",
    promptSnippet: "Review code or files with a read-only subagent",
    promptGuidelines: [
      "Use the review tool for code review, diff inspection, and quality checks — it is read-only and cannot modify files.",
    ],
    parameters: ReviewParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return subagentExecute(
        ctx.cwd,
        params.task,
        params.skills,
        READONLY_TOOLS,
        EXTENSION_FILE,
        REVIEW_PROMPT_FILE,
        "review",
        signal,
        onUpdate,
      );
    },
    renderCall(args, theme) {
      const preview =
        args.task.length > 60 ? args.task.slice(0, 60) + "..." : args.task;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("review "))}${theme.fg("dim", preview)}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const output =
        result.content.find((c: any) => c.type === "text")?.text ?? "";
      return new Text(`${theme.fg("success", "✓")} ${output}`, 0, 0);
    },
  });

  // Explore tool
  pi.registerTool({
    name: "explore",
    label: "Explore",
    description:
      "Explore a project directory to understand its structure, patterns, and key files. " +
      "The explorer is always read-only and runs in the specified working directory. " +
      "Use for mapping codebases, scouting dependencies, or understanding unfamiliar projects.",
    promptSnippet: "Explore a project directory with a read-only subagent",
    promptGuidelines: [
      "Use the explore tool to map unfamiliar codebases or scout dependencies — it runs read-only in the specified directory.",
    ],
    parameters: ExploreParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return subagentExecute(
        params.cwd,
        params.task,
        params.skills,
        READONLY_TOOLS,
        EXTENSION_FILE,
        EXPLORE_PROMPT_FILE,
        "explore",
        signal,
        onUpdate,
      );
    },
    renderCall(args, theme) {
      const preview =
        args.task.length > 60 ? args.task.slice(0, 60) + "..." : args.task;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("explore "))}${theme.fg("dim", preview)} ${theme.fg("muted", shortenPath(args.cwd))}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const output =
        result.content.find((c: any) => c.type === "text")?.text ?? "";
      return new Text(`${theme.fg("success", "✓")} ${output}`, 0, 0);
    },
  });
}
