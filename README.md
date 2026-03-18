# Pipeline

A config-driven development pipeline plugin for Claude Code. Merges size-routed quality gates with systematic TDD, debugging, and structured code review workflows.

## What It Does

Pipeline routes your work through the right amount of process based on change size:

| Size | Trigger | Process |
|------|---------|---------|
| **TINY** | 1 file, <30 lines | read → implement → `/pipeline:commit` |
| **MEDIUM** | 2-3 files, known pattern | grep → implement → `/pipeline:review` → fix → `/pipeline:commit` |
| **LARGE** | New feature, multi-file | `/pipeline:brainstorm` → `/pipeline:plan` → `/pipeline:build` → `/pipeline:review` → `/pipeline:commit` |
| **MILESTONE** | End of feature | `/pipeline:audit` → fix → `/pipeline:commit reviewed:✓` |

## Installation

```bash
# Add as a custom marketplace
claude plugin marketplace add djwmobley/pipeline

# Install the plugin (user-wide)
claude plugin install pipeline@pipeline --scope user

# Verify
claude plugin list
```

**During development:**
```bash
# Validate locally without installing
claude plugin validate ~/dev/pipeline
```

## Quick Start

```bash
# 1. In any project directory, run init:
/pipeline:init
# Answer the prompts — generates .claude/pipeline.yml

# 2. Make a small change, then commit with preflight gates:
/pipeline:commit

# 3. Before bigger changes, check the recommended workflow:
/pipeline:triage

# 4. All pipeline commands:
/pipeline:commit          # Preflight gates + commit + push
/pipeline:review          # Per-change quality review (🔴/🟡/🔵)
/pipeline:test            # Structured test report
/pipeline:triage          # What size is this change?
/pipeline:brainstorm      # Design before LARGE changes
/pipeline:audit           # Full codebase review
/pipeline:debug           # Systematic root-cause diagnosis
```

## Commands

### Core Workflow
| Command | Description |
|---------|-------------|
| `/pipeline:init` | Interactive project setup — generates `.claude/pipeline.yml` |
| `/pipeline:update` | Update config — re-detect integrations, change commands, sectors, etc. |
| `/pipeline:update integrations` | Re-probe available tools and update enabled/disabled |
| `/pipeline:update commands` | Change test/lint/typecheck commands |
| `/pipeline:update sectors` | Reconfigure review sectors |
| `/pipeline:update knowledge` | Switch knowledge tier (files ↔ postgres) |
| `/pipeline:update repo owner/repo` | Set repo directly |
| `/pipeline:triage` | Assess change size, recommend workflow |
| `/pipeline:commit` | Run preflight gates (typecheck, lint, test), commit, push |
| `/pipeline:commit reviewed:✓` | Bypass review gate for reviewed changes |
| `/pipeline:review` | Per-change quality review with 🔴/🟡/🔵 severity tiers |
| `/pipeline:test` | Run test suite, produce structured report |
| `/pipeline:test [pattern]` | Run matching tests only |

### Design & Planning (LARGE changes)
| Command | Description |
|---------|-------------|
| `/pipeline:brainstorm` | Explore requirements, propose approaches, write spec |
| `/pipeline:plan` | Create implementation plan from spec |
| `/pipeline:build` | Execute plan with subagent-driven development |

### Advanced
| Command | Description |
|---------|-------------|
| `/pipeline:audit` | Full codebase review — parallel sector agents + synthesis |
| `/pipeline:debug` | Systematic root-cause diagnosis (4 phases) |
| `/pipeline:simplify` | Targeted simplification of flagged files |
| `/pipeline:ui-review` | Screenshot capture + visual analysis |
| `/pipeline:worktree` | Create isolated git worktree |
| `/pipeline:finish` | Branch completion — merge, PR, keep, or discard |

### Knowledge (session tracking)

Files tier (default — no setup required):
| Command | Description |
|---------|-------------|
| `/pipeline:knowledge status` | Recent sessions, gotchas |
| `/pipeline:knowledge session N T "desc"` | Record session N with T tests |
| `/pipeline:knowledge gotcha "issue" "rule"` | Add a critical constraint |
| `/pipeline:knowledge decision "topic" "choice" "reason"` | Record an architectural decision |

Postgres tier (requires local Postgres — chosen during init):
| Command | Description |
|---------|-------------|
| `/pipeline:knowledge setup` | Create database + all tables (idempotent) |
| `/pipeline:knowledge status` | Session context — last 3 sessions, open tasks, gotchas |
| `/pipeline:knowledge session N T "desc"` | Record session N with T tests |
| `/pipeline:knowledge task new "title"` | Create a task |
| `/pipeline:knowledge task ID status` | Update task (pending/in_progress/done/deferred) |
| `/pipeline:knowledge gotcha "issue" "rule"` | Add a critical constraint |
| `/pipeline:knowledge decision "topic" "choice" "reason"` | Record a decision |
| `/pipeline:knowledge search "query"` | FTS keyword search over code index |
| `/pipeline:knowledge hybrid "query"` | FTS + vector hybrid search (best results) |
| `/pipeline:knowledge index` | Generate embeddings for code index entries |
| `/pipeline:knowledge add path "desc"` | Add/update a file in the code index |
| `/pipeline:knowledge check filepath` | Check file cache (HIT/MISS/STALE) |
| `/pipeline:knowledge query "SQL"` | Run raw SQL |

## Configuration

All project-specific config lives in `.claude/pipeline.yml`. Generated by `/pipeline:init`.

### Key Sections

**commands** — Tool commands for quality gates:
```yaml
commands:
  typecheck: "npx tsc --noEmit"    # null to disable
  lint: "npx eslint src/"           # null to disable
  lint_error_pattern: " error "
  test: "npx vitest run"
  test_verbose: "npx vitest run --reporter=verbose"
```

**routing** — Size thresholds:
```yaml
routing:
  source_dirs: ["src/"]
  tiny_max_files: 1
  tiny_max_lines: 30
  medium_max_files: 3
  review_gate_threshold: 3
```

**review** — Review configuration:
```yaml
review:
  non_negotiable:
    - "Supabase client singleton — intentional"
  phase0_patterns:
    - { pattern: "console\\.log", label: "console-log" }
  sectors:
    - { name: "Auth", id: "A", paths: ["src/auth/**"] }
  criteria: [ux, dead-code, framework-correctness, security, simplicity, solid]
```

**commit** — Git workflow:
```yaml
commit:
  co_author: "Claude Sonnet 4.6 <noreply@anthropic.com>"
  never_stage: [".env", "*.key", "credentials*"]
  push_after_commit: true
  post_commit_hooks: []    # e.g. ["node $PIPELINE_SCRIPTS/pipeline-embed.js index"]
```

**models** — Model routing:
```yaml
models:
  cheap: "haiku"           # Doc reviews, screenshot analysis, mechanical tasks
  explore: "haiku"         # Codebase search, file scanning
  implement: "sonnet"      # Write code
  review: "sonnet"         # Code review
  plan: "sonnet"           # Planning
  architecture: "opus"     # High-stakes decisions
```

**knowledge** — Session persistence:
```yaml
knowledge:
  tier: "files"     # "files" or "postgres"
```

**integrations** — Tool detection:
```yaml
integrations:
  sentry: { enabled: true, use_in: [debug] }
  github: { enabled: true, use_in: [commit, finish] }
  chrome_devtools: { enabled: true, use_in: [ui-review] }
```

## Supported Languages & Frameworks

Pipeline auto-detects your project type during `/pipeline:init`:

| Language | Detection | Default Commands |
|----------|-----------|-----------------|
| TypeScript/JS | `package.json` | tsc, eslint, vitest/jest |
| Rust | `Cargo.toml` | cargo test, clippy |
| Go | `go.mod` | go test, golangci-lint |
| Python | `pyproject.toml` | pytest, ruff |
| Java | `pom.xml` / `build.gradle` | mvn test, checkstyle |

Framework-specific review checks are auto-applied (React, Vue, Angular, Svelte).

## Knowledge Tiers

### Files (default, zero setup)
- Session history in `docs/sessions/*.md`
- Decisions in `DECISIONS.md`
- Gotchas in `docs/gotchas.md`
- Commands: `status`, `session`, `gotcha`, `decision`
- No semantic search, no structured queries
- Good for: small projects, quick setups, < 10 sessions

### Postgres (power option)

Full knowledge management system with three scripts:

| Script | Purpose |
|--------|---------|
| `pipeline-db.js` | Sessions, tasks, decisions, gotchas, raw SQL |
| `pipeline-embed.js` | Code index embeddings + semantic/hybrid search |
| `pipeline-cache.js` | File hash cache + FTS keyword search |

**Capabilities:**
- **Semantic search** — find related work across all past sessions using vector similarity
- **Hybrid search** — 30% FTS + 70% vector for best-of-both-worlds results
- **Structured queries** — tasks with status tracking, decisions with rationale, gotchas with rules
- **File hash cache** — skip re-reading files that haven't changed (SHA256-based)
- **Code index** — FTS-searchable file descriptions with optional vector embeddings
- **Session continuity** — numbered sessions with test counts and summaries

**Requirements:**
- PostgreSQL on localhost:5432 (or configured host/port)
- pgvector extension (optional — degrades to FTS-only without it)
- Ollama with mxbai-embed-large (optional — only needed for semantic search)

**Setup:**
```bash
# 1. Set knowledge tier in pipeline.yml
knowledge:
  tier: "postgres"
  database: "pipeline_context"

# 2. Create database and tables
/pipeline:knowledge setup

# 3. (Optional) Install Ollama + embedding model for semantic search
ollama pull mxbai-embed-large

# 4. Start using it
/pipeline:knowledge status
/pipeline:knowledge hybrid "authentication flow"
```

**Session protocol (in CLAUDE.md):**
```markdown
## Session Protocol

**Start:**
/pipeline:knowledge status
/pipeline:knowledge hybrid "<what you're doing>"

**End (after commit):**
/pipeline:knowledge index
/pipeline:knowledge session <N> <test_count> "<summary>"
```

## Design Philosophy

1. **Config over convention** — everything project-specific lives in `pipeline.yml`
2. **Size routing is the differentiator** — skip ceremony for small changes
3. **Severity tiers** — 🔴/🟡/🔵 is strictly better than single-tier review
4. **TDD and verification are principles** — embedded in build/commit, not hard gates
5. **Non-negotiable respect** — never flag intentional architectural decisions

## License

MIT
