# Command Reference

All Pipeline commands, their arguments, and what they do. Commands are grouped by layer — most users only need Layer 1.

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

**Skips all preflight** if only markdown files changed (no source files).

---

### `/pipeline:review`

Reviews changed code with severity tiers and confidence levels.

**What it does:**
1. Loads non-negotiable decisions from config (never flagged)
2. Runs typecheck — type errors are automatic red findings
3. Gets the diff (staged + unstaged changes)
4. Runs lint on changed files only
5. Reads each changed file in full for context
6. Reviews against configured criteria
7. Reports findings in red/yellow/blue format with confidence

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

**Auto-regeneration:** State-changing commands (`/pipeline:build`, `/pipeline:review`, `/pipeline:commit`, `/pipeline:remediate`, `/pipeline:audit`, `/pipeline:redteam`, `/pipeline:ui-review`, `/pipeline:release`, `/pipeline:brainstorm`, `/pipeline:plan`, `/pipeline:markdown-review`) regenerate the dashboard as a final step when `dashboard.enabled` is true.

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

---

### `/pipeline:plan`

Creates an implementation plan from a spec.

**What it does:**
1. Reads the most recent spec (or one you specify)
2. Breaks it into bite-sized tasks (2-5 min each)
3. Orders tasks by dependency
4. Assigns model routing per task (haiku for mechanical, sonnet for integration)
5. Validates implementation readiness — every task must name specific files, functions, and types
6. Saves to `docs/plans/`

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
3. Reports completion with baseline SHA for review

**Model routing:** Mechanical tasks (1-2 files, clear spec) get `models.cheap` (haiku). Integration tasks (multi-file) get `models.implement` (sonnet).

**When tasks fail:**
- **NEEDS_CONTEXT** — agent asks questions. You answer, it re-dispatches.
- **BLOCKED** — agent can't proceed. Build escalates to you or tries a more capable model.
- **Review issues** — reviewer finds problems. A fix agent is dispatched and the task is re-reviewed. Build does not move to the next task until the current one passes review.

Build never silently skips a failed task.

**Cost note:** Build dispatches 2 agents per task (implementer + reviewer). A 10-task plan is ~20 subagent calls. Audit dispatches N sector agents + 1 synthesis agent. Keep this in mind for larger plans — the quality is high but so is the token usage.

**Output:**
```
Build complete. 8 tasks executed.

Review with: /pipeline:review --since abc1234
Then commit with: /pipeline:commit reviewed:✓
```

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
4. Writes tickets — GitHub issues (primary), Postgres findings table, or files (fallback)
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
1. **GitHub Issues** — when `integrations.github.enabled`. The issue body IS the ticket. Agents read with `gh issue view`.
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

### `/pipeline:security`

Full security assessment loop. Orchestrates red team → remediate → purple team with user review gates between each phase.

**What it does:**
1. Runs `/pipeline:redteam` (find vulnerabilities)
2. Presents findings for review (user marks false positives)
3. Runs `/pipeline:remediate --source redteam` (fix confirmed findings)
4. Presents fixes for review
5. Runs `/pipeline:purpleteam` (verify fixes, assess posture)

**Prerequisites:** Same as red team + remediate + purple team combined.

**User gates:** Three explicit approval points — after red team, after remediation, after purple team. You can stop at any gate and resume manually with the individual commands.

**When to use:** Before beta or production releases. Replaces running the three commands separately.

**Output:** All three reports in `docs/findings/` plus GitHub issue updates.

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
| `/pipeline:brainstorm` | Decision | Decision (only if locked) |
| `/pipeline:plan` | Tasks + planning decision | Nothing — tasks are in the plan file |
| `/pipeline:release` | Decision + session | Decision + session (rotated) |
| `/pipeline:finish` | Session + decision | Session (rotated) + decision (if locked) |
| `/pipeline:redteam` | Session + gotchas + decision | Gotchas (HIGH/CRITICAL only) + decision |
| `/pipeline:remediate` | Decision + gotchas + finding status | Gotchas (HIGH only) |
| `/pipeline:purpleteam` | Finding status + gotchas + decision | Gotchas (HIGH only) + decision |
| `/pipeline:markdown-review` | Findings + decision | Nothing — findings in `docs/findings/` |

**If neither tier is configured**, the persistence block is a no-op. Commands still write their reports to `docs/findings/` as normal.
