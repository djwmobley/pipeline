# Design: `--quick` flag for `/pipeline:init`

**Date:** 2026-03-24
**Status:** Approved
**Roadmap item:** `--quick` mode for init — Auto-detect everything, ask only what can't be detected.

## Summary

Add a `--quick` flag to `/pipeline:init` that runs all detection scripts identically but makes every decision autonomously using a default table. Zero user interaction. Auto-installs dependencies (Playwright, Postgres `pg` package, Ollama embedding model). Prints a full decision log at the end so nothing is hidden.

## Approach

Inline conditional blocks in the existing `init.md` command (Approach A). No new files, no duplication of detection logic. Each decision point gets a short `**If --quick:**` block that uses the default and logs the decision.

## Default Table

| Decision point | Quick-mode default |
|---|---|
| Git remote missing | `project.repo: null` |
| Project name | Directory name (or `name` from manifest) |
| Profile (established project) | Best guess from detection signals, no confirmation |
| Profile (greenfield, no signals) | `fullstack` |
| Greenfield stack recommendation | Skip entirely |
| Source dirs not detected | `["src/"]` |
| Figma + Stitch both available | Enable both |
| One design tool available | Enable it |
| No design tools | Disable both |
| Stitch device type | `DESKTOP` |
| Playwright not installed | Auto-install: `[pkg_manager] add -D @playwright/test && npx playwright install chromium` |
| Playwright detected | Enable |
| Knowledge tier (Postgres running) | `postgres` — auto-install deps, run setup, configure |
| Knowledge tier (no Postgres) | `files` — create directories |
| Embedding model (Ollama available) | `mxbai-embed-large` — auto-pull if not present |
| Embedding model (no Ollama) | Skip (FTS keyword search only) |
| Chrome DevTools detected | Enable |
| GitHub CLI detected | Enable |
| Sentry token set | Enable |
| PostHog token set | Enable |
| Any integration not detected | Disable |

## Changes to init.md

### Argument parsing (top of command)

Check if arguments contain `--quick` or `quick`. Set a boolean flag used throughout.

### Step 0 — Resume detection

If config exists and is complete, quick mode also stops — it does not overwrite. If config is incomplete, quick mode silently fills in the missing sections using defaults (no "resuming setup" message). Skips to the first incomplete section's step with quick-mode logic active.

### Step 1 — Detection scripts

No change. Same bash scripts run in both modes.

### Step 1b — Fill in gaps

**If `--quick`:** Use directory name for project name. Set `project.repo: null` if no remote. Skip asking. Log decisions.

### Step 2 — Project profile

**If `--quick`:** Use inferred profile directly without confirmation. If greenfield with no signals, default to `fullstack`. Skip stack recommendation. Log the inference and evidence.

### Step 2b — Profile-based defaults

No change. Same automatic mapping in both modes.

### Step 3 — Detect integrations

Detection scripts: no change.

**If `--quick`:** Enable every detected integration. For Stitch, default `device_type: DESKTOP`. For Playwright: auto-install if not detected (`[pkg_manager] add -D @playwright/test && npx playwright install chromium`), enable either way. Skip all "Want me to install?" questions. Log each decision.

### Step 4 — Knowledge tier

**If `--quick` and Postgres detected+running:**
1. Auto-install pipeline DB deps (`cd <scripts_path> && pnpm install`)
2. Generate project-scoped DB name
3. Run setup (`pipeline-db.js setup`)
4. If Ollama available, auto-pull `mxbai-embed-large` if not present
5. Set `knowledge.tier: "postgres"` with full config
6. Log everything installed

**If `--quick` and no Postgres:**
1. Create `docs/sessions docs/specs docs/plans` directories
2. Set `knowledge.tier: "files"`
3. Log: "Postgres not detected — using files tier. Run `/pipeline:update knowledge` to enable later."

### Step 5 — Generate config

No change. Same YAML generation from detected+decided values.

### Step 6 — Summary (quick-mode variant)

Replace the interactive summary with a decision log:

```
## Pipeline configured (quick mode)

**Project:** [name] ([profile]) — [evidence]
**Repo:** [repo or "none"]
**Branch:** [branch]
**Package manager:** [detected]

**Commands:**
- Typecheck: [command or disabled]
- Lint: [command or disabled]
- Test: [command or disabled]

**Integrations enabled:** [list with detection evidence]
**Integrations skipped:** [list with reason]

**Knowledge:** [tier] [details if postgres: DB name, embedding model]

**Auto-installed:**
- [list everything installed, or "nothing"]

**Adjust anything:** `/pipeline:update`
```

Skip the getting-started guide (quick users know what they're doing). Skip the offer to open docs.

## What doesn't change

- Detection scripts (Steps 1, 3) — identical
- Config YAML structure — identical output
- Resume detection (Step 0) — same
- Profile-based defaults (Step 2b) — same mapping
- Template (`templates/pipeline.yml`) — no changes
