---
name: building
description: Subagent-driven plan execution with post-task review
operation_class: code_draft
allowed_models: []
allowed_direct_write: false
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
| Task issue | `node '[SCRIPTS_DIR]/platform.js' issue view N` | Skip if platform.issue_tracker is `none` |
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
Checkpoint: write to all three stores (Postgres + issue comment + build-state.json)
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

Two stores, every time. The implementer writes the issue comment and updates
build-state; the orchestrator (not the implementer) emits any verified counts
or distributions in a follow-up addendum after running the post-dispatch
verification protocol below.

A `knowledge` Postgres table previously listed here was fabricated — neither
the table nor a `pipeline-db.js insert knowledge` verb exist. See #130.

**Runtime placeholders** (resolved by the build command before dispatching).
Full substitution checklist is in the prompt template — these are the key placeholders:
- `[TASK_NUMBER]` — task number from the plan.
- `[TASK_NAME]` — task name from the plan.
- `[TASK_DESCRIPTION]` — full task text from the plan.
- `[TASK_ISSUE]` — issue number for this task. Empty if issue tracking is disabled.
- `[GITHUB_REPO]` — `integrations.github.repo` from pipeline.yml. Empty if issue tracking is disabled.
- `[SCRIPTS_DIR]` — absolute path to the pipeline plugin's scripts/ directory.
- `[DIRECTORY]` — working directory path.

### 1. Issue Comment (if task issue is available)

Post implementation report on the task issue. Status, commit SHA, and concerns
only — no counts, no distributions, no file lists. Counts come from the
orchestrator-emitted addendum after verification (see #133).

```
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [TASK_ISSUE] --stdin
## Implementation — Task [TASK_NUMBER]
**Status:** [DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT]
**Commit:** [SHA]

[For DONE_WITH_CONCERNS: list concerns, free text]
[For BLOCKED/NEEDS_CONTEXT: describe what's needed]
EOF
```

If the command fails, do NOT proceed to "report DONE." Status is BLOCKED. The
issue comment is binding. See ANTI-RATIONALIZATION in the prompt template.

### 2. Build State

Update `.claude/build-state.json` with task status and commit SHA for crash
recovery. Always required regardless of issue-tracker availability.

### Fallback

- **Issue tracking disabled** (`[TASK_ISSUE]` empty): skip the issue comment.
  Build-state remains required.
- **Issue comment write fails** (network error, auth, etc.): status BLOCKED.
  Do not silently skip. Do not invent a "defer to orchestrator" loophole.

## Post-Dispatch Verification (orchestrator-side, mandatory before next task)

After the implementer or reviewer subagent returns, the orchestrator MUST run
the following verification protocol before marking the task done in
build-state.json or proceeding to the next task. This is the deterministic
enforcement layer for the Reporting Contract — without it, subagents reason
their way out of required steps (cf. epic #129, Task 1 incident).

### 1. Issue comment exists

```bash
node '[SCRIPTS_DIR]/platform.js' issue view [TASK_ISSUE] | grep -E "^## (Implementation|Post-Task Review) — Task [TASK_NUMBER]"
```

If no match, the subagent skipped the required write. Re-dispatch with
"you skipped the issue comment write — post it before reporting again"
appended to the prompt. Do NOT mark the task done.

### 2. Commit exists and matches expected subject

The task spec (in the plan) provides the expected commit message. Verify:

```bash
git log --oneline | head -5 | grep -F "[expected commit subject]"
```

If no match, the implementation didn't actually commit, or the message drifted.
Status is BLOCKED until the implementer fixes it.

### 3. Files-changed match

```bash
git diff --name-only [BASELINE_OR_PRIOR_TASK_COMMIT]..HEAD
```

The diff list must intersect what the task spec listed under `Files:`.
Unexpected files (e.g., a spurious `.claude/build-state.json` commit) flag
a 🟡 MEDIUM concern that the orchestrator records on the issue.

### 4. No "N/A" / "skipping" claims in the subagent reply

Scan the subagent's reply for forbidden patterns:

```
N/A | not applicable | skipping the X write | unable to verify | deferred to orchestrator
```

Any match short-circuits acceptance. Re-dispatch the subagent with
"the following pattern in your reply indicates a skipped step — escalate as
BLOCKED instead of skipping" appended.

### 5. Orchestrator-emitted addendum (counts and distributions)

After verification passes, the orchestrator (not the subagent) posts a
follow-up comment to the task issue with deterministic facts:

```bash
cat <<EOF | node '[SCRIPTS_DIR]/platform.js' issue comment [TASK_ISSUE] --stdin
## Verification — Task [TASK_NUMBER]
**Verified by orchestrator at [ISO 8601]**
**Files changed (vs baseline):**
$(git diff --stat [BASELINE]..HEAD)

**[Any task-specific counts emitted by deterministic commands, e.g. linter
output, distribution from grep, etc.]**

**Three-store check:** ✓ issue comment present, ✓ build-state updated
EOF
```

This addendum is the source of truth for any count the user or future agents
will read. Subagent self-counting is not trusted. See #133.

## Prompt Templates

- `./implementer-prompt.md` — Dispatch implementer subagent (reads context from stores)
- `./reviewer-prompt.md` — Dispatch post-task reviewer (spec compliance + quality + arch compliance)

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
