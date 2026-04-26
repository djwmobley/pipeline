---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: Generate static HTML project dashboard — snapshot of phase, tasks, findings, and recommendations
---

```bash
# Set active skill for routing enforcement
node scripts/lib/active-skill.js write dashboard
```


## Pipeline Dashboard

Generate a self-contained HTML dashboard showing current project state.

**Read-only data collection + one HTML output.** No source code is modified.

Locate and read the dashboard skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.*` — name, repo, branch
- `dashboard.*` — enabled, milestone
- `knowledge.tier` — files or postgres
- `integrations.github.enabled`, `integrations.github.issue_tracking`, `integrations.postgres.enabled`
- `docs.*` — specs_dir, plans_dir
- `models.cheap` — for recommendations agent

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

### Generate dashboard

Follow the dashboard skill exactly. Execute all steps in order:
1. Derive phase from artifact existence
2. Collect state data (Postgres queries or file parsing, depending on knowledge tier)
3. Collect git state
4. Collect issues and feature epic (if enabled)
5. Collect security lifecycle data (if findings exist)
6. Generate health summary (rule-based)
7. Generate rule-based recommendations
8. Generate AI recommendations (haiku call — skip on failure)
9. Build substitution map
10. Read HTML template and substitute all tokens
11. Atomic write to `docs/dashboard.html`

### Output

Report what was generated:
```
Dashboard generated: docs/dashboard.html
Phase: [PHASE]
Health: [HEALTH_SUMMARY]
```
