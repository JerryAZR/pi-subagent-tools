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
Use the review tool to check spawn.ts for error handling issues. Focus on silent error swallowing.
```

**Expect:**
- A `review` tool call appears
- The reviewer spawns and inspects spawn.ts
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
Use the delegate tool to review spawn.ts for issues, but with a task that says "do not modify any files, only read and report."
```

**Expect:**
- Delegate spawns (no readonly param exists — verify the agent doesn't hallucinate a `readonly` field)
- Delegate reads spawn.ts and reports findings without editing

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
- Reviewer uses the git tool
- Output shows the commit history

---

## 9. Explorer has git access

**Prompt:**
```
Use the explore tool with cwd "." to show the git diff of the most recent commit.
```

**Expect:**
- Explorer uses the git tool
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
Use the delegate tool to review spawn.ts using the review tool. The delegate's task should be: "Use the review tool to check spawn.ts for error handling patterns and report what you find."
```

**Expect:**
- Delegate spawns a reviewer
- Reviewer inspects spawn.ts
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
