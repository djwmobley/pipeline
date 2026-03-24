---
name: purpleteam
description: Aggregate security verification — verify remediation closed attack vectors, validate exploit chains broken, codify defensive rules
---

# Purple Team Security Verification

## Overview

Purple team bridges per-finding remediation verification and aggregate security posture assessment. Remediate verifies each fix in isolation via specialist-rerun. Purple team verifies the collective result: are exploit chains broken? Did fixing one issue reopen another? What defensive patterns emerged?

**Core principle:** Verify the aggregate, not just the parts.

**Read-only assessment.** No source code is modified. Findings and defensive rules persist to knowledge tier.

## The Process

```
Config load ──────────────────────────────────────────────────────────────┐
                                                                          │
Collect context (reports + issues) ──────────────────────────────────────▶┤
                                                                          │
                                                                          ▼
                                              Verify findings (sonnet, parallel)
                                                                          │
                                                                          ▼
                                                           Dependency audit (orchestrator)
                                                                          │
                                                                          ▼
                                               Verify chains (opus, single agent)
                                                                          │
                                                                          ▼
                                         Posture assessment (opus, single agent)
                                                                          │
                                                             ┌────────────┘
                                                             ▼
                                                   Persist results to knowledge tier
                                                             │
                                                             ▼
                                                     Dashboard regen
```

## Verification Verdicts (Per Finding)

| Verdict | Meaning |
|---------|---------|
| **VERIFIED** | Attack vector confirmed closed; evidence provided; defensive rule extracted |
| **REGRESSION** | Fix introduced a new vulnerability or reopened a related vector |
| **INCOMPLETE** | Code changed but exploitation scenario is still viable |

## Chain Verdicts

| Verdict | Meaning |
|---------|---------|
| **CHAIN_BROKEN** | At least one link verified-fixed; no alternative paths exist |
| **CHAIN_WEAKENED** | Some links fixed but alternative paths remain |
| **CHAIN_INTACT** | No links in the chain were successfully fixed |

## Posture Ratings

| Rating | Criteria |
|--------|----------|
| **HARDENED** | All critical/high verified, all chains broken, defensive rules codified |
| **IMPROVED** | Most critical/high verified, chains broken or weakened |
| **PARTIAL** | Mixed results, some chains intact |
| **UNCHANGED** | Majority incomplete or regressed |

## Dependency Audit

After per-finding verification, run the command specified by `commands.security_audit` in pipeline.yml (e.g., `npm audit --json`). Cross-reference results with DEPS domain findings from the original red team report. Flag any newly introduced advisories not present in the original report as `NEW_ADVISORY`.

## Structured Verification Format

Every finding verification MUST use:

```
VERIFICATION [DOMAIN_ID]-[NNN] | [VERIFIED/REGRESSION/INCOMPLETE] | [HIGH/MEDIUM/LOW confidence] | [file:line]
[Evidence — specific code reference proving the attack vector is closed or still viable]
[Regression check — did the fix introduce any new issues?]
[Defensive rule extracted (VERIFIED only) — reusable pattern for future hardening]
```

## Verification Mandate

<VERIFICATION-MANDATE>
Your job is to prove fixes work, not to assume they do. Every verifier MUST provide concrete evidence.

"The code was changed" is NOT evidence.
"The specific exploitation scenario XYZ no longer works because [specific code reference]" IS evidence.

Every verification MUST produce:
- A VERDICT with supporting evidence (code references, not opinions)
- A regression check (did the fix introduce new issues?)
- A confidence rating based on depth of analysis

A verdict without evidence is a FAILED verification. Start over.
</VERIFICATION-MANDATE>

## Red Flags — Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "The fix looks correct" | Looking correct and being correct are different. Test the attack vector. |
| "The commit message says it's fixed" | Commit messages describe intent, not effect. Verify the code. |
| "The original finding was low confidence" | Low confidence in the finding does not mean low confidence in the fix. Verify regardless. |
| "This chain is broken because one link is fixed" | Chains can have alternative paths. Check all paths. |
| "The defensive rule is obvious" | Obvious rules not written down get forgotten. Codify everything. |
| "No need to check for regressions" | Fixes are the number one source of new bugs. Always check. |
| "The framework handles this now" | Framework defaults can be overridden. Verify the specific usage. |

## Model Routing

| Phase | Model | Config Key | Rationale |
|-------|-------|-----------|-----------|
| Per-finding verification | sonnet | `models.review` | Targeted code analysis, parallelized |
| Dependency audit | (orchestrator) | n/a | Mechanical: run command, parse JSON |
| Exploit chain verification | opus | `models.architecture` | Cross-domain chain reasoning |
| Posture assessment | opus | `models.architecture` | Synthesis + defensive rule generation |

## Prompt Templates

When dispatching subagents, read and use these prompt template files (located in the same directory as this SKILL.md):
- `./verifier-prompt.md` — Per-finding verification agent (sonnet)
- `./chain-analyst-prompt.md` — Exploit chain verification agent (opus)
- `./posture-analyst-prompt.md` — Posture synthesis + defensive rules (opus)

**Before dispatching each agent:** Replace all `{{MODEL}}` and `[PLACEHOLDER]` values with actual data from config and the current verification context.

**Placeholder syntax convention:**
- `{{DOUBLE_BRACES}}` — Model name for the Agent tool's `model:` parameter. Not inside prompt text.
- `[BRACKET_CAPS]` — Content substitution inside prompt text. Replaced with actual data (findings, verdicts, config values, file contents).

This distinction exists because `{{MODEL}}` controls which model runs the agent, while `[PLACEHOLDER]` values are injected into the prompt the agent receives.

## Key Principles

- **Read-only** — never modify source code during verification
- **Config-driven** — all behavior from pipeline.yml
- **Evidence-based** — concrete proof via code references, not assumptions
- **Aggregate** — verifies the whole, not just individual parts
- **Chain-aware** — exploit chains verified as composite attack paths
- **Codifying** — verified fixes become reusable defensive rules in knowledge tier
- **Ticket-integrated** — updates existing GitHub issues, never creates new ones
- **Defense-specialist identity** — agents understand OWASP, CWE, and defense-in-depth
