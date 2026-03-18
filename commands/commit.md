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

**Zero-commit detection:** First check if any commits exist:

```bash
git rev-parse HEAD 2>/dev/null
```

If this fails (exit code non-zero), the repo has no commits. Replace the `git diff HEAD` commands below with:

```bash
git status
git diff --cached --stat       # staged changes (no HEAD to diff against)
git diff --cached              # staged diff
git ls-files --others --exclude-standard   # untracked files
```

**Normal case (commits exist):**

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

Count source files in the diff. Construct a grep regex from `routing.source_dirs` (e.g., if `["src/", "lib/"]` then regex is `^(src/|lib/)`).

**Zero-commit case (no HEAD):** If `git rev-parse HEAD 2>/dev/null` fails, use `git diff --cached --name-only` for staged files and `git ls-files --others --exclude-standard <each_source_dir>` for untracked files. For the initial commit (no HEAD exists), all untracked + staged source files count toward the review gate threshold.

**Normal case (commits exist):** Run:

git diff --name-only HEAD | grep -E "<constructed_regex>" | wc -l

Also count untracked source files:

git ls-files --others --exclude-standard <each_source_dir> | wc -l

Replace `<constructed_regex>` and `<each_source_dir>` with the actual values from `routing.source_dirs` in pipeline.yml.

Rules:
- If total source file count < `routing.review_gate_threshold` → skip this gate.
- If total ≥ threshold AND arguments contain `reviewed:✓` → proceed.
- If total ≥ threshold AND NO `reviewed:✓`:

<HARD-STOP>
DO NOT COMMIT. DO NOT proceed to any further checks. EXIT NOW.

Report: "BLOCKED — N source files changed. /pipeline:review is required before committing.
Run /pipeline:review, apply all 🔴 fixes, then call /pipeline:commit reviewed:✓"

These thoughts mean you are rationalizing past the gate:
- "The changes are simple enough" → The threshold exists for a reason. Respect it.
- "I already reviewed mentally" → Mental review is not `/pipeline:review`. Run it.
- "Just this once" → There is no "just this once." The gate is absolute.
</HARD-STOP>

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

Co-Authored-By: [value from commit.co_author in pipeline.yml]
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`

---

### Step 5 — Push

If `commit.push_after_commit` is true, push to origin.

---

### Step 6 — Post-commit hooks

Run each command in `commit.post_commit_hooks[]` sequentially.

**Note:** Hook commands may reference `$SCRIPTS_DIR` or `$PIPELINE_DIR`. To resolve these, locate the pipeline plugin's scripts directory using the same method as `/pipeline:knowledge` Step 0:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**When running hook commands that invoke pipeline scripts, prefix with `PROJECT_ROOT=[project_root]`** to ensure they target the correct project. Example: `PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-embed.js index`

---

### Safety rules (always enforced)

- Never stage or commit files matching `commit.never_stage` patterns
- Never force push without explicit "force push" in arguments
- Never amend a commit that has already been pushed
- Always push immediately after committing when configured to do so
