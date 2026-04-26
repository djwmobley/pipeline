---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*)
description: Update pipeline config — re-detect integrations, change commands, sectors, knowledge tier, or any setting
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=orientation
```


## Pipeline Update

Modify an existing `.claude/pipeline.yml`. Unlike init (full setup), update targets a specific section
and preserves everything else.

---

### Step 0 — Load existing config

Read `.claude/pipeline.yml` from the project root.

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

Parse the full config into memory — you'll write back the entire file with modifications.

---

### Step 1 — Route by argument

**No arguments** — Show current config summary and ask what to change:

```
## Current Pipeline Config

**Project:** [name] | **Repo:** [repo] | **Branch:** [branch]

**Commands:**
  typecheck: [value or disabled]
  lint:      [value or disabled]
  test:      [value or disabled]

**Knowledge:** [tier]
**Sectors:** [count or "none"]
**Integrations:** [list enabled ones]

What would you like to update?
1. Integrations (re-detect available tools)
2. Commands (test/lint/typecheck)
3. Review sectors
4. Knowledge tier
5. Project info (repo, branch, co-author)
6. Security checklist
7. A specific key (I'll tell you which)
```

Then follow the chosen route below.

---

### Route: `integrations`

Re-run all integration probes (single script to avoid parallel-cancel issues):

```bash
echo "=== ENV VARS ==="
echo "SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:+SET}"
echo "POSTHOG_API_KEY=${POSTHOG_API_KEY:+SET}"
echo "GAMMA_API_KEY=${GAMMA_API_KEY:+SET}"
echo "GITHUB_TOKEN=${GITHUB_TOKEN:+SET}"

echo "=== POSTGRES DETECTION ==="
PG_READY=""
if command -v pg_isready >/dev/null 2>&1; then
  PG_READY="pg_isready"
  echo "pg_isready: on PATH"
else
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
for d in \
  "/c/Program Files/PostgreSQL"/* \
  "/c/Program Files (x86)/PostgreSQL"/* \
  "/usr/lib/postgresql"/* \
  "/opt/homebrew/opt/postgresql"*; do
  test -d "$d" 2>/dev/null && echo "pg_install: $d"
done
if test -n "$PG_READY"; then
  "$PG_READY" -h localhost -p 5432 2>/dev/null && echo "postgres_5432: accepting connections" || echo "postgres_5432: not responding"
else
  (echo > /dev/tcp/localhost/5432) 2>/dev/null && echo "postgres_5432: port open" || echo "postgres_5432: closed"
fi
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

Compare results against current config. Show a diff:

```
## Integration Changes

  sentry:          disabled → enabled (SENTRY_AUTH_TOKEN found)
  chrome_devtools: enabled  → enabled (no change)
  ollama:          disabled → enabled (localhost:11434 responding)
  playwright:      enabled  → enabled (no change)

Apply these changes? (Y/n)
```

Update only the `integrations` section. Preserve all other config.

---

### Route: `commands`

Show current commands and ask what to change:

```
Current commands:
  typecheck: npx tsc --noEmit
  lint:      npx eslint src/
  test:      npx vitest run
  test_verbose: npx vitest run --reporter=verbose

Which command do you want to change? (or "detect" to auto-detect from project files)
```

If "detect": re-run the detection probes from init Step 1 and propose changes.
If a specific command: ask for the new value (or "null" to disable).

Update only the `commands` section.

---

### Route: `sectors`

**What sectors are:** When you run `/pipeline:audit`, the codebase is split into sectors — independent zones reviewed in parallel by separate agents. Each sector gets its own reviewer that focuses on a specific area (e.g., "UI Components", "API Routes", "Auth & Security"). A synthesis agent then combines findings across sectors. This parallelism is what makes a full codebase review feasible — 6 focused reviews run simultaneously instead of one overwhelmed reviewer.

---

#### Step 1 — Detect framework and directory structure

Run this detection script to understand what's actually in the project:

```bash
echo "=== FRAMEWORK DETECTION ==="
# JS/TS frameworks
for f in next.config.js next.config.ts next.config.mjs; do test -f "$f" && echo "FRAMEWORK: nextjs"; done
for f in nuxt.config.ts nuxt.config.js; do test -f "$f" && echo "FRAMEWORK: nuxt"; done
for f in svelte.config.js svelte.config.ts; do test -f "$f" && echo "FRAMEWORK: sveltekit"; done
for f in remix.config.js remix.config.ts; do test -f "$f" && echo "FRAMEWORK: remix"; done
for f in astro.config.mjs astro.config.ts; do test -f "$f" && echo "FRAMEWORK: astro"; done
test -f angular.json && echo "FRAMEWORK: angular"
test -f capacitor.config.ts -o -f capacitor.config.json && echo "FRAMEWORK: capacitor"
test -f package.json && grep -q '"expo"' package.json 2>/dev/null && echo "FRAMEWORK: expo"
test -f package.json && grep -q '"react-native"' package.json 2>/dev/null && echo "FRAMEWORK: react-native"
test -f package.json && grep -q '"express"' package.json 2>/dev/null && echo "FRAMEWORK: express"
test -f package.json && grep -q '"fastify"' package.json 2>/dev/null && echo "FRAMEWORK: fastify"
test -f package.json && grep -q '"hono"' package.json 2>/dev/null && echo "FRAMEWORK: hono"
test -f package.json && grep -q '"koa"' package.json 2>/dev/null && echo "FRAMEWORK: koa"
test -f package.json && grep -q '"@ionic"' package.json 2>/dev/null && echo "FRAMEWORK: ionic"
test -f ionic.config.json && echo "FRAMEWORK: ionic"
# React + Vite (not a meta-framework)
test -f package.json && grep -q '"react"' package.json 2>/dev/null && grep -q '"vite"' package.json 2>/dev/null && ! grep -q '"next"' package.json 2>/dev/null && ! grep -q '"remix"' package.json 2>/dev/null && ! grep -q '"astro"' package.json 2>/dev/null && echo "FRAMEWORK: react-vite"
# Vue + Vite (not Nuxt)
test -f package.json && grep -q '"vue"' package.json 2>/dev/null && grep -q '"vite"' package.json 2>/dev/null && ! grep -q '"nuxt"' package.json 2>/dev/null && echo "FRAMEWORK: vue-vite"

# PHP frameworks
test -f artisan && echo "FRAMEWORK: laravel"

# Python frameworks
test -f manage.py && echo "FRAMEWORK: django"
test -f package.json 2>/dev/null || {
  grep -q "fastapi" requirements.txt pyproject.toml 2>/dev/null && echo "FRAMEWORK: fastapi"
  grep -q "flask" requirements.txt pyproject.toml 2>/dev/null && echo "FRAMEWORK: flask"
}

# Ruby
test -f Gemfile && grep -q "rails" Gemfile 2>/dev/null && echo "FRAMEWORK: rails"

# Go
test -f go.mod && {
  grep -q "echo" go.mod 2>/dev/null && echo "FRAMEWORK: echo"
  grep -q "gin" go.mod 2>/dev/null && echo "FRAMEWORK: gin"
  grep -q "fiber" go.mod 2>/dev/null && echo "FRAMEWORK: fiber"
  test -d cmd && echo "FRAMEWORK: go-cli"
}

# Rust
test -f Cargo.toml && {
  grep -q "axum" Cargo.toml 2>/dev/null && echo "FRAMEWORK: axum"
  grep -q "actix" Cargo.toml 2>/dev/null && echo "FRAMEWORK: actix"
  grep -q "clap" Cargo.toml 2>/dev/null && echo "FRAMEWORK: clap-cli"
}

# Java/Kotlin
test -f pom.xml && grep -q "spring" pom.xml 2>/dev/null && echo "FRAMEWORK: spring"
test -f build.gradle && grep -q "spring" build.gradle 2>/dev/null && echo "FRAMEWORK: spring"
test -f build.gradle.kts && grep -q "ktor" build.gradle.kts 2>/dev/null && echo "FRAMEWORK: ktor"

# Cloud/platform
test -f firebase.json && echo "FRAMEWORK: firebase"
test -f package.json && grep -q '"firebase"' package.json 2>/dev/null && echo "FRAMEWORK: firebase"

# Mobile (additional)
test -f pubspec.yaml && grep -q "flutter" pubspec.yaml 2>/dev/null && echo "FRAMEWORK: flutter"

echo "=== DIRECTORY STRUCTURE ==="
for d in src lib app pkg cmd internal server pages routes components api models controllers handlers views services middleware stores hooks screens navigation prisma drizzle supabase ios android; do
  test -d "$d" && echo "DIR: $d/"
done
# Also check one level down in src/ and app/
for parent in src app; do
  if test -d "$parent"; then
    for d in "$parent"/*/; do
      test -d "$d" && echo "DIR: $d"
    done
  fi
done 2>/dev/null

echo "=== DONE ==="
```

**Framework label → checklist mapping:**

| Detection Label | Checklist Heading |
|---|---|
| nextjs | Next.js |
| nuxt | Nuxt |
| sveltekit | SvelteKit |
| remix | Remix |
| astro | Astro |
| angular | Angular |
| react-vite | React + Vite |
| vue-vite | Vue + Vite |
| react-native | React Native / Expo |
| expo | React Native / Expo |
| capacitor | Capacitor / Ionic |
| ionic | Capacitor / Ionic |
| flutter | Flutter |
| express | Express |
| fastify | Fastify |
| hono | Hono |
| koa | Koa |
| django | Django |
| fastapi | FastAPI |
| flask | Flask |
| laravel | Laravel |
| rails | Rails |
| echo | Echo / Gin / Fiber (Go) |
| gin | Echo / Gin / Fiber (Go) |
| fiber | Echo / Gin / Fiber (Go) |
| axum | Axum / Actix (Rust) |
| actix | Axum / Actix (Rust) |
| spring | Spring Boot |
| ktor | Ktor |
| firebase | Firebase |
| go-cli | *(no framework checklist — use generic domain checklist)* |
| clap-cli | *(no framework checklist — use generic domain checklist)* |

Use this table to look up the correct section heading when extracting framework-specific checklists.

---

#### Step 2 — Recommend sectors based on framework

Read the sector recommendations from `skills/auditing/sector-recommendations.md` (locate via the same method as other skill files). Use the framework-specific recommendations for the detected project type.

---

#### Step 3 — Present recommendations

> "Based on your project, I detect **[framework]**. Here's how [framework] projects typically organize code, and how I'd split that into review sectors:
>
> [show recommended sectors with paths that actually exist]
>
> Each sector gets its own review agent running in parallel during `/pipeline:audit`. The synthesis agent then looks for cross-sector issues (e.g., a route handler that bypasses the auth middleware).
>
> Options:
> 1. **Use these recommendations** (you can adjust later)
> 2. **Auto-generate from directory structure** — one sector per top-level dir (simpler, less targeted)
> 3. **I'll define my own** — specify names, IDs, and path globs
> 4. **Skip for now** — audit will fall back to a flat review"

**Important:** Only include sectors whose paths actually exist in the project. If the framework template says "Middleware (`src/middleware/**`)" but that directory doesn't exist, drop it. If only 2 out of 5 recommended sectors match real directories, that's fine — recommend those 2 and note which ones will become relevant as the project grows.

If no framework is detected, fall back to a generic directory-based split: one sector per top-level directory under `routing.source_dirs`.

---

#### Existing sectors configured

If sectors already exist, show them and offer modifications:

```
Current review sectors:
  A: Auth & Routing — src/auth/**, src/routes/**
  B: Core Features — src/features/**

Options:
1. Auto-generate from directory structure
2. Regenerate from framework conventions
3. Add a sector
4. Remove a sector
5. Replace all
```

For auto-generate: scan source directories, create one sector per top-level subdirectory.
For add: ask for name, id, and path globs.
For remove: show list, ask which to remove.

Update only the `review.sectors` section.

---

### Route: `knowledge`

Show current tier and what switching means:

```
Current knowledge tier: files

Switch to Postgres?
  + Semantic search across all past sessions
  + Structured task/decision/gotcha queries
  + File hash cache (skip re-reading unchanged files)
  + Embedding-powered "find related work"
  - Requires PostgreSQL on localhost:5432
  - Optional: Ollama for embeddings

Switch? (y/N)
```

If switching to Postgres: run the same setup as init Step 4 (locate scripts, install deps with pnpm — the plugin uses pnpm regardless of the project's package manager — and setup DB).
If switching to files: create `docs/sessions/`, `docs/gotchas.md` if missing. Warn that Postgres data is preserved but won't be used.

Update only the `knowledge` section.

---

### Route: `project` / `repo` / `branch` / `co_author`

If given with a value (e.g., `/pipeline:update repo owner/repo`), set it directly.
If given without a value, ask for the new value.

Supported direct-set keys:
- `repo <owner/repo>` → `project.repo`
- `branch <name>` → `project.branch`
- `name <name>` → `project.name`
- `co_author <"Name <email>">` → `commit.co_author`
- `push <true/false>` → `commit.push_after_commit`

---

### Route: `security`

Show current security checklist and allow add/remove/edit:

```
Current security checklist:
  1. Database access? → Verify access control
  2. User input? → Sanitize before storage
  3. Network call? → TLS only, AbortController, no embedded secrets

Options:
1. Add a check
2. Remove a check
3. Edit a check
```

---

### Route: specific key

If the user says something like "change the lint error pattern" or "set review_gate_threshold to 5",
identify the YAML key path and update it directly. Confirm the change before writing:

```
Change routing.review_gate_threshold: 3 → 5?
```

---

### Step 2 — Write back

Read the existing `.claude/pipeline.yml` in full. Apply only the targeted changes.
Write the complete file back using the Write tool.

Report what changed:

```
## Config updated

Changed: [section] — [what changed]
Config written to `.claude/pipeline.yml`.
```
