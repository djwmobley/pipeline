# Description Audit — Trigger-vs-Workflow Classification

**Date:** 2026-04-25
**Postgres task:** #51 (`Audit all command and skill descriptions for workflow-summary anti-pattern (SCOPE-ONLY, do not fix)`)
**Auditor:** Sonnet subagent dispatched from Opus orchestrator (general-purpose subagent type)
**Scope:** All `commands/*.md` and `skills/*/SKILL.md` YAML frontmatter `description:` fields
**Constraint:** READ-ONLY. No edits.

**Rationale:** Per Superpowers research (see `project_next_session_handoff.md` § "Top 3 patterns to steal"), when a `description:` field summarizes the workflow ("runs X then Y then Z"), the AI tends to read the summary, decide it knows what the skill does, and skip the skill body — it never sees the binding instructions. The fix is **trigger-only descriptions**: state *when* to invoke, not *how* the skill works. Workflow content lives only in the body.

This audit is the SCOPE-BEFORE-FIX phase. The user reviews counts and locations before any wholesale reform.

---

## Counts

**0 TRIGGER-ONLY / 40 WORKFLOW-SUMMARY / 11 MIXED (total: 51)**

The anti-pattern is universal. Zero files currently use the description field as a trigger signal; all 51 use it as a workflow summary or mixed summary+trigger.

---

## TRIGGER-ONLY

None.

---

## WORKFLOW-SUMMARY

| file | excerpt | relocate-note | high-complexity? |
|---|---|---|---|
| `commands/architect.md` | "technology decisions via recon + parallel domain specialists + synthesis" | Relocate the three-phase sequence (recon → domain specialists → synthesis) to the command body. | No |
| `commands/audit.md` | "Phase 0 grep + parallel sector agents + synthesis" | Relocate the three-phase execution sequence to the command body. | No |
| `commands/build.md` | "fresh agent per task with post-task review" | Relocate the per-task dispatch + review loop description to the command body. | No |
| `commands/chain.md` | "runs steps sequentially, honoring gates and orchestrator routing" | Relocate the sequential execution and gate-honoring procedure to the command body. | No |
| `commands/commit.md` | "Preflight gates + commit + push — reads pipeline.yml for commands and thresholds" | Relocate the three-step procedure and config-reading behavior to the command body; `pipeline.yml` path and `thresholds` key are specific values. | Yes — references `pipeline.yml` keys and numerical thresholds |
| `commands/compliance.md` | "map red team findings to regulatory controls and analyze coverage scope" | Relocate the two-step mapping + analysis procedure to the command body. | No |
| `commands/dashboard.md` | "Generate static HTML project dashboard — snapshot of phase, tasks, findings, and recommendations" | Relocate the generation procedure and output contents list to the command body. | No |
| `commands/debug.md` | "4 phases, error class routing, no speculative fixes" | Relocate the 4-phase structure and routing logic to the command body. | No |
| `commands/finish.md` | "verify tests, present options, execute choice, clean up" | Relocate the four-step completion workflow to the command body. | No |
| `commands/init.md` | "detects tools, creates .claude/pipeline.yml (use --quick for zero interaction)" | Relocate tool-detection steps, config creation, and `--quick` mode description to the command body; `--quick` flag is a hard-coded arg name. | Yes — hardcoded flag name `--quick` and output path `.claude/pipeline.yml` |
| `commands/knowledge.md` | "setup, status, search, session recording, task management" | Relocate the list of subcommands/operations to the command body. | No |
| `commands/lint-agents.md` | "runs 7 regex checks via Node script" | Relocate the check count and script-dispatch detail to the command body; `7` is a hard-coded threshold. | Yes — hard-coded numerical count `7` |
| `commands/markdown-review.md` | "file hygiene, information architecture, A2A protocol review with automated fixes" | Relocate the three-tier check list and automated-fix behavior to the command body. | No |
| `commands/plan.md` | "bite-sized tasks with build sequence" | Relocate task granularity and sequencing approach to the command body. | No |
| `commands/redteam.md` | "recon + parallel specialist agents + lead analyst synthesis" | Relocate the three-phase assessment structure to the command body. | No |
| `commands/release.md` | "Changelog generation + version bump + git tag + optional deploy trigger" | Relocate the four-step release sequence to the command body; `git tag` and `optional deploy trigger` are concrete mechanics. | Yes — references specific git operations and conditional deploy trigger |
| `commands/remediate.md` | "parse findings, create tickets, batch fixes, verify" | Relocate the four-step remediation flow to the command body. | No |
| `commands/review.md` | "evaluates code quality with severity tiers and config-driven criteria" | Relocate severity tier structure and config-driven criteria behavior to the command body. | No |
| `commands/security.md` | "red team, remediate, purple team with user gates between phases" | Relocate the three-phase loop and gate placement to the command body. | No |
| `commands/simplify.md` | "reviews specific files for SOLID violations, premature abstraction, dead code" | Relocate the target criteria list to the command body. | No |
| `commands/test.md` | "Run the project test suite and produce a structured pass/fail report" | Relocate the run-and-report procedure to the command body. | No |
| `commands/triage.md` | "Assess change size and recommend the appropriate workflow" | Relocate the two-step assess-and-recommend procedure to the command body. | No |
| `commands/ui-review.md` | "Capture a screenshot and analyze the UI — layout, hit targets, text, visual issues" | Relocate the capture-then-analyze procedure and analysis dimensions to the command body. | No |
| `commands/update.md` | "re-detect integrations, change commands, sectors, knowledge tier, or any setting" | Relocate the enumerated config-section targets to the command body. | No |
| `commands/worktree.md` | "Create an isolated git worktree for feature work" | Relocate the creation imperative to the command body; description is a single-sentence procedure. | No |
| `skills/auditing/SKILL.md` | "Phase 0 grep, N sectors, synthesis" | Relocate the phase sequence to the skill body. | No |
| `skills/building/SKILL.md` | "Subagent-driven plan execution with post-task review" | Relocate the dispatch-and-review loop description to the skill body. | No |
| `skills/checkpoints/SKILL.md` | "MUST/SHOULD/MAY classification for all pipeline decision points" | Relocate the three-tier taxonomy description to the skill body. | No |
| `skills/compliance/SKILL.md` | "map red team findings to regulatory controls and analyze coverage scope" | Relocate the mapping and analysis procedure to the skill body. | No |
| `skills/dashboard/SKILL.md` | "reads state from config, DB/files, and git, substitutes into template, writes docs/dashboard.html" | Relocate the multi-source read → substitute → write sequence to the skill body; `docs/dashboard.html` is a hardcoded output path. | Yes — hardcoded path `docs/dashboard.html` and specific data-source list |
| `skills/debugging/SKILL.md` | "4 mandatory phases, error class routing, no speculative fixes" | Relocate the 4-phase structure and routing rule to the skill body. | No |
| `skills/github-tracking/SKILL.md` | "every command that produces output must update the associated epic" | Relocate the mandatory update procedure to the skill body. | No |
| `skills/lint-agents/SKILL.md` | "7 regex checks run via Node script, no LLM dispatch" | Relocate the check count and dispatch method to the skill body; `7` is a hard-coded count. | Yes — hard-coded numerical count `7` |
| `skills/markdown-review/SKILL.md` | "file hygiene, information architecture, A2A protocol review with automated fixes" | Relocate the three-tier check list to the skill body. | No |
| `skills/planning/SKILL.md` | "bite-sized tasks, file structure, build sequence, model routing" | Relocate the four output-component descriptions to the skill body. | No |
| `skills/redteam/SKILL.md` | "recon + parallel specialist agents + lead analyst synthesis" | Relocate the three-phase assessment procedure to the skill body. | No |
| `skills/remediation/SKILL.md` | "parse findings from any pipeline workflow, create tickets, batch fixes through build/review/commit pipeline, verify with source-appropriate re-runs" | Relocate the four-step remediation flow; the sub-pipeline reference (`build/review/commit pipeline`) and "source-appropriate re-runs" are procedural context that requires careful cross-file mapping before relocation. | Yes — references sub-pipeline workflow and source-specific re-run logic |
| `skills/reviewing/SKILL.md` | "config-driven criteria, severity tiers, non-negotiable filtering" | Relocate the three review mechanism descriptions to the skill body. | No |
| `skills/tdd/SKILL.md` | "write the test first, watch it fail, write minimal code to pass" | Relocate the explicit three-step TDD sequence to the skill body. | No |
| `skills/verification/SKILL.md` | "run verification commands and confirm output before making any success claims" | Relocate the run-and-confirm procedure to the skill body. | No |

---

## MIXED

| file | excerpt | relocate-note | high-complexity? |
|---|---|---|---|
| `commands/brainstorm.md` | "Design before LARGE changes — explore context, clarify requirements, propose approaches, write spec" | Trigger element ("before LARGE changes") is correct; relocate the four-step procedure (explore → clarify → propose → write spec) to the command body. | No |
| `commands/debate.md` | "stress-test a spec with advocate, skeptic, and practitioner agents before planning" | Trigger element ("before planning") is correct; relocate the stress-test procedure naming the three agent roles to the command body. | No |
| `commands/purpleteam.md` | "verify aggregate security posture after remediation, codify defensive rules" | Trigger element ("after remediation") is correct; relocate the two-step verification + codification procedure to the command body. | No |
| `commands/qa.md` | "'plan' (pre-build) and 'verify' (post-build)" | Mode-trigger cues are correct; relocate the "test planning and verification" procedure description and mode definitions to the command body. | No |
| `skills/architecture/SKILL.md` | "Silent for MEDIUM, full orchestration for LARGE+" | Mode-trigger cues are correct; relocate the "recon + domain analysis" procedure and the silent/full-orchestration distinction to the skill body. | No |
| `skills/brainstorming/SKILL.md` | "Design before LARGE changes. Explores user intent, requirements, and design before implementation." | Trigger element ("before LARGE changes", "before implementation") is correct; relocate the exploration procedure (user intent, requirements, design) to the skill body. | No |
| `skills/debate/SKILL.md` | "stress-test a spec with advocate, skeptic, and practitioner agents before planning" | Trigger element ("before planning") is correct; relocate the stress-test procedure naming agent roles to the skill body. | No |
| `skills/init-azure-devops/SKILL.md` | "Dispatched as a subagent via the Task tool when the git remote resolves to dev.azure.com or *.visualstudio.com. Runs scripts/pipeline-init-azure-devops.js, interprets az CLI errors…" | Trigger condition ("when git remote resolves to dev.azure.com / *.visualstudio.com") is correct; relocate script name, az CLI error-interpretation reference, and JSON return-format description to the skill body. The trigger itself names a specific domain pattern that must stay accurate cross-file. | Yes — hardcoded script name `pipeline-init-azure-devops.js`, domain patterns `dev.azure.com`/`*.visualstudio.com`, config path `pipeline.yml platform block`, and dispatch mechanism |
| `skills/orientation/SKILL.md` | "assert cwd, branch, HEAD, worktree identity, and dirty flag before any other step" | Trigger element ("for every phase command") is correct; relocate the five specific assertion targets and the "before any other step" ordering constraint to the skill body. | No |
| `skills/purpleteam/SKILL.md` | "verify remediation closed attack vectors, validate exploit chains broken, codify defensive rules" | Implicit trigger ("after remediation") is present but not stated explicitly; relocate the three-step procedure (verify → validate → codify) to the skill body. | No |
| `skills/qa/SKILL.md` | "Inline QA section for MEDIUM, full test plan + parallel workers for LARGE+" | Mode-trigger cues are correct; relocate the inline-vs-standalone distinction and "parallel workers" dispatch detail to the skill body. | No |

---

## Cross-Cutting Observations

- **Zero files are TRIGGER-ONLY.** The description field is uniformly used as a summary of what the file does rather than as a signal to the picker about when to invoke it. The anti-pattern is effectively universal.
- **Commands and skills mirror each other almost perfectly.** Paired files like `commands/audit.md` / `skills/auditing/SKILL.md` and `commands/debug.md` / `skills/debugging/SKILL.md` carry nearly identical WORKFLOW-SUMMARY descriptions, suggesting a shared authoring template that hard-wires the anti-pattern in both layers simultaneously.
- **MIXED files all have a valid trigger seed.** Every MIXED description contains at least one salvageable trigger clause ("before planning", "after remediation", "for MEDIUM/LARGE+", "when git remote resolves to…") that could anchor a TRIGGER-ONLY rewrite without information loss.
- **The phase-sequence formula ("X + Y + Z") is the dominant anti-pattern.** At least 14 descriptions use an additive noun-chain (e.g., "recon + parallel specialist agents + synthesis", "parse findings, create tickets, batch fixes, verify") that encodes the execution procedure in the description, making it a skimmable checklist.
- **Complexity is concentrated in a small subset.** Six files (marked Yes) contain hard-coded specifics — numerical thresholds, file paths, script names, domain patterns, flag names — that require cross-file consistency checks before safe relocation. The remaining 45 non-complex files share a uniform anti-pattern with no inter-file dependency risk in the description itself.
- **skills/init-azure-devops/SKILL.md is an outlier in description length and density.** Its description spans four sentences and encodes dispatch mechanics, script identity, error-interpretation location, and return-contract shape — far more state-machine content than any other file, making it the highest-complexity individual reform target.

---

## High-Complexity Flags

- `commands/commit.md` — description references `pipeline.yml` key names and numerical thresholds; relocating without breaking cross-file references to those specific keys requires coordinated edits.
- `commands/init.md` — description names the `--quick` flag and the output path `.claude/pipeline.yml`; both are referenced in user-facing documentation and other commands.
- `commands/lint-agents.md` — description encodes the hard-coded check count `7`; if the script adds or removes checks, the description and the script diverge silently.
- `commands/release.md` — description names concrete git operations (`git tag`) and a conditional deploy trigger; these are mechanics that belong in the body but are also surfaced in onboarding docs.
- `skills/dashboard/SKILL.md` — description encodes the specific output path `docs/dashboard.html`; this path is referenced by other commands that read the dashboard after generation.
- `skills/init-azure-devops/SKILL.md` — description contains the script filename `pipeline-init-azure-devops.js`, two domain-match patterns (`dev.azure.com`, `*.visualstudio.com`), the dispatch mechanism (Task tool), and the return-contract shape (`pipeline.yml platform block`); reforming this description without breaking the parent `init.md` dispatch logic requires coordinated cross-file edits.
- `skills/lint-agents/SKILL.md` — mirrors `commands/lint-agents.md`; both encode the count `7` and must be updated atomically if the Node script changes.
- `skills/remediation/SKILL.md` — description references the internal sub-pipeline `build/review/commit pipeline` and "source-appropriate re-runs"; these are architectural contracts that, if relocated carelessly, could cause agents to miss the cross-skill dependency.
