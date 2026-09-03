/**
 * Tests for the delegate-child extension filter (agents.ts)
 *
 * The filter is the recursion guard for delegate children that discover
 * extensions: it must exclude this extension itself (whose discovered copy
 * would register an unguarded delegate tool) and project-local extensions
 * in untrusted projects, while keeping everything else.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { filterChildExtensions } from "../agents.ts";

const SELF_DIR = path.resolve("D:/Projects/pi-packages/pi-subagent-tools");
const CHILD_CWD = path.resolve("D:/some/project");

const ext = (path_: string, resolvedPath?: string) => ({ path: path_, resolvedPath });

const USER_EXT = ext("C:/Users/me/.pi/agent/extensions/checker.ts");
const USER_NPM_EXT = ext(
  "C:/Users/me/.pi/agent/npm/node_modules/@acme/pi-tools/index.ts",
);
const SELF_NPM = ext(
  "C:/Users/me/.pi/agent/npm/node_modules/@jerryan/pi-subagent-tools/index.ts",
);
const SELF_NPM_POSIX = ext(
  "/home/me/.pi/agent/npm/node_modules/@jerryan/pi-subagent-tools/index.ts",
);
const SELF_DEV = ext(path.join(SELF_DIR, "index.ts"));
const PROJECT_EXT = ext(path.join(CHILD_CWD, ".pi", "extensions", "project-tool.ts"));
const INLINE_FACTORY = ext("<inline:pi-subagent-tools>");

const ALL = [
  USER_EXT,
  USER_NPM_EXT,
  SELF_NPM,
  SELF_NPM_POSIX,
  SELF_DEV,
  PROJECT_EXT,
  INLINE_FACTORY,
];

function filtered(projectTrusted: boolean) {
  return filterChildExtensions(ALL, {
    selfDir: SELF_DIR,
    childCwd: CHILD_CWD,
    projectTrusted,
  });
}

describe("filterChildExtensions", () => {
  it("excludes the npm-installed copy of this extension (both path styles)", () => {
    const result = filtered(true);
    assert.ok(!result.includes(SELF_NPM));
    assert.ok(!result.includes(SELF_NPM_POSIX));
  });

  it("excludes the dev/local copy of this extension by directory", () => {
    assert.ok(!filtered(true).includes(SELF_DEV));
  });

  it("excludes project-local extensions when the project is untrusted", () => {
    assert.ok(!filtered(false).includes(PROJECT_EXT));
  });

  it("keeps project-local extensions when the project is trusted", () => {
    assert.ok(filtered(true).includes(PROJECT_EXT));
  });

  it("always keeps user-global extensions and inline factories", () => {
    for (const trusted of [true, false]) {
      const result = filtered(trusted);
      assert.ok(result.includes(USER_EXT));
      assert.ok(result.includes(USER_NPM_EXT));
      assert.ok(result.includes(INLINE_FACTORY));
    }
  });

  it("matches on resolvedPath when path does not match", () => {
    const disguised = ext("extensions/whatever.ts", path.join(SELF_DIR, "index.ts"));
    const result = filterChildExtensions([disguised], {
      selfDir: SELF_DIR,
      childCwd: CHILD_CWD,
      projectTrusted: true,
    });
    assert.strictEqual(result.length, 0);
  });
});
