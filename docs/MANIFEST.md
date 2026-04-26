# Documentation Manifest

Every documentation file, its content scope, and what triggers updates. When a feature changes, check this manifest to find which docs need updating.

---

## File Index

| File | Scope | Audience |
|------|-------|----------|
| `README.md` | Product overview, install, command summary, roadmap, differentiators | Users evaluating or onboarding |
| `docs/security.md` | Security lifecycle explanation — red team, remediate, purple team, SBOM, dependency audit | PMs, engineering leads, non-technical stakeholders |
| `docs/reference.md` | All commands with arguments, output formats, token cost estimates | Users operating Pipeline daily |
| `docs/guide.md` | Full config reference — every pipeline.yml section with examples | Users configuring Pipeline |
| `docs/prerequisites.md` | Install requirements, fast track, optional tools | Users setting up Pipeline |
| `docs/attribution.md` | Source project credits, what was adopted/adapted/rejected, what's original | Contributors, people evaluating originality |
| `docs/big-4.md` | Big 4 framework concept — functionality, usability, performance, security | Anyone understanding Pipeline's design philosophy |
| `docs/index.html` | Static documentation site — install, command tables, scenarios, security lifecycle, config overview | Users browsing docs via GitHub Pages or locally |
| `docs/errors.md` | Error messages, recovery paths, graceful degradation model | Users operating Pipeline who hit an error |
| `docs/workflow-reference.md` | Pipeline System Reference — all 29 commands (13-step orchestrator + standalone tools + meta + utilities), routing, three-store contracts | Contributors, architects, anyone understanding the full system |
| `docs/workflow-diagram.html` | Interactive dual-view diagram — capability map (all 29 commands) and orchestrator flow (13-step linear) | Anyone wanting a visual overview |
| `docs/troubleshooting.md` | Plugin install, cache sync, and common issues | Users and contributors diagnosing plugin problems |
| `docs/memory.md` | Inter-session memory subsystem — embedded surface (12 tables), `pipeline-embed.js` CLI, `num_ctx` tuning, hybrid search semantics, operational guides for fresh setup and post-pgvector migration | Users operating the knowledge tier; contributors changing the embedder or schema |
| `docs/MANIFEST.md` | This file — docs inventory and change triggers | Contributors maintaining docs |

---

## Change Triggers

When you ship a feature, check which docs are affected.

### Adding or Changing a Command

| Doc | What to Update |
|-----|---------------|
| `docs/reference.md` | Add/update command section with arguments, output format, token cost |
| `README.md` | Add to command table in relevant layer, update walkthrough if user-facing behavior changes |
| `docs/index.html` | Add to relevant command table, update scenarios if user-facing workflow changes, update command count in footer |
| `docs/guide.md` | Add config section if the command introduces new pipeline.yml keys |
| `docs/security.md` | Update if the command is part of the security lifecycle (redteam, remediate, purpleteam, security) |

### Adding or Changing Config Keys

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Add to relevant config section with field table and example |
| `docs/reference.md` | Reference in the command that uses the config |
| `docs/guide.md` (example config) | Add to the full config example at the top if it's a common key |

### Adding or Changing SAST Rules

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Update `static_analysis` config section |
| `docs/reference.md` | Update `/pipeline:review` section — note SAST step and rule count |
| `docs/security.md` | Update if SAST changes the security lifecycle (e.g., red team recon integration) |
| `rules/semgrep/*.yml` | Add/modify semgrep rule YAML files |

### Adding a Specialist Domain or Recon Feature

| Doc | What to Update |
|-----|---------------|
| `docs/security.md` | Update specialist table, recon description, or SBOM section |
| `docs/reference.md` | Update `/pipeline:redteam` section |
| `docs/guide.md` | Update `redteam` config section and auto-selection table |

### Adding or Changing Architect Domains

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Update `architect` config section |
| `docs/reference.md` | Update `/pipeline:architect` section |

### Adding or Changing QA Features

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Update `qa` config section and size routing table |
| `docs/reference.md` | Update `/pipeline:qa plan` and `/pipeline:qa verify` sections |

### Adding an Integration

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Add to integrations table with detection method and what it enables |
| `docs/prerequisites.md` | Add to optional tools table |
| `README.md` | Add to requirements table |
| `docs/index.html` | Add to requirements table |

### Adding a Differentiator or Original Feature

| Doc | What to Update |
|-----|---------------|
| `README.md` | Add to "What's Original to Pipeline" section |
| `docs/index.html` | Update if it changes user-facing messaging or feature highlights |
| `docs/attribution.md` | Add to "What Pipeline Contributed Originally" section |

### Changing Knowledge Tier or Memory Subsystem

| Doc | What to Update |
|-----|---------------|
| `docs/memory.md` | Primary — update embedded-tables reference, CLI subcommands, `num_ctx` guidance, hybrid search semantics, operational guides |
| `docs/guide.md` | Update `knowledge.*` config section — connection settings, `embedding_model`, `num_ctx`, embedded-tables reference table |
| `docs/reference.md` | Update `/pipeline:knowledge` subcommand list and `scripts/pipeline-embed.js` CLI reference if subcommands change |
| `scripts/setup-knowledge-db.sql` | Source of truth for schema — table definitions, embedding columns, FTS, indexes |
| `scripts/pipeline-embed.js` | Source of truth for embedder — TABLES array defines the embedded surface |

### Shipping a Roadmap Item

| Doc | What to Update |
|-----|---------------|
| `README.md` | **Automatic** — `/pipeline:finish` triggers dashboard regeneration, which regenerates the `## Roadmap` section from Postgres `roadmap_tasks` view |
| Postgres | **Automatic** — `/pipeline:finish` marks the task as `done` via ship transition (Step 4b) |
| GitHub | **Automatic** — `/pipeline:finish` closes the linked GitHub issue |

All three stores update automatically on merge. No manual intervention needed.

### Changing Orchestrator Steps or Routing

| Doc | What to Update |
|-----|---------------|
| `docs/workflow-reference.md` | Primary — update step definitions, routing rules, three-store contract table, capabilities table |
| `docs/reference.md` | Update affected command sections |
| `docs/security.md` | Update if security steps (redteam, purple) routing changes |
| `docs/index.html` | Update workflow overview if user-facing workflow changes |
| `scripts/orchestrator.js` | Source of truth — doc must match code |
| `CLAUDE.md` | Update skill authoring reference with new routing fields documentation |

### Shipping Routing Rules or Operation Classes

| Doc | What to Update |
|-----|---------------|
| `docs/MANIFEST.md` | Add source documents (spec, verdict, plan) to build artifact directories section |
| `CLAUDE.md` | Add "Routing Fields" section to "Writing Skills" documenting `operation_class`, `allowed_models`, `allowed_direct_write` |
| `scripts/pipeline-lint-agents.js` | Update or create linter validation for `operation_class` enum |

### Changing Plugin Infrastructure (hooks, plugin.json, marketplace.json)

| Doc | What to Update |
|-----|---------------|
| `docs/troubleshooting.md` | Update if cache sync behavior, install flow, or enable/disable mechanics change |
| `docs/reference.md` | Update if new hooks are added or hook behavior changes |
| `.claude-plugin/plugin.json` | Source of truth for commands, hooks, and version |
| `.claude-plugin/marketplace.json` | Source of truth for marketplace metadata and version |

### Changing the Security Lifecycle

| Doc | What to Update |
|-----|---------------|
| `docs/security.md` | Primary — update relevant sections |
| `docs/reference.md` | Update command sections for affected security commands |
| `README.md` | Update security walkthrough if user-facing behavior changes |
| `docs/index.html` | Update security lifecycle section if user-facing behavior changes |

### Shipping a Release

| Doc | What to Update |
|-----|---------------|
| `CHANGELOG.md` | Add new version entry with categorized changes |
| `.claude-plugin/plugin.json` | Update version field |
| `scripts/package.json` | Update version field |
| `README.md` | Move roadmap items from Open to Shipped |

### Changing Platform Abstraction (issue tracking / code hosting)

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Update platform config section, supported platforms table |
| `docs/reference.md` | Update platform.js CLI reference |
| `docs/workflow-reference.md` | Update three-store contract if operations change |
| `docs/security.md` | Update credential management section (PAT scopes, storage) |
| `docs/errors.md` | Add/update PLATFORM_TWO_STORE and platform auth errors |
| `templates/pipeline.yml` | Update `platform` section defaults |
| `scripts/platform.js` | Source of truth — docs must match code |

### Changing GitHub Integration Behavior

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Update `integrations.github` section and integrations table |
| `docs/reference.md` | Update GitHub tracking mentions in affected command sections |
| `README.md` | Update requirements table GitHub CLI row |
| `docs/index.html` | Update requirements table GitHub CLI row, update LARGE scenario if workflow changes |
| `templates/pipeline.yml` | Update `integrations.github` defaults |

### Adding or Changing Error Behavior

| Doc | What to Update |
|-----|---------------|
| `docs/errors.md` | Add/update error entry with message, cause, and fix |

### Changing Knowledge Tier Behavior

| Doc | What to Update |
|-----|---------------|
| `docs/guide.md` | Update knowledge config section and auto-persistence tables |
| `docs/reference.md` | Update auto-persistence table |

---

## Build Artifact Directories

These directories contain generated output, not maintained documentation:

| Directory | Generated By | Contents |
|-----------|-------------|----------|
| `docs/specs/` | `/pipeline:brainstorm` | Feature specs scoped to a single feature |
| `docs/superpowers/specs/` | Superpowers brainstorming skill | Same — feature specs |
| `docs/plans/` | `/pipeline:plan`, `/pipeline:qa plan` | Implementation plans, test plans |
| `docs/architecture.md` | `/pipeline:architect` | Engineering standards: typed contracts, decisions, security/testing standards, banned patterns |
| `docs/findings/` | `/pipeline:redteam`, `/pipeline:audit`, `/pipeline:review`, `/pipeline:remediate`, `/pipeline:purpleteam`, `/pipeline:qa verify` | Security reports, audit findings, SBOM artifacts, remediation summaries, QA reports |
| `docs/findings/` (routing) | `/pipeline:debate` (routing decision) | Routing verdict documents (e.g., `debate-2026-04-25-routing-opus-tier.md`) |
| `docs/sessions/` | Auto-persistence | Session logs (files tier only, rotated to last 5) |

## Rule Directories

| Directory | Purpose | Contents |
|-----------|---------|----------|
| `rules/semgrep/` | SAST security rules | Semgrep YAML rule files — shipped with the plugin, run during review Step 2b |

## Other Tracked Files

| File | Scope | Audience |
|------|-------|----------|
| `CLAUDE.md` | Contributor guidelines — structure, conventions, shell safety, prompt injection prevention, destructive operation guards | Contributors and agents working on Pipeline itself |
| `CHANGELOG.md` | Version history — all releases with features, fixes, and breaking changes | Users and contributors tracking changes |
| `LICENSE` | MIT license | Legal |
