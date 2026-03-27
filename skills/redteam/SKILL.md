---
name: redteam
description: Security red team assessment — recon + parallel specialist agents + lead analyst synthesis
---

# Red Team Security Assessment

## Overview

Comprehensive security assessment using parallel domain specialists. Unlike `/pipeline:audit` (which reviews code quality by directory sectors), red team slices by **attack domain** — injection, auth, XSS, etc. — because security vulnerabilities cut across directories. Each specialist gets framework-specific checklists.

**Core principle:** Think like an attacker. Every specialist's job is to break things.

## The Process

```
Knowledge query ──┐
                   ├──▶ Sell (token estimate) ──▶ Recon (haiku) ──▶ Select specialists
Framework detect ──┘                                    │                   │
                                                        ▼                   ▼
                                                  SBOM artifact    Launch N specialists (sonnet, parallel)
                                                  (.cdx.json)              │
                                                                           ▼
                                                          Collect reports ──▶ Lead analyst (opus)
                                                                                     │
                                                                            ┌────────┴────────┐
                                                                            ▼                  ▼
                                                                     Markdown report    HTML artifact
                                                                            │                  │
                                                                            └────────┬─────────┘
                                                                                     ▼
                                                                         Persist to knowledge tier
```

## Specialist Domains

12 domains, each with a specialist ID, CWE references, and structured checklist:

| ID | Domain |
|---|---|
| INJ | Injection (SQL, NoSQL, OS command, template) |
| AUTH | Authentication & Session Management |
| XSS | Cross-Site Scripting |
| CSRF | Cross-Site Request Forgery |
| CRYPTO | Cryptography |
| CONFIG | Security Misconfiguration |
| DEPS | Dependency & Supply Chain |
| ACL | Access Control |
| RATE | Rate Limiting & DoS |
| DATA | Data Exposure |
| FILE | File & Path Safety |
| CERT | Certificate & Transport |

Full definitions in `./specialist-domains.md`. Framework-specific checklists in `./framework-checklists.md`.

## Profile-Based Specialist Selection

| Profile | Specialists |
|---------|------------|
| spa | INJ, AUTH, XSS, CSRF, CONFIG, DEPS, ACL, DATA |
| fullstack | INJ, AUTH, XSS, CSRF, CRYPTO, CONFIG, DEPS, ACL, RATE, DATA |
| mobile | INJ, AUTH, CRYPTO, CONFIG, DEPS, ACL, DATA, CERT |
| mobile-web | INJ, AUTH, XSS, CSRF, CRYPTO, CONFIG, DEPS, ACL, DATA, CERT |
| api | INJ, AUTH, CRYPTO, CONFIG, DEPS, ACL, RATE, DATA |
| cli | INJ, CONFIG, DEPS, FILE, ACL |
| library | INJ, DEPS, FILE, DATA |

## Two-Pass Read Protocol (Security Variant)

Specialists follow this to minimize tokens while maximizing coverage:

**Pass 1 — Recon-informed enumeration:**
- Review Phase 0 recon hits assigned to this domain
- Read first ~40 lines of each file (imports + declarations)
- Prioritize: auth boundaries, input handling, data flow paths
- List files needing full read

**Pass 2 — Targeted security reads:**
- Full body of every function handling user input
- Full body of every auth/authorization check
- Full body of every database query construction
- Full body of every HTML rendering function
- Skip files where Pass 1 finds no security-relevant patterns

After Pass 2, rate confidence in each finding. If you haven't read the relevant code, confidence MUST NOT be HIGH.

## Structured Finding Format

Every finding MUST use:

```
FINDING [DOMAIN_ID]-[NNN] | [CRITICAL/HIGH/MEDIUM/LOW/INFO] | [HIGH/MEDIUM/LOW] | [file:line or URL:path] | [CWE-ID]
[Description of vulnerability]
[Exploitation scenario — how an attacker would use this]
[Remediation — specific fix with code reference]
```

**Severity levels** (security-standard, not audit's color system):
- **CRITICAL** — Remote code execution, authentication bypass, data breach. Exploitable now.
- **HIGH** — Significant vulnerability requiring specific conditions. Privilege escalation, stored XSS.
- **MEDIUM** — Vulnerability requiring user interaction or insider access. Reflected XSS, CSRF.
- **LOW** — Defense-in-depth issue. Missing headers, verbose errors.
- **INFO** — Observation, hardening suggestion. No direct exploit path.

**Confidence levels:**
- **HIGH** — Read the code, verified the vulnerability path, checked for mitigations
- **MEDIUM** — Read the code, found the pattern, but mitigations may exist elsewhere
- **LOW** — Inferred from imports/patterns without full code read

## Adversarial Mandate

<ADVERSARIAL-MANDATE>
Your job is to break this application. Think like an attacker with source access.

Every specialist MUST produce at least one finding OR an explicit "Clean Domain Certificate" that lists:
- What attack vectors were tested for this domain
- Why no vulnerabilities were found (specific evidence, not "looks secure")
- What the highest-risk area is and why it's acceptable

An empty report with no findings and no certificate is a FAILED assessment. Start over.

If you catch yourself thinking "this looks secure" — that thought is a red flag. Read the code again.
If the framework handles something automatically (e.g., ORM parameterization), verify it's actually being used correctly everywhere.
If a security control exists, try to bypass it.
</ADVERSARIAL-MANDATE>

## Red Flags — Rationalization Prevention

| Thought | Reality |
|---------|---------|
| "The framework handles this" | Frameworks have escape hatches. Check if they're being used. |
| "This is internal only" | Internal apps get compromised. Assess anyway. |
| "Nobody would do that" | Attackers do exactly that. |
| "There's authentication on this route" | Auth ≠ authorization. Check both. |
| "The ORM prevents injection" | Raw queries, custom fragments, and string interpolation bypass ORMs. |
| "This is just a prototype" | Prototypes become production. Assess the code as-is. |
| "The input is validated client-side" | Client-side validation is trivially bypassed. |
| "This data isn't sensitive" | Context determines sensitivity. PII, tokens, and keys are always sensitive. |

## Model Routing

| Phase | Model | Config Key | Rationale |
|-------|-------|-----------|-----------|
| Recon | haiku | `models.cheap` | Mechanical: grep + enumerate |
| Specialists | sonnet | `models.review` | Deep reasoning about attack vectors |
| Lead analyst | opus | `models.architecture` | Exploit chain reasoning, risk assessment |
| HTML report | haiku | `models.cheap` | Mechanical HTML generation |

## Prompt Templates

When dispatching subagents, read and use these prompt template files (located in the same directory as this SKILL.md):
- `./recon-agent-prompt.md` — Haiku recon agent
- `./specialist-agent-prompt.md` — Sonnet specialist agents
- `./lead-analyst-prompt.md` — Opus lead analyst
- `./html-report-prompt.md` — Haiku HTML report generator

**Before dispatching each agent:** Replace all `{{MODEL}}` and `[PLACEHOLDER]` values with actual data from config and the current assessment context.

**Placeholder syntax convention:**
- `{{DOUBLE_BRACES}}` — Model name for the Agent tool's `model:` parameter. Not inside prompt text.
- `[BRACKET_CAPS]` — Content substitution inside prompt text. Replaced with actual data (findings, config values, file contents).

This distinction exists because `{{MODEL}}` controls which model runs the agent, while `[PLACEHOLDER]` values are injected into the prompt the agent receives.

**Runtime placeholders** (resolved by the red team command before dispatching):
- `[SCRIPTS_DIR]` — absolute path to the pipeline plugin's scripts/ directory
- `[GITHUB_REPO]` — `integrations.github.repo` from pipeline.yml. Empty if GitHub disabled.
- `[GITHUB_ISSUE]` — task issue number for this red team phase. Empty if GitHub disabled.
- `[SOURCE_DIRS]` — `routing.source_dirs` from pipeline.yml
- `[DIFF_FILES]` — diff-scoped file list or "FULL_SCAN"

Full substitution checklists are in each prompt template file.

## Key Principles

- **Read-only** — never modify code during assessment
- **Config-driven** — specialists, skip list, mode, recon patterns all from pipeline.yml
- **Parallel** — all specialist agents run simultaneously
- **Framework-aware** — each specialist gets checklists specific to the detected framework
- **Knowledge-integrated** — queries past decisions/gotchas, persists findings back
- **Evidence-based** — recon before specialists, targeted reads only
- **Structured** — machine-parseable finding format with CWE IDs
- **Shareable** — HTML report for non-technical stakeholders
