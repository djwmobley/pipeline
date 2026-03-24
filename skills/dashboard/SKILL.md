---
name: dashboard-generation
description: Generate static HTML project dashboard — reads state from config, DB/files, and git, substitutes into template, writes docs/dashboard.html
---

# Dashboard Generation

## Overview

Generates a self-contained HTML dashboard from current project state. Called by `/pipeline:dashboard` directly, and as a final step by state-changing commands. Zero outbound calls from the generated HTML — all data embedded at generation time.

## Process Flow

```dot
digraph dashboard {
  rankdir=LR;
  node [shape=box, style=rounded];

  config [label="Read\npipeline.yml"];
  phase [label="Derive\nPhase"];
  state [label="Collect\nState"];
  git [label="Collect\nGit State"];
  github [label="GitHub Issues\n(if enabled)"];
  haiku [label="Haiku\nRecommendations"];
  substitute [label="Substitute\nTemplate"];
  write [label="Atomic\nWrite"];

  config -> phase -> state -> git -> github -> haiku -> substitute -> write;
}
```

## Step 1 — Read Config

Read `.claude/pipeline.yml`. Extract:

- `project.name`, `project.repo`, `project.branch`
- `dashboard.enabled`, `dashboard.milestone`
- `knowledge.tier`
- `integrations.github.enabled`
- `integrations.postgres.enabled`
- `docs.specs_dir`, `docs.plans_dir`
- `models.cheap` (for haiku recommendations)

## Step 2 — Derive Phase

Check artifacts in order (first match wins):

| Check | Phase | Artifact Subtitle |
|---|---|---|
| Git tag exists after most recent plan file date | Released | Tag name |
| Findings files exist AND all remediated (remediation file covers all finding files) | Ready for Release | Latest remediation file |
| Findings files exist with unremediated items | Reviewing | Latest findings file |
| Commits exist after plan creation date | Building | Plan file name |
| Plan file exists in `docs.plans_dir` | Planned | Plan file name |
| Spec file exists in `docs.specs_dir` | Designed | Spec file name |
| None | Not Started | — |

**Phase check commands:**

```bash
# Check for specs
ls -t [docs.specs_dir]*.md 2>/dev/null | head -1

# Check for plans
ls -t [docs.plans_dir]*.md 2>/dev/null | head -1

# Check for findings (excluding remediation files)
ls docs/findings/*.md 2>/dev/null | grep -v 'remediation-' | grep -v 'triage-' | head -1

# Check for remediation
ls -t docs/findings/remediation-*.md 2>/dev/null | head -1

# Check for tags after plan date
git tag --sort=-creatordate | head -1
```

**Files-tier finding status:** Cross-reference `docs/findings/[source]-*.md` against `docs/findings/remediation-*.md`. If a remediation file exists and shows all findings as fixed/verified, those findings are closed.

## Step 3 — Collect State Data

**If Postgres tier:**

```bash
node scripts/pipeline-db.js query "SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status"
node scripts/pipeline-db.js query "SELECT severity, COUNT(*) as cnt FROM findings WHERE status NOT IN ('fixed','verified','wontfix') GROUP BY severity"
node scripts/pipeline-db.js query "SELECT * FROM tasks WHERE status = 'in_progress' ORDER BY updated_at DESC LIMIT 5"
node scripts/pipeline-db.js query "SELECT * FROM tasks WHERE status = 'pending' ORDER BY id LIMIT 2"
node scripts/pipeline-db.js query "SELECT topic, decision, created_at FROM decisions ORDER BY created_at DESC LIMIT 5"
```

**If files tier:**

- Parse plan markdown for task count (count numbered list items or headings)
- Count finding files: `ls docs/findings/*.md 2>/dev/null | grep -v remediation | grep -v triage | wc -l`
- Parse finding file headers for severity counts
- Read DECISIONS.md for recent decisions

## Step 4 — Collect Git State

```bash
git log --oneline -10
git branch --show-current
git rev-parse --short HEAD
git log --oneline origin/[branch]..HEAD 2>/dev/null | wc -l  # unpushed commits
```

## Step 5 — GitHub Issues (if enabled)

```bash
gh issue list --repo '[project.repo]' --state open --limit 10 --json number,title,labels,url
```

## Step 5b — Security Lifecycle

Check for security assessment files:

```bash
ls docs/findings/redteam-*.md 2>/dev/null | sort -r | head -1
ls docs/findings/remediation-*.md 2>/dev/null | sort -r | head -1
ls docs/findings/purpleteam-*.md 2>/dev/null | sort -r | head -1
```

**If none of these files exist**, set `{{SECURITY_LIFECYCLE}}` to:

```html
<p class="section-empty">No security assessments yet. Run <code>/pipeline:redteam</code> to start.</p>
```

**If findings exist**, read the most recent file of each type and build per-finding state:

1. **Parse red team report** (`docs/findings/redteam-*.md`) — extract finding IDs (e.g., `VULN-001`) and severities (Critical / High / Medium / Low). Each finding starts with a heading like `## VULN-001 — [Title]` and a `**Severity:**` field.

2. **Parse remediation summary** (`docs/findings/remediation-*.md`) — extract which finding IDs are fixed and any associated commit SHAs. Look for lines matching `VULN-\d+` paired with fix status (fixed / skipped / accepted / incomplete).

3. **Parse purple team report** (`docs/findings/purpleteam-*.md`) — extract per-finding verification verdicts (verified / regression / incomplete / skipped). Look for lines matching `VULN-\d+` paired with a verdict keyword.

4. **Derive per-finding overall status** using this priority order:
   - `regression` — purple team found the fix did not hold
   - `verified` — purple team confirmed fix is effective
   - `fixed` — remediation recorded, no purple team yet
   - `incomplete` — remediation attempted but not complete
   - `skipped` — accepted risk / won't fix
   - `found` — red team only, no remediation yet

5. **Compute aggregate counts** across all finding IDs:
   - N = total findings
   - V = count with status `verified`
   - F = count with status `fixed`
   - R = count with status `regression`
   - I = count with status `incomplete`
   - S = count with status `skipped`

6. **Determine phase completion flags**:
   - Red Team done: red team report exists
   - Remediate done: remediation report exists and covers at least one finding
   - Purple Team done: purple team report exists

7. **Generate HTML** for `{{SECURITY_LIFECYCLE}}`:

```html
<div class="security-summary">
  [N] findings: [V] verified, [F] fixed (unverified), [R] regressions, [I] incomplete, [S] skipped/accepted
</div>
<div class="security-phase-flow">
  <span class="security-phase-label security-phase-done">Red Team ✓</span>
  <span class="security-phase-arrow"></span>
  <span class="security-phase-label [security-phase-done OR security-phase-pending]">Remediate [✓ or ""]</span>
  <span class="security-phase-arrow"></span>
  <span class="security-phase-label [security-phase-done OR security-phase-pending]">Purple Team [✓ or ""]</span>
</div>
<table class="security-table">
  <thead>
    <tr>
      <th>Finding</th>
      <th>Severity</th>
      <th>Red Team</th>
      <th>Remediate</th>
      <th>Purple Team</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <!-- One row per finding ID -->
    <tr>
      <td>[ID — Title or ID alone if title unavailable]</td>
      <td><span class="badge badge-[critical|high|medium|low]">[Severity]</span></td>
      <td>[✓ or —]</td>
      <td>[commit SHA as <code> if available, ✓ if fixed without SHA, — if not yet]</td>
      <td>[verdict pill or — if pending]</td>
      <td><span class="status-pill status-[found|fixed|verified|regression|incomplete|skipped]">[Status]</span></td>
    </tr>
  </tbody>
</table>
```

Use the `.badge-critical` / `.badge-high` / `.badge-medium` / `.badge-low` classes for severity (matching existing badge styles). Use `.status-pill.status-[status]` for the final status column. Render commit SHAs inside `<code>` tags, truncated to 7 characters.

## Step 6 — Generate Health Summary

Rule-based one-liner. Format: `[Phase] — [task progress if available], [finding summary]`

Examples by state:

- "Building — 8/10 tasks complete, 0 critical findings"
- "Reviewing — 5 findings to fix (1 critical)"
- "Ready for Release — all findings resolved"
- "Planned — ready to start building"

On files tier (no task counts): `[Phase] — [finding count] open findings ([critical count] critical)`

## Step 7 — Generate Rule-Based Recommendations

| Phase | Recommendation |
|---|---|
| Not Started | `/pipeline:brainstorm` to begin |
| Designed | `/pipeline:plan` to create implementation plan |
| Planned | `/pipeline:build` to start implementation |
| Building | Continue building. If stuck: `/pipeline:debug` |
| Reviewing | `/pipeline:remediate` to fix findings |
| Ready for Release | `/pipeline:release` to tag and ship |
| Released | Set new milestone to begin next cycle |

Additional signals:

- Open CRITICAL findings: "Fix critical findings before proceeding"
- No tests configured: "Configure `commands.test` in pipeline.yml"
- Unpushed commits: "Push with `/pipeline:commit push`"

## Step 8 — AI Recommendations (haiku)

Read the prompt template from `skills/dashboard/recommendations-prompt.md`.

Substitute values into the template. Dispatch haiku subagent.

If the call fails or returns empty, skip — rule-based recommendations are sufficient.

## Step 9 — Build Substitution Map

Build a map of `{{PLACEHOLDER}}` to HTML content for every token in the template. Key tokens:

- `{{PROJECT_NAME}}`, `{{MILESTONE}}`, `{{BRANCH}}`, `{{REPO_URL}}`, `{{LAST_UPDATED}}`
- `{{SPEC_LINK}}`, `{{PLAN_LINK}}`, `{{FINDINGS_LINK}}`, `{{REPO_LINK}}`
- `{{HEALTH_SUMMARY}}`
- `{{PHASE_INDICATORS}}` — generate HTML spans with appropriate classes
- `{{ACTIVITY_FEED}}` — generate HTML list items
- `{{TASK_PROGRESS}}`, `{{OPEN_FINDINGS}}`, `{{GITHUB_ISSUES}}`, `{{BLOCKERS}}`
- `{{SECURITY_LIFECYCLE}}`
- `{{RULE_RECOMMENDATIONS}}`, `{{AI_RECOMMENDATIONS}}`

## Step 10 — Read Template and Substitute

Read the template from the plugin directory:

1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/templates/dashboard.html`
2. Otherwise: use Glob `**/pipeline/templates/dashboard.html`

Replace each `{{PLACEHOLDER}}` token with its HTML value.

## Step 11 — Atomic Write

Write to a temp file first, then rename:

```bash
# Write to temp file
cat > docs/dashboard.tmp.html << 'DASHBOARD_EOF'
[substituted HTML content]
DASHBOARD_EOF

# Atomic rename
mv docs/dashboard.tmp.html docs/dashboard.html
```

This prevents auto-refresh from reading a partially written file.

## Red Flags

| Rationalization | Reality |
|---|---|
| "The dashboard is optional, skip it" | If dashboard.enabled is true, regeneration is required |
| "I'll just write directly to dashboard.html" | Always use atomic write (temp + rename) |
| "I'll embed the full report content" | Dashboard shows summaries and counts, never full report text |
| "The haiku call is critical" | It's nice-to-have. Rule-based recommendations always work |
