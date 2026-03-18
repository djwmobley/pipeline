---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*)
description: Interactive project setup — detects tools, creates .claude/pipeline.yml
---

## Pipeline Init

You are the pipeline setup agent. Your job is to detect the project environment and generate a `.claude/pipeline.yml` config file.

---

### Step 0 — Check for existing config (resume detection)

Check if `.claude/pipeline.yml` already exists in the project root.

**If it exists:** Read it and assess completeness. Check each section for missing or placeholder values:

| Section | Complete if | Incomplete if |
|---------|-----------|--------------|
| `project.name` | Has a real name | Missing or `"my-project"` |
| `project.repo` | Has `owner/repo` or explicitly `null` | Missing |
| `project.branch` | Has a branch name | Missing |
| `project.profile` | Set to a valid profile | Missing or `null` |
| `commands.test` | Has a command or `null` | Missing entirely |
| `commands.lint` | Has a command or `null` | Missing entirely |
| `commands.typecheck` | Has a command or `null` | Missing entirely |
| `knowledge.tier` | Set to `"files"` or `"postgres"` | Missing |
| `integrations` | Has entries with `enabled: true/false` | Missing entirely |

If ALL sections are complete:
> "Pipeline is already configured for this project. Config looks complete.
> Run `/pipeline:commit` to use it, or delete `.claude/pipeline.yml` and re-run `/pipeline:init` to start fresh."
Stop.

If SOME sections are incomplete, report what's done and what's missing:
> "Found existing `.claude/pipeline.yml` — resuming setup.
>
> Already configured: [list complete sections]
> Still needed: [list incomplete sections]"

Then **skip to the first incomplete section's corresponding step** — don't re-ask questions the user already answered.

**If it does not exist:** Proceed to Step 1 (fresh setup).

---

### Step 1 — Detect project type and tools

Run this single detection script (all commands are wrapped to always exit 0, avoiding parallel-cancel issues on Windows):

```bash
echo "=== PROJECT FILES ==="
for f in package.json Cargo.toml go.mod pyproject.toml setup.py pom.xml build.gradle requirements.txt; do
  test -f "$f" && echo "FOUND: $f"
done

echo "=== GIT ==="
echo "remote: $(git remote get-url origin 2>/dev/null || echo 'none')"
echo "branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"

echo "=== DEPS ==="
if test -f package.json; then
  echo "--- package.json deps ---"
  grep -E '"(vitest|jest|mocha|ava|eslint|biome|oxlint|typescript|react-native|expo|next|nuxt|svelte|remix|react|vue|angular|express|fastify|koa|hono|capacitor)"' package.json 2>/dev/null || echo "no key deps found"
  echo "--- package.json bin ---"
  grep -E '"bin"' package.json 2>/dev/null || echo "no bin field"
  echo "--- package.json main/exports ---"
  grep -E '"(main|exports)"' package.json 2>/dev/null || echo "no main/exports"
fi
test -f Cargo.toml && grep -E '^\[\[bin\]\]|axum|actix|clap|rocket' Cargo.toml 2>/dev/null || true
test -f go.mod && cat go.mod 2>/dev/null || true

echo "=== SOURCE DIRS ==="
for d in src lib app pkg cmd internal ios android server prisma drizzle; do
  test -d "$d" && echo "DIR: $d/"
done

echo "=== CONFIG FILES ==="
for f in next.config.js next.config.ts next.config.mjs nuxt.config.ts nuxt.config.js svelte.config.js remix.config.js capacitor.config.ts capacitor.config.json vite.config.ts vite.config.js webpack.config.js; do
  test -f "$f" && echo "CONFIG: $f"
done

echo "=== PACKAGE MANAGER ==="
if test -f pnpm-lock.yaml; then echo "PKG_MGR: pnpm"
elif test -f bun.lockb || test -f bun.lock; then echo "PKG_MGR: bun"
elif test -f yarn.lock; then echo "PKG_MGR: yarn"
elif test -f package-lock.json; then echo "PKG_MGR: npm"
elif test -f package.json; then
  # No lockfile — check what's available
  command -v pnpm >/dev/null 2>&1 && echo "PKG_MGR: pnpm (detected, no lockfile)" || echo "PKG_MGR: npm (default)"
else echo "PKG_MGR: none"
fi

echo "=== SOURCE FILE COUNT ==="
find src/ lib/ app/ -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.rs" -o -name "*.go" -o -name "*.py" 2>/dev/null | wc -l || echo "0"

echo "=== DONE ==="
```

**Greenfield detection:** If no source directories exist OR total source files < 5, this is a **greenfield project**. Flag it — this affects profile recommendations (Step 2) and sector setup (Step 5).

---

### Step 1b — Fill in gaps

**Git remote:** If `git remote get-url origin` returned nothing (no remote configured), ask:
> "No git remote detected. What's the GitHub repo for this project? (e.g., `owner/repo`, or press Enter to skip)"

If the user provides a value, use it for `project.repo`. If skipped, set `project.repo: null`.

**Project name:** If no `name` field in package.json/Cargo.toml/etc., use the directory name.

---

### Step 2 — Project profile

**If established project** (detected in Step 1), infer the profile from what was detected:

| Signal | Inferred Profile |
|--------|-----------------|
| `next.config.*`, `nuxt.config.*`, `svelte.config.*`, `remix.config.*`, Rails `config/routes.rb` | `fullstack` |
| `react-native` or `expo` in package.json + `capacitor.config.*` or `expo-web` | `mobile-web` |
| `react-native` or `expo` in package.json (no web) | `mobile` |
| `android/` or `ios/` dirs + Swift/Kotlin source | `mobile` |
| `vite.config.*` or `webpack.config.*` + React/Vue/Angular/Svelte in deps (no SSR framework) | `spa` |
| `bin` field in package.json, or `src/cli.*`, or Cobra/Clap in deps | `cli` |
| `main`/`exports` in package.json + no `src/pages`/`src/routes`/`src/app` dirs | `library` |
| Express/Fastify/Koa/Hono in deps + no frontend framework | `api` |
| Cargo.toml with `[[bin]]` and no frontend | `cli` or `api` (check for web framework like Axum/Actix) |
| go.mod with `cmd/` directory | `cli` |
| go.mod with web framework (Echo, Gin, Fiber) | `api` |

Present the inference for confirmation:

> "Based on your project structure, this looks like a **[inferred profile]** project ([evidence]).
> Sound right? (Y/n, or pick a different profile: spa, fullstack, mobile, mobile-web, api, cli, library)"

**If greenfield project** (no code to infer from), ask directly:

> "What type of project is this?
>
> 1. **SPA** — Single-page web app (React, Vue, Angular, Svelte)
> 2. **Full-stack** — Frontend + backend in one repo (Next.js, Nuxt, SvelteKit, Rails)
> 3. **Mobile** — Native mobile app (React Native, Flutter, Swift, Kotlin)
> 4. **Mobile + Web** — Shared codebase with web fallback (Capacitor, Expo Web)
> 5. **API** — Backend service or REST/GraphQL API
> 6. **CLI** — Command-line tool
> 7. **Library** — Reusable package/module published for others"

Set `project.profile` to the chosen value: `spa`, `fullstack`, `mobile`, `mobile-web`, `api`, `cli`, `library`.

**If greenfield**, follow up with stack recommendations:

For each profile, suggest a proven starter stack. Present these as recommendations, not requirements — the user knows their constraints best:

| Profile | Recommended Stack | Why |
|---------|------------------|-----|
| **SPA** | Vite + React/Vue + TypeScript + Tailwind + Vitest | Fast dev server, strong typing, utility CSS, fast tests |
| **Full-stack** | Next.js or SvelteKit + TypeScript + Prisma/Drizzle | SSR/SSG, API routes, type-safe DB |
| **Mobile** | React Native + Expo + TypeScript | Cross-platform, managed workflow, OTA updates |
| **Mobile + Web** | React + Capacitor + TypeScript + Tailwind | One codebase, native APIs via plugins |
| **API** | Express/Fastify + TypeScript + Vitest (Node) or Axum + Rust or Echo + Go | Depends on performance needs and team expertise |
| **CLI** | Node + Commander/Yargs or Rust + Clap or Go + Cobra | Depends on distribution needs |
| **Library** | TypeScript + Vitest + tsup (bundler) | Tree-shakeable, well-tested, easy to publish |

> "Since you're starting fresh, here's what works well for [profile] projects:
>
> **[Stack recommendation]**
>
> This gives you [key benefits]. Want me to scaffold with this stack, or do you have a different setup in mind?"

If the user already has code (established project), skip the stack recommendation — their choices are already made.

---

### Step 2b — Profile-based defaults

Based on the chosen profile, pre-configure review criteria and security checks. These are applied automatically — no user interaction needed for this step.

**Review criteria by profile:**

| Profile | Criteria |
|---------|----------|
| SPA | `[ux, accessibility, dead-code, framework-correctness, security, simplicity, solid, performance]` |
| Full-stack | `[ux, accessibility, dead-code, framework-correctness, security, simplicity, solid, api-design, data-integrity]` |
| Mobile | `[ux, accessibility, dead-code, framework-correctness, security, simplicity, solid, performance, battery-impact]` |
| Mobile + Web | `[ux, accessibility, dead-code, framework-correctness, security, simplicity, solid, performance, responsive-design]` |
| API | `[dead-code, security, simplicity, solid, api-design, data-integrity, error-handling, performance]` |
| CLI | `[dead-code, security, simplicity, solid, error-handling, ux]` |
| Library | `[dead-code, security, simplicity, solid, api-design, backwards-compatibility, documentation]` |

**Security checklist additions by profile:**

| Profile | Extra checks |
|---------|-------------|
| SPA, Full-stack, Mobile + Web | `{ check: "Renders user content?", rule: "Sanitize HTML — never render raw user input without a sanitizer like DOMPurify" }` |
| Mobile, Mobile + Web | `{ check: "Stores data on device?", rule: "Use secure storage for tokens — never use plain storage for secrets" }` |
| API | `{ check: "Exposes endpoint?", rule: "Rate limit, authenticate, validate input schema" }` |
| Library | `{ check: "Accepts external input?", rule: "Validate types at boundary — never trust caller input" }` |

---

### Step 3 — Detect integrations

Run this single integration probe script:

```bash
echo "=== ENV VARS ==="
echo "SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:+SET}"
echo "FIGMA_ACCESS_TOKEN=${FIGMA_ACCESS_TOKEN:+SET}"
echo "POSTHOG_API_KEY=${POSTHOG_API_KEY:+SET}"
echo "GAMMA_API_KEY=${GAMMA_API_KEY:+SET}"
echo "GITHUB_TOKEN=${GITHUB_TOKEN:+SET}"

echo "=== POSTGRES DETECTION ==="
# Step 1: Find pg_isready — check PATH, then common install locations
PG_READY=""
if command -v pg_isready >/dev/null 2>&1; then
  PG_READY="pg_isready"
  echo "pg_isready: on PATH"
else
  # Common install paths (Windows, Linux, macOS)
  for d in \
    "/c/Program Files/PostgreSQL"/*/bin \
    "/c/Program Files (x86)/PostgreSQL"/*/bin \
    "/usr/lib/postgresql"/*/bin \
    "/opt/homebrew/bin" \
    "/usr/local/bin"; do
    if test -f "$d/pg_isready" || test -f "$d/pg_isready.exe"; then
      PG_READY="$d/pg_isready"
      echo "pg_isready: found at $d (not on PATH)"
      break
    fi
  done
  test -z "$PG_READY" && echo "pg_isready: not found"
fi

# Step 2: Check if Postgres install exists even without pg_isready
echo "pg_install: searching..."
for d in \
  "/c/Program Files/PostgreSQL"/* \
  "/c/Program Files (x86)/PostgreSQL"/* \
  "/usr/lib/postgresql"/* \
  "/opt/homebrew/opt/postgresql"*; do
  if test -d "$d" 2>/dev/null; then
    echo "pg_install: $d"
  fi
done

# Step 3: Try default port 5432
if test -n "$PG_READY"; then
  "$PG_READY" -h localhost -p 5432 2>/dev/null && echo "postgres_5432: accepting connections" || echo "postgres_5432: not responding"
else
  (echo > /dev/tcp/localhost/5432) 2>/dev/null && echo "postgres_5432: port open" || echo "postgres_5432: closed"
fi

# Step 4: Quick scan of common alternate ports
for port in 5433 5434 54320; do
  (echo > /dev/tcp/localhost/$port) 2>/dev/null && echo "postgres_alt_port: $port open" || true
done

echo "=== OTHER SERVICES ==="
curl -s --connect-timeout 2 http://localhost:11434/api/tags 2>&1 | head -1 || echo "ollama: no"
curl -s --connect-timeout 2 http://localhost:9222/json/version 2>&1 | head -1 || echo "chrome: no"

echo "=== CLI TOOLS ==="
npx playwright --version 2>/dev/null || echo "playwright: no"
gh --version 2>/dev/null || echo "gh: no"

echo "=== DONE ==="
```

**Interpret Postgres results:**

| pg_isready | Install found | Port 5432 | Alt port open | Interpretation |
|-----------|--------------|-----------|---------------|----------------|
| on PATH | — | accepting | — | **Running on default port.** Set `postgres.enabled: true`, `port: 5432` |
| found (not on PATH) | yes | accepting | — | **Running but not on PATH.** Note the path, set enabled, suggest adding to PATH |
| on PATH | — | not responding | no | **Installed but not running.** Ask: "Postgres is installed but not running. Start it, or skip for now?" |
| on PATH | — | not responding | yes (e.g. 5433) | **Running on non-default port.** Ask: "Postgres doesn't respond on 5432 but port [N] is open. Is that your Postgres port?" If confirmed, use that port |
| not found | yes | closed | no | **Installed but not on PATH and not running.** Show install path, ask if they want to configure it |
| not found | yes | open or alt open | — | **Port open, no pg_isready.** Ask: "Something is listening on port [N] — is that Postgres? What port?" |
| not found | no | closed | no | **Not installed.** Show install instructions |

**Present integration results grouped by importance:**

> **Detected integrations:**
> [list each with what it enables]
>
> **Not detected — optional enhancements:**
> [list each with what it would add, whether it has a fallback, and how to install]

**For each missing integration, clearly state whether it's required or optional and what the fallback is:**

| Integration | Required? | What it enables | Fallback without it | If missing |
|------------|-----------|----------------|--------------------|----|
| **Playwright** | Optional | Screenshot capture for `/pipeline:ui-review` | Chrome DevTools MCP, or provide screenshots manually | Ask: "Playwright enables automatic screenshot capture for UI reviews. Want me to install it? (I'll run `[pkg_manager] add -D @playwright/test && npx playwright install chromium`)" If declined: "No problem — install it yourself later with `[pkg_manager] add -D @playwright/test && npx playwright install chromium`, or use Chrome DevTools MCP instead." |
| **GitHub CLI** | Optional | PR creation in `/pipeline:finish`, issue management | Push branches manually, create PRs in browser | Show: "GitHub CLI (`gh`) enables PR creation from `/pipeline:finish`. Install: https://cli.github.com — or push branches and create PRs manually in the browser." |
| **Postgres** | Optional | Knowledge tier with semantic search, structured queries | Files tier (markdown-based, zero setup) | Show install link. Note: "Without Postgres, you'll use the files tier — markdown-based session tracking that works but lacks search." |
| **Ollama** | Optional | Semantic/hybrid search in Postgres tier | FTS keyword search only (still useful) | Show: "Ollama adds semantic search to the Postgres knowledge tier. Install: https://ollama.com — then `ollama pull mxbai-embed-large`. Without it, keyword search still works." |
| **Chrome DevTools** | Optional | Screenshot capture for `/pipeline:ui-review` | Playwright, or provide screenshots manually | Show: "Launch Chrome with `--remote-debugging-port=9222` for automatic screenshots. Or use Playwright instead." |
| **Sentry** | Optional | Auto-pull recent errors in `/pipeline:debug` | Reproduce errors manually | Show: "Set `SENTRY_AUTH_TOKEN` env var. Without it, `/pipeline:debug` still works — you just provide the error manually." |

**Key rule:** Always ask before installing anything. If the user declines, show the manual install command so they can do it later. Never silently install packages.

---

### Step 4 — Knowledge tier decision

Present both options:

> "You can store session history as markdown files (zero setup) or in Postgres (requires local install).
> Postgres gives you semantic search across all past sessions, structured task tracking, instant
> session context at startup, and embedding-powered 'find related work.' For any project you'll
> work on across 10+ sessions, Postgres is significantly more powerful. Which do you prefer?"

If Postgres chosen and available:

The pipeline scripts need the `pg` Node.js package to talk to Postgres. The plugin's scripts use pnpm (they have a `pnpm-lock.yaml`) — always use `pnpm install` here, regardless of the project's own package manager. Ask before installing:

> "I need to install the pipeline's database dependencies (the `pg` package). This goes in the plugin's scripts directory, not your project. OK to install? (I'll run `pnpm install` in the pipeline scripts directory)"

If yes:
1. Locate the pipeline plugin's `scripts/` directory using the same resolution as `/pipeline:knowledge` Step 0: check `$PIPELINE_DIR/scripts/`, then `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`, then search `${HOME:-$USERPROFILE}/.claude/` for `pipeline-db.js`. Store the resolved absolute path — use this literal path (not a variable) in all subsequent Bash calls.
2. Install dependencies: `cd <scripts_path> && pnpm install`
3. **Generate project-scoped DB name:** `pipeline_<project_name>` — lowercase the project name, replace non-alphanumeric characters with underscores, collapse consecutive underscores, strip leading/trailing underscores, prefix with `pipeline_`. Each project gets its own database — no context leaks between projects.
4. Run setup: `PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js setup` (creates the project-specific database and tables)
5. Verify: `PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js status`
6. Set `knowledge.tier: "postgres"` in config with:
   - `database: "pipeline_<sanitized_project_name>"` (the generated name)
   - `host`, `port` from detection (use detected port if non-default)
7. If Ollama is available, suggest: "Run `ollama pull mxbai-embed-large` for semantic search. Without it, keyword search still works — Ollama just adds semantic similarity."
8. Add to config's `commit.post_commit_hooks`:
   `"node $SCRIPTS_DIR/pipeline-embed.js index"` (keeps embeddings current after each commit)
9. If user has an existing project they want to bring context from, mention:
   > "If you have gotchas or decisions from another project you'd like to carry over, use `/pipeline:knowledge import <source_db_or_file>` after setup."

If declined: "No problem. Run these yourself when you're ready:
1. `cd [scripts_dir] && pnpm install`
2. `/pipeline:knowledge setup`"

If files chosen (default):
1. Create directories: `mkdir -p docs/sessions docs/specs docs/plans docs/research`
2. Set `knowledge.tier: "files"` in config

---

### Step 5 — Generate config

Using all detected values, generate `.claude/pipeline.yml`.

Set `project.pkg_manager` to the detected package manager from Step 1 (pnpm, npm, yarn, or bun).

Set `routing.source_dirs` from the directories detected in Step 1 (the "SOURCE DIRS" section). Include only directories that exist and contain source code (e.g., `["src/"]`, `["src/", "lib/"]`, `["cmd/", "internal/", "pkg/"]`). If only `src/` was detected, use `["src/"]`. If no source directories were detected, use `["."]` as fallback.

Map detected tools to config fields. Use the detected package manager's runner where applicable (e.g., pnpm → `pnpm exec`, npm → `npx`, yarn → `yarn`, bun → `bunx`):
- package.json + typescript → `commands.typecheck: "[runner] tsc --noEmit"`
- package.json + eslint → `commands.lint: "[runner] eslint src/"`
- package.json + vitest → `commands.test: "[runner] vitest run"`
- package.json + jest → `commands.test: "[runner] jest"`
- Cargo.toml → `commands.test: "cargo test"`, `commands.typecheck: null` (Rust compiler handles it)
- go.mod → `commands.test: "go test ./..."`, `commands.lint: "golangci-lint run"`
- pyproject.toml + pytest → `commands.test: "pytest"`, `commands.lint: "ruff check ."`

Include profile-based defaults from Step 2b (review criteria, security checks). Set `review.sectors: []` — sectors are configured later via `/pipeline:update sectors` or on first `/pipeline:audit` run, when there's actual code to inform the conversation.

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

**Project:** [name] ([profile])
**Repo:** [owner/repo]
**Branch:** [main branch]
**Package manager:** [pnpm/npm/yarn/bun]

**Commands:**
- Typecheck: [command or disabled]
- Lint: [command or disabled]
- Test: [command or disabled]

**Integrations:** [list enabled]
**Knowledge:** [files or postgres]

Config written to `.claude/pipeline.yml`.
Review sectors are configured later — run `/pipeline:update sectors` when you have code to review.
```

Then show the appropriate getting-started guide:

**If greenfield project:**

```
## Getting started

Your project is set up for planning-first development:

1. `/pipeline:brainstorm` — explore your first feature's requirements and design
2. `/pipeline:plan` — create an implementation plan from the spec
3. `/pipeline:build` — execute the plan with built-in quality checks

Once you have code:
- `/pipeline:commit` — runs preflight gates and commits
- `/pipeline:update sectors` — auto-generate review sectors from your directory structure
- `/pipeline:triage` — check the recommended workflow for any change

**Adjust anything later:** `/pipeline:update`
```

**If established project:**

```
## Getting started

**Make a small change, then:**
1. `/pipeline:commit` — runs preflight gates (typecheck, lint, test) and commits

**Before a bigger change:**
1. `/pipeline:triage` — tells you the right workflow for the change size

**Adjust anything later:** `/pipeline:update`

**All commands:** `/pipeline:` then tab-complete to see options
```
