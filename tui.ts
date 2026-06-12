/**
 * TUI rendering helpers for pi-subagent-tools.
 *
 * Tool call cards, result display, progress indicators.
 */

import * as os from "node:os";

/**
 * Shorten a path by replacing the home directory with ~
 */
export function shortenPath(p: string): string {
  const normalized = p.toLowerCase();
  for (const home of [process.env.HOME, process.env.USERPROFILE, os.homedir()]) {
    if (home && normalized.startsWith(home.toLowerCase())) {
      return `~${p.slice(home.length)}`;
    }
  }
  return p;
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}s`;
}

/**
 * Format token count with k suffix for large numbers
 */
export function formatTokens(n: number): string {
  let s: string;
  if (n < 1000) s = String(n) + "   ";  // trailing spaces give same visual weight as k/M suffix; padStart right-aligns
  else if (n < 1_000_000) s = (Math.trunc(n / 100) / 10).toFixed(1) + "k";
  else s = (Math.trunc(n / 100_000) / 10).toFixed(1) + "M";
  return s.padStart(6);
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createSpinner(): () => string {
  let idx = 0;
  return () => {
    const frame = SPINNER[idx];
    idx = (idx + 1) % SPINNER.length;
    return frame;
  };
}

export interface UsageStats {
  turns: number;
  input: number;
  output: number;
  total: number;
  durationMs: number;
}

export function formatUsage(u: UsageStats, spin: () => string): string {
  const parts: string[] = [`${spin()} · Turn ${u.turns}`];
  parts.push(`Tokens: input ${formatTokens(u.input)} | output ${formatTokens(u.output)}`);
  if (u.durationMs != null) parts.push(formatDuration(u.durationMs));
  return parts.join(" · ");
}
