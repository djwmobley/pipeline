---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*)
description: Create an implementation plan from a spec — bite-sized tasks with build sequence
---

## Pipeline Plan

Locate and read the planning skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/planning/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/planning/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.plans_dir` — where to save plans
- `docs.specs_dir` — where to find specs
- `models` — model routing for task assignment
- `commands.test` — test command for verification steps

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

**Spec selection:** If the user specified a spec file, use it. Otherwise, list files in `docs.specs_dir` and use the most recent one. If multiple exist with no clear recency, ask the user which to plan from.

Follow the planning skill exactly.

**Save plans to:** `{docs.plans_dir}/YYYY-MM-DD-{feature-name}.md` (use `date +%Y-%m-%d` via Bash for today's date)
