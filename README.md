# Pipeline

> **Alpha (v0.2.0-alpha)** — This plugin is under active development. Commands, config keys, and behavior may change between releases. [Feedback welcome.](https://github.com/djwmobley/pipeline/issues)

<p align="center">
  <img src="docs/assets/hero.png" alt="Pipeline — one plugin, full pipeline" width="700">
</p>

A web-first agent workflow engine for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). A content-blind orchestrator routes stateless AI agents through a 13-step quality pipeline — from brainstorm to deploy — with agents reading context from and writing results to shared stores. First-class support for web and mobile development; adapted profiles for services, data pipelines, and automation.

A one-line fix gets committed in seconds. A new feature gets designed, debated, built, reviewed, and security-tested — automatically.

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

Pipeline runs your typecheck, linter, and SAST scanner (semgrep with custom security rules, or grep fallback) on changed files, then reads every changed file in full and reviews against your configured criteria. If you're editing Pipeline itself, agent template lint checks your prompt templates for structural correctness. The output looks like this:

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

You describe what you want. The orchestrator routes you through the full workflow. Your engagement style (expert/guided/full-guidance) controls question depth — an expert gets minimal questions, a newcomer gets thorough explanations at every step:

1. **`/pipeline:brainstorm`** — asks clarifying questions one at a time, proposes 2-3 approaches, writes a spec. Creates a GitHub feature epic if issue tracking is enabled.
2. **`/pipeline:debate`** — three parallel agents (Advocate, Skeptic, Practitioner) stress-test the spec from first principles. Produces constraints the plan must respect.
3. **`/pipeline:architect`** — parallel domain specialists assess your technology choices and produce decision records that constrain the build
4. **`/pipeline:plan`** — turns the spec into bite-sized tasks with architectural constraints, debate verdict, and a QA strategy. For LARGE/MILESTONE, generates a standalone QA test plan with work packages.
5. **`/pipeline:build`** — dispatches a fresh subagent for each task. Agents are stateless — they read their own context from stores (architecture plan, decisions, gotchas, GitHub issues, build state) rather than receiving pasted context. No accumulated context means quality doesn't degrade over a 15-task build. A reviewer agent checks each task before moving to the next.
6. **`/pipeline:qa verify`** — parallel QA workers execute the test plan, a seam pass verifies integration boundaries
7. **`/pipeline:review --since abc123`** — runs SAST scanning (semgrep + custom security rules), agent template lint if prompt templates changed, then reviews everything built since the baseline commit
8. **`/pipeline:finish`** — merge, PR, compiled epic summary, dashboard update

Architect and QA activate automatically for LARGE/MILESTONE changes — you can skip them if you've already made your technology choices or want to handle QA yourself. For MEDIUM changes, these capabilities run invisibly inside plan and build. Your security policy (every-feature/milestone/on-demand) controls when red team and purple team run automatically.

Every agent writes results to three stores (Postgres, GitHub issues, build-state) — this A2A protocol means downstream agents pick up where upstream agents left off without the orchestrator carrying content. See the **[workflow reference](docs/workflow-reference.md)** for the full 13-step graph with routing rules and failure paths.

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

### You map findings to compliance controls

After the security loop, `/pipeline:compliance` maps your red team findings to regulatory frameworks — NIST 800-53, PCI DSS, ISO 27001, NIST CSF, SOC 2, GDPR, and HIPAA. Each framework is tiered by mapping quality: Tier 1 uses official CWE crosswalks, Tier 2 uses defensible inference, Tier 3 covers only the software-relevant subset. The output is a coverage scope analysis showing which controls your testing addresses, which are within automated scope but unmapped, and which require organizational assessment. An evidence narrative section provides prose suitable for audit preparation documents.

This is compliance preparation — not a compliance assessment. Every output carries a disclaimer.

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

Want zero interaction? Use `/pipeline:init --quick` — it auto-detects everything, installs what it can, and prints a summary. Adjust later with `/pipeline:update`.

## Scope and Boundaries

Pipeline operates on **source code during development**. It reads, analyzes, and helps you write better source files. It does not compile, build, bundle, deploy, or manage runtime infrastructure.

**First-class support** — Web applications (SPA, full-stack, mobile-web), mobile apps, APIs, CLIs, and libraries. Deep security analysis, 25 framework-specific checklists, and optimized defaults.

**Adapted profiles** — Background services, data pipelines, and automation scripts. Source code analysis works well; defaults are tuned to reduce noise and activate domain-relevant concerns (resilience, idempotency, credential management).

**Outside scope** — Compiled output, container images, infrastructure-as-code, runtime behavior, deployment orchestration. Pipeline's output is source code, configuration, and documentation. Compilation, containerization, and deployment are handled by your project's existing build toolchain.

When `build.artifact` is configured, Pipeline includes a deployment handoff checklist in the finish report listing what requires out-of-band verification.

## Two Starting Points

Pipeline works whether you're starting fresh or maintaining something.

### Building something new?

```
/pipeline:brainstorm → /pipeline:debate → /pipeline:architect → /pipeline:plan → /pipeline:build → /pipeline:finish
```

Brainstorm asks clarifying questions, proposes approaches, and writes a spec. Debate stress-tests the spec with adversarial agents (recommended for LARGE+, optional for MEDIUM). Architect assesses technology choices with parallel domain specialists. Plan turns the spec into bite-sized tasks with QA strategy, incorporating debate constraints when present. Build dispatches a fresh subagent per task with automatic review and QA verification. Finish merges, creates a PR, and updates the dashboard.

For LARGE and MILESTONE changes, architect and QA activate automatically. You can skip them if you've already made your technology choices or want to handle QA yourself.

| Command | What It Does |
|---------|-------------|
| `/pipeline:brainstorm` | Design before building — clarifying questions, 2-3 approaches, writes a spec |
| `/pipeline:debate` | Stress-test a spec with Advocate, Skeptic, and Practitioner agents (LARGE+ recommended) |
| `/pipeline:architect` | Technology decisions — parallel domain specialists produce decision records (LARGE/MILESTONE) |
| `/pipeline:plan` | Turns a spec into bite-sized tasks with architectural constraints and QA strategy |
| `/pipeline:build` | Dispatches a fresh subagent per task with automatic review + auto-verify after each |
| `/pipeline:qa plan` | Risk-driven test plan with work packages and seam definitions (LARGE/MILESTONE) |
| `/pipeline:qa verify` | Parallel QA workers + seam pass + failure triage (LARGE/MILESTONE) |
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
| `/pipeline:lint-agents` | Structural lint for agent prompt templates — 7 deterministic checks |
| `/pipeline:test` | Structured test report |
| `/pipeline:simplify` | Targeted simplification of flagged files |
| `/pipeline:release` | Changelog + version bump + tag |
| `/pipeline:ui-review` | Screenshot capture + visual analysis |
| `/pipeline:markdown-review` | Markdown health check — file hygiene, info architecture |
| `/pipeline:worktree` | Isolated git worktree for feature isolation |
| `/pipeline:dashboard` | Static HTML project dashboard — phase tracking, epic status, security lifecycle |
| `/pipeline:update` | Change config after setup |
| `/pipeline:knowledge` | Direct access to session history and search |

You don't need to learn these upfront. They'll surface naturally — `/pipeline:review` suggests `/pipeline:simplify` when it finds candidates, `/pipeline:commit` tells you when to run `/pipeline:review`, and so on.

## Requirements

**Must have:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Git.

**Everything else is optional.** Init detects what's available and shows you what each tool adds. Nothing is installed without asking.

| Tool | What It Adds | Without It |
|------|-------------|------------|
| PostgreSQL | Orchestrator workflow state, semantic search, structured task tracking, three-store A2A reporting | Markdown files (works for TINY/MEDIUM, no orchestrated workflows) |
| [Ollama](https://ollama.com) | Vector similarity search (runs an embedding model locally — no API keys, no cloud) | Keyword search only |
| GitHub CLI | PR creation, lifecycle issue tracking (feature epics, finding issues) | Push and use the browser, no issue tracking |
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

See the **[command reference](docs/reference.md)** for all commands with arguments, output formats, and token cost estimates.

## Configuration

See the **[configuration guide](docs/guide.md)** for all options and examples.

The short version: everything lives in `.claude/pipeline.yml`, generated by init. You can edit it directly anytime. The key sections are:

- **commands** — your typecheck, lint, and test commands (null to disable any gate)
- **routing** — source directories and size thresholds
- **review** — non-negotiable decisions, grep patterns, sectors, criteria
- **architect** — domain specialist selection, build-time constraint enforcement
- **qa** — auto-verify, worker count, browser/DB testing, flake retries
- **models** — which Claude model handles which job
- **knowledge** — markdown files or Postgres
- **integrations** — what tools are available
- **redteam** — security assessment mode, specialists, recon patterns
- **remediate** — issue thresholds, verification, batch strategy
- **compliance** — framework selection, HTML report, remediation status inclusion
- **debate** — sell step defaults for MEDIUM and LARGE+ changes
- **markdown_review** — line limits, tiers, fix mode, inline checklist

## Roadmap

Tracked items for future development. Checked items are shipped.

### Open

- [ ] **Full lifecycle visual diagram** — The pipeline flow crosses multiple context windows: PM → UX → orchestrator → engineer → QA → red team → orchestrator → engineer → QA → purple team → engineer → git. Needs a visual representation showing all agents, decision gates, loop-back points, and state handoffs.
- [ ] **Dashboard screenshot in README** — Visual proof of what the dashboard looks like.
- [ ] **Workflow chaining** — Chain commands together for fire-and-forget execution. Example: `/pipeline:brainstorm` → `/pipeline:plan` → `/pipeline:build` → `/pipeline:review` → `/pipeline:commit` as a single invocation.
- [ ] **Alpha and beta testing and feedback loops** — Structured process for collecting user feedback during pre-release phases, graduating from alpha to beta to stable release.

### Shipped

- [x] GitHub lifecycle tracking — epic-threaded issue model (brainstorm creates epic, downstream commands comment/create child issues), dedup checks, graceful degradation when GitHub is off
- [x] Engineering Architect — silent recon for MEDIUM (inside plan), full domain specialist orchestration for LARGE/MILESTONE with decision records, override mechanism, and build-time constraint injection
- [x] QA Planning & Verification — risk-driven test plans (not just AC tracing), parallel QA workers with business-behavior intent comments, mandatory seam testing at integration boundaries, failure triage (code-is-wrong vs test-is-wrong), auto-verify for MEDIUM+ builds
- [x] Build crash recovery — `.claude/build-state.json` checkpoints after each task, resume on restart (GSD-2 inspired)
- [x] Worktree lifecycle management — health check detects merged, stale, dirty, and orphaned worktrees (GSD-2 inspired)
- [x] Pre-inlined context for subagent dispatch — decision register, prior task summaries, framework detection in implementer prompts (GSD-2 inspired)
- [x] Error handling guide — recovery paths for gate failures, missing tools, and graceful degradation model
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
- [x] `--quick` mode for init — `/pipeline:init --quick` auto-detects everything, makes all decisions, auto-installs Playwright/Postgres/Ollama models, prints decision log
- [x] Compliance framework mapping — `/pipeline:compliance` maps red team CWE findings to 7 regulatory frameworks (NIST 800-53, PCI DSS, ISO 27001, NIST CSF, SOC 2, GDPR, HIPAA) with tiered mapping quality, coverage scope analysis, and evidence narrative generation. Integrated as optional Phase 4 in `/pipeline:security`.
- [x] Antagonistic design debate
- [x] Content-blind orchestrator — 13-step state machine with failure routing, loopback, and workflow state persistence in Postgres
- [x] Three-store A2A reporting — agents write to Postgres + GitHub + build-state; downstream agents read from stores
- [x] V2 agent rewrite (23/23 agents) — store-read pattern, ANTI-RATIONALIZATION blocks, reporting contracts, engagement style, compliance awareness
- [x] Workflow reference doc — exhaustive 13-step reference with routing rules, agent mappings, and three-store contracts
- [ ] Prompt caching — API-based dispatch for token savings — `/pipeline:debate` dispatches Advocate, Skeptic, and Practitioner agents to stress-test specs before planning. Produces structured verdicts consumed by `/pipeline:plan`.

## What's Original to Pipeline

These features don't trace to any prior work:

- **Content-blind orchestrator** — a state machine that routes between 13 steps based on artifact existence and status codes, never reading content. Failure loops (review/qa FAIL → build) and loopback (purple 2x FAIL → architect) are graph edges, not conditional logic. The orchestrator is a workflow engine, not a build bot.
- **Three-store A2A protocol** — every agent writes to Postgres + GitHub issues + build-state.json on completion. Downstream agents read from these stores to pick up context. The orchestrator carries only IDs and status — zero content forwarding. This pub/sub pattern keeps token overhead constant regardless of pipeline depth.
- **Stateless agent dispatch** — agents read their own context from shared stores (architecture plan, decisions, gotchas, task issues, build state) rather than receiving pasted context blocks. This means agent quality doesn't degrade as pipelines grow — each agent starts fresh with only what it needs.
- **Engagement style system** — a single choice (expert/guided/full-guidance) at init propagates throughout the pipeline, controlling question depth in brainstorm, explanation detail in init, and workflow view complexity in the dashboard.
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
- **Human-in-the-loop checkpoint taxonomy** — every decision point is classified as MUST (hard stop, cannot be skipped), SHOULD (prompted with default-yes), or MAY (prompted with default-no). A central registry catalogs all 13 checkpoints with IDs, rationale, and rendering rules. SHOULD checkpoints log when skipped for post-incident traceability. Other frameworks either gate everything or gate nothing — Pipeline distinguishes safety-critical decisions from recommended checks.
- **Phase 0 grep preprocessing** — configurable regex patterns scanned before review agents dispatch, focusing attention on known risk patterns.
- **Project profile system** — auto-detection of project type (SPA, fullstack, mobile, API, CLI, library) with profile-specific review criteria and security checklists.
- **Release pipeline** — changelog generation from conventional commits, version bumping across package ecosystems (npm, cargo, pip), git tagging, and optional GitHub release creation.
- **Big 4 dimensional awareness** — every agent prompt evaluates functionality, usability, performance, and security as dimensions in tension. The weight varies by role: the PM agent explores tradeoffs, the engineer flags concerns, the reviewer verifies all four. See the [Big 4 framework](docs/big-4.md) for the concept and how Pipeline applies it.
- **Engineering Architect with dynamic domain selection** — recon agent determines which architectural domains are relevant (not a fixed roster), dispatches only those specialists in parallel, and produces individually invalidatable decision records with override mechanism. Silent for MEDIUM (2 agent calls inside plan), full orchestration for LARGE/MILESTONE.
- **Risk-driven QA with mandatory seam testing** — QA planner identifies risks at component interaction points (not just acceptance criteria tracing), dispatches parallel workers who write tests with business-behavior intent comments, then a QA lead runs seam tests across integration boundaries. Failure triage distinguishes code bugs from test bugs. Coverage reported, never gated.

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
