---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Task(*)
description: Subagent-driven plan execution — fresh agent per task with post-task review
---

## Pipeline Build

Locate and read the building skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/building/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/building/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `models` — model routing for task assignment
- `models.cheap` — for document reviews and mechanical tasks
- `commands.test` — test command for verification
- `review.non_negotiable` — intentional decisions for reviewer
- `docs.plans_dir` — where to find plans

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

**Plan selection:** If the user specified a plan file, use it. Otherwise, list files in `docs.plans_dir` and use the most recent one. If multiple exist with no clear recency, ask the user which to execute.

Follow the building skill exactly. Use the value of `models.cheap` from pipeline.yml (e.g., `haiku`) for mechanical tasks and document reviews. Use the value of `models.implement` (e.g., `sonnet`) for integration tasks. When dispatching subagents, substitute these literal model strings into the prompt templates — do not pass config key names.

**Fresh context rule:** When dispatching sub-agents for LARGE tasks, each agent receives ONLY:
1. The specific task description from the plan (paste the text — do not reference a file)
2. Relevant file contents (paste — do not ask the sub-agent to read files)
3. If Postgres tier: results from `pipeline-embed.js hybrid "<task description>"` for prior context
4. The project's non-negotiable decisions from config

Do NOT pass conversation history, prior task results, or accumulated context. Each sub-agent starts clean. This prevents context rot — quality degradation as context accumulates.

**Fallback:** If subagents are unavailable, execute tasks sequentially in main context.
