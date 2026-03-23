---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*), mcp__stitch__create_project, mcp__stitch__list_projects, mcp__stitch__get_project, mcp__stitch__list_screens, mcp__stitch__get_screen, mcp__stitch__generate_screen_from_text, mcp__stitch__edit_screens, mcp__stitch__generate_variants, mcp__figma__get_file, mcp__figma__get_file_nodes, mcp__figma__get_images
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
