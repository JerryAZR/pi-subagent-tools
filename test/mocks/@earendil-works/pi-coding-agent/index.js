// Minimal mock of @earendil-works/pi-coding-agent for tests.
// Only the runtime values imported by the extension modules are stubbed.

export function getMarkdownTheme() {
  return {};
}

export function defineTool(def) {
  return def;
}

export function getAgentDir() {
  return "/tmp/pi-test-agent-dir";
}

export const CONFIG_DIR_NAME = ".pi";

export class ModelRuntime {
  static async create() {
    return new ModelRuntime();
  }
}

export class SessionManager {
  static inMemory() {
    return new SessionManager();
  }
}

export class SettingsManager {
  static create() {
    return new SettingsManager();
  }
}

export class DefaultResourceLoader {
  constructor(_options) {}
  async reload() {}
}

export async function createAgentSession() {
  throw new Error("createAgentSession is not available in tests — inject deps.spawnSession");
}
