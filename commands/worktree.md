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
test -d .worktrees && echo "FOUND: .worktrees"
test -d worktrees && echo "FOUND: worktrees"
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

If the user did not provide a branch name, ask: "What should the branch be named?"

Substitute `$LOCATION` and `$BRANCH_NAME` with the literal values determined in Steps 1-3. Run as a single Bash call:
```bash
project=$(basename "$(git rev-parse --show-toplevel)")
git worktree add "$LOCATION/$BRANCH_NAME" -b "$BRANCH_NAME"
```

All subsequent commands in this worktree must include the full path or be combined into a single Bash call with `cd` at the start.

---

### Step 4 — Run project setup

Read `project.pkg_manager` from `.claude/pipeline.yml` (defaults to `npm`). Auto-detect and run:
```bash
[ -f package.json ] && [pkg_manager] install
[ -f Cargo.toml ] && cargo build
[ -f requirements.txt ] && pip install -r requirements.txt
[ -f pyproject.toml ] && (poetry install || pip install -e .)
[ -f go.mod ] && go mod download
```
Replace `[pkg_manager]` with the actual value (`pnpm`, `npm`, `yarn`, or `bun`).

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
