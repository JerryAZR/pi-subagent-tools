/**
 * pi-subagent-tools — Specialized subagent delegation for pi
 *
 * Registers four tools for the "agent as project manager" workflow:
 *   review    — Read-only code review in the current project
 *   explore   — Read-only exploration of external projects (requires cwd)
 *   delegate  — General-purpose worker with full tool access
 *   follow_up — Continue an existing subagent's session with full context
 *
 * Subagents run in-process as SDK AgentSessions (see agents.ts). Interactive
 * prompts route to the parent TUI via the UI bridge (see ui-bridge.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentManager, registerAgentTools } from "./agents.ts";

export default function (pi: ExtensionAPI) {
  registerAgentTools(pi, new AgentManager());
}
