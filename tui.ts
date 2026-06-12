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
  for (const home of [process.env.HOME, process.env.USERPROFILE, os.homedir()]) {
    if (home && p.startsWith(home)) {
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
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * Format token count with k suffix for large numbers
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
