# Changelog

## 0.4.3

### Fixed

- **Subagent role prompts no longer leak into pi's slash commands.** The
  shipped `prompts/` directory doubles as pi's conventional prompt-template
  directory, so pi's package loader exposed `delegate.md`, `explore.md`, and
  `review.md` as `/delegate`, `/explore`, and `/review` templates. This
  happened whenever the package was loaded through a settings filter that
  named only `extensions` — the loader falls back to conventional-directory
  discovery for resource types absent from both the filter and the package
  manifest, and the manifest declared none. The `pi` manifest now pins
  `"prompts": []` so the package's resource set is exactly its extension;
  the role prompts remain loadable by the subagent tools alone.

## 0.4.2

### Added

- **follow_up now compacts the agent's context first when usage exceeds
  50%.** Model capability degrades well before the context window fills,
  and compacting between tasks — a natural pause point — beats the SDK's
  mid-run auto-compaction. Failures that mean "nothing to compact by the
  session's own policy" (or a refused partial summary) proceed without
  compaction; every other failure (rate limits, auth, network) fails the
  follow-up loudly — a transient 429 recovering by the next call must not
  silently downgrade to an uncompacted run.
- **Sandboxed bash `timeout` parameter** (seconds, default 60,
  caller-chosen). Deadline failures report exit code 124, the GNU
  timeout(1) convention.

### Changed

- **Bumped `@jerryan/just-bash` to ^3.11.1** — aborting a sandboxed bash
  call while `find`'s parallel batch traversal was in flight crashed the
  host pi process (unhandled rejections from `Promise.all`; only the
  first was caught). Abort now propagates cleanly as exit code 124.
- **Delegate children no longer see the `delegate` tool at all**
  (previously registered but always rejected). The recursion guard is now
  purely structural — there is no tool to call and no error path to hit.
  The old rejecting registration existed only to keep child tool lists
  byte-identical to the parent's for prefix-cache hits; without context
  inheritance that trade no longer pays.
- Trimmed model-facing tool and parameter descriptions — removed guidance
  duplicated by snippets, guidelines, and runtime error messages.

### Internal

- `npm run typecheck` (`tsc --noEmit`) added and wired into CI; tsconfig
  gains `allowImportingTsExtensions`. First run caught a real drift:
  just-git's vendored stat types (`dev`/`ino: number`) vs the fork's
  widened `FsStat` (`number | bigint`) — contained with a documented cast
  at the `createGit` call site until just-git's types catch up.
- LICENSE copyright holder filled in.

## 0.4.1

### Changed

- **Bumped `@jerryan/just-bash` to ^3.11.0.** Brings in the October
  upstream-sync batch: `mktemp` and `yes` commands, `MountableFs` sync
  writes with the standard layout set up in the base filesystem, and
  correctness fixes for `break`/`continue` exit status, `${var:-default}`
  under `set -u`, associative arrays, repeated `grep -e`, `find` on
  unreadable directories, `jq to_entries`/`tonumber`, and `curl -d @-`.
  The `undici` runtime dependency is dropped.

## 0.4.0

### Changed

- **Sandbox bash now uses real-layout mounts instead of a fixed `/repo`.**
  On posix, `$HOME` is mounted at its own path (plus the project root when
  the cwd is outside home — read-only agents may read other projects); on
  Windows, every existing drive is mounted at MSYS form (`C:\` = `/c`).
  Sandbox paths match host paths one-to-one, so paths move verbatim between
  bash and the `read` tool. Everything outside the mounts remains per-call
  in-memory scratch.
- **Switched `just-bash` for the `@jerryan/just-bash` fork** (^3.10.0),
  which adds the Windows native-spelling path translation the real-layout
  scheme relies on, plus extra default utilities (jq, yq, sqlite3, rg,
  xan).
- **New sandboxed `python` tool for review/explore children**: stdlib-only
  WASM CPython over the same read-only filesystem, for dependency-free
  analysis scripts. It is a separate tool — NOT a `python3` command in
  the bash sandbox — because a bare `python3` on PATH implies the native
  interpreter (project env, pip), a capability the WASM build doesn't
  have; the dedicated tool makes the stdlib-only contract explicit.
  (The role allowlist must name `python`: pi filters customTools through
  it — a custom-only tool name missing from the allowlist is silently
  dropped.)
- **`just-git` bumped to ^1.9.0**, which fixes the CRLF `.gitignore`
  parsing quirk (Windows checkouts with `core.autocrlf=true` had ignore
  rules silently no-op inside the sandbox).
- Trimmed the sandboxed bash tool description to behavioral deltas from
  stock bash (read-only, no network, stateless per call).

## 0.3.0

### Changed

- **Review/explore children now get a sandboxed read-only `bash`** instead of
  the `grep`/`find`/`ls` builtins plus the dedicated `git` tool. The sandbox
  is a just-bash interpreter over a composed filesystem: the project root
  mounted read-only at `/repo` (OverlayFs) over a writable in-memory base
  (MountableFs) providing `/dev/null` and per-call scratch (`/tmp`). Git is
  provided by just-git inside the sandbox (network disabled). Read-only is
  now enforced at the capability layer — the filesystem rejects every write
  to the project (redirects, `rm`, `sed -i`, git object/ref updates) —
  replacing the per-subcommand git policy table. The tool surface shrinks to
  `read` + `bash`; the sandboxed `bash` shadows the builtin (custom tools
  win over builtins), so there is no configuration in which a raw builtin
  bash reaches a read-only child.
- The dedicated `git` tool is removed; git inspection (log, diff, show,
  blame, grep, ls-files) goes through the sandbox.
  Known limitation: just-git's `.gitignore` parser does not strip carriage
  returns — on Windows (CRLF `.gitignore`) ignore rules silently no-op, so
  `git status` walks the unpruned worktree (slow) and reports ignored paths
  as untracked; the tool description steers agents to targeted commands.

### Added

- New runtime dependencies: `just-bash`, `just-git`.

## 0.2.0

**Subagents now run in-process** via the pi SDK (`createAgentSession`) instead
of as spawned `pi` subprocesses. Requires pi >= 0.84.

- **New `follow_up` tool.** Every spawn result includes an agent id
  (e.g. `delegate-1`). `follow_up({ agent, task })` continues that agent's
  session with full context — for refining work, asking questions, or
  recovering from incomplete/failed results. Agents keep their original role,
  tools, and cwd for life.
- **Interactive prompts route to the parent TUI.** Subagent `select` /
  `confirm` / `input` / `editor` requests are bridged to the parent's UI
  instead of silently falling back to defaults (ui-bridge.ts).
- **Agent lifetime management.** Agents are kept in a registry and disposed
  only after 10+ idle turns (running agents are never disposed), or when the
  owning session ends.
- Tool errors are now reported by throwing, matching pi >= 0.84 tool semantics.
- The read-only git tool is fully async (subagents share the parent's event
  loop; a blocking exec would freeze the TUI), and its read-only enforcement
  is now a per-subcommand policy table — mutating flags (`branch -D`,
  `diff --output=...`) and branch creation via positional args are rejected.

Breaking changes:

- Removed `delegate`'s `context` parameter (was a no-op placeholder).
- Recursion guard is now structural (child sessions get exactly the tools
  injected by the extension) — the `PI_SUBAGENT_TOOLS_ROLE` env var is gone.
- Child sessions no longer load user/project extensions (created with
  `noExtensions: true`); skills and system prompts still apply. **Exception:**
  delegate children DO discover user/project extensions (they are workers and
  need the parent's environment, including guard extensions) — with this
  extension itself excluded from discovery (that exclusion is the recursion
  guard) and project-local extensions excluded in untrusted projects.

## 0.1.1

- Add delegate system prompt. Subagents now do the work directly instead of discussing plans. Minor uncertainties proceed with stated assumptions; major obstacles are reported back with a suggestion to re-delegate.

## 0.1.0

Initial release. Delegate, review, and explore tools via isolated pi subagent processes.
