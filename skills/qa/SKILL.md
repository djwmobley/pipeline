---
name: qa
description: "Lead QA — strategic test planning and verification. Inline QA section for MEDIUM, full test plan + parallel workers for LARGE+."
operation_class: haiku_judgment
allowed_models: []
allowed_direct_write: false
---

# Lead QA

Strategic test planning and verification. Reads the spec, codebase, and implementation plan to identify what to test and why — focused on component interaction risks, not just acceptance criteria tracing.

## Two Capabilities

**Plan mode** — generate the test strategy before build:
- Inline (MEDIUM): QA section embedded in the implementation plan. 1 agent call.
- Standalone (LARGE/MILESTONE): separate test plan artifact with work packages.

**Verify mode** — execute the test strategy after build:
- Targeted (MEDIUM): 3-5 focused checks, appended to build output. 1 agent call.
- Full (LARGE/MILESTONE): parallel QA workers per work package + seam pass.

## Size Routing

| Size | Plan Mode | Verify Mode |
|------|-----------|-------------|
| TINY | None | None (existing lint + typecheck) |
| MEDIUM | Inline QA section in implementation plan | Auto-verify: 3-5 targeted checks |
| LARGE | Separate test plan, shown for approval | Parallel workers + seam pass |
| MILESTONE | Test plan + builder risk interview (5-7 Qs) | Workers + seam pass + fix-rerun cycle |

## Plan Mode — Inline (MEDIUM)

Invoked automatically inside `/pipeline:plan`. No separate command.

### Step 1 — Analyze Documents

Read all available inputs:
- Spec document (from brainstorm)
- Architectural constraints (from recon, embedded in planner context)
- Implementation plan tasks (being generated alongside this QA section)
- Existing test files in the codebase (patterns, fixtures, coverage)

### Step 2 — Risk Identification

**This is the core value.** Do NOT just trace acceptance criteria to test cases. Instead:

1. Read the implementation plan tasks and identify **component interaction points** — where does data flow between modules, services, or layers?
2. Identify the **top 5 risks** at these interaction points:
   - What happens if module A sends unexpected data to module B?
   - What happens at the boundary between new code and existing code?
   - What state transitions could leave the system inconsistent?
   - What error paths cross component boundaries?
   - What timing/ordering assumptions exist?
3. For each risk, write a P0 test scenario

### Step 3 — Generate QA Section (anchored format — REQUIRED)

Every Risk, P0 Test Scenario, and Seam Test row MUST start with `[Key: Value]` anchor tags that resolve against the plan body and the filesystem. Unanchored rows and rows whose anchors do not resolve are rejected by `scripts/pipeline-lint-plan.js` (Step 4 below). Reasoning agents have historically fabricated Task IDs, file paths, and function signatures; the anchor format makes fabrication structurally detectable.

**Required anchors per row type:**

| Row type | Required | Optional |
|----------|----------|----------|
| Risk (R&lt;n&gt;) | `[Task: N.M]` ≥1 OR `[Constraint: DECISION-NNN]` ≥1 | `[Files: ...]` |
| P0 Test Scenario (TS-NNN) | `[Risk: R&lt;n&gt;]` ≥1 AND `[Task: N.M]` ≥1 | `[Files: ...]`, `[Function: name]`, `[Field: name]` |
| Seam Test (SEAM-NNN) | `[Tasks: N.M, P.Q]` ≥2 AND `[Files: a, b]` ≥2 | `[Function: name]` |

**Anchor value formats:**
- `[Task: 1.5]` or `[Tasks: 1.5, 2.2]` — must resolve to `### Task N.M:` headers in the plan
- `[Files: scripts/foo.js]` or `[Files: scripts/foo.js, scripts/bar.js]` — each path must exist on disk OR appear in a cited Task's `**Files:**` block
- `[Risk: R3]` or `[Risks: R1, R2]` — must resolve to a defined `**R&lt;n&gt;**` row in this same QA section
- `[Constraint: DECISION-002]` — must resolve to a `**DECISION-NNN:**` line in Architectural Constraints → Decisions for This Feature
- `[Function: getChunkTables]` or `[Field: maxRetries]` — must appear verbatim in a code block of any cited Task

**Output format:**

Risk rows describe **failure mode only** — `Boundary`, `Failure mode`, `Severity`. The mitigation IS the cited Task; do not write `Mitigation:` / `Mitigated by:` / `Implementation:` / `Solution:` prose. The linter rejects rows containing these words. Mitigation prose is the most fabrication-prone surface; if you find yourself wanting to describe the fix, the fix lives in the cited Task and that is enough.

```markdown
## QA Strategy

### Risk Assessment

- **R1** [Task: 1.5] [Files: scripts/setup-knowledge-db.sql] — Boundary: setup-knowledge-db.sql ↔ existing session_chunks rows. Failure mode: UNIQUE constraint creation collides with pre-migration duplicate rows. Severity: CRITICAL.
- **R2** [Task: 1.6] — Boundary: routing-check.js process lifecycle ↔ subagent dispatch. Failure mode: warning suppression flag is in-process; if Claude Code spawns a fresh hook process per invocation, "once-per-session" semantics never trigger. Severity: HIGH.
- **R3** [Constraint: DECISION-002] — Boundary: embedWithRetry shared helper ↔ embedPending and cmdIndex callers. Failure mode: extraction loses caller-supplied options object semantics. Severity: HIGH.
- (5 risks total, ordered by severity)

### P0 Test Scenarios

- **TS-001** [Risk: R1] [Task: 1.5] [Files: scripts/test-chunker.js, scripts/setup-knowledge-db.sql] — Business behavior verified. Type: integration.
- **TS-002** [Risks: R1, R2] [Task: 1.5] [Function: addUniqueConstraint] — ...
- (6-10 scenarios; each maps to one or more risks; at least one per phase)

### Seam Tests

- **SEAM-001** [Tasks: 1.2, 2.4] [Files: commands/finish.md, scripts/pipeline-memory-loader.js] — Boundary description.
- (3-5 boundaries)

### Test Intent Rule
Every test MUST include a comment: `// Verifies: [business behavior] (TS-NNN)`
```

**Anti-fabrication rules:**

1. **Never invent a Task ID.** If a risk applies to a task that does not exist in the plan, the risk is out of scope — drop it or pick a different boundary.
2. **Never invent a file path.** If a risk involves a file the plan never edits or creates, that risk is not actually in scope for this plan — drop it.
3. **Never invent a function or field signature.** Read the cited Task's body verbatim to confirm names. The linter checks that `[Function: name]` and `[Field: name]` tokens appear in the cited Task's body. If a field is defined in a Decision (e.g., `maxRetries` in DECISION-002), anchor the field reference to the Decision: `[Constraint: DECISION-002]`, not to a Task that doesn't name it.
4. **Never invent a state-persistence design.** If a risk's failure-mode description requires naming a mechanism the cited Task does not implement (e.g., "writes to `.claude/pipeline.yml` flag" when the Task uses an in-process flag), the description is fabricated — re-read the Task and name the actual mechanism.
5. **No Mitigation: / Mitigated by: / Implementation: / Solution: prose.** The linter rejects these keywords in Risk rows. The mitigation IS the cited Task. State the boundary and the failure mode; the cited Task IS the answer.

If you cannot anchor a risk, the risk is not real for this plan. Drop it. Do not write prose that "sounds plausible."

### Step 4 — Lint the QA section (REQUIRED gate)

After writing the QA section, run:

```bash
node scripts/pipeline-lint-plan.js --plan [plan path]
```

Exit 0 = pass. Exit 1 = findings. Findings are line-numbered and actionable.

**On findings:** regenerate ONLY the offending rows with the lint output as input context. Do not rewrite the entire section. Re-run the linter. Iterate up to 3 times; if findings persist, surface to the orchestrator with the lint output and stop.

**On pass:** the QA section is ready for the plan-reviewer dispatch.

Build agents see this section alongside their tasks and write tests that map to it.

## Plan Mode — Standalone (LARGE/MILESTONE)

Invoked via `/pipeline:qa plan` or auto-invoked after `/pipeline:plan` saves.

### Step 1 — Read All Inputs

Read:
- Spec document
- Decision records (from architect, if they exist)
- Implementation plan (all tasks)
- Existing test patterns in the codebase (framework, organization, fixtures)

### Step 2 — Builder Risk Interview (MILESTONE only)

For MILESTONE changes, ask the builder 5-7 risk questions. One at a time:

1. "What part of this feature are you least confident about?"
2. "What existing functionality could this break?"
3. "Where are the boundaries between this new code and existing systems?"
4. "Any known data edge cases or format quirks?"
5. "What would a user notice first if this feature has a bug?"
6. (If applicable) "Are there concurrent access patterns to worry about?"
7. (If applicable) "Any third-party integrations with known reliability issues?"

For LARGE changes, skip the interview. The documents are sufficient.

### Step 3 — Generate Test Plan

Dispatch the QA planner using `planner-prompt.md` from this skill directory.

The planner receives all inputs and produces the test plan artifact.

### Step 4 — Validate Test Plan

Before saving, validate:
- Every P0 acceptance criterion has at least one test scenario
- Every test scenario maps to exactly one work package
- No route/feature overlap between work packages
- Seam tests identified for top 3-5 integration boundaries
- Every work package lists required tools (vitest/playwright/psql/etc.)

If validation fails, fix the plan (don't re-dispatch — fix inline).

### Step 5 — Save Artifact

Save to `docs/plans/YYYY-MM-DD-{feature}-test-plan.md`:

```markdown
# Test Plan — [Feature Name]

**Date:** [date]
**Spec:** [path] | **Decisions:** [path or "inline"] | **Plan:** [path]

## Risk Assessment
- **Builder's concerns:** [from interview, or "N/A — LARGE, no interview"]
- **Top risks (component interaction level):**
  1. [Risk + where it lives]
  2. [Risk + where it lives]
  3. [Risk + where it lives]
  4. [Risk + where it lives]
  5. [Risk + where it lives]

## Acceptance Criteria
- AC-001: [criterion, from spec]
- AC-002: [criterion]
- ...

## Test Scenarios

### TS-001: [Scenario Name]
- **Type:** unit / integration / e2e / visual / db-state
- **Priority:** P0 (must pass) / P1 (should pass)
- **Covers:** AC-001, Risk #3
- **Work package:** WP-001
- **Steps:**
  1. [setup]
  2. [action]
  3. [assertion]
- **Edge cases:**
  - [case 1]
  - [case 2]
- **Test intent:** "Verifies: [business behavior]"

[repeat for each scenario]

## Seam Tests

### SEAM-001: [Integration Boundary Name]
- **Components:** [A] ↔ [B]
- **Risk:** [what could go wrong at this boundary]
- **Work package:** WP-SEAM (or assigned to specific WP if one side owns it)
- **Steps:**
  1. [setup both sides]
  2. [trigger interaction]
  3. [assert on both sides]

## Work Packages

### WP-001: [Package Name]
- **Routes/features:** [explicit list — no overlap with other WPs]
- **Scenarios:** TS-001, TS-003, TS-007
- **Tools needed:** [vitest / playwright / chrome-devtools / psql / curl]
- **Estimated complexity:** low / medium / high

### WP-002: [Package Name]
...

### WP-SEAM: Seam Integration Tests
- **Boundaries:** SEAM-001, SEAM-002, SEAM-003
- **Tools needed:** [typically integration — vitest + actual DB/API]
- **Note:** Runs AFTER all other work packages complete

## Coverage Matrix

| Acceptance Criterion | Priority | Test Scenarios | Work Package |
|---------------------|----------|----------------|--------------|
| AC-001 | P0 | TS-001, TS-003 | WP-001 |
| AC-002 | P0 | TS-002 | WP-002 |
| AC-003 | P1 | TS-005 | WP-001 |

## Coverage Metrics (reported, never gated)

- P0 AC coverage: [N/M] scenarios cover P0 criteria
- P1 AC coverage: [N/M] scenarios cover P1 criteria
- Seam coverage: [N/M] identified integration boundaries tested
- Code coverage: [will be reported after verify]

**No P2 automation.** P2 scenarios noted as manual test notes only.
```

### Step 6 — Present to Builder

Show the builder a summary: risk count, scenario count, work package count, seam test count.
Ask for approval before proceeding.

## Verify Mode — Targeted (MEDIUM)

Auto-runs from `/pipeline:build` when build completes. No separate command.

### Step 1 — Read QA Section

Read the `## QA Strategy` section from the implementation plan.

### Step 2 — Run Targeted Checks

For each P0 test scenario listed in the QA section:
1. Check if the build agent already wrote and ran a test for it (from TDD steps)
2. If yes, verify the test exists and passes (read test file, run test command)
3. If no, write and run the test

For each seam test:
1. Write a minimal integration test covering the boundary
2. Run it

Limit to 3-5 checks total. This is a quick sanity pass, not a full suite run.

### Step 3 — Append Results

Append to build output (not a separate report):

```
## QA Verification (auto)

✅ TS-001: [name] — PASS
✅ TS-003: [name] — PASS
❌ SEAM-001: [boundary] — FAIL: [one-line error]
✅ TS-005: [name] — PASS

Result: 3/4 passing. 1 seam test failure — [brief description].
```

If failures: present to builder inline. Do not auto-fix.

## Verify Mode — Full (LARGE/MILESTONE)

Invoked via `/pipeline:qa verify` after build completes.

### Step 1 — Read Test Plan

Read the test plan from `docs/plans/`.

### Step 2 — Dispatch QA Workers

For each work package (except WP-SEAM), dispatch a QA worker using `worker-prompt.md`.

Launch ALL workers in parallel.

Substitutions per worker:
- `{{MODEL}}` → `models.qa` from pipeline.yml (e.g., `sonnet`)
- `[WORK_PACKAGE_ID]` → work package ID (e.g., `WP-001`)
- `[WORK_PACKAGE_NAME]` → work package name
- `[SCENARIOS]` → full text of all test scenarios assigned to this work package
- `[TOOLS_LIST]` → tools this worker can use (from work package definition)
- `[SOURCE_DIRS]` → `routing.source_dirs` from pipeline.yml
- `[TEST_COMMAND]` → `commands.test` from pipeline.yml
- `[BROWSER_TESTING]` → `qa.browser_testing` from pipeline.yml (true/false)
- `[DB_VERIFICATION]` → `qa.db_verification` from pipeline.yml (true/false)
- `[FLAKE_RETRIES]` → `qa.flake_retries` from pipeline.yml (default: 1)
- `[EXISTING_TEST_PATTERNS]` → summary of existing test framework, file organization, fixture patterns
- `[ARCH_PLAN]` → contents of `docs/architecture.md` if it exists, or "No architecture document available"
- `[GITHUB_REPO]` → `integrations.github.repo` from pipeline.yml. Empty string if GitHub disabled.
- `[GITHUB_ISSUE]` → task issue number for this QA phase. Empty string if GitHub disabled.
- `[SCRIPTS_DIR]` → path to pipeline's scripts/ directory (absolute)

Workers return structured results per scenario: PASS/FAIL + evidence.

### Step 3 — Seam Pass

After ALL workers complete, the QA lead runs the seam pass.

Dispatch the verifier using `verifier-prompt.md`. The verifier receives:
- All worker results
- The seam test definitions from the test plan
- The coverage matrix

The verifier:
1. Runs each seam test (SEAM-001 through SEAM-N)
2. Cross-references worker results against the coverage matrix
3. Identifies gaps: ACs without passing tests, risks without coverage
4. **Failure triage:** For each failure, distinguishes:
   - "Test is wrong" — test assertion doesn't match spec/implementation correctly
   - "Code is wrong" — implementation has a bug
   - "Flaky" — test failed then passed on retry (only for e2e/visual)
5. Produces the test report

### Step 4 — Fix-and-Rerun (MILESTONE only)

If blocking failures exist (code-is-wrong or untriaged):
1. Present failures to builder with triage assessment
2. Offer: "Fix blocking failures and re-verify failed packages?"
3. If yes: fix agent addresses each failure, then re-dispatch ONLY failed work packages
4. Max 1 re-verify cycle. If failures persist after re-verify, escalate to builder.

For LARGE: present failures, do NOT auto-fix. Builder decides.

### Step 5 — Save Test Report

Save to `docs/findings/qa-report-YYYY-MM-DD.md`:

```markdown
# QA Verification Report — [Feature Name]

**Date:** [date] | **Test Plan:** [path] | **Workers:** [count]

## Verdict: PASS / FAIL / PARTIAL

## Summary
[2-3 sentences: what was tested, pass rate, blocking failures]

## Results by Work Package

### WP-001: [Name] — PASS/FAIL
| Scenario | Result | Evidence | Triage |
|----------|--------|----------|--------|
| TS-001 | PASS | [test output / screenshot path] | — |
| TS-002 | FAIL | [error message] | code-is-wrong |

### WP-SEAM: Seam Tests — PASS/FAIL
| Seam | Result | Evidence | Triage |
|------|--------|----------|--------|
| SEAM-001 | PASS | [test output] | — |
| SEAM-002 | FAIL | [error] | test-is-wrong |

## Failures
### FAIL-001: TS-002 — [Description]
- **Triage:** code-is-wrong / test-is-wrong / flaky
- **Work package:** WP-001
- **Expected:** [what should happen]
- **Actual:** [what happened]
- **Evidence:** [test output / screenshot / db state]
- **Suggested fix:** [if apparent]

## Flake Report
[List any tests that failed then passed on retry — these need investigation]

## Coverage Metrics (reported, never gated)
- P0 AC coverage: [N/M] ([%])
- P1 AC coverage: [N/M] ([%])
- Seam coverage: [N/M] ([%])
- Code line coverage: [%] (from test runner, if available)
```

### Step 6 — Persist to Knowledge Tier

**Postgres tier:**

Record the session (use `query "SELECT COALESCE(MAX(number),0)+1 FROM sessions"` to get next session number):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update session [next_number] [scenario_count] "$(cat <<'EOF'
QA verify: [PASS/FAIL/PARTIAL] — [N] scenarios, [M] failures
EOF
)"
```

For each blocking failure, persist as a gotcha:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update gotcha "$(cat <<'TOPIC'
qa-failure-[feature]-[scenario-id]
TOPIC
)" "$(cat <<'DETAIL'
[failure description + triage]
DETAIL
)"
```

**Files tier:** Save report only (no separate gotcha files for QA failures).

## Flake Management

- **Retry strategy:** `qa.flake_retries` for e2e/visual tests (default: 1). Unit tests get 0 retries always — a flaky unit test indicates a concurrency bug.
- **Screenshot comparison:** Structural analysis (DOM snapshot, element presence/position) not pixel-perfect diff. Follow existing ui-review pattern.
- **DB isolation:** Each worker uses isolated test transactions or a prefixed test database. Workers MUST NOT share mutable DB state.
- **Flake quarantine:** Tests that fail-then-pass on retry are flagged in the report. If the same test flakes across multiple runs, it should be noted as a known flaky test.

## Test Intent Documentation

**Mandatory for every AI-generated test:**

```javascript
// Verifies: expired coupons are rejected at checkout (AC-003, TS-007)
test('rejects expired coupon at checkout', () => { ... });
```

NOT:
```javascript
// Tests validateCoupon() throws when isExpired is true
test('validateCoupon throws on expired', () => { ... });
```

The intent comment states **business behavior**, not code paths. This makes tests maintainable by future agents who lack the original context.

## Anti-Rationalization

| Thought | Reality |
|---------|---------|
| "The spec covers everything" | Specs capture ~40% of behaviors that matter. Read the code. |
| "AC tracing is sufficient" | The hardest bugs live at component seams, not within components. |
| "100% coverage means quality" | Coverage measures execution, not correctness. Focus on risks. |
| "P2 tests are cheap to add" | P2 tests are expensive to maintain. Note them, don't automate them. |
| "The seam pass is redundant" | Workers test within boundaries. Nobody tests across them without the seam pass. |
| "This failure is probably flaky" | Classify it first. Unit test flakes = concurrency bugs. |
| "Let me fix the test to pass" | Distinguish test-is-wrong from code-is-wrong FIRST. |
