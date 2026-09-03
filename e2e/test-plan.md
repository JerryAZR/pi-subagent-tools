# E2E Test Plan

Run each test in a separate pi session. Load the extension from the project root:

```
pi -e .
```

After each test, check the subagent output for correctness.

---

## 1. Review — basic code inspection

**Prompt:**
```
Use the review tool to check agents.ts for error handling issues. Focus on silent error swallowing.
```

**Expect:**
- A `review` tool call appears
- The reviewer spawns and inspects agents.ts
- Output includes findings about error handling (or confirms no issues)
- Tool card shows `review` label

---

## 2. Review — with skills

**Prompt:**
```
Use the review tool with skills ["code-review"] to review index.ts.
```

**Expect:**
- Reviewer loads the code-review skill
- Output references the skill's review patterns

---

## 3. Explore — current project

**Prompt:**
```
Use the explore tool to map the structure of the current project. Use cwd ".".
```

**Expect:**
- Explorer lists files, identifies entry points, reports structure
- Output includes a summary of the project layout

---

## 4. Explore — external directory

**Prompt:**
```
Use the explore tool to map the parent directory (cwd "..").
```

**Expect:**
- Explorer runs in the parent directory
- Output describes files and patterns found there

---

## 5. Delegate — implementation task

**Prompt:**
```
Use the delegate tool to create a small test file called e2e/test-output.md with the content "# E2E Test Output" followed by today's date. Then verify the file was created.
```

**Expect:**
- Delegate spawns with full tool access
- Creates the file and reports success
- File exists in e2e/test-output.md

---

## 6. Delegate — read-only mode (no readonly param)

**Prompt:**
```
Use the delegate tool to review agents.ts for issues, but with a task that says "do not modify any files, only read and report."
```

**Expect:**
- Delegate spawns (no readonly param exists — verify the agent doesn't hallucinate a `readonly` field)
- Delegate reads agents.ts and reports findings without editing

---

## 7. Reviewer cannot write

**Prompt:**
```
Use the review tool to create a file called e2e/should-not-exist.md with content "test".
```

**Expect:**
- Reviewer reports it cannot create files (read-only mode)
- File e2e/should-not-exist.md does not exist

---

## 8. Reviewer has git access

**Prompt:**
```
Use the review tool to show the git log of the last commit.
```

**Expect:**
- Reviewer uses the sandboxed bash (git through just-git)
- Output shows the commit history

---

## 9. Explorer has git access

**Prompt:**
```
Use the explore tool with cwd "." to show the git diff of the most recent commit.
```

**Expect:**
- Explorer uses the sandboxed bash (git through just-git)
- Output shows the diff

---

## 10. Nested delegation — delegate rejects nested delegate

**Prompt:**
```
Use the delegate tool to spawn another delegate that says "hello". Check if nested delegation is rejected.
```

**Expect:**
- The inner delegate call fails with "Delegation not available in delegate subagents"
- Or the outer delegate reports that nested delegation was rejected

---

## 11. Delegate can spawn reviewer

**Prompt:**
```
Use the delegate tool to review agents.ts using the review tool. The delegate's task should be: "Use the review tool to check agents.ts for error handling patterns and report what you find."
```

**Expect:**
- Delegate spawns a reviewer
- Reviewer inspects agents.ts
- Delegate returns the reviewer's findings

---

## 12. Delegate can spawn explorer

**Prompt:**
```
Use the delegate tool to explore the test directory. The delegate's task should be: "Use the explore tool with cwd 'test' to list and describe the test files."
```

**Expect:**
- Delegate spawns an explorer
- Explorer lists test files
- Delegate returns the explorer's findings

---

## 13. Follow-up — refine previous work

**Prompt:**
```
Use the delegate tool to summarize the purpose of agents.ts in one sentence. Then use follow_up with the returned agent id to ask it to expand the summary to a paragraph.
```

**Expect:**
- A `delegate` tool call whose result ends with `agent: delegate-N`
- A `follow_up` tool call with that id
- The follow-up response expands the original summary (context preserved)

---

## 14. Follow-up — unknown id fails loudly

**Prompt:**
```
Use follow_up with agent "delegate-99" and task "continue".
```

**Expect:**
- The tool call fails with an error stating the agent was not found
- The error lists live agents (if any) and suggests spawning a fresh agent
- No new agent is spawned

---

## 15. Interactive prompt bridging (if a subagent extension prompts)

**Setup:** Requires a scenario where a subagent's tool triggers a
`ctx.ui.confirm` (e.g. a project-trust prompt in an untrusted explore target).

**Expect:**
- The dialog appears in the parent TUI, titled with the agent id prefix
  (e.g. `[delegate-1] ...`)
- Answering the dialog resumes the subagent's work
- Cancelling returns the documented default to the subagent
