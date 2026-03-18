---
name: building
description: Subagent-driven plan execution with post-task review
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with review after each.

**Core principle:** Fresh subagent per task + post-task review = high quality, fast iteration.

## When to Use

- Have an implementation plan with defined tasks
- Tasks are mostly independent
- Want automated review between tasks

## The Process

```
Read plan, extract all tasks
  │
  ▼
Dispatch implementer subagent
  │
  ▼
Handle status ──NEEDS_CONTEXT──▶ (provide context, re-dispatch)
  │ DONE
  ▼
Post-task review
  │
  ▼
Review OK? ──issues──▶ (fix, re-dispatch)
  │ OK
  ▼
Mark task complete
  │
  ▼
More tasks? ──yes──▶ Dispatch implementer subagent
  │ no
  ▼
Invoke /pipeline:finish
```

## Model Selection

Use the least powerful model that can handle each role:

- **Mechanical tasks** (1-2 files, clear spec): `models.cheap` (haiku)
- **Integration tasks** (multi-file, pattern matching): `models.implement` (sonnet)
- **Post-task review**: `models.cheap` (haiku) for mechanical tasks, `models.review` (sonnet) for integration tasks

Task complexity signals:
- Touches 1-2 files with complete spec → cheap model
- Touches multiple files with integration concerns → standard model
- Requires design judgment → most capable model

## Handling Implementer Status

**DONE:** Treat as MEDIUM confidence until the post-task reviewer verifies (then HIGH). Proceed to post-task review.

**DONE_WITH_CONCERNS:** Read concerns. Address correctness/scope issues before review.
Note observations and proceed.

**NEEDS_CONTEXT:** Always HIGH confidence — the agent knows what it doesn't know. Provide missing context and re-dispatch.

**BLOCKED:** Always HIGH confidence — the agent has identified a real obstacle. Assess:
1. Context problem → provide more context, re-dispatch
2. Needs more reasoning → re-dispatch with more capable model
3. Task too large → break into smaller pieces
4. Plan wrong → escalate to user

**Never** ignore escalations or force retry without changes.

## Prompt Templates

- `./implementer-prompt.md` — Dispatch implementer subagent
- `./reviewer-prompt.md` — Dispatch post-task reviewer (spec compliance + quality)

## Red Flags

**Never:**
- Skip post-task review
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Skip scene-setting context
- Accept "close enough" on spec compliance
- Move to next task while review has open issues

**TDD routing:** If the plan marks a task as `tdd: required`, include the TDD skill (`skills/tdd/SKILL.md`) content in the implementer's prompt. Do not include TDD content for tasks not marked `tdd: required`.

**If subagent asks questions:** Answer clearly and completely before proceeding.

**If reviewer finds issues:** Implementer fixes → reviewer re-reviews → repeat until approved.

**If subagent fails:** Dispatch fix subagent with specific instructions. Don't fix manually.
