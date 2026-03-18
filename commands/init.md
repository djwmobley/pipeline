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
| `review.sectors` | Has entries or empty `[]` (user chose to skip) | Missing entirely |
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

For all other integrations: explain what each detected tool adds to the pipeline.
For missing integrations, show the install/setup command.

---

### Step 4 — Knowledge tier decision

Present both options:

> "You can store session history as markdown files (zero setup) or in Postgres (requires local install).
> Postgres gives you semantic search across all past sessions, structured task tracking, instant
> session context at startup, and embedding-powered 'find related work.' For any project you'll
> work on across 10+ sessions, Postgres is significantly more powerful. Which do you prefer?"

If Postgres chosen and available:
1. Locate the pipeline plugin's `scripts/` directory
2. Install dependencies: `cd $SCRIPTS_DIR && npm install --silent`
3. **Generate project-scoped DB name:** `pipeline_<project_name>` (lowercase, non-alphanumeric → underscore). Each project gets its own database — no context leaks between projects.
4. Run setup: `node $SCRIPTS_DIR/pipeline-db.js setup` (creates the project-specific database and tables)
5. Verify: `node $SCRIPTS_DIR/pipeline-db.js status`
6. Set `knowledge.tier: "postgres"` in config with:
   - `database: "pipeline_<sanitized_project_name>"` (the generated name)
   - `host`, `port` from detection (use detected port if non-default)
7. If Ollama is available, suggest: "Run `ollama pull mxbai-embed-large` for semantic search"
8. Add to config's `commit.post_commit_hooks`:
   `"node $SCRIPTS_DIR/pipeline-embed.js index"` (keeps embeddings current after each commit)
9. If user has an existing project they want to bring context from, mention:
   > "If you have gotchas or decisions from another project you'd like to carry over, use `/pipeline:knowledge import <source_db_or_file>` after setup."

If files chosen (default):
1. Create directories: `mkdir -p docs/sessions docs/specs docs/plans`
2. Set `knowledge.tier: "files"` in config

---

### Step 5 — Ask about review sectors

Present options based on whether this is a greenfield or established project:

**If greenfield** (no source directories or < 5 source files):

> "For full codebase reviews (`/pipeline:audit`), the pipeline splits the codebase into sectors
> reviewed in parallel. Since you're starting fresh, you have a few options:
>
> 1. **Pre-configure from profile** — set up typical sectors for a [profile] project (you can adjust later with `/pipeline:update sectors`)
> 2. **Auto-generate later** — skip for now, run `/pipeline:update sectors` once you have code
> 3. **I'll define my own sectors** — specify names, IDs, and path globs now
> 4. **Skip sector reviews** — use flat reviews instead of parallel sectors"

If option 1 (pre-configure from profile), use these templates:

| Profile | Sectors |
|---------|---------|
| SPA | `[{name: "UI Components", id: "U", paths: ["src/components/**"]}, {name: "Pages & Routing", id: "P", paths: ["src/pages/**", "src/routes/**"]}, {name: "State & Data", id: "D", paths: ["src/hooks/**", "src/stores/**", "src/services/**", "src/api/**"]}, {name: "Utilities & Config", id: "C", paths: ["src/utils/**", "src/lib/**", "src/config/**"]}]` |
| Full-stack | `[{name: "Frontend UI", id: "F", paths: ["src/components/**", "src/pages/**", "app/components/**", "app/routes/**"]}, {name: "API & Server", id: "A", paths: ["src/api/**", "src/server/**", "app/api/**", "server/**"]}, {name: "Data & Models", id: "D", paths: ["src/models/**", "src/db/**", "prisma/**", "drizzle/**"]}, {name: "Auth & Security", id: "S", paths: ["src/auth/**", "src/middleware/**"]}, {name: "Shared & Config", id: "C", paths: ["src/utils/**", "src/lib/**", "src/config/**"]}]` |
| Mobile | `[{name: "Screens & Navigation", id: "S", paths: ["src/screens/**", "src/navigation/**"]}, {name: "Components", id: "U", paths: ["src/components/**"]}, {name: "State & Services", id: "D", paths: ["src/hooks/**", "src/stores/**", "src/services/**", "src/api/**"]}, {name: "Native & Platform", id: "N", paths: ["src/native/**", "ios/**", "android/**"]}]` |
| Mobile + Web | `[{name: "Shared UI", id: "U", paths: ["src/components/**"]}, {name: "Pages & Navigation", id: "P", paths: ["src/pages/**", "src/routes/**", "src/screens/**"]}, {name: "Platform Specific", id: "N", paths: ["src/native/**", "src/platform/**", "ios/**", "android/**"]}, {name: "State & Services", id: "D", paths: ["src/hooks/**", "src/stores/**", "src/services/**"]}]` |
| API | `[{name: "Routes & Controllers", id: "R", paths: ["src/routes/**", "src/controllers/**", "src/handlers/**"]}, {name: "Models & Data", id: "D", paths: ["src/models/**", "src/db/**", "src/repositories/**"]}, {name: "Middleware & Auth", id: "A", paths: ["src/middleware/**", "src/auth/**"]}, {name: "Services & Logic", id: "S", paths: ["src/services/**", "src/utils/**"]}]` |
| CLI | `[{name: "Commands", id: "C", paths: ["src/commands/**", "src/cli/**"]}, {name: "Core Logic", id: "L", paths: ["src/lib/**", "src/core/**"]}, {name: "I/O & Config", id: "I", paths: ["src/config/**", "src/output/**", "src/input/**"]}]` |
| Library | `[{name: "Public API", id: "A", paths: ["src/index.*", "src/exports/**"]}, {name: "Core Implementation", id: "C", paths: ["src/core/**", "src/lib/**"]}, {name: "Utilities", id: "U", paths: ["src/utils/**", "src/helpers/**"]}]` |

**If established** (source directories exist with code):

> "For full codebase reviews (`/pipeline:audit`), the pipeline splits the codebase into sectors
> reviewed in parallel. I can auto-generate sectors from your top-level directories, or you
> can define custom sectors. Options:
>
> 1. **Auto-generate from directory structure** — scan source dirs and create sectors
> 2. **Pre-configure from profile** — use typical [profile] project sectors as a starting point
> 3. **I'll define my own sectors** — specify names, IDs, and path globs
> 4. **Skip sector reviews for now**"

If auto-generate: scan source directories and create sectors based on top-level subdirectories.

---

### Step 6 — Generate config

Using all detected values, generate `.claude/pipeline.yml`.

Map detected tools to config fields:
- package.json + typescript → `commands.typecheck: "npx tsc --noEmit"`
- package.json + eslint → `commands.lint: "npx eslint src/"`
- package.json + vitest → `commands.test: "npx vitest run"`
- package.json + jest → `commands.test: "npx jest"`
- Cargo.toml → `commands.test: "cargo test"`, `commands.typecheck: null` (Rust compiler handles it)
- go.mod → `commands.test: "go test ./..."`, `commands.lint: "golangci-lint run"`
- pyproject.toml + pytest → `commands.test: "pytest"`, `commands.lint: "ruff check ."`

Include profile-based defaults from Step 2b (review criteria, security checks).

Write the config file:
```bash
mkdir -p .claude docs/specs docs/plans
```
Then use the Write tool to create `.claude/pipeline.yml`.

---

### Step 7 — Confirm and guide

Report what was detected and configured:

```
## Pipeline configured

**Project:** [name] ([profile])
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
