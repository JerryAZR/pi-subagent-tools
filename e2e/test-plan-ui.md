# E2E Test Plan — UI Features

Run each test in a separate pi session. Load the extension from the project root:

```
pi -e .
```

Focus on observing the TUI during and after subagent execution.

---

## 1. Multi-turn delegate — observe progress updates

**Prompt:**
```
Use the delegate tool to inspect the pi-subagents project at ../pi-subagents. First read ../pi-subagents/src/extension/index.ts (the main extension entry), then read ../pi-subagents/src/agents/agents.ts (the agent discovery), then write a comparison to e2e/comparison.md comparing their subagent approach to ours. Keep it brief — one paragraph per file.
```

**Expect during execution:**
- Tool call card shows "delegate" with task preview
- Progress updates appear: "Turn 1: read", "Turn 2: read", "Turn 3: read", "Turn 4: write", "Turn 5: thinking..."
- Each update shows after the subagent completes a turn

**Expect after completion:**
- Compact view: `✓` + first line of output + `(Ctrl+O to expand)`
- Press Ctrl+O → expanded view with `─── Result ───` separator
- Markdown-formatted comparison output
- Usage stats: "N turns · Xk tok" at bottom
- File e2e/comparison.md exists with the comparison content

---

## 2. Review with multiple file reads — test compact/expanded toggle

**Prompt:**
```
Use the review tool to review our entire project for issues. Read index.ts, spawn.ts, and tui.ts. For each file, identify potential bugs, error handling gaps, or code quality issues. Report findings organized by file with severity ratings.
```

**Expect:**
- Reviewer calls git log/diff, then reads multiple files
- Multiple turns visible in progress updates
- Compact result shows first finding line
- Ctrl+O shows full markdown report with sections per file
- Usage stats visible in expanded view

---

## 3. Explore with git history — observe git tool in action

**Prompt:**
```
Use the explore tool with cwd ".." to investigate the pi-subagent-lite project. Check its git log for recent changes, read its index.ts, and summarize its architecture compared to our project.
```

**Expect:**
- Tool call card shows "explore" with task preview AND cwd path dimmed
- Explorer uses the git tool (visible in progress: "Turn 1: git, ls" or similar)
- Output formatted with markdown in expanded view
- CWD path shown in call card

---

## 4. Delegate spawns reviewer — test nested delegation UI

**Prompt:**
```
Use the delegate tool to review our extension for security concerns. The delegate's task should be: "Use the review tool to check index.ts, spawn.ts, and tui.ts for potential security issues (command injection in git tool, path traversal in file operations, etc.). Report findings with severity ratings."
```

**Expect:**
- Delegate spawns, then spawns a reviewer
- Delegate's progress shows its own turns
- Final result from delegate includes the reviewer's findings
- Nested delegation works without errors

---

## 5. Rapid delegate — test quick turnaround

**Prompt:**
```
Use the delegate tool to run a quick bash command: list all TypeScript files in the project recursively and count them.
```

**Expect:**
- Quick single-turn or two-turn execution
- Compact view shows file count
- Usage stats show "1 turn" (or 2)

---

## 6. Delegate with CWD override — test task preview

**Prompt:**
```
Use the delegate tool with cwd "e2e" to create a file called test-output.txt containing the text "E2E test output\n" followed by a list of all files in the e2e directory.
```

**Expect:**
- Tool call card shows "delegate" with task AND cwd path dimmed
- File e2e/test-output.txt exists with expected content
- Compact/expanded toggle works
