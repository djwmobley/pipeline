# Changelog

All notable changes to Pipeline are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.3.0-alpha] — 2026-04-25

This release focuses on three areas: Windows safety hardening across the init, orientation, and finish commands (replacing POSIX bash blocks with Node scripts that use `execFileSync` argv arrays throughout); per-feature token tracking via transcript mining (new `scripts/pipeline-cost.js` helper and `feature_token_usage` Postgres table); and inter-session memory handling, where semantic recall now covers the full knowledge tier — decisions, sessions, gotchas, and six new memory-surface tables (memory_entries, session_chunks, policy_sections, checklist_items, incidents, corpus_files) are all wired into the hybrid search path, an `options.num_ctx` knob prevents Ollama from pre-truncating long inputs, and the embedder now gracefully skips tables that exist on paper but have not yet been populated by a loader.

### Fixed

- **`/pipeline:init` Playwright detection false-negative on Windows** — `scripts/pipeline-init-integrations.js` at the playwright probe invoked `execFileSync('npx', ['playwright', '--version'])`. On Windows, `npx` is a `.cmd` shim (npm-installed) — same CVE-2024-27980 hardening that bit pnpm in #103. Bare `npx` either couldn't be resolved (ENOENT) or raised EINVAL on Node ≥22, so `playwright.installed` always reported `false` even when Playwright was installed and reachable. Quick-mode auto-install at `commands/init.md` would then try to re-install, which would itself fail for the same reason. Fix: introduced `commandVersionWin(candidates, args)` helper wrapping `runWinBin` from #103, and switched the playwright probe to `['npx.cmd', 'npx.exe', 'npx']`. gh, pg_isready, and ollama paths unchanged — all three ship as `.exe` on Windows and work without the shim. Verified on Node 24.13.0 / Windows: `playwright.installed: true` with `version_if_known: "Version 1.59.1"` (previously false/null). Applies the pattern Judge ruling id=53 flagged as out-of-scope for #47. (#102)

### Added

- **Per-feature token tracking via transcript mining** — new `scripts/pipeline-cost.js` helper and `feature_token_usage` Postgres table (also added to `scripts/setup-knowledge-db.sql` for fresh `/pipeline:init` on new projects). Mines Claude Code session transcripts at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`, filters by `gitBranch`, aggregates token usage (input / output / cache-creation 5m / cache-creation 1h / cache-read), cache-hit percentage, tool-call counts by name, and writes one row per feature (branch + pr_number + github_issue). Four subcommands: `session-total`, `feature-total --branch X`, `trailer --branch X` (emits 5-line git commit trailer), `record --branch X [--pr N] [--issue M] [--notes T]` (inserts DB row + emits trailer). No USD cost stored — Claude Max is flat-rate; the signal is relative volume, cache-hit ratio, and tool-call distribution across features for identifying cache-inefficient or tool-heavy patterns. Wired into `/pipeline:finish` is a follow-up enhancement tracked separately. (#106)
- **`knowledge.num_ctx` config knob** — `scripts/lib/shared.js` `loadConfig()` now reads `knowledge.num_ctx`, and `ollamaEmbed()` includes `options.num_ctx` in the `/api/embed` request when the key is present. This prevents Ollama from pre-truncating long inputs — memory bodies, session summaries, agent gap descriptions — before they reach the embedding model. Default is unset for backward compatibility; recommended value is `8192` to cover any embedding model up through `nomic-embed-text` without further code change (mxbai-embed-large still caps at its native 512-token context window — the knob is forward-compatible and harmless when set higher than the model's window). Set in `.claude/pipeline.yml` for this project. Documented in `docs/guide.md`. (sub-issue #110 of #109)
- **Inter-session memory schema** — six new tables in `scripts/setup-knowledge-db.sql` for the auto-memory and session-recall stack: `memory_entries` (mirrors `~/.claude/projects/<encoded-cwd>/memory/*.md`), `session_chunks` (chunked transcripts), `policy_sections` (CLAUDE.md and standards docs), `checklist_items` (process gates), `incidents` (post-incident notes), `corpus_files` (PDF/doc corpus). Each table receives an `embedding vector(1024)` column, a `TSVECTOR` FTS column, and appropriate GIN/btree indexes following the existing schema pattern. `scripts/pipeline-embed.js` `TABLES` array extended with matching `selectCols` / `textFn` / `updateSql` / `label` / `snippet` entries so hybrid search spans the full memory surface. The loader (file-to-row sync for each table) is intentionally out of scope for this release and will land in a separate workstream. (sub-issue #110 of #109)

### Fixed

- **`/pipeline:init` Azure DevOps verification subagent** — `commands/init.md` Step 1c azure-devops branch (186-241, ~56 lines of inline bash) replaced with a `Task` tool dispatch of the `init-azure-devops` subagent (new `skills/init-azure-devops/SKILL.md`). The subagent reads the SKILL's dispatch contract and error-interpretation table, invokes `scripts/pipeline-init-azure-devops.js` (new helper with `verify`, `detect-process-template`, `set-defaults` subcommands), and emits a structured JSON verification result for init.md to apply to pipeline.yml's `platform.azure_devops.*` block. Error-interpretation table covers TF400813 (PAT scope), TF400818 (project not found), TF401027 (unauthorized), extension-missing, `az`-not-found, network timeout, and unknown-custom-template advisory. Separation of concerns: mechanical `az` CLI calls in the script, LLM-cognitive error interpretation in the SKILL. `AZURE_DEVOPS_EXT_PAT` never logged; presence flag only in JSON. Quick-mode degradation: verification failure falls through to `platform.issue_tracker: "none"` silently. **Scope-expansion on discovery:** see "Windows `.cmd`/`.bat` invocation hardening" entry below — testing the new helper on Node 24 surfaced a latent EINVAL regression in the `runPnpm` helper shipped with #100/#47; both helpers now route through a shared `runWinBin` in `scripts/lib/shared.js` that handles the Node CVE-2024-27980 hardening correctly. (#103)
- **Windows `.cmd`/`.bat` invocation hardening** — `scripts/lib/shared.js` now exports `runWinBin(candidates, args, opts)` and `quoteForCmd(arg)`. `runWinBin` handles (1) PATHEXT resolution by iterating the candidate list on ENOENT and (2) Node ≥22's CVE-2024-27980 "BatBadBut" hardening, which refuses to invoke `.cmd`/`.bat` files via `execFileSync` with `shell: false`, returning EINVAL — `runWinBin` reroutes to `cmd.exe /d /s /c <bin> <quoted-args...>` via `execFileSync`'s argv path, and treats cmd.exe's "is not recognized as an internal or external command" stderr as an ENOENT-equivalent so candidate iteration continues. `quoteForCmd` escapes args for cmd.exe's command-line grammar (double-quote wrapping with internal quote-doubling) so ADO project names and paths with spaces survive the shell round-trip. Retroactively corrects the `runPnpm` helper in `scripts/pipeline-init-knowledge.js` shipped with #100/#47 — the original `.cmd` → `.exe` → bare candidate order only caught ENOENT, not EINVAL, and would have failed the pnpm-install path on every Windows user with Node ≥22 (the already-set-up short-circuit and `--dry-run` acceptance tests in #47 didn't exercise the pnpm invocation path). Applied to both `pipeline-init-knowledge.js` (pnpm) and the new `pipeline-init-azure-devops.js` (az). (#103, retroactive to #100)
- **`/pipeline:init` knowledge-tier setup Windows safety** — `commands/init.md` Step 4 orchestration (pnpm install → `pipeline-db.js` setup → verify → `ollama pull` → directory creation) extracted to `scripts/pipeline-init-knowledge.js`. Two subcommands: `setup-postgres` (with `--project-name`, `--embedding-model`, `--skip-pnpm-install`, `--skip-ollama-pull`, `--dry-run`) and `setup-files`. Uses `execFileSync` with argv arrays (no shell strings) and resolves `pnpm` via `pnpm.cmd`/`pnpm.exe`/`pnpm` candidate order on Windows (Node's `execFileSync` doesn't resolve PATHEXT). Setup is idempotent: an early probe against the admin `postgres` DB short-circuits (`already_set_up: true`) when the project DB already has the `sessions` table. Graceful degradation for Ollama: if the embedding model pull fails or Ollama is unreachable, Postgres tier still works for FTS keyword search. Engagement-variant prompts (expert/guided/full-guidance for tier choice, pnpm-install ask, embedding-model ask) preserved inline in `commands/init.md` — LLM cognition stays, mechanics extract. (#100)
- **`/pipeline:finish` leaves stale remote-tracking ref after PR merge** — Option 1 (PR merge + push) in `commands/finish.md` now runs `git pull --prune` after checkout of base. Without `--prune`, `refs/remotes/origin/[feature-branch]` persisted as an orphan after `gh pr merge --delete-branch` removed the real remote branch. Default git does not prune on fetch/pull; `--prune` is passed explicitly so the finish flow doesn't depend on `fetch.prune` being set in user git config. Two orphan refs were observed accumulating from the last two Option 1 finishes. Extended rationalization-prevention table with the "`git pull` will clean up remote-tracking refs" failure mode. (#98)
- **`/pipeline:finish` leaves stale local branch ref after PR merge** — Option 1 (PR merge + push) path in `commands/finish.md` now appends `git branch -D [feature-branch]` after `git pull` on base. `gh pr merge --delete-branch` only removes the remote ref; the local ref previously persisted. `-D` (force) is required because squash merges break `git branch -d`'s ancestry check — the squashed commit on base has no ancestral link to the feature-branch commits. Safe because `platform.js pr merge` only exits 0 when GitHub confirms the merge, and the squashed commit is pulled into base before the delete. Added rationalization-prevention table documenting the failure mode. (#96)
- **`/pipeline:init` environment detection Windows safety** — `commands/init.md` Step 1 (project detection, ~48 bash lines) and Step 3 (integration probe, ~64 bash lines) replaced with two Node scripts: `scripts/pipeline-init-detect.js` and `scripts/pipeline-init-integrations.js`. Both use `execFileSync` with argv arrays (no shell interpretation), `fs.existsSync` / `fs.readdirSync` (no POSIX for-loops), Node's `net.createConnection` (no `/dev/tcp` port probes), `http.request` (no `curl`), and `process.env.ProgramFiles` for Windows Postgres install detection (no hardcoded `/c/Program Files/PostgreSQL/*` MSYS paths). init now runs reliably under native Windows `cmd.exe` / PowerShell and Git Bash with spaces in install paths. Detection output is structured JSON; downstream init steps (1b gap-fill, 2 profile inference, 4 knowledge tier, 5 config generation) consume the same semantic fields the previous bash emitted. (#94)
- **Orientation preflight Windows safety** — `skills/orientation/SKILL.md` Step 1 chained-Bash block (`pwd && git rev-parse ... | wc -l`) replaced with `scripts/preflight-probe.js`, a Node script using `execFileSync` with argv arrays. Same six-field JSON output (cwd, repo_root, branch, head, worktree, dirty_count), no POSIX dependency. Eliminates silent breakage on `cmd.exe` and PowerShell; removes Git Bash fragility under install paths with spaces. All 8 phase commands delegate to SKILL.md via the caller-contract abstraction — byte-for-byte sync verified across `commands/{audit,build,commit,qa,redteam,review,remediate,finish}.md`. (#92, #93)
- **`decisions` / `sessions` / `gotchas` orphaned from semantic search** — `scripts/setup-knowledge-db.sql` already contained `ALTER TABLE … ADD COLUMN IF NOT EXISTS embedding vector(1024)` blocks for these three tables, each wrapped in an `EXCEPTION WHEN undefined_object` handler so setup would not hard-fail when pgvector was absent. Pipeline databases created before pgvector was installed silently skipped column creation at setup time; re-running setup with pgvector present is idempotent and adds the columns retroactively. On `pipeline_pipeline` this restored 79 rows (45 decisions, 22 sessions, 12 gotchas) to the embedding pipeline — `node scripts/pipeline-embed.js index` now embeds them via mxbai-embed-large at 1024 dimensions, and hybrid search returns them for the first time. Closes the gap flagged in memory `feedback_embed_completions.md` as CRITICAL ("every Postgres record from a completion/decision/gotcha must be vectorized for semantic search"). (sub-issue #110 of #109)
- **Embedder skips absent or empty tables** — `cmdSearch` and `cmdHybrid` in `scripts/pipeline-embed.js` previously assumed every entry in the `TABLES` array mapped to a real, populated table. Fresh projects without all tables, or projects on older schemas, would error or warn on absent tables. Both functions now guard with a `tableExists` check followed by an empty-row-count check, and silently skip any table that fails either guard. This is a defensive prerequisite for the new memory tables added in this release (which exist in the schema but remain empty until a loader populates them) and a general-fitness improvement for any deployment whose database schema lags the codebase. (sub-issue #110 of #109)

### Process

PRs #92–#108 in this release were reviewed through a parallel `pipeline_architect` workspace — a separate Claude Code instance not part of this distribution. The relevant fact for this release is that those PRs went through external review before merge; the `pipeline_architect` workspace's operating method (its dispatch protocol, state vocabulary, and direct interaction with Gemini Pro as Consultant) lives outside this repository and is documented separately in that workspace.

Six new memory tables (`memory_entries`, `session_chunks`, `policy_sections`, `checklist_items`, `incidents`, `corpus_files`) are added to the schema in this release. Tables matching this schema are populated in some external workspaces by mechanisms outside this plugin; what those mechanisms are, and how they correspond to a loader Pipeline could ship, is a design question rather than a port-an-existing-thing question. Tracked under epic #109.

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
