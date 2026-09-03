/**
 * Tests for the agent manager (agents.ts)
 *
 * Validates:
 *   - Id issuance (sequential per role, monotonic)
 *   - Spawn result formatting (agent id footer)
 *   - CWD validation
 *   - Follow-up routing and unknown-id errors (with live agent list)
 *   - Turn-based protection sweep (idle-only cleanup)
 *   - Abort and error propagation
 *   - disposeAll on shutdown
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

import { AgentManager, PROTECTION_TURNS } from "../agents.ts";

// ---------------------------------------------------------------------------
// Fake session
// ---------------------------------------------------------------------------

function fakeSession(behavior: {
  respondText?: string;
  stopReason?: string;
  errorMessage?: string;
  hang?: boolean;
} = {}) {
  const session: any = {
    messages: [] as any[],
    isStreaming: false,
    disposed: false,
    abortCalls: 0,
    prompts: [] as string[],
    _listener: undefined as any,
    subscribe(listener: any) {
      this._listener = listener;
      return () => {};
    },
    async prompt(task: string) {
      this.prompts.push(task);
      if (behavior.hang) {
        // Signal that the run has started, then wait for abort().
        this._started?.();
        await new Promise<void>((resolve) => {
          this._resolveHang = resolve;
        });
        this.messages.push({
          role: "assistant",
          content: [],
          stopReason: "aborted",
        });
        return;
      }
      if (behavior.stopReason === "error") {
        this.messages.push({
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: behavior.errorMessage ?? "boom",
        });
        return;
      }
      this.messages.push({
        role: "assistant",
        content: [{ type: "text", text: behavior.respondText ?? `done: ${task}` }],
        stopReason: "stop",
        usage: { input: 10, output: 5, totalTokens: 15 },
      });
    },
    async abort() {
      this.abortCalls++;
      this._resolveHang?.();
    },
    dispose() {
      this.disposed = true;
    },
    async bindExtensions() {},
  };
  return session;
}

const fakeCtx: any = {
  cwd: os.tmpdir(),
  ui: undefined,
  model: undefined,
  thinkingLevel: "off",
};

function createManager(sessions: any[] = []) {
  const created: any[] = sessions;
  const manager = new AgentManager({
    spawnSession: async (opts: any, id: string) => {
      const session = created.length > 0 ? created.shift() : fakeSession();
      session._id = id;
      return session;
    },
  });
  return manager;
}

function text(result: any): string {
  return result.content.map((c: any) => c.text).join("");
}

// ---------------------------------------------------------------------------
// Spawn and ids
// ---------------------------------------------------------------------------

describe("spawn", () => {
  it("issues sequential ids per role", async () => {
    const manager = createManager();

    const r1 = await manager.spawn({ role: "delegate", task: "a", cwd: os.tmpdir(), ctx: fakeCtx });
    const r2 = await manager.spawn({ role: "delegate", task: "b", cwd: os.tmpdir(), ctx: fakeCtx });
    const r3 = await manager.spawn({ role: "review", task: "c", cwd: os.tmpdir(), ctx: fakeCtx });

    assert.ok(text(r1).includes("agent: delegate-1"));
    assert.ok(text(r2).includes("agent: delegate-2"));
    assert.ok(text(r3).includes("agent: review-1"));
    assert.deepStrictEqual(manager.liveIds(), ["delegate-1", "delegate-2", "review-1"]);
  });

  it("appends the agent id footer to the output", async () => {
    const manager = createManager([fakeSession({ respondText: "all good" })]);
    const result = await manager.spawn({ role: "delegate", task: "x", cwd: os.tmpdir(), ctx: fakeCtx });

    assert.strictEqual(text(result), "all good\n\n---\nagent: delegate-1");
  });

  it("rejects a nonexistent cwd before creating a session", async () => {
    let spawnCalled = false;
    const manager = new AgentManager({
      spawnSession: async () => {
        spawnCalled = true;
        return fakeSession();
      },
    });

    await assert.rejects(
      manager.spawn({
        role: "delegate",
        task: "x",
        cwd: "/definitely/does/not/exist",
        ctx: fakeCtx,
      }),
      /does not exist/,
    );
    assert.strictEqual(spawnCalled, false);
    assert.deepStrictEqual(manager.liveIds(), []);
  });

  it("rejects a cwd that exists but is not a directory", async () => {
    // Regression: the old implementation threw "not a directory" inside a
    // try whose own catch re-wrapped it, producing the misleading claim
    // that the (existing) path "does not exist or is not accessible".
    const file = path.join(os.tmpdir(), `pi-subagent-cwd-${process.pid}`);
    fs.writeFileSync(file, "x");
    try {
      const manager = createManager();
      let message = "";
      try {
        await manager.spawn({ role: "delegate", task: "x", cwd: file, ctx: fakeCtx });
      } catch (err: any) {
        message = err.message;
      }
      assert.ok(message.includes("is not a directory"), `unexpected message: ${message}`);
      assert.ok(
        !message.includes("does not exist"),
        `message must not claim an existing path does not exist: ${message}`,
      );
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("throws when session creation fails", async () => {
    const manager = new AgentManager({
      spawnSession: async () => {
        throw new Error("no auth");
      },
    });

    await assert.rejects(
      manager.spawn({ role: "delegate", task: "x", cwd: os.tmpdir(), ctx: fakeCtx }),
      /Failed to start subagent: no auth/,
    );
    assert.deepStrictEqual(manager.liveIds(), []);
  });

  it("surfaces assistant error stops as thrown errors", async () => {
    const manager = createManager([fakeSession({ stopReason: "error", errorMessage: "overloaded" })]);

    await assert.rejects(
      manager.spawn({ role: "delegate", task: "x", cwd: os.tmpdir(), ctx: fakeCtx }),
      /Subagent failed: overloaded/,
    );
    // The agent is still registered — follow_up is the recovery path.
    assert.deepStrictEqual(manager.liveIds(), ["delegate-1"]);
  });
});

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

describe("followUp", () => {
  it("continues the same session with the new task", async () => {
    const session = fakeSession();
    const manager = createManager([session]);

    await manager.spawn({ role: "delegate", task: "first", cwd: os.tmpdir(), ctx: fakeCtx });
    const result = await manager.followUp({ agent: "delegate-1", task: "second" });

    assert.deepStrictEqual(session.prompts, ["first", "second"]);
    assert.ok(text(result).includes("agent: delegate-1"));
  });

  it("errors loudly on unknown ids and lists live agents", async () => {
    const manager = createManager();
    await manager.spawn({ role: "delegate", task: "x", cwd: os.tmpdir(), ctx: fakeCtx });
    await manager.spawn({ role: "review", task: "y", cwd: os.tmpdir(), ctx: fakeCtx });

    await assert.rejects(
      manager.followUp({ agent: "delegate-9", task: "hello?" }),
      /"delegate-9" not found.*delegate-1.*review-1/s,
    );
  });

  it("reports when no agents are live", async () => {
    const manager = createManager();
    await assert.rejects(
      manager.followUp({ agent: "delegate-1", task: "hi" }),
      /No live agents/,
    );
  });
});

// ---------------------------------------------------------------------------
// Turn-based protection sweep
// ---------------------------------------------------------------------------

describe("protection sweep", () => {
  it("disposes agents idle for more than PROTECTION_TURNS turns", async () => {
    const old = fakeSession();
    const manager = createManager([old]);
    await manager.spawn({ role: "delegate", task: "x", cwd: os.tmpdir(), ctx: fakeCtx });

    for (let i = 0; i < PROTECTION_TURNS; i++) manager.noteTurnEnd();
    assert.deepStrictEqual(manager.liveIds(), ["delegate-1"], "still protected at exactly N turns");

    manager.noteTurnEnd();
    assert.deepStrictEqual(manager.liveIds(), [], "evicted after N+1 idle turns");
    assert.strictEqual(old.disposed, true);
  });

  it("a follow-up resets the protection clock", async () => {
    const manager = createManager();
    await manager.spawn({ role: "delegate", task: "x", cwd: os.tmpdir(), ctx: fakeCtx });

    for (let i = 0; i < PROTECTION_TURNS; i++) manager.noteTurnEnd();
    await manager.followUp({ agent: "delegate-1", task: "again" });

    for (let i = 0; i < PROTECTION_TURNS; i++) manager.noteTurnEnd();
    assert.deepStrictEqual(manager.liveIds(), ["delegate-1"], "follow-up refreshed protection");
  });

  it("keeps any number of recently-active agents (no count cap)", async () => {
    const manager = createManager();
    for (let i = 0; i < 25; i++) {
      await manager.spawn({ role: "delegate", task: `t${i}`, cwd: os.tmpdir(), ctx: fakeCtx });
    }
    manager.noteTurnEnd();
    assert.strictEqual(manager.liveIds().length, 25, "all recently active agents survive");
  });

  it("never disposes a streaming agent", async () => {
    const streaming = fakeSession();
    streaming.isStreaming = true;
    const manager = createManager([streaming]);
    await manager.spawn({ role: "delegate", task: "x", cwd: os.tmpdir(), ctx: fakeCtx });

    for (let i = 0; i < PROTECTION_TURNS + 5; i++) manager.noteTurnEnd();
    assert.deepStrictEqual(manager.liveIds(), ["delegate-1"]);
    assert.strictEqual(streaming.disposed, false);
  });

  it("disposeAll removes every agent", async () => {
    const sessions = [fakeSession(), fakeSession(), fakeSession()];
    const manager = createManager(sessions);
    await manager.spawn({ role: "delegate", task: "a", cwd: os.tmpdir(), ctx: fakeCtx });
    await manager.spawn({ role: "review", task: "b", cwd: os.tmpdir(), ctx: fakeCtx });
    await manager.spawn({ role: "explore", task: "c", cwd: os.tmpdir(), ctx: fakeCtx });

    manager.disposeAll();

    assert.deepStrictEqual(manager.liveIds(), []);
    assert.ok(sessions.every((s) => s.disposed));
  });

  it("delegate entries get a child manager; leaf roles do not", async () => {
    const manager = createManager();
    await manager.spawn({ role: "delegate", task: "a", cwd: os.tmpdir(), ctx: fakeCtx });
    await manager.spawn({ role: "review", task: "b", cwd: os.tmpdir(), ctx: fakeCtx });

    const entries = (manager as any).entries;
    assert.ok(entries.get("delegate-1").childManager, "delegate should own a child manager");
    assert.strictEqual(entries.get("review-1").childManager, undefined);
  });

  it("disposing an entry cascades to its child manager", async () => {
    const manager = createManager();
    await manager.spawn({ role: "delegate", task: "a", cwd: os.tmpdir(), ctx: fakeCtx });

    const child = (manager as any).entries.get("delegate-1").childManager;
    let cascaded = false;
    child.disposeAll = () => {
      cascaded = true;
    };

    manager.disposeAll();
    assert.strictEqual(cascaded, true, "child manager must be disposed with its owner");
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe("abort", () => {
  it("throws immediately when the signal is already aborted", async () => {
    const manager = createManager();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      manager.spawn({
        role: "delegate",
        task: "x",
        cwd: os.tmpdir(),
        ctx: fakeCtx,
        signal: controller.signal,
      }),
      /aborted/,
    );
  });

  it("aborts a running session when the signal fires", async () => {
    const session = fakeSession({ hang: true });
    const manager = createManager([session]);
    const controller = new AbortController();

    const pending = manager.spawn({
      role: "delegate",
      task: "x",
      cwd: os.tmpdir(),
      ctx: fakeCtx,
      signal: controller.signal,
    });
    // Wait until the session's prompt is actually running, then abort.
    await new Promise<void>((resolve) => {
      session._started = resolve;
    });
    controller.abort();
    assert.strictEqual(session.abortCalls, 1);
    await assert.rejects(pending, /aborted/);
  });
});
