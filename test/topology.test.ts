/**
 * Unit tests for the mount-topology resolution (sandbox-bash.ts).
 *
 * resolveMountRoots / computeTopology are pure given a platform; win32
 * branches are tested by injecting the platform and drive list.
 * canonicalize() falls back to the input for nonexistent paths, so the
 * fake paths below pass through unchanged on any host.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { computeTopology, resolveMountRoots } from "../sandbox-bash.ts";

describe("resolveMountRoots", () => {
  it("drops \"/\" (cannot mount the fs root)", () => {
    assert.deepEqual(resolveMountRoots(["/", "/home/jerry"], "posix"), ["/home/jerry"]);
  });

  it("drops a candidate within an already-kept root", () => {
    assert.deepEqual(resolveMountRoots(["/home/jerry", "/home/jerry/proj"], "posix"), [
      "/home/jerry",
    ]);
  });

  it("a candidate containing kept roots replaces them (ancestor cwd)", () => {
    assert.deepEqual(resolveMountRoots(["/home/jerry", "/home"], "posix"), ["/home"]);
    assert.deepEqual(resolveMountRoots(["/home/jerry/proj", "/home/jerry", "/home"], "posix"), [
      "/home",
    ]);
  });

  it("keeps unrelated roots", () => {
    assert.deepEqual(resolveMountRoots(["/home/jerry", "/tmp/proj"], "posix"), [
      "/home/jerry",
      "/tmp/proj",
    ]);
  });

  it("prefix-similar siblings are not conflated (boundary-aware)", () => {
    assert.deepEqual(resolveMountRoots(["/home/jerry", "/home/jerry2"], "posix"), [
      "/home/jerry",
      "/home/jerry2",
    ]);
  });

  it("win32: containment is case-insensitive", () => {
    assert.deepEqual(
      resolveMountRoots(["C:\\", "c:\\Users\\jerry\\proj"], "win32"),
      ["C:\\"],
    );
  });
});

describe("computeTopology (posix)", () => {
  it("cwd inside home: single home mount, cwd maps under it", () => {
    const topo = computeTopology("/home/jerry/proj", "/home/jerry", { platform: "posix" });
    assert.deepEqual(
      topo.mounts.map((m) => m.root),
      ["/home/jerry"],
    );
    assert.equal(topo.virtualCwd, "/home/jerry/proj");
    assert.equal(topo.virtualHome, "/home/jerry");
  });

  it("cwd outside home: home and project mounts", () => {
    const topo = computeTopology("/opt/proj", "/home/jerry", { platform: "posix" });
    assert.deepEqual(
      topo.mounts.map((m) => m.root),
      ["/home/jerry", "/opt/proj"],
    );
    assert.equal(topo.virtualCwd, "/opt/proj");
  });

  it("cwd as ancestor of home: single covering mount, home still reachable", () => {
    const topo = computeTopology("/home", "/home/jerry", { platform: "posix" });
    assert.deepEqual(
      topo.mounts.map((m) => m.root),
      ["/home"],
    );
    assert.equal(topo.virtualCwd, "/home");
    assert.equal(topo.virtualHome, "/home/jerry");
    assert.equal(topo.hostToVirtual("/home/jerry/proj/x.ts"), "/home/jerry/proj/x.ts");
  });

  it("cwd == home: one mount", () => {
    const topo = computeTopology("/home/jerry", "/home/jerry", { platform: "posix" });
    assert.equal(topo.mounts.length, 1);
    assert.equal(topo.virtualCwd, "/home/jerry");
  });

  it("home == \"/\": root dropped, project mount only, virtualHome falls back to \"/\"", () => {
    const topo = computeTopology("/home/jerry/proj", "/", { platform: "posix" });
    assert.deepEqual(
      topo.mounts.map((m) => m.root),
      ["/home/jerry/proj"],
    );
    assert.equal(topo.virtualHome, "/");
  });

  it("hostToVirtual returns null under no mount", () => {
    const topo = computeTopology("/opt/proj", "/home/jerry", { platform: "posix" });
    assert.equal(topo.hostToVirtual("/etc/passwd"), null);
  });

  it("symlinked cwd canonicalizes onto the same mount as its realpath", () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "pi-topo-real-"));
    const link = path.join(os.tmpdir(), `pi-topo-link-${process.pid}`);
    fs.symlinkSync(real, link);
    try {
      const topo = computeTopology(link, "/nonexistent-home-xyz", { platform: "posix" });
      const roots = topo.mounts.map((m) => m.root);
      // The mount root is the canonical realpath, not the symlinked spelling.
      assert.ok(roots.includes(fs.realpathSync.native(real)));
      assert.ok(!roots.includes(link));
      assert.equal(topo.virtualCwd, fs.realpathSync.native(real));
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("computeTopology (win32)", () => {
  const drives = ["C:\\", "D:\\"];

  it("drives mounted at MSYS form; cwd under a drive adds nothing", () => {
    const topo = computeTopology("C:\\Users\\jerry\\proj", "C:\\Users\\jerry", {
      platform: "win32",
      drives,
    });
    assert.deepEqual(
      topo.mounts.map((m) => m.at),
      ["/c", "/d"],
    );
    assert.equal(topo.virtualCwd, "/c/Users/jerry/proj");
    assert.equal(topo.virtualHome, "/c/Users/jerry");
  });

  it("cwd on another drive maps to that drive's mount", () => {
    const topo = computeTopology("D:\\work\\proj", "C:\\Users\\jerry", {
      platform: "win32",
      drives,
    });
    assert.equal(topo.virtualCwd, "/d/work/proj");
  });

  it("off-casing cwd maps case-insensitively", () => {
    const topo = computeTopology("c:\\users\\JERRY\\proj", "C:\\Users\\jerry", {
      platform: "win32",
      drives,
    });
    assert.equal(topo.virtualCwd, "/c/users/JERRY/proj");
  });

  it("UNC cwd gets its own mount", () => {
    const topo = computeTopology("\\\\server\\share\\proj", "C:\\Users\\jerry", {
      platform: "win32",
      drives,
    });
    assert.deepEqual(
      topo.mounts.map((m) => m.root),
      ["C:\\", "D:\\", "\\\\server\\share\\proj"],
    );
    assert.equal(topo.virtualCwd, "//server/share/proj");
  });
});
