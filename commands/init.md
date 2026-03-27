---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*)
description: Project setup — detects tools, creates .claude/pipeline.yml (use --quick for zero interaction)
---

## Pipeline Init

You are the pipeline setup agent. Your job is to detect the project environment and generate a `.claude/pipeline.yml` config file.

### Argument parsing

Check if the user's arguments contain `--quick` or `quick`. If so, set **quick mode = true**.

**Quick mode** runs the same detection scripts but makes every decision autonomously — zero user interaction. It uses sensible defaults for anything it can't detect, auto-installs dependencies (Playwright, Postgres `pg` package, Ollama embedding model), and prints a full decision log at the end. The user can adjust anything afterward with `/pipeline:update`.

Throughout this command, each decision point has a **"If quick mode:"** block. When quick mode is active, follow those blocks and skip all user prompts.

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
| `project.engagement` | Set to `expert`, `guided`, or `full-guidance` | Missing |
| `security.policy` | Set to `every-feature`, `milestone`, or `on-demand` | Missing |

If ALL sections are complete:
> "Pipeline is already configured for this project. Config looks complete.
> Run `/pipeline:commit` to use it, or delete `.claude/pipeline.yml` and re-run `/pipeline:init` to start fresh."
Stop. **This applies in both interactive and quick mode** — quick mode does not overwrite a complete config.

If SOME sections are incomplete:

**If quick mode:** Silently fill in the incomplete sections using quick-mode defaults (same defaults as a fresh quick-mode run). Do not show the "resuming setup" message — just detect, decide, fill gaps, and print the final summary. Skip to the first incomplete section's corresponding step, applying quick-mode logic at each.

**If interactive mode:** Report what's done and what's missing:
> "Found existing `.claude/pipeline.yml` — resuming setup.
>
> Already configured: [list complete sections]
> Still needed: [list incomplete sections]"

Then **skip to the first incomplete section's corresponding step** — don't re-ask questions the user already answered.

**If it does not exist:** Proceed to Step 0b (engagement style).

---

### Step 0b — Engagement style

**If quick mode:** Default to `expert`. Skip this question.

Ask the user how they want to interact with Pipeline:

> "How much guidance do you want during setup?
>
> 1. **Expert** — Minimal explanation, just the decisions. You know your stack.
> 2. **Guided** (default) — Brief context before each decision, recommendations included.
> 3. **Full guidance** — Detailed explanations, rationale for every recommendation. Good for first-time users."

Set `project.engagement` to `expert`, `guided`, or `full-guidance`.

This controls how all subsequent questions are framed:
- **Expert:** One-line questions, no recommendations, no "why" explanations
- **Guided:** Short context + recommendation + question
- **Full guidance:** Full paragraph explaining what the option does, why it matters, and what the recommendation is

Every question in the remaining steps has three variants. Use the engagement style to pick which variant to show.

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

**If quick mode:** Use the directory name for `project.name` if no `name` field found in package.json/Cargo.toml/etc. Set `project.repo: null` if no git remote detected. Infer source dirs from detection. Log all decisions. Skip to Step 2.

**Project name:** If no `name` field in package.json/Cargo.toml/etc., use the directory name.

**Git remote and repo creation:** If `git remote get-url origin` returned nothing (no remote configured):

**Expert:**
> "No git remote. Repo name? (e.g., `owner/repo`, Enter to skip, or `create` to make one)"

**Guided:**
> "No git remote detected. Pipeline uses GitHub for issue tracking and PR workflows.
>
> Options:
> - Enter a repo name (e.g., `owner/repo`)
> - Type `create` — I'll create a GitHub repo and set the remote
> - Press Enter to skip (GitHub features will be disabled)"

**Full guidance:**
> "No git remote detected. Pipeline's workflow tracks all work through GitHub issues — every feature, fix, and finding gets an issue with description, commentary, and status. The `/pipeline:finish` command creates PRs automatically.
>
> Without a GitHub repo, these features are disabled. You can still use Pipeline for local development, but you'll lose the audit trail.
>
> Options:
> - Enter an existing repo name (e.g., `owner/repo`)
> - Type `create` — I'll create a new GitHub repo using `gh repo create` and set the remote
> - Press Enter to skip for now (you can add it later with `/pipeline:update`)"

If `create`: validate that `project_name` matches `[a-zA-Z0-9_.-]+` only. If it contains shell metacharacters or single quotes, reject with: "Project name contains unsafe characters. Rename the directory or provide a safe repo name." Then run `gh repo create '[project_name]' --private --source=. --remote=origin --push`. Extract `owner/repo` from the output. If `gh` is not installed, show: "GitHub CLI not available. Install it first: https://cli.github.com"

If the user provides a value, use it for `project.repo`. If skipped, set `project.repo: null`.

**Source directories:** Infer from detection signals — do NOT ask the user.

Use detected directories from Step 1's "SOURCE DIRS" section. If directories were found, use them directly and log: "Source dirs: [dirs] — detected [list]".

If no source directories were detected (greenfield), defer resolution to Step 5 — the profile-based defaults require the profile from Step 2 which has not run yet.

---

### Step 1c — Platform detection

Detect the code hosting and issue tracking platform from the git remote URL. This determines which CLI backend `scripts/platform.js` uses for all issue and PR operations.

**Platform detection from git remote:**

| Remote URL pattern | Platform |
|-------------------|----------|
| `github.com` | `github` |
| `dev.azure.com` or `*.visualstudio.com` | `azure-devops` |
| Other / none | Default to `github` if `gh` CLI authenticated, otherwise `none` |

**If quick mode:** Detect from remote URL, apply defaults silently, log decision. Skip to Step 2.

**If github detected:**

Verify `gh` CLI is available and authenticated:
```bash
gh auth status 2>&1 | head -1
```
If not authenticated: "GitHub CLI not authenticated. Run: `gh auth login`"

Set in pipeline.yml:
```yaml
platform:
  code_host: "github"
  issue_tracker: "github"
```

**If azure-devops detected:**

1. Extract org and project from remote URL:
   - `https://dev.azure.com/{org}/{project}/_git/{repo}` → org, project
   - `https://{org}.visualstudio.com/{project}/_git/{repo}` → org, project

2. Verify `az devops` CLI extension is available:
```bash
az extension show --name azure-devops --query version --output tsv 2>/dev/null
```
If not installed: "Azure CLI DevOps extension required. Install with: `az extension add --name azure-devops`"

3. Verify authentication:
```bash
az account show --query name --output tsv 2>/dev/null
```
If not authenticated: "Azure authentication required. Run: `az login` or set `AZURE_DEVOPS_EXT_PAT` environment variable"

4. Verify project access:
```bash
az devops project show --project '{project}' --org 'https://dev.azure.com/{org}' --query name --output tsv 2>/dev/null
```
If fails: "Azure DevOps access denied. Verify your PAT has Work Items (Read & Write) and Code (Read & Write) scopes."

5. Detect process template:
```bash
az devops project show --project '{project}' --org 'https://dev.azure.com/{org}' --query 'capabilities.processTemplate.templateName' --output tsv
```

6. Resolve state names from process template:

| Process Template | done_state | active_state |
|-----------------|------------|-------------|
| Basic | Done | Doing |
| Agile | Closed | Active |
| Scrum | Done | Committed |
| CMMI | Closed | Active |

7. Set defaults:
```bash
az devops configure --defaults organization='https://dev.azure.com/{org}' project='{project}'
```

8. Set in pipeline.yml:
```yaml
platform:
  code_host: "azure-devops"
  issue_tracker: "azure-devops"
  azure_devops:
    organization: "{org}"
    project: "{project}"
    process_template: "{detected}"
    work_item_type: "Task"
    done_state: "{resolved}"
    active_state: "{resolved}"
```

**If no remote or unrecognized host:**

Set both to `none`. Issue tracking and PR operations will be skipped. Warn the user:
> "No recognized platform detected. Issue tracking and PR workflows will be disabled. Add a git remote and re-run `/pipeline:init` to enable."

---

### Step 2 — Project profile

**If quick mode:** Use the inferred profile directly without asking for confirmation. If established project, apply the signal table below and pick the best match. If greenfield (no signals), default to `fullstack`. Skip stack recommendations entirely. Log the chosen profile and evidence (e.g., "Profile: fullstack — detected next.config.ts"). Skip to Step 2b.

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

Present the inference for confirmation, scaled by engagement style:

**Expert (established):**
> "Profile: [inferred] ([evidence]). OK? (Y/n, or: spa/fullstack/mobile/mobile-web/api/cli/library)"

**Expert (greenfield):**
> "Profile? (spa/fullstack/mobile/mobile-web/api/cli/library)"

**Guided (established):**
> "Based on your project structure, this looks like a **[inferred profile]** project ([evidence]).
> Sound right? (Y/n, or pick a different profile: spa, fullstack, mobile, mobile-web, api, cli, library)"

**Guided (greenfield):**
> "What type of project is this?
>
> 1. **SPA** — Single-page web app
> 2. **Full-stack** — Frontend + backend (Next.js, Nuxt, SvelteKit)
> 3. **Mobile** — Native mobile app
> 4. **Mobile + Web** — Shared codebase with web fallback
> 5. **API** — Backend service
> 6. **CLI** — Command-line tool
> 7. **Library** — Reusable package/module"

**Full guidance (established):**
> "Based on your project structure, this looks like a **[inferred profile]** project.
>
> Evidence: [detailed evidence list]
>
> The profile controls which review criteria Pipeline applies (e.g., accessibility checks for UI projects, battery-impact analysis for mobile). Sound right? (Y/n, or pick: spa, fullstack, mobile, mobile-web, api, cli, library)"

**Full guidance (greenfield):**
> "What type of project is this? The profile controls which review criteria, security checks, and recommendations Pipeline applies throughout the workflow.
>
> 1. **SPA** — Single-page web app (React, Vue, Angular, Svelte). Reviews focus on UX, accessibility, performance.
> 2. **Full-stack** — Frontend + backend in one repo (Next.js, Nuxt, SvelteKit, Rails). Reviews add API design and data integrity.
> 3. **Mobile** — Native mobile app (React Native, Flutter, Swift, Kotlin). Reviews add battery impact and performance.
> 4. **Mobile + Web** — Shared codebase with web fallback (Capacitor, Expo Web). Reviews add responsive design.
> 5. **API** — Backend service or REST/GraphQL API. Reviews focus on security, error handling, data integrity.
> 6. **CLI** — Command-line tool. Reviews focus on error handling and UX.
> 7. **Library** — Reusable package/module. Reviews add backwards-compatibility and documentation."

Set `project.profile` to the chosen value: `spa`, `fullstack`, `mobile`, `mobile-web`, `api`, `cli`, `library`.

**If greenfield**, follow up with stack recommendations (guided and full-guidance only — skip for expert):

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

**Guided:**
> "Since you're starting fresh, here's what works well for [profile] projects: **[Stack recommendation]**. Want me to scaffold with this stack, or do you have a different setup in mind?"

**Full guidance:**
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

### Step 2c — Security policy

**If quick mode:** Default to `milestone`. Log decision. Skip to Step 3.

Controls when Pipeline runs red team and audit workflows in the orchestrated pipeline.

**Expert:**
> "Security scanning policy? (every-feature / milestone / on-demand)"

**Guided:**
> "When should Pipeline run security analysis (red team + audit)?
>
> 1. **Every feature** — full security scan on every LARGE+ feature
> 2. **Milestone** (default) — security scans on MILESTONE changes only; LARGE features get review-only
> 3. **On-demand** — only when you explicitly run `/pipeline:redteam` or `/pipeline:audit`"

**Full guidance:**
> "Pipeline includes red team agents that probe your code for security vulnerabilities (injection, auth bypass, data exposure) and audit agents that check for compliance, dead code, and structural issues.
>
> These are powerful but add time to the workflow. You can control when they run:
>
> 1. **Every feature** — runs red team + audit on every LARGE+ feature in the orchestrated pipeline. Best for security-critical applications (fintech, healthcare, auth systems).
> 2. **Milestone** (default) — runs security scans only on MILESTONE changes. LARGE features still get code review but skip the full security sweep. Good balance for most projects.
> 3. **On-demand** — security scans never run automatically. You trigger them manually with `/pipeline:redteam` or `/pipeline:audit` when you want them. Best for early-stage projects where speed matters more than coverage."

Set `security.policy` to `every-feature`, `milestone`, or `on-demand`.

---

### Step 3 — Detect integrations

Run this single integration probe script:

```bash
echo "=== ENV VARS ==="
echo "SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:+SET}"
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

**Design tool detection (non-script — MCP tool availability is known to you, not bash):**

Check your available tools for MCP server connections:
- If any `mcp__stitch__*` tools are callable → **Stitch MCP is connected**
- If any `mcp__figma__*` tools are callable → **Figma MCP is connected**

Note: Figma detection is MCP-only. The `FIGMA_API_KEY` env var is used internally by the Figma MCP server — if the MCP server is not configured, the env var alone does nothing.

**Design tool decision matrix:**

**If quick mode:** Enable every detected design tool. If Stitch is enabled, default `device_type: DESKTOP`. If both are detected, enable both. Skip all design tool questions. Log decisions.

| Figma MCP | Stitch MCP | Action |
|----------|-----------|--------|
| connected | connected | **Expert:** "Design tools: figma / stitch / both?" **Guided:** "Both Figma and Stitch are available. Figma imports existing designs. Stitch generates new mockups from text. Which? (figma / stitch / both)" **Full guidance:** "Both Figma and Stitch are available. Figma imports existing designs for comparison during `/pipeline:ui-review` — it checks your implementation against the original design. Stitch generates new mockups from text prompts during `/pipeline:brainstorm` — it creates visual prototypes from your feature description. You can use both (Figma for design fidelity, Stitch for exploration). Which? (figma / stitch / both)" |
| connected | not connected | Enable Figma. Mention: "Stitch can generate design mockups from text — see `docs/prerequisites.md` to set it up." |
| not connected | connected | Enable Stitch. Mention: "If you have existing Figma designs, you can add the Figma MCP server too — see `docs/prerequisites.md`." |
| not connected | not connected | Neither. Show: "No design tools detected. Brainstorming will use simple HTML wireframes. See `docs/prerequisites.md` to set up Stitch (free, generates AI mockups) or Figma." |

If Stitch is enabled, ask about device type:

**Expert:**
> "Stitch device target? (desktop/mobile/tablet/agnostic)"

**Guided:**
> "What's the primary device target for Stitch designs?
> 1. **Desktop** (default) 2. **Mobile** 3. **Tablet** 4. **Device-agnostic**"

**Full guidance:**
> "What's the primary device target for designs in this project? This controls the viewport and layout Stitch uses when generating mockups.
> 1. **Desktop** (default) → standard browser viewport
> 2. **Mobile** → phone-sized viewport, touch-friendly
> 3. **Tablet** → tablet viewport
> 4. **Device-agnostic** → generic, no viewport constraints"

Set `integrations.stitch.device_type` to the corresponding enum value (e.g., `DESKTOP`, `MOBILE`, `TABLET`, `AGNOSTIC`). Do NOT create a Stitch project during init — it's created lazily on first brainstorm use so the title matches the feature being designed.

---

**Interpret Postgres results:**

**If quick mode:** Only enable Postgres if it's clearly running (accepting connections on a known port). For ambiguous states (installed but not running, alt port open without pg_isready), skip Postgres and default to files tier. Log the detection result and decision. Do not attempt to start Postgres or ask about alternate ports.

| pg_isready | Install found | Port 5432 | Alt port open | Interpretation |
|-----------|--------------|-----------|---------------|----------------|
| on PATH | — | accepting | — | **Running on default port.** Set `postgres.enabled: true`, `port: 5432` |
| found (not on PATH) | yes | accepting | — | **Running but not on PATH.** Note the path, set enabled, suggest adding to PATH |
| on PATH | — | not responding | no | **Installed but not running.** **Expert:** "Postgres installed, not running. Start/skip?" **Guided/Full:** "Postgres is installed but not running. Start it, or skip for now?" |
| on PATH | — | not responding | yes (e.g. 5433) | **Running on non-default port.** **Expert:** "Port [N] open. Postgres? (y/n)" **Guided/Full:** "Postgres doesn't respond on 5432 but port [N] is open. Is that your Postgres port?" If confirmed, use that port |
| not found | yes | closed | no | **Installed but not on PATH and not running.** **Expert:** "Postgres at [path], not running. Configure? (y/n)" **Guided:** "Postgres is installed at [path] but not on PATH and not running. Want to configure it?" **Full guidance:** (same as guided + explain what PATH means and how to start Postgres) |
| not found | yes | open or alt open | — | **Port open, no pg_isready.** **Expert:** "Port [N] open — Postgres? (y/n, or enter port)" **Guided:** "Something is listening on port [N] — is that Postgres? What port?" **Full guidance:** (same as guided + explain that pg_isready was not found so we cannot confirm it is Postgres) |
| not found | no | closed | no | **Not installed.** Show install instructions |

**Present integration results grouped by importance:**

> **Detected integrations:**
> [list each with what it enables]
>
> **Not detected — optional enhancements:**
> [list each with what it would add, whether it has a fallback, and how to install]

**For each missing integration, clearly state whether it's required or optional and what the fallback is:**

**If quick mode:** Enable every detected integration without asking. For Playwright specifically: if not detected, auto-install it (`[pkg_manager] add -D @playwright/test && npx playwright install chromium`), then enable. **If Playwright install fails:** disable Playwright, log the error ("Playwright install failed — skipped. Install manually later."), and continue. For all other missing integrations, disable them and log the skip. Do not show "how to install" messages for missing tools — the summary at the end covers everything.

| Integration | Required? | What it enables | Fallback without it | If missing |
|------------|-----------|----------------|--------------------|----|
| **Stitch** | Optional | AI-generated design mockups in `/pipeline:brainstorm` and `/pipeline:ui-review` | HTML wireframes via visual companion subagent | Show: "See `docs/prerequisites.md` for Stitch setup (free, generates AI mockups from text)." |
| **Figma** | Optional | Import existing designs for comparison in `/pipeline:ui-review` and reference in `/pipeline:brainstorm` | Stitch for new mockups, or no design reference | Show: "See `docs/prerequisites.md` for Figma MCP setup." |
| **Playwright** | Optional | Screenshot capture for `/pipeline:ui-review` | Chrome DevTools MCP, or provide screenshots manually | **Expert:** "Install Playwright? (y/n)" **Guided:** "Playwright enables automatic screenshot capture for UI reviews. Install it? (I'll run `[pkg_manager] add -D @playwright/test && npx playwright install chromium`)" **Full guidance:** "Playwright captures screenshots automatically during `/pipeline:ui-review`. Without it, you can use Chrome DevTools MCP (if Chrome is running with remote debugging) or provide screenshots manually. Install it? (I'll run `[pkg_manager] add -D @playwright/test && npx playwright install chromium`)" If declined: "No problem — see `docs/prerequisites.md` for manual setup, or use Chrome DevTools MCP instead." |
| **GitHub CLI** | Optional | PR creation in `/pipeline:finish`, issue management | Push branches manually, create PRs in browser | Show: "GitHub CLI (`gh`) enables PR creation from `/pipeline:finish`. See `docs/prerequisites.md` for setup." |
| **Postgres** | Optional | Knowledge tier with semantic search, structured queries | Files tier (markdown-based, zero setup) | Show: "Without Postgres, you'll use the files tier — markdown-based session tracking that works but lacks search. See `docs/prerequisites.md` for setup." |
| **Ollama** | Optional | Semantic/hybrid search in Postgres tier | FTS keyword search only (still useful) | Show: "Ollama runs embedding models locally (no API keys, no cloud). See `docs/prerequisites.md` for setup. Without it, keyword search still works." |
| **Chrome DevTools** | Optional | Screenshot capture for `/pipeline:ui-review` | Playwright, or provide screenshots manually | Show: "Launch Chrome with `--remote-debugging-port=9222` for automatic screenshots. See `docs/prerequisites.md` for details." |
| **Sentry** | Optional | Auto-pull recent errors in `/pipeline:debug` | Reproduce errors manually | Show: "Set `SENTRY_AUTH_TOKEN` env var. See `docs/prerequisites.md` for setup." |

**Key rule (interactive mode):** Always ask before installing anything. If the user declines, show the manual install command so they can do it later. Never silently install packages.

**Key rule (quick mode):** Auto-install Playwright without asking. All other missing integrations are skipped (they require system-level setup like installing Postgres or configuring MCP servers, which can't be automated).

---

### Step 4 — Knowledge tier decision

**If quick mode and Postgres is detected+running (accepting connections):**
1. Choose `postgres` tier automatically.
2. Locate the pipeline plugin's `scripts/` directory (same resolution as interactive mode below).
3. Auto-install dependencies: `cd <scripts_path> && pnpm install`. **If install fails:** fall back to `files` tier, log the error, continue.
4. Generate project-scoped DB name, run `pipeline-db.js setup`, verify with `pipeline-db.js status`. **If setup fails:** fall back to `files` tier, log the error, continue.
5. If Ollama is available, use `mxbai-embed-large` as the embedding model. Auto-pull if not present: `ollama pull mxbai-embed-large`. **If pull fails or times out:** skip embedding model, log "Ollama pull failed — FTS keyword search only. Pull manually later: `ollama pull mxbai-embed-large`". Continue with Postgres tier (FTS still works without embeddings).
6. Set `knowledge.tier: "postgres"` with `database`, `host`, `port`, `user`, `embedding_model` (if pulled successfully).
7. Add `"node $SCRIPTS_DIR/pipeline-embed.js index"` to `commit.post_commit_hooks` (keeps embeddings current after each commit). Skip this if no embedding model was configured.
8. Log everything: tier chosen, DB name, deps installed, embedding model (or "none — FTS only").

**If quick mode and Postgres is NOT running:**
1. Choose `files` tier.
2. Create directories: `mkdir -p docs/sessions docs/specs docs/plans`
3. Log: "Postgres not detected — using files tier. Run `/pipeline:update knowledge` to switch later."
4. Skip to Step 5.

Present options based on engagement style and what was detected:

**Expert:**
> "Knowledge tier? (files / postgres) [Postgres detected: [yes/no], Ollama: [yes/no]]"

**Guided:**
> "Where should Pipeline store session history?
>
> 1. **Files** (zero setup) — markdown files in `docs/sessions/`. Works everywhere.
> 2. **Postgres** [if detected: "(detected — running on port [N])"] — structured storage with semantic search [if Ollama detected: "powered by local embeddings via Ollama"]. Best for 10+ session projects.
>
> [If Postgres not detected: "Postgres is not running. Choose files for now, or start Postgres and re-run `/pipeline:init`."]"

**Full guidance:**
> "Pipeline tracks every session's decisions, findings, and gotchas. Where this data lives affects how well Pipeline can recall relevant context in future sessions.
>
> 1. **Files** (zero setup) — markdown files in `docs/sessions/`. No dependencies. Works on any machine. But search is limited to filenames and manual browsing.
> 2. **Postgres** [if detected: "(detected — running on port [N])"] — structured database with full-text search [if Ollama detected: " + semantic search via Ollama embeddings (finds related work even when terminology differs)"]. Tracks tasks, findings, decisions, and gotchas in queryable tables. The `/pipeline:knowledge` commands give instant context.
>
> For any project you'll work on across 10+ sessions, Postgres is significantly more powerful. For quick projects or when Postgres isn't available, files work fine.
>
> [If Postgres not detected: "Postgres is not running on this machine. You can install it later and switch with `/pipeline:update knowledge`."]"

If Postgres chosen and available:

The pipeline scripts need the `pg` Node.js package to talk to Postgres. The plugin's scripts use pnpm (they have a `pnpm-lock.yaml`) — always use `pnpm install` here, regardless of the project's own package manager. Ask before installing:

**Expert:**
> "Install pipeline DB deps? (pnpm install in plugin scripts dir) (y/n)"

**Guided:**
> "I need to install the pipeline's database dependencies (the `pg` package). This goes in the plugin's scripts directory, not your project. OK? (I'll run `pnpm install`)"

**Full guidance:**
> "To connect to Postgres, Pipeline needs the `pg` Node.js driver. This installs in the pipeline plugin's own scripts directory — it does NOT affect your project's dependencies or package.json. OK to install? (I'll run `pnpm install` in the pipeline scripts directory)"

If yes:
1. Locate the pipeline plugin's `scripts/` directory using the same resolution as `/pipeline:knowledge` Step 0: check `$PIPELINE_DIR/scripts/`, then `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`, then search `${HOME:-$USERPROFILE}/.claude/` for `pipeline-db.js`. Store the resolved absolute path — use this literal path (not a variable) in all subsequent Bash calls.
2. Install dependencies: `cd <scripts_path> && pnpm install`
3. **Generate project-scoped DB name:** `pipeline_<project_name>` — lowercase the project name, replace non-alphanumeric characters with underscores, collapse consecutive underscores, strip leading/trailing underscores, prefix with `pipeline_`. Each project gets its own database — no context leaks between projects.
4. Run setup: `PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js setup` (creates the project-specific database and tables)
5. Verify: `PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js status`
6. Set `knowledge.tier: "postgres"` in config with:
   - `database: "pipeline_<sanitized_project_name>"` (the generated name)
   - `host`, `port` from detection (use detected port if non-default)
7. If Ollama is available, ask about embedding model. **Expert:** "Embedding model? (mxbai-embed-large / nomic-embed-text / other)" **Guided:** "Ollama is running. Which embedding model? `mxbai-embed-large` (1024-dim, good quality) or `nomic-embed-text` (768-dim, smaller/faster)?" **Full guidance:** "Ollama is running, which means Pipeline can use semantic search — finding related work even when the terminology differs (e.g., searching for 'auth' finds results about 'login' and 'session management'). Which embedding model? `mxbai-embed-large` (1024-dim, best quality, uses ~300MB VRAM) or `nomic-embed-text` (768-dim, smaller and faster). Or type any model name from https://ollama.com/search?c=embedding." Set `knowledge.embedding_model` to their choice. If the model isn't pulled yet, run `ollama pull <model>`.
8. Add to config's `commit.post_commit_hooks`:
   `"node $SCRIPTS_DIR/pipeline-embed.js index"` (keeps embeddings current after each commit)
9. If user has an existing project they want to bring context from, mention:
   > "If you have gotchas or decisions from another project you'd like to carry over, use `/pipeline:knowledge import <source_db_or_file>` after setup."

If declined: "No problem. Run these yourself when you're ready:
1. `cd [scripts_dir] && pnpm install`
2. `/pipeline:knowledge setup`"

If files chosen (default):
1. Create directories: `mkdir -p docs/sessions docs/specs docs/plans`
2. Set `knowledge.tier: "files"` in config

---

### Step 5 — Generate config

Using all detected values, generate `.claude/pipeline.yml`.

Set `project.pkg_manager` to the detected package manager from Step 1 (pnpm, npm, yarn, or bun).

Set `routing.source_dirs` from the value inferred in Step 1b. If Step 1b detected directories, use them. If no directories were detected (greenfield), apply profile-based defaults now that the profile is known:

| Profile | Default source dirs |
|---------|-------------------|
| SPA/Full-stack/API/Library | `["src/"]` |
| CLI (Go) | `["cmd/", "internal/"]` |
| CLI (other) | `["src/"]` |
| Mobile/Mobile+Web | `["src/"]` |

Log: "Source dirs: [dirs] — defaulted from [profile] profile"

**Never** use `["."]` — it poisons triage, commit gates, and audit by counting non-source files.

Map detected tools to config fields. Use the detected package manager's runner where applicable (e.g., pnpm → `pnpm exec`, npm → `npx`, yarn → `yarn`, bun → `bunx`):
- package.json + typescript → `commands.typecheck: "[runner] tsc --noEmit"`
- package.json + eslint → `commands.lint: "[runner] eslint src/"`
- package.json + vitest → `commands.test: "[runner] vitest run"`
- package.json + jest → `commands.test: "[runner] jest"`
- Cargo.toml → `commands.test: "cargo test"`, `commands.typecheck: null` (Rust compiler handles it)
- go.mod → `commands.test: "go test ./..."`, `commands.lint: "golangci-lint run"`
- pyproject.toml + pytest → `commands.test: "pytest"`, `commands.lint: "ruff check ."`

Include profile-based defaults from Step 2b (review criteria, security checks). Set `security.policy` from Step 2c. Set `project.engagement` from Step 0b. Set `review.sectors: []` — sectors are configured later via `/pipeline:update sectors` or on first `/pipeline:audit` run, when there's actual code to inform the conversation.

Write the config file:
```bash
mkdir -p .claude docs/specs docs/plans
```
Then use the Write tool to create `.claude/pipeline.yml`.

---

### Step 6 — Confirm and guide

**If quick mode:** Print a decision log instead of the interactive summary. Skip the getting-started guide and the offer to open docs. Quick users know what they're doing.

```
## Pipeline configured (quick mode)

**Project:** [name] ([profile]) — [evidence, e.g., "inferred from next.config.ts"]
**Repo:** [owner/repo or "none — no git remote"]
**Branch:** [branch]
**Package manager:** [detected]

**Commands:**
- Typecheck: [command or disabled]
- Lint: [command or disabled]
- Test: [command or disabled]

**Integrations enabled:** [list each with evidence, e.g., "GitHub CLI (gh detected)", "Playwright (auto-installed)"]
**Integrations skipped:** [list each with reason, e.g., "Sentry (SENTRY_AUTH_TOKEN not set)", "Stitch (MCP not connected)"]

**Engagement:** expert
**Security policy:** milestone
**Knowledge:** [tier] [if postgres: "DB: pipeline_<name>, embedding: mxbai-embed-large"]
**Source dirs:** [list, with inference evidence]

**Auto-installed:**
- [list everything installed, e.g., "Playwright (@playwright/test + chromium)", "Pipeline DB deps (pg via pnpm)", "Ollama model (mxbai-embed-large)"]
- [or "nothing" if nothing was installed]

**Adjust anything:** `/pipeline:update`
```

Stop after printing the summary. Do not show the getting-started guide or offer to open docs.

**If interactive mode:** Report what was detected and configured:

```
## Pipeline configured

**Project:** [name] ([profile])
**Repo:** [owner/repo]
**Branch:** [main branch]
**Package manager:** [detected]
**Engagement:** [expert/guided/full-guidance]

**Commands:**
- Typecheck: [command or disabled]
- Lint: [command or disabled]
- Test: [command or disabled]

**Integrations:** [list enabled]
**Knowledge:** [tier] [details]
**Security policy:** [every-feature/milestone/on-demand]
**Source dirs:** [list, with inference evidence]

Config written to `.claude/pipeline.yml`.
Review sectors are configured later — run `/pipeline:update sectors` when you have code to review.
```

Then show the getting-started guide scaled to engagement style:

**Expert (any project type):**

```
## Next steps
- `/pipeline:triage` — size a change, get the right workflow
- `/pipeline:commit` — preflight gates + commit
- `/pipeline:update` — adjust config
```

**Guided — greenfield:**

```
## Getting started

1. `/pipeline:brainstorm` — explore your first feature's requirements and design
2. `/pipeline:plan` — create an implementation plan from the spec
3. `/pipeline:build` — execute the plan with built-in quality checks

Once you have code: `/pipeline:commit` to commit, `/pipeline:triage` to size changes.
Adjust anything: `/pipeline:update`
```

**Guided — established:**

```
## Getting started

1. `/pipeline:commit` — runs preflight gates (typecheck, lint, test) and commits
2. `/pipeline:triage` — tells you the right workflow for any change size

All commands: `/pipeline:` then tab-complete. Adjust anything: `/pipeline:update`
```

**Full guidance — greenfield:**

```
## Getting started

Your project is set up for planning-first development. Here's the recommended workflow:

1. **Start with an idea:** `/pipeline:brainstorm` walks you through requirements, user stories, and design. It produces a spec document that captures what you're building and why.
2. **Plan the work:** `/pipeline:plan` turns your spec into a task-by-task implementation plan with acceptance criteria.
3. **Build with guardrails:** `/pipeline:build` executes the plan — dispatching subagents for each task, reviewing after each, and running quality gates automatically.
4. **Ship it:** `/pipeline:finish` creates a PR, compiles a summary of all work, and closes tracking issues.

Once you have code:
- `/pipeline:commit` — runs typecheck + lint + tests before every commit
- `/pipeline:update sectors` — auto-configures review sectors from your directory structure
- `/pipeline:triage` — analyzes any change and recommends the right workflow size

**Adjust anything later:** `/pipeline:update`
**Full documentation:** Open docs/index.html in your browser for the complete guide with examples.
```

**Full guidance — established:**

```
## Getting started

Pipeline adapts its workflow based on the size of each change:
- **TINY** changes (1-2 files, config tweaks): just `/pipeline:commit` with preflight gates
- **MEDIUM** changes (3-10 files): brainstorm → plan → build → review → commit
- **LARGE** changes (10+ files): adds debate, architecture plan, QA, and red team

Use `/pipeline:triage` before any change to get the right workflow recommendation.

**All commands:** `/pipeline:` then tab-complete to see options
**Adjust anything:** `/pipeline:update`
**Full documentation:** Open docs/index.html in your browser for the complete guide with examples.
```

After presenting the summary, offer to open the documentation page:

```
Would you like me to open the Pipeline documentation in your browser?
```

If yes, resolve the plugin's install location by finding the directory containing this command file (init.md), then open `docs/index.html` relative to the plugin root. Use the platform-appropriate command: `start "" "<path>"` (Windows), `open "<path>"` (Mac), or `xdg-open "<path>"` (Linux). The file is a self-contained HTML page with no external dependencies.

---

### Issue Tracking

If `platform.issue_tracker` is not `none`, create an issue to track that initialization was completed:

Create the initialization issue:
```bash
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue create --title 'Pipeline initialized' --labels 'pipeline' --stdin
## Pipeline Setup

**Profile:** [profile]
**Knowledge tier:** [tier]
**Security policy:** [policy]
**Engagement:** [engagement style]
**Platform:** [code_host] / [issue_tracker]
**Integrations:** [list enabled]

Config: `.claude/pipeline.yml`
EOF
```

If the command fails, notify the user with the error and ask for guidance.

This is the first entry in the project's issue trail. All subsequent pipeline commands post to their own issues, building the project's audit log.
