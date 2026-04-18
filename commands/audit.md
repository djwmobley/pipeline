---
allowed-tools: Read(*), Glob(*), Grep(*), Task(*), Bash(*)
description: Full codebase review — Phase 0 grep + parallel sector agents + synthesis. READ-ONLY.
---

## Pipeline Audit

Full codebase review with parallel sector agents. This is READ-ONLY — no code is modified.

### Preflight — Orientation check

<!-- checkpoint:MUST orientation -->

Before any other step — including reading any skill file — locate the
orientation skill (read `$PIPELINE_DIR/skills/orientation/SKILL.md` if
`$PIPELINE_DIR` is set, otherwise Glob `**/pipeline/skills/orientation/SKILL.md`)
and execute its preflight. State the six context values (cwd, repo root, branch,
HEAD, worktree, dirty count) in prose and confirm they match this command's
intent. Do not continue until done.

---

Locate and read the auditing skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/auditing/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/auditing/SKILL.md` to find it

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root.

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

Extract:
- `review.phase0_patterns` — grep patterns for Phase 0
- `review.sectors` — sector definitions (name, id, paths)
- `review.criteria` — review criteria for all sectors
- `review.non_negotiable` — intentional decisions to never flag
- `routing.source_dirs` — source directories

**source_dirs validation:**
1. If `routing.source_dirs` contains `["."]`, warn: "source_dirs is set to [\".\"] which will scan ALL files including config, docs, and lockfiles. Run `/pipeline:update` to set a specific source directory before running a full audit." Then filter Phase 0 grep and sector scans to common source extensions only (.ts, .tsx, .js, .jsx, .rs, .go, .py).
2. **Shell safety:** Validate each entry matches `[a-zA-Z0-9/_.-]+` only. If any entry contains shell metacharacters (`$`, `` ` ``, `(`, `)`, `;`, `|`, `&`, `!`, `"`, `'`, `\`, `{`, `}`), reject it and stop.

If `review.sectors` is empty:

> "No review sectors configured yet. Sectors split the codebase into parallel review zones — each gets its own reviewer agent, then findings are synthesized across sectors. This is what makes a full codebase review practical.
>
> Options:
> 1. **Quick setup** — auto-generate from your directory structure (recommended)
> 2. **Run `/pipeline:update sectors`** — guided setup with profile-based recommendations
> 3. **Flat review** — skip sectors, review everything in one pass (slower, less thorough)"

If option 1: scan top-level directories under `routing.source_dirs`, create one sector per directory, show the proposed sectors, and confirm before proceeding. Save to `review.sectors` in pipeline.yml so future audits reuse them. (This is the ONE exception to the read-only rule — config setup only, no source code changes.)
If option 3: proceed with a single flat review (no parallel agents).

---

### Step 1 — Phase 0: Grep preprocessing

Run all `review.phase0_patterns` IN PARALLEL across all `routing.source_dirs`.
For each pattern, capture file:line matches. Filter results by sector.

Include relevant hits in each sector agent's prompt.

---

### Step 2 — Load constraints

Read project CLAUDE.md and `review.non_negotiable` from config.
These decisions are intentional and must NOT be flagged by sector agents.

---

### Step 3 — Launch N sector agents IN PARALLEL

Read the sector agent prompt template from the same directory as the SKILL.md loaded earlier (`sector-agent-prompt.md`). For each sector, construct a Task tool call by:

1. Completing the **substitution checklist** at the top of the template — replace `{{MODEL}}` with the value of `models.review` from pipeline.yml, and fill all `[PLACEHOLDER]` values with actual data
2. Including: preamble with project context, non-negotiable decisions, review criteria, Phase 0 grep hits for that sector's files, two-pass read protocol, structured output format, Cross-Reference Manifest template, and specific file assignments

Send a single message with N Task tool calls (one per sector from `review.sectors`).

---

### Step 4 — Collect all reports

Wait for all sector agents to complete.

---

### Step 5 — Launch synthesis agent

Read the synthesis agent prompt template (`synthesis-agent-prompt.md` from the same directory as the SKILL.md). Complete its substitution checklist, paste all sector reports into the prompt, and dispatch.

The synthesis agent performs:
1. Cross-sector crash path tracing
2. Dead export verification
3. Cross-sector duplication detection
4. Severity escalation
5. Deduplication
6. Simplify candidate collection

---

### Step 6 — Present unified report

Output the full unified report. **Stop here. Do not fix anything.**

This command is read-only by design:
- No source files are written or edited (exception: first-run sector config setup in Step 0)
- No git operations
- No automated fixes

End with: "Review complete. N findings (M 🔴 / P 🟡 / Q 🔵) across [sector count] sectors — H HIGH confidence, L MEDIUM, K LOW.
Review each section above and tell me which issues to address first."

LOW confidence findings from sector agents that are not corroborated by another sector or by Phase 0 grep hits SHOULD be downgraded or noted as uncertain in the synthesis.

If synthesis produced a Simplify candidates block, display it after the verdict.

---

### Step 6b — Persist findings

If findings were reported (not a clean audit), write the full synthesis report to `docs/findings/audit-YYYY-MM-DD.md` with a header:

```bash
mkdir -p docs/findings
```

```markdown
# Audit Findings — [date]

**Source:** audit
**Sectors:** [list of sector names]
**Finding count:** [N] ([M] 🔴 / [P] 🟡 / [Q] 🔵)

[full synthesis report content — all FINDING lines and descriptions as output in Step 6]
```

Then inform user: "Findings saved to `docs/findings/audit-YYYY-MM-DD.md`. Run `/pipeline:remediate --source audit` to batch-fix."

---

### Step 6c — Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

For each 🔴 or 🟡 finding from the synthesis report:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update finding new "$(cat <<'EOF'
{"id":"[FINDING_ID]","source":"audit","severity":"[high|medium]","confidence":"[HIGH|MEDIUM|LOW]","location":"[file:line]","category":"[sector/criterion]","description":"[one-line description]","impact":"[why it matters]","remediation":"[fix description]","effort":"[quick|medium|large]"}
EOF
)"
```

Record the audit verdict:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'full-audit' "$(cat <<'SUMMARY'
Audit [date]: [N] findings ([M] 🔴 / [P] 🟡 / [Q] 🔵) across [sector_count] sectors
SUMMARY
)" "$(cat <<'DETAIL'
[1-sentence posture summary]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:**

Record the audit verdict (significant enough for the active working set):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js decision 'full-audit' "$(cat <<'SUMMARY'
Audit [date]: [N] findings across [sector_count] sectors
SUMMARY
)" "$(cat <<'DETAIL'
[1-sentence posture summary]
DETAIL
)"
```

Prune stale decisions:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js prune
```

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.
