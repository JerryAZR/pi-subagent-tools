/**
 * Registers the mock module-resolution hook for the test run.
 * Loaded via `node --import` so it applies before any test module loads
 * (the test runner propagates execArgv to per-file child processes).
 */

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);
