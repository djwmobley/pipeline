# Command Reference

> **Alpha** — Pipeline is under active development. Content may change between releases.

Hit an error? See the [error reference](errors.md) for recovery paths.

Pipeline is a web-first agent workflow engine with 29 commands. The [13-step orchestrator](workflow-reference.md) manages the core pipeline from brainstorm to deploy; the remaining 16 commands — quality tools, meta-commands, and utilities — work independently or alongside it. See the [system reference](workflow-reference.md) for the full architecture.

All commands, their arguments, and what they do. Commands are grouped by layer — most users only need Layer 1.

## Layer 1 — Quality Gates (daily use)

### `/pipeline:commit`

Runs preflight gates, then commits and pushes.

**Preflight chain (in order):**
1. **Review gate** — if source files changed >= `routing.review_gate_threshold`, blocks until you run `/pipeline:review` first
2. **Typecheck** — runs `commands.typecheck` (skip if null)
3. **Lint** — runs `commands.lint`, fails if output matches `commands.lint_error_pattern` (skip if null)
4. **Tests** — runs `commands.test` (skip if null)
5. **Stage** — stages all changes except patterns in `commit.never_stage` (`.env`, `*.key`, etc.)
6. **Commit** — conventional commit format (`feat`, `fix`, `refactor`, etc.) with `commit.co_author`
7. **Push** — pushes to origin if `commit.push_after_commit` is true
8. **Post-commit hooks** — runs each command in `commit.post_commit_hooks[]`

**Arguments:**
- No arguments — full preflight + commit + push
- `reviewed:✓` — bypasses review gate (use after `/pipeline:review`)
- `push` — push unpushed commits (rebase if rejected)
- `status` — show branch state, commits ahead/behind

**Preflight step 3e — Agent template lint:**
If `lint_agents.enabled` is true and agent prompt templates changed, runs deterministic structural lint via `scripts/pipeline-lint-agents.js`. Reports LA-* findings. If `lint_agents.block_on_commit` is true, HIGH severity findings block the commit. See `/pipeline:lint-agents` for details.

**Skips all preflight** if only markdown files changed (no source files).

**After commit:** On feature branches, suggests `/pipeline:finish` for merge, PR, ship transition (Postgres + GitHub), and dashboard regeneration. On the base branch, reports done.

---

### `/pipeline:review`

Reviews changed code with severity tiers and confidence levels.

**What it does:**
1. Loads non-negotiable decisions from config (never flagged)
2. Runs typecheck — type errors are automatic red findings
3. Runs SAST scan (semgrep with 5 built-in security rules, or grep fallback) — security findings are automatic red
4. Gets the diff (staged + unstaged changes)
5. Runs lint on changed files only
6. Reads each changed file in full for context
7. Reviews against configured criteria
8. Reports findings in red/yellow/blue format with confidence
9. If GitHub issue tracking enabled: creates issues for 🔴 Must Fix findings and comments verdict on epic

**Arguments:**
- No arguments — reviews uncommitted changes (`git diff`)
- `--since <SHA>` — reviews a commit range (`git diff <SHA>..HEAD`). Use this after `/pipeline:build`, which outputs the baseline SHA.

**Output format:**
```
## Code Review

### Files reviewed
[list]

### Must fix
[file:line] — [description] [confidence: HIGH]
> [explanation + fix]

### Should fix
[file:line] — [description] [confidence: HIGH/MEDIUM]
> [explanation]

### Consider
[file:line] — [description] [confidence: HIGH/MEDIUM/LOW]
> [explanation]

### Verdict
[Clean / Minor issues / Issues found]
```

**Severity rules:**
- Red (must fix) — requires HIGH confidence. Bugs, security, crashes.
- Yellow (should fix) — requires HIGH or MEDIUM. Quality, dead code.
- Blue (consider) — any confidence. Suggestions.

**Adversarial mandate:** Empty reviews are failed reviews. If no issues are found, the reviewer must produce a "Clean Review Certificate" listing what was checked and why each check passed.

---

### `/pipeline:test`

Runs the test suite and produces a structured report.

**Arguments:**
- No arguments — runs `commands.test_verbose`
- `[pattern]` — runs matching tests only

---

### `/pipeline:triage`

Counts changed files and lines, classifies the change size, and recommends a workflow.

**Output:**
```
## Triage

Change size: MEDIUM [HIGH confidence]
Source files: 2 changed, 0 new
Lines: +45 / -12
Reason: 2 files in src/, known refactor pattern

Recommended workflow:
1. Implement the change
2. /pipeline:review
3. Fix any findings
4. /pipeline:commit reviewed:✓
```

You can override: "treat this as TINY" and it follows that workflow instead.

---

### `/pipeline:lint-agents`

Deterministic structural lint for agent prompt templates. Runs 7 checks across 3 categories (structural, security, consistency) without LLM dispatch.

**What it does:**
1. Scans prompt templates in skill directories
2. Runs 7 deterministic checks:
   - **Structural** — substitution checklist presence, placeholder-checklist sync, MODEL placeholder, dispatch block
   - **Security** — DATA tag attributes (role + do-not-interpret), IMPORTANT instruction presence
   - **Consistency** — placeholder syntax convention ({{}} for model/sections, [] for content)
3. Reports findings in LA-* format

**Arguments:**
- No arguments — lint all agent prompt templates
- `--changed` — lint only modified templates (based on git diff)
- `--fix` — auto-fix mechanical issues (missing DATA attributes, brace conventions)
- `--json` — machine-readable output
- `--exclude "pattern1,pattern2"` — skip templates matching patterns

**Output:** Structured LA-* findings report, one finding per issue.

**Config keys:** `lint_agents.enabled`, `lint_agents.block_on_commit`, `lint_agents.exclude`

**Token cost:** ~500 tokens. No LLM dispatch — `scripts/pipeline-lint-agents.js` runs outside context as a deterministic script.

**Integration:** Integrated into `/pipeline:commit` Step 3e. When `lint_agents.block_on_commit` is true, HIGH severity LA-* findings block the commit.

---

### `/pipeline:dashboard`

Generates a self-contained HTML project status report at `docs/dashboard.html`.

**What it does:**
1. Reads project config (milestone, knowledge tier, integrations)
2. Derives current phase from artifact existence (specs, plans, findings, tags)
3. Collects state data (tasks, findings, decisions from Postgres or files)
4. Collects git state (recent commits, branch, unpushed changes)
5. Lists open GitHub issues (if enabled)
6. Generates health summary and rule-based recommendations
7. Dispatches haiku for contextual AI recommendations (skipped on failure)
8. Substitutes all data into HTML template
9. Atomic write to `docs/dashboard.html`

**Arguments:**
- No arguments — generates dashboard from current state

**Auto-regeneration:** State-changing commands (`/pipeline:build`, `/pipeline:review`, `/pipeline:commit`, `/pipeline:remediate`, `/pipeline:audit`, `/pipeline:redteam`, `/pipeline:ui-review`, `/pipeline:release`, `/pipeline:brainstorm`, `/pipeline:plan`, `/pipeline:markdown-review`, `/pipeline:compliance`) regenerate the dashboard as a final step when `dashboard.enabled` is true.

**Dashboard sections:**
- **Health summary** — one-line status for executive glance
- **Phase indicator** — visual pipeline: Design → Plan → Build → Review → Release
- **What Happened** — recent commits, closed findings, completed tasks, decisions (last 10)
- **What's Active** — task progress, open findings by severity, GitHub issues, blockers
- **What's Next** — rule-based lifecycle recommendations + AI-generated contextual suggestions

**Tiered data:**
- **Postgres tier:** Rich — task counts, finding breakdowns, decision lists, cross-referenced recommendations
- **Files tier:** Degraded — artifact existence checks, finding file counts, git log

**Output:** Self-contained HTML file. Opens in any browser. Light/dark mode. Auto-refresh toggle. Zero outbound calls — all data embedded at generation time.

---

## Layer 2 — Structured Builds (features)

### `/pipeline:brainstorm`

Explores requirements, proposes approaches, and writes a spec. Used before LARGE changes.

**What it does:**
1. Checks for locked decisions (constraints from prior research/planning)
2. Explores the codebase for relevant patterns
3. Asks clarifying questions one at a time
4. Verifies technical assumptions — if unfamiliar tech is involved, dispatches parallel research agents (using `models.research`) with confidence scoring (HIGH/MEDIUM/LOW) before proposing approaches. Findings at HIGH confidence become locked constraints.
5. Proposes 2-3 approaches with trade-offs
6. Writes a spec document to `docs/specs/`
7. Dispatches a spec reviewer subagent for feedback
8. If GitHub issue tracking enabled: creates a feature epic issue and writes `github_epic: N` to spec metadata

---

### `/pipeline:architect`

Produces `docs/architecture.md` — a committed engineering standards document with typed contracts, security standards, and banned patterns. For LARGE/MILESTONE changes — MEDIUM changes get silent recon inside `/pipeline:plan`.

**What it does:**
1. Dispatches a recon agent (haiku) to scan the codebase for dependencies, patterns, and conventions
2. Selects relevant architectural domains from recon results (DATA, STATE, UI, API, INFRA, TEST — typically 2-4, not all six)
3. Launches parallel domain specialists (sonnet) — one per relevant domain
4. Lead architect (opus) synthesizes specialist outputs, resolves cross-domain conflicts, and produces decision records
5. Saves to `docs/architecture.md` and persists decisions to knowledge tier
6. Presents decisions to builder with confidence levels — LOW confidence items require builder review

**Decision records** are individually addressable and invalidatable. Each has a specific invalidation condition ("Invalidate if: deployment target changes from Vercel to self-hosted"). Build agents check relevant decisions and report `DONE_WITH_CONCERNS` if a real-world constraint conflicts.

**Override mechanism:** The builder can annotate any decision: `OVERRIDE: Using Drizzle — target is Cloudflare Workers, Prisma unsupported.` Overrides propagate as hard constraints to all downstream agents.

**Config:** `architect.*` in pipeline.yml. See the [configuration guide](guide.md#architect).

---

### `/pipeline:plan`

Creates an implementation plan from a spec.

**What it does:**
1. Runs silent architecture recon (haiku) to identify existing patterns and constraints
2. Reads the most recent spec (or one you specify)
3. Breaks it into bite-sized tasks (2-5 min each)
4. Orders tasks by dependency
5. Assigns model routing per task (haiku for mechanical, sonnet for integration)
6. Generates a QA strategy section with P0 scenarios and seam tests (MEDIUM+)
7. Validates implementation readiness — every task must name specific files, functions, and types
8. Saves to `docs/plans/`
9. If GitHub issue tracking enabled: propagates `github_epic` from spec to plan metadata and comments the plan summary on the epic

For LARGE+ changes with 3+ relevant domains and no `docs/architecture.md`, plan auto-invokes the full architect mode before planning.

---

### `/pipeline:build`

Executes a plan with fresh subagents.

**What it does:**
1. Records baseline commit SHA
2. For each task in the plan:
   - Dispatches an implementer subagent with only the task description, relevant files, and non-negotiable decisions
   - Implementer commits its work
   - Dispatches a reviewer subagent to check spec compliance + code quality
   - If issues found: fix agent dispatched, re-reviewed
3. If GitHub issue tracking enabled: comments build start/complete on the feature epic
4. Reports completion with baseline SHA for review

**Model routing:** Mechanical tasks (1-2 files, clear spec) get `models.cheap` (haiku). Integration tasks (multi-file) get `models.implement` (sonnet).

**When tasks fail:**
- **NEEDS_CONTEXT** — agent asks questions. You answer, it re-dispatches.
- **BLOCKED** — agent can't proceed. Build escalates to you or tries a more capable model.
- **Review issues** — reviewer finds problems. A fix agent is dispatched and the task is re-reviewed. Build does not move to the next task until the current one passes review.

Build never silently skips a failed task.

**Cost note:** Build dispatches 2 agents per task (implementer + reviewer). A 10-task plan is ~20 subagent calls. Audit dispatches N sector agents + 1 synthesis agent. Keep this in mind for larger plans — the quality is high but so is the token usage.

**Auto-verify (MEDIUM+):** After all tasks complete, build runs targeted QA verification automatically if `qa.auto_verify` is true. MEDIUM changes get 3-5 inline checks from the plan's QA strategy section. LARGE+ changes auto-invoke `/pipeline:qa verify` by default (parallel workers + seam testing, skippable with 'n').

**Output:**
```
Build complete. 8 tasks executed. Baseline: abc1234
Auto-verify: PASS
QA verify: PASS

What next?
1. Review + commit + finish
2. Review only
3. Skip review, commit directly
4. Leave as-is
```

---

### `/pipeline:qa plan`

Generates a standalone test plan with work packages, scenarios, and seam definitions. For LARGE/MILESTONE changes.

**What it does:**
1. Reads the spec, implementation plan, decision records, and existing test patterns
2. For MILESTONE: conducts a brief builder risk interview (5-7 questions)
3. Dispatches a QA planner (opus) that identifies risks at component interaction points — not just acceptance criteria tracing
4. Produces work packages with scenarios (P0/P1), seam test definitions, and a coverage matrix
5. Saves to `docs/plans/`

**Config:** `qa.*` in pipeline.yml. See the [configuration guide](guide.md#qa).

---

### `/pipeline:qa verify`

Executes a test plan with parallel QA workers and seam pass synthesis. For LARGE/MILESTONE changes.

**What it does:**
1. Locates the test plan (standalone or QA section from implementation plan)
2. Dispatches parallel QA workers (sonnet) — one per work package
3. Workers write tests with business-behavior intent comments (`// Verifies: expired coupons rejected at checkout (TS-007)`), run them, and report structured results
4. After all workers complete: QA lead (opus) runs the seam pass — tests ACROSS integration boundaries that no individual worker tested
5. Failure triage: every failure classified as code-is-wrong, test-is-wrong, flaky, or environment
6. Produces a test report with verdict (PASS/FAIL/PARTIAL) and coverage metrics
7. If GitHub issue tracking enabled: creates issues for code-is-wrong failures and comments verdict on epic

**MILESTONE fix-and-rerun:** If the verdict is FAIL, offers to fix `code-is-wrong` failures and re-verify affected work packages (max 1 retry cycle).

**Coverage metrics** are reported but never gated — no thresholds block builds. P0 AC coverage, P1 AC coverage, seam coverage, and code line coverage are all informational.

---

## Layer 3 — Security (pre-release)

### `/pipeline:redteam`

Security red team assessment with parallel domain specialists.

**What it does:**
1. Queries knowledge tier for past security decisions and gotchas
2. Presents token estimate and specialist list — you approve before any agents launch
3. Dispatches haiku recon agent to map attack surface (entry points, auth boundaries, data sinks)
4. Selects specialists based on project profile + detected framework
5. Launches parallel sonnet specialists — each with domain-specific + framework-specific checklists
6. Lead analyst (opus) synthesizes findings into exploit chains and risk matrix
7. Produces markdown report + optional standalone HTML artifact
8. Persists critical findings to knowledge tier
9. If GitHub issue tracking enabled: creates issues for CRITICAL/HIGH findings and comments summary on epic

**Arguments:**
- No arguments — full assessment with auto-selected specialists
- `white-box` / `black-box` — override mode from config
- `--specialists INJ,AUTH,XSS` — override auto-selection

**Modes:**
- **White-box** (default) — reads source code, full code analysis
- **Black-box** — probes running application at configured URL

**12 specialist domains:** INJ (Injection), AUTH (Authentication), XSS (Cross-Site Scripting), CSRF (Cross-Site Request Forgery), CRYPTO (Cryptography), CONFIG (Security Misconfiguration), DEPS (Dependency & Supply Chain), ACL (Access Control), RATE (Rate Limiting & DoS), DATA (Data Exposure), FILE (File & Path Safety), CERT (Certificate & Transport).

**SBOM generation:** During recon, the agent generates a CycloneDX 1.6 SBOM (`docs/findings/sbom-YYYY-MM-DD.cdx.json`) containing every dependency — direct, dev, and transitive — parsed from your lockfile. The DEPS specialist reads this as its primary package inventory. Controlled by `redteam.sbom` in config. Set `redteam.sbom.enabled: false` to skip.

**DEPS live audit:** The DEPS specialist runs the project's configured `commands.security_audit` command (e.g., `npm audit --json`, `pip audit -f json`) to query real-time vulnerability databases. It cross-references audit output with the SBOM artifact for complete coverage. Findings include CVE IDs, affected package versions, and cross-references against source code to distinguish actively-used packages from transitive-only exposure.

**Profile-aware:** Different project types get different specialists. A CLI tool skips XSS and CSRF. An API skips browser-specific domains.

**Framework-aware:** A Next.js injection specialist checks Server Actions. A Django one checks ORM escape hatches. Framework detection runs automatically.

**Output:** `docs/findings/redteam-[date].md` (+ `.html` if `redteam.html_report` is true), `docs/findings/sbom-[date].cdx.json` (if `redteam.sbom.enabled`)

**Token cost:** ~240-320K for a 10-specialist run. The command shows you the estimate before launching.

---

### `/pipeline:remediate`

Fixes findings from any pipeline workflow. Parses reports from red team, audit, review, UI review, or external sources, creates tickets (GitHub Issues / Postgres / files), batches fixes through the build/review/commit pipeline, and verifies with source-appropriate re-runs.

All finding sources produce identical artifacts — same issue format, same commit format, same tracking. Only the `source` and `category` fields differ.

**What it does:**
1. Locates the most recent findings report from `docs/findings/` (or one you specify)
2. Detects source type from filename prefix (redteam, audit, review, ui-review, external)
3. Dispatches haiku triage agent to parse any native format into uniform finding records
4. Writes tickets — GitHub issues (primary, with dedup check to avoid duplicating existing issues), Postgres findings table, or files (fallback)
5. Presents remediation plan — you approve before work starts
6. Executes fixes in batches with stateless agent dispatch:
   - **Quick wins** — single implementer agent (reads context from ticket, not inline)
   - **Medium effort** — implementer + reviewer (max 1 retry)
   - **Architectural** — opus planner breaks the fix into safe steps, then implementer + reviewer per step
7. Writes results back to tickets (comments on GitHub issues, status updates in DB)
8. Runs source-appropriate verification
9. Persists summary and closes tickets

**Arguments:**
- No arguments — auto-detects latest `docs/findings/*.md`
- `--source redteam` — latest `docs/findings/redteam-*.md`
- `--source audit` — latest `docs/findings/audit-*.md`
- `--source review` — latest `docs/findings/review-*.md`
- `--source ui-review` — latest `docs/findings/ui-review-*.md`
- `--source all` — merge all unremediated findings
- `--file path/to/file.md` — external report (QA, UX designer, etc.)

**Ticket backends (checked in priority order):**
1. **Issue Tracker** — when `platform.issue_tracker` is not `none`. The issue body IS the ticket. Agents read with `node scripts/platform.js issue view`.
2. **Postgres** — when `knowledge.tier == "postgres"`. Finding records in the `findings` table. Agents read with `pipeline-db.js get finding`.
3. **Files** — always available as fallback. Inline context in prompts (only case where this is necessary).

**Batch strategies:**
- `"effort"` (default) — quick wins first, then medium, then architectural. Maximizes early progress.
- `"severity"` — CRITICAL first regardless of effort. Addresses highest risk first.

**Issue creation thresholds:**
- `"all"` — every finding gets a GitHub issue
- `"medium-high"` (default) — CRITICAL and HIGH always, MEDIUM only if confidence HIGH
- `"high"` — CRITICAL and HIGH only

**Verification strategies** (configured per source in `remediate.verification`):
- `specialist-rerun` (redteam) — re-runs affected security specialists on modified files
- `sector-rerun` (audit) — re-runs affected audit sectors on modified files
- `review-rerun` (review) — re-runs review on changed files since baseline
- `screenshot` (ui-review) — re-captures and analyzes screenshot
- `none` (external) — skips verification

**Output:** One commit per finding (`fix: [ID] — [desc]`), tracking in `docs/findings/remediation-[date].md`, closed GitHub issues with commit SHAs, updated Postgres finding records.

---

### `/pipeline:purpleteam`

Aggregate security verification after a red team + remediation cycle. Verifies that fixes actually closed attack vectors, checks exploit chains are broken, extracts defensive patterns, and runs dependency audit.

**What it does:**
1. Reads the most recent red team report and remediation summary from `docs/findings/`
2. Dispatches parallel sonnet verifiers — one per fixed finding — to confirm each attack vector is closed
3. Runs ecosystem-native dependency audit (`commands.security_audit` from config)
4. Dispatches opus chain analyst to verify exploit chains are broken
5. Dispatches opus posture analyst to synthesize results and extract defensive rules
6. Updates GitHub issues with verification evidence (VERIFIED closes, REGRESSION/INCOMPLETE reopens)
7. Persists defensive rules to knowledge tier
8. Writes purple team report to `docs/findings/purpleteam-[date].md`

**Read-only assessment.** No source code is modified.

**Prerequisites:** A red team report (`docs/findings/redteam-*.md`) and a remediation summary (`docs/findings/remediation-*.md`) must exist. Run `/pipeline:redteam` then `/pipeline:remediate --source redteam` first.

**Verdicts per finding:**
- **VERIFIED** — attack vector confirmed closed with code-level evidence
- **REGRESSION** — fix introduced a new vulnerability or reopened a related vector
- **INCOMPLETE** — code changed but the specific exploitation scenario still works

**Verdicts per exploit chain:**
- **CHAIN_BROKEN** — at least one link verified-fixed, no alternative paths exist
- **CHAIN_WEAKENED** — some links fixed but alternative attack paths remain
- **CHAIN_INTACT** — no links in the chain were successfully fixed

**Posture ratings:** HARDENED (all critical/high verified, all chains broken), IMPROVED (most verified), PARTIAL (mixed), UNCHANGED (majority incomplete/regressed).

**Dependency audit:** Runs `commands.security_audit` from config (e.g., `npm audit --json`). Cross-references with DEPS findings from red team. Flags new advisories published since the red team ran.

**GitHub issue updates:** Verified findings get a comment with evidence and are closed. Regressions and incompletes reopen the issue with details. All status tracked via issue comments — no separate tracking needed.

**Token cost:** ~(N x 12K) + 55K for chain + posture analysis. A 10-finding verification is ~175K tokens. The command shows the estimate before launching.

**Output:** `docs/findings/purpleteam-[date].md`

---

### `/pipeline:compliance`

Maps red team findings (CWE IDs) to regulatory compliance controls and produces a coverage scope analysis. This is compliance preparation — not a compliance assessment.

**What it does:**
1. Locates the latest red team report in `docs/findings/`
2. Parses findings and extracts CWE IDs
3. Launches parallel framework agents (haiku) — one per enabled framework
4. Synthesis agent (opus) produces cross-framework analysis with scope analysis and evidence narrative
5. Generates markdown report + optional standalone HTML artifact
6. Persists to knowledge tier
7. Creates GitHub issues for Tier 1 coverage gaps (unmapped control families within automated scope)

**Prerequisites:** A red team report must exist in `docs/findings/`. `compliance.enabled` must be true in config.

**Supported frameworks:**
- **Tier 1** (official CWE crosswalks): NIST SP 800-53 Rev 5, PCI DSS 4.0
- **Tier 2** (inference-based): ISO/IEC 27001:2022, NIST CSF 2.0
- **Tier 3** (limited scope): SOC 2, GDPR, HIPAA

**Output vocabulary:** MAPPED (direct CWE→control match), RELATED (addresses related concern), OUTSIDE_AUTOMATED_SCOPE (requires organizational assessment). Never uses TESTED/UNTESTED/PASS/FAIL.

**Config:** `compliance.*` in pipeline.yml. See the [configuration guide](guide.md#compliance).

**Token cost:** ~(15K × framework count) + 25K synthesis [+ 7K HTML]. A 7-framework run is ~155K tokens.

**Output:** `docs/findings/compliance-[date].md` (+ `.html` if `compliance.html_report` is true)

---

### `/pipeline:debate`

Antagonistic design debate — stress-tests a spec with three parallel agents before planning. Dispatches Advocate, Skeptic, and Domain Practitioner to challenge assumptions from first principles.

**What it does:**
1. Reads the spec (from brainstorm output or user-specified path)
2. Presents the sell step with cost, benefit, and risk of skipping
3. Dispatches 3 parallel agents (sonnet):
   - **Advocate** — steelmans the design, argues against alternatives
   - **Skeptic** — attacks feasibility, scope creep, token economics, failure modes
   - **Practitioner** — grounds in real-world usage, existing tools, ecosystem expectations
4. Synthesizes into a structured verdict: disposition, points of agreement, contested points, invalidated assumptions, risk register
5. Saves verdict to `docs/findings/debate-[date]-[topic].md`

**Disposition outcomes:**
- `proceed` — design is sound, plan can begin
- `proceed-with-constraints` — design needs specific constraints (included in verdict)
- `rethink` — fundamental issues found, recommend re-running brainstorm

**Sell step defaults:**
- MEDIUM changes: offered but defaults to skip (y/N)
- LARGE+ changes: offered and defaults to run (Y/n)

**Integration with `/pipeline:plan`:** Plan reads the verdict file when present and injects debate constraints. For LARGE+ specs without a verdict, plan warns and offers to continue without debate.

**Config:** `debate.*` in pipeline.yml. See the [configuration guide](guide.md#debate).

**Token cost:** ~15-30K tokens (~$0.05-0.10), 30-60 seconds

---

### `/pipeline:security`

Full security assessment loop. Orchestrates red team → remediate → purple team [→ compliance] with user review gates between each phase.

**What it does:**
1. Runs `/pipeline:redteam` (find vulnerabilities)
2. Presents findings for review (user marks false positives)
3. Runs `/pipeline:remediate --source redteam` (fix confirmed findings)
4. Presents fixes for review
5. Runs `/pipeline:purpleteam` (verify fixes, assess posture)
6. If `compliance.enabled`: offers `/pipeline:compliance` (map findings to regulatory controls)

**Prerequisites:** Same as red team + remediate + purple team combined.

**User gates:** Three or four explicit approval points — after red team, after remediation, after purple team, and optionally before compliance. You can stop at any gate and resume manually with the individual commands.

**When to use:** Before beta or production releases. Replaces running the commands separately.

**Output:** All reports in `docs/findings/` plus GitHub issue updates.

---

## Layer 4 — Specialized Tools

### `/pipeline:audit`

Full codebase review with parallel sector agents.

**What it does:**
1. Runs Phase 0 grep preprocessing (configurable patterns like `console.log`, unguarded `await`)
2. Dispatches one review agent per sector (from `review.sectors[]` in config)
3. Each sector agent does a two-pass read of its files
4. A synthesis agent combines all sector reports:
   - Traces crash paths across sectors
   - Verifies dead exports
   - Detects cross-sector duplication
   - Escalates severity
   - Deduplicates findings
5. Produces unified report with confidence counts

**Read-only.** No source code is modified.

**First run:** If no sectors are configured, offers to auto-generate them from your directory structure.

---

### `/pipeline:markdown-review`

Full markdown health check across three tiers: file hygiene, information architecture, and A2A protocol. Scans plugin instruction files and user-generated markdown, then fixes what it finds.

**Process:**
1. Scanner (haiku) — mechanical data collection: line counts, cross-references, placeholder inventory, duplicate detection
2. Analyst (opus) — applies all three tiers to the scanner manifest, produces structured findings
3. User review — findings presented with fix options (auto, HIGH-only, individual, report-only)
4. Fixer (sonnet) — applies approved fixes batched by effort tier (quick, then medium)
5. Architectural findings are report-only — they require manual design decisions

**Three tiers:**
- **MR-HYG** (File Hygiene) — line counts, mixed concerns, frontmatter violations, duplicates, dead cross-references
- **MR-ARCH** (Information Architecture) — context budget analysis, reference data placement, embedding utilization
- **MR-A2A** (Agent Communication) — DATA tag compliance, output contract drift, config key coverage, handoff mismatches

**Finding format:** `MR-[TIER]-[NNN] | [SEVERITY] | [CONFIDENCE] | [file:line] | [category]`

**Severity:** HIGH (broken contracts, missing safety tags), MEDIUM (bloat, undocumented interfaces), LOW (improvement opportunities)

**Config:** `markdown_review.*` in pipeline.yml — `line_limit`, `fix_mode`, `tiers`, `exclude`, `inline_checklist`

**Token cost:** ~80-100K total (scanner at haiku rates, analyst at opus, fixer at sonnet per batch)

**Output:** Report saved to `docs/findings/markdown-review-YYYY-MM-DD.md` regardless of fix mode.

---

### `/pipeline:debug`

Systematic 4-phase root-cause diagnosis.

**Phases:**
1. Root cause — reproduce, trace, isolate
2. Pattern — is this a one-off or systemic?
3. Hypothesis — propose fix with confidence
4. Implementation — fix with verification

Never proposes a fix before Phase 1 is complete.

---

### `/pipeline:simplify`

Targeted code simplification for files flagged by `/pipeline:review` or `/pipeline:audit`.

**What it does:**
1. Reads the "Simplify candidates" block from the most recent review or audit output
2. For each flagged file, analyzes for:
   - SOLID violations (god objects, tight coupling, interface bloat)
   - Premature abstraction (helpers/utilities used once, config for a single case)
   - Dead code (unused exports, unreachable branches, commented-out blocks)
   - Over-engineering (feature flags for non-optional paths, unnecessary indirection)
3. Applies fixes directly — no review subagent (the simplification IS the review)

**When to use:** After `/pipeline:review` flags simplification candidates in its output. The review command identifies the files; simplify does the work.

**Does not re-review.** Simplify trusts the review's identification. If you want the simplified code reviewed again, run `/pipeline:review` afterward.

---

### `/pipeline:release`

Changelog generation + version bump + tag + optional deploy.

**What it does:**
1. Analyzes commits since last tag
2. Recommends version bump (major/minor/patch) from conventional commits
3. Runs tests one final time
4. Generates grouped changelog (features, fixes, other)
5. Bumps version in package.json/Cargo.toml/pyproject.toml
6. Creates git tag and pushes
7. Optionally creates GitHub release

---

### `/pipeline:ui-review`

Captures a screenshot (Chrome DevTools MCP or Playwright) and dispatches a haiku subagent to analyze layout, hit targets, text, and visual issues.

---

### `/pipeline:worktree`

Creates an isolated git worktree on a new branch. Used before LARGE changes when you want isolation from the main working tree.

---

### `/pipeline:finish`

Guides branch completion after implementation is done. Tests must pass before any merge/PR option is available.

**Options (tiered from most to least complete):**
1. Commit + merge + push (the full workflow — default)
2. Commit + merge locally (no push)
3. Push and create a Pull Request (requires `integrations.github.enabled`)
4. Keep the branch as-is
5. Discard the work (requires typed confirmation)

If you say "finish it" or "do it all", option 1 executes without further prompting. Pipeline always defaults to the most complete option — you only get asked when intent is genuinely ambiguous.

---

## Setup Commands

### `/pipeline:init`

Interactive project setup. Detects your environment, asks questions, generates `.claude/pipeline.yml`.

**Arguments:**
- `--quick` or `quick` — Auto-detect everything, make all decisions automatically, auto-install dependencies (Playwright, Postgres, Ollama embedding model). Zero user interaction. Prints a decision log at the end. Use `/pipeline:update` to adjust anything afterward.

**Environment detection** runs via two Node scripts (`scripts/pipeline-init-detect.js` and `scripts/pipeline-init-integrations.js`). These spawn subprocesses via argv array (no shell), probe TCP ports via `net.createConnection` (no `/dev/tcp`), and resolve Windows Postgres install paths via `process.env.ProgramFiles` (no hardcoded `/c/Program Files` literals). Runs cleanly on native Windows (`cmd.exe`, PowerShell) and under Git Bash regardless of install path spaces.

See the [configuration guide](guide.md) for what gets generated.

---

### `/pipeline:update`

Modify config after initial setup.

**Subcommands:**
- `/pipeline:update integrations` — re-probe available tools
- `/pipeline:update commands` — change test/lint/typecheck commands
- `/pipeline:update sectors` — reconfigure review sectors
- `/pipeline:update knowledge` — switch knowledge tier
- `/pipeline:update repo owner/repo` — set repo directly

---

### `/pipeline:knowledge`

Session tracking, decisions, gotchas, and search.

See the [configuration guide](guide.md#knowledge-tiers) for setup and all subcommands.

---

### `scripts/platform.js` — Platform Abstraction CLI

Unified interface for issue tracking and code hosting operations. All agents call this instead of platform-specific CLIs.

**Issue operations:**
```bash
node scripts/platform.js issue create --title "Title" --body "Body" --labels "label1,label2"
node scripts/platform.js issue comment <ref> --stdin          # Read body from stdin
node scripts/platform.js issue close <ref>
node scripts/platform.js issue list --labels "pipeline" --state open
node scripts/platform.js issue view <ref>
node scripts/platform.js issue edit <ref> --stdin
node scripts/platform.js issue reopen <ref>
node scripts/platform.js issue search "query" --state open --limit 5
```

**PR operations:**
```bash
node scripts/platform.js pr create --title "Title" --source feat/x --target main --stdin
node scripts/platform.js pr merge <ref> --squash --delete-branch
node scripts/platform.js pr comment <ref> --stdin
node scripts/platform.js pr diff <ref>
node scripts/platform.js pr view <ref>
```

**Auth verification:**
```bash
node scripts/platform.js auth check
```

**Behavior:**
- Reads platform config from `.claude/pipeline.yml` (`platform.*` section)
- Dispatches to GitHub (`gh`) or Azure DevOps (`az`) backend transparently
- All verification and retry (3 attempts, exponential backoff 2s/4s/8s) happens in Node.js code
- Exit 0 with ref/data on stdout = success. Exit 1 with error on stderr = failure
- Uses `execFile` (not `exec`) for shell safety — no injection via argument content
- `--stdin` flag reads long-form content from stdin to avoid shell escaping issues

---

## Auto-Persistence

Every state-changing command automatically persists its outputs to the configured knowledge tier. You never need to call `/pipeline:knowledge` manually — data flows silently as commands run.

**What gets persisted per command:**

| Command | Postgres Tier | Files Tier |
|---------|--------------|------------|
| `/pipeline:commit` | Decision (commit SHA + summary) | Nothing — too frequent |
| `/pipeline:review` | Findings + verdict decision | Nothing — findings in `docs/findings/` |
| `/pipeline:audit` | Findings + verdict decision | Decision only (audit verdicts are significant) |
| `/pipeline:build` | Session + task status updates | Session (rotated) |
| `/pipeline:debug` | Gotcha + decision | Gotcha only (root causes are always worth recording) |
| `/pipeline:brainstorm` | Decision + **roadmap task** (linked to GitHub epic if enabled) | Decision (only if locked) |
| `/pipeline:plan` | Tasks + planning decision | Nothing — tasks are in the plan file |
| `/pipeline:release` | Decision + session | Decision + session (rotated) |
| `/pipeline:finish` | Session + decision + **ship transition** (roadmap task → done, GitHub issue → closed, README roadmap regenerated) | Session (rotated) + decision (if locked) |
| `/pipeline:redteam` | Session + gotchas + decision | Gotchas (HIGH/CRITICAL only) + decision |
| `/pipeline:remediate` | Decision + gotchas + finding status | Gotchas (HIGH only) |
| `/pipeline:purpleteam` | Finding status + gotchas + decision | Gotchas (HIGH only) + decision |
| `/pipeline:compliance` | Session + decision | Decision (compliance mapping summary) |
| `/pipeline:debate` | Nothing — verdict in `docs/findings/` | Nothing — verdict in `docs/findings/` |
| `/pipeline:markdown-review` | Findings + decision | Nothing — findings in `docs/findings/` |

**If neither tier is configured**, the persistence block is a no-op. Commands still write their reports to `docs/findings/` as normal.

## State Synchronization

Pipeline maintains three tracking stores with a clear hierarchy:

| Store | Role | Updated By |
|-------|------|-----------|
| **Postgres** | Master source of truth | All commands (auto-persist) |
| **GitHub Issues** | Synced mirror — agent communication + human project tracking | brainstorm (creates epic + task), finish (closes on merge), remediate/purpleteam (finding issues) |
| **README roadmap** | Rendered view of Postgres | Dashboard regeneration (runs after every state-changing command) |

**Ship transition:** When `/pipeline:finish` merges a feature branch, it automatically: marks the Postgres roadmap task as done, closes the linked GitHub issue, and regenerates the README roadmap section.

**New features:** When `/pipeline:brainstorm` creates a GitHub epic, it also creates a linked Postgres task with `category=roadmap`, ensuring every feature is tracked from day one.

**`pipeline-db.js` task field updates:**

```
update task <id> issue_ref <N>        # Link task to issue/work-item
update task <id> readme_label "<text>" # Set README roadmap display label
update task <id> category <value>     # roadmap | build | finding | internal
```

## Checkpoints

Every point where the pipeline requires or recommends a human decision is a **checkpoint**, classified into three tiers. See `skills/checkpoints/SKILL.md` for the full registry with rendering rules and contributor guide.

| Tier | Behavior | Can Be Skipped? |
|------|----------|-----------------|
| **MUST** | Hard stop + rationalization prevention table | Never |
| **SHOULD** | Prompted with `(Y/n)` default-yes | Yes — skip is logged |
| **MAY** | Prompted with `(y/N)` default-no | Yes — skip is expected |

| ID | Command | Tier | Description |
|----|---------|------|-------------|
| `finish-tests-pass` | finish | MUST | Tests must pass before merge options |
| `finish-merge-verify` | finish | MUST | Re-run tests after merge |
| `finish-discard-confirm` | finish | MUST | Type "discard" to delete branch |
| `review-adversarial` | review | MUST | Must produce findings or clean certificate |
| `plan-coverage` | plan | MUST | Every spec requirement traces to a task |
| `build-qa-large` | build | SHOULD | QA verification for LARGE+ changes |
| `debate-large` | debate | SHOULD | Design debate for LARGE+ specs |
| `build-resume` | build | SHOULD | Confirm resume of interrupted build |
| `plan-no-debate` | plan | SHOULD | Warn when LARGE+ has no debate verdict |
| `remediate-proceed` | remediate | SHOULD | Confirm batch plan before executing fixes |
| `build-completion` | build | SHOULD | Post-build option selection |
| `finish-completion` | finish | SHOULD | Post-finish option selection |
| `debate-medium` | debate | MAY | Design debate for MEDIUM specs |

---

## Plugin Hooks

Pipeline registers hooks via `hooks/hooks.json`. The plugin manifest (`plugin.json`) declares `"hooks": "./hooks/"` — pointing to the hooks directory, from which the runtime loads `hooks.json`.

### `SessionStart` — Cache Sync

**Hook:** `hooks/sync-cache.mjs`
**Matcher:** `startup|resume` (pipe-delimited alternation — matches either the `startup` or `resume` SessionStart event type)
**Purpose:** Keeps the plugin cache in sync with source when working in the pipeline repo.

**Behavior:**
1. Reads `installed_plugins.json` to find the `pipeline@pipeline` entry
2. Exits early if CWD is not the pipeline repo (other projects use the stable cache)
3. Compares `git rev-parse HEAD` against the stored SHA
4. If they differ: deletes stale cache, copies source items to new cache directory, updates registry
5. Ensures the plugin is enabled in `.claude/settings.json`

**Synced items:** `.claude-plugin/`, `commands/`, `hooks/`, `rules/`, `scripts/`, `skills/`, `templates/`, `CLAUDE.md`, `LICENSE`, `README.md`

**Note:** Only committed changes are detected. Uncommitted edits require a commit before the next session picks them up. See [troubleshooting](troubleshooting.md) for manual sync instructions.
