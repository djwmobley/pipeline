# Attribution

> **Alpha** — Pipeline is under active development. Content may change between releases.

Pipeline is a synthesis. It was built by studying three open-source projects, running a structured evaluation, and merging the strongest ideas from each into a new architecture with original additions.

## How the Evaluation Worked

We ran a structured debate with 10 AI agents:
- **4 proponents** (one per framework, minimal cross-knowledge) — argued for their framework's strengths
- **4 opponents** (full cross-knowledge of all frameworks) — argued against each framework's weaknesses
- **1 negotiator** (full context) — found compatible ideas and resolved conflicts
- **1 judge** (full context) — made final decisions on what to adopt, adapt, or reject

The goal was best-of-breed: take the strongest idea from each source, reject what doesn't fit, and identify gaps none of them fill.

## What Came From Where

### [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent / Prime Radiant

**License:** MIT

The foundational influence. Pipeline's skill-based architecture, subagent-driven development pattern, and markdown-as-executable-instruction approach all trace back to Superpowers.

**Adopted directly:**
- **Adversarial review mandate** — reviews must find issues or prove code is flawless with specific evidence. Empty "looks good" reviews are failed reviews.
- **Anti-rationalization patterns** — tables of thoughts that signal the agent is rationalizing past a gate (e.g., "this is close enough" → it is not). These measurably improve compliance.
- **Persuasion psychology** — imperative language and HARD-STOP blocks in skill files. The insight that LLMs respond to the same persuasion techniques that work on humans.
- **Brainstorming → planning → execution flow** — the multi-phase pipeline from creative exploration to implementation.
- **Subagent dispatch pattern** — fresh agent per task with post-task review, preventing context accumulation.
- **Worktree isolation** — git worktrees for safe feature development.
- **Branch completion workflow** — structured options (merge, PR, keep, discard) with test verification gates.

**Adapted (not direct copy):**
- Superpowers runs full ceremony on every change. Pipeline added size routing to skip unnecessary process.
- Superpowers' review is single-tier. Pipeline added severity tiers (🔴 HIGH / 🟡 MEDIUM / 🔵 LOW) with confidence requirements.

### [GSD-2](https://github.com/gsd-build/gsd-2) by gsd-build

**License:** MIT

The research and confidence scoring system.

**Adopted directly:**
- **Research phase** — dispatching parallel agents to investigate technical unknowns before planning. Originally a standalone `/pipeline:research` command inspired by GSD's approach, now folded into `/pipeline:brainstorm` as a verification gate (step 4) that triggers when unfamiliar technology is involved.
- **Confidence levels on all assertions** — HIGH (verified in code), MEDIUM (strong inference), LOW (speculation). Applied throughout review, brainstorm research gate, and build output.
- **Decision locks** — constraints captured during research/planning that cannot be overridden during implementation without explicit unlocking.
- **Fresh context per task** — each subagent starts clean with only its task description and relevant files, preventing quality degradation as context accumulates. GSD calls this "context engineering."

**Adopted later (post-competitive analysis, March 2026):**
- **Build crash recovery** — GSD uses lock files, PID monitoring, `completed-units.json`, and auto-resume. Pipeline adopted the checkpoint concept as `.claude/build-state.json` — simpler (no PID monitoring, no exponential backoff) but covers the critical case of resuming interrupted multi-task builds.
- **Worktree lifecycle management** — GSD detects merged branches, stale worktrees (14+ days), dirty working directories, and shows safety status. Pipeline adopted these as a health check step before worktree creation.
- **Pre-inlined context for subagent dispatch** — GSD inlines task plans, decision registers, and prior summaries into dispatch prompts with compression levels. Pipeline adopted the concept (decision register + prior task summaries + framework detection) without GSD's compression levels.

**Adapted:**
- GSD's agent profiles (named personas with backstories) were rejected — they add token overhead without measurable quality improvement. Pipeline uses model routing instead (haiku/sonnet/opus by task complexity).
- GSD's cost tracking was not adopted — useful but outside Pipeline's scope.

### [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) by BMad Code, LLC

**License:** MIT

The implementation readiness gate.

**Adopted directly:**
- **Implementation readiness requirement** — plans must name specific files to create/modify, function signatures, data types, and API shapes before execution begins. If a spec is too vague, planning stops and asks for clarification.
- **Scale-adaptive planning** — the insight that planning depth should match project complexity. Pipeline implements this as size routing (TINY gets no planning, LARGE gets full planning).

**Rejected:**
- BMAD's 34+ persona files (PM, Architect, Scrum Master, etc.) were rejected — they segment knowledge that works better unified, and the persona overhead doesn't improve output quality for a solo developer workflow.
- BMAD's "story" and "epic" file structure was rejected — too heavyweight for the single-config-file approach.
- BMAD's wave-based execution was rejected — Pipeline's per-task subagent dispatch is more granular.

## What Pipeline Contributed Originally

These features don't trace to any of the three source projects:

- **Size routing** — TINY/MEDIUM/LARGE/MILESTONE classification that determines how much process to apply. This is Pipeline's core differentiator. None of the source projects adjust ceremony to change size.
- **Model routing** — automatic assignment of haiku/sonnet/opus based on task complexity. Cheaper models for mechanical work, capable models for judgment calls.
- **Config-driven architecture** — a single `pipeline.yml` file replaces all hardcoded paths, commands, frameworks, and patterns. Move between projects by running init.
- **Commit preflight gate chain** — typecheck → lint → test → review gate, with a hard stop that resists LLM rationalization. Configurable thresholds and nullable gates.
- **Parallel sector audit** — codebase split into configured sectors, each reviewed by a parallel agent, then synthesized by a cross-sector agent that traces crash paths and finds dead exports.
- **Phase 0 grep preprocessing** — configurable regex patterns scanned before review agents dispatch, focusing attention on known risk patterns.
- **Severity tiers with confidence requirements** — 🔴 HIGH / 🟡 MEDIUM / 🔵 LOW findings where red requires HIGH confidence (verified in code), preventing false alarms from blocking commits.
- **Knowledge tiers** — files tier (zero setup, markdown) or Postgres tier (semantic search, structured queries, cross-project transfer). Each project gets its own database.
- **Project profile system** — auto-detection of project type (SPA, fullstack, mobile, API, CLI, library) with profile-specific review criteria and security checklists.
- **Integration detection** — runtime probing for available tools (Postgres, Ollama, GitHub CLI, Chrome DevTools, Playwright, Sentry) with graceful fallbacks and no silent installs.
- **Release pipeline** — changelog generation from conventional commits, version bumping across package ecosystems (npm, cargo, pip), git tagging, and optional GitHub release creation.
- **Security lifecycle** — red team → remediate → purple team as a structured loop with per-finding state tracking and verification.
- **Cross-domain destructive operation guards** — hard stop before any data-destroying action across git, databases, and files. The agent must name the action, state intent, state what will be permanently lost, and get explicit confirmation — with a rationalization prevention table because LLMs will talk themselves into "this is just cleanup" without it.
- **Big 4 dimensional awareness** — every agent prompt evaluates functionality, usability, performance, and security as dimensions in tension. The weight varies by role: the PM agent explores tradeoffs, the engineer flags concerns, the reviewer verifies all four. See the [Big 4 framework](big-4.md) for the full concept.
- **Inter-session memory subsystem** — twelve embedded Postgres tables (project state plus six inter-session-memory tables) reachable through a single hybrid FTS + pgvector search. Mirrors Claude Code's file-based auto-memory, holds chunked session transcripts for "what did we decide three weeks ago about X?" recall, and addresses CLAUDE.md / standards docs by section. Local-only via Ollama — no API keys, no cloud. Defensive schema-lag tolerance means projects on older versions degrade gracefully. See [memory.md](memory.md).

Back to the [README](../README.md).
