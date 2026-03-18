---
allowed-tools: Read(*), Glob(*), Grep(*), Task(*), Bash(*)
description: Full codebase review — Phase 0 grep + parallel sector agents + synthesis. READ-ONLY.
---

## Pipeline Audit

Full codebase review with parallel sector agents. This is READ-ONLY — no code is modified.

Read the skill file at `skills/auditing/SKILL.md` from the pipeline plugin directory.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
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

If option 1: scan top-level directories under `routing.source_dirs`, create one sector per directory, show the proposed sectors, and confirm before proceeding. Save to `review.sectors` in config.
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

Send a single message with N Task tool calls (one per sector from `review.sectors`).

Each agent receives:
1. Preamble with project context and non-negotiable decisions
2. Review criteria from config
3. Phase 0 grep hits relevant to that sector's files
4. Two-pass read protocol
5. Structured output format (FINDING [SECTOR]-[NNN] | severity | file:line | category)
6. Cross-Reference Manifest template
7. Specific file assignments from sector definition

---

### Step 4 — Collect all reports

Wait for all sector agents to complete.

---

### Step 5 — Launch synthesis agent

Pass all sector reports to a synthesis agent that performs:
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
- No files are written or edited
- No git operations
- No automated fixes

End with: "Review complete. N findings (M 🔴 / P 🟡 / Q 🔵) across [sector count] sectors.
Review each section above and tell me which issues to address first."

If synthesis produced a Simplify candidates block, display it after the verdict.
