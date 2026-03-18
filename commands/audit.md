---
allowed-tools: Read(*), Glob(*), Grep(*), Task(*), Bash(*)
description: Full codebase review — Phase 0 grep + parallel sector agents + synthesis. READ-ONLY.
---

## Pipeline Audit

Full codebase review with parallel sector agents. This is READ-ONLY — no code is modified.

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

After fixing all 🔴 findings: `/pipeline:commit reviewed:✓`
