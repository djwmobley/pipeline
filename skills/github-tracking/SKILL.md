---
name: github-tracking
description: Mandatory GitHub issue tracking ceremony — every command that produces output must update the associated epic
---

# GitHub Issue Tracking — Mandatory Ceremony

## Overview

**This is a hard rule.** Every pipeline command that produces meaningful output MUST interact with the associated GitHub issue. GitHub Issues is the source of truth for project tracking. Work that is not reflected in GitHub did not happen.

This skill defines what every command must do. It is not optional. It is not best-effort. Commands that produce output without updating GitHub are broken commands.

## Prerequisites

All GitHub tracking is gated on two config flags:

```yaml
integrations:
  github:
    enabled: true
    issue_tracking: true
```

If either flag is false, GitHub tracking is skipped with a silent no-op. Commands must still function without GitHub — findings go to files/Postgres, workflow continues. But when GitHub is enabled, tracking is mandatory.

## The Epic Model

Pipeline uses a **feature epic** model:

1. `/pipeline:brainstorm` creates the epic — a GitHub issue with a status checklist
2. Every downstream command reads `github_epic: N` from spec or plan metadata
3. Each command posts a summary comment on the epic when it completes
4. Commands that produce findings create child issues linked to the epic
5. `/pipeline:finish` closes the epic when the feature ships

### Epic Checklist

The brainstorm command creates an epic with this checklist:

```markdown
- [ ] Plan
- [ ] Build
- [ ] Review
- [ ] QA
- [ ] Ship
```

Commands that complete a phase update the checklist by editing the epic body to check the corresponding item. This gives stakeholders at-a-glance progress.

## Required Behaviors by Command Category

### Category 1: Phase Commands (update epic checklist)

These commands represent major workflow phases. They MUST:
1. Read `github_epic: N` from spec or plan metadata
2. Post a summary comment on the epic
3. Update the epic checklist to check their phase

| Command | Phase | Comment Content |
|---------|-------|----------------|
| plan | Plan | Task count, file count, build sequence summary |
| build | Build | Task count, baseline SHA, auto-verify result |
| review | Review | Verdict, finding counts by severity |
| qa | QA | Test plan summary (plan mode) or verdict (verify mode) |
| finish | Ship | Branch merged, issue closed |

### Category 2: Finding Commands (create child issues)

These commands produce findings. They MUST:
1. Create GitHub issues for findings at or above their severity threshold
2. Link child issues to the epic (`Linked to: #[EPIC_N]`)
3. Post a summary comment on the epic with finding counts

| Command | Issue Creation Threshold | Labels |
|---------|------------------------|--------|
| redteam | All severities | `red-team`, severity label |
| review | 🔴 Must Fix only | `review`, `high` |
| remediate | Per `auto_issue_threshold` config | `pipeline:finding` |
| architect | LOW-confidence decisions only | `pipeline:decision` |
| compliance | Tier 1 coverage gaps | `compliance` |
| qa (verify) | Code-is-wrong failures | `qa`, `failure` |

### Category 3: Decision Commands (comment on epic)

These commands produce decisions or verdicts. They MUST:
1. Post a summary comment on the epic
2. NOT create child issues (decisions are comments, not trackable items)

| Command | Comment Content |
|---------|----------------|
| debate | Disposition, points of agreement count, contested points count, risk count |
| architect | Decisions table with confidence levels |

### Category 4: Utility Commands (no GitHub interaction required)

These commands are mechanical operations that don't produce trackable output:
- commit, simplify, dashboard, debug, init, update, worktree, knowledge, security (checklist only), triage, test, release, markdown-review

These commands do NOT require GitHub interaction. They may optionally reference the epic in commit messages or PR bodies when the context is available.

**Exception — commit.md:** When a plan file with `github_epic: N` is available, the commit message SHOULD include `Part of #[N]` in the body for traceability.

## Epic Reference Resolution

Commands find the epic number through this chain:

1. Read `github_epic: N` from the **plan file** metadata (most common)
2. If no plan, read from the **spec file** metadata
3. If no spec, check the **most recent plan** in `docs.plans_dir`
4. If nothing found, skip GitHub tracking silently — not all work is tied to an epic

```bash
# Verify epic exists before commenting
node '[SCRIPTS_DIR]/platform.js' issue view [N] 2>/dev/null
```

If the command fails, notify the user with the error and ask for guidance.

If the epic is closed or deleted, log a warning and skip. Do not create a new epic — that is brainstorm's job.

## Comment Format

### What to post

Epic comments are a **log of outcomes** — what was decided, what was found, what shipped. Each comment must contain substantive content: metrics, verdicts, finding counts, or completion summaries.

```markdown
## [Phase Name]

**[Key metric 1]:** [value]
**[Key metric 2]:** [value]
[Optional 1-2 sentence summary]

Report: `[path to full report]`
```

### What NOT to post

Do not post status updates, progress announcements, or activity signals. These are noise.

| Do NOT post | Why |
|-------------|-----|
| "Research phase started" | Nobody cares that you started. Post findings when you have them. |
| "Beginning implementation" | The first comment should be the first result, not an announcement. |
| "Working on task 3 of 7" | Progress tracking belongs in build state files, not issue comments. |
| "Looking into this" | Say nothing until you have something to report. |

**Rule:** Every issue comment must answer the question "what happened?" — not "what is happening?"

## Deduplication

Before creating any child issue, check for an existing issue with the same finding ID:

```bash
node '[SCRIPTS_DIR]/platform.js' issue search '[FINDING_ID] in:title' --state open --limit 1
```

If the command fails, notify the user with the error and ask for guidance.

If an issue already exists, skip creation. This prevents duplicate issues when commands are re-run.

## Graceful Degradation

When `integrations.github.enabled` is false or `integrations.github.issue_tracking` is false:

- Skip all GitHub operations silently
- Do not warn, do not error — GitHub is optional per project
- Findings still go to files/Postgres as normal
- The workflow is complete without GitHub

When GitHub is enabled but `gh` CLI fails (network error, auth issue):

- Log a warning: `GitHub tracking failed: [error]. Continuing without GitHub updates.`
- Do not block the command — GitHub tracking is important but not blocking
- The user can re-run the command or manually update the issue

## Adding GitHub Tracking to a New Command

When writing a new command:

1. **Determine the category** (phase, finding, decision, utility)
2. **Add config extraction**: `integrations.github.enabled`, `integrations.github.issue_tracking`, `project.repo`
3. **Add epic resolution**: follow the chain above
4. **Add the appropriate behavior**: checklist update, child issue creation, or summary comment
5. **Gate on config**: wrap all GitHub operations in `if integrations.github.enabled AND integrations.github.issue_tracking`
6. **Use heredocs**: all `--body` and `--comment` content must use heredocs with single-quoted delimiters for shell safety

## Red Flags / Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "This command doesn't produce important output" | If it produces output the user should see, it belongs on the epic. If it doesn't, it's a utility command — classify it correctly. |
| "I'll add GitHub tracking later" | No. Add it now. Commands without tracking are broken commands. |
| "The epic doesn't exist yet" | Then the workflow started wrong. Brainstorm creates the epic. If there's no epic, the command can skip tracking — but log why. |
| "GitHub is optional" | GitHub tracking is optional per project (config flags). But when enabled, it is mandatory per command. |
| "The comment will be noise" | Concise summaries are not noise. Full report dumps are noise. Follow the comment format. |
