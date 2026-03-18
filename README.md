# Pipeline

A config-driven development pipeline plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Routes your work through the right amount of process — from zero-ceremony single-file fixes to full subagent-driven feature builds with parallel code review.

## The Idea

Most AI coding tools treat every change the same. A one-line typo fix gets the same ceremony as a greenfield feature. Pipeline fixes this with **size routing**:

| Size | Trigger | What Happens |
|------|---------|--------------|
| **TINY** | 1 file, <30 lines | read, implement, commit |
| **MEDIUM** | 2-3 files, known pattern | implement, review, commit |
| **LARGE** | New feature, multi-file | brainstorm, plan, build (subagents), review, commit |
| **MILESTONE** | End of feature | full codebase audit (parallel sector agents), fix, commit |

Everything is driven by a single config file (`.claude/pipeline.yml`) generated during setup. No hardcoded paths, commands, or framework assumptions.

## Installation

```bash
# Install the plugin
claude plugin install pipeline --scope user

# In any project directory
/pipeline:init
```

Init detects your project type, tools, and integrations, then generates `.claude/pipeline.yml`. Takes about a minute.

## Commands

### Everyday

| Command | What It Does |
|---------|-------------|
| `/pipeline:commit` | Preflight gates (typecheck, lint, test) + commit + push |
| `/pipeline:review` | Per-change code review with severity tiers (red/yellow/blue) |
| `/pipeline:test` | Run tests, produce structured pass/fail report |
| `/pipeline:triage` | Assess change size, recommend workflow |

### Design & Build (LARGE changes)

| Command | What It Does |
|---------|-------------|
| `/pipeline:research` | Parallel research agents for technical unknowns |
| `/pipeline:brainstorm` | Explore requirements, propose approaches, write spec |
| `/pipeline:plan` | Create implementation plan from spec |
| `/pipeline:build` | Execute plan — fresh subagent per task with post-task review |

### Advanced

| Command | What It Does |
|---------|-------------|
| `/pipeline:audit` | Full codebase review — parallel sector agents + synthesis |
| `/pipeline:debug` | Systematic 4-phase root-cause diagnosis |
| `/pipeline:simplify` | Targeted simplification of flagged files |
| `/pipeline:release` | Changelog + version bump + tag + deploy |
| `/pipeline:ui-review` | Screenshot capture + visual analysis |
| `/pipeline:worktree` | Isolated git worktree for feature work |
| `/pipeline:finish` | Branch completion — merge, PR, keep, or discard |

### Setup & Config

| Command | What It Does |
|---------|-------------|
| `/pipeline:init` | Interactive project setup |
| `/pipeline:update` | Re-detect integrations, change commands, sectors, knowledge tier |
| `/pipeline:knowledge` | Session tracking, decisions, gotchas, semantic search |

## How It Works

### Config-Driven

Everything project-specific lives in `.claude/pipeline.yml`:

- **commands** — your typecheck, lint, and test commands (auto-detected from package.json, Cargo.toml, go.mod, pyproject.toml)
- **routing** — source directories and size thresholds
- **review** — non-negotiable decisions, grep patterns, sector definitions, criteria
- **models** — which Claude model handles which job (haiku explores, sonnet implements, opus decides)
- **knowledge** — session persistence (markdown files or Postgres with semantic search)
- **integrations** — auto-detected tools (Postgres, Ollama, GitHub CLI, Chrome DevTools, Playwright, Sentry)

### Quality Gates

`/pipeline:commit` runs preflight checks before every commit:

1. **Review gate** — if source files changed >= threshold, require `/pipeline:review` first
2. **Typecheck** — run your type checker
3. **Lint** — run your linter, fail on errors
4. **Tests** — run your test suite, fail on failures
5. **Stage** — never stages `.env`, `*.key`, `credentials*`, `node_modules/`
6. **Commit** — conventional commit format with co-author attribution
7. **Push** — automatic if configured

### Adversarial Review

Reviews use an adversarial mandate — every review MUST produce findings OR an explicit "Clean Review Certificate" explaining what was checked and why no issues were found. Empty "looks good" reviews are failed reviews.

Findings include confidence levels (HIGH = verified in code, MEDIUM = strong inference, LOW = possible) and severity tiers:
- **Red** — bugs, security issues, crashes. Must be HIGH confidence.
- **Yellow** — quality issues, dead code. HIGH or MEDIUM confidence.
- **Blue** — suggestions. Any confidence, but must be stated.

### Subagent Architecture

For LARGE changes, `/pipeline:build` dispatches a fresh subagent per task. Each agent receives only its task description, relevant file contents, and non-negotiable decisions — no accumulated context. This prevents quality degradation as work progresses.

Post-task review runs after each implementation, catching issues before they compound. Build records a baseline commit SHA so `/pipeline:review` can diff across all tasks.

### Knowledge Tiers

**Files** (default, zero setup) — session history in `docs/sessions/*.md`, decisions in `DECISIONS.md`, gotchas in `docs/gotchas.md`. Works fine, no search.

**Postgres** (power option) — semantic search across sessions, structured task/decision/gotcha queries, file hash caching, embedding-powered code index. Each project gets its own database. Requires local PostgreSQL; Ollama adds vector search on top of keyword search.

## Supported Projects

Pipeline works with any language or framework. Init auto-detects:

| Language | Detection | Default Commands |
|----------|-----------|-----------------|
| TypeScript/JS | `package.json` | tsc, eslint, vitest/jest |
| Rust | `Cargo.toml` | cargo test, clippy |
| Go | `go.mod` | go test, golangci-lint |
| Python | `pyproject.toml` | pytest, ruff |

Project profiles (SPA, fullstack, mobile, API, CLI, library) configure review criteria and security checklists automatically.

## Dependencies

**Required:** Claude Code, Git.

**Optional (auto-detected by init):**

| Tool | What It Adds | Fallback |
|------|-------------|----------|
| PostgreSQL | Knowledge tier with semantic search | Files tier (markdown) |
| Ollama + mxbai-embed-large | Vector similarity search | Keyword search |
| GitHub CLI (`gh`) | PR creation from `/pipeline:finish` | Push + browser |
| Chrome DevTools / Playwright | Screenshot capture for UI review | Provide screenshots manually |
| Sentry | Auto-pull errors in `/pipeline:debug` | Reproduce manually |

## Acknowledgments & Attribution

Pipeline is a best-of-breed synthesis. It was built by studying three open-source projects, running a structured evaluation (proponent/opponent debate + synthesis + judge), and merging the strongest ideas from each into a new architecture.

### [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent / Prime Radiant

MIT License

The foundational influence. Pipeline's skill-based architecture, subagent-driven development pattern, and markdown-as-executable-instruction approach all trace back to Superpowers. Specific contributions:

- **Adversarial review mandate** — reviews must find issues or prove code is flawless with evidence
- **Anti-rationalization patterns** — tables of thoughts that mean "stop, you're rationalizing past a gate"
- **Persuasion psychology** — imperative language and HARD-STOP blocks that measurably improve LLM compliance
- **Brainstorming → planning → execution flow** — the multi-phase creative-to-implementation pipeline
- **Subagent dispatch pattern** — fresh agent per task with post-task review
- **Worktree isolation** — git worktrees for safe feature development
- **Branch completion workflow** — structured options for merge, PR, keep, or discard

### [GSD-2](https://github.com/gsd-build/gsd-2) by gsd-build

MIT License

The research and confidence scoring system. GSD's approach to treating AI training data as hypothesis rather than fact directly shaped Pipeline's research command and confidence requirements. Specific contributions:

- **`/pipeline:research` command** — parallel research agents dispatched before planning, with confidence-scored findings
- **Confidence levels on all assertions** — HIGH (verified), MEDIUM (inferred), LOW (speculative), applied throughout review, research, and build
- **Decision locks** — constraints captured during research/planning that cannot be overridden during implementation without explicit unlocking
- **Fresh context per task** — each subagent starts clean with only its task + files, preventing context rot (GSD calls this "context engineering")

### [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) by BMad Code, LLC

MIT License

The implementation readiness gate. BMAD's insistence that plans must be concrete enough to implement without further design decisions directly influenced Pipeline's planning validation. Specific contributions:

- **Implementation readiness requirement** — plans must name specific files, function signatures, data types, and API shapes before execution begins
- **Scale-adaptive planning** — the insight that planning depth should match project complexity (Pipeline implements this as size routing)

### What Pipeline Added

The original contributions that don't trace to the above sources:

- **Size routing** — TINY/MEDIUM/LARGE/MILESTONE classification that determines how much process to apply
- **Model routing** — automatic assignment of haiku/sonnet/opus based on task complexity
- **Config-driven everything** — single `pipeline.yml` replaces all hardcoded assumptions
- **Commit preflight gates** — typecheck → lint → test → review gate chain with configurable thresholds
- **Parallel sector audit** — codebase split into sectors for parallel review with cross-sector synthesis
- **Phase 0 grep preprocessing** — configurable pattern scanning before review agents dispatch
- **Severity tiers with confidence requirements** — red/yellow/blue with mandatory confidence levels per tier
- **Knowledge tiers** — files (zero setup) or Postgres (semantic search), with cross-project transfer
- **Project profile system** — auto-detection of project type with profile-specific review criteria and security checklists
- **Integration detection** — runtime probing for available tools with graceful fallbacks
- **Release pipeline** — changelog generation, version bumping, tagging across package ecosystems

## License

MIT — see [LICENSE](LICENSE).
