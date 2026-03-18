---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*)
description: Design before LARGE changes — explore context, clarify requirements, propose approaches, write spec
---

## Pipeline Brainstorm

Read the skill file at `skills/brainstorming/SKILL.md` from the pipeline plugin directory.

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.specs_dir` — where to save spec documents
- `review.non_negotiable` — intentional decisions to respect
- `security` — security checklist to evaluate against

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

Follow the brainstorming skill exactly. Pass the config values to each step that needs them.

<HARD-GATE>
Do NOT write any code or take any implementation action until the design is approved.
</HARD-GATE>
