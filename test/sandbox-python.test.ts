/**
 * Integration tests for the sandboxed stdlib-only python tool
 * (sandbox-python.ts). Same approach as the bash sandbox tests: real
 * interpreter, real temp git repository — the capability boundary
 * (stdlib-only WASM CPython over a read-only real-layout fs) is the
 * thing under test.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { sandboxPythonTool } from "../sandbox-python.ts";
import { sandboxBashTool } from "../sandbox-bash.ts";

let repoDir: string;

function run(params: Record<string, unknown>) {
  return sandboxPythonTool.execute("test", params as any, undefined, undefined, {
    cwd: repoDir,
  } as any);
}

async function textOf(params: Record<string, unknown>) {
  const result = await run(params);
  return (result.content[0] as any).text as string;
}

before(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sandbox-py-test-"));
  fs.writeFileSync(path.join(repoDir, "data.txt"), "alpha\nbeta\ngamma\n");
  fs.writeFileSync(
    path.join(repoDir, "analyze.py"),
    "import sys\nprint('args:', sys.argv[1:])\nprint(open('data.txt').read().upper())\n",
  );
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

describe("sandboxed python: execution", () => {
  it("runs inline code", async () => {
    const out = await textOf({ code: "print(sum(range(10)))" });
    assert.match(out, /45/);
  });

  it("runs a script by relative path, with args, cwd at the project root", async () => {
    const out = await textOf({ path: "analyze.py", args: ["--verbose", "x"] });
    assert.match(out, /args: \['--verbose', 'x'\]/);
    assert.match(out, /ALPHA/);
  });

  it("runs a script by host-absolute path", async () => {
    const out = await textOf({ path: path.join(repoDir, "analyze.py") });
    assert.match(out, /GAMMA/);
  });

  it("standard library is available", async () => {
    const out = await textOf({ code: "import json, statistics; print(json.dumps({'m': statistics.mean([1,2,3])}))" });
    assert.match(out, /\{"m": 2\}/);
  });

  it("third-party packages are absent (stdlib-only contract)", async () => {
    const out = await textOf({ code: "import numpy" });
    assert.match(out, /Exit code 1/);
    assert.match(out, /ModuleNotFoundError/);
  });

  it("reports non-zero exit codes with stderr", async () => {
    const out = await textOf({ code: "raise ValueError('boom')" });
    assert.match(out, /Exit code 1/);
    assert.match(out, /ValueError: boom/);
  });
});

describe("sandboxed python: contract", () => {
  it("requires exactly one of code or path", async () => {
    await assert.rejects(run({}), /exactly one of 'code' or 'path'/);
    await assert.rejects(run({ code: "pass", path: "analyze.py" }), /exactly one of 'code' or 'path'/);
  });

  it("missing script is a clean error", async () => {
    await assert.rejects(run({ path: "nope.py" }), /script not found/);
  });

  it("times out with a timeout:N error", { timeout: 60_000 }, async () => {
    await assert.rejects(
      run({ code: "import time; print('started', flush=True); time.sleep(30)", timeout: 10 }),
      /timeout:10/,
    );
  });

  // Regression: the interpreter's own maxPythonTimeoutMs defaults to 30s —
  // the tool must lift it, or every script past 30s dies as a raw exit 124.
  it("runs past the interpreter's 30s default python cap", { timeout: 90_000 }, async () => {
    const out = await textOf({ code: "import time; time.sleep(31); print('survived')" });
    assert.match(out, /survived/);
  });
});

describe("sandboxed python: read-only filesystem", () => {
  it("writes to the project fail; /tmp scratch works", async () => {
    const out = await textOf({
      code: "open('/tmp/scratch.txt','w').write('ok')\nprint(open('/tmp/scratch.txt').read())",
    });
    assert.match(out, /ok/);
    const denied = await textOf({ code: "open('injected.txt','w').write('x')" });
    assert.match(denied, /Exit code 1/);
    assert.match(denied, /EROFS|read-only/i);
    assert.ok(!fs.existsSync(path.join(repoDir, "injected.txt")));
  });
});

describe("sandboxed bash: no python illusion", () => {
  it("python3 is NOT on PATH inside the bash sandbox", async () => {
    const result = await sandboxBashTool.execute("test", { command: "python3 --version" }, undefined, undefined, {
      cwd: repoDir,
    } as any);
    const out = (result.content[0] as any).text as string;
    assert.match(out, /Exit code 127|command not found/);
  });
});
