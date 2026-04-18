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
6. **Always-on checks** — apply the Big 4 dimensions, branch/boundary analysis, intra-file contract verification, and cross-file contract verification to every review regardless of config
7. Report with severity tiers — 🔴 HIGH / 🟡 MEDIUM / 🔵 LOW format

The review command (`commands/review.md`) defines the authoritative step sequence including config criteria (between steps 6 and 7), post-report persistence (steps 8, 8b, 8c), and simplify handoff. This skill defines the criteria and calibration for steps 2-7.

## Static Analysis (SAST) — Step 2b

Deterministic security scanning via semgrep. Runs between typecheck/lint and diff read.
Configured via `static_analysis` in pipeline.yml.

### Execution

1. **Check config:** Read `static_analysis.semgrep.enabled` from pipeline.yml.
   - `false` → skip SAST entirely
   - `"auto"` or **missing/undefined** → probe for semgrep binary (see step 2)
   - `true` → require semgrep (warn if missing, but continue)
   If the `static_analysis` section is absent from pipeline.yml, treat as `"auto"`.
   If `static_analysis.grep_fallback` is missing/undefined, treat as `false`.

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
- `[SCRIPTS_DIR]` — path to pipeline's scripts/ directory (absolute).
- `[GITHUB_ISSUE]` — task issue number for this review phase. Empty if issue tracking is disabled.

### 1. Postgres Write

Record results in the knowledge DB:
```
node '[SCRIPTS_DIR]/pipeline-db.js' insert knowledge \
  --category 'review' \
  --label 'review-verdict' \
  --body "$(cat <<'BODY'
{"verdict": "PASS|FAIL", "findings": {"high": N, "medium": M, "low": P}, "arch_compliance": "PASS|FAIL|SKIPPED", "sast_findings": N}
BODY
)"
```

### 2. Issue Comment (if task issue is available)

Post the review verdict as a comment on the task issue:
```
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [GITHUB_ISSUE] --stdin
## Review
**Verdict:** [PASS/FAIL]
**Findings:** [N] high, [M] medium, [P] low
**Arch compliance:** [PASS/FAIL/SKIPPED]
**SAST:** [N findings | skipped]

[For FAIL: list 🔴 HIGH finding IDs + one-line descriptions]
EOF
```

If the command fails, notify the user with the error and ask for guidance.

### 3. Build State

Update `build-state.json` with review status for crash recovery.

### Fallback

- **Issue tracking disabled** (`[GITHUB_ISSUE]` is empty): skip the issue comment.
- **Postgres unreachable:** log the failure in the review report. The findings file in `docs/findings/` is the fallback record. The orchestrator retries the Postgres write on next dispatch.
- Build state update and the findings report are always required.

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

## Review Dimensions (Always-On)

The Big 4 dimensions are **always-on** — they apply to every review regardless of `review.criteria[]` config. Config criteria are *additional* checks on top of these.

- **Functionality** — correctness, spec compliance, branch/boundary completeness. **Always applies.** This is the core of every review. Includes: does the code do what it claims? Are all conditional branches handled? Do edge cases (null, undefined, empty, first-run) work?
- **Usability** — user-facing clarity, error messages, accessibility. Applies when the change touches UI, CLI output, API responses, or documentation that users read.
- **Performance** — scalability, resource usage, query efficiency. Applies when the change touches data processing, loops, I/O, or network calls. **For schema/migration changes** (ALTER TABLE, index creation, GENERATED STORED columns, long-running UPDATEs): flag the lock profile and backfill cost. `ADD COLUMN` on a STORED generated column rewrites every row under ACCESS EXCLUSIVE; `CREATE INDEX` without `CONCURRENTLY` blocks writes; bulk `UPDATE` on a hot table can fragment indexes. Acceptable at small scale, dangerous at user scale — require an explanatory comment or a scheduled migration note on any DDL that scales with row count.
- **Security** — input validation, injection, access control. Already enforced via SAST and non-negotiables, but also applies to manual review when SAST is unavailable.

The config's `review.criteria[]` (e.g., `dead-code`, `simplicity`, `SOLID`) are checked *in addition to* the Big 4. They are never a substitute.

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

## Cross-File Contract Verification

Do not review files in isolation. Trace contracts across file boundaries:

1. **Placeholder contracts** — if a file defines a substitution checklist (e.g., `[SCRIPTS_DIR]`, `[TASK_ISSUE]`), verify every use of that placeholder in the prompt body matches the checklist definition. Then verify the parent SKILL.md's "Runtime placeholders" section lists the same set. Mismatches are 🔴 HIGH.

2. **Pattern consistency** — if the change uses a pattern (e.g., `node '[SCRIPTS_DIR]/pipeline-db.js'`), check how the same operation is done in related files (other prompt templates, the parent SKILL.md, already-shipped agents). Divergence without documented rationale is 🟡 MEDIUM.

3. **Reporting contract alignment** — if the file has a Reporting Contract section, verify the Postgres write JSON fields, issue comment format, and build-state update are consistent with what the parent SKILL.md documents. The SKILL.md is the contract; the prompt must match it.

**How to trace:** Read the substitution checklist first. Then search the prompt body for every `[BRACKET]` and `{{BRACE}}` placeholder. Confirm each one is (a) in the checklist and (b) used correctly per the checklist's definition. Then read the parent SKILL.md and confirm the runtime placeholders section matches.

## Structural Completeness Audit

After reviewing code quality, verify the document's internal structure is self-consistent:

1. **Section references** — if the text says "remove the `## Finding Context` section" or "skip Part 3", verify that section/part exists in the document. Dangling references are 🔴 HIGH.

2. **Required sections** — every agent prompt in the v2 architecture must have:
   - Substitution checklist (top of file)
   - DATA tags on all externally-sourced content
   - Context read instructions (if agent reads from stores)
   - ANTI-RATIONALIZATION block
   - Reporting Contract (Postgres + issue comment + build-state + fallback)
   - Output format (structured for orchestrator parsing)
   Missing sections are 🔴 HIGH.

3. **Enumerable completeness** — if the document promises "N items" or "every X has Y" (e.g., "every question has three engagement variants"), enumerate them. List each X and verify it has Y. Do not scan — count. Missing items are 🟡 MEDIUM.

## Fallback Symmetry

For every operation that can fail, verify the failure path is documented:

1. **Read/write pairs** — if a Postgres READ has a fallback ("continue without"), the corresponding Postgres WRITE must also have a fallback. Check both directions for every store (Postgres, issue tracker, build-state, file system).

2. **Shell command validation** — every shell command that uses externally-sourced values (commit SHAs from issue comments, project names from directories, finding IDs from triage) must have a validation instruction. Check: is the value validated before it reaches a shell command? If not, 🔴 HIGH.

3. **Disabled-service paths** — if issue tracking can be disabled, trace every platform CLI command to confirm it has a guard. If Postgres can be unavailable, trace every `pipeline-db.js` / `pipeline-context.js` call to confirm it has a fallback. Unguarded commands are 🔴 HIGH.

4. **Swallowed-error audit** — grep the diff for error-suppressing patterns and verify each one is intentional and documented: `catch (_) {}`, `catch (_) { return null }`, `|| true` on a pipe, `2>/dev/null` on a command whose failure matters, `.catch(() => undefined)`, `try { ... } catch {}` (bare). Each one is a silent failure by construction. If the comment above doesn't explain *why* the error is being swallowed and what the degraded behavior looks like to the caller, that's 🟡 MEDIUM at minimum — 🔴 HIGH when the suppressed operation is in a write path (embeddings, metrics, audit logs). Intended silent failures (best-effort operations like `tryEmbed`) must have a comment naming the degradation.

## Platform Portability

Pipeline runs on Windows (Git Bash + Claude Code Bash tool), macOS (bash/zsh), and Linux (bash).
Commands and scripts must work on all three without a per-platform branch unless the difference
is explicitly documented. Scan shell snippets and script code for portability traps:

1. **GNU-specific flags** — `sed -i` (BSD sed requires `sed -i ''`), `date -d` (BSD uses `-j`),
   `readlink -f` (not on macOS), `stat --format` (BSD uses `-f`). Either use a POSIX-common
   subset or document the requirement (e.g., "requires GNU sed, install via `brew install gnu-sed`").

2. **Tool assumptions** — `wc`, `head`, `tail`, `grep`, `awk` are present on every Claude Code
   target (Windows uses Git Bash which ships them). But `jq`, `yq`, `semgrep`, `pnpm`, `docker`,
   `gh`, `az` are NOT guaranteed. For each tool reference, confirm it's probed first
   (`command -v tool` or equivalent) or listed as a documented requirement.

3. **Path separators** — scripts must handle both `/` and `\`. Node/JS code handles this via `path.sep`.
   Shell snippets should avoid hard-coded Windows-only paths (`C:\\...`) and Unix-only paths
   (`/usr/...`) unless guarded by an OS check.

4. **Line endings** — generated files should use LF, not CRLF. Any script that writes a
   shell-executable file should explicitly write LF. Verify `.gitattributes` covers the extensions.

5. **`/dev/stdin` and `/dev/null`** — `/dev/null` is available on all three via Git Bash emulation;
   `/dev/stdin` is unreliable on Windows Node (`Error: no such file or directory, open 'C:\dev\stdin'`).
   Piping to `node -e 'require("fs").readFileSync("/dev/stdin")'` fails on Windows — use
   `process.stdin` streams or a temp file instead.

Portability failures that block a command on any of the three platforms are 🔴 HIGH. Portability
warnings (works but emits noise) are 🟡 MEDIUM.

## Branch and Boundary Condition Analysis

For every conditional in changed code, systematically check for unhandled states:

1. **Equality traps** — if code checks `x === false`, ask: what happens when `x` is `undefined`, `null`, `0`, or missing entirely? A strict equality check that should be a truthiness check (or vice versa) is 🔴 HIGH when it creates a silent no-op on a reachable path.

2. **Optional chaining gaps** — if code uses `obj?.prop` to read, does the write path also handle `obj` being undefined? Trace the full read/write lifecycle of optional-chained values. A read that gracefully handles missing data paired with a write that crashes on the same missing data is 🔴 HIGH.

3. **Enum/union exhaustiveness** — if a conditional handles specific cases (if/else if, switch), list every possible value the input can take. If a reachable value falls through without handling, that's 🔴 HIGH for values that cause wrong behavior or 🟡 MEDIUM for values that cause a silent no-op.

4. **Initialization assumptions** — if code reads a key from a config object, file, or environment variable, ask: does this key always exist by the time this code runs? Check the creation path. Missing keys that cause silent skips on first-run or fresh-install paths are 🔴 HIGH.

5. **Platform and environment assumptions** — if code calls a CLI tool directly (e.g., `gh`, `az`, `npm`) instead of going through the platform abstraction (`platform.js`), ask: does this assume a specific platform? Could the user be on a different platform (Azure DevOps instead of GitHub, pnpm instead of npm)? Direct CLI calls that bypass the abstraction layer are 🔴 HIGH when an abstraction exists for that operation. Commands that run before config exists must pass explicit context (e.g., `--platform` flags) rather than relying on defaults.

**How to apply:** For each function or code block in the diff that contains conditionals, list the branches and their triggering conditions. Then list the values the input can actually take (from callers, config files, or external state). Any value in the second list not covered by the first is a candidate finding.

## Intra-File Contract Verification

Code comments, JSDoc, and doc blocks are promises. Check that the code keeps them:

1. **Behavioral claims** — if a comment says "runs silently", "never throws", "always returns X", "idempotent", or similar, verify the code fulfills that claim. A `console.log` in a "silent" function, a throw in a "never throws" function, or a side effect in an "idempotent" function is 🟡 MEDIUM (or 🔴 HIGH if the claim is part of an API contract that callers depend on).

2. **Parameter/return doc mismatches** — if JSDoc documents `@param {string} name` but the code accepts and handles `null`, or if `@returns {boolean}` but a path returns `undefined`, that's 🟡 MEDIUM.

3. **TODO/FIXME freshness** — if the change adds a TODO, fine. If the change modifies code near an existing TODO that the change could have resolved, flag it as 🔵 LOW.

**Key distinction from Cross-File Contract Verification:** Cross-file traces contracts *between* files (SKILL.md ↔ prompt template, code ↔ docs). Intra-file traces contracts *within* a single file (comment ↔ code, JSDoc ↔ behavior). Both are required.

## Fix Quality Requirements

Every 🔴 HIGH finding MUST include:
- The **specific replacement text** (not just "fix this" — show exactly what the code should say)
- The **rationale** (why this specific fix, not another approach)
- A **verification instruction** (how to confirm the fix is correct — e.g., "check that this placeholder matches item N in the substitution checklist")

Without all three, the implementer may apply a cargo-cult fix that changes syntax without fixing the underlying issue. 🟡 MEDIUM findings should include replacement text when the fix is non-obvious.

## Key Principles

- **Real problems only** — if you wouldn't block a PR for it, it's 🔵 LOW at most
- **Full context** — read the whole file, not just the diff
- **Non-negotiable respect** — never flag intentional patterns
- **Actionable fixes** — every 🔴 HIGH finding includes a specific fix description with rationale
- **Cross-file verification** — trace contracts across files, not just within each file
- **Enumerate, don't scan** — if something should be complete, count it
- **Simplify handoff** — collect simplicity/SOLID findings for /pipeline:simplify
