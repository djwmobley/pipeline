# Review Skill v2 — Exhaustive Agent Audit

**Created:** 2026-03-27
**Status:** Pending
**Trigger:** Review skill was upgraded with Branch/Boundary Analysis, Intra-File Contract Verification, and always-on Big 4 dimensions. All agent prompts need review against the new checks.

## What to Check

The new review sections target three classes of issues:

1. **Branch/Boundary Condition Analysis** — conditionals with unhandled states (equality traps, optional chaining gaps, initialization assumptions)
2. **Intra-File Contract Verification** — comments/JSDoc that don't match code behavior
3. **Always-on Big 4** — Functionality correctness that was previously shadowed by config criteria

For markdown agent prompts, translate these to:
- **Substitution checklists** that don't match actual placeholder usage in the prompt body
- **Behavioral claims** in instructions that contradict what the prompt actually asks the agent to do
- **Fallback paths** that are documented for one store but missing for another
- **Reporting contracts** that diverge from the parent SKILL.md

## Files to Audit

Run `/pipeline:review` on each batch. Suggested batches of 5-6 files to stay within token budget.

### Batch 1 — Building + Reviewing (already partially reviewed)
- [ ] skills/building/SKILL.md
- [ ] skills/building/implementer-prompt.md
- [ ] skills/building/reviewer-prompt.md
- [ ] skills/reviewing/SKILL.md (just updated — verify self-consistency)

### Batch 2 — QA + Remediation
- [ ] skills/qa/SKILL.md
- [ ] skills/qa/planner-prompt.md
- [ ] skills/qa/worker-prompt.md
- [ ] skills/qa/verifier-prompt.md
- [ ] skills/remediation/SKILL.md
- [ ] skills/remediation/fix-planner-prompt.md
- [ ] skills/remediation/triage-prompt.md

### Batch 3 — Red Team + Purple Team
- [ ] skills/redteam/SKILL.md
- [ ] skills/redteam/recon-agent-prompt.md
- [ ] skills/redteam/specialist-agent-prompt.md
- [ ] skills/redteam/lead-analyst-prompt.md
- [ ] skills/redteam/html-report-prompt.md
- [ ] skills/purpleteam/SKILL.md
- [ ] skills/purpleteam/verifier-prompt.md
- [ ] skills/purpleteam/chain-analyst-prompt.md
- [ ] skills/purpleteam/posture-analyst-prompt.md

### Batch 4 — Planning + Architecture + Debate
- [ ] skills/planning/SKILL.md
- [ ] skills/planning/plan-reviewer-prompt.md
- [ ] skills/architecture/SKILL.md
- [ ] skills/architecture/lead-architect-prompt.md
- [ ] skills/architecture/recon-agent-prompt.md
- [ ] skills/architecture/specialist-agent-prompt.md
- [ ] skills/debate/SKILL.md
- [ ] skills/debate/advocate-prompt.md
- [ ] skills/debate/practitioner-prompt.md
- [ ] skills/debate/skeptic-prompt.md

### Batch 5 — Auditing + Compliance + Markdown Review
- [ ] skills/auditing/SKILL.md
- [ ] skills/auditing/sector-agent-prompt.md
- [ ] skills/auditing/synthesis-agent-prompt.md
- [ ] skills/compliance/SKILL.md
- [ ] skills/compliance/framework-agent-prompt.md
- [ ] skills/compliance/html-report-prompt.md
- [ ] skills/compliance/synthesis-prompt.md
- [ ] skills/markdown-review/SKILL.md
- [ ] skills/markdown-review/analyst-prompt.md
- [ ] skills/markdown-review/fixer-prompt.md
- [ ] skills/markdown-review/scanner-prompt.md

### Batch 6 — Support Skills + Dashboard
- [ ] skills/brainstorming/SKILL.md
- [ ] skills/brainstorming/researcher-prompt.md
- [ ] skills/brainstorming/spec-reviewer-prompt.md
- [ ] skills/dashboard/SKILL.md
- [ ] skills/dashboard/recommendations-prompt.md
- [ ] skills/debugging/SKILL.md
- [ ] skills/verification/SKILL.md
- [ ] skills/tdd/SKILL.md
- [ ] skills/checkpoints/SKILL.md
- [ ] skills/lint-agents/SKILL.md
- [ ] skills/github-tracking/SKILL.md
