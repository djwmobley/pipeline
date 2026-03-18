---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*)
description: Create an implementation plan from a spec — bite-sized tasks with build sequence
---

## Pipeline Plan

Read the skill file at `skills/planning/SKILL.md` from the pipeline plugin directory.

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.plans_dir` — where to save plans
- `docs.specs_dir` — where to find specs
- `models` — model routing for task assignment
- `commands.test` — test command for verification steps

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

Follow the planning skill exactly.

**Save plans to:** `{docs.plans_dir}/YYYY-MM-DD-{feature-name}.md`
