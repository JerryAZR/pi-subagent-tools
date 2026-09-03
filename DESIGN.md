# pi-subagent-tools — Design & Philosophy

## What this is

A pi extension that provides four specialized subagent tools. The
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
- "I need to talk to that worker again" → `follow_up`

**Correctness by construction.** Each tool hardcodes the invariants that matter
for its role. You can't forget to make a reviewer read-only because `review`
doesn't have a `readonly` parameter — it always spawns with
`read` plus a sandboxed read-only bash. You can't escalate a reviewer
into a worker because `follow_up` confers no capabilities — role is bound at
spawn, never at call time. Creation parameters (`cwd`, `skills`) exist only on
creation verbs, so "what does cwd mean on resume?" is unexpressible rather
than validated.

**Delegates inherit the user's environment.** A delegate child discovers and
loads user/project extensions exactly like a fresh `pi` in that cwd — custom
tools work, and guard extensions (write blockers, policy checkers) guard the
subagent just as they guard the parent. Two exclusions apply: this extension
itself (its discovered copy would register an unguarded `delegate` —
self-exclusion IS the recursion guard), and project-local extensions in
untrusted projects (mirroring pi's trust model, which the raw SDK path does
not enforce). Review/explore children deliberately get none of this: their
minimal fixed surface is the point.

**Subagents are sessions, not subprocesses.** Subagents run in-process via the
pi SDK (`createAgentSession`), each an isolated `AgentSession` with its own
context window, tools, and settings. Sessions are in-memory
(`SessionManager.inMemory`) — no backing files, the in-process equivalent of
`--no-session`. This buys:

- **Follow-ups for free.** A live session can simply be prompted again. The
  whole trajectory stays in context; the provider cache hits on history.
- **Interactive prompts that actually work.** Each child session is bound to a
  UI bridge (`session.bindExtensions({ uiContext, mode: "rpc" })`) that
  forwards `select`/`confirm`/`input`/`editor` to the parent's TUI instead of
  silently taking defaults. Dialog opts (`signal`, `timeout`) pass through.
- **No process machinery.** No pi detection, no JSONL parsing, no signal
  handling, no startup cost per subagent.

The cost is process isolation: a pathological child shares the parent's event
loop and memory. Agent loops are async I/O-bound, so this is mostly
theoretical, but it is the deliberate tradeoff of this design.

**Cache-conscious by default.** `delegate` children use the parent's current
model and thinking level, the same default system prompt, and the same
default tool set (no allowlist). Role prompts are appended via the resource
loader's `appendSystemPrompt`, referencing static shipped `.md` files by path.

**No runtime file I/O.** System prompts for all roles are static `.md` files
shipped with the extension, referenced by path (the resource loader reads
them). No temp files created at runtime, no cleanup needed.

## Tool surface

```
Tool       Parameters               Child tools           CWD
─────────────────────────────────────────────────────────────────
review     task, skills?            read, bash (sandbox)  parent
explore    task, cwd, skills?       read, bash (sandbox)  required
delegate   task, cwd?, skills?      all (defaults)        optional
follow_up  agent, task              (agent's own tools)   (agent's own cwd)
```

The sandboxed `bash` is a read-only just-bash environment (project root
mounted at `/repo`, ~80 utilities, git with no network, stateless per call).
See "read-only is enforced at the capability layer" in DESIGN.md.

### `review`

For inspecting code, diffs, or files in the current project. Always read-only.
Always uses the parent's CWD. System prompt appended from shipped
`prompts/review.md`.

### `explore`

For mapping external codebases. `cwd` is required — the explorer runs in the
target project's directory, picking up its `.pi/settings.json`, skills,
AGENTS.md, etc. Always read-only. System prompt appended from shipped
`prompts/explore.md`.

### `delegate`

The general-purpose worker. No tool filtering — the child gets the default
built-in tools (read, bash, edit, write) plus the subagent tools below.
System prompt appended from shipped `prompts/delegate.md`.

### `follow_up`

Continues an existing agent's session with a new user message. Two
parameters only — `agent` and `task` — because everything else was fixed at
spawn. Unknown or expired ids fail loudly with the list of live agents;
there is no silent fresh spawn.

Every spawn and follow-up result ends with an `agent: <id>` footer so the
model can reference the agent later. Ids are `<role>-<n>`, sequential per
owning session, monotonic — the prefix tells both the model and the user
what kind of agent they're talking to.

## Agent lifetime

Agents live in a per-extension-instance registry (`AgentManager`). Cleanup is
recency-based, not count-based:

- The owning session's turn counter advances on every `turn_end`.
- An agent records `lastActiveTurn` at spawn and when each run completes
  (success or error — an errored agent you might follow up with is still
  active).
- A sweep at `turn_end` disposes agents idle for more than
  `PROTECTION_TURNS` (10) turns. There is no cap — any number of recently
  active agents survive.
- Running agents (`session.isStreaming`) are never disposed. With
  turn-scoped execution this is structural — a turn cannot end while its
  tool calls are still running — but the guard also covers a future
  background mode.
- All agents are disposed on `session_shutdown`.

Ownership is a tree: a delegate entry owns its child manager, and disposing
an entry cascades `disposeAll()` to the child before disposing the session.
No session in the tree outlives its owner.

## Recursion guard

Structural, not env-based. Child sessions are created with
`noExtensions: true` — nothing is discovered from user or project config, so
a child gets exactly the tools the extension injects:

```
Child of   | review  | explore | delegate                  | follow_up
───────────┼─────────┼─────────┼───────────────────────────┼──────────
parent     | active  | active  | active                    | active
delegate   | active  | active  | registered, rejects       | active
review     | (no subagent tools — leaf worker)
explore    | (no subagent tools — leaf worker)
```

Delegate children get their own `AgentManager` (own id namespace, own turn
tracking) via an inline extension factory, sharing the parent's
`ModelRuntime`. UI bridges chain: a grandchild's dialog prefixes accumulate
(`[delegate-1] [review-1] ...`), which honestly reports the call path.

Delegate children also discover user/project extensions (see "Delegates
inherit the user's environment"); review/explore children are created with
`noExtensions: true` and get exactly the tools injected by the extension.

## Roles as data

Everything distinguishing delegate/review/explore children lives in one
`ROLES` table: prompt file, tool allowlist, custom tools, and whether the
child gets the (guarded) subagent tool surface. Session creation is a table
lookup, not a set of per-role conditionals; adding a role means adding a row
and a tool config. Tool registration is likewise table-driven — the three
spawn tools share one `registerSpawnTool` factory, and the parent and child
tool surfaces are two explicit functions (`registerAgentTools` /
`registerChildAgentTools`) rather than a runtime flag.

## Error handling philosophy

**Tool errors are thrown.** Pi >= 0.84 marks tool results as errors when the
tool throws (returning `isError` in the result object is no longer
supported). All failure paths — invalid cwd, unknown agent id, subagent
failure, abort — throw with a descriptive message that becomes the tool
result content.

**Own throws never appear inside a try body.** A `fail()` thrown inside a
try is caught by its own catch and re-wrapped into a misleading message
(this bug shipped and was caught in review). The structural rule: try
bodies contain only foreign calls (syscall, SDK); policy checks and our own
throws live outside, and catch blocks only *translate* foreign errors into
our messages.

**Errors keep the agent addressable.** When a subagent run fails (assistant
error stop, exception from `prompt()`), the agent stays registered and the
thrown message includes the `agent: <id>` footer — `follow_up` is the
recovery path.

**No silent fallbacks.** Unknown or expired agent ids are loud errors with
the live-agent list, never a fresh spawn. Suppressed UI methods (chrome
hijacking: `setTitle`, `setFooter`, editor manipulation, terminal input) are
documented no-ops, matching pi's RPC-mode degradation contract.

**Read-only is enforced at the capability layer, not by inspecting commands.**
Review/explore children get `read` plus a `bash` that is actually a just-bash
interpreter over a read-only OverlayFs mount of the project root (custom
tools shadow builtins of the same name — fail-closed). Every write fails
with EROFS at the filesystem itself: shell redirects, `rm`, `sed -i`, git
index updates, tools we never thought of. just-git provides git inside the
sandbox with `network: false`; a `disabled` list of pure-mutator verbs
exists only for clean UX errors — enforcement never depends on it. This
replaced an earlier per-subcommand policy table, which could only ever
cover the commands someone remembered to enumerate. Known approximation:
the interpreter is a bash reimplementation, so exotic syntax a real bash
would run may parse differently — the failure direction is safe (the
command errors, nothing executes).

## Implementation structure

```
index.ts       — Extension entry. Creates the AgentManager, registers tools.
agents.ts      — AgentManager (registry, lifetime, spawn/follow-up), session
                 creation, progress bridging, tool registration, schemas.
sandbox-bash.ts — The read-only bash tool for review/explore children
                 (just-bash + just-git over a read-only OverlayFs).
ui-bridge.ts   — ExtensionUIContext forwarding child prompts to the parent
                 TUI. Process-wide dialog serialization queue.
render.ts      — Tool call/result rendering (CompactPreview, usage footer).
git-tool.ts    — Read-only git customTool for review/explore children.
tui.ts         — Formatting helpers (shortenPath, formatDuration, formatTokens).
prompts/       — Static system prompt files shipped with the extension.
```

## What we reused from pi-subagents

| Source | What | Why |
|--------|------|-----|
| `formatters.ts` | `shortenPath`, `formatDuration`, `formatTokens` | Battle-tested display helpers. No dependencies, handle edge cases. |
| `utils.ts` | `getFinalOutput` pattern | Iterates messages backwards, skips error stops. Subtle bugs to avoid. |

## What we deliberately did not reuse

Everything else in pi-subagents is orchestration overhead for our purposes:
agents subsystem, chains, parallel execution, async tracking, intercom,
acceptance gates, control system, worktree isolation, slash commands, dynamic
fanout, temp file spill logic. That's ~90% of the codebase.

## Historical note: the subprocess design (0.1.x)

Versions 0.1.x spawned each subagent as a fresh `pi --mode json -p
--no-session` subprocess. That design gave process isolation but made two
things unfixable: interactive prompts in children silently fell back to
defaults (json/print mode binds a no-op UI context), and without a backing
session there was no way to ask follow-up questions. The in-process SDK
design (0.2.0) solves both. The subprocess implementation is preserved in
git history.
