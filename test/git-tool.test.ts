/**
 * Tests for the git tool's read-only policy (git-tool.ts)
 *
 * The policy is the enforcement point for "review/explore are always
 * read-only" — a verb-only whitelist is not sufficient (e.g. `git branch -D`
 * deletes, `git branch <name>` creates, `git diff --output=f` writes).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { gitPolicyError } from "../git-tool.ts";

const ok = (cmd: string) =>
  assert.strictEqual(gitPolicyError(cmd.split(/\s+/)), null, `expected allowed: ${cmd}`);
const rejected = (cmd: string, match: RegExp) =>
  assert.match(gitPolicyError(cmd.split(/\s+/)) ?? "", match, `expected rejected: ${cmd}`);

describe("git read-only policy", () => {
  it("allows inspection commands", () => {
    ok("log --oneline -10");
    ok("log --format=%s HEAD~3");
    ok("diff HEAD~1");
    ok("diff --stat main...feature");
    ok("show abc123");
    ok("status");
    ok("branch");
    ok("branch -v");
    ok("branch --show-current");
    ok("branch -a --list");
    ok("blame src/index.ts");
    ok("rev-parse HEAD");
    ok("rev-list --count main");
    ok("ls-tree -r HEAD");
    ok("ls-files");
    ok("grep pattern");
    ok("describe --tags");
    ok("shortlog -sn");
    ok("whatchanged -5");
  });

  it("rejects unknown subcommands", () => {
    rejected("checkout main", /not allowed/);
    rejected("reset --hard", /not allowed/);
    rejected("stash", /not allowed/);
    rejected("", /not allowed/);
  });

  it("rejects mutating branch invocations", () => {
    rejected("branch -D feature", /-D is not read-only/);
    rejected("branch --delete feature", /--delete is not read-only/);
    rejected("branch -m old new", /-m is not read-only/);
    rejected("branch -f x y", /-f is not read-only/);
    rejected("branch --set-upstream-to=origin/main", /--set-upstream-to is not read-only/);
  });

  it("rejects branch creation via positional args", () => {
    rejected("branch new-feature", /with arguments is not read-only/);
  });

  it("rejects file-writing output flags", () => {
    rejected("diff --output=/tmp/x.patch HEAD", /--output is not read-only/);
    rejected("diff --output /tmp/x.patch HEAD", /--output is not read-only/);
    rejected("log --output=/tmp/x.log", /--output is not read-only/);
    rejected("show --output=/tmp/x abc", /--output is not read-only/);
  });
});
