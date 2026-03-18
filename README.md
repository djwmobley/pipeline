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

Every finding has a severity (red/yellow/blue), a confidence level, a file and line number, and a specific fix. No "looks good" — if the reviewer finds nothing, it must explain exactly what it checked and why each check passed.

### You build a new feature (LARGE change)

You describe what you want. Pipeline routes you through:

1. **`/pipeline:brainstorm`** — asks clarifying questions one at a time, proposes 2-3 approaches, writes a spec
2. **`/pipeline:plan`** — turns the spec into bite-sized tasks with specific files, functions, and types
3. **`/pipeline:build`** — dispatches a fresh subagent for each task. Each agent gets only its task and relevant files — no accumulated context, so quality doesn't degrade over a 15-task build. A reviewer agent checks each task before moving to the next.
4. **`/pipeline:review --since abc123`** — reviews everything built since the baseline commit
5. **`/pipeline:commit reviewed:✓`** — preflight gates, commit, push

### You finish a feature (MILESTONE)

`/pipeline:audit` splits your codebase into sectors (configured per project) and dispatches parallel review agents — one per sector. A synthesis agent then traces crash paths across sectors, finds dead exports, flags duplication, and escalates severity. The output is a unified report across your entire codebase with red/yellow/blue findings and confidence levels.

## Getting Started

### Install

```bash
claude plugin install pipeline --scope user
```

### Set up a project

```bash
/pipeline:init
```

Init takes about a minute. It will:
- Detect your language and framework from your project files
- Find your test runner, linter, and type checker
- Probe for optional tools (Postgres, GitHub CLI, Ollama, etc.)
- Ask what type of project this is (web app, API, CLI, etc.)
- Ask about session persistence (markdown files or Postgres)
- Generate `.claude/pipeline.yml` with everything it found

If you already have a config, init detects what's complete and resumes from where it left off.

### Start using it

**Already have code?** Make a change, then `/pipeline:commit`. That's it. The preflight gates run automatically.

**Starting from scratch?** `/pipeline:brainstorm` to design your first feature, then `/pipeline:plan` and `/pipeline:build` to implement it.

**Not sure how much process to use?** `/pipeline:triage` looks at your changes and tells you.

## Requirements

**Must have:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Git.

**Everything else is optional.** Init detects what's available and shows you what each tool adds. Nothing is installed without asking.

| Tool | What It Adds | Without It |
|------|-------------|------------|
| PostgreSQL | Semantic search across sessions, structured task tracking | Markdown files (works fine, no search) |
| Ollama | Vector similarity on top of keyword search | Keyword search only |
| GitHub CLI | PR creation from the terminal | Push and use the browser |
| Chrome / Playwright | Automatic screenshots for UI review | Provide screenshots yourself |
| Sentry | Auto-pull recent errors during debug | Describe the error yourself |

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

## All Commands

See the **[command reference](docs/reference.md)** for the full list with details.

| Command | One-liner |
|---------|-----------|
| `/pipeline:init` | Set up a project |
| `/pipeline:commit` | Preflight gates + commit + push |
| `/pipeline:review` | Code review with severity tiers |
| `/pipeline:triage` | What size is this change? |
| `/pipeline:test` | Structured test report |
| `/pipeline:research` | Investigate unknowns before planning |
| `/pipeline:brainstorm` | Design before building |
| `/pipeline:plan` | Turn a spec into implementation tasks |
| `/pipeline:build` | Execute a plan with subagents |
| `/pipeline:audit` | Full codebase review (parallel sectors) |
| `/pipeline:debug` | Systematic root-cause diagnosis |
| `/pipeline:simplify` | Targeted code simplification |
| `/pipeline:release` | Changelog + version bump + tag |
| `/pipeline:ui-review` | Screenshot + visual analysis |
| `/pipeline:worktree` | Isolated git worktree |
| `/pipeline:finish` | Merge, PR, keep, or discard a branch |
| `/pipeline:update` | Change config after setup |
| `/pipeline:knowledge` | Session tracking + search |

## Configuration

See the **[configuration guide](docs/guide.md)** for all options and examples.

The short version: everything lives in `.claude/pipeline.yml`, generated by init. You can edit it directly anytime. The key sections are:

- **commands** — your typecheck, lint, and test commands (null to disable any gate)
- **routing** — source directories and size thresholds
- **review** — non-negotiable decisions, grep patterns, sectors, criteria
- **models** — which Claude model handles which job
- **knowledge** — markdown files or Postgres
- **integrations** — what tools are available

## Acknowledgments

Pipeline is a synthesis of ideas from three open-source projects, combined with original work on size routing, model routing, and config-driven architecture.

| Project | Author | License | What Pipeline Adopted |
|---------|--------|---------|----------------------|
| [Superpowers](https://github.com/obra/superpowers) | Jesse Vincent / Prime Radiant | MIT | Adversarial review, anti-rationalization gates, subagent dispatch, brainstorm-plan-build flow, worktree isolation |
| [GSD-2](https://github.com/gsd-build/gsd-2) | gsd-build | MIT | Research phase, confidence scoring, decision locks, fresh-context-per-task |
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | BMad Code, LLC | MIT | Implementation readiness gates, scale-adaptive planning |

See **[full attribution details](docs/attribution.md)** for what was adopted from each source and what Pipeline contributed originally.

## License

MIT — see [LICENSE](LICENSE).
