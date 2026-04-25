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

### Step 3 — Generate QA Section

Output a `## QA Strategy` section for the implementation plan:

```markdown
## QA Strategy

### Risk Assessment
1. [Risk]: [description — e.g., "Cart state persists after session expiry, causing stale checkout"]
2. [Risk]: [description]
3. [Risk]: [description]
4. [Risk]: [description]
5. [Risk]: [description]

### P0 Test Scenarios
- TS-001: [name] — [what it verifies, business behavior]. Type: [unit/integration/e2e]. Covers risk: [N].
- TS-002: [name] — [what it verifies]. Type: [type]. Covers risk: [N].
- ...

### Seam Tests
- SEAM-001: [integration boundary] — [what could go wrong at this boundary]
- SEAM-002: [integration boundary] — [what could go wrong]
- ...

### Test Intent Rule
Every test MUST include a comment: `// Verifies: [business behavior] (TS-NNN)`
```

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
