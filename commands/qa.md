---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: "QA — test planning and verification. Two modes: 'plan' (pre-build) and 'verify' (post-build)"
---

## Pipeline QA

Two modes:
- `/pipeline:qa plan` — Generate a standalone test plan with work packages (LARGE/MILESTONE)
- `/pipeline:qa verify` — Run parallel QA workers + seam pass to verify implementation (LARGE/MILESTONE)

For MEDIUM changes, QA runs invisibly: plan section is embedded in `/pipeline:plan`, and auto-verify runs after `/pipeline:build`. This command is for explicit QA orchestration on larger changes.

**Mode detection:** If the user's argument starts with "plan", run Plan Mode. If "verify", run Verify Mode. If neither, ask which mode.

---

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.name`, `project.profile`
- `qa.*` (auto_verify, workers, browser_testing, db_verification, api_testing, flake_retries)
- `routing.source_dirs`
- `commands.test`
- `models.architecture`, `models.qa`, `models.cheap`
- `docs.plans_dir`, `docs.specs_dir`
- `knowledge.tier`
- `integrations.github.enabled`, `integrations.github.issue_tracking`
- `project.repo` — GitHub repo (owner/repo)

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

### Locate and read the QA skill

1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/qa/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/qa/SKILL.md` to find it

Follow the QA skill exactly for the selected mode.

---

## Plan Mode (`/pipeline:qa plan`)

Generate a standalone test plan with work packages, scenarios, and seam definitions.

### Step 1 — Gather inputs

- **Spec:** Most recent in `docs.specs_dir` (or user-specified)
- **Implementation plan:** Most recent in `docs.plans_dir` (or user-specified)
- **Decision records:** Check for `*-decisions.md` in `docs.plans_dir`
- **Existing tests:** Scan `routing.source_dirs` for test files and patterns

**Knowledge tier query** (if postgres):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "SELECT topic, decision FROM decisions WHERE topic ILIKE '%test%' OR topic ILIKE '%qa%' ORDER BY created_at DESC LIMIT 10"
```

### Step 2 — Builder risk interview (MILESTONE only)

If the change is MILESTONE-sized (determined by file count from the implementation plan or user indication), conduct a brief interview.

Follow the builder risk interview questions defined in the QA skill's "Builder Risk Interview" section. Ask questions one at a time.

Record responses as additional context for the planner.

### Step 3 — Dispatch QA planner

Read and use `planner-prompt.md` from the QA skill directory.

Substitutions:
- `{{MODEL}}` → `models.architecture` (opus — risk-driven planning requires judgment)
- `[SPEC_TEXT]` → full spec text
- `[PLAN_TASKS]` → full implementation plan text
- `[DECISION_RECORDS]` → decision records if they exist
- `[EXISTING_TESTS]` → summary of existing test patterns, frameworks, file organization
- `[SOURCE_DIRS]` → `routing.source_dirs`
- `[TEST_COMMAND]` → `commands.test`
- `[BUILDER_INTERVIEW]` → interview responses (MILESTONE) or "N/A — no interview" (LARGE)
- `[BROWSER_TESTING]` → `qa.browser_testing`
- `[DB_VERIFICATION]` → `qa.db_verification`

### Step 4 — Save test plan

Save to `[docs.plans_dir]/YYYY-MM-DD-{feature}-test-plan.md`.

### Step 5 — Present to builder

```
## Test Plan — [Feature Name]

Work packages: [N]
Total scenarios: [M] (P0: [X], P1: [Y])
Integration seams: [K]

Saved to: [path]

What next?
a) Proceed to build  (/pipeline:build — QA verify will run after)
b) Review work packages  (I'll walk through each)
c) Adjust scope  (add/remove scenarios)
```

---

## Verify Mode (`/pipeline:qa verify`)

Execute the test plan with parallel QA workers and seam pass synthesis.

### Step 1 — Locate test plan

Check for a test plan:
1. User-specified file
2. Most recent `*-test-plan.md` in `docs.plans_dir`
3. If no standalone test plan, check the implementation plan for a `## QA Strategy` section

If no test plan or QA strategy section exists:
```
No test plan found. Options:
a) Generate one now  (/pipeline:qa plan)
b) Run ad-hoc verification  (I'll infer scenarios from the codebase changes)
```

### Step 2 — Determine worker count

Read the test plan's work packages. Worker count:
- If `qa.workers` is `"auto"`: one worker per work package (capped at 6)
- If explicit number: use that, distributing work packages across workers

### Step 3 — Scan existing test patterns

Before dispatching workers, scan the codebase for existing test patterns:

Use Glob to find test files: `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`

Summarize: test framework, file organization, fixture patterns, assertion style. This goes into each worker's prompt as `[EXISTING_TEST_PATTERNS]`.

### Step 4 — Dispatch parallel QA workers

Read and use `worker-prompt.md` from the QA skill directory.

**Launch ALL workers in parallel** (same pattern as red team specialists / architect specialists).

Substitutions per worker:
- `{{MODEL}}` → `models.qa` (sonnet)
- `[WORK_PACKAGE_ID]` → work package ID
- `[WORK_PACKAGE_NAME]` → work package name
- `[SCENARIOS]` → full text of scenarios for this work package
- `[TOOLS_LIST]` → tools available (read, write, bash, browser if enabled, etc.)
- `[SOURCE_DIRS]` → `routing.source_dirs`
- `[TEST_COMMAND]` → `commands.test`
- `[BROWSER_TESTING]` → `qa.browser_testing`
- `[DB_VERIFICATION]` → `qa.db_verification`
- `[FLAKE_RETRIES]` → `qa.flake_retries`
- `[EXISTING_TEST_PATTERNS]` → from Step 3

### Step 5 — QA Lead verification + seam pass

After ALL workers complete, dispatch the QA lead verifier using `verifier-prompt.md`.

Substitutions:
- `{{MODEL}}` → `models.architecture` (opus — synthesis + seam testing requires judgment)
- `[WORKER_RESULTS]` → full output from ALL workers (paste all)
- `[SEAM_TESTS]` → seam test definitions from the test plan
- `[COVERAGE_MATRIX]` → coverage matrix from the test plan
- `[ACCEPTANCE_CRITERIA]` → acceptance criteria from the test plan
- `[SOURCE_DIRS]` → `routing.source_dirs`
- `[TEST_COMMAND]` → `commands.test`
- `[BROWSER_TESTING]` → `qa.browser_testing`
- `[DB_VERIFICATION]` → `qa.db_verification`

### Step 6 — Save report

Save the QA report to `docs/findings/qa-report-YYYY-MM-DD.md`.

### Step 7 — Present results

```
## QA Report — [Feature Name]

Verdict: PASS / FAIL / PARTIAL
Confidence: HIGH / MEDIUM / LOW

| Work Package | Scenarios | Pass | Fail | Flaky |
|-------------|-----------|------|------|-------|
| WP-001: [Name] | [N] | [M] | [F] | [K] |
| WP-SEAM: Seams | [N] | [M] | [F] | [K] |

[If FAIL] Blocking failures:
- FAIL-001: [description] — [triage: code-is-wrong / test-is-wrong]

Saved to: [path]

What next?
a) Fix blocking failures  (I'll address code-is-wrong items)
b) Review all failures  (I'll walk through each)
c) Re-run failed packages only  (targeted re-verify)
d) Accept and proceed  (move to review/commit)
```

**MILESTONE fix-and-rerun:** If the verdict is FAIL and the change is MILESTONE-sized, offer to fix `code-is-wrong` failures and re-verify only the affected work packages (max 1 retry cycle to prevent loops).

---

### Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Same as build command.

**Postgres tier:**
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update session [next_number] [test_count] "$(cat <<'EOF'
QA verify: [verdict] — [pass_count] pass, [fail_count] fail, [flaky_count] flaky
EOF
)"
```

**Files tier:**
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js session [next_number] [test_count] "$(cat <<'EOF'
QA verify: [verdict] — [pass_count] pass, [fail_count] fail, [flaky_count] flaky
EOF
)"
```

---

### GitHub QA Tracking

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

Find the epic number: read the spec or plan file for `github_epic: N`.

**Plan mode:**
- Comment on the epic that a test plan was created:
  ```bash
  cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
  ## QA Test Plan Created

  **Work packages:** [count]
  **Scenarios:** [total] (P0: [X], P1: [Y])
  **Integration seams:** [K]

  Plan: `[test plan file path]`
  EOF
  ```
  If the command fails, notify the user with the error and ask for guidance.
- Update the epic status checklist (check `QA`).

**Verify mode:**
1. For each blocking FAIL where triage = code-is-wrong:
   ```bash
   cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue create --title 'QA: [scenario ID] — [description]' --labels 'pipeline:qa' --stdin
   ## QA Failure

   **Scenario:** [scenario ID]
   **Work Package:** [WP-NNN]
   **Triage:** code-is-wrong
   **Evidence:** [failure details]

   Linked to: #[EPIC_N]
   EOF
   ```
   If the command fails, notify the user with the error and ask for guidance.
2. Comment the verdict summary on the epic.

If no epic found: skip — QA works without GitHub tracking.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml:

Locate and read the dashboard skill, then regenerate `docs/dashboard.html`.
