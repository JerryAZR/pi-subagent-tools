# pi-subagents vs pi-subagent-tools

## `../pi-subagents/src/extension/index.ts` — Monolithic tool + lifecycle management

This is a ~570-line extension entry point that registers a single heavy `subagent` tool with multiple execution modes (single, parallel, chain), sync/async support, an event-driven notification system, slash-command integration, and a complex TUI widget framework for rendering results, control notices, and async job status. It maintains mutable state for foreground runs, async jobs, cleanup timers, and result-file coalescing across session lifecycles. The tool surface is parameter-rich: the agent must select among `action`, `agent`, `tasks`, `chain`, `async`, `clarify`, `worktree`, and more — with the description alone running ~40 lines.

**Comparison to pi-subagent-tools:** Our `index.ts` registers three narrow tools (`review`, `explore`, `delegate`) at ~60 lines each, with a shared `subagentExecute` helper (~20 lines). There is no internal state, no event system, no lifecycle hooks beyond the recursion guard — we hand off to `spawn.ts` and are done. The pi-subagents entry point is the "operating system" of subagents; ours is the "function call."

## `../pi-subagents/src/agents/agents.ts` — Agent discovery and configuration framework

This is an ~860-line agent discovery engine: it scans builtin, user (`~/.agents`, `~/.pi/agent/agents`), and project (`.pi/agents`, `.agents`) directories for markdown files with YAML frontmatter, parsing them into `AgentConfig` objects with models, skills, tools, system prompts, and package namespacing. It also discovers chain definitions (`.chain.md`, `.chain.json`), applies user/project overrides from `settings.json` (including bulk-disable and per-agent CRUD), and supports scoped discovery (`user` / `project` / `both`). The override system alone spans ~250 lines of validation and merging logic.

**Comparison to pi-subagent-tools:** We have no agent discovery, no configuration surface, no markdown agent files, no overrides, no chain definitions, and no management CRUD. Our three tools are hardcoded at registration time. The system prompt for `review` and `explore` comes from static `.md` files shipped with the extension; `delegate` uses the parent's system prompt directly. This eliminates the entire "agents" subsystem — roughly 90% of the pi-subagents codebase — in exchange for a surface where the LLM agent's choice of *which tool to call* is also the choice of *which role constraints to apply*.

## Summary

| Dimension | pi-subagents | pi-subagent-tools |
|---|---|---|
| Tool count | 1 (`subagent`) | 3 (`review`, `explore`, `delegate`) |
| Configuration | Agent .md files, settings.json overrides, chains, packages | None |
| Discovery | Multi-source filesystem scan + override merge | Hardcoded at registration |
| Execution modes | Single, parallel, chain, sync/async | Single synchronous spawn only |
| Recursion guard | Depth config, environment detection | 3-level env-var guard |
| TUI | Widgets, control notices, async status bars | Minimal call/result text |
| Code size | ~1500+ lines (extension + agents) | ~400 lines (extension + spawn + tui) |
| Philosophy | Define agents, then dispatch | Dispatch by picking the right tool name |
