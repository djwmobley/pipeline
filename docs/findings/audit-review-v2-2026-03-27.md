# Review Skill v2 — Exhaustive Agent Audit

**Created:** 2026-03-27
**Status:** Complete (all 6 batches audited)
**Trigger:** Review skill was upgraded with Branch/Boundary Analysis, Intra-File Contract Verification, and always-on Big 4 dimensions. All agent prompts reviewed against the new checks.

## Results Summary

**128 raw findings → 123 after false-positive filtering**

| Severity | Count | Notes |
|----------|-------|-------|
| 🔴 Must fix | 14 | Structural defects, broken checklists, missing persistence |
| 🟡 Should fix | 58 | Contract mismatches, missing fallbacks, inconsistencies |
| 🔵 Consider | 51 | Low-risk improvements, cosmetic, awareness items |

### False Positives Removed (5)

`[GITHUB_REPO]`/`[GITHUB_ISSUE]` absent from synthesis agent checklists was flagged in:
- redteam/lead-analyst-prompt.md
- redteam/html-report-prompt.md
- purpleteam/verifier-prompt.md
- purpleteam/chain-analyst-prompt.md
- purpleteam/posture-analyst-prompt.md

**These are correct by design.** Synthesis agents delegate store writes to the orchestrating command via `platform.js`. They produce structured output that the command persists. The platform abstraction layer (commit c2c6c39) handles GitHub/Azure DevOps/future trackers — agents that don't write to issue trackers correctly omit tracker-specific placeholders.

---

## 🔴 Must-Fix Items (14)

### Batch 1 — Building + Reviewing

| # | File | Finding |
|---|------|---------|
| 1 | building/implementer-prompt.md | Dangling `## Finding Context` section reference — checklist says "remove the section" but the section doesn't exist in the template |
| 2 | reviewing/SKILL.md | Mixed path resolution in Reporting Contract: Postgres uses `$PROJECT_ROOT/scripts/`, GitHub comment uses `[SCRIPTS_DIR]` — two conventions in one file |
| 3 | reviewing/SKILL.md | `static_analysis.semgrep.enabled` undefined/missing key falls through all branches silently |

### Batch 2 — QA + Remediation

| # | File | Finding |
|---|------|---------|
| 4 | qa/verifier-prompt.md | Zero persistence — no Reporting Contract. Verdict lost on orchestrator crash |
| 5 | qa/verifier-prompt.md | Missing `[SCRIPTS_DIR]`, `[GITHUB_REPO]`, `[GITHUB_ISSUE]` from substitution checklist |

### Batch 3 — Red Team + Purple Team

| # | File | Finding |
|---|------|---------|
| 6 | redteam/recon-agent-prompt.md | `[DIFF_FILES]` used as string comparison sentinel — fragile for multi-line input |
| 7 | redteam/recon-agent-prompt.md | SBOM phase: no branch for enabled + lockfile absent + manifest absent |
| 8 | redteam/specialist-agent-prompt.md | `[SECURITY_CHECKLIST]` empty/silent for COMPLIANCE domain — no fallback |
| 9 | redteam/lead-analyst-prompt.md | No Reporting Contract — verdict lost on orchestrator crash |
| 10 | redteam/html-report-prompt.md | No Reporting Contract — no completion signal to any store |

### Batch 4 — Planning + Architecture + Debate

| # | File | Finding |
|---|------|---------|
| 11 | planning/plan-reviewer-prompt.md | Code fence defect — DATA tags for plan/spec content fall outside the agent prompt block. Injected content not delivered under prompt-injection protection |

### Batch 5 — Auditing + Compliance + Markdown Review

| # | File | Finding |
|---|------|---------|
| 12 | auditing/sector-agent-prompt.md | `[ID]` and `[Name]` in task description line not in substitution checklist — orchestrator leaves them unreplaced |

### Batch 6 — Support Skills + Dashboard

| # | File | Finding |
|---|------|---------|
| 13 | brainstorming/spec-reviewer-prompt.md | `[PASTE FULL SPEC CONTENT HERE]` not in substitution checklist — agent dispatched with placeholder unfilled |
| 14 | dashboard/SKILL.md | `ls -t [docs.specs_dir]*.md` fails silently without trailing slash — causes false "Not Started" phase status |

---

## Systemic Patterns (🟡 cross-cutting)

### 1. Missing Reporting Contract (~12 agents)
Synthesis/presentation agents delegate all persistence to the orchestrating command. If the command crashes after receiving output but before writing stores, work is unrecoverable.

**Affected:** lead-analyst, html-report, chain-analyst, posture-analyst, qa/verifier, sector-agent, synthesis-agent, framework-agent, compliance html/synthesis, analyst, fixer

**Fix approach:** Add a minimal crash-recovery signal — even a build-state write with status/timestamp — so the orchestrator can detect "agent completed but stores not updated" on resume.

### 2. Missing ANTI-RATIONALIZATION block (5 agents)
Synthesis agents making consequential verdicts have no rationalization guard.

**Affected:** chain-analyst, posture-analyst, html-report, framework-agent, compliance/synthesis-agent

### 3. Path resolution inconsistency (4 SKILL.md files)
Mixed use of `$PROJECT_ROOT/scripts/`, `[SCRIPTS_DIR]`, and `[scripts_dir]` across different skills.

**Affected:** reviewing/SKILL.md, remediation/SKILL.md, qa/SKILL.md, architecture/SKILL.md

**Fix approach:** Standardize on `[SCRIPTS_DIR]` for all dispatched prompts; `$PROJECT_ROOT/scripts/` only in SKILL.md orchestrator-level pseudocode (and document this convention).

### 4. No GitHub/issue-tracker tracking contract in SKILL.md (3 skills)
Skills define Postgres persistence but omit platform.js issue comment instructions.

**Affected:** architecture/SKILL.md, planning/SKILL.md, debate/SKILL.md

### 5. SKILL.md runtime placeholder lists incomplete vs child prompt checklists (2 files)
Parent SKILL.md declares fewer placeholders than child prompts actually use.

**Affected:** building/SKILL.md (missing 4: `{{MODEL}}`, `{{TDD_SECTION}}`, `{{FRAMEWORK}}`, `{{TICKET_CONTEXT}}`), remediation/SKILL.md

### 6. Config values outside DATA tags (3 files)
`[PROJECT_NAME]` is user-derived and appears as bare inline substitution.

**Affected:** compliance/synthesis-prompt.md, compliance/html-report-prompt.md, architecture/lead-architect-prompt.md

---

## Batch Checklist

- [x] Batch 1 — Building + Reviewing (4 files) — 13 findings
- [x] Batch 2 — QA + Remediation (7 files) — 15 findings
- [x] Batch 3 — Red Team + Purple Team (9 files) — 28 findings
- [x] Batch 4 — Planning + Architecture + Debate (10 files) — 25 findings
- [x] Batch 5 — Auditing + Compliance + Markdown Review (11 files) — 24 findings
- [x] Batch 6 — Support Skills + Dashboard (11 files) — 23 findings

---

## Fix Priority

**Phase 1 — Structural defects (runtime failures):**
Items 11, 12, 13, 14 — broken code fences, missing checklist items, silent path failures

**Phase 2 — Persistence gaps (data loss on crash):**
Items 4, 5, 9, 10 + systemic pattern #1 — add minimal crash-recovery signals

**Phase 3 — Contract consistency:**
Items 1, 2, 3, 6, 7, 8 + systemic patterns #3, #5 — fix dangling refs, path conventions, placeholder lists

**Phase 4 — Hardening:**
Systemic patterns #2, #4, #6 — add ANTI-RATIONALIZATION blocks, tracking contracts, DATA tags
