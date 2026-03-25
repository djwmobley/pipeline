---
name: planning
description: Create implementation plans from specs — bite-sized tasks, file structure, build sequence, model routing
---

# Writing Implementation Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for the codebase.
Document everything they need: which files to touch, code, testing, how to verify.
Give them bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project
specs during brainstorming. If it wasn't, suggest breaking into separate plans — one per subsystem.

## File Structure

Before defining tasks, map out which files will be created or modified:
- Design units with clear boundaries and well-defined interfaces
- Prefer smaller, focused files over large ones
- Files that change together should live together
- In existing codebases, follow established patterns

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

## Plan Document Header

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** Use /pipeline:build to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Model Routing:** [Which tasks need sonnet vs haiku]

**Decisions:** [path to decision records, or "inline — see Architectural Constraints below"]

---
```

## Architectural Constraints

If the plan command provided an `## Architectural Constraints` section (from recon or decision records), include it in the plan immediately after the header.

The planner MUST:
- Follow established patterns listed in the constraints (don't introduce a new library when one exists)
- Respect existing conventions (naming, file organization, export style)
- Document any deviations required by the spec as explicit decision records:
  ```
  ### Decisions for This Feature
  - DECISION-001: [title] — [decision]. Invalidate if: [condition].
  ```

If architectural constraints conflict with the spec, flag the conflict and ask the builder to resolve it.

The plan reviewer (dispatched during the review loop) checks constraint compliance: "Does any task use a library, pattern, or convention not sanctioned by the architectural constraints?"

## Task Structure

````markdown
### Task N: [Component Name]

**Model:** [haiku/sonnet — from config `models.*`]
**TDD:** [required/optional — `required` for complex logic, state machines, data transforms; `optional` for UI, config, scaffolding]

**Files:**
- Create: `exact/path/to/file`
- Modify: `exact/path/to/existing:123-145`
- Test: `tests/exact/path/to/test`

- [ ] **Step 1: Write the failing test**

```language
test code here
```

- [ ] **Step 2: Run test to verify it fails**

Run: `[commands.test from pipeline.yml] path/to/test`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```language
implementation code here
```

- [ ] **Step 4: Run test to verify it passes**

Run: `[commands.test from pipeline.yml] path/to/test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add [files]
git commit -m "feat: add specific feature"
```
````

## Build Sequence

<!-- checkpoint:MUST plan-coverage -->

Every requirement from the spec MUST trace to at least one task. Missing requirements are a plan failure — do not proceed to review until every spec requirement is covered.

| Rationalization | Reality |
|---|---|
| "This requirement is implied by another task" | If it is not explicitly traced, it will be dropped. Make the trace explicit. |
| "We can add it in a follow-up" | Follow-ups are where requirements go to die. Cover it now. |
| "The requirement is too vague to trace" | Then clarify the requirement. Vague requirements produce vague implementations. |

After tasks, include an ordered build sequence:

```markdown
## Build Sequence

1. [Task N] — [what it produces] (no dependencies)
2. [Task M] — [what it produces] (depends on: Task N)
3. [Task P] — [what it produces] (depends on: Task M)
```

## Plan Review Loop

After writing the complete plan:
1. Verify every spec requirement traces to at least one task — missing coverage MUST be fixed before review
2. Dispatch plan-reviewer subagent (see plan-reviewer-prompt.md)
3. If Issues Found: fix, re-dispatch until Approved
4. If loop exceeds 3 iterations, surface to human

## Execution Handoff

After saving the plan:

> "Plan complete and saved to `<path>`. Two execution options:
>
> **1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks
> **2. Inline Execution** — Execute tasks sequentially in this session
>
> Which approach?"

If subagent-driven: invoke /pipeline:build
If inline: execute tasks sequentially following the plan

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Model routing per task
- DRY, YAGNI, TDD, frequent commits
- Every task MUST have a `tdd` field (`required` or `optional`) — the build system uses this to gate TDD enforcement
