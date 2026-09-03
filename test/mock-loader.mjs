/**
 * Module resolution hook for tests.
 *
 * Redirects the two pi packages to lightweight mocks so tests can import
 * the extension source without loading the real SDK (and without copying
 * anything into node_modules — the old pretest approach clobbered the real
 * packages and broke tsc until the next npm install).
 *
 * Registered via test/register-mocks.mjs.
 */

import { pathToFileURL, fileURLToPath } from "node:url";
import * as path from "node:path";

const mocksDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "mocks",
);

const MOCKED = new Map([
  [
    "@earendil-works/pi-coding-agent",
    path.join(mocksDir, "@earendil-works/pi-coding-agent/index.js"),
  ],
  [
    "@earendil-works/pi-tui",
    path.join(mocksDir, "@earendil-works/pi-tui/index.js"),
  ],
]);

export async function resolve(specifier, context, nextResolve) {
  const target = MOCKED.get(specifier);
  if (target) {
    return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
