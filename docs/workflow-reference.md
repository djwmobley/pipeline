# Pipeline Workflow Reference

The pipeline orchestrator (`scripts/orchestrator.js`) is a content-blind state machine that routes between 13 steps. It checks file existence, Postgres status codes, and fail counts — never reads file content or reasons about findings. Commands call the orchestrator to record completions; the orchestrator provides routing decisions.

## Step Graph

```
init ──► brainstorm ──► plan ──► debate? ──► architect? ──► build ──► review ──► qa ──► redteam? ──► purple? ──► commit ──► finish ──► deploy?
                                                              ▲         │         │                    │
                                                              │         │         │                    │
                                                              └─────────┘         │                    │
                                                            review FAIL           │                    │
                                                              ▲                   │                    │
                                                              │                   │                    │
                                                              └───────────────────┘                    │
                                                                  qa FAIL                              │
                                                                                         ┌─────────────┘
                                                                                         │ 2x FAIL
                                                                                         ▼
                                                                                     architect
```

**Legend:** `──►` = success path, `?` = optional step, `│` = failure routing

## Steps

### 1. Init

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:init` |
| **Agent** | `commands/init.md` (interactive command, not a subagent) |
| **Required** | Yes |
| **Inputs** | None (entry point) |
| **Outputs** | `.claude/pipeline.yml` |
| **Next** | brainstorm |
| **On fail** | N/A (interactive — user resolves inline) |

Creates the project configuration. Asks engagement style (expert/guided/full-guidance), security policy (every-feature/milestone/on-demand), detects project profile, sets up GitHub repo and issue tracking. The engagement style and security policy propagate to all subsequent steps.

**Skill:** `skills/brainstorming/SKILL.md` is not involved — init is self-contained in the command file.

### 2. Brainstorm

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:brainstorm` |
| **Skill** | `skills/brainstorming/SKILL.md` |
| **Subagents** | `researcher-prompt.md` (haiku, parallel), `spec-reviewer-prompt.md` (haiku) |
| **Required** | Yes |
| **Inputs** | `.claude/pipeline.yml` |
| **Outputs** | `docs/specs/*.md` |
| **Next** | plan |
| **On fail** | N/A (interactive) |

Engagement-scaled question flow. Explores context, asks clarifying questions (depth controlled by engagement style), derives implied features, proposes approaches, evaluates Big 4 + Compliance, tracks TBDs, writes spec document, runs spec review loop (max 3 iterations).

**Reporting:** Command handles persistence — Postgres (spec summary), GitHub (epic creation with lifecycle checklist).

### 3. Plan

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:plan` |
| **Skill** | `skills/planning/SKILL.md` |
| **Subagents** | `plan-reviewer-prompt.md` (haiku) |
| **Required** | Yes |
| **Inputs** | `docs/specs/*.md` |
| **Outputs** | `docs/plans/*.md` |
| **Next** | debate |
| **On fail** | N/A (interactive) |

Reads spec, generates implementation plan with ordered tasks. Resolves TBDs from brainstorm. Plan reviewer validates completeness, spec alignment, and buildability. For LARGE+ changes, the plan includes QA strategy inline (from `skills/qa/SKILL.md` plan mode).

### 4. Debate (optional)

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:debate` |
| **Skill** | `skills/debate/SKILL.md` |
| **Subagents** | `advocate-prompt.md`, `skeptic-prompt.md`, `practitioner-prompt.md` (all sonnet, parallel) |
| **Required** | No — auto-offered for LARGE+, skippable |
| **Inputs** | `docs/plans/*.md` |
| **Outputs** | `docs/findings/debate-*.md` |
| **Next** | architect |
| **On fail** | N/A (advisory — verdict informs but doesn't block) |

Three-agent antagonistic design debate. Advocate steelmans, Skeptic attacks feasibility, Practitioner grounds in reality. Each produces a position paper; the command synthesizes a verdict. Compliance awareness in all three agents.

**Skip behavior:** If inputs not met or user declines, orchestrator records `skipped` and advances to architect.

### 5. Architect (optional)

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:architect` |
| **Skill** | `skills/architecture/SKILL.md` |
| **Subagents** | `recon-agent-prompt.md` (haiku), `specialist-agent-prompt.md` (sonnet, parallel per domain), `lead-architect-prompt.md` (opus) |
| **Required** | No — auto-invoked for LARGE+, optional otherwise |
| **Inputs** | `docs/plans/*.md` |
| **Outputs** | `docs/architecture.md` |
| **Next** | build |
| **On fail** | N/A (interactive) |

Recon scans the codebase for existing patterns. Domain specialists propose decisions per area (DATA, STATE, UI, API, INFRA, TEST). Lead architect resolves conflicts and produces the architecture document with typed contracts, security standards, testing standards, and banned patterns.

**Loopback target:** If purple fails 2x on the same finding, the orchestrator routes back here to re-examine the architectural standard that may be broken.

### 6. Build

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:build` |
| **Skill** | `skills/building/SKILL.md` |
| **Subagents** | `implementer-prompt.md` (haiku/sonnet per task complexity), `reviewer-prompt.md` (haiku/sonnet) |
| **Required** | Yes |
| **Inputs** | `docs/plans/*.md` |
| **Outputs** | Feature branch with commits |
| **Next** | review |
| **On fail** | N/A (escalates to user) |

Dispatches one implementer per plan task (sequential, not parallel). Each implementer reads its own context from stores (arch plan, decisions, gotchas, task issue, build-state). Post-task reviewer runs after each implementer; issues loop back to implementer until approved.

**Reporting:** Each implementer and reviewer writes to all three stores (Postgres, GitHub issue comment, build-state.json).

**Failure routing target:** review FAIL and qa FAIL both route back here.

### 7. Review

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:review` |
| **Skill** | `skills/reviewing/SKILL.md` |
| **Agent** | Review runs as the command itself (not a subagent dispatch) |
| **Required** | Yes |
| **Inputs** | Feature branch exists |
| **Outputs** | Status: `PASS` or `FAIL` |
| **Next** | qa (on PASS) |
| **On fail** | **build** — review failure routes back to build to fix issues |

PR-scoped diff review. Runs static analysis (semgrep or grep fallback), checks arch plan compliance (module boundaries, typed contracts, banned patterns), applies review criteria from config. Cross-file contract verification, structural completeness audit, fallback symmetry checks.

**Reporting:** Postgres (review verdict), GitHub issue comment, build-state.

### 8. QA

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:qa` |
| **Skill** | `skills/qa/SKILL.md` |
| **Subagents** | `planner-prompt.md` (opus), `worker-prompt.md` (sonnet, parallel per work package), `verifier-prompt.md` (opus) |
| **Required** | Yes |
| **Inputs** | review = PASS |
| **Outputs** | Status: `PASS` or `FAIL` |
| **Next** | redteam (on PASS) |
| **On fail** | **build** — qa failure routes back to build |

For LARGE+: full test plan with parallel workers per work package + seam pass. For MEDIUM: targeted 3-5 checks. Risk-driven testing — identifies component interaction risks, not just AC tracing. Verifier synthesizes worker results, runs seam tests, triages failures.

**Reporting:** Each QA agent writes to all three stores.

### 9. Red Team (optional)

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:redteam` |
| **Skill** | `skills/redteam/SKILL.md` |
| **Subagents** | `recon-agent-prompt.md` (haiku), `specialist-agent-prompt.md` (sonnet, parallel per domain), `lead-analyst-prompt.md` (opus) |
| **Required** | No — controlled by `security.policy` config |
| **Inputs** | qa = PASS |
| **Outputs** | `docs/findings/redteam-*.md` |
| **Next** | purple |
| **On fail** | N/A (findings are output, not pass/fail) |

Diff-scoped security assessment. Recon enumerates attack surface (entry points, auth boundaries, data sinks, SBOM). Domain specialists test specific areas (INJ, AUTH, XSS, DEPS, COMPLIANCE, etc.). Lead analyst chains findings, deduplicates, builds risk matrix and remediation roadmap.

**Security policy routing:** `every-feature` = always runs. `milestone` = runs on MILESTONE-sized changes only. `on-demand` = user must invoke manually.

### 10. Purple Team (optional)

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:purpleteam` |
| **Skill** | `skills/purpleteam/SKILL.md` |
| **Subagents** | `verifier-prompt.md` (sonnet, parallel per finding), `chain-analyst-prompt.md` (opus), `posture-analyst-prompt.md` (opus) |
| **Required** | No — only runs if redteam produced findings |
| **Inputs** | `docs/findings/redteam-*.md` |
| **Outputs** | Status: `PASS` or `FAIL` |
| **Next** | commit (on PASS) |
| **On fail** | Remediation cycle, then re-verify |
| **Loopback** | **2x FAIL on same finding → architect** — the standard may be broken, not the fix |

Verifies each red team finding's fix by replaying the exploitation scenario against the current code. Strict role boundary — verifiers report VERIFIED/REGRESSION/INCOMPLETE, never suggest fixes.

**Loopback rule:** If a finding fails verification twice (`fail_count >= 2`), the orchestrator routes to the architect step to re-examine whether the architectural standard itself is flawed.

### 11. Commit

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:commit` |
| **Agent** | `commands/commit.md` (Category 4 utility) |
| **Required** | Yes |
| **Inputs** | review = PASS, qa = PASS |
| **Outputs** | Status: `PASS` (commit created) |
| **Next** | finish |
| **On fail** | N/A (preflight gate blocks, user resolves) |

Preflight gate chain: typecheck → lint → test → review gate. If all pass, creates the commit. Category 4 utility — skips GitHub issue comments.

### 12. Finish

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:finish` |
| **Agent** | `commands/finish.md` |
| **Required** | Yes |
| **Inputs** | commit = PASS |
| **Outputs** | Status: `merged` |
| **Next** | deploy |
| **On fail** | N/A (interactive — user resolves merge conflicts) |

Merges PR via `gh pr merge`. Compiles single epic summary from Postgres (all phase results, 5K limit). Closes feature epic. Regenerates dashboard. Syncs README roadmap from Postgres.

### 13. Deploy (optional)

| Field | Value |
|-------|-------|
| **Command** | N/A — project-specific deployment |
| **Required** | No — not all projects deploy via pipeline |
| **Inputs** | finish = PASS |
| **Outputs** | Status: `deployed` |
| **Next** | None (terminal) |
| **On fail** | Project-specific rollback |

Terminal step. The pipeline does not prescribe deployment — this is a placeholder for project-specific deployment workflows.

## Routing Rules

| Condition | Source Step | Target | Rule |
|-----------|-----------|--------|------|
| Success | Any required step | Next in sequence | Default forward routing |
| Optional + inputs not met | debate, architect, redteam, purple, deploy | Skip → next after | Recorded as `skipped` in workflow_state |
| FAIL | review | build | `onFail: 'build'` — fix issues and re-review |
| FAIL | qa | build | `onFail: 'build'` — fix issues and re-test |
| FAIL (1st time) | purple | remediation cycle → purple retry | Standard retry |
| FAIL (2nd+ time) | purple | architect | `loopback.maxFails: 2` — re-examine the standard |
| PASS through all required steps | finish | deploy (or done) | Workflow complete |

## Engagement Style Effects

The `project.engagement` setting (expert/guided/full-guidance) affects these steps:

| Step | Expert | Guided | Full-Guidance |
|------|--------|--------|---------------|
| Init | Minimal questions, auto-detect most settings | Standard question flow | Thorough walkthrough with explanations |
| Brainstorm | Minimal clarifying questions, skip obvious ones | One question at a time, multiple choice | Explain WHY each question matters, examples per choice |
| Brainstorm Big 4 | One-paragraph summary, flag real concerns only | Standard section per dimension | Walk through compliance checklist item by item |
| Dashboard | Internal 13-step workflow view | External 5-step view + expand toggle | External 5-step view |

Other steps (plan, build, review, qa, redteam, purple, commit, finish) are not engagement-scaled — they run the same process regardless of engagement level.

## Security Policy Routing

The `security.policy` config controls when red team and purple team steps run:

| Policy | Red Team | Purple Team | When to Use |
|--------|----------|-------------|-------------|
| `every-feature` | Runs on every feature | Runs if redteam found findings | High-security projects (fintech, healthcare) |
| `milestone` | Runs on MILESTONE-sized changes only | Same | Standard projects with periodic security checks |
| `on-demand` | User must invoke `/pipeline:redteam` manually | User must invoke `/pipeline:purpleteam` manually | Low-risk projects or teams with external security review |

When the orchestrator reaches the redteam step:
- If policy is `every-feature`: inputs are checked, step proceeds if qa=PASS
- If policy is `milestone` and change size < MILESTONE: step is recorded as `skipped`
- If policy is `on-demand`: step is recorded as `skipped` unless user explicitly ran the command

## Three-Store Reporting Contract

Every agent that produces output writes to all applicable stores. The orchestrator does not handle persistence — each agent is responsible for its own reporting.

| Step | Postgres | GitHub Issue | Build-State | Notes |
|------|----------|-------------|-------------|-------|
| Init | Session record | Epic creation | N/A | Creates project structure |
| Brainstorm | Spec summary | Epic checklist update | N/A | Command handles persistence |
| Plan | Plan summary | Epic checklist update | N/A | Command handles persistence |
| Debate | Verdict summary | Epic comment | N/A | Command handles persistence |
| Architect | Decision records | Epic comment | N/A | Command handles persistence |
| Build | Per-task impl result | Per-task issue comment | Task status + commit SHA | Implementer + reviewer self-report |
| Review | Review verdict | Task issue comment | Review status | Self-reports |
| QA | Per-WP results + verdict | Task issue comments | QA status | Planner, workers, verifier self-report |
| Red Team | Per-domain findings | Task issue comments | Redteam status | Recon, specialists self-report; lead delegates to command |
| Purple | Per-finding verdict | Task issue comments | Purple status | Verifier delegates to command |
| Commit | N/A | N/A | Commit SHA | Category 4 utility — skips GitHub |
| Finish | Closes session, marks task done | Epic summary (compiled, 5K limit) | Cleanup | Compiles all phase results |
| Deploy | N/A | N/A | Deploy status | Project-specific |

## Orchestrator CLI Reference

```bash
# Show current workflow state
node scripts/orchestrator.js status [workflow-id]

# Determine next step (checks inputs, handles skips/failures)
node scripts/orchestrator.js next [workflow-id]

# Initialize a new workflow
node scripts/orchestrator.js start <workflow-id>

# Record step completion (called BY commands after they finish)
node scripts/orchestrator.js complete <step> <PASS|FAIL|PARTIAL|BLOCKED> [artifact-path]

# Check if a step's inputs are met
node scripts/orchestrator.js check <step>

# Print the step graph
node scripts/orchestrator.js graph
```

**Result codes:** `PASS` (success), `FAIL` (issues found), `PARTIAL` (partial completion), `BLOCKED` (cannot proceed).

**Workflow IDs:** Typically formatted as `YYYY-MM-DD-feature-name`. Created by the init command.

## Data Access Layer

Agents read context from stores via `scripts/pipeline-context.js`:

| Function | What it returns | Used by |
|----------|----------------|---------|
| `getTaskContext(taskNum)` | Task description, status, dependencies | Implementer, reviewer |
| `getArchPlan()` | `docs/architecture.md` contents | Implementer, reviewer, QA |
| `getSecurityFindings()` | Open findings from Postgres | Redteam, purple, remediation |
| `getRecentDecisions(n)` | Last N architectural decisions | Implementer, reviewer |
| `getActiveGotchas()` | Active gotchas/constraints | Implementer, reviewer |
| `getSessionContext()` | Current session metadata | Dashboard |
| `getBuildState()` | `.claude/build-state.json` contents | All build-phase agents |
| `getGitHubContext()` | Issue/PR state from GitHub CLI | Review, finish |
| `getFullContext()` | Combined output of all above | Debug, investigation |
