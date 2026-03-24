---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: Full markdown health check — file hygiene, information architecture, A2A protocol review with automated fixes
---

## Pipeline Markdown Review

Full markdown health check with automated fixes. Scans plugin instruction files and user-generated markdown for hygiene issues, information architecture problems, and A2A protocol violations.

Locate and read the markdown review skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/markdown-review/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/markdown-review/SKILL.md` to find it

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root.

If no config file exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

Extract:
- `markdown_review.line_limit`, `markdown_review.fix_mode`, `markdown_review.tiers`, `markdown_review.exclude`, `markdown_review.inline_checklist`
- `models.cheap`, `models.architecture`, `models.implement`
- `knowledge.tier`
- `integrations.github.enabled`
- `dashboard.enabled`

Build two file lists:

**Plugin files** (always scanned):
```bash
find commands/ skills/ templates/ docs/ -name "*.md" -o -name "*.yml" 2>/dev/null
```
Plus root files: `README.md`, `CLAUDE.md`

**User-generated files** (also scanned):
```bash
ls docs/findings/*.md docs/sessions/*.md DECISIONS.md docs/gotchas.md .claude/pipeline.yml 2>/dev/null
```

Apply `markdown_review.exclude` glob patterns to filter both lists. Collect line counts:
```bash
wc -l [all files from both lists]
```

Present scope summary:
```
## Markdown Review

**Scope:** [N] plugin files ([P] commands, [S] skills, [T] templates, [R] reference) + [M] user files + [D] docs ([total] lines)
**Tiers:** HYG on all, ARCH on plugin files, A2A on prompt templates only
**Line limit:** [markdown_review.line_limit]
**Fix mode:** [markdown_review.fix_mode]

Proceed with markdown review? (Y/n)
```

If user declines, stop.

---

### Step 1 — Scanner (haiku)

Read the scanner prompt template:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/markdown-review/scanner-prompt.md`
2. Otherwise: use Glob `**/pipeline/skills/markdown-review/scanner-prompt.md`

Complete the substitution checklist:
1. `{{MODEL}}` → value of `models.cheap` (e.g., `haiku`)
2. `[FILE_LIST]` → combined file inventory with line counts from Step 0
3. `[LINE_LIMIT]` → `markdown_review.line_limit`
4. `[KNOWLEDGE_TIER]` → `knowledge.tier`

Dispatch the scanner as a single Agent tool call with model `{{MODEL}}` and the fully substituted prompt. Capture structured output (MANIFEST, XREF, PLACEHOLDER, DUPLICATE, CONFIG_KEY, OUTPUT_CONTRACT lines).

---

### Step 2 — Analyst (opus)

Read the analyst prompt template:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/markdown-review/analyst-prompt.md`
2. Otherwise: use Glob `**/pipeline/skills/markdown-review/analyst-prompt.md`

Complete the substitution checklist:
1. `{{MODEL}}` → value of `models.architecture` (e.g., `opus`)
2. `[SCANNER_MANIFEST]` → full scanner output from Step 1
3. `[KNOWLEDGE_TIER]` → `knowledge.tier`
4. `[TIERS_TO_RUN]` → `markdown_review.tiers` joined as comma-separated string
5. `[LINE_LIMIT]` → `markdown_review.line_limit`

Dispatch the analyst as a single Agent tool call with model `{{MODEL}}` and the fully substituted prompt. Capture all FINDING blocks; parse each for: finding ID, severity, confidence, effort. Count totals by severity and effort tier. LOW confidence findings will be presented separately for user review.

---

### Step 3 — Present findings

Group by tier (HYG, ARCH, A2A), sort by severity within each tier. Separate HIGH/MEDIUM confidence findings from LOW confidence findings. Present:
```
## Markdown Review Findings

**Total:** [N] findings ([H] HIGH / [M] MEDIUM / [L] LOW)
**Effort:** [Q] quick wins, [E] medium, [A] architectural (report only)

### Findings (HIGH/MEDIUM confidence)

#### Tier 1: File Hygiene (MR-HYG)
[findings or "No findings"]

#### Tier 2: Information Architecture (MR-ARCH)
[findings or "No findings"]

#### Tier 3: A2A Protocol (MR-A2A)
[findings or "No findings"]

### For Your Review (LOW confidence)
[findings the analyst flagged but isn't certain about — verify before fixing]
```

If `fix_mode` is `"auto"`: skip to option a. If `"report"`: skip to option d. Otherwise present:

```
How would you like to proceed?
a) Fix all HIGH + MEDIUM findings automatically
b) Fix HIGH findings only
c) Review individually (present each fix before applying)
d) Save report only (no fixes)
```

---

### Step 4 — Fix (sonnet)

Skip if option d was selected or no fixable findings exist.

Split approved findings into effort batches: **quick** first, then **medium**. Architectural findings are never auto-fixed — report only.

For each batch, read the fixer prompt template:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/markdown-review/fixer-prompt.md`
2. Otherwise: use Glob `**/pipeline/skills/markdown-review/fixer-prompt.md`

Complete the substitution checklist:
1. `{{MODEL}}` → value of `models.implement` (e.g., `sonnet`)
2. `[FINDINGS_BATCH]` → all findings in this effort batch
3. `[FILES_TO_MODIFY]` → comma-separated file paths from this batch

Dispatch the fixer as an Agent tool call with model `{{MODEL}}` and the fully substituted prompt. Collect FIXED/SKIPPED/VERIFY lines and present a summary after each batch.

If option c was selected: present each finding individually and wait for approval before dispatching.

---

### Step 5 — Commit

If fixes were applied, stage all modified files and commit. Use the co-author from `commit.co_author` config. Create one commit per effort batch:
- `docs(markdown-review): fix [N] quick wins — [summary]`
- `docs(markdown-review): fix [N] medium findings — [summary]`

---

### Step 5b — Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

For each HIGH or MEDIUM finding:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update finding new "$(cat <<'EOF'
{"id":"[MR-XXX-NNN]","source":"markdown-review","severity":"[high|medium|low]","confidence":"[HIGH|MEDIUM|LOW]","location":"[file:line]","category":"[HYG|ARCH|A2A]","description":"[one-line description]","impact":"[effect on agent behavior or maintainability]","remediation":"[fix description]","effort":"[quick|medium|architectural]"}
EOF
)"
```

Record the review outcome:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'markdown-review' "$(cat <<'SUMMARY'
MR [date]: [N] findings ([H] HIGH / [M] MEDIUM / [L] LOW). Fixed: [F]
SUMMARY
)" "$(cat <<'DETAIL'
Scope: [N] files ([total] lines). Tiers: [tiers]. [remaining] architectural findings unfixed.
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:** No writes — findings already saved to `docs/findings/markdown-review-*.md` in Step 7.

---

### Step 6 — Dashboard regeneration

If `dashboard.enabled` is true (or `docs/dashboard.html` already exists): locate the dashboard skill (`$PIPELINE_DIR/skills/dashboard/SKILL.md` or Glob `**/pipeline/skills/dashboard/SKILL.md`) and follow it to regenerate `docs/dashboard.html`.

---

### Step 7 — Report

Always save the full findings report regardless of fix mode. Run `mkdir -p docs/findings` then write to `docs/findings/markdown-review-YYYY-MM-DD.md`:

```markdown
# Markdown Review — [date]

**Source:** markdown-review
**Scope:** [N] files ([total] lines)
**Tiers:** [tiers run]
**Finding count:** [total] ([H] HIGH / [M] MEDIUM / [L] LOW)

## Tier 1: File Hygiene
[all MR-HYG findings with full DESCRIPTION and FIX]

## Tier 2: Information Architecture
[all MR-ARCH findings with full DESCRIPTION and FIX]

## Tier 3: A2A Protocol
[all MR-A2A findings with full DESCRIPTION and FIX]

## Fix Summary
[N] findings fixed, [M] skipped, [K] architectural (report only)
```

Present final summary:
```
## Markdown Review Complete

**Findings:** [total] ([H] HIGH / [M] MEDIUM / [L] LOW)
**Fixed:** [N] findings
**Remaining:** [M] (architectural — requires manual design decisions)
**Report:** docs/findings/markdown-review-YYYY-MM-DD.md

What next?
a) Push changes
b) Review architectural findings
c) Leave as-is
```
