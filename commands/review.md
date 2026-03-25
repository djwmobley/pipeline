---
allowed-tools: Bash(git*), Bash(cd*), Bash(npx*), Bash(npm*), Bash(cargo*), Bash(go*), Bash(semgrep*), Bash(command*), Read(*), Glob(*), Grep(*)
description: Per-change quality review — evaluates code quality with severity tiers and config-driven criteria
---

## Pipeline Review

You are a distinguished engineer performing a code review. Your only job is to find real problems.
You do not praise. You do not rubber-stamp. You look for things that are actually wrong.

<!-- checkpoint:MUST review-adversarial -->

The reviewing skill includes an adversarial review mandate. Follow it exactly — empty reviews are failed reviews.

| Rationalization | Reality |
|---|---|
| "The code looks fine, no findings" | Empty reviews are failed reviews. Look harder or issue a Clean Review Certificate with evidence. |
| "I already reviewed this mentally" | Mental reviews miss things. The skill mandates structured findings with confidence levels. |
| "The changes are too small to have issues" | Small changes in the wrong place cause large outages. Review anyway. |

Locate and read the reviewing skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/reviewing/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/reviewing/SKILL.md` to find it

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.typecheck`, `commands.lint`, `commands.lint_error_pattern`
- `review.non_negotiable` — intentional decisions to never flag
- `review.criteria` — categories to review against
- `routing.source_dirs` — directories containing source code
- `static_analysis.semgrep.enabled` — SAST toggle ("auto", true, false)
- `static_analysis.semgrep.rulesets` — additional semgrep configs
- `static_analysis.semgrep.custom_rules` — include pipeline rules
- `static_analysis.severity_mapping` — semgrep severity to pipeline severity
- `static_analysis.grep_fallback` — use grep patterns when semgrep unavailable
- `integrations.github.enabled`, `integrations.github.issue_tracking`
- `project.repo` — GitHub repo (owner/repo)

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

---

### Step 1 — Load non-negotiable decisions

Read `review.non_negotiable[]` from config. These are intentional architectural decisions.
Do NOT flag any of them as issues.

Also read the project's `CLAUDE.md` if it exists — it may contain additional context about
intentional patterns.

---

### Step 2 — Run typecheck

If `commands.typecheck` is not null, run it. Type errors are automatic 🔴 Must fix.
Record all findings before proceeding.

---

### Step 2b — Run SAST scan

Follow the "Static Analysis (SAST) — Step 2b" section in the reviewing skill.

1. Check `static_analysis.semgrep.enabled`:
   - `false` → skip entirely, note in report header
   - `"auto"` → probe: `command -v semgrep`
   - `true` → expect semgrep, warn if missing

2. If semgrep is available:
   - Locate the pipeline plugin's `rules/semgrep/` directory
   - Get the changed file list from `git diff --cached --name-only` and `git diff --name-only`
   - Run semgrep scoped to changed files with JSON output
   - Parse findings, map severity per `static_analysis.severity_mapping`
   - Tag each finding with source `sast:semgrep`

3. If semgrep is NOT available and `static_analysis.grep_fallback` is true:
   - Run `redteam.recon_patterns` from config as grep patterns against changed files
   - Tag findings with source `sast:grep-fallback`

4. SAST findings at HIGH severity are automatic 🔴 Must fix (same treatment as typecheck failures).

---

### Step 3 — Get the diff

**Check for `--since <SHA>` argument.** If the user passed a baseline SHA (e.g., from `/pipeline:build` output), use commit-range mode:

```bash
git diff <SHA>..HEAD --stat
git diff <SHA>..HEAD
```

This is the normal path after `/pipeline:build` — build commits per task, so `git diff HEAD` would show nothing. The baseline SHA captures all changes across all build tasks.

**If no `--since` argument:**

If `git log --oneline -1` fails (no prior commits), this is the initial commit. Use `git diff --cached` for staged files and `git ls-files --others --exclude-standard` for untracked. Note: "Initial commit — reviewing all new files."

**Normal case (no baseline SHA, commits exist):**

```bash
git diff --cached --stat    # staged changes
git diff --stat             # unstaged changes
git diff --cached           # staged diff
git diff                    # unstaged diff
git status
git log --oneline -1        # last commit for context
```

If both staged and unstaged diffs are empty but there are recent commits, suggest: "No uncommitted changes found. If reviewing after `/pipeline:build`, re-run with `--since <SHA>` using the baseline SHA from build output."

---

### Step 4 — Lint changed files only

From the diff, extract source file paths (files matching `routing.source_dirs` patterns). Run lint against those specific files by passing them as arguments to the lint command:

```bash
# Example: npx eslint src/foo.ts src/bar.tsx
[commands.lint base command] [space-separated file paths from diff]
```

If the lint command doesn't support file arguments (rare), run the full lint command and filter output to only lines referencing changed files.

Use warnings as **reading hints** — not automatic findings.

---

### Step 5 — Read each changed file in full

For each file in the diff, read it completely for full context.

---

### Step 6 — Review against configured criteria

Follow the reviewing skill's process. Apply each criterion from `review.criteria[]` in the config.
The skill defines severity calibration and the full review process.

---

### Step 7 — Report

Use severity tiers as defined in the reviewing skill. Use exactly this output template:

```
## Code Review

### Static Analysis
Tools: [semgrep v1.x | grep fallback | skipped: reason]
Rules: [N] custom security [+ M user rulesets]
Findings: [count] ([high] high, [medium] medium, [low] low)

### Files reviewed
[list each file]

---

### 🔴 Must fix
**[File:line]** — [one-line description] `[confidence: HIGH]`
> [Explanation of why it's a problem and what to do instead]
> Fix: [one-line precise description of the transformation]

### 🟡 Should fix
**[File:line]** — [one-line description] `[confidence: HIGH/MEDIUM]`
> [Explanation]

### 🔵 Consider
**[File:line]** — [one-line description] `[confidence: HIGH/MEDIUM/LOW]`
> [Explanation]

### ❓ Questions
**[File:line]** — [what you're seeing and why it's unusual]

---

### Verdict
[One of:]
- ✅ Clean — no significant issues found
- 🟡 Minor issues — [N] things worth fixing, none blocking
- 🔴 Issues found — [N] things that need attention before shipping
```

If a section has no items, omit it entirely.

---

### Step 8 — Simplify handoff

Collect every file with a 🟡 or 🔵 finding in `simplicity` or `solid` categories:

```
## Simplify candidates
Run `/pipeline:simplify` on:
- [file] — [one-line reason]
```

If no simplicity/SOLID findings exist, omit this block.

---

### Step 8b — Persist findings

If any 🔴 or 🟡 findings exist, write to `docs/findings/review-YYYY-MM-DD.md`:

```bash
mkdir -p docs/findings
```

```markdown
# Review Findings — [date]

**Source:** review
**Files reviewed:** [list of files from diff]
**Finding count:** [N] ([M] 🔴 / [P] 🟡 / [Q] 🔵)

[all findings in their native format — tier headings + file:line descriptions]
```

Then: "Run `/pipeline:remediate --source review` to batch-fix 🔴 findings, or fix manually and commit with `/pipeline:commit reviewed:✓`."

---

### Step 8c — Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

For each 🔴 or 🟡 finding, persist as a structured record:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update finding new "$(cat <<'EOF'
{"id":"[FINDING_ID]","source":"review","severity":"[high|medium]","confidence":"[HIGH|MEDIUM|LOW]","location":"[file:line]","category":"[review criterion]","description":"[one-line description]","impact":"[why it matters]","remediation":"[fix description]","effort":"[quick|medium|large]"}
EOF
)"
```

Record the verdict:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'code-review' "$(cat <<'SUMMARY'
Review [date]: [verdict]. [N] findings ([M] 🔴 / [P] 🟡 / [Q] 🔵)
SUMMARY
)" "$(cat <<'DETAIL'
Files reviewed: [file list]. [1-sentence quality summary]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:** No additional writes — findings already saved to `docs/findings/review-*.md` above.

---

### GitHub Finding Tracking

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

Find the epic number: check the most recent plan file in `docs.plans_dir` for `github_epic: N`.

1. For each 🔴 Must Fix finding, check for existing issue first:
   ```bash
   gh issue list --repo '[project.repo]' --search '[FINDING_ID] in:title' --state open --json number --limit 1
   ```
   If an issue already exists for this finding ID, skip creation. Otherwise:
   ```bash
   gh issue create --repo '[project.repo]' \
     --title "$(cat <<'TITLE'
   [FINDING_ID]: [description]
   TITLE
   )" \
     --body "$(cat <<'EOF'
   ## Code Review Finding

   **Severity:** 🔴 Must Fix
   **Location:** [file:line]
   **Category:** [review criterion]
   **Confidence:** [HIGH/MEDIUM]

   [explanation of the problem and fix suggestion]

   Linked to: #[EPIC_N]
   EOF
   )" \
     --label "review" --label "high"
   ```
2. Comment the verdict summary on the epic:
   ```bash
   gh issue comment [N] --repo '[project.repo]' --body "$(cat <<'EOF'
   ## Code Review Verdict

   **Result:** [verdict]
   **Findings:** [M] 🔴 / [P] 🟡 / [Q] 🔵
   **Report:** `[report file path]`
   EOF
   )"
   ```

🟡 and 🔵 findings do NOT get issues — they stay in `docs/findings/` only.

3. Update the epic status checklist — read the current issue body, replace `- [ ] Review` with `- [x] Review`, and update the issue:
   ```bash
   BODY=$(gh issue view [N] --repo '[project.repo]' --json body -q '.body')
   UPDATED=$(echo "$BODY" | sed 's/- \[ \] Review/- [x] Review/')
   gh issue edit [N] --repo '[project.repo]' --body "$UPDATED"
   ```

If no epic found: skip — review works without GitHub tracking.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### What's Next

After applying fixes: `/pipeline:commit` → `/pipeline:finish` (if on a feature branch).

`/pipeline:finish` handles merge verification, ship transition (Postgres task closure + GitHub issue close), and dashboard regeneration. Do not manually merge — finish keeps the three stores in sync.
