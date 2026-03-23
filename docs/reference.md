# Command Reference

All Pipeline commands, their arguments, and what they do.

## Everyday Commands

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

## Design & Build Commands

### `/pipeline:research`

Dispatches parallel research agents to investigate technical unknowns before planning.

**When to use:** Before brainstorm/plan, when the task involves an unfamiliar API, a decision with multiple viable approaches, or anything where AI training data may be stale.

**What it does:**
1. Parses your request into 2-4 independent research questions
2. Checks for prior research (Postgres tier: semantic search)
3. Dispatches one agent per question in parallel
4. Synthesizes findings with confidence scores
5. Stores results (Postgres or `docs/research/`)
6. Hands off to brainstorm/plan with research context

---

### `/pipeline:brainstorm`

Explores requirements, proposes approaches, and writes a spec. Used before LARGE changes.

**What it does:**
1. Checks for locked decisions (constraints from prior research/planning)
2. Explores the codebase for relevant patterns
3. Asks clarifying questions one at a time
4. Proposes 2-3 approaches with trade-offs
5. Writes a spec document to `docs/specs/`
6. Dispatches a spec reviewer subagent for feedback

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

## Advanced Commands

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

**Profile-aware:** Different project types get different specialists. A CLI tool skips XSS and CSRF. An API skips browser-specific domains.

**Framework-aware:** A Next.js injection specialist checks Server Actions. A Django one checks ORM escape hatches. Framework detection runs automatically.

**Output:** `docs/security/redteam-[date].md` (+ `.html` if `redteam.html_report` is true)

**Token cost:** ~240-320K for a 10-specialist run. The command shows you the estimate before launching.

---

### `/pipeline:remediate`

Fixes security findings from a red team report. Parses findings, creates GitHub issues, batches fixes through the build/review/commit pipeline, and verifies with specialist re-runs.

**What it does:**
1. Locates the most recent red team report (or one you specify)
2. Dispatches haiku triage agent to parse all findings into structured data
3. Presents remediation plan — finding count, batches, issues to create — you approve before work starts
4. Creates GitHub issues for findings above your configured threshold
5. Creates knowledge tier tasks for tracking
6. Executes fixes in batches:
   - **Quick wins** — single implementer agent, no reviewer
   - **Medium effort** — implementer + reviewer with fix loop
   - **Architectural** — opus planner breaks the fix into safe steps, then implementer + reviewer per step
7. Reports progress between batches with commit SHAs
8. Re-runs affected specialist domains to verify fixes
9. Persists summary to knowledge tier

**Arguments:**
- No arguments — uses most recent `docs/security/redteam-*.md`
- `[path]` — use a specific report file

**Batch strategies:**
- `"effort"` (default) — quick wins first, then medium, then architectural. Maximizes early progress.
- `"severity"` — CRITICAL first regardless of effort. Addresses highest risk first.

**Issue creation thresholds:**
- `"all"` — every finding gets a GitHub issue
- `"medium-high"` (default) — CRITICAL and HIGH always, MEDIUM only if confidence HIGH
- `"high"` — CRITICAL and HIGH only

**Verification:** After all fixes, re-runs the specialist domains that had findings. Compares original count vs remaining vs new findings introduced by fixes.

**Output:** Commits per finding (or per step for architectural), tracking in `docs/security/remediation-[date].md` or Postgres tasks, closed GitHub issues with commit SHAs.

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

Targeted simplification of files flagged by review.

Receives a file list from `/pipeline:review` simplify candidates. Reviews each for SOLID violations, premature abstraction, and dead code. Applies fixes.

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

Guides branch completion after implementation is done.

**Options:**
1. Merge back to base branch locally
2. Push and create a Pull Request (requires `integrations.github.enabled`)
3. Keep the branch as-is
4. Discard the work (requires typed confirmation)

Tests must pass before merge/PR options are available.

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
