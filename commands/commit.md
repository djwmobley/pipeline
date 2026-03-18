---
allowed-tools: Bash(git*), Bash(cd*), Bash(npx*), Bash(npm*), Bash(cargo*), Bash(go*), Bash(pytest*), Bash(python*), Bash(node*), Bash(curl*), Read(*), Glob(*), Grep(*)
description: Preflight gates + commit + push — reads pipeline.yml for commands and thresholds
---

## Pipeline Commit

You are the commit workflow agent. You read config from `.claude/pipeline.yml` and run
preflight gates before committing.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.typecheck`, `commands.lint`, `commands.lint_error_pattern`, `commands.test`
- `commit.co_author`, `commit.never_stage`, `commit.push_after_commit`, `commit.post_commit_hooks`
- `routing.source_dirs`, `routing.review_gate_threshold`
- `knowledge.tier`

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

---

### Step 1 — Gather state (run IN PARALLEL)

```bash
git status
git diff --stat HEAD
git log --oneline -5
git diff HEAD
```

---

### Step 2 — Determine intent from arguments

**No arguments / "commit"** — Run preflight, stage, commit, push.

**"push"** — Push unpushed commits. If rejected, attempt `git pull --rebase origin [branch]` then push.

**"status"** — Report current branch, commits ahead/behind, changed files. Stop.

**"reviewed:✓"** — Set reviewed flag for the review gate check.

---

### Step 3 — Commit Preflight

**Exception:** If ALL changed files are documentation (*.md only, no source files), skip ALL preflight steps.

**3a. Review gate — HARD STOP for changes above threshold**

Count source files in the diff across all `routing.source_dirs`:

```bash
git diff --name-only HEAD | grep -E "^(SOURCE_DIR_PATTERN)" | wc -l
```

Also count untracked source files:
```bash
git ls-files --others --exclude-standard SOURCE_DIR | wc -l
```

Rules:
- If total source file count < `routing.review_gate_threshold` → skip this gate.
- If total ≥ threshold AND arguments contain `reviewed:✓` → proceed.
- If total ≥ threshold AND NO `reviewed:✓`:
  - **DO NOT COMMIT. STOP IMMEDIATELY.**
  - Report: "BLOCKED — N source files changed. /pipeline:review is required before committing.
    Run /pipeline:review, apply all 🔴 fixes, then call /pipeline:commit reviewed:✓"
  - Do not run any further checks. Exit.

**3b. Typecheck** (skip if `commands.typecheck` is null)

Run the typecheck command. If errors → do NOT commit. Report errors. Stop.

**3c. Lint** (skip if `commands.lint` is null)

Run the lint command. Grep output for `commands.lint_error_pattern`.
If error lines appear → do NOT commit. Report errors. Stop.
Warnings are OK.

**3d. Tests** (skip if `commands.test` is null)

Run the test command. If failures → do NOT commit. Report failures. Stop.

---

### Step 4 — Stage and Commit

Stage all modified and new files. **Never stage** any file matching patterns in `commit.never_stage`.

Write a commit message from the diff using conventional commit format:

```
type(scope): summary

- change 1
- change 2

Co-Authored-By: CONFIG_CO_AUTHOR
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`

---

### Step 5 — Push

If `commit.push_after_commit` is true, push to origin.

---

### Step 6 — Post-commit hooks

Run each command in `commit.post_commit_hooks[]` sequentially.

---

### Safety rules (always enforced)

- Never stage or commit files matching `commit.never_stage` patterns
- Never force push without explicit "force push" in arguments
- Never amend a commit that has already been pushed
- Always push immediately after committing when configured to do so
