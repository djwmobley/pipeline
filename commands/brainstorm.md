---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*)
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

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

Follow the brainstorming skill exactly. Pass the config values to each step that needs them.

**Decision lock check:** Before proposing approaches, check for locked decisions:

**Postgres tier:**
```bash
PROJECT_ROOT=[project_root] node $SCRIPTS_DIR/pipeline-db.js query "SELECT topic, decision FROM decisions WHERE status = 'locked' ORDER BY created_at DESC LIMIT 20"
```

**Files tier:** Read `DECISIONS.md` from the project root if it exists. In DECISIONS.md, lines prefixed with `[LOCKED]` are constraints. Lines without the prefix are informational context.

Locked decisions are constraints, not suggestions. You MUST NOT propose alternatives to locked decisions. If a locked decision conflicts with the current task, flag it explicitly:
> "Warning: Locked decision [topic] constrains this design: [decision]. Working within this constraint."

The brainstorming skill includes a hard gate against premature implementation. Enforce it.
