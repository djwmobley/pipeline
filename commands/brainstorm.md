---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*), mcp__stitch__create_project, mcp__stitch__list_projects, mcp__stitch__get_project, mcp__stitch__list_screens, mcp__stitch__get_screen, mcp__stitch__generate_screen_from_text, mcp__stitch__edit_screens, mcp__stitch__generate_variants, mcp__figma__get_file_nodes, mcp__figma__get_images
description: Design before LARGE changes — explore context, clarify requirements, propose approaches, write spec
---

## Pipeline Brainstorm

Locate and read the brainstorming skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/brainstorming/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/brainstorming/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.specs_dir` — where to save spec documents
- `review.non_negotiable` — intentional decisions to respect
- `security` — security checklist to evaluate against
- `integrations.stitch.enabled` — whether Stitch MCP is available for design mockups
- `integrations.stitch.project_id` — existing Stitch project for this pipeline project (may be null)
- `integrations.stitch.device_type` — target device for generated screens
- `integrations.figma.enabled` — whether Figma MCP is available for design reference

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

Follow the brainstorming skill exactly. Pass the config values to each step that needs them.

**Decision lock check:** Before proposing approaches, check for locked decisions.

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

Store the resolved absolute path and use it in the command below.

**Postgres tier:**
```bash
PROJECT_ROOT=$(pwd) node <resolved_scripts_dir>/pipeline-db.js query "SELECT topic, decision FROM decisions WHERE status = 'locked' ORDER BY created_at DESC LIMIT 20"
```

**Files tier:** Read `DECISIONS.md` from the project root if it exists. In DECISIONS.md, lines prefixed with `[LOCKED]` are constraints. Lines without the prefix are informational context.

Locked decisions are constraints, not suggestions. You MUST NOT propose alternatives to locked decisions. If a locked decision conflicts with the current task, flag it explicitly:
> "Warning: Locked decision [topic] constrains this design: [decision]. Working within this constraint."

The brainstorming skill includes a hard gate against premature implementation. Enforce it.

---

### Persist to knowledge tier

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Using the same `SCRIPTS_DIR` resolved earlier for the locked-decisions query:

Record the design decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision "$(cat <<'TOPIC'
design-[feature-name]
TOPIC
)" "$(cat <<'SUMMARY'
[date]: [chosen approach name/summary]
SUMMARY
)" "$(cat <<'DETAIL'
[1-2 sentences: what was decided and key trade-offs considered]
DETAIL
)"
```

If any decisions should be locked (user said "lock this" or the decision is a hard constraint):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "UPDATE decisions SET status = 'locked' WHERE topic = '[topic]'"
```

**If `knowledge.tier` is `"files"`:**

Only record if the decision is locked — unlocked design decisions go to postgres only to avoid bloating DECISIONS.md:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js decision "$(cat <<'TOPIC'
[LOCKED] design-[feature-name]
TOPIC
)" "$(cat <<'SUMMARY'
[chosen approach]
SUMMARY
)" "$(cat <<'DETAIL'
[key trade-offs]
DETAIL
)"
```

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.
