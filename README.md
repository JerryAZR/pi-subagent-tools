# @jerryan/pi-subagent-tools

A minimal pi extension for delegating work to isolated subagent processes. Three tools, one job each. The agent is a **project manager** — delegate by default, dive in only when necessary.

## What makes this different?

Every subagent is a fresh `pi` process with an isolated context window. No agent definitions to write, no configuration files to maintain, no mode-switching parameters to misconfigure. Each tool's name *is* the contract:

- **`review`** — always read-only, always in the current project. You can't forget to lock it down.
- **`explore`** — always read-only, requires a target directory. Picks up the target project's settings, skills, and context.
- **`delegate`** — general-purpose worker. Inherits the parent's tools and system prompt for optimal cache reuse. Optional CWD and skills.

## Installation

```bash
pi install npm:@jerryan/pi-subagent-tools
```

The extension is available the next time you start a pi session.

## Tools

### `review`

Review code, diffs, or files in the current project. The reviewer is always read-only — it cannot modify files or execute commands.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | What to review |
| `skills` | string[] | No | Skills to load via `--skill` |

### `explore`

Map a project directory. The explorer runs in the target directory, picking up its `.pi/settings.json`, skills, AGENTS.md, and other context files. Always read-only.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | What to explore |
| `cwd` | string | Yes | Target project directory |
| `skills` | string[] | No | Skills to load via `--skill` |

### `delegate`

General-purpose worker. No tool filtering, no system prompt override — the subagent inherits the parent's full environment, enabling cache hits when used with context inheritance (future).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task` | string | Yes | Task to delegate |
| `cwd` | string | No | Working directory (defaults to parent's CWD) |
| `skills` | string[] | No | Skills to load via `--skill` |
| `context` | `"fresh"` \| `"inherit"` | No | Context mode (not yet implemented) |

## Recursion guard

Subagents cannot spawn further subagents beyond one level:

| Parent role | `review` | `explore` | `delegate` |
|-------------|:--:|:--:|:--:|
| Parent (normal) | ✓ | ✓ | ✓ |
| Delegate child | ✓ | ✓ | Rejects at runtime |
| Review / explore child | — | — | — |

## Related

- **[pi-subagents](https://github.com/nicobailon/pi-subagents)** — Feature-rich implementation with agent definitions, background runs, session forking, inter-process communication, and a full management UI. The definitive reference for what's possible, though possibly more than most workflows need.
- **[pi-subagent-lite](https://github.com/JerryAZR/pi-subagent-lite)** — Ultra-minimal (~250 lines). A single `task` tool with minimal context overhead.

## License

MIT
