---
name: checkpoints
description: Human-in-the-loop checkpoint taxonomy — MUST/SHOULD/MAY classification for all pipeline decision points
operation_class: script_exec
allowed_models: []
allowed_direct_write: false
---

# Human-in-the-Loop Checkpoints

## Overview

Every point in the pipeline where a human decision is required or recommended is a **checkpoint**. Checkpoints are classified into three tiers that determine how they are presented and whether they can be skipped.

**Core principle:** Safety-critical decisions are never optional. Recommended checks are prompted with a default. Optional checks are available but off by default.

## Taxonomy

| Tier | Behavior | Prompt Format | Can Be Skipped? |
|------|----------|---------------|-----------------|
| **MUST** | Hard stop. Pipeline blocks until condition is met or user explicitly confirms. | Block statement + rationalization prevention table + "Cannot proceed until [condition]." | Never. Not configurable. |
| **SHOULD** | Prompted with default-yes. User can decline with explanation of what they are skipping. | `[Action]? (Y/n)` + what it does + risk of skipping | Yes — user types "n" or "no" |
| **MAY** | Prompted with default-no. User opts in if they want the check. | `[Action]? (y/N)` + brief explanation | Yes — default is to skip |

### MUST Rendering Rules

Every MUST checkpoint requires:

1. A **block statement** naming the condition: "Tests must pass before merge options are presented."
2. A **rationalization prevention table** with at least 3 rows covering the most likely rationalizations for skipping
3. A **stop directive**: "Stop. Don't proceed to [next step]."

```
<!-- checkpoint:MUST [id] -->

[Condition statement. What must be true before proceeding.]

| Rationalization | Reality |
|---|---|
| "[common excuse 1]" | [why it's wrong] |
| "[common excuse 2]" | [why it's wrong] |
| "[common excuse 3]" | [why it's wrong] |

Stop. Don't proceed to [next step].
```

### SHOULD Rendering Rules

Every SHOULD checkpoint requires:

1. A **prompt** with `(Y/n)` — default is to proceed
2. A **brief explanation** of what the action does
3. A **risk statement** for what is lost by skipping

```
<!-- checkpoint:SHOULD [id] -->

[Action description]? (Y/n)

[What this does. What you risk by skipping.]
```

When a user declines a SHOULD checkpoint, log the skip in the command output:
```
[Checkpoint name]: skipped by user
```

### MAY Rendering Rules

Every MAY checkpoint requires:

1. A **prompt** with `(y/N)` — default is to skip
2. A **brief explanation** of what the action does

```
<!-- checkpoint:MAY [id] -->

[Action description]? (y/N)

[What this does.]
```

When a user declines a MAY checkpoint (or accepts the default skip), no logging is needed — skipping is the expected path.

## Checkpoint Registry

| ID | Command | Description | Tier | Rationale |
|----|---------|-------------|------|-----------|
| `orientation` | all phase skills | Assert cwd, branch, HEAD, worktree, dirty flag before Step 0 | MUST | Bash tool persists cwd across calls; invisible drift corrupts history |
| `finish-tests-pass` | finish | Tests must pass before merge options | MUST | Merging with failing tests breaks the main branch |
| `finish-merge-verify` | finish | Re-run tests after merge | MUST | Merge can introduce conflicts that break tests |
| `finish-discard-confirm` | finish | Type "discard" to delete branch | MUST | Permanent data loss — branch and all commits deleted |
| `review-adversarial` | review | Must produce findings or clean certificate | MUST | Empty reviews are rubber-stamps that miss real bugs |
| `plan-coverage` | plan | Every spec requirement traces to a task | MUST | Untraced requirements get silently dropped from implementation |
| `build-qa-large` | build | QA verification for LARGE+ changes | SHOULD | Large changes have higher regression risk; QA catches integration failures |
| `debate-large` | debate | Design debate for LARGE+ specs | SHOULD | Complex specs have hidden assumptions that only adversarial challenge surfaces |
| `build-resume` | build | Confirm resume of interrupted build | SHOULD | User may want to start fresh rather than resume stale state |
| `plan-no-debate` | plan | Warn when LARGE+ spec has no debate | SHOULD | Plans without debate have historically required full rewrites |
| `remediate-proceed` | remediate | Confirm batch plan before executing fixes | SHOULD | User should review which findings will be auto-fixed before code changes |
| `build-completion` | build | Post-build option selection | SHOULD | User chooses next workflow step (review, commit, leave) |
| `finish-completion` | finish | Post-finish option selection | SHOULD | User chooses merge strategy (merge+push, PR, keep, discard) |
| `debate-medium` | debate | Design debate for MEDIUM specs | MAY | Low risk — most MEDIUM plans succeed without debate |

## Skip Logging

When a user declines a **SHOULD** checkpoint, the command must include a skip note in its output. This creates a record for post-incident review — if a build ships with a problem, the skip log shows which recommended checks were bypassed.

Format: `[Checkpoint description]: skipped by user`

Examples:
- `QA verification: skipped by user`
- `Remediation plan review: skipped by user`

**Menu-style SHOULD checkpoints** (e.g., `build-completion`, `finish-completion`) present multiple options rather than a yes/no prompt. These do not require skip logging — the user is making a choice, not declining a check.

MAY checkpoints do not require skip logging — skipping is the default and expected behavior.

MUST checkpoints cannot be skipped, so skip logging does not apply.

## ID Naming Convention

Checkpoint IDs follow the pattern: `{command}-{action-noun}`

- **command** — the pipeline command that owns the checkpoint (e.g., `finish`, `build`, `debate`)
- **action-noun** — a short noun or noun phrase describing what is checked (e.g., `tests-pass`, `qa-large`, `resume`)
- All lowercase, hyphens only, no underscores

Examples of well-formed IDs: `finish-tests-pass`, `build-qa-large`, `debate-medium`
Examples of poorly-formed IDs: `finishTestsPass`, `build_qa`, `DEBATE-LARGE`

## Adding New Checkpoints

When writing a new command or adding a decision point to an existing command:

1. **Classify the tier:**
   - Does skipping this risk data loss, broken deploys, or security bypass? → **MUST**
   - Is this a recommended check that most users should accept? → **SHOULD**
   - Is this an optional enhancement most users will skip? → **MAY**

2. **Pick an ID** following the `{command}-{action-noun}` convention

3. **Add the annotation** to the command file at the checkpoint location:
   ```
   <!-- checkpoint:TIER id -->
   ```

4. **Add a row** to the registry table above with ID, command, description, tier, and rationale

5. **Format the prompt** according to the rendering rules for the chosen tier

6. **Add skip logging** if the tier is SHOULD

## Red Flags / Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "This checkpoint is just for documentation" | If it requires a human decision, it is a checkpoint. Classify and register it. |
| "This is obviously a SHOULD, not a MUST" | If skipping it can lose data or break deploys, it is a MUST. The user's convenience does not override safety. |
| "Nobody will ever skip this" | If nobody skips it, making it MUST costs nothing. If someone does skip it, the classification matters. |
| "Adding to the registry is overhead" | One table row. The overhead of an unregistered checkpoint is discovering it by accident during an incident. |
| "I'll register it later" | Register it now. Unregistered checkpoints are invisible checkpoints. |
