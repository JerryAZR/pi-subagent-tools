/**
 * Tests for pi-subagent-tools
 *
 * Validates:
 *   - Parameter schemas (including follow_up)
 *   - System prompt content
 *   - TUI helpers and preview component
 *   - Public exports
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  ReviewParams,
  ExploreParams,
  DelegateParams,
  FollowUpParams,
} from "../agents.ts";

describe("ReviewParams schema", () => {
  it("does not have cwd, readonly, or context parameters", () => {
    const keys = Object.keys(ReviewParams.properties);
    assert.strictEqual(keys.includes("cwd"), false);
    assert.strictEqual(keys.includes("readonly"), false);
    assert.strictEqual(keys.includes("context"), false);
  });

  it("accepts { task, skills }", () => {
    const errors = [
      ...Value.Errors(ReviewParams, { task: "review auth.ts", skills: ["s"] }),
    ];
    assert.strictEqual(errors.length, 0);
  });

  it("rejects missing task", () => {
    const errors = [...Value.Errors(ReviewParams, {})];
    assert.ok(errors.length > 0);
  });
});

describe("ExploreParams schema", () => {
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
  it("has optional cwd and skills", () => {
    const keys = Object.keys(DelegateParams.properties);
    assert.ok(keys.includes("cwd"));
    assert.ok(keys.includes("skills"));
  });

  it("does not have a context parameter (fresh in-process sessions only)", () => {
    const keys = Object.keys(DelegateParams.properties);
    assert.ok(!keys.includes("context"), "context param was removed");
    assert.ok(!keys.includes("readonly"), "readonly should not be on delegate");
  });

  it("accepts minimal { task }", () => {
    const errors = [...Value.Errors(DelegateParams, { task: "do something" })];
    assert.strictEqual(errors.length, 0);
  });
});

describe("FollowUpParams schema", () => {
  it("has no cwd or skills (fixed at spawn)", () => {
    const keys = Object.keys(FollowUpParams.properties);
    assert.deepStrictEqual(keys.sort(), ["agent", "task"]);
  });

  it("rejects missing agent", () => {
    const errors = [...Value.Errors(FollowUpParams, { task: "continue" })];
    assert.ok(errors.length > 0);
  });

  it("accepts { agent, task }", () => {
    const errors = [
      ...Value.Errors(FollowUpParams, { agent: "delegate-1", task: "continue" }),
    ];
    assert.strictEqual(errors.length, 0);
  });
});

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const promptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts");
const reviewPrompt = fs.readFileSync(path.join(promptsDir, "review.md"), "utf-8");
const explorePrompt = fs.readFileSync(path.join(promptsDir, "explore.md"), "utf-8");
const delegatePrompt = fs.readFileSync(path.join(promptsDir, "delegate.md"), "utf-8");

describe("System prompts", () => {
  it("review prompt mentions read-only constraint", () => {
    assert.ok(reviewPrompt.includes("read-only"));
    assert.ok(
      reviewPrompt.includes("Do not modify") ||
        reviewPrompt.includes("cannot modify") ||
        reviewPrompt.includes("cannot be modified") ||
        reviewPrompt.includes("cannot write"),
    );
  });

  it("explore prompt mentions read-only constraint", () => {
    assert.ok(explorePrompt.includes("read-only"));
    assert.ok(
      explorePrompt.includes("Do not modify") ||
        explorePrompt.includes("cannot modify") ||
        explorePrompt.includes("cannot be modified") ||
        explorePrompt.includes("cannot write"),
    );
  });

  it("delegate prompt tells the agent to do the work directly", () => {
    assert.ok(delegatePrompt.includes("execute the assigned task"));
  });
});

// ---------------------------------------------------------------------------
// TUI helpers and preview component
// ---------------------------------------------------------------------------

import { shortenPath, formatDuration, formatTokens, formatUsage } from "../tui.ts";
import { CompactPreview } from "../render.ts";

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
    assert.strictEqual(lines.length, 4);
    for (const line of lines) {
      assert.ok(line.length <= 40);
    }
  });

  it("CompactPreview wraps and truncates long text", () => {
    const text = Array(7).fill("short").join("\n") + "\n" + "X".repeat(200);
    const preview = new CompactPreview(text);
    const lines = preview.render(40);
    assert.ok(lines[0] === "...");
    assert.strictEqual(lines.length, 6);
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
    const spin = () => "⠏";
    const result = formatUsage({ turns: 3, input: 1500, output: 800, durationMs: 5200 }, spin);
    assert.ok(result.includes("Turn 3"));
    assert.ok(result.includes("  1.5k"));
    assert.ok(result.includes("800"));
  });
});
