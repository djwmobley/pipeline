---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Agent(*)
description: Purple team verification — verify aggregate security posture after remediation, codify defensive rules
---

## Pipeline Purple Team

Aggregate security verification. Runs after a red team + remediation cycle to confirm that identified attack vectors are actually closed, exploit chains are broken, and verified fixes are codified into defensive rules for future development.

**Read-only verification.** No source code is modified. Results saved to `docs/findings/`.

---

### Step 0 — Load config + locate skill

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.name`, `project.repo`, `project.profile`
- `purpleteam.*` (defensive_rules, chain_verification, posture_report)
- `commands.security_audit`
- `models.review`, `models.architecture`
- `routing.source_dirs`
- `knowledge.tier`
- `integrations.github.enabled`, `integrations.postgres.enabled`

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

**source_dirs shell safety:** Validate each `routing.source_dirs` entry matches `[a-zA-Z0-9/_.-]+` only. If any entry contains shell metacharacters, reject it and stop.

Locate and read the purple team skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/purpleteam/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/purpleteam/SKILL.md` to find it

---

### Step 1 — Collect context

Locate the most recent red team report:
```bash
ls -t docs/findings/redteam-*.md 2>/dev/null | head -1
```

Locate the most recent remediation summary:
```bash
ls -t docs/findings/remediation-*.md 2>/dev/null | head -1
```

If either is missing: "Purple team requires both a red team report and a remediation summary. Run `/pipeline:redteam` then `/pipeline:remediate --source redteam` first." Stop.

Read both files in full. Parse the remediation summary to build:
- `FIXED_FINDINGS[]` — findings with status "fixed" or "verified" (each with: ID, severity, ticket number, commit SHA)
- `SKIPPED_FINDINGS[]` — findings with status "remaining", "wontfix", or "intentional"
- Extract exploit chains from the red team report's "Exploit Chains" section (this section may not exist — handle gracefully; if absent set `EXPLOIT_CHAINS = []`)

**Finding ID mapping:** The red team uses IDs like `INJ-001`. The remediation command prefixes them as `RT-INJ-001`. Handle both formats when cross-referencing between the two reports.

**Query knowledge tier for existing security context:**

If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:

```bash
node scripts/pipeline-db.js query "SELECT topic, decision, reason FROM decisions WHERE topic ILIKE '%security%' OR topic ILIKE '%auth%' OR topic ILIKE '%encrypt%' OR topic ILIKE '%token%' OR topic ILIKE '%session%' ORDER BY created_at DESC LIMIT 20"
```

```bash
node scripts/pipeline-db.js query "SELECT issue, rule FROM gotchas WHERE issue ILIKE '%security%' OR issue ILIKE '%auth%' OR issue ILIKE '%vuln%' OR issue ILIKE '%inject%' OR issue ILIKE '%xss%' ORDER BY created_at DESC LIMIT 20"
```

If `knowledge.tier` is `"files"`:
- Check `docs/gotchas.md` for security-related entries
- Check `DECISIONS.md` for security-related entries (grep for "security", "auth", "token", "session")

Store results as `KNOWLEDGE_CONTEXT`.

If `platform.issue_tracker` is not `none`, fetch issue state:
```bash
node '[SCRIPTS_DIR]/platform.js' issue list --labels 'redteam' --state all --limit 100
```
If the command fails, notify the user with the error and ask for guidance.

**Present the assessment plan:**

```
## Purple Team Verification

**What this does:** Verifies that remediation actually closed the attack vectors
identified by the red team. Checks exploit chains are broken. Codifies verified
fixes into defensive rules for future development.

**Red team report:** [filename] ([date from report])
**Remediation summary:** [filename] ([date from report])
**Findings to verify:** [N] fixed findings
**Exploit chains to check:** [M] chains (or "None identified")
**Skipped/wontfix:** [P] findings (tracked as accepted risk)

**Token estimate:** ~[calculated]K tokens

Proceed? (Y/n)
```

If user declines, stop.

---

### Step 2 — Per-finding verification (parallel sonnet agents)

Locate and read `skills/purpleteam/verifier-prompt.md`:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/purpleteam/verifier-prompt.md`
2. Otherwise: use Glob `**/pipeline/skills/purpleteam/verifier-prompt.md`

For each finding in `FIXED_FINDINGS[]`, prepare a fully substituted prompt copy. Substitution checklist (per finding):

1. `{{MODEL}}` → value of `models.review` from config
2. `[FINDING_ID]` → finding ID (normalize to non-prefixed form, e.g., `INJ-001`)
3. `[FINDING_DESCRIPTION]` → description from the red team report for this finding
4. `[EXPLOITATION_SCENARIO]` → exploitation scenario from the red team report for this finding
5. `[CWE_ID]` → CWE reference from the red team report for this finding
6. `[FIX_COMMIT_SHA]` → commit SHA from the remediation summary for this finding
7. `[FIX_LOCATION]` → file/location from the remediation summary for this finding
8. `[SOURCE_DIRS]` → `routing.source_dirs` from config
9. `[DOMAIN_ID]` → domain prefix extracted from the finding ID (e.g., `INJ`, `AUTH`, `XSS`)

Dispatch **all verifier agents in parallel** using the Agent tool. Each agent gets `description: "Purple Team Verifier [FINDING_ID]"`.

Each verifier agent returns a structured result in this format:
```
VERDICT | FINDING | EVIDENCE | REGRESSION_DETAIL | DEFENSIVE_PATTERN | CONFIDENCE
```

Where VERDICT is one of: `VERIFIED`, `INCOMPLETE`, or `REGRESSION`.

Collect all results as `VERIFICATION_RESULTS`.

If any agent failed or returned empty output, note it but continue with available results.

---

### Step 2b — Dependency audit

If `commands.security_audit` is not null:

```bash
[commands.security_audit]
```

Parse the JSON output. Extract CRITICAL and HIGH severity advisories.

Cross-reference with DEPS domain findings from the red team report:
- Already flagged by red team and now fixed → note as "previously addressed"
- Already flagged by red team but not fixed → note as "known, unresolved"
- Not flagged by red team → flag as `NEW_ADVISORY` (published since red team ran, or missed)

Store results as `DEPENDENCY_AUDIT_RESULTS`.

If `commands.security_audit` is null: set `DEPENDENCY_AUDIT_RESULTS = "Skipped — no security_audit command configured"`.

---

### Step 3 — Exploit chain verification (single opus agent)

Skip this step if `purpleteam.chain_verification` is false in config.

Skip this step if `EXPLOIT_CHAINS` is empty. Log: "No exploit chains identified in red team report. Skipping chain verification." Set `CHAIN_RESULTS = "Chain verification skipped — no exploit chains in red team report"`.

Otherwise, locate and read `skills/purpleteam/chain-analyst-prompt.md`:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/purpleteam/chain-analyst-prompt.md`
2. Otherwise: use Glob `**/pipeline/skills/purpleteam/chain-analyst-prompt.md`

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.architecture` from config
2. `[EXPLOIT_CHAINS]` → raw exploit chain text from the red team report's "Exploit Chains" section
3. `[VERIFICATION_RESULTS]` → formatted summary of all results from Step 2
4. `[PROJECT_NAME]` → `project.name` from config

Dispatch single opus agent with `description: "Purple Team Chain Analyst"`. Collect output as `CHAIN_RESULTS`.

`CHAIN_RESULTS` should include a verdict per chain (`CHAIN_BROKEN`, `CHAIN_WEAKENED`, or `CHAIN_INTACT`) and the evidence for each determination.

---

### Step 4 — Posture assessment (single opus agent)

Skip this step if `purpleteam.posture_report` is false in config.

Locate and read `skills/purpleteam/posture-analyst-prompt.md`:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/purpleteam/posture-analyst-prompt.md`
2. Otherwise: use Glob `**/pipeline/skills/purpleteam/posture-analyst-prompt.md`

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.architecture` from config
2. `[VERIFICATION_RESULTS]` → formatted summary of all results from Step 2
3. `[CHAIN_RESULTS]` → output from Step 3 (or "Chain verification skipped" if skipped)
4. `[DEPENDENCY_AUDIT_RESULTS]` → output from Step 2b
5. `[ALL_FINDINGS]` → all findings (both fixed and skipped) from the red team report
6. `[SKIPPED_FINDINGS]` → findings from `SKIPPED_FINDINGS[]` with their stated reason
7. `[PROJECT_NAME]` → `project.name` from config
8. `[KNOWLEDGE_CONTEXT]` → existing gotchas/decisions from the knowledge tier (or "None" if empty)

Dispatch single opus agent with `description: "Purple Team Posture Analyst"`. Collect:
- `POSTURE_REPORT` — narrative assessment
- `DEFENSIVE_RULES[]` — extracted defensive patterns, each with: category, pattern name, description, source finding ID
- `POSTURE_RATING` — one of: `HARDENED`, `IMPROVED`, `PARTIAL`, `UNCHANGED`

---

### Step 5 — Persist results

Create the output directory if needed:
```bash
mkdir -p docs/findings
```

**Issue tracker (if `integrations.github.enabled`):**

For each VERIFIED finding that has an issue number:
```bash
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
## Purple Team Verification: VERIFIED

Attack vector confirmed closed.

**Evidence:** [evidence summary from verifier result]
**Confidence:** [confidence level from verifier result]
**Defensive rule:** [defensive pattern extracted for this finding]
EOF
```
If the command fails, notify the user with the error and ask for guidance.

Close the issue if not already closed:
```bash
node '[SCRIPTS_DIR]/platform.js' issue close [N] 2>/dev/null
```
If the command fails, notify the user with the error and ask for guidance.

For each REGRESSION finding that has an issue number:
```bash
node '[SCRIPTS_DIR]/platform.js' issue reopen [N] 2>/dev/null
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
## Purple Team Verification: REGRESSION

Fix introduced a regression.

**Details:** [regression description from verifier result]
**Original attack vector:** [whether original vector is open or closed]
**New issue:** [description of the regression]

Requires additional remediation.
EOF
```
If the command fails, notify the user with the error and ask for guidance.

For each INCOMPLETE finding that has an issue number:
```bash
node '[SCRIPTS_DIR]/platform.js' issue reopen [N] 2>/dev/null
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
## Purple Team Verification: INCOMPLETE

Code was changed but the exploitation scenario was not fully closed.

**Evidence:** [evidence from verifier result]
**Remaining attack surface:** [description of what remains exploitable]

Requires additional remediation.
EOF
```
If the command fails, notify the user with the error and ask for guidance.

**Shell safety:** All comment bodies use heredocs with single-quoted delimiters (`<<'EOF'`) to prevent injection from report-derived content.

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

For each VERIFIED finding:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update finding [ID] status verified
```

For each REGRESSION or INCOMPLETE finding (fix did not hold — set back to in_progress):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update finding [ID] status in_progress
```

For each defensive rule (if `purpleteam.defensive_rules` is true):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update gotcha new "$(cat <<'TITLE'
[rule title]
TITLE
)" "$(cat <<'DESC'
[rule description]
DESC
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'purple-team-verification' "$(cat <<'SUMMARY'
[date]: [V] verified, [R] regression, [I] incomplete. Posture: [POSTURE_RATING]
SUMMARY
)" "$(cat <<'DETAIL'
[posture summary — 1-2 sentences]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:**

For each CRITICAL or HIGH defensive rule only (if `purpleteam.defensive_rules` is true):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js gotcha "$(cat <<'TITLE'
[Rule category] — [Pattern name]
TITLE
)" "$(cat <<'RULE'
[Description]. Source: Purple team [date], finding [ID]
RULE
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js decision 'purple-team-verification' "$(cat <<'SUMMARY'
[date]: [V] verified, [R] regression, [I] incomplete. Posture: [POSTURE_RATING]
SUMMARY
)" "$(cat <<'DETAIL'
[posture summary — 1-2 sentences]
DETAIL
)"
```

Prune stale decisions:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js prune
```

**Write the verification report** to `docs/findings/purpleteam-YYYY-MM-DD.md`:

```markdown
# Purple Team Verification — [project.name]

**Date:** [date]
**Red team report:** [filename]
**Remediation summary:** [filename]
**Posture rating:** [HARDENED/IMPROVED/PARTIAL/UNCHANGED]

## Executive Summary
[2-3 sentences: scope, posture rating, key outcomes]

## Before/After
| Metric | Before (Red Team) | After (Verification) |
|--------|-------------------|---------------------|
| Critical findings | [N] | [M] remaining |
| High findings | [N] | [M] remaining |
| Exploit chains | [N] total | [B] broken, [W] weakened, [I] intact |

## Verification Results
| Finding | Severity | Verdict | Confidence | Evidence |
|---------|----------|---------|------------|---------|
| [ID] | [SEV] | [VERDICT] | [CONF] | [1-line evidence summary] |

## Exploit Chain Analysis
[chain verdicts with reasoning and alternative attack paths if any remain]

## Dependency Audit
[audit results, new advisories, previously addressed items]

## Defensive Rules Codified
| Category | Pattern | Description |
|----------|---------|-------------|
| [cat] | [name] | [desc] |

## Accepted Risk
[skipped/wontfix findings with severity and stated reason]

## Residual Risk
[ordered list of remaining risks, from most to least severe]

## Recommendations
[prioritized next steps]

## Metadata
- Findings verified: [N]
- Verified: [V] | Incomplete: [I] | Regression: [R]
- Chains checked: [N] | Broken: [B] | Weakened: [W] | Intact: [I]
- Defensive rules extracted: [N]
- Dependency advisories: [N] new
```

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### Final Report

```
## Purple Team Verification Complete

**Posture:** [HARDENED/IMPROVED/PARTIAL/UNCHANGED]
**Findings:** [V] verified, [I] incomplete, [R] regression (of [N] total)
**Chains:** [B] broken, [W] weakened, [I] intact (of [M] total)
**Defensive rules:** [N] codified
**Dependency audit:** [N] new advisories (or "skipped")

### Verified
[list with finding IDs and one-line evidence summaries]

### Needs Attention
[regressions and incompletes with IDs, verdicts, and details]

### Accepted Risk
[skipped/wontfix findings with severity and stated reason]

What next?
a) Push (clean verification or accepted risk only)
b) Run another remediation cycle (/pipeline:remediate --source redteam)
c) Leave as-is

(default: a if all VERIFIED, b if any REGRESSION or INCOMPLETE exist)
```

---

### Orchestrator

Record step completion based on the posture rating:

- HARDENED or IMPROVED → `PASS`
- PARTIAL with accepted risk → `PASS`
- UNCHANGED or regressions remain → `FAIL` (loopback: 2+ fails routes to architect)

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete purple [PASS|FAIL]
```

**If purple was skipped** (redteam was skipped or project doesn't require verification), still record a PASS:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete purple PASS 'skipped'
```
