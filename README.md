# @jerryan/pi-subagent-tools

A minimal pi extension for delegating work to subagents. Four tools, one job each. The agent is a **project manager** — delegate by default, dive in only when necessary.

## What makes this different?

Every subagent is an isolated `AgentSession` running in-process via the pi SDK — its own context window, its own tools, no configuration files to maintain. Each tool's name *is* the contract:

- **`review`** — always read-only, always in the current project. You can't forget to lock it down.
- **`explore`** — always read-only, requires a target directory. Picks up the target project's settings, skills, and context.
- **`delegate`** — general-purpose worker with full tool access. Optional CWD and skills.
- **`follow_up`** — continue any spawned agent's session with full context. No re-explaining, no lost work.

Interactive prompts from subagents (confirmations, selections, inputs) appear in your TUI instead of silently falling back to defaults.

## Installation

```bash
pi install npm:@jerryan/pi-subagent-tools
```

The extension is available the next time you start a pi session. Requires pi >= 0.84.

## Tools

### `review`

Review code, diffs, or files in the current project. The reviewer is always read-only: it gets `read` plus a sandboxed bash (just-bash over a read-only mount of your project — grep, find, sed, git log/diff/blame all work; every write fails at the filesystem).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | What to review |
| `skills` | string[] | No | Skills to load |

### `explore`

Map a project directory. The explorer runs in the target directory, picking up its `.pi/settings.json`, skills, AGENTS.md, and other context files. Always read-only, with the same sandboxed bash as the reviewer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | What to explore |
| `cwd` | string | Yes | Target project directory |
| `skills` | string[] | No | Skills to load |

### `delegate`

General-purpose worker. Full tool access (read, bash, edit, write), and loads your user/project extensions like a fresh pi would — custom tools and guard extensions apply to the worker just as they do to you. Uses the parent's current model and thinking level.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Task to delegate |
| `cwd` | string | No | Working directory (defaults to parent's CWD) |
| `skills` | string[] | No | Skills to load |

### `follow_up`

Send a follow-up task to a previously spawned subagent, continuing its session with full context. The agent retains its original role, tools, and working directory — a reviewer stays read-only forever.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | Agent id from a previous result (e.g. `delegate-1`) |
| `task` | string | Yes | Follow-up task or question |

Every spawn and follow-up result ends with the agent's id:

```
<the subagent's output>

---
agent: delegate-1
```

Unknown or expired ids fail loudly with the list of live agents — never a silent fresh spawn.

## Agent lifetime

Agents live in a per-session registry. Cleanup is recency-based:

- An agent idle for more than **10 turns** of the owning session is disposed.
- Running agents are never disposed. Recently active agents are never disposed — there is no count cap; a burst of 20 parallel delegates all run to completion.
- All agents are disposed when the owning session ends.

## Recursion guard

Subagent nesting is capped structurally — child sessions are created with extension discovery disabled, so they get exactly the tools the extension injects:

| Parent role | `review` | `explore` | `delegate` | `follow_up` |
|-------------|:--:|:--:|:--:|:--:|
| Parent (normal) | ✓ | ✓ | ✓ | ✓ |
| Delegate child | ✓ | ✓ | Rejects at runtime | ✓ |
| Review / explore child | — | — | — | — |

A delegate child's agents live in their own registry with their own ids.

## Related

- **[pi-subagents](https://github.com/nicobailon/pi-subagents)** — Feature-rich implementation with agent definitions, background runs, session forking, inter-process communication, and a full management UI. The definitive reference for what's possible, though possibly more than most workflows need.
- **[pi-subagent-lite](https://github.com/JerryAZR/pi-subagent-lite)** — Ultra-minimal (~250 lines). A single `task` tool with minimal context overhead.

## License

MIT
