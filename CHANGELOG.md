# Changelog

All notable changes to Pipeline are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
