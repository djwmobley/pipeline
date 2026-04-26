---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*)
description: Project setup — detects tools, creates .claude/pipeline.yml (use --quick for zero interaction)
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=orientation
```


## Pipeline Init

You are the pipeline setup agent. Your job is to detect the project environment and generate a `.claude/pipeline.yml` config file.

### Argument parsing

Check if the user's arguments contain `--quick` or `quick`. If so, set **quick mode = true**.

**Quick mode** runs the same detection scripts but makes every decision autonomously — zero user interaction. It uses sensible defaults for anything it can't detect, auto-installs dependencies (Playwright, Postgres `pg` package, Ollama embedding model), and prints a full decision log at the end. The user can adjust anything afterward with `/pipeline:update`.

Throughout this command, each decision point has a **"If quick mode:"** block. When quick mode is active, follow those blocks and skip all user prompts.

**Resolve `$SCRIPTS_DIR`** before anything else — locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

This is independent of the project config — it finds the plugin install location. All subsequent steps use `[SCRIPTS_DIR]` for platform.js, orchestrator.js, and other script references.

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

Run the detection probe:

```bash
node '[SCRIPTS_DIR]/pipeline-init-detect.js'
```

The probe emits a single JSON object on stdout with all detection fields. State the detected values in prose so Step 1b (gap-fill), Step 2 (profile inference), Step 4 (knowledge tier), and Step 5 (config generation) can consume them downstream:

- **project_files**: presence check for `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `setup.py`, `pom.xml`, `build.gradle`, `requirements.txt`.
- **git**: `{remote, branch}` if a git remote exists; otherwise `null`.
- **deps**: framework markers from `package.json` (`vitest`, `next`, `react-native`, etc.), `Cargo.toml` markers (`[[bin]]`, `axum`, `actix`, `clap`, `rocket`), and `go_mod_present`. Plus `package_json_bin` / `package_json_main_or_exports` for CLI-vs-library shape signals.
- **source_dirs**: which of `src`, `lib`, `app`, `pkg`, `cmd`, `internal`, `ios`, `android`, `server`, `prisma`, `drizzle` exist as directories.
- **config_files**: framework configs detected (`next.config.*`, `vite.config.*`, etc.).
- **pkg_manager**: `{name, detection_source}` where `name` is `pnpm` | `bun` | `yarn` | `npm` | `none` and `detection_source` names the lockfile or fallback used.
- **source_file_count**: `.ts` / `.tsx` / `.js` / `.jsx` / `.rs` / `.go` / `.py` file count under `src` / `lib` / `app` (skips `node_modules` and hidden directories).
- **greenfield**: `true` if `source_dirs` is empty OR `source_file_count < 5`. Flag it — this affects profile recommendations (Step 2) and sector setup (Step 5).

The probe spawns `git` via `execFileSync` with an argv array (no shell interpretation) and passes `cwd` explicitly. On any probe failure it exits non-zero with a one-line stderr naming which step failed — stop and surface the error rather than guessing detection.

---

### Step 1b — Fill in gaps

**If quick mode:** Use the directory name for `project.name` if no `name` field found in package.json/Cargo.toml/etc. Set `project.repo: null` if no git remote detected. Infer source dirs from detection. Log all decisions. Skip to Step 2.

**Project name:** If no `name` field in package.json/Cargo.toml/etc., use the directory name.

**Git remote and repo creation:** If `git remote get-url origin` returned nothing (no remote configured):

**Expert:**
> "No git remote. Repo name? (e.g., `owner/repo`, Enter to skip, or `create` to make one)"

**Guided:**
> "No git remote detected. Pipeline uses an issue tracker for issue tracking and PR workflows.
>
> Options:
> - Enter a repo name (e.g., `owner/repo`)
> - Type `create` — I'll create a repo and set the remote
> - Press Enter to skip (issue tracking features will be disabled)"

**Full guidance:**
> "No git remote detected. Pipeline's workflow tracks all work through issues — every feature, fix, and finding gets an issue with description, commentary, and status. The `/pipeline:finish` command creates PRs automatically.
>
> Without a remote repo, these features are disabled. You can still use Pipeline for local development, but you'll lose the audit trail.
>
> Options:
> - Enter an existing repo name (e.g., `owner/repo`)
> - Type `create` — I'll create a new repo using `gh repo create` and set the remote
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

Verify the platform CLI is available and authenticated. Pass the detected platform via `--platform` since pipeline.yml does not exist yet:
```bash
node '[SCRIPTS_DIR]/platform.js' auth check --platform [detected_platform] 2>&1 | head -3
```
Where `[detected_platform]` is `github` or `azure-devops` based on the git remote URL detection above.

If not authenticated: "Platform CLI not authenticated. For GitHub: run `gh auth login`. For Azure DevOps: run `az login`."

Set in pipeline.yml:
```yaml
platform:
  code_host: "github"
  issue_tracker: "github"
```

**If azure-devops detected:**

Dispatch the `init-azure-devops` subagent via the `Task` tool. The subagent reads `$PIPELINE_DIR/skills/init-azure-devops/SKILL.md` for the dispatch contract and error-interpretation table, invokes `scripts/pipeline-init-azure-devops.js`, interprets `az` CLI errors, and returns a structured JSON verification result. This separates LLM-cognitive error interpretation (subagent) from mechanical `az` invocations (helper script).

Invocation:

```
Task({
  subagent_type: "general-purpose",
  description: "Azure DevOps verification",
  prompt: "Follow the dispatch contract in [PIPELINE_DIR]/skills/init-azure-devops/SKILL.md. Inputs: remote_url='[git_remote_url]', quick_mode=[true|false]. Emit a single fenced json code block as your final message matching the SKILL's output schema."
})
```

Parse the last fenced `json` block from the subagent's reply. On `verified: true`, write `platform_config` fields into pipeline.yml under `platform.azure_devops.*` with `platform.code_host: "azure-devops"` and `platform.issue_tracker: "azure-devops"`. On `verified: false`:

- **If quick mode:** log `errors[0].user_action`, set `platform.code_host: "azure-devops"`, `platform.issue_tracker: "none"` (partial enablement — git remote works, issue workflows disabled), continue to Step 2.
- **If interactive:** surface each `errors[].user_action` to the user with the matching `install_command` if present, then ask whether to retry, skip (same partial enablement as quick mode), or abort.

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
| Queue consumer deps (bull, bullmq, amqplib, kafka-node) or worker process pattern (no HTTP server) | `service` |
| ETL/pipeline deps (pandas, dbt, airflow, prefect, dagster) or batch processing scripts + data source configs | `data-pipeline` |
| CI/CD helpers, scheduled tasks, or scripts with no persistent process (cron jobs, GitHub Actions custom) | `automation` |
| Cargo.toml with `[[bin]]` and no frontend | `cli` or `api` (check for web framework like Axum/Actix) |
| go.mod with `cmd/` directory | `cli` |
| go.mod with web framework (Echo, Gin, Fiber) | `api` |

Present the inference for confirmation, scaled by engagement style:

**Expert (established):**
> "Profile: [inferred] ([evidence]). OK? (Y/n, or: spa/fullstack/mobile/mobile-web/api/cli/library/service/data-pipeline/automation)"

**Expert (greenfield):**
> "Profile? (spa/fullstack/mobile/mobile-web/api/cli/library/service/data-pipeline/automation)"

**Guided (established):**
> "Based on your project structure, this looks like a **[inferred profile]** project ([evidence]).
> Sound right? (Y/n, or pick a different profile: spa, fullstack, mobile, mobile-web, api, cli, library, service, data-pipeline, automation)"

**Guided (greenfield):**
> "What type of project is this?
>
> 1. **SPA** — Single-page web app
> 2. **Full-stack** — Frontend + backend (Next.js, Nuxt, SvelteKit)
> 3. **Mobile** — Native mobile app
> 4. **Mobile + Web** — Shared codebase with web fallback
> 5. **API** — Backend service
> 6. **CLI** — Command-line tool
> 7. **Library** — Reusable package/module
> 8. **Service** — Background worker, integration service, queue consumer. Reviews add resilience and error handling.
> 9. **Data Pipeline** — ETL, data sync, batch processing. Reviews add idempotency and data integrity.
> 10. **Automation** — Scripts, scheduled tasks, CI/CD helpers. Reviews focus on security and error handling."

**Full guidance (established):**
> "Based on your project structure, this looks like a **[inferred profile]** project.
>
> Evidence: [detailed evidence list]
>
> The profile controls which review criteria Pipeline applies (e.g., accessibility checks for UI projects, battery-impact analysis for mobile). Sound right? (Y/n, or pick: spa, fullstack, mobile, mobile-web, api, cli, library, service, data-pipeline, automation)"

**Full guidance (greenfield):**
> "What type of project is this? The profile controls which review criteria, security checks, and recommendations Pipeline applies throughout the workflow.
>
> 1. **SPA** — Single-page web app (React, Vue, Angular, Svelte). Reviews focus on UX, accessibility, performance.
> 2. **Full-stack** — Frontend + backend in one repo (Next.js, Nuxt, SvelteKit, Rails). Reviews add API design and data integrity.
> 3. **Mobile** — Native mobile app (React Native, Flutter, Swift, Kotlin). Reviews add battery impact and performance.
> 4. **Mobile + Web** — Shared codebase with web fallback (Capacitor, Expo Web). Reviews add responsive design.
> 5. **API** — Backend service or REST/GraphQL API. Reviews focus on security, error handling, data integrity.
> 6. **CLI** — Command-line tool. Reviews focus on error handling and UX.
> 7. **Library** — Reusable package/module. Reviews add backwards-compatibility and documentation.
> 8. **Service** — Background worker, integration service, queue consumer. Reviews add resilience and error handling.
> 9. **Data Pipeline** — ETL, data sync, batch processing. Reviews add idempotency and data integrity.
> 10. **Automation** — Scripts, scheduled tasks, CI/CD helpers. Reviews focus on security and error handling."

Set `project.profile` to the chosen value: `spa`, `fullstack`, `mobile`, `mobile-web`, `api`, `cli`, `library`, `service`, `data-pipeline`, `automation`.

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
| **Service** | Node + BullMQ + TypeScript or Go + goroutines | Depends on workload, concurrency needs |
| **Data Pipeline** | Python + pandas/dbt or Node + streaming transforms | Depends on data volume and transform complexity |
| **Automation** | Node scripts + TypeScript or Bash + shellcheck | Depends on complexity and distribution |

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
| Service | `[dead-code, security, simplicity, solid, error-handling, data-integrity, performance, resilience]` |
| Data Pipeline | `[dead-code, security, simplicity, solid, error-handling, data-integrity, idempotency]` |
| Automation | `[dead-code, security, simplicity, solid, error-handling]` |

**New criteria (available for all profiles via config override):**
- **resilience** — Retry logic with backoff, circuit breakers, graceful shutdown, health check endpoints, timeout handling
- **idempotency** — Safe reruns, cursor/watermark management, deduplication strategies, at-least-once vs exactly-once semantics

**Security checklist additions by profile:**

| Profile | Extra checks |
|---------|-------------|
| SPA, Full-stack, Mobile + Web | `{ check: "Renders user content?", rule: "Sanitize HTML — never render raw user input without a sanitizer like DOMPurify" }` |
| Mobile, Mobile + Web | `{ check: "Stores data on device?", rule: "Use secure storage for tokens — never use plain storage for secrets" }` |
| API | `{ check: "Exposes endpoint?", rule: "Rate limit, authenticate, validate input schema" }` |
| Library | `{ check: "Accepts external input?", rule: "Validate types at boundary — never trust caller input" }` |
| Service | `{ check: "Credentials for external systems?", rule: "Secrets manager or env vars — never embed in source or bake into container images" }` |
| Data Pipeline | `{ check: "Moves data between systems?", rule: "Validate schema at both ends — never trust upstream data shapes. Log redacted — never log full records containing PII" }` |
| Automation | `{ check: "Runs with elevated privileges?", rule: "Least privilege — request only permissions needed" }` |

**QA defaults by profile:**

| Profile | browser_testing | api_testing | db_verification |
|---------|----------------|-------------|-----------------|
| SPA, Full-stack, Mobile + Web | true | true | true |
| Mobile | true | true | true |
| API | false | true | true |
| CLI | false | false | false |
| Library | false | false | false |
| Service | false | false | true |
| Data Pipeline | false | false | true |
| Automation | false | false | false |

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

Run the integration probe:

```bash
node '[SCRIPTS_DIR]/pipeline-init-integrations.js'
```

The probe emits a single JSON object on stdout. State the detected values so the "Interpret Postgres results" table and integration decision matrix below can drive the decisions:

- **env_vars**: presence flags only (not values) for `SENTRY_AUTH_TOKEN`, `POSTHOG_API_KEY`, `GAMMA_API_KEY`, `GITHUB_TOKEN`.
- **postgres.pg_isready**: `"on_path"` | `{"path": "..."}` | `null` — which `pg_isready` binary is reachable.
- **postgres.installs_found**: array of Postgres install directory paths (Windows `Program Files\PostgreSQL\*`, Linux `/usr/lib/postgresql/*`, macOS Homebrew `postgresql*`).
- **postgres.port_5432**: `"accepting"` (TCP open AND `pg_isready` confirms) | `"port_open"` (TCP open, `pg_isready` unavailable to confirm) | `"not_responding"` (TCP open but `pg_isready` says no) | `"closed"`.
- **postgres.alt_ports_open**: non-default ports open among 5433, 5434, 54320.
- **ollama.responding**: `true` if `http://localhost:11434/api/tags` returns.
- **chrome.responding**: `true` if `http://localhost:9222/json/version` returns (the remote-debugging port).
- **playwright.installed** / **version_if_known**: from `npx playwright --version`.
- **gh.installed** / **version_if_known**: from `gh --version`.

The probe spawns subprocesses via argv array (no shell interpretation), probes TCP ports via Node's `net.createConnection` (no `/dev/tcp`), probes HTTP via `http.request` (no `curl`), and resolves Windows Postgres paths via `process.env.ProgramFiles` / `process.env['ProgramFiles(x86)']` (no hardcoded `/c/Program Files/...` literals). On probe failure it exits non-zero with a one-line stderr.

Consume `postgres` against the "Interpret Postgres results" table below, and the other fields against the integration decision matrix further down.

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

### Step 3b: Local Model Host Detection

Run local model detection:

```bash
PROJECT_ROOT=$(pwd) node '[SCRIPTS_DIR]/pipeline-init-detect.js' detect-local-models
```

The script probes Ollama (`:11434`), LM Studio (`:1234`), vLLM (`:8000`), and llama.cpp (`:8080`).

**If `routing.local_models` already exists in `.claude/pipeline.yml` with non-null values:**

Display current config and ask:
> "Existing local model config found:
> - prose: [current prose model name] via [host_type] at [endpoint]
> - coder: [current coder model name] via [host_type] at [endpoint]
>
> Keep existing local model config? (Y/n)"
>
> If Y: skip to Step 4.
> If N: re-run detection.

**Guided engagement (if no prior config):**

Display detection results, then ask:
> "Convention routing uses local models to run short drafts and code generation for free.
>
> Detected: [list hosts that responded with model counts, or 'none']
>
> Which local model server are you using?
> 1. Ollama ([detected/not detected] — [N models])
> 2. LM Studio (OpenAI-compatible, [detected/not detected])
> 3. vLLM (OpenAI-compatible, [detected/not detected])
> 4. llama.cpp server (OpenAI-compatible, [detected/not detected])
> 5. Other OpenAI-compatible endpoint — enter URL
> 6. None — Anthropic models only (Haiku will substitute for local tiers)"

After host selection, list available models from the host and ask:
> "Which model should serve **prose drafts** (memory entries, comments, short summaries)?
> Which model should serve **code drafts** (scripts, SQL, YAML, regex)?"

If no models are listed:
> "No models found at [endpoint]. Pull models first (e.g., `ollama pull qwen2.5:14b`), then re-run `/pipeline:init` or `/pipeline:update routing`."

**Expert engagement:**
> "Local model host? (ollama / lmstudio / vllm / llamacpp / openai-compat [url] / none)"
> Prose model name? Coder model name?

**Quick mode:** Use first detected host. If Ollama already configured, use it. If nothing detected, set `none`.

**What gets written to `.claude/pipeline.yml`:**
- `routing.enabled: true`
- `routing.local_models.prose`: name, host_type, endpoint, api_protocol, context_window: 8192
- `routing.local_models.coder`: name, host_type, endpoint, api_protocol, context_window: 16384
- Full `routing.tier_map` block (all eight operation classes)
- Full `routing.universal_floor.bash_block_patterns` block

**Hook entries added to `.claude/settings.json`:**
The three hook entries (PreToolUse, PostToolUse, Stop) pointing to absolute paths under the plugin's `scripts/hooks/` directory.

---

### Step 4 — Knowledge tier decision

Orchestration is delegated to `scripts/pipeline-init-knowledge.js` (two subcommands: `setup-postgres`, `setup-files`). It handles pnpm install, db setup + verify, Ollama pull, and directory creation. Engagement-variant prompts below stay inline — they are LLM cognition. Script is Windows-safe: `execFileSync` argv arrays, no shell strings.

**Result interpretation (applies to every `setup-postgres` call below):**

- `already_set_up: true` → DB exists with `sessions` table; script short-circuited. Log "Postgres DB `[db_name]` already configured — reusing."
- Non-zero exit → pnpm install or db setup failed. Fall back to `setup-files`, log the stderr, continue.
- `ollama_pull_result: "failed"` or `"skipped"` → Postgres tier still works (FTS keyword search). Log "Ollama pull [status] — FTS only. Pull manually later."
- Config wiring: set `knowledge.tier: "postgres"`, `knowledge.database: [db_name]`, `host`/`port`/`user` from detection. Set `knowledge.embedding_model: [embedding_model]` and append `[post_commit_hook]` to `commit.post_commit_hooks` only when `ollama_pull_result == "ok"`.

**Quick mode, Postgres detected + accepting connections:**

```bash
node '[SCRIPTS_DIR]/pipeline-init-knowledge.js' setup-postgres --project-name '[project_name]' --embedding-model mxbai-embed-large
```

**Quick mode, Postgres NOT running:**

```bash
node '[SCRIPTS_DIR]/pipeline-init-knowledge.js' setup-files
```

Set `knowledge.tier: "files"`. Log: "Postgres not detected — using files tier. Run `/pipeline:update knowledge` to switch later." Skip to Step 5.

---

**Interactive mode** — ask tier choice scaled by engagement style:

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

**If Postgres chosen** — the pipeline scripts need the `pg` package. Ask before running `pnpm install` in the plugin's `scripts/` directory:

**Expert:**
> "Install pipeline DB deps? (pnpm install in plugin scripts dir) (y/n)"

**Guided:**
> "I need to install the pipeline's database dependencies (the `pg` package). This goes in the plugin's scripts directory, not your project. OK? (I'll run `pnpm install`)"

**Full guidance:**
> "To connect to Postgres, Pipeline needs the `pg` Node.js driver. This installs in the pipeline plugin's own scripts directory — it does NOT affect your project's dependencies or package.json. OK to install? (I'll run `pnpm install` in the pipeline scripts directory)"

If yes and Ollama is running, ask about embedding model:

**Expert:** "Embedding model? (mxbai-embed-large / nomic-embed-text / other)"

**Guided:** "Ollama is running. Which embedding model? `mxbai-embed-large` (1024-dim, good quality) or `nomic-embed-text` (768-dim, smaller/faster)?"

**Full guidance:** "Ollama is running, which means Pipeline can use semantic search — finding related work even when the terminology differs (e.g., searching for 'auth' finds results about 'login' and 'session management'). Which embedding model? `mxbai-embed-large` (1024-dim, best quality, uses ~300MB VRAM) or `nomic-embed-text` (768-dim, smaller and faster). Or type any model name from https://ollama.com/search?c=embedding."

Then invoke (use `--skip-pnpm-install` if declined, `--skip-ollama-pull` if Ollama unavailable or declined):

```bash
node '[SCRIPTS_DIR]/pipeline-init-knowledge.js' setup-postgres --project-name '[project_name]' --embedding-model '[chosen_model]'
```

Apply the interpretation rules above. If the user mentioned an existing project with gotchas/decisions to bring over:
> "Use `/pipeline:knowledge import <source_db_or_file>` after setup."

If pnpm-install declined, offer: "Run these yourself when ready: `cd [scripts_dir] && pnpm install`, then `/pipeline:knowledge setup`."

**If files chosen:** `node '[SCRIPTS_DIR]/pipeline-init-knowledge.js' setup-files`. Set `knowledge.tier: "files"`.

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

---

### Orchestrator

Start a new workflow using the project name as the workflow ID, then record init completion:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' start '[project.name]-[YYYY-MM-DD]'
node '[SCRIPTS_DIR]/orchestrator.js' complete init PASS '.claude/pipeline.yml'
```

If init failed (e.g., pipeline.yml was not written), still start the workflow but record the failure:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' start '[project.name]-[YYYY-MM-DD]'
node '[SCRIPTS_DIR]/orchestrator.js' complete init FAIL
```

If `orchestrator.js start` reports the workflow already exists, skip the start call — a prior init already created it.
