---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: Red team remediation — parse findings, create issues, batch fixes through build/review/commit pipeline
---

## Pipeline Remediate

Fix security findings from `/pipeline:redteam`. Parses the red team report, creates GitHub issues, batches fixes by effort level, dispatches implementer/reviewer agents, and verifies fixes with specialist re-runs.

**Modifies source code.** Commits per finding or batch. Run on a feature branch.

---

### Step 0 — Load config + locate report

Read `.claude/pipeline.yml` from the project root. Extract:
- `remediate.*` (auto_issue_threshold, verification_rerun, batch_strategy)
- `models.cheap`, `models.implement`, `models.review`, `models.architecture`
- `commands.typecheck`, `commands.lint`, `commands.lint_error_pattern`, `commands.test`
- `routing.source_dirs`
- `review.non_negotiable[]`
- `knowledge.tier`
- `integrations.github.enabled`, `project.repo`

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

**Report selection:**
- If the user provides a path: use that file
- Otherwise: find the most recent `docs/security/redteam-*.md` file

```bash
ls -t docs/security/redteam-*.md 2>/dev/null | head -1
```

If no report found: "No red team report found. Run `/pipeline:redteam` first." Stop.

Read the report in full. Store as `REPORT_CONTENT`.

---

### Step 1 — Parse and triage (haiku)

Read the triage prompt template from `skills/remediation/triage-prompt.md` (locate via the plugin's skill directory).

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.cheap` from config
2. `[REPORT_CONTENT]` → the full markdown report from Step 0
3. `[AUTO_ISSUE_THRESHOLD]` → `remediate.auto_issue_threshold` from config (default: `"medium-high"`)

Dispatch the triage agent. It returns structured findings:

```
TRIAGE [FINDING_ID] | [SEVERITY] | [CONFIDENCE] | [LOCATION] | [CWE] | [EFFORT] | [CREATE_ISSUE] | [SPECIALIST_DOMAIN]
[one-line description]
[remediation action]
```

Store the parsed triage results as `TRIAGE_RESULTS`.

---

### Step 2 — Present remediation plan

Count findings by severity. Count issues to create. Group by effort tier.

Present:

```
## Remediation Plan

**Report:** [report filename]
**Findings:** [N] total ([C] critical, [H] high, [M] medium, [L] low, [I] info)

### Work Batches

| Batch | Findings | Effort | Strategy |
|-------|----------|--------|----------|
| Quick wins | [list IDs] | < 1 hour each | Implementer only |
| Medium effort | [list IDs] | 1-4 hours each | Implementer + reviewer |
| Architectural | [list IDs] | > 4 hours each | Opus planning + build |

### GitHub Issues

[N] issues to create (threshold: [auto_issue_threshold])
[M] findings tracked but no issue (LOW/INFO)

### Not Remediated

LOW and INFO findings are tracked for visibility but not auto-fixed.
Review these manually or re-run with threshold: "all".

Proceed? (Y/n)
```

If user declines, stop.

---

### Step 3 — Create GitHub issues

**If `integrations.github.enabled` is true:**

For each finding where `CREATE_ISSUE` is true:

**Shell safety:** All values derived from report content (finding IDs, descriptions, remediation text) must be shell-escaped before interpolation. Use heredocs for multi-line content and single-quoted strings for short values to prevent command injection via `$()`, backticks, or double-quote breakout.

```bash
gh issue create --repo '[project.repo]' \
  --title "$(cat <<'TITLE'
[FINDING_ID]: [one-line description]
TITLE
)" \
  --body "$(cat <<'EOF'
## Security Finding

**ID:** [FINDING_ID]
**Severity:** [SEVERITY]
**Confidence:** [CONFIDENCE]
**CWE:** [CWE]
**Location:** [LOCATION]

### Description

[finding description from report]

### Exploitation Scenario

[exploitation scenario from report]

### Remediation

[remediation steps from report]

### Source

Red team report: `[report path]`
EOF
)" \
  --label "security" --label "[severity-lowercase]"
```

Store each returned issue number alongside its finding ID.

**If `integrations.github.enabled` is false:**

Skip issue creation. Note: "GitHub integration not enabled — skipping issue creation. Issues can be created later with `/pipeline:update integrations`."

---

### Step 4 — Create knowledge tier tasks

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

For each finding being remediated:

```bash
node scripts/pipeline-db.js update task new '[FINDING_ID]: [one-line description]' 'remediate' [github_issue_number]
```

(If no GitHub issue was created, omit the issue number.)

**Important:** The script returns a database task ID (integer) for each created task. Store the mapping: `FINDING_ID → DB_TASK_ID → GITHUB_ISSUE_NUMBER`. All subsequent `pipeline-db.js update task` calls in Step 5 use the **database task ID** (integer), not the finding ID (e.g., INJ-001).

**If `knowledge.tier` is `"files"`:**

Create or append to `docs/security/remediation-[YYYY-MM-DD].md`:

```markdown
# Remediation Tracker — [date]

**Source:** [report path]

| ID | Finding | Severity | Effort | Status | GitHub Issue | Commit |
|----|---------|----------|--------|--------|-------------|--------|
| [FINDING_ID] | [description] | [SEVERITY] | [EFFORT] | pending | [#N or —] | — |
| ... | ... | ... | ... | ... | ... | ... |
```

---

### Step 5 — Execute batches

Record baseline commit SHA:

```bash
git rev-parse HEAD
```

Store as `BASELINE_SHA`.

**Filter findings for remediation:** Exclude all findings with severity LOW or INFO from the batch lists. These are tracked in the knowledge tier for visibility but are not auto-fixed. Also exclude any findings marked INTENTIONAL by the triage agent.

Process the remaining findings in batches, ordered by `remediate.batch_strategy`:
- `"effort"` (default): quick wins → medium → architectural
- `"severity"`: CRITICAL first, then HIGH, then MEDIUM, regardless of effort

Read the implementer and reviewer prompt templates from the building skill (locate via `$PIPELINE_DIR` or Glob `**/pipeline/skills/building/*.md`):
- `skills/building/implementer-prompt.md`
- `skills/building/reviewer-prompt.md`

---

#### Quick wins (single implementer, no reviewer)

For each quick-win finding:

1. Update task status → in_progress
   - Postgres: `node scripts/pipeline-db.js update task [DB_TASK_ID] in_progress`
   - Files: update the Status column in the tracking table

2. Read the implementer prompt template from `skills/building/implementer-prompt.md` (locate via `$PIPELINE_DIR` or Glob `**/pipeline/skills/building/implementer-prompt.md`).

   Dispatch a sonnet implementer agent:
   - `{{MODEL}}` → value of `models.implement` from config
   - Description: `"Security fix: [FINDING_ID] — [one-line description]"`
   - Substitutions:
     - `[task name]` → `"Security fix: [FINDING_ID]"`
     - `[FULL TEXT of task]` → the finding description, exploitation scenario, and remediation from the report
     - `[Scene-setting]` → "You are fixing a security vulnerability identified by a red team assessment."
     - `[directory]` → the directory containing the affected file(s)
     - Contents of affected file(s) (read in full)
     - Non-negotiable decisions from config

3. Run preflight gates:
   ```bash
   [commands.typecheck]  # skip if null
   [commands.lint]       # skip if null
   [commands.test]       # skip if null
   ```
   If any gate fails: report the failure, do NOT proceed to the next finding. Fix the failure first.

4. Commit using heredoc for the message (prevents shell injection from finding descriptions):
   ```bash
   git commit -m "$(cat <<'EOF'
   fix(security): [FINDING_ID] — [one-line description]
   EOF
   )"
   ```

5. Update task status → done
   - Postgres: `node scripts/pipeline-db.js update task [DB_TASK_ID] done`
   - Files: update Status + Commit columns in tracking table

6. Close GitHub issue (if `integrations.github.enabled` and an issue was created):
   ```bash
   gh issue close [issue_number] --repo '[project.repo]' --comment "Fixed in $(git rev-parse --short HEAD)"
   ```

---

#### Medium effort (implementer + reviewer)

For each medium-effort finding:

1. Update task status → in_progress
   - Postgres: `node scripts/pipeline-db.js update task [DB_TASK_ID] in_progress`
   - Files: update the Status column in the tracking table

2. Dispatch a sonnet implementer agent using `skills/building/implementer-prompt.md`:
   - Same substitution pattern as quick wins, but with more context:
     - Full file contents for all affected files
     - Related files that may need coordinated changes
     - Non-negotiable decisions

3. Read the reviewer prompt template from `skills/building/reviewer-prompt.md` (locate via `$PIPELINE_DIR` or Glob).

   Dispatch a sonnet reviewer agent:
   - `{{MODEL}}` → value of `models.review` from config
   - Description: `"Review security fix: [FINDING_ID]"`
   - Substitutions:
     - `[FULL TEXT of task requirements]` → the original finding and remediation requirements
     - `[From implementer's report]` → the implementer's complete report
     - `[from pipeline.yml — never flag these]` → `review.non_negotiable` from config
     - `[TASK_NUMBER]` and `[TASK_NAME]` → finding ID and description
   - Additional instruction: "Verify the fix addresses the vulnerability. Check for regressions, incomplete fixes, and new attack vectors introduced by the change."

4. **Review loop:** If the reviewer finds issues:
   - Dispatch a fix agent (sonnet) with the reviewer's findings
   - Re-dispatch the reviewer
   - Repeat until approved (max 3 iterations — if still failing, report and move on)

5. Run preflight gates (same as quick wins)

6. Commit using heredoc (same pattern as quick wins):
   ```bash
   git commit -m "$(cat <<'EOF'
   fix(security): [FINDING_ID] — [one-line description]
   EOF
   )"
   ```

7. Update task status → done
   - Postgres: `node scripts/pipeline-db.js update task [DB_TASK_ID] done`
   - Files: update Status + Commit columns
   Close GitHub issue (if `integrations.github.enabled` and an issue was created)

---

#### Architectural changes (opus planning + build)

For each architectural finding:

1. Update task status → in_progress
   - Postgres: `node scripts/pipeline-db.js update task [DB_TASK_ID] in_progress`
   - Files: update the Status column in the tracking table

2. Read the fix planner prompt template from `skills/remediation/fix-planner-prompt.md` (locate via `$PIPELINE_DIR` or Glob `**/pipeline/skills/remediation/fix-planner-prompt.md`).

   Dispatch an opus planner agent:
   - `{{MODEL}}` → value of `models.architecture` from config
   - Description: `"Plan architectural fix: [FINDING_ID]"`
   - Perform substitutions per the template's checklist:
     - `[FINDING_ID]` → the finding ID
     - `[FINDING_DESCRIPTION]` → full finding text (description, exploitation, remediation)
     - `[AFFECTED_FILES]` → contents of all affected files
     - `[PROJECT_CONTEXT]` → project name, framework, source_dirs, profile
     - `[NON_NEGOTIABLE]` → `review.non_negotiable[]` from config
   - The planner outputs a mini implementation plan: ordered steps where each step leaves the codebase in a working state

3. For each step in the plan:
   - Dispatch sonnet implementer using `skills/building/implementer-prompt.md` (same substitution pattern as medium effort)
   - Dispatch sonnet reviewer using `skills/building/reviewer-prompt.md`
   - Review loop (same as medium effort, max 3 iterations per step)
   - Run preflight gates
   - Commit per step using heredoc:
     ```bash
     git commit -m "$(cat <<'EOF'
     fix(security): [FINDING_ID] step [N] — [step description]
     EOF
     )"
     ```

4. Update task status → done
   - Postgres: `node scripts/pipeline-db.js update task [DB_TASK_ID] done`
   - Files: update Status + Commit columns
   Close GitHub issue (if `integrations.github.enabled` and an issue was created)

---

### Step 6 — Progress tracking

After each batch completes, report progress:

```
## Remediation Progress

### Completed
| Finding | Severity | Commit | Issue |
|---------|----------|--------|-------|
| [ID] | [SEV] | [short SHA] | [#N or —] |

### In Progress
| Finding | Severity | Status |
|---------|----------|--------|
| [ID] | [SEV] | [step description] |

### Pending
| Finding | Severity | Effort |
|---------|----------|--------|
| [ID] | [SEV] | [effort tier] |

### Not Remediated (tracked only)
| Finding | Severity | Reason |
|---------|----------|--------|
| [ID] | LOW/INFO | Below remediation threshold |
```

Update the files-tier tracking table or Postgres task statuses.

---

### Step 7 — Verification re-run

**If `remediate.verification_rerun` is true (default):**

Identify which specialist domains had remediated findings (e.g., if INJ-001 and INJ-003 were fixed, the INJ domain needs re-verification).

Read the specialist prompt template from `skills/redteam/specialist-agent-prompt.md`.

For each affected domain, dispatch a sonnet specialist agent:
- `{{MODEL}}` → value of `models.review` from config
- Same substitution pattern as `/pipeline:redteam` Step 4, but scoped to only the files that were modified during remediation
- Description: `"Verify fix: [DOMAIN_ID] specialist re-run"`

Compare results:

```
## Verification Results

| Domain | Original Findings | Remaining | New | Status |
|--------|------------------|-----------|-----|--------|
| [ID] | [N] | [M] | [P] | [PASS/FAIL/PARTIAL] |

### Remaining Findings
[Any findings that were not resolved — with IDs and descriptions]

### New Findings
[Any new findings introduced by the fixes — with full FINDING format]
```

If new findings are introduced: flag them prominently. These may need another remediation pass.

**If `remediate.verification_rerun` is false:** Skip verification. Note: "Verification re-run disabled. Consider running `/pipeline:redteam` to validate fixes."

---

### Step 8 — Persist summary

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

```bash
node scripts/pipeline-db.js update decision 'security-remediation' 'Remediation [date]: [N] fixed, [M] verified, [P] remaining' '[summary of what was fixed and verification results]'
```

For any remaining or new findings, store as gotchas:

```bash
node scripts/pipeline-db.js update gotcha new '[FINDING_ID]: [brief description]' '[why it was not fixed or what to watch for]'
```

**If `knowledge.tier` is `"files"`:**

Update the tracking file (`docs/security/remediation-[date].md`) with final statuses for all findings.

If there are remaining or new findings, append to `docs/gotchas.md`:

```markdown
### [FINDING_ID] — [brief description]
**Rule:** [what to watch for or why it wasn't fixed]
```

---

### Final report

Present the summary inline:

```
## Remediation Complete

**Findings fixed:** [N] / [total]
**Commits:** [N] (baseline: [BASELINE_SHA])
**Verification:** [PASS/FAIL/PARTIAL or "skipped"]

### Fixed
[list with finding IDs, severities, and commit SHAs]

### Remaining
[list with finding IDs and reasons]

### New (from verification)
[list with finding IDs — introduced by fixes]

Review all changes: /pipeline:review --since [BASELINE_SHA]
Then commit aggregate: /pipeline:commit reviewed:✓
```
