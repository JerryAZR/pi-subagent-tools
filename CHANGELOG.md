# Changelog

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
