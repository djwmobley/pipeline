---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Task(*)
description: Subagent-driven plan execution — fresh agent per task with two-stage review
---

## Pipeline Build

Execute an implementation plan by dispatching fresh subagent per task, with two-stage review
after each: spec compliance first, then code quality.

**Announce:** "Using pipeline build to execute the implementation plan."

Read the skill file at `skills/building/SKILL.md` from the pipeline plugin directory.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `models` — model routing for task assignment
- `commands.test` — test command for verification
- `review.non_negotiable` — intentional decisions for quality reviewer
- `docs.plans_dir` — where to find plans

---

### Execute the building skill

Follow `skills/building/SKILL.md` exactly. The skill defines:

1. **Load plan** — Read the plan file (from args or most recent in `docs.plans_dir`)
2. **Extract all tasks** with full text and context upfront
3. **For each task:**
   a. Dispatch implementer subagent with model from plan's task routing
   b. Handle status: DONE → review, NEEDS_CONTEXT → provide context, BLOCKED → escalate
   c. Dispatch spec compliance reviewer
   d. If issues → implementer fixes → re-review
   e. Dispatch code quality reviewer (pipeline:code-reviewer agent)
   f. If issues → implementer fixes → re-review
   g. Mark task complete
4. **After all tasks:** dispatch final code reviewer for entire implementation
5. **Transition:** invoke /pipeline:finish

**Fallback:** If subagents unavailable, execute tasks sequentially in main context.

**Model selection per task:**
- Mechanical tasks (1-2 files, clear spec) → haiku
- Integration tasks (multi-file, pattern matching) → sonnet
- Architecture/design tasks → sonnet or opus per config
