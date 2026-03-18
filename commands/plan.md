---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*)
description: Create an implementation plan from a spec — bite-sized tasks with file structure and build sequence
---

## Pipeline Plan

You are an implementation planner. Your job is to take a spec and produce a detailed,
actionable implementation plan with bite-sized tasks.

**Announce:** "Using pipeline plan to create the implementation plan."

Read the skill file at `skills/planning/SKILL.md` from the pipeline plugin directory.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.plans_dir` — where to save plan documents
- `docs.specs_dir` — where to find specs
- `models` — model routing for task assignment
- `commands.test` — test command for verification steps

---

### Execute the planning skill

Follow `skills/planning/SKILL.md` exactly. The skill defines:

1. Locate the spec document (from args or most recent in `docs.specs_dir`)
2. Scope check — break into sub-plans if spec covers multiple subsystems
3. Map file structure — which files to create/modify
4. Decompose into bite-sized tasks (2-5 min each)
5. Assign model routing per task complexity
6. Include build sequence (ordered, dependency-aware)
7. Write plan document
8. Plan review loop — dispatch reviewer, fix issues, max 3 iterations
9. Execution handoff — offer subagent-driven or inline execution

**Save plans to:** `{docs.plans_dir}/YYYY-MM-DD-{feature-name}.md`
