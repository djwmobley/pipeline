---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Task(*)
description: Subagent-driven plan execution — fresh agent per task with post-task review
---

## Pipeline Build

Read the skill file at `skills/building/SKILL.md` from the pipeline plugin directory.

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `models` — model routing for task assignment
- `models.cheap` — for document reviews and mechanical tasks
- `commands.test` — test command for verification
- `review.non_negotiable` — intentional decisions for reviewer
- `docs.plans_dir` — where to find plans

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

Follow the building skill exactly. Use `models.cheap` (haiku) for mechanical tasks and document reviews, `models.implement` (sonnet) for integration tasks.

**Fallback:** If subagents are unavailable, execute tasks sequentially in main context.
