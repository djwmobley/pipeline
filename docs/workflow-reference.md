# Pipeline Workflow Reference

The pipeline orchestrator (`scripts/orchestrator.js`) is a content-blind state machine that routes between 13 steps. It checks file existence, Postgres status codes, and fail counts — never reads file content or reasons about findings. Commands call the orchestrator to record completions; the orchestrator provides routing decisions.

## Step Graph

```
                         ┌──────────────────────────────────────────────────────────────────────┐
                         │                         debate FAIL                                  │
                         ▼                                                                      │
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

## Orchestrator Integration Contract

Every command calls the orchestrator when it finishes. The orchestrator does not invoke commands — it only provides routing decisions. This is the integration contract:

| Boundary | What crosses it |
|---|---|
| Command → Orchestrator | `complete <step> PASS\|FAIL [artifact]` |
| Orchestrator → Caller | Step name + ready/blocked/failure (JSON on last line) |
| Command → Stores | Reads context from Postgres/issue tracker/files; writes results back |
| Chain → Orchestrator | "what's next?" query + skip recording for excluded steps |

**Workflow startup:** The `init` command calls `orchestrator.js start <workflow-id>` to create the workflow before calling `complete init PASS`. No other command starts workflows.

**Result codes used in practice:** `PASS` (success) and `FAIL` (issues found). The orchestrator also accepts `PARTIAL` and `BLOCKED` but no current command uses them.

**Skip recording:** Optional steps whose inputs are met (debate, architect) must be explicitly skipped by the command calling `complete <step> PASS 'skipped'`. The orchestrator only auto-skips optional steps whose inputs are NOT met.

**Auto-skip behavior:** When the orchestrator encounters an optional step with unmet inputs, it records it as `skipped` in workflow_state and advances to the next step. If multiple consecutive optional steps have unmet inputs, the orchestrator skips all of them in a loop, re-checking inputs after each skip.

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
| **On fail** | Records `FAIL` in orchestrator (user retries) |
| **Orchestrator** | `start <project>-<date>` then `complete init PASS '.claude/pipeline.yml'` |

Creates the project configuration. Asks engagement style (expert/guided/full-guidance), security policy (every-feature/milestone/on-demand), detects project profile, sets up GitHub repo and issue tracking. The engagement style and security policy propagate to all subsequent steps.

**Workflow startup:** Init is the only command that calls `orchestrator.js start`. It creates the workflow before recording completion. If the workflow already exists (prior init), it skips the start call.

**Auth check:** Uses `platform.js auth check --platform <detected>` with a `--platform` flag override since pipeline.yml does not exist yet during init. The flag tells platform.js which backend to check without needing the config file.

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
| **On fail** | Records `FAIL` in orchestrator (user retries) |
| **Orchestrator** | `complete brainstorm PASS '[spec file path]'` or `complete brainstorm FAIL` |

Engagement-scaled question flow. Explores context, asks clarifying questions (depth controlled by engagement style), derives implied features, proposes approaches, evaluates Big 4 + Compliance, tracks TBDs, writes spec document, runs spec review loop (max 3 iterations).

**Reporting:** Command handles persistence — Postgres (spec summary), issue tracker (epic creation with lifecycle checklist).

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
| **On fail** | Records `FAIL` in orchestrator (user retries or re-brainstorms) |
| **Orchestrator** | `complete plan PASS '[plan file path]'` or `complete plan FAIL` |

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
| **On fail** | **brainstorm** — `onFail: 'brainstorm'` (rethink disposition routes back to brainstorm) |
| **Orchestrator** | `complete debate PASS '[verdict path]'` or `complete debate FAIL` or `complete debate PASS 'skipped'` |

Three-agent antagonistic design debate. Advocate steelmans, Skeptic attacks feasibility, Practitioner grounds in reality. Each produces a position paper; the command synthesizes a verdict. Compliance awareness in all three agents.

**Disposition mapping:** `proceed` or `proceed-with-constraints` → PASS. `rethink` → FAIL (orchestrator routes back to brainstorm).

**Skip behavior:** When skipped (TINY/MEDIUM change or user declines), the command must explicitly call `complete debate PASS 'skipped'`. The orchestrator does NOT auto-skip debate because its inputs (plan files) are met after the plan step runs. Without the explicit skip call, the workflow stalls.

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
| **Orchestrator** | `complete architect PASS 'docs/architecture.md'` or `complete architect PASS 'skipped'` |

Recon scans the codebase for existing patterns. Domain specialists propose decisions per area (DATA, STATE, UI, API, INFRA, TEST). Lead architect resolves conflicts and produces the architecture document with typed contracts, security standards, testing standards, and banned patterns.

**Loopback target:** If purple fails 2x on the same finding, the orchestrator routes back here to re-examine the architectural standard that may be broken.

**Skip behavior:** Same as debate — inputs (plan files) are met, so the command must explicitly record `PASS 'skipped'` when skipped for non-LARGE changes.

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
| **On fail** | Records `FAIL` in orchestrator (user resolves) |
| **Orchestrator** | `complete build PASS` or `complete build FAIL` |

Dispatches one implementer per plan task (sequential, not parallel). Each implementer reads its own context from stores (arch plan, decisions, gotchas, task issue, build-state). Post-task reviewer runs after each implementer; issues loop back to implementer until approved.

**Reporting:** Each implementer and reviewer writes to all three stores (Postgres, issue tracker comment, build-state.json).

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
| **On fail** | **build** — `onFail: 'build'` (fix issues and re-review) |
| **Orchestrator** | `complete review PASS` or `complete review FAIL` |

PR-scoped diff review. Runs static analysis (semgrep or grep fallback), checks arch plan compliance (module boundaries, typed contracts, banned patterns), applies review criteria from config. Cross-file contract verification, structural completeness audit, fallback symmetry checks.

**Reporting:** Postgres (review verdict), issue tracker comment, build-state.

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
| **On fail** | **build** — `onFail: 'build'` (fix issues and re-test) |
| **Orchestrator** | `complete qa PASS` or `complete qa FAIL` |

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
| **On fail** | N/A (findings are output, always records PASS) |
| **Orchestrator** | `complete redteam PASS '[report path]'` or `complete redteam PASS 'skipped'` |

Diff-scoped security assessment. Recon enumerates attack surface (entry points, auth boundaries, data sinks, SBOM). Domain specialists test specific areas (INJ, AUTH, XSS, DEPS, COMPLIANCE, etc.). Lead analyst chains findings, deduplicates, builds risk matrix and remediation roadmap.

**Security policy routing:** `every-feature` = always runs. `milestone` = runs on MILESTONE-sized changes only. `on-demand` = user must invoke manually.

**Skip behavior:** Redteam's input is `qa = PASS` (status check), which IS met after QA passes. The orchestrator will NOT auto-skip it. The command must explicitly record `PASS 'skipped'` when the security policy says to skip.

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
| **Orchestrator** | `complete purple PASS` or `complete purple FAIL` or `complete purple PASS 'skipped'` |

Verifies each red team finding's fix by replaying the exploitation scenario against the current code. Strict role boundary — verifiers report VERIFIED/REGRESSION/INCOMPLETE, never suggest fixes.

**Loopback rule:** If a finding fails verification twice (`fail_count >= 2`), the orchestrator routes to the architect step to re-examine whether the architectural standard itself is flawed.

**Auto-skip:** Unlike debate/architect/redteam, purple CAN be auto-skipped by the orchestrator. If redteam was skipped (no findings file produced), purple's glob input (`docs/findings/redteam-*.md`) is not met, so the orchestrator auto-skips it.

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
| **Orchestrator** | `complete commit PASS` (always PASS — reaching this point means success) |

Preflight gate chain: review gate (hard stop on source file count) → typecheck → lint → test → agent template lint. If all pass, creates the commit. Category 4 utility — skips issue tracker comments.

### 12. Finish

| Field | Value |
|-------|-------|
| **Command** | `/pipeline:finish` |
| **Agent** | `commands/finish.md` |
| **Required** | Yes |
| **Inputs** | commit = PASS |
| **Outputs** | Status: `merged` |
| **Next** | deploy |
| **On fail** | Records `FAIL` in orchestrator (user resolves merge conflicts) |
| **Orchestrator** | `complete finish PASS` or `complete finish FAIL` |

Merges PR via `platform.js pr merge`. Compiles single epic summary from Postgres (all phase results, 5K limit). Closes feature epic. Regenerates dashboard. Syncs README roadmap from Postgres.

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

## Workflow Chaining

The `/pipeline:chain` command runs multiple steps sequentially by repeating a loop: ask the orchestrator "what's next?", then invoke that step via the Skill tool.

**Two modes:**
- **Explicit:** `/pipeline:chain brainstorm plan build` — runs only the named steps
- **Auto:** `/pipeline:chain` — runs from current orchestrator position to end of graph

**Contract:** The chain passes nothing to sub-commands and reads nothing back. Each sub-command handles its own user interaction, orchestrator completion, and store writes. The chain's only orchestrator interaction is querying `next` and recording skips for steps the user excluded from scope.

**Skip recording:** When the orchestrator reports a `next` step that is NOT in the chain's scope, the chain records `complete <step> PASS 'skipped-by-chain'` so the orchestrator can advance. This is the one exception to the rule that the chain never calls `orchestrator.js complete`.

**Step-to-command mapping:**

| Orchestrator Step | Skill Invocation |
|---|---|
| init | `pipeline:init` |
| brainstorm | `pipeline:brainstorm` |
| plan | `pipeline:plan` |
| debate | `pipeline:debate` |
| architect | `pipeline:architect` |
| build | `pipeline:build` |
| review | `pipeline:review` |
| qa | `pipeline:qa` |
| redteam | `pipeline:redteam` |
| purple | `pipeline:purpleteam` |
| commit | `pipeline:commit` |
| finish | `pipeline:finish` |

**The `/pipeline:security` meta-command** also chains steps (redteam → remediate → purpleteam) but delegates to each sub-command's own orchestrator calls. It does not double-record.

## Routing Rules

| Condition | Source Step | Target | Rule |
|-----------|-----------|--------|------|
| Success | Any step | Next in sequence | Default forward routing |
| FAIL | debate | brainstorm | `onFail: 'brainstorm'` — rethink disposition |
| FAIL | review | build | `onFail: 'build'` — fix issues and re-review |
| FAIL | qa | build | `onFail: 'build'` — fix issues and re-test |
| FAIL (1st time) | purple | next step (commit) | Optional step — workflow advances past failure |
| FAIL (2nd+ time) | purple | architect | `loopback.maxFails: 2` — re-examine the standard |
| Optional + inputs NOT met | debate, architect, purple, deploy | Auto-skip → next | Orchestrator records `skipped`, re-checks next step in a loop |
| Optional + inputs met, step skipped | debate, architect, redteam | Stalls | Command must explicitly call `complete <step> PASS 'skipped'` |
| PASS through all required steps | finish | deploy (or done) | Workflow complete |

**Critical distinction — two kinds of skips:**

1. **Auto-skip (orchestrator handles):** Optional step whose inputs are NOT met. Example: purple after redteam was skipped (no findings files exist). The orchestrator detects unmet inputs, records `skipped`, and advances. Multiple consecutive auto-skips are handled in a loop with input re-checking.

2. **Manual skip (command handles):** Optional step whose inputs ARE met but the command decides not to run. Example: debate after plan (plan files exist, but change is MEDIUM so debate is unnecessary). The command must call `complete <step> PASS 'skipped'`. Without this, the workflow stalls because the orchestrator sees met inputs and waits.

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

**Important:** The orchestrator does NOT read `security.policy`. It is content-blind — it only checks the `required: false` flag and whether input artifacts exist. Security policy routing is handled by the **commands themselves** (e.g., `/pipeline:redteam` reads the policy and decides whether to proceed or skip). The orchestrator records the result (done/skipped) regardless of how the command made that decision.

## Three-Store Reporting Contract

Every agent that produces output writes to all applicable stores. The orchestrator does not handle persistence — each agent is responsible for its own reporting.

| Step | Postgres | Issue Tracker | Build-State | Notes |
|------|----------|-------------|-------------|-------|
| Init | Session record | Epic creation | N/A | Creates project structure |
| Brainstorm | Spec summary | Epic checklist update | N/A | Command handles persistence |
| Plan | Plan summary | Epic checklist update | N/A | Command handles persistence |
| Debate | Verdict summary | Epic comment | N/A | Command handles persistence |
| Architect | Decision records | Epic comment | N/A | Command handles persistence |
| Build | Per-task impl result | Per-task issue comment | Task status + commit SHA | Implementer + reviewer self-report |
| Review | Review verdict | Task issue comment | Review status | Self-reports |
| QA | Per-WP results + verdict | Task issue comments | QA status | Planner + workers self-report; verifier produces report, command handles persistence |
| Red Team | Per-domain findings | Task issue comments | Redteam status | Recon, specialists self-report; lead delegates to command |
| Purple | Per-finding verdict | Task issue comments | Purple status | Verifier delegates to command |
| Commit | N/A | N/A | Commit SHA | Category 4 utility — skips issue tracker |
| Finish | Closes session, marks task done | Epic summary (compiled, 5K limit) | Cleanup | Compiles all phase results |
| Deploy | N/A | N/A | Deploy status | Project-specific |

### Platform Abstraction

The "Issue Tracker" column above is platform-agnostic — it uses `scripts/platform.js` which routes to the configured backend (GitHub or Azure DevOps). The contract:

| Interface | Operations | GitHub Backend | Azure DevOps Backend |
|-----------|-----------|---------------|---------------------|
| IssueTracker | create, comment, close, list, view, edit, reopen, search | `gh issue *` | `az boards work-item *` + WIQL |
| CodeHost | create PR, merge PR, comment on PR, diff PR, view PR | `gh pr *` | `az repos pr *` + `az rest` (threads) |

All verification (state transition succeeded, PR actually merged, issue ref returned) and retry logic (3 attempts, exponential backoff 2s/4s/8s) happens inside `platform.js` in Node.js code. Agents never parse platform responses or check status fields — they treat the command as pass/fail.

**Config loading:** `platform.js` reads `project.repo` from `.claude/pipeline.yml` regardless of whether a `platform:` section exists. If no `platform:` section is present, it defaults to `github` for both code_host and issue_tracker.

---

## Orchestrator CLI Reference

```bash
# Show current workflow state
node scripts/orchestrator.js status [workflow-id]

# Determine next step (checks inputs, handles skips/failures)
node scripts/orchestrator.js next [workflow-id]

# Initialize a new workflow (called by init command only)
node scripts/orchestrator.js start <workflow-id>

# Record step completion (called BY commands after they finish)
node scripts/orchestrator.js complete <step> <PASS|FAIL> [artifact-path]

# Check if a step's inputs are met
node scripts/orchestrator.js check <step>

# Print the step graph
node scripts/orchestrator.js graph
```

**Result codes:** `PASS` (success), `FAIL` (issues found). The orchestrator also accepts `PARTIAL` and `BLOCKED` but no current command uses them.

**Workflow IDs:** Formatted as `<project-name>-YYYY-MM-DD`. Created by the init command via `orchestrator.js start`.

**JSON output:** The `next` command outputs machine-readable JSON on its last line:
- `{"next":"<step>","inputs":"met"}` — step is ready to run
- `{"next":"<step>","inputs":"blocked","missing":[...]}` — step is blocked
- `{"next":"<step>","reason":"failure"}` — routing to recovery step after failure
- `{"next":"<step>","reason":"loopback","fails":N}` — routing after repeated failure
- No JSON (plain text) — workflow complete or no active workflow

## Data Access Layer

Agents read context via `scripts/pipeline-context.js`, invoked as a **CLI tool** (not imported as a module):

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel) node '[SCRIPTS_DIR]/pipeline-context.js' <command> [args]
```

| CLI Command | JS Function | What it returns |
|-------------|-------------|-----------------|
| `decisions [n]` | `getRecentDecisions(client, limit)` | Last N architectural decisions from Postgres |
| `gotchas` | `getActiveGotchas(client)` | Active gotchas/constraints from Postgres |
| `task [id]` | `getTaskContext(client, taskId)` | Task description, status, dependencies from Postgres |
| `arch-plan` | `getArchPlan()` | `docs/architecture.md` contents (file read, no Postgres) |
| `findings` | `getSecurityFindings(client, options)` | Open findings from Postgres |
| `session` | `getSessionContext(client)` | Current session metadata from Postgres |
| `build-state` | `getBuildState(planPath)` | `.claude/build-state.json` contents (file read) |
| `github [issue]` | `getGitHubContext(issueNum)` | Issue/PR state via platform.js |
| `full [taskId]` | `getFullContext(client, taskId)` | Combined output of all above |

**Which agents call which commands:**
- **Implementer, reviewer:** `decisions 10`, `gotchas` (via CLI). Also read `docs/architecture.md` and `.claude/build-state.json` directly as file reads.
- **Dashboard:** `session` (via CLI)
- **Debug/investigation:** `full` (via CLI)
- Other agents read stores directly (e.g., `node scripts/platform.js issue view`, `cat .claude/build-state.json`) rather than going through pipeline-context.js.
