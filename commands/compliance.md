---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: Compliance framework mapping — map red team findings to regulatory controls and analyze coverage scope
---

## Pipeline Compliance

Maps red team findings (with CWE IDs) to regulatory compliance controls and produces a coverage scope analysis. This is compliance preparation — not a compliance assessment. The output helps teams understand which controls their security testing addresses and which require organizational or procedural assessment.

**Read-only analysis.** No source code is modified. Reports saved to `docs/findings/`.

---

### Step 0 — Load config + knowledge context

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.name`, `project.profile`, `project.repo`
- `compliance.*` (enabled, frameworks, html_report, include_remediation)
- `models.cheap`, `models.architecture`
- `knowledge.tier`
- `integrations.github.enabled`, `integrations.github.issue_tracking`
- `integrations.postgres.enabled`

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

If `compliance.enabled` is false or not present: "Compliance mapping is not enabled. Add `compliance.enabled: true` to `.claude/pipeline.yml`." Stop.

**Query knowledge tier for compliance context:**

If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:

```bash
node scripts/pipeline-db.js query "SELECT topic, decision, reason FROM decisions WHERE topic ILIKE '%compliance%' OR topic ILIKE '%audit%' OR topic ILIKE '%regulatory%' OR topic ILIKE '%framework%' ORDER BY created_at DESC LIMIT 10"
```

If `knowledge.tier` is `"files"`:
- Check `DECISIONS.md` for compliance-related entries (grep for "compliance", "audit", "regulatory")

Store results as `KNOWLEDGE_CONTEXT`.

---

### Step 1 — Sell the assessment

Count the enabled frameworks by tier:

| Tier | Frameworks | Description |
|------|-----------|-------------|
| 1 | nist_800_53, pci_dss | Official CWE crosswalks |
| 2 | iso27001, nist_csf | Inference-based mapping |
| 3 | soc2, gdpr, hipaa | Limited software-relevant scope |

Calculate token estimate:
- ~15K per framework agent
- ~25K for synthesis agent (opus)
- ~7K for HTML report (if enabled)
- Total: ~(15K × [framework_count]) + 25K [+ 7K]

Present:

```
## Compliance Framework Mapping

> **This is compliance preparation, not a compliance assessment.**
> Mappings help teams understand which controls their security testing addresses.
> They are not audit evidence or compliance assertions.

**What this does:** Maps your red team findings (CWE IDs) to regulatory controls
across [FRAMEWORK_COUNT] frameworks, identifies coverage scope, and generates
an evidence narrative for audit preparation.

**Frameworks:**
- Tier 1 (official crosswalks): [list enabled Tier 1]
- Tier 2 (inference-based): [list enabled Tier 2]
- Tier 3 (limited scope): [list enabled Tier 3]

**Token estimate:** ~[N]K tokens ([M] framework agents + synthesis[+ HTML])
**Project:** [project.name]
[If knowledge context found: "**Prior context:** [N] compliance decisions loaded"]

Proceed? (Y/n)
```

If user declines, stop.

---

### Step 2 — Locate red team report

Search for the latest red team report:

```bash
ls -t docs/findings/redteam-*.md 2>/dev/null | head -1
```

If no report found: "No red team report found in `docs/findings/`. Run `/pipeline:redteam` first." Stop.

Store the path as `REDTEAM_REPORT_FILE`.

**Optionally locate remediation and purple team reports** (if `compliance.include_remediation` is true):

```bash
ls -t docs/findings/remediation-*.md 2>/dev/null | head -1
ls -t docs/findings/purpleteam-*.md 2>/dev/null | head -1
```

Store paths as `REMEDIATION_FILE` and `PURPLETEAM_FILE` (or "not available" if absent).

---

### Step 3 — Parse findings

Read the red team report. Extract all `FINDING` lines with:
- Finding ID (e.g., `INJ-001`)
- Severity (CRITICAL/HIGH/MEDIUM/LOW/INFO)
- Confidence (HIGH/MEDIUM/LOW)
- Location (file:line or URL:path)
- CWE ID (e.g., CWE-89)

Build `FINDINGS` — a structured list of all findings with their CWE IDs.

Count:
- `FINDING_COUNT` — total findings
- `UNIQUE_CWE_COUNT` — unique CWE IDs

If remediation/purple team reports are available, extract per-finding status:
- Build `REMEDIATION_STATUS` — per finding: fixed/open/not-remediated/verified/incomplete/regression

Present:

```
## Findings Parsed

**Red team report:** [REDTEAM_REPORT_FILE]
**Findings:** [FINDING_COUNT] total
**Unique CWEs:** [UNIQUE_CWE_COUNT]
[If remediation available: "**Remediation status:** available ([N] fixed, [M] open)"]
[If purple team available: "**Verification status:** available ([N] verified, [M] incomplete)"]

Launching [FRAMEWORK_COUNT] framework agents...
```

---

### Step 4 — Load skill + dispatch framework agents (parallel, haiku)

Locate and read the compliance skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/compliance/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/compliance/SKILL.md` to find it

Read the control mappings from `skills/compliance/control-mappings.md` (same directory as the skill).

Read the framework agent prompt template from `skills/compliance/framework-agent-prompt.md`.

For each enabled framework in `compliance.frameworks[]`, dispatch a subagent:

**Framework metadata lookup:**

| Framework ID | Framework Name | Tier |
|-------------|---------------|------|
| nist_800_53 | NIST SP 800-53 Rev 5 | 1 |
| pci_dss | PCI DSS 4.0 | 1 |
| iso27001 | ISO/IEC 27001:2022 Annex A | 2 |
| nist_csf | NIST Cybersecurity Framework 2.0 | 2 |
| soc2 | SOC 2 Trust Services Criteria | 3 |
| gdpr | EU General Data Protection Regulation | 3 |
| hipaa | HIPAA Security Rule | 3 |

**Substitution checklist (per framework):**
1. `{{MODEL}}` → value of `models.cheap` from config
2. `[FRAMEWORK_ID]` → framework ID from table above
3. `[FRAMEWORK_NAME]` → framework full name from table above
4. `[FRAMEWORK_TIER]` → tier from table above
5. `[CONTROL_MAPPINGS]` → the relevant framework section from control-mappings.md
6. `[FINDINGS]` → parsed findings with CWE IDs (from Step 3), wrapped in DATA tags
7. `[REMEDIATION_STATUS]` → per-finding status (if available, otherwise "not available")
8. `[PROJECT_PROFILE]` → `project.profile` from config

Launch **all framework agents in parallel** using the Agent tool. Each agent gets `description: "Compliance Mapping: [FRAMEWORK_NAME]"`.

---

### Step 5 — Collect reports + dispatch synthesis (opus)

Wait for all framework agents to complete. Collect all outputs into `FRAMEWORK_REPORTS`.

If any framework agent failed or returned empty, note it but continue with available reports.

Read the synthesis prompt template from `skills/compliance/synthesis-prompt.md`.

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.architecture` from config
2. `[FRAMEWORK_REPORTS]` → collected output from all framework agents, wrapped in DATA tags
3. `[PROJECT_NAME]` → `project.name` from config
4. `[DATE]` → today's date (YYYY-MM-DD)
5. `[FRAMEWORK_COUNT]` → number of frameworks assessed
6. `[FINDING_COUNT]` → total red team findings analyzed
7. `[UNIQUE_CWE_COUNT]` → unique CWE IDs found

Dispatch the synthesis agent. Store its output as `SYNTHESIS_REPORT`.

---

### Step 6 — Save markdown report

```bash
mkdir -p docs/findings
```

Save the synthesis agent's output to `docs/findings/compliance-[YYYY-MM-DD].md`.

Store the path as `COMPLIANCE_REPORT_FILE`.

Present the executive summary and coverage scope analysis to the user inline. Full report is in the file.

```
## Compliance Mapping Complete

> **This is compliance preparation, not a compliance assessment.**

**Report:** [COMPLIANCE_REPORT_FILE]
**Frameworks assessed:** [FRAMEWORK_COUNT] ([Tier 1 count] Tier 1, [Tier 2 count] Tier 2, [Tier 3 count] Tier 3)
**Red team findings mapped:** [FINDING_COUNT]
**Unique CWEs:** [UNIQUE_CWE_COUNT]

[Executive summary — one line per framework with MAPPED/RELATED/OUTSIDE_SCOPE counts]
```

---

### Step 7 — HTML report artifact

If `compliance.html_report` is true (default):

Read the HTML report prompt template from `skills/compliance/html-report-prompt.md`.

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.cheap` from config
2. `[MARKDOWN_REPORT]` → the complete markdown report from Step 6, wrapped in DATA tags
3. `[PROJECT_NAME]` → `project.name` from config
4. `[DATE]` → today's date
5. `[FRAMEWORK_COUNT]` → number of frameworks assessed

Dispatch haiku agent to generate a self-contained HTML file. Save to `docs/findings/compliance-[YYYY-MM-DD].html`.

Report: "HTML report saved to `docs/findings/compliance-[date].html` — open in any browser to share with stakeholders."

---

### Step 8 — Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

Store the resolved absolute path. Use `PROJECT_ROOT=$(pwd) node [scripts_dir]/...` for all commands below.

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Record the session:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update session [next_session_number] 0 "$(cat <<'EOF'
Compliance mapping: [FRAMEWORK_COUNT] frameworks, [FINDING_COUNT] findings mapped to [UNIQUE_CWE_COUNT] CWEs
EOF
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'compliance-mapping' "$(cat <<'SUMMARY'
Compliance mapping [date]: [FRAMEWORK_COUNT] frameworks assessed
SUMMARY
)" "$(cat <<'DETAIL'
[Per-framework summary: MAPPED/RELATED/OUTSIDE_SCOPE counts]
[Key coverage insight: which Tier 1 control families have no mapped findings]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:**

Record session:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js session [next_session_number] 0 "$(cat <<'EOF'
Compliance mapping: [FRAMEWORK_COUNT] frameworks, [FINDING_COUNT] findings mapped to [UNIQUE_CWE_COUNT] CWEs
EOF
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js decision 'compliance-mapping' "$(cat <<'SUMMARY'
Compliance mapping [date]: [FRAMEWORK_COUNT] frameworks assessed
SUMMARY
)" "$(cat <<'DETAIL'
[Per-framework summary: MAPPED/RELATED/OUTSIDE_SCOPE counts]
[Key coverage insight: which Tier 1 control families have no mapped findings]
DETAIL
)"
```

Prune stale decisions:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js prune
```

---

### Step 9 — Issue creation

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

Find the epic number: check the most recent spec or plan file for `github_epic: N`.

For each **Tier 1** control family that is within automated scope but has **no mapped findings** (from the scope analysis), create an issue to expand red team coverage:

```bash
node '[SCRIPTS_DIR]/platform.js' issue search 'compliance coverage gap [CONTROL_FAMILY] in:title' --state open --limit 1
```

If an issue already exists, skip. Otherwise:

```bash
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue create --title 'Compliance coverage gap: [FRAMEWORK_ID] [CONTROL_FAMILY]' --labels 'compliance,coverage-gap' --stdin
## Coverage Gap

**Framework:** [FRAMEWORK_NAME] (Tier [TIER])
**Control family:** [CONTROL_FAMILY]
**Status:** Within automated scope, no mapped findings

This control family can be assessed by code analysis but no red team finding
currently maps to it. Consider expanding red team specialist coverage to address
these controls.

**Controls in scope:**
[list of controls in this family]

**Suggested CWEs to target:**
[CWEs that map to these controls per control-mappings.md]

Linked to: #[EPIC_N]
EOF
```
If the command fails, notify the user with the error and ask for guidance.

Comment the summary on the epic:
```bash
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
## Compliance Mapping Complete

**Frameworks assessed:** [FRAMEWORK_COUNT]
**Findings mapped:** [FINDING_COUNT]
**Report:** `[COMPLIANCE_REPORT_FILE]`

**Per-framework summary:**
[one line per framework: name, tier, MAPPED/RELATED/OUTSIDE_SCOPE counts]
EOF
```
If the command fails, notify the user with the error and ask for guidance.

If no epic found: skip — compliance mapping works without issue tracking.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### What next?

```
## What Next?

a) Open the HTML report in a browser
b) Run `/pipeline:redteam` to expand coverage for unmapped control families
c) Share `[COMPLIANCE_REPORT_FILE]` with your GRC team for review
d) Leave as-is
```
