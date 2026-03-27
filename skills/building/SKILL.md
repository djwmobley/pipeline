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

## Context Injection

Agents read their own context from stores — the orchestrator passes references, not full text.

| Context Source | How Agent Reads | Fallback |
|----------------|----------------|----------|
| Architecture plan | `docs/architecture.md` (file read) | Skip if missing |
| Decisions | `pipeline-context.js decisions` (Postgres) | Skip if Postgres unavailable |
| Gotchas | `pipeline-context.js gotchas` (Postgres) | Skip if Postgres unavailable |
| Task issue | `gh issue view N` (GitHub) | Skip if GitHub disabled |
| Prior tasks | `.claude/build-state.json` (file read) | First task in build |
| Task description | Pasted in prompt (from plan) | Always available |

The orchestrator substitutes reference IDs (issue numbers, script paths) into the prompt template. The agent uses those references to fetch its own context. This replaces the v1 pattern of pasting full context blocks into the prompt.

## The Process

```
Read plan, extract all tasks
  │
  ▼
Check .claude/build-state.json ──exists──▶ Resume from last incomplete task
  │ fresh
  ▼
Initialize build-state.json (all tasks pending)
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
Checkpoint: write to all three stores (Postgres + GitHub issue + build-state.json)
  │
  ▼
More tasks? ──yes──▶ Dispatch implementer subagent
  │ no
  ▼
Delete build-state.json, persist to knowledge tier
  │
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

## Architecture Plan Compliance

If `docs/architecture.md` exists, the implementer agent reads it and checks:

- **Module boundaries** — code respects the module structure and public interfaces
- **Typed contracts** — function signatures match contract shapes in the arch plan
- **Banned patterns** — code does not use any explicitly banned pattern
- **Code patterns** — implementation follows established patterns from the arch plan

Arch compliance is part of the implementer's self-review checklist. The post-task reviewer independently verifies compliance.

If no arch plan exists, skip compliance checks silently.

## Reporting Contract

All three stores, every time. This is the A2A contract — the post-task reviewer
reads implementation results to understand what was built and where to focus.

**Runtime placeholders** (resolved by the build command before dispatching):
- `[TASK_NUMBER]` — task number from the plan.
- `[TASK_NAME]` — task name from the plan.
- `[TASK_ISSUE]` — GitHub issue number for this task. Empty if GitHub disabled.
- `[GITHUB_REPO]` — `integrations.github.repo` from pipeline.yml. Empty if GitHub disabled.

### 1. Postgres Write

Record implementation result in the knowledge DB:
```
PROJECT_ROOT=$(git rev-parse --show-toplevel) node "$PROJECT_ROOT/scripts/pipeline-db.js" insert knowledge \
  --category 'build' \
  --label 'task-[TASK_NUMBER]-impl' \
  --body "$(cat <<'BODY'
{"task": [TASK_NUMBER], "status": "DONE|...", "commit_sha": "[SHA]", "files_changed": [N]}
BODY
)"
```

### 2. GitHub Issue Comment (if task issue is available)

Post implementation report on the task issue:
```
gh issue comment [TASK_ISSUE] --repo '[GITHUB_REPO]' --body "$(cat <<'EOF'
## Implementation — Task [TASK_NUMBER]
**Status:** [DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT]
**Commit:** [SHA]
**Files changed:** [list]
EOF
)"
```

### 3. Build State

Update `.claude/build-state.json` with task status and commit SHA for crash recovery.

### Fallback (GitHub disabled)

If GitHub is not enabled, skip the issue comment.
Postgres write and build state update are always required.

## Prompt Templates

- `./implementer-prompt.md` — Dispatch implementer subagent (reads context from stores)
- `./reviewer-prompt.md` — Dispatch post-task reviewer (spec compliance + quality)

## Red Flags

**Never:**
- Skip post-task review
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Skip context reads (arch plan, decisions, gotchas, task issue)
- Accept "close enough" on spec compliance
- Move to next task while review has open issues

**TDD routing:** If the plan marks a task as `tdd: required`, include the TDD skill (`skills/tdd/SKILL.md`) content in the implementer's prompt. Do not include TDD content for tasks not marked `tdd: required`.

**If subagent asks questions:** Answer clearly and completely before proceeding.

**If reviewer finds issues:** Implementer fixes → reviewer re-reviews → repeat until approved.

**If subagent fails:** Dispatch fix subagent with specific instructions. Don't fix manually.
