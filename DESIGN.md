# pi-subagent-tools — Design & Philosophy

## What this is

A pi extension that provides three specialized subagent tools. The
agent is a **project manager**, not a worker that occasionally spawns helpers.
The agent delegates by default and dives into details only when necessary.

## What this is not

- Not an agent definition framework (no `.md` agent files, no discovery, no
  builtin role catalog)
- Not an orchestration engine (no chains, no parallel fanout, no dynamic
  expansion, no lifecycle management)
- Not a configuration surface (no settings overrides, no management CRUD)
- Not a replacement for pi-subagents — different philosophy, different audience

## Philosophy

**The agent is the manager.** Tools are named after management activities, not
after implementation mechanisms. The agent doesn't pick a "mode" — it picks the
verb that matches what it's trying to do:

- "I need this reviewed" → `review`
- "I need to understand another project" → `explore`
- "I need someone to do this work" → `delegate`

**Correctness by construction.** Each tool hardcodes the invariants that matter
for its role. You can't forget to make a reviewer read-only because `review`
doesn't have a `readonly` parameter — it always spawns with
`--tools read,grep,find,ls`. You can't forget to point an explorer at the right
project because `cwd` is required on `explore`.

**Cache-conscious by default.** `delegate` spawns without `--tools` filtering
and without `--append-system-prompt`. The child gets the identical system
prompt and tool set as the parent. When combined with context inheritance
(future), the provider can deliver full cache hits on system prompt +
conversation history. Only the new task text consumes fresh tokens.

**No runtime file I/O.** System prompts for `review` and `explore` are static
`.md` files shipped with the extension, referenced by path. No temp files
created at runtime, no cleanup needed. Tasks pass inline as CLI arguments —
no spill-to-file machinery.

## Tool surface

```
Tool       Parameters               Child tools           CWD
─────────────────────────────────────────────────────────────────
review     task, skills?            read,grep,find,ls     parent
explore    task, cwd, skills?       read,grep,find,ls     required
delegate   task, cwd?, skills?,     all (parent's tools)  optional
           context?
```

### `review`

For inspecting code, diffs, or files in the current project. Always read-only.
Always uses the parent's CWD. System prompt loaded from shipped `prompts/review.md`.

### `explore`

For mapping external codebases. `cwd` is required — the explorer runs in the
target project's directory, picking up its `.pi/settings.json`, skills,
AGENTS.md, etc. Always read-only. System prompt loaded from shipped
`prompts/explore.md`.

### `delegate`

The general-purpose worker. No tool filtering, no system prompt override —
identical spawn to the parent for optimal cache reuse. Use for implementation,
investigation, or anything that doesn't fit `review` or `explore`.

`context: "inherit"` is reserved for future session-forking support. Currently
ignored — all subagents use fresh context (`--no-session`).

## Recursion guard

Subagent tools prevent infinite nesting via environment variable and
conditional registration:

```
PI_SUBAGENT_TOOLS_ROLE  | review  | explore | delegate
────────────────────────┼─────────┼─────────┼──────────
undefined (parent)      | active  | active  | active
"delegate"              | active  | active  | registered, rejects at runtime
"review"                | hidden  | hidden  | hidden
"explore"               | hidden  | hidden  | hidden
```

- **Parent** has the full toolkit.
- **delegate children** can spawn `review`/`explore` to check their own work or
  scout dependencies. They cannot delegate further — `delegate` is registered
  but rejects at runtime (keeps cache compatibility with the parent).
- **review/explore children** get no subagent tools at all. They are leaf
  workers.

## Error handling philosophy

**External errors report gracefully.** Pi not found, permission denied, invalid
CWD — these produce clear error messages returned to the parent agent. The
spawn error handler captures the actual OS error message rather than a generic
"failed" string.

**Internal errors fail loudly.** Synchronous errors from argument construction
propagate to pi's tool framework. CWD validation fails before spawning with a
descriptive message.

**No silent fallbacks.** There is no task spill fallback — if a task exceeds
the OS argument length limit, it fails rather than silently writing to a file.
There is no temp file creation at runtime — prompts are static shipped files.
Every `if` has an `else` that either handles the error path or is intentionally
a no-op with a comment explaining why.

## Implementation structure

```
index.ts       — Extension entry. Role guard, schemas, tool registration, CWD validation.
spawn.ts       — Shared spawn core. Pi detection, arg construction, JSONL parsing,
                 progress callbacks, result extraction. No runtime file I/O.
tui.ts         — Formatting helpers (shortenPath, formatDuration, formatTokens).
prompts/       — Static system prompt files shipped with the extension.
  review.md    — System prompt for review subagents.
  explore.md   — System prompt for explore subagents.
```

Each tool is ~30 lines in `index.ts`. The shared core in `spawn.ts` is ~300
lines. The TUI helpers in `tui.ts` are ~30 lines.

## What we reused from pi-subagents

| Source | What | Why |
|--------|------|-----|
| `formatters.ts` | `shortenPath`, `formatDuration`, `formatTokens` | Battle-tested display helpers. No dependencies, handle edge cases. |
| `utils.ts` | `getFinalOutput` pattern | Iterates messages backwards, skips error stops. Subtle bugs to avoid. |
| `pi-spawn.ts` | `getPiSpawnCommand` pattern | Robust pi detection with npm-global fallback on Windows. |
| Extension `index.ts` | `renderCall` / `renderResult` conventions | `theme.fg("toolTitle", theme.bold(...))` styling consistency. |

## What we deliberately did not reuse

Everything else in pi-subagents is orchestration overhead for our purposes:
agents subsystem, chains, parallel execution, async tracking, intercom,
acceptance gates, control system, worktree isolation, slash commands, dynamic
fanout, temp file spill logic. That's ~90% of the codebase.
