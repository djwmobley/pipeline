---
name: reviewing
description: Per-change quality review process — config-driven criteria, severity tiers, non-negotiable filtering
---

# Code Review Process

## Overview

Review changed code against configurable criteria. Find real problems only.
Never flag intentional architectural decisions listed in `review.non_negotiable[]`.

**Core principle:** Evidence-based findings with actionable fixes. No praise. No rubber-stamping.

<ADVERSARIAL-MANDATE>
Every review MUST produce at least one finding OR an explicit "Clean Review Certificate" that lists:
- What was checked (each criterion)
- Why no issues were found (specific evidence, not "looks good")
- What the riskiest part of the change is and why it's acceptable

An empty review with no findings and no certificate is a FAILED review. Start over.
If you catch yourself thinking "this looks fine" — that thought is a red flag. Read the code again.
</ADVERSARIAL-MANDATE>

**Confidence Levels:** Every finding MUST include a confidence level.
- **HIGH** — You verified the issue exists in the code (traced the execution path, confirmed the type, read the call site)
- **MEDIUM** — Strong inference from patterns, but not fully traced (e.g., likely null but didn't confirm all callers)
- **LOW** — Possible issue based on common pitfalls, but not verified in this specific code

## The Process

1. Load non-negotiable decisions from `review.non_negotiable[]` in pipeline.yml
2. Run static analysis (typecheck + lint) — tool findings are automatic 🔴 HIGH
3. Run SAST scan (Step 2b) — see Static Analysis (SAST) section below
4. Get the diff — understand what changed
5. Read each changed file in full — understand context
6. Review against `review.criteria[]` — apply each configured criterion
7. Report with severity tiers — 🔴 HIGH / 🟡 MEDIUM / 🔵 LOW format

## Static Analysis (SAST) — Step 2b

Deterministic security scanning via semgrep. Runs between typecheck/lint and diff read.
Configured via `static_analysis` in pipeline.yml.

### Execution

1. **Check config:** Read `static_analysis.semgrep.enabled` from pipeline.yml.
   - `false` → skip SAST entirely
   - `"auto"` → probe for semgrep binary (see step 2)
   - `true` → require semgrep (warn if missing, but continue)

2. **Probe for semgrep:**
   ```bash
   command -v semgrep
   ```
   If not found and `static_analysis.grep_fallback` is true, fall back to grep patterns (step 5).
   If not found and grep_fallback is false, skip with note in report header.

3. **Run semgrep on changed files:**
   Locate the pipeline plugin's `rules/semgrep/` directory:
   - If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/rules/semgrep/`
   - Otherwise: search for `rules/semgrep/` under the plugin installation path

   Build the semgrep command:
   ```bash
   semgrep scan --json --timeout 30 \
     --config '[rules_dir]/' \
     [--config 'user_ruleset' for each entry in static_analysis.semgrep.rulesets] \
     --include '[file1]' --include '[file2]' ...
   ```
   Scope to changed source files only (from the diff). Pass `--include` for each changed file.

4. **Map findings to review format:**
   Parse the JSON output. For each finding:
   - Map severity using `static_analysis.severity_mapping` (error→high, warning→medium, info→low)
   - Tag with source `sast:semgrep`
   - Include the rule ID, file path, line number, and semgrep's message
   - SAST findings at HIGH are automatic 🔴 HIGH (same treatment as typecheck/lint failures)

5. **Grep fallback** (when semgrep is unavailable):
   Run `redteam.recon_patterns` from pipeline.yml as grep patterns against changed files.
   These contain security-specific patterns (eval, innerHTML, exec, SQL concat, etc.)
   and serve as the zero-dependency fallback for the same security signals.
   Tag findings with source `sast:grep-fallback`.

6. **Deduplicate:** If both semgrep and grep patterns ran (unlikely but possible with
   custom configs), suppress grep findings for lines already flagged by semgrep.

### Report Header

Include a static analysis summary at the top of the review report:

```
## Static Analysis
Tools: semgrep v[version] | grep fallback: [active/inactive]
Rules: [N] custom security [+ M user rulesets]
Findings: [count] ([HIGH count] high, [MEDIUM count] medium, [LOW count] low)
```

If SAST was skipped entirely, report:
```
## Static Analysis
Skipped: [reason — disabled in config / semgrep not found, no grep fallback]
```

## Diff Scope

Review is scoped to the feature branch diff by default:

```bash
git diff --name-only [BASELINE_SHA]...HEAD
```

Where `[BASELINE_SHA]` is the merge-base with the base branch (from `project.branch` in pipeline.yml). Read each changed file in full for context, but only produce findings for changed code. The review serves as the PR gate in the orchestrated workflow.

## Architecture Plan Compliance

If `docs/architecture.md` exists, read it and add these checks to the review:

- **Module boundaries** — do the changes respect the module structure defined in the arch plan? Cross-boundary imports that bypass the public interface are 🔴 HIGH.
- **Typed contracts** — do function signatures match the contract shapes in the arch plan? Mismatches are 🔴 HIGH.
- **Banned patterns** — does the code use any pattern explicitly banned in the arch plan? Violations are 🔴 HIGH.
- **Cross-task consistency** — if multiple build tasks were implemented, do they integrate correctly per the arch plan's integration points?

If no arch plan exists, skip this section silently.

## Reporting Contract

All three stores, every time. This is the A2A contract — the QA agent reads
review results to understand what was validated and what needs testing focus.

**Runtime placeholders** (resolved by the review command before executing):
- `[GITHUB_REPO]` — `integrations.github.repo` from pipeline.yml. Empty if GitHub disabled.
- `[GITHUB_ISSUE]` — task issue number for this review phase. Empty if GitHub disabled.

### 1. Postgres Write

Record results in the knowledge DB:
```
PROJECT_ROOT=$(git rev-parse --show-toplevel) node "$PROJECT_ROOT/scripts/pipeline-db.js" insert knowledge \
  --category 'review' \
  --label 'review-verdict' \
  --body "$(cat <<'BODY'
{"verdict": "PASS|FAIL", "findings": {"high": N, "medium": M, "low": P}, "arch_compliance": "PASS|FAIL|SKIPPED", "sast_findings": N}
BODY
)"
```

### 2. GitHub Issue Comment (if task issue is available)

Post the review verdict as a comment on the task issue:
```
gh issue comment [GITHUB_ISSUE] --repo '[GITHUB_REPO]' --body "$(cat <<'EOF'
## Review
**Verdict:** [PASS/FAIL]
**Findings:** [N] high, [M] medium, [P] low
**Arch compliance:** [PASS/FAIL/SKIPPED]
**SAST:** [N findings | skipped]

[For FAIL: list 🔴 HIGH finding IDs + one-line descriptions]
EOF
)"
```

### 3. Build State

Update `build-state.json` with review status for crash recovery.

### Fallback (GitHub disabled)

If GitHub is not enabled, skip the issue comment.
Postgres write, build state update, and the findings report are always required.

## Severity Calibration

**🔴 HIGH — Must fix** — Will cause bugs, security issues, crashes, or data loss in production.
Includes: type errors, unhandled rejections on user actions, security vulnerabilities,
access control gaps, null dereferences on reachable paths.
**Confidence requirement: HIGH only.** You MUST have verified the bug or vulnerability exists. If you cannot trace the execution path to confirm, downgrade to 🟡 MEDIUM.

**🟡 MEDIUM — Should fix** — Quality issues that degrade maintainability or user experience.
Includes: dead code, unused imports, UX clarity issues, premature abstractions,
SOLID violations that manifest as real problems.
**Confidence requirement: HIGH or MEDIUM.** You MUST have strong evidence. If your reasoning is "this might be a problem," downgrade to 🔵 LOW.

**🔵 LOW — Consider** — Suggestions that would improve the code but are not problems.
Includes: alternative approaches, performance optimizations, readability improvements.
**Any confidence level accepted, but you MUST state it.** A LOW confidence 🔵 LOW is valid; an unstated confidence is not.

## Review Dimensions

The Big 4 dimensions apply to code review, not just design:
- **Functionality** — correctness, spec compliance (core of every review)
- **Usability** — user-facing clarity, error messages, accessibility (when task touches UI/API)
- **Performance** — scalability, resource usage, query efficiency (when task touches data/compute)
- **Security** — already enforced via safety guards and non-negotiables

Not every review touches all four. Apply the dimensions relevant to the changed files.

## Non-Negotiable Filtering

Before flagging ANY finding, check it against `review.non_negotiable[]`.
Each entry describes an intentional pattern and why it exists.
If a finding matches a non-negotiable, suppress it completely — do not even mention it.

## Framework Detection

Detect the project's framework from dependencies:
- `react` / `react-dom` → React correctness checks
- `vue` → Vue correctness checks
- `@angular/core` → Angular correctness checks
- `svelte` → Svelte correctness checks

Apply framework-specific correctness checks automatically based on detection.

## Key Principles

- **Real problems only** — if you wouldn't block a PR for it, it's 🔵 LOW at most
- **Full context** — read the whole file, not just the diff
- **Non-negotiable respect** — never flag intentional patterns
- **Actionable fixes** — every 🔴 HIGH finding includes a specific fix description
- **Simplify handoff** — collect simplicity/SOLID findings for /pipeline:simplify
