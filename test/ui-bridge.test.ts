/**
 * Tests for the UI bridge (ui-bridge.ts)
 *
 * Validates:
 *   - Dialog methods forward to the parent UI with prefixed titles
 *   - Dialog opts (signal, timeout) pass through unchanged
 *   - notify / setStatus / setWidget are prefixed or namespaced
 *   - Chrome-hijacking methods are dropped (parent never called)
 *   - Theme reads pass through; setTheme is blocked
 *   - Dialogs from concurrent bridges serialize through the shared queue
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createUIBridge, _resetDialogQueue } from "../ui-bridge.ts";

// ---------------------------------------------------------------------------
// Fake parent UI — records every call
// ---------------------------------------------------------------------------

function createFakeParent(overrides: Record<string, any> = {}) {
  const calls: Array<{ method: string; args: any[] }> = [];
  const record = (method: string) => (...args: any[]) => {
    calls.push({ method, args });
    return overrides[method]?.(...args);
  };

  const parent: any = {
    calls,
    select: record("select"),
    confirm: record("confirm"),
    input: record("input"),
    editor: record("editor"),
    custom: record("custom"),
    notify: record("notify"),
    setStatus: record("setStatus"),
    setWidget: record("setWidget"),
    setTitle: record("setTitle"),
    setWorkingMessage: record("setWorkingMessage"),
    setWorkingVisible: record("setWorkingVisible"),
    setWorkingIndicator: record("setWorkingIndicator"),
    setHiddenThinkingLabel: record("setHiddenThinkingLabel"),
    pasteToEditor: record("pasteToEditor"),
    setEditorText: record("setEditorText"),
    setEditorComponent: record("setEditorComponent"),
    setFooter: record("setFooter"),
    setHeader: record("setHeader"),
    addAutocompleteProvider: record("addAutocompleteProvider"),
    setToolsExpanded: record("setToolsExpanded"),
    onTerminalInput: record("onTerminalInput"),
    getEditorText: () => "parent editor text",
    getEditorComponent: () => "parent-editor-factory",
    getToolsExpanded: () => true,
    getAllThemes: () => [{ name: "dark", path: "/themes/dark.json" }],
    getTheme: (name: string) => (name === "dark" ? { name: "dark" } : undefined),
    setTheme: record("setTheme"),
    theme: { name: "dark" },
  };
  return parent;
}

const called = (parent: any, method: string) =>
  parent.calls.filter((c: any) => c.method === method);

beforeEach(() => _resetDialogQueue());

// ---------------------------------------------------------------------------
// Dialog forwarding
// ---------------------------------------------------------------------------

describe("dialog forwarding", () => {
  it("select prefixes the title and passes options and opts through", async () => {
    const parent = createFakeParent({ select: async () => "Allow" });
    const bridge = createUIBridge(parent, { label: "delegate" });
    const controller = new AbortController();
    const opts = { signal: controller.signal, timeout: 5000 };

    const result = await bridge.select("Allow dangerous command?", ["Allow", "Block"], opts);

    assert.strictEqual(result, "Allow");
    const [call] = called(parent, "select");
    assert.strictEqual(call.args[0], "[delegate] Allow dangerous command?");
    assert.deepStrictEqual(call.args[1], ["Allow", "Block"]);
    assert.strictEqual(call.args[2], opts, "opts object must pass through by reference");
  });

  it("confirm forwards message and returns parent result", async () => {
    const parent = createFakeParent({ confirm: async () => true });
    const bridge = createUIBridge(parent, { label: "review" });

    const result = await bridge.confirm("Clear session?", "All messages lost.");

    assert.strictEqual(result, true);
    const [call] = called(parent, "confirm");
    assert.deepStrictEqual(call.args, ["[review] Clear session?", "All messages lost.", undefined]);
  });

  it("input forwards placeholder", async () => {
    const parent = createFakeParent({ input: async () => "typed value" });
    const bridge = createUIBridge(parent, { label: "explore" });

    const result = await bridge.input("Enter a value", "type here");

    assert.strictEqual(result, "typed value");
    const [call] = called(parent, "input");
    assert.deepStrictEqual(call.args, ["[explore] Enter a value", "type here", undefined]);
  });

  it("editor forwards prefill", async () => {
    const parent = createFakeParent({ editor: async () => "edited" });
    const bridge = createUIBridge(parent, { label: "delegate" });

    const result = await bridge.editor("Edit text", "prefill");

    assert.strictEqual(result, "edited");
    const [call] = called(parent, "editor");
    assert.deepStrictEqual(call.args, ["[delegate] Edit text", "prefill"]);
  });

  it("custom forwards the factory and returns its result", async () => {
    const parent = createFakeParent({ custom: async (factory: any) => factory() });
    const bridge = createUIBridge(parent, { label: "delegate" });
    const factory = () => "component";

    const result = await bridge.custom(factory);

    assert.strictEqual(result, "component");
    const [call] = called(parent, "custom");
    assert.strictEqual(call.args[0], factory);
  });

  it("propagates undefined (cancelled) results", async () => {
    const parent = createFakeParent({ select: async () => undefined });
    const bridge = createUIBridge(parent, { label: "delegate" });

    assert.strictEqual(await bridge.select("Pick", ["a"]), undefined);
  });
});

// ---------------------------------------------------------------------------
// Fire-and-forget forwarding
// ---------------------------------------------------------------------------

describe("fire-and-forget forwarding", () => {
  it("notify prefixes the message and forwards the type", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "delegate" });

    bridge.notify("Command blocked", "warning");

    const [call] = called(parent, "notify");
    assert.deepStrictEqual(call.args, ["[delegate] Command blocked", "warning"]);
  });

  it("setStatus namespaces the key", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "review" });

    bridge.setStatus("progress", "Turn 3");
    bridge.setStatus("progress", undefined);

    const calls = called(parent, "setStatus");
    assert.deepStrictEqual(calls[0].args, ["review:progress", "Turn 3"]);
    assert.deepStrictEqual(calls[1].args, ["review:progress", undefined]);
  });

  it("setWidget namespaces the key and forwards content and options", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "explore" });
    const lines = ["--- Widget ---", "Line 1"];
    const opts = { placement: "belowEditor" };

    bridge.setWidget("status-widget", lines as any, opts as any);

    const [call] = called(parent, "setWidget");
    assert.strictEqual(call.args[0], "explore:status-widget");
    assert.strictEqual(call.args[1], lines);
    assert.strictEqual(call.args[2], opts);
  });
});

// ---------------------------------------------------------------------------
// Dropped chrome methods
// ---------------------------------------------------------------------------

describe("dropped chrome methods", () => {
  it("never forwards chrome-hijacking calls to the parent", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "delegate" });

    bridge.setTitle("hijacked");
    bridge.setWorkingMessage("hijacked");
    bridge.setWorkingVisible(true);
    bridge.setWorkingIndicator({ frames: ["x"] } as any);
    bridge.setHiddenThinkingLabel("hijacked");
    bridge.pasteToEditor("hijacked");
    bridge.setEditorText("hijacked");
    bridge.setEditorComponent((() => {}) as any);
    bridge.setFooter((() => {}) as any);
    bridge.setHeader((() => {}) as any);
    bridge.addAutocompleteProvider(((p: any) => p) as any);
    bridge.setToolsExpanded(true);

    assert.strictEqual(parent.calls.length, 0, `parent received: ${JSON.stringify(parent.calls)}`);
  });

  it("onTerminalInput returns an unsubscribe function without touching the parent", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "delegate" });

    const unsub = bridge.onTerminalInput(() => {});

    assert.strictEqual(typeof unsub, "function");
    assert.doesNotThrow(() => unsub());
    assert.strictEqual(called(parent, "onTerminalInput").length, 0);
  });
});

// ---------------------------------------------------------------------------
// Reads and blocked writes
// ---------------------------------------------------------------------------

describe("reads and blocked writes", () => {
  it("theme and theme getters read through to the parent", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "delegate" });

    assert.deepStrictEqual(bridge.theme, { name: "dark" });
    assert.deepStrictEqual(bridge.getAllThemes(), [{ name: "dark", path: "/themes/dark.json" }]);
    assert.deepStrictEqual(bridge.getTheme("dark"), { name: "dark" });
    assert.strictEqual(bridge.getTheme("missing"), undefined);
  });

  it("getToolsExpanded reads through", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "delegate" });

    assert.strictEqual(bridge.getToolsExpanded(), true);
  });

  it("editor reads return empty defaults", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "delegate" });

    assert.strictEqual(bridge.getEditorText(), "");
    assert.strictEqual(bridge.getEditorComponent(), undefined);
  });

  it("setTheme is blocked with a descriptive error", () => {
    const parent = createFakeParent();
    const bridge = createUIBridge(parent, { label: "delegate" });

    const result = bridge.setTheme("light");

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.strictEqual(called(parent, "setTheme").length, 0);
  });
});

// ---------------------------------------------------------------------------
// Dialog serialization
// ---------------------------------------------------------------------------

describe("dialog serialization", () => {
  it("concurrent dialogs across bridges run one at a time, in order", async () => {
    const events: string[] = [];
    const parent = createFakeParent({
      select: async (title: string) => {
        events.push(`start:${title}`);
        await new Promise((r) => setTimeout(r, title.includes("first") ? 30 : 5));
        events.push(`end:${title}`);
        return title;
      },
    });
    const bridgeA = createUIBridge(parent, { label: "a" });
    const bridgeB = createUIBridge(parent, { label: "b" });

    const [r1, r2] = await Promise.all([
      bridgeA.select("first", ["x"]),
      bridgeB.select("second", ["y"]),
    ]);

    assert.strictEqual(r1, "[a] first");
    assert.strictEqual(r2, "[b] second");
    // Second dialog must not start until the first has fully resolved.
    assert.deepStrictEqual(events, [
      "start:[a] first",
      "end:[a] first",
      "start:[b] second",
      "end:[b] second",
    ]);
  });

  it("a rejected dialog does not jam the queue", async () => {
    const parent = createFakeParent({
      confirm: async () => {
        throw new Error("boom");
      },
      select: async () => "recovered",
    });
    const bridge = createUIBridge(parent, { label: "delegate" });

    await assert.rejects(bridge.confirm("fail", "fail"));
    assert.strictEqual(await bridge.select("after", ["x"]), "recovered");
  });

  it("mixed dialog types share the same queue", async () => {
    const events: string[] = [];
    const parent = createFakeParent({
      confirm: async () => {
        events.push("confirm:start");
        await new Promise((r) => setTimeout(r, 20));
        events.push("confirm:end");
        return true;
      },
      input: async () => {
        events.push("input:start");
        events.push("input:end");
        return "v";
      },
    });
    const bridge = createUIBridge(parent, { label: "delegate" });

    await Promise.all([bridge.confirm("t", "m"), bridge.input("t")]);

    assert.deepStrictEqual(events, [
      "confirm:start",
      "confirm:end",
      "input:start",
      "input:end",
    ]);
  });
});
