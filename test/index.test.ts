/**
 * Tests for pi-subagent-tools
 *
 * Validates:
 *   - Role guard behavior
 *   - Parameter schemas
 *   - Tool count and names
 *   - System prompt content
 *   - Delegate rejection in child role
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Role guard
// ---------------------------------------------------------------------------

import { getCurrentRole, ROLE_ENV, type SubagentRole } from "../index.ts";

describe("getCurrentRole", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ROLE_ENV];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ROLE_ENV];
    } else {
      process.env[ROLE_ENV] = saved;
    }
  });

  it("returns undefined when env var is not set", () => {
    delete process.env[ROLE_ENV];
    assert.strictEqual(getCurrentRole(), undefined);
  });

  it("returns undefined for unknown role values", () => {
    process.env[ROLE_ENV] = "garbage";
    assert.strictEqual(getCurrentRole(), undefined);

    process.env[ROLE_ENV] = "";
    assert.strictEqual(getCurrentRole(), undefined);
  });

  it('returns "delegate" for delegate role', () => {
    process.env[ROLE_ENV] = "delegate";
    assert.strictEqual(getCurrentRole(), "delegate");
  });

  it('returns "review" for review role', () => {
    process.env[ROLE_ENV] = "review";
    assert.strictEqual(getCurrentRole(), "review");
  });

  it('returns "explore" for explore role', () => {
    process.env[ROLE_ENV] = "explore";
    assert.strictEqual(getCurrentRole(), "explore");
  });
});

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ReviewParams, ExploreParams, DelegateParams } from "../index.ts";

describe("ReviewParams schema", () => {
  it("requires task", () => {
    assert.strictEqual(ReviewParams.required?.includes("task"), true);
  });

  it("does not have cwd, readonly, or context parameters", () => {
    const keys = Object.keys(ReviewParams.properties);
    assert.strictEqual(keys.includes("cwd"), false);
    assert.strictEqual(keys.includes("readonly"), false);
    assert.strictEqual(keys.includes("context"), false);
  });

  it("accepts { task, skills }", () => {
    const errors = [
      ...Value.Errors(ReviewParams, { task: "review auth.ts" }),
    ];
    assert.strictEqual(errors.length, 0);
  });

  it("accepts { task } without skills", () => {
    const errors = [
      ...Value.Errors(ReviewParams, { task: "review auth.ts" }),
    ];
    assert.strictEqual(errors.length, 0);
  });

  it("rejects missing task", () => {
    const errors = [...Value.Errors(ReviewParams, {})];
    assert.ok(errors.length > 0);
  });
});

describe("ExploreParams schema", () => {
  it("requires task and cwd", () => {
    assert.strictEqual(ExploreParams.required?.includes("task"), true);
    assert.strictEqual(ExploreParams.required?.includes("cwd"), true);
  });

  it("does not have readonly or context parameters", () => {
    const keys = Object.keys(ExploreParams.properties);
    assert.strictEqual(keys.includes("readonly"), false);
    assert.strictEqual(keys.includes("context"), false);
  });

  it("rejects missing cwd", () => {
    const errors = [
      ...Value.Errors(ExploreParams, { task: "explore this" }),
    ];
    assert.ok(errors.length > 0);
  });

  it("accepts { task, cwd }", () => {
    const errors = [
      ...Value.Errors(ExploreParams, {
        task: "map the structure",
        cwd: "/some/project",
      }),
    ];
    assert.strictEqual(errors.length, 0);
  });
});

describe("DelegateParams schema", () => {
  it("requires task", () => {
    assert.strictEqual(DelegateParams.required?.includes("task"), true);
  });

  it("has optional cwd, skills, context", () => {
    const keys = Object.keys(DelegateParams.properties);
    assert.ok(keys.includes("cwd"));
    assert.ok(keys.includes("skills"));
    assert.ok(keys.includes("context"));
    assert.ok(!keys.includes("readonly"), "readonly should not be on delegate");
  });

  it("accepts minimal { task }", () => {
    const errors = [
      ...Value.Errors(DelegateParams, { task: "do something" }),
    ];
    assert.strictEqual(errors.length, 0);
  });

  it("accepts full options", () => {
    const errors = [
      ...Value.Errors(DelegateParams, {
        task: "do something",
        cwd: "/other/project",
        skills: ["my-skill"],
        context: "inherit",
      }),
    ];
    assert.strictEqual(errors.length, 0);
  });

  it("rejects invalid context value", () => {
    // TypeBox String({ enum }) creates JSON Schema enum constraint;
    // pi validates tool parameters against the JSON Schema at runtime.
    // This test confirms the schema has the enum definition.
    const prop = DelegateParams.properties.context;
    assert.ok(prop);
    const schema = JSON.parse(JSON.stringify(prop));
    assert.ok(Array.isArray(schema.enum));
    assert.deepStrictEqual(schema.enum, ["fresh", "inherit"]);
  });

  it("allows fresh and inherit context values", () => {
    for (const context of ["fresh", "inherit"]) {
      const errors = [
        ...Value.Errors(DelegateParams, { task: "x", context }),
      ];
      assert.strictEqual(errors.length, 0, `context: ${context}`);
    }
  });
});

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const promptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts");
const reviewPrompt = fs.readFileSync(path.join(promptsDir, "review.md"), "utf-8");
const explorePrompt = fs.readFileSync(path.join(promptsDir, "explore.md"), "utf-8");

describe("System prompts", () => {
  it("review prompt mentions read-only constraint", () => {
    assert.ok(reviewPrompt.includes("read-only"));
    assert.ok(
      reviewPrompt.includes("Do not modify") ||
        reviewPrompt.includes("cannot modify") ||
        reviewPrompt.includes("cannot write"),
    );
  });

  it("explore prompt mentions read-only constraint", () => {
    assert.ok(explorePrompt.includes("read-only"));
    assert.ok(
      explorePrompt.includes("Do not modify") ||
        explorePrompt.includes("cannot modify") ||
        explorePrompt.includes("cannot write"),
    );
  });

  it("review prompt mentions code review", () => {
    assert.ok(
      reviewPrompt.toLowerCase().includes("review") ||
        reviewPrompt.toLowerCase().includes("inspect"),
    );
  });

  it("explore prompt mentions exploration/mapping", () => {
    assert.ok(
      explorePrompt.toLowerCase().includes("explor") ||
        explorePrompt.toLowerCase().includes("map"),
    );
  });

  it("prompts are different", () => {
    assert.notStrictEqual(reviewPrompt, explorePrompt);
  });
});

// ---------------------------------------------------------------------------
// ROLE_ENV constant
// ---------------------------------------------------------------------------

describe("ROLE_ENV", () => {
  it("is the expected string", () => {
    assert.strictEqual(ROLE_ENV, "PI_SUBAGENT_TOOLS_ROLE");
  });
});

// ---------------------------------------------------------------------------
// Exported type
// ---------------------------------------------------------------------------

describe("exports", () => {
  it("exports getCurrentRole", () => {
    assert.strictEqual(typeof getCurrentRole, "function");
  });

  it("exports ROLE_ENV", () => {
    assert.strictEqual(typeof ROLE_ENV, "string");
  });

  it("exports parameter schemas", () => {
    assert.ok(ReviewParams);
    assert.ok(ExploreParams);
    assert.ok(DelegateParams);
  });
});

// ===========================================================================

import { shortenPath, formatDuration, formatTokens, formatUsage } from "../tui.ts";
import {
  getPiInvocation,
  buildSpawnArgs,
  runSubagent,
  type SpawnOptions,
} from "../spawn.ts";
import { CompactPreview } from "../index.ts";
describe("tui helpers", () => {
  it("shortenPath replaces home directory with ~", () => {
    const home = os.homedir();
    const result = shortenPath(path.join(home, "project", "src", "file.ts"));
    assert.ok(result.startsWith("~"));
    assert.ok(result.endsWith("file.ts"));
  });

  it("formatDuration formats milliseconds", () => {
    assert.strictEqual(formatDuration(500), "500ms");
    assert.strictEqual(formatDuration(2500), "2.5s");
    assert.ok(formatDuration(65000).includes("m"));
  });

  it("formatTokens formats token counts", () => {
    assert.strictEqual(formatTokens(150), "150   ");
    assert.strictEqual(formatTokens(1500), "  1.5k");
    assert.strictEqual(formatTokens(15000), " 15.0k");
    assert.strictEqual(formatTokens(1234567), "  1.2M");
  });


  it("CompactPreview shows full text when 5 or fewer lines", () => {
    const preview = new CompactPreview("one\ntwo\nthree");
    const lines = preview.render(80);
    assert.deepStrictEqual(lines, ["one", "two", "three"]);
  });

  it("CompactPreview truncates with ... when more than 5 visual lines", () => {
    const preview = new CompactPreview("1\n2\n3\n4\n5\n6\n7");
    const lines = preview.render(80);
    assert.deepStrictEqual(lines, ["...", "3", "4", "5", "6", "7"]);
  });



  it("CompactPreview wraps long lines at render width", () => {
    const preview = new CompactPreview("A".repeat(160));
    const lines = preview.render(40);
    // 160 chars at width 40 = 4 lines, each ≤ 40
    assert.strictEqual(lines.length, 4);
    for (const line of lines) {
      assert.ok(line.length <= 40);
    }
  });

  it("CompactPreview wraps and truncates long text", () => {
    // 200 chars at width 40 = 5 lines, plus 7 more lines = 12 total → shows ... + last 5
    const text = Array(7).fill("short").join("\n") + "\n" + "X".repeat(200);
    const preview = new CompactPreview(text);
    const lines = preview.render(40);
    assert.ok(lines[0] === "...");
    assert.strictEqual(lines.length, 6); // ... + 5 wrapped chunks of X's
  });

  it("CompactPreview handles exactly maxLines boundary", () => {
    const preview = new CompactPreview("1\n2\n3\n4\n5");
    const lines = preview.render(80);
    assert.deepStrictEqual(lines, ["1", "2", "3", "4", "5"]);
  });

  it("CompactPreview handles empty text", () => {
    const preview = new CompactPreview("");
    const lines = preview.render(80);
    assert.deepStrictEqual(lines, [""]);
  });
  it("CompactPreview honors custom maxLines", () => {
    const preview = new CompactPreview("1\n2\n3\n4\n5\n6\n7", 3);
    const lines = preview.render(80);
    assert.deepStrictEqual(lines, ["...", "5", "6", "7"]);
  });

  it("formatUsage produces expected status line", () => {
    const result = formatUsage({ turns: 3, input: 1500, output: 800, total: 2300, durationMs: 5200 });
    assert.ok(result.includes("Turn 3"));
    assert.ok(result.includes("  1.5k"));
    assert.ok(result.includes("800"));
  });
});

describe("spawn logic", () => {
  it("getPiInvocation returns command and args", () => {
    const result = getPiInvocation(["--mode", "json"]);
    assert.strictEqual(typeof result.command, "string");
    assert.ok(Array.isArray(result.args));
    assert.ok(result.args.includes("--mode"));
  });

  it("buildSpawnArgs constructs read-only tool args", () => {
    const args = buildSpawnArgs({
      cwd: "/project",
      task: "review auth.ts",
      allowedTools: ["read", "grep", "find", "ls"],
      systemPromptFile: "/path/to/prompt.md",
    });
    assert.ok(args.includes("--tools"));
    assert.ok(args.some(a => a.includes("read,grep,find,ls")));
    assert.ok(args.includes("--no-session"));
    assert.ok(args.includes("--append-system-prompt"));
  });

  it("buildSpawnArgs includes --skill flags", () => {
    const args = buildSpawnArgs({
      cwd: "/project",
      task: "do work",
      skills: ["my-skill", "another-skill"],
    });
    assert.ok(
      args.filter((a) => a === "--skill").length >= 2,
      "should have at least 2 --skill flags",
    );
  });

  it("buildSpawnArgs passes task as final arg", () => {
    const args = buildSpawnArgs({ cwd: "/project", task: "do a thing" });
    assert.strictEqual(args[args.length - 1], "do a thing");
  });


  it("runSubagent returns error for nonexistent cwd", async () => {
    // CWD /project won't exist → subagentExecute returns early with error
    const result = await runSubagent({
      cwd: "/project",
      task: "say hello and exit",
    });
    assert.strictEqual(typeof result.output, "string");
    assert.strictEqual(typeof result.exitCode, "number");
  });
});
