# Changelog

All notable changes to Pipeline are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed

- **`/pipeline:init` Playwright detection false-negative on Windows** — `scripts/pipeline-init-integrations.js` at the playwright probe invoked `execFileSync('npx', ['playwright', '--version'])`. On Windows, `npx` is a `.cmd` shim (npm-installed) — same CVE-2024-27980 hardening that bit pnpm in #103. Bare `npx` either couldn't be resolved (ENOENT) or raised EINVAL on Node ≥22, so `playwright.installed` always reported `false` even when Playwright was installed and reachable. Quick-mode auto-install at `commands/init.md` would then try to re-install, which would itself fail for the same reason. Fix: introduced `commandVersionWin(candidates, args)` helper wrapping `runWinBin` from #103, and switched the playwright probe to `['npx.cmd', 'npx.exe', 'npx']`. gh, pg_isready, and ollama paths unchanged — all three ship as `.exe` on Windows and work without the shim. Verified on Node 24.13.0 / Windows: `playwright.installed: true` with `version_if_known: "Version 1.59.1"` (previously false/null). Applies the pattern Judge ruling id=53 flagged as out-of-scope for #47. (#102)

### Added

- **Per-feature token tracking via transcript mining** — new `scripts/pipeline-cost.js` helper and `feature_token_usage` Postgres table (also added to `scripts/setup-knowledge-db.sql` for fresh `/pipeline:init` on new projects). Mines Claude Code session transcripts at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, filters by `gitBranch`, aggregates token usage (input / output / cache-creation 5m / cache-creation 1h / cache-read), cache-hit percentage, tool-call counts by name, and writes one row per feature (branch + pr_number + github_issue). Four subcommands: `session-total`, `feature-total --branch X`, `trailer --branch X` (emits 5-line git commit trailer), `record --branch X [--pr N] [--issue M] [--notes T]` (inserts DB row + emits trailer). No USD cost stored — Claude Max is flat-rate; the signal is relative volume, cache-hit ratio, and tool-call distribution across features for identifying cache-inefficient or tool-heavy patterns. Wired into `/pipeline:finish` is a follow-up enhancement tracked separately. (#106)

### Fixed

- **`/pipeline:init` Azure DevOps verification subagent** — `commands/init.md` Step 1c azure-devops branch (186-241, ~56 lines of inline bash) replaced with a `Task` tool dispatch of the `init-azure-devops` subagent (new `skills/init-azure-devops/SKILL.md`). The subagent reads the SKILL's dispatch contract and error-interpretation table, invokes `scripts/pipeline-init-azure-devops.js` (new helper with `verify`, `detect-process-template`, `set-defaults` subcommands), and emits a structured JSON verification result for init.md to apply to pipeline.yml's `platform.azure_devops.*` block. Error-interpretation table covers TF400813 (PAT scope), TF400818 (project not found), TF401027 (unauthorized), extension-missing, `az`-not-found, network timeout, and unknown-custom-template advisory. Separation of concerns: mechanical `az` CLI calls in the script, LLM-cognitive error interpretation in the SKILL. `AZURE_DEVOPS_EXT_PAT` never logged; presence flag only in JSON. Quick-mode degradation: verification failure falls through to `platform.issue_tracker: "none"` silently. **Scope-expansion on discovery:** see "Windows `.cmd`/`.bat` invocation hardening" entry below — testing the new helper on Node 24 surfaced a latent EINVAL regression in the `runPnpm` helper shipped with #100/#47; both helpers now route through a shared `runWinBin` in `scripts/lib/shared.js` that handles the Node CVE-2024-27980 hardening correctly. (#103)
- **Windows `.cmd`/`.bat` invocation hardening** — `scripts/lib/shared.js` now exports `runWinBin(candidates, args, opts)` and `quoteForCmd(arg)`. `runWinBin` handles (1) PATHEXT resolution by iterating the candidate list on ENOENT and (2) Node ≥22's CVE-2024-27980 "BatBadBut" hardening, which refuses to invoke `.cmd`/`.bat` files via `execFileSync` with `shell: false`, returning EINVAL — `runWinBin` reroutes to `cmd.exe /d /s /c <bin> <quoted-args...>` via `execFileSync`'s argv path, and treats cmd.exe's "is not recognized as an internal or external command" stderr as an ENOENT-equivalent so candidate iteration continues. `quoteForCmd` escapes args for cmd.exe's command-line grammar (double-quote wrapping with internal quote-doubling) so ADO project names and paths with spaces survive the shell round-trip. Retroactively corrects the `runPnpm` helper in `scripts/pipeline-init-knowledge.js` shipped with #100/#47 — the original `.cmd` → `.exe` → bare candidate order only caught ENOENT, not EINVAL, and would have failed the pnpm-install path on every Windows user with Node ≥22 (the already-set-up short-circuit and `--dry-run` acceptance tests in #47 didn't exercise the pnpm invocation path). Applied to both `pipeline-init-knowledge.js` (pnpm) and the new `pipeline-init-azure-devops.js` (az). (#103, retroactive to #100)
- **`/pipeline:init` knowledge-tier setup Windows safety** — `commands/init.md` Step 4 orchestration (pnpm install → `pipeline-db.js` setup → verify → `ollama pull` → directory creation) extracted to `scripts/pipeline-init-knowledge.js`. Two subcommands: `setup-postgres` (with `--project-name`, `--embedding-model`, `--skip-pnpm-install`, `--skip-ollama-pull`, `--dry-run`) and `setup-files`. Uses `execFileSync` with argv arrays (no shell strings) and resolves `pnpm` via `pnpm.cmd`/`pnpm.exe`/`pnpm` candidate order on Windows (Node's `execFileSync` doesn't resolve PATHEXT). Setup is idempotent: an early probe against the admin `postgres` DB short-circuits (`already_set_up: true`) when the project DB already has the `sessions` table. Graceful degradation for Ollama: if the embedding model pull fails or Ollama is unreachable, Postgres tier still works for FTS keyword search. Engagement-variant prompts (expert/guided/full-guidance for tier choice, pnpm-install ask, embedding-model ask) preserved inline in `commands/init.md` — LLM cognition stays, mechanics extract. (#100)
- **`/pipeline:finish` leaves stale remote-tracking ref after PR merge** — Option 1 (PR merge + push) in `commands/finish.md` now runs `git pull --prune` after checkout of base. Without `--prune`, `refs/remotes/origin/[feature-branch]` persisted as an orphan after `gh pr merge --delete-branch` removed the real remote branch. Default git does not prune on fetch/pull; `--prune` is passed explicitly so the finish flow doesn't depend on `fetch.prune` being set in user git config. Two orphan refs were observed accumulating from the last two Option 1 finishes. Extended rationalization-prevention table with the "`git pull` will clean up remote-tracking refs" failure mode. (#98)
- **`/pipeline:finish` leaves stale local branch ref after PR merge** — Option 1 (PR merge + push) path in `commands/finish.md` now appends `git branch -D [feature-branch]` after `git pull` on base. `gh pr merge --delete-branch` only removes the remote ref; the local ref previously persisted. `-D` (force) is required because squash merges break `git branch -d`'s ancestry check — the squashed commit on base has no ancestral link to the feature-branch commits. Safe because `platform.js pr merge` only exits 0 when GitHub confirms the merge, and the squashed commit is pulled into base before the delete. Added rationalization-prevention table documenting the failure mode. (#96)
- **`/pipeline:init` environment detection Windows safety** — `commands/init.md` Step 1 (project detection, ~48 bash lines) and Step 3 (integration probe, ~64 bash lines) replaced with two Node scripts: `scripts/pipeline-init-detect.js` and `scripts/pipeline-init-integrations.js`. Both use `execFileSync` with argv arrays (no shell interpretation), `fs.existsSync` / `fs.readdirSync` (no POSIX for-loops), Node's `net.createConnection` (no `/dev/tcp` port probes), `http.request` (no `curl`), and `process.env.ProgramFiles` for Windows Postgres install detection (no hardcoded `/c/Program Files/PostgreSQL/*` MSYS paths). init now runs reliably under native Windows `cmd.exe` / PowerShell and Git Bash with spaces in install paths. Detection output is structured JSON; downstream init steps (1b gap-fill, 2 profile inference, 4 knowledge tier, 5 config generation) consume the same semantic fields the previous bash emitted. (#94)
- **Orientation preflight Windows safety** — `skills/orientation/SKILL.md` Step 1 chained-Bash block (`pwd && git rev-parse ... | wc -l`) replaced with `scripts/preflight-probe.js`, a Node script using `execFileSync` with argv arrays. Same six-field JSON output (cwd, repo_root, branch, head, worktree, dirty_count), no POSIX dependency. Eliminates silent breakage on `cmd.exe` and PowerShell; removes Git Bash fragility under install paths with spaces. All 8 phase commands delegate to SKILL.md via the caller-contract abstraction — byte-for-byte sync verified across `commands/{audit,build,commit,qa,redteam,review,remediate,finish}.md`. (#92, #93)

## [0.2.0-alpha] — 2026-03-26

V2 agent rewrite — code-based orchestrator, store-read pattern, and review circuit quality.

### Features

- Code-based orchestrator (`scripts/orchestrator.js`) — 13-step state machine, content-blind routing, `workflow_state` Postgres table, failure routing, loopback
- Data access layer (`scripts/pipeline-context.js`) — 9 query functions for structured context retrieval
- Architect command (`commands/architect.md`) — produces `docs/architecture.md` with typed contracts, security/testing standards, banned patterns
- Auto-embed (`tryEmbed` in shared.js) — vectorizes entries on insert, degrades gracefully if Ollama offline
- Semantic search — `workflow_discovery`, `agent_rewrites`, `code_index`, `findings` all vectorized
- `/pipeline:lint-agents` — deterministic structural lint for agent prompt templates. 7 checks across 3 categories (structural, security, consistency). Integrated into `/pipeline:commit` Step 3e. Config section `lint_agents` in pipeline.yml.

### Agent Rewrites (21/23)

- V2 store-read pattern — agents read their own context from stores (Postgres, GitHub, build-state, docs/architecture.md) instead of receiving pasted DATA blocks
- Three-store A2A reporting contract — every agent writes to Postgres + GitHub issue + build-state on completion
- ANTI-RATIONALIZATION blocks on all 18 prompt templates (role-specific per agent)
- Reporting Model documentation on all agents (self-reporting or orchestrator-delegated)
- Engagement style system in init (expert/guided/full-guidance)
- Security policy in init (every-feature/milestone/on-demand)

### Review Circuit Quality

- Cross-file contract verification — placeholder checklists traced across prompt templates and parent SKILL.md files
- Structural completeness audit — required v2 sections verified, dangling references caught
- Fallback symmetry — read/write pairs, GitHub-disabled guards, shell input validation
- Fix quality requirements — every HIGH finding requires replacement text + rationale + verification instruction
- Full audit of all 21 shipped agents against these 4 rules (42 findings fixed across 19 files)

### Other

- Search Efficiency directive in CLAUDE.md — Glob for file patterns, Read for full context, Grep only when location unknown

## [0.1.0-alpha] — 2026-03-24

Initial alpha release. Everything shipped to date in a single baseline.

### Features

- Size-routed quality gates — TINY/MEDIUM/LARGE/MILESTONE classification determines process
- Model routing — automatic haiku/sonnet/opus assignment by task complexity
- Config-driven architecture — single `pipeline.yml` per project
- Commit preflight gate chain — typecheck, lint, test, review gate with hard stop
- Parallel sector audit with cross-sector synthesis
- Security lifecycle — red team, remediate, purple team as a structured loop
- SBOM generation — CycloneDX 1.6 with transitive dependencies from lockfile parsing
- Knowledge tiers — files (markdown) or Postgres (semantic search via Ollama)
- Integration detection with graceful fallbacks (Postgres, Ollama, GitHub CLI, Chrome, Sentry, Figma, Stitch, PostHog)
- Cross-domain destructive operation guards (git, database, files)
- Big 4 dimensional awareness — functionality, usability, performance, security across all agent prompts
- Research folded into brainstorm verification gate
- Build crash recovery with `.claude/build-state.json` checkpoints
- Worktree lifecycle management — health check for merged, stale, dirty, orphaned worktrees
- Pre-inlined context for subagent dispatch
- Quick init mode (`--quick`) — zero-interaction setup with auto-detection and auto-install
- Project profile system — auto-detection of SPA, fullstack, mobile, API, CLI, library
- Phase 0 grep preprocessing for review and red team
- Severity tiers with confidence requirements
- Dashboard, UI review, markdown review, debug, test, simplify, release commands

### Documentation

- HTML docs page with dark theme and sticky navigation
- Command reference with all 24 commands, arguments, output formats, token costs
- Configuration guide with full `pipeline.yml` reference
- Security overview for non-technical stakeholders
- Prerequisites with fast track
- Attribution with detailed source project analysis
- Big 4 framework concept document
- Documentation manifest for change tracking
