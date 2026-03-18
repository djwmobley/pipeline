---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*)
description: Interactive project setup — detects tools, creates .claude/pipeline.yml
---

## Pipeline Init

You are the pipeline setup agent. Your job is to detect the project environment and generate a `.claude/pipeline.yml` config file.

---

### Step 1 — Detect project type and tools

Run these probes IN PARALLEL:

```bash
# Project type
ls package.json Cargo.toml go.mod pyproject.toml setup.py pom.xml build.gradle requirements.txt 2>/dev/null

# Git remote
git remote get-url origin 2>/dev/null

# Current branch
git branch --show-current

# Test runner detection
cat package.json 2>/dev/null | grep -E '"(vitest|jest|mocha|ava)"'
ls Cargo.toml 2>/dev/null && echo "cargo test"
ls go.mod 2>/dev/null && echo "go test ./..."
ls pyproject.toml 2>/dev/null && grep -E "pytest|unittest" pyproject.toml 2>/dev/null

# Linter detection
cat package.json 2>/dev/null | grep -E '"(eslint|biome|oxlint)"'

# Type checker detection
cat package.json 2>/dev/null | grep -E '"typescript"'

# Source directories
ls -d src/ lib/ app/ pkg/ cmd/ internal/ 2>/dev/null
```

---

### Step 1b — Fill in gaps

**Git remote:** If `git remote get-url origin` returned nothing (no remote configured), ask:
> "No git remote detected. What's the GitHub repo for this project? (e.g., `owner/repo`, or press Enter to skip)"

If the user provides a value, use it for `project.repo`. If skipped, set `project.repo: null`.

**Project name:** If no `name` field in package.json/Cargo.toml/etc., use the directory name.

---

### Step 2 — Detect integrations

Run these probes IN PARALLEL:

```bash
# Environment variables
echo "SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:+SET}"
echo "FIGMA_ACCESS_TOKEN=${FIGMA_ACCESS_TOKEN:+SET}"
echo "POSTHOG_API_KEY=${POSTHOG_API_KEY:+SET}"
echo "GAMMA_API_KEY=${GAMMA_API_KEY:+SET}"
echo "GITHUB_TOKEN=${GITHUB_TOKEN:+SET}"

# Port probes
curl -s --connect-timeout 2 http://localhost:5432 2>&1 | head -1 || echo "postgres:no"
curl -s --connect-timeout 2 http://localhost:11434/api/tags 2>&1 | head -1 || echo "ollama:no"
curl -s --connect-timeout 2 http://localhost:9222/json/version 2>&1 | head -1 || echo "chrome:no"

# CLI tools
npx playwright --version 2>/dev/null || echo "playwright:no"
gh --version 2>/dev/null || echo "gh:no"
```

For each detected integration, explain what it adds to the pipeline.
For missing integrations, show the install/setup command.

---

### Step 3 — Knowledge tier decision

Present both options:

> "You can store session history as markdown files (zero setup) or in Postgres (requires local install).
> Postgres gives you semantic search across all past sessions, structured task tracking, instant
> session context at startup, and embedding-powered 'find related work.' For any project you'll
> work on across 10+ sessions, Postgres is significantly more powerful. Which do you prefer?"

If Postgres chosen and available:
1. Locate the pipeline plugin's `scripts/` directory
2. Install dependencies: `cd $SCRIPTS_DIR && npm install --silent`
3. Run setup: `node $SCRIPTS_DIR/pipeline-db.js setup`
4. Verify: `node $SCRIPTS_DIR/pipeline-db.js status`
5. Set `knowledge.tier: "postgres"` in config with connection details
6. If Ollama is available, suggest: "Run `ollama pull mxbai-embed-large` for semantic search"
7. Add to config's `commit.post_commit_hooks`:
   `"node $SCRIPTS_DIR/pipeline-embed.js index"` (keeps embeddings current after each commit)

If files chosen (default):
1. Create directories: `mkdir -p docs/sessions docs/specs docs/plans`
2. Set `knowledge.tier: "files"` in config

---

### Step 4 — Ask about review sectors

If the project has a `src/` directory (or equivalent), ask:

> "For full codebase reviews (/pipeline:audit), the pipeline splits the codebase into sectors
> reviewed in parallel. I can auto-generate sectors from your top-level directories, or you
> can define custom sectors. Options:
>
> 1. Auto-generate from directory structure
> 2. I'll define my own sectors later
> 3. Skip sector reviews for now"

If auto-generate: scan source directories and create sectors based on top-level subdirectories.

---

### Step 5 — Generate config

Using all detected values, generate `.claude/pipeline.yml`.

Map detected tools to config fields:
- package.json + typescript → `commands.typecheck: "npx tsc --noEmit"`
- package.json + eslint → `commands.lint: "npx eslint src/"`
- package.json + vitest → `commands.test: "npx vitest run"`
- package.json + jest → `commands.test: "npx jest"`
- Cargo.toml → `commands.test: "cargo test"`, `commands.typecheck: null` (Rust compiler handles it)
- go.mod → `commands.test: "go test ./..."`, `commands.lint: "golangci-lint run"`
- pyproject.toml + pytest → `commands.test: "pytest"`, `commands.lint: "ruff check ."`

Write the config file:
```bash
mkdir -p .claude docs/specs docs/plans
```
Then use the Write tool to create `.claude/pipeline.yml`.

---

### Step 6 — Confirm and guide

Report what was detected and configured:

```
## Pipeline configured

**Project:** [name] ([type])
**Repo:** [owner/repo]
**Branch:** [main branch]

**Commands:**
- Typecheck: [command or disabled]
- Lint: [command or disabled]
- Test: [command or disabled]

**Integrations:** [list enabled]
**Knowledge:** [files or postgres]
**Review sectors:** [count or "not configured"]

Config written to `.claude/pipeline.yml`.
```

Then show the getting-started guide:

```
## Getting started

**Make a small change, then:**
1. `/pipeline:commit` — runs preflight gates (typecheck, lint, test) and commits

**Before a bigger change:**
1. `/pipeline:triage` — tells you the right workflow for the change size

**All commands:** `/pipeline:` then tab-complete to see options
```
