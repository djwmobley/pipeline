---
allowed-tools: Bash(*)
description: Create an isolated git worktree for feature work
---

## Pipeline Worktree

Create an isolated git worktree for feature development.

---

### Step 1 — Directory selection

Follow this priority order:

```bash
# Check existing directories
ls -d .worktrees 2>/dev/null
ls -d worktrees 2>/dev/null
```

If found: use that directory. If both exist, `.worktrees` wins.

If neither exists, check CLAUDE.md for a worktree preference:
```bash
grep -i "worktree.*director" CLAUDE.md 2>/dev/null
```

If no preference found, ask:
> "No worktree directory found. Where should I create worktrees?
>
> 1. .worktrees/ (project-local, hidden)
> 2. ~/dev/worktrees/{project-name}/ (global location)
>
> Which would you prefer?"

---

### Step 2 — Safety verification

For project-local directories, verify the directory is gitignored:

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

If NOT ignored: add to .gitignore and commit before proceeding.

---

### Step 3 — Create worktree

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
git worktree add "$LOCATION/$BRANCH_NAME" -b "$BRANCH_NAME"
cd "$LOCATION/$BRANCH_NAME"
```

---

### Step 4 — Run project setup

Auto-detect and run:
```bash
[ -f package.json ] && npm install
[ -f Cargo.toml ] && cargo build
[ -f requirements.txt ] && pip install -r requirements.txt
[ -f pyproject.toml ] && poetry install || pip install -e .
[ -f go.mod ] && go mod download
```

---

### Step 5 — Verify clean baseline

Read `commands.test` from `.claude/pipeline.yml` and run the test suite.

If tests fail: report failures, ask whether to proceed or investigate.
If tests pass: report ready.

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

---

### Safety rules

- Never create worktree without verifying it's gitignored (project-local)
- Never skip baseline test verification
- Never proceed with failing tests without asking
- Always follow directory priority: existing > CLAUDE.md > ask
