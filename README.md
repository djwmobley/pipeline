# Pipeline

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that matches process to change size. A one-line fix gets committed in seconds. A new feature gets designed, planned, built by subagents, and reviewed — automatically.

## What Using It Looks Like

### You fix a typo (TINY change)

You edit a string in one file. You type `/pipeline:commit`. Pipeline runs your type checker, linter, and tests. Everything passes. It commits and pushes. No decisions to make — it just works.

### You add a feature to 2 files (MEDIUM change)

You implement the change. You type `/pipeline:commit`. Pipeline counts the source files you touched — it's under the review threshold, so it runs preflight gates and commits. If you'd touched 3 or more files (the default threshold), it would have blocked you:

```
BLOCKED — 3 source files changed. /pipeline:review is required before committing.
Run /pipeline:review, apply all fixes, then /pipeline:commit reviewed:✓
```

You can't talk your way past this. The gate is absolute.

### You run `/pipeline:review` on your changes

Pipeline reads every changed file in full, runs your linter on just those files, and reviews against your configured criteria. The output looks like this:

```
## Code Review

### Files reviewed
src/hooks/useAuth.ts
src/pages/Login.tsx
src/lib/api.ts

### Must fix
src/hooks/useAuth.ts:47 — unhandled promise rejection on token refresh [confidence: HIGH]
> refreshToken() can throw if the network is down, but the caller has no try/catch.
> The user sees a white screen instead of the login page.
> Fix: Wrap in try/catch, redirect to /login on failure.

### Should fix
src/lib/api.ts:12 — dead import [confidence: HIGH]
> `parseResponse` is imported but never used after the refactor in this diff.

### Verdict
Issues found — 1 thing that needs attention before shipping
```

Every finding has a severity (🔴 HIGH / 🟡 MEDIUM / 🔵 LOW), a confidence level, a file and line number, and a specific fix. No "looks good" — if the reviewer finds nothing, it must explain exactly what it checked and why each check passed.

### You build a new feature (LARGE change)

You describe what you want. Pipeline routes you through:

1. **`/pipeline:brainstorm`** — asks clarifying questions one at a time, proposes 2-3 approaches, writes a spec
2. **`/pipeline:plan`** — turns the spec into bite-sized tasks with specific files, functions, and types
3. **`/pipeline:build`** — dispatches a fresh subagent for each task. Each agent gets only its task and relevant files — no accumulated context, so quality doesn't degrade over a 15-task build. A reviewer agent checks each task before moving to the next.
4. **`/pipeline:review --since abc123`** — reviews everything built since the baseline commit
5. **`/pipeline:commit reviewed:✓`** — preflight gates, commit, push

### You finish a feature (MILESTONE)

`/pipeline:audit` splits your codebase into sectors (configured per project) and dispatches parallel review agents — one per sector. A synthesis agent then traces crash paths across sectors, finds dead exports, flags duplication, and escalates severity. The output is a unified report across your entire codebase with 🔴 HIGH / 🟡 MEDIUM / 🔵 LOW findings and confidence levels.

### You security-test before release

`/pipeline:redteam` dispatches a recon agent to map your attack surface and generate a CycloneDX 1.6 SBOM (complete dependency inventory including transitive dependencies), then launches parallel security specialists — one per domain (injection, auth, XSS, etc.). Each specialist gets framework-specific checklists (a Next.js injection specialist checks different things than a Django one). The DEPS specialist cross-references the SBOM with live vulnerability audit output. A lead analyst chains findings into exploit scenarios and produces a risk matrix with a remediation roadmap.

The assessment saves to `docs/findings/` — with an optional HTML report you can share with stakeholders who don't use the terminal.

### You fix the findings

`/pipeline:remediate` accepts findings from any workflow — red team, audit, review, UI review, or external reports (QA, UX designers). It creates GitHub issues for each finding above your threshold, stores structured records in Postgres, and batches fixes by effort. Quick wins get a single implementer agent. Medium-effort fixes get an implementer plus a reviewer. Architectural changes get an opus planner first, then step-by-step implementation with review at each step.

Agents are stateless — they read their own context from GitHub issues or the database, fix the code, and write results back. The orchestrator carries only IDs and status, keeping token overhead low.

After all fixes land, it runs source-appropriate verification — specialist re-runs for security findings, sector re-runs for audit findings, review re-runs for code review findings, screenshot re-analysis for UI findings.

### You verify the security posture

After remediation, `/pipeline:purpleteam` verifies the aggregate result. It dispatches parallel defense specialists to confirm each attack vector is actually closed — not just that code changed, but that the specific exploitation scenario no longer works. An opus analyst checks whether the red team's exploit chains are now broken. A dependency audit catches newly-published vulnerabilities. Defensive patterns from verified fixes are codified into your knowledge tier so future code avoids the same mistakes.

GitHub issues are updated with verification evidence — verified findings close cleanly, regressions are reopened with details.

For a full explanation of the security workflow, see [Security Overview](docs/security.md).

## Install

```bash
claude plugin install --scope user https://github.com/djwmobley/pipeline
```

Then, in any project:

```
/pipeline:init
```

Init detects your stack — language, framework, test runner, linter, type checker — and generates `.claude/pipeline.yml`. Takes about a minute.

## Two Starting Points

Pipeline works whether you're starting fresh or maintaining something.

### Building something new?

```
/pipeline:brainstorm → /pipeline:plan → /pipeline:build → /pipeline:commit
```

Brainstorm asks clarifying questions, proposes approaches, and writes a spec. Plan turns the spec into bite-sized tasks with specific files and functions. Build dispatches a fresh subagent per task with automatic review after each. Commit runs preflight gates and ships it.

| Command | What It Does |
|---------|-------------|
| `/pipeline:brainstorm` | Design before building — clarifying questions, 2-3 approaches, writes a spec |
| `/pipeline:plan` | Turns a spec into bite-sized tasks with specific files and functions |
| `/pipeline:build` | Dispatches a fresh subagent per task with automatic review after each |
| `/pipeline:finish` | Merge, PR, keep, or discard the branch |

You can enter at any point — skip brainstorm if you already know the design, skip plan if you want to build ad hoc.

### Working on existing code?

```
# make your changes, then:
/pipeline:commit
```

That's it. Commit runs your type checker, linter, and tests, then commits and pushes. If you change 3+ source files, it blocks until you run `/pipeline:review`:

| Command | What It Does |
|---------|-------------|
| `/pipeline:commit` | Preflight gates + commit + push |
| `/pipeline:review` | Code review with severity tiers and confidence levels |
| `/pipeline:triage` | Classifies your change size and recommends a workflow |

The review gate is automatic. You can't talk your way past it. The gate is absolute.

### Layer 3 — Security (pre-release)

A full security lifecycle with structured verification:

| Command | What It Does |
|---------|-------------|
| `/pipeline:redteam` | Parallel security specialists with framework-specific checklists |
| `/pipeline:remediate` | Triage findings, create tickets, fix with verification |
| `/pipeline:purpleteam` | Verify fixes actually closed attack vectors |
| `/pipeline:security` | All three in sequence with human review gates |

### Layer 4 — Everything else

| Command | What It Does |
|---------|-------------|
| `/pipeline:audit` | Full codebase review with parallel sector agents |
| `/pipeline:debug` | Systematic 4-phase root-cause diagnosis |
| `/pipeline:test` | Structured test report |
| `/pipeline:simplify` | Targeted simplification of flagged files |
| `/pipeline:release` | Changelog + version bump + tag |
| `/pipeline:ui-review` | Screenshot capture + visual analysis |
| `/pipeline:markdown-review` | Markdown health check — file hygiene, info architecture |
| `/pipeline:worktree` | Isolated git worktree for feature isolation |
| `/pipeline:dashboard` | Static HTML project status report (auto-regenerates) |
| `/pipeline:update` | Change config after setup |
| `/pipeline:knowledge` | Direct access to session history and search |

You don't need to learn these upfront. They'll surface naturally — `/pipeline:review` suggests `/pipeline:simplify` when it finds candidates, `/pipeline:commit` tells you when to run `/pipeline:review`, and so on.

## Requirements

**Must have:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Git.

**Everything else is optional.** Init detects what's available and shows you what each tool adds. Nothing is installed without asking.

| Tool | What It Adds | Without It |
|------|-------------|------------|
| PostgreSQL | Semantic search across sessions, structured task tracking, security assessment history | Markdown files (works fine, no search) |
| [Ollama](https://ollama.com) | Vector similarity search (runs an embedding model locally — no API keys, no cloud) | Keyword search only |
| GitHub CLI | PR creation from the terminal | Push and use the browser |
| Chrome / Playwright | Automatic screenshots for UI review | Provide screenshots yourself |
| Sentry | Auto-pull recent errors during debug | Describe the error yourself |
| [Google Stitch](https://stitch.withgoogle.com) | AI-generated design mockups during brainstorming | Simple HTML wireframes |
| [Figma](https://figma.com) | Import existing designs for UI review comparison | Standalone UI analysis |

Pipeline's core workflow (commit, review, triage, test) uses no optional tools. Knowledge management, UI review, and integrations are add-ons you can ignore entirely.

## Works With

Any language, any framework. Init auto-detects from your project files:

| If It Finds | It Configures |
|-------------|--------------|
| `package.json` + TypeScript | `tsc --noEmit`, `eslint`, `vitest` or `jest` |
| `Cargo.toml` | `cargo test`, `clippy` |
| `go.mod` | `go test ./...`, `golangci-lint` |
| `pyproject.toml` | `pytest`, `ruff` |

It also detects your project profile — SPA, fullstack, mobile, API, CLI, or library — and sets review criteria and security checklists to match. You can override anything in the config.

## Full Command Reference

See the **[command reference](docs/reference.md)** for all 24 commands with arguments, output formats, and token cost estimates.

## Configuration

See the **[configuration guide](docs/guide.md)** for all options and examples.

The short version: everything lives in `.claude/pipeline.yml`, generated by init. You can edit it directly anytime. The key sections are:

- **commands** — your typecheck, lint, and test commands (null to disable any gate)
- **routing** — source directories and size thresholds
- **review** — non-negotiable decisions, grep patterns, sectors, criteria
- **models** — which Claude model handles which job
- **knowledge** — markdown files or Postgres
- **integrations** — what tools are available
- **redteam** — security assessment mode, specialists, recon patterns
- **remediate** — issue thresholds, verification, batch strategy
- **markdown_review** — line limits, tiers, fix mode, inline checklist

## Roadmap

Tracked items for future development. Checked items are shipped.

### Open

- [ ] **Full lifecycle visual diagram** — The pipeline flow crosses multiple context windows: PM → UX → orchestrator → engineer → QA → red team → orchestrator → engineer → QA → purple team → engineer → git. Needs a visual representation showing all agents, decision gates, loop-back points, and state handoffs.
- [ ] **Error handling guide** — What happens when gates fail, tools are missing, or Postgres is down? Users need to know recovery paths.
- [ ] **Dashboard screenshot in README** — Visual proof of what the dashboard looks like.
- [ ] **`--quick` mode for init** — Auto-detect everything, ask only what can't be detected.
- [ ] **Compliance framework testing** — Test red team findings against FedRAMP, SOC 1/2, NIST CSF 2.0, GDPR, PCI DSS 4.0, HIPAA, ISO 27001 certification specifications. Map CWE findings to compliance controls and flag gaps.
- [ ] **Workflow chaining** — Chain commands together for fire-and-forget execution. Example: `/pipeline:brainstorm` → `/pipeline:plan` → `/pipeline:build` → `/pipeline:review` → `/pipeline:commit` as a single invocation.
- [ ] **Human-in-the-loop guidance** — Distinguish what SHOULD be checked by a human (recommended review points) from what MUST be checked (safety-critical decisions, destructive operations, security sign-offs).

### Shipped

- [x] Build crash recovery — `.claude/build-state.json` checkpoints after each task, resume on restart (GSD-2 inspired)
- [x] Worktree lifecycle management — health check detects merged, stale, dirty, and orphaned worktrees (GSD-2 inspired)
- [x] Pre-inlined context for subagent dispatch — decision register, prior task summaries, framework detection in implementer prompts (GSD-2 inspired)
- [x] Cross-domain destructive operation guards
- [x] Severity labels on all emoji indicators (terminal accessibility)
- [x] DATA boundary tags on all prompt templates (prompt injection prevention)
- [x] Dual entry points in docs (greenfield vs existing code)
- [x] Fast Track in prerequisites
- [x] Layered command reference (Layer 1-4)
- [x] HTML documentation page
- [x] `/pipeline:simplify` documentation
- [x] Auto-persist knowledge tier across all 13 commands
- [x] Purple team verification lifecycle
- [x] `/pipeline:security` meta-command
- [x] `/pipeline:markdown-review` with three tiers
- [x] Red team DEPS specialist with live audit
- [x] Big 4 awareness across all agent prompts — functionality, usability, performance, security as push-pull dimensions at build, review, and design time
- [x] SBOM generation — CycloneDX 1.6 with transitive dependencies from lockfile parsing, generated during red team recon
- [x] Research folded into brainstorm — standalone `/pipeline:research` replaced with a verification gate (step 4) inside brainstorm that dispatches parallel agents when unfamiliar tech is detected

## What's Original to Pipeline

These features don't trace to any prior work:

- **Size routing** — TINY/MEDIUM/LARGE/MILESTONE classification that determines how much process to apply. A one-line fix skips review. A new feature gets the full pipeline. None of the source projects adjust ceremony to change size.
- **Model routing** — automatic haiku/sonnet/opus assignment by task complexity. Cheaper models for mechanical work, capable models for judgment.
- **Config-driven architecture** — a single `pipeline.yml` replaces all hardcoded paths, commands, frameworks, and patterns. Move between projects by running init.
- **Commit preflight gate chain** — typecheck → lint → test → review gate with a hard stop that resists LLM rationalization.
- **Parallel sector audit** — codebase split into configured sectors, each reviewed by a parallel agent, then synthesized by a cross-sector agent that traces crash paths and finds dead exports.
- **Severity tiers with confidence requirements** — 🔴 HIGH / 🟡 MEDIUM / 🔵 LOW findings where HIGH requires verified-in-code evidence, preventing false alarms from blocking commits.
- **Knowledge tiers** — files (zero setup, markdown) or Postgres (semantic search, structured queries, cross-project transfer).
- **Security lifecycle** — red team → remediate → purple team as a structured loop with per-finding state tracking and verification.
- **Integration detection** — runtime probing for available tools (Postgres, Ollama, GitHub CLI, Chrome DevTools, Sentry) with graceful fallbacks and no silent installs.
- **Cross-domain destructive operation guards** — hard stop before any data-destroying action across git (rebase, force-push, reset), databases (DROP TABLE, bulk deletes, TRUNCATE), and files (rm -rf, multi-file deletion). The agent must name the action, state intent, state what will be permanently lost, and get explicit confirmation. Other frameworks guard specific operations (branch deletion, internal state files). Pipeline applies a single consistent gate to everything the agent can destroy, with a rationalization prevention table because LLMs will talk themselves into "this is just cleanup" without it.
- **Phase 0 grep preprocessing** — configurable regex patterns scanned before review agents dispatch, focusing attention on known risk patterns.
- **Project profile system** — auto-detection of project type (SPA, fullstack, mobile, API, CLI, library) with profile-specific review criteria and security checklists.
- **Release pipeline** — changelog generation from conventional commits, version bumping across package ecosystems (npm, cargo, pip), git tagging, and optional GitHub release creation.
- **Big 4 dimensional awareness** — every agent prompt evaluates functionality, usability, performance, and security as dimensions in tension. The weight varies by role: the PM agent explores tradeoffs, the engineer flags concerns, the reviewer verifies all four. See the [Big 4 framework](docs/big-4.md) for the concept and how Pipeline applies it.

## Acknowledgments

Pipeline builds on ideas from three open-source projects. Credit where it's due:

| Project | Author | License | What Pipeline Adopted |
|---------|--------|---------|----------------------|
| [Superpowers](https://github.com/obra/superpowers) | Jesse Vincent / Prime Radiant | MIT | Adversarial review, anti-rationalization gates, subagent dispatch, brainstorm-plan-build flow, worktree isolation |
| [GSD-2](https://github.com/gsd-build/gsd-2) | gsd-build | MIT | Research phase, confidence scoring, decision locks, fresh-context-per-task, crash recovery, worktree lifecycle, pre-inlined dispatch context |
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | BMad Code, LLC | MIT | Implementation readiness gates, scale-adaptive planning |

See **[full attribution details](docs/attribution.md)** for the complete breakdown — what was adopted, what was adapted, and what was rejected from each source.

## License

MIT — see [LICENSE](LICENSE).
