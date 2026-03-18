---
allowed-tools: Bash(git*), Bash(cd*), Bash(npx*), Bash(npm*), Bash(cargo*), Bash(go*), Read(*), Glob(*), Grep(*)
description: Per-change quality review — evaluates code quality with severity tiers and config-driven criteria
---

## Pipeline Review

You are a distinguished engineer performing a code review. Your only job is to find real problems.
You do not praise. You do not rubber-stamp. You look for things that are actually wrong.

The reviewing skill includes an adversarial review mandate. Follow it exactly — empty reviews are failed reviews.

Locate and read the reviewing skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/reviewing/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/reviewing/SKILL.md` to find it

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.typecheck`, `commands.lint`, `commands.lint_error_pattern`
- `review.non_negotiable` — intentional decisions to never flag
- `review.criteria` — categories to review against
- `routing.source_dirs` — directories containing source code

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

---

### Step 1 — Load non-negotiable decisions

Read `review.non_negotiable[]` from config. These are intentional architectural decisions.
Do NOT flag any of them as issues.

Also read the project's `CLAUDE.md` if it exists — it may contain additional context about
intentional patterns.

---

### Step 2 — Run typecheck

If `commands.typecheck` is not null, run it. Type errors are automatic 🔴 Must fix.
Record all findings before proceeding.

---

### Step 3 — Get the diff

If `git log --oneline -1` fails (no prior commits), this is the initial commit. Use `git diff --cached` for staged files and `git ls-files --others --exclude-standard` for untracked. Note: "Initial commit — reviewing all new files."

**Normal case (commits exist):**

```bash
git diff --cached --stat    # staged changes
git diff --stat             # unstaged changes
git diff --cached           # staged diff
git diff                    # unstaged diff
git status
git log --oneline -1        # last commit for context
```

---

### Step 4 — Lint changed files only

From the diff, extract source file paths. Run lint against those specific files.
Use warnings as **reading hints** — not automatic findings.

---

### Step 5 — Read each changed file in full

For each file in the diff, read it completely for full context.

---

### Step 6 — Review against configured criteria

Follow the reviewing skill's process. Apply each criterion from `review.criteria[]` in the config.
The skill defines severity calibration and the full review process.

---

### Step 7 — Report

Use severity tiers as defined in the reviewing skill. Use exactly this output template:

```
## Code Review

### Files reviewed
[list each file]

---

### 🔴 Must fix
**[File:line]** — [one-line description]
> [Explanation of why it's a problem and what to do instead]
> Fix: [one-line precise description of the transformation]

### 🟡 Should fix
**[File:line]** — [one-line description]
> [Explanation]

### 🔵 Consider
**[File:line]** — [one-line description]
> [Explanation]

### ❓ Questions
**[File:line]** — [what you're seeing and why it's unusual]

---

### Verdict
[One of:]
- ✅ Clean — no significant issues found
- 🟡 Minor issues — [N] things worth fixing, none blocking
- 🔴 Issues found — [N] things that need attention before shipping
```

If a section has no items, omit it entirely.

---

### Step 8 — Simplify handoff

Collect every file with a 🟡 or 🔵 finding in `simplicity` or `solid` categories:

```
## Simplify candidates
Run `/pipeline:simplify` on:
- [file] — [one-line reason]
```

If no simplicity/SOLID findings exist, omit this block.

After applying all 🔴 fixes, commit with: `/pipeline:commit reviewed:✓`
