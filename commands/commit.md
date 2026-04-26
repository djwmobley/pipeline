---
allowed-tools: Bash(git*), Bash(cd*), Bash(npx*), Bash(npm*), Bash(cargo*), Bash(go*), Bash(pytest*), Bash(python*), Bash(node*), Bash(curl*), Read(*), Glob(*), Grep(*)
description: Preflight gates + commit + push — reads pipeline.yml for commands and thresholds
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=orientation
```


## Pipeline Commit

You are the commit workflow agent. You read config from `.claude/pipeline.yml` and run
preflight gates before committing.

---

### Preflight — Orientation check

<!-- checkpoint:MUST orientation -->

Before any other step — including reading any skill file — locate the
orientation skill (read `$PIPELINE_DIR/skills/orientation/SKILL.md` if
`$PIPELINE_DIR` is set, otherwise Glob `**/pipeline/skills/orientation/SKILL.md`)
and execute its preflight. State the six context values (cwd, repo root, branch,
HEAD, worktree, dirty count) in prose and confirm they match this command's
intent. Do not continue until done.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.typecheck`, `commands.lint`, `commands.lint_error_pattern`, `commands.test`
- `commit.co_author`, `commit.never_stage`, `commit.push_after_commit`, `commit.post_commit_hooks`
- `routing.source_dirs`, `routing.review_gate_threshold`
- `knowledge.tier`
- `integrations.github.enabled`, `integrations.github.issue_tracking`
- `project.repo`
- `docs.plans_dir` — for epic reference resolution

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

**source_dirs validation:**
1. If `routing.source_dirs` contains `["."]`, warn: "source_dirs is set to [\".\"] which counts ALL files as source, inflating the review gate count. Run `/pipeline:update` to set a specific source directory." Then filter by common source extensions (.ts, .tsx, .js, .jsx, .rs, .go, .py) instead of directory paths for the review gate check.
2. **Shell safety:** Validate each entry matches `[a-zA-Z0-9/_.-]+` only. If any entry contains shell metacharacters (`$`, `` ` ``, `(`, `)`, `;`, `|`, `&`, `!`, `"`, `'`, `\`, `{`, `}`), reject it with: "source_dirs entry '[entry]' contains unsafe characters. Only alphanumeric, `/`, `_`, `.`, `-` are allowed." and stop.

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

**3e. Agent template lint** (skip if `lint_agents.enabled` is false OR no `*-prompt.md` in changed files)

Check if any changed file matches `skills/**/*-prompt.md`:
```bash
git diff --name-only HEAD | grep -E '\-prompt\.md$'
```

If matches found AND `lint_agents.enabled` is true (default):
1. Resolve `$SCRIPTS_DIR` (same method as `/pipeline:knowledge` Step 0)
2. Run: `PIPELINE_DIR='[plugin_root]' node '[scripts_dir]/pipeline-lint-agents.js' lint --changed`
3. If exit code 1 (HIGH findings) AND `lint_agents.block_on_commit` is true → do NOT commit. Report findings. Stop.
4. MEDIUM findings → report as warnings, do not block.

---

### Step 4 — Stage and Commit

Stage all modified and new files. **Never stage** any file matching patterns in `commit.never_stage`.

Write a commit message from the diff using conventional commit format:

```
type(scope): summary

- change 1
- change 2

[If epic available: Part of #[EPIC_N]]
Co-Authored-By: [value from commit.co_author in pipeline.yml]
```

**Epic reference in commit body:** If `integrations.github.enabled` AND `integrations.github.issue_tracking`, check the most recent plan file in `docs.plans_dir` for `github_epic: N`. If found, include `Part of #[N]` in the commit body before the co-author line. This links commits to the feature epic for traceability.

**co_author validation:** Validate `commit.co_author` matches the format `Name <email>` (no newlines, no shell metacharacters). Strip any newlines or control characters before use in the commit message.

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

### Persist to knowledge tier

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

**Script path:** Use the resolved `SCRIPTS_DIR` from Step 6 (`$PIPELINE_DIR` or fallback paths).

Record the commit as a decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision "$(cat <<'TOPIC'
commit-[short_sha]
TOPIC
)" "$(cat <<'SUMMARY'
[commit type](scope): [commit summary] ([short SHA])
SUMMARY
)" "$(cat <<'DETAIL'
[N] files changed. [brief description of what changed and why]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:** No writes — commits are too frequent; decisions per commit would bloat DECISIONS.md.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### Step 7 — Report completion

Report the commit result:

```
Committed [short SHA] to [branch]. [N] files changed.
[One-line conventional commit summary]
```

Record step completion — commit always records PASS (if it reached this point, the commit succeeded):

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete commit PASS
```

The orchestrator handles what happens next (finish, deploy, etc.).
Do NOT present a "What next?" menu or suggest follow-up commands.

Commit is a Category 4 utility command — no issue comment required.
Epic reference in the commit message body (`Part of #[N]`) is sufficient
for traceability. The phase commands (review, qa, redteam) handle their
own A2A handoff comments on task issues.

---

### Safety rules (always enforced)

- Never stage or commit files matching `commit.never_stage` patterns
- Never force push without explicit "force push" in arguments
- Never amend a commit that has already been pushed
- Always push immediately after committing when configured to do so
