/**
 * Integration tests for the sandboxed read-only bash tool (sandbox-bash.ts).
 *
 * These run the real just-bash interpreter against a real temporary git
 * repository — the capability layer (read-only OverlayFs, disabled git
 * verbs, blocked network) is the thing under test, so mocks would test
 * nothing.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { sandboxBashTool } from "../sandbox-bash.ts";

let repoDir: string;

function run(command: string) {
  return sandboxBashTool.execute("test", { command }, undefined, undefined, {
    cwd: repoDir,
  } as any);
}

async function textOf(command: string) {
  const result = await run(command);
  return (result.content[0] as any).text as string;
}

before(() => {
  // Requires a real git binary on PATH to build the fixture repository.
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sandbox-test-"));
  fs.writeFileSync(path.join(repoDir, "hello.txt"), "hello world\n");
  fs.mkdirSync(path.join(repoDir, "src"));
  fs.writeFileSync(path.join(repoDir, "src", "app.ts"), "export const x = 1;\n");
  const git = (args: string) =>
    execFileSync("git", args.split(" "), { cwd: repoDir, stdio: "pipe" });
  git("init -q");
  git("config user.email test@example.com");
  git("config user.name Test");
  git("add .");
  git("commit -q -m initial");
});

after(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe("sandboxed bash: basic execution", () => {
  it("runs pipelines with cwd at the project root", async () => {
    const out = await textOf("cat hello.txt | grep -n world");
    assert.match(out, /1:hello world/);
  });

  it("resolves relative paths against the project root", async () => {
    const out = await textOf("cat src/app.ts");
    assert.match(out, /export const x = 1/);
  });

  it("find and ls work", async () => {
    const out = await textOf("find . -name '*.txt' -not -path './.git/*'");
    assert.match(out, /hello\.txt/);
    const ls = await textOf("ls");
    assert.match(ls, /hello\.txt/);
    assert.match(ls, /src/);
  });

  it("reports non-zero exit codes", async () => {
    const out = await textOf("grep -q zzzz hello.txt");
    assert.match(out, /Exit code 1/);
  });
});

describe("sandboxed bash: statelessness", () => {
  it("cd and exported variables do not persist between calls", async () => {
    await textOf("cd src && export SANDBOX_MARKER=42 && pwd");
    const out = await textOf("ls hello.txt; echo marker=$SANDBOX_MARKER");
    assert.match(out, /hello\.txt/);
    assert.match(out, /marker=\s*$/m);
  });
});

describe("sandboxed bash: read-only enforcement", () => {
  it("output redirection fails (interpreter-level rejection path)", async () => {
    const out = await textOf("echo data > injected.txt");
    assert.match(out, /Exit code [1-9]/);
    assert.match(out, /EROFS|read-only|cannot open/i);
    assert.ok(!fs.existsSync(path.join(repoDir, "injected.txt")));
  });

  it("rm fails and the file survives", async () => {
    const out = await textOf("rm hello.txt");
    assert.match(out, /Exit code 1/);
    assert.ok(fs.existsSync(path.join(repoDir, "hello.txt")));
  });

  it("sed -i fails", async () => {
    const out = await textOf("sed -i s/world/mars/ hello.txt");
    assert.match(out, /Exit code [1-9]/);
    assert.strictEqual(fs.readFileSync(path.join(repoDir, "hello.txt"), "utf-8"), "hello world\n");
  });
});

describe("sandboxed bash: sandbox layout", () => {
  it("/dev/null accepts writes (stderr silencing works)", async () => {
    const out = await textOf("echo hi > /dev/null; grep -q world hello.txt 2>/dev/null; echo ok=$?");
    assert.match(out, /ok=0/);
  });

  it("paths outside /repo are in-memory scratch; /repo stays read-only", async () => {
    const out = await textOf("echo scratch > /tmp/x.txt && mkdir -p /work && echo data > /work/f.txt && cat /tmp/x.txt /work/f.txt");
    assert.match(out, /scratch/);
    assert.match(out, /data/);
    assert.ok(!fs.existsSync(path.join(repoDir, "tmp")));
    const denied = await textOf("echo data > /repo/injected2.txt");
    assert.match(denied, /Exit code [1-9]/);
    assert.ok(!fs.existsSync(path.join(repoDir, "injected2.txt")));
  });

  it("truncates very long output", async () => {
    const out = await textOf("seq 1 5000");
    assert.match(out, /\[output truncated: showing \d+ lines, \d+ chars\]/);
  });
});

describe("sandboxed bash: git", () => {
  it("read-only git commands work", async () => {
    const log = await textOf("git log --oneline");
    assert.match(log, /initial/);
    const status = await textOf("git status --short");
    assert.ok(!status.startsWith("Exit code"));
    const show = await textOf("git show --stat HEAD");
    assert.match(show, /hello\.txt/);
    const blame = await textOf("git blame hello.txt");
    assert.match(blame, /hello world/);
    const grep = await textOf("git grep -n world");
    assert.match(grep, /hello\.txt:1:hello world/);
  });

  it("pure-mutator git verbs are disabled with a clean error", async () => {
    for (const verb of ["add hello.txt", "commit -m x", "checkout -b x", "reset --hard", "clean -f"]) {
      const out = await textOf(`git ${verb}`);
      assert.match(out, /not available in this environment/, `git ${verb}`);
    }
    // Nothing was staged or committed.
    const status = await textOf("git status --short");
    assert.ok(!/^[AM]/.test(status), `unexpected index changes: ${status}`);
  });

  it("dual-purpose verbs keep their read mode; writes fail at the FS", async () => {
    const branches = await textOf("git branch");
    assert.match(branches, /master|main/);
    const created = await textOf("git branch test-branch");
    assert.match(created, /Exit code [1-9]/);
    const after = await textOf("git branch");
    assert.ok(!/test-branch/.test(after));
  });

  it("network verbs are blocked", async () => {
    const out = await textOf("git clone https://example.com/repo.git /tmp/clone 2>&1");
    assert.match(out, /Exit code [1-9]|not available|network/i);
  });
});
