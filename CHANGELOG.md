# Changelog

All notable changes to Pipeline are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
