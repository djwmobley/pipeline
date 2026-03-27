# Error Reference

> **Alpha** — Pipeline is under active development. Content may change between releases.

Find your error message with Ctrl+F, read the fix, move on. Each entry shows what you see, why it happens, and how to recover.

---

## Config & Setup Errors

### "No `.claude/pipeline.yml` found. Run `/pipeline:init` first."

**Commands:** All major commands (commit, review, build, plan, brainstorm, redteam, remediate, etc.)

**Why:** No config file exists in the project root.

**Fix:** Run `/pipeline:init` (or `/pipeline:init --quick` for zero interaction).

---

### "Config key `remediate.verification_rerun` is no longer supported."

**Commands:** `/pipeline:remediate`

**Why:** Config uses the old boolean key that was replaced by the `remediate.verification` object.

**Fix:** Open `.claude/pipeline.yml`. Replace `remediate.verification_rerun: true` with the `verification` object format. See `templates/pipeline.yml` for the new structure.

---

### YAML parse error / invalid syntax

**Commands:** Any command that reads config.

**Why:** `.claude/pipeline.yml` has a syntax error.

**Fix:** Common culprits:
- Tabs instead of spaces (YAML requires spaces)
- Missing space after a colon (`key:value` should be `key: value`)
- Unclosed quotes
- Special characters in unquoted strings

Run a YAML linter or paste the file into a validator to find the exact line.

---

### "source_dirs entry '[entry]' contains unsafe characters."

**Commands:** `/pipeline:commit`, `/pipeline:triage`, `/pipeline:redteam`, `/pipeline:audit`

**Why:** A `routing.source_dirs` entry contains shell metacharacters (`$`, backticks, parentheses, semicolons, pipes, etc.). Pipeline rejects these to prevent command injection.

**Fix:** Edit `.claude/pipeline.yml` and ensure each `source_dirs` entry contains only alphanumeric characters, `/`, `_`, `.`, `-`. Example: `["src/", "lib/"]`.

---

### "source_dirs is set to `[\".\"]` which counts ALL files..."

**Commands:** `/pipeline:commit`, `/pipeline:triage`, `/pipeline:audit`

**Why:** `routing.source_dirs: ["."]` matches everything — config files, docs, lockfiles — inflating your change count and triggering gates unnecessarily.

**Fix:** Run `/pipeline:update` to set a specific source directory. Common values: `["src/"]`, `["src/", "lib/"]`, `["cmd/", "internal/"]`. Pipeline falls back to extension-based filtering (`.ts`, `.tsx`, `.js`, `.jsx`, `.rs`, `.go`, `.py`) in the meantime.

---

## Workflow Gate Errors

### "BLOCKED — N source files changed. `/pipeline:review` is required before committing."

**Commands:** `/pipeline:commit`

**Why:** You changed N source files, which meets or exceeds `routing.review_gate_threshold` (default: 3). This gate is absolute — no flag or argument bypasses it.

**Fix:**
1. Run `/pipeline:review`
2. Fix all red (must-fix) findings
3. Run `/pipeline:commit reviewed:✓`

To change the threshold, set `routing.review_gate_threshold` in `pipeline.yml`.

---

### Typecheck fails during commit preflight

**Commands:** `/pipeline:commit`

**Why:** `commands.typecheck` (e.g., `tsc --noEmit`) reported errors. Commit is blocked until they are resolved.

**Fix:** Fix the type errors. Run the typecheck command manually to verify they are gone, then retry `/pipeline:commit`.

To skip typechecking entirely, set `commands.typecheck: null` in `pipeline.yml`.

---

### Lint fails during commit preflight

**Commands:** `/pipeline:commit`

**Why:** `commands.lint` output matched `commands.lint_error_pattern`. Only errors block the commit — warnings pass.

**Fix:** Fix the lint errors (not warnings). Retry `/pipeline:commit`.

To skip linting entirely, set `commands.lint: null` in `pipeline.yml`.

---

### Tests fail during commit preflight

**Commands:** `/pipeline:commit`

**Why:** `commands.test` reported failures.

**Fix:** Fix failing tests. Run the test command manually to verify, then retry `/pipeline:commit`.

To skip tests entirely, set `commands.test: null` in `pipeline.yml`.

---

### "Tests failing (N failures). Must fix before completing."

**Commands:** `/pipeline:finish`

**Why:** The test suite failed during the finish preflight. Pipeline will not present merge or PR options until all tests pass. No exceptions — "fix it in a follow-up" is not an option.

**Fix:** Fix the failing tests. Run the test command manually to verify all pass, then retry `/pipeline:finish`.

---

### "You are on the base branch. `/pipeline:finish` is for feature branches."

**Commands:** `/pipeline:finish`

**Why:** You ran `/pipeline:finish` while on the base branch (e.g., `main`). Finish is designed for merging feature branches back.

**Fix:** Use `/pipeline:commit` to commit directly on the base branch, or `/pipeline:release` for a release. If you meant to finish a feature branch, switch to it first with `git checkout <branch>`.

---

### "No findings report found in `docs/findings/`."

**Commands:** `/pipeline:remediate`

**Why:** Remediation needs a findings report to work from, but none exists in the findings directory.

**Fix:** Run one of: `/pipeline:redteam`, `/pipeline:audit`, `/pipeline:review`, or `/pipeline:ui-review` to generate a findings report first, then retry `/pipeline:remediate`.

---

### "Spec lacks detail for implementation-ready planning."

**Commands:** `/pipeline:plan`

**Why:** The spec does not have enough detail to produce tasks with specific files, functions, and data types.

**Fix:** Either run `/pipeline:brainstorm` to produce a more detailed spec, or answer the specific questions listed in the error message and re-run `/pipeline:plan`.

---

### "No red team report found in `docs/findings/`. Run `/pipeline:redteam` first."

**Commands:** `/pipeline:compliance`

**Why:** Compliance mapping requires red team findings with CWE IDs to map against regulatory controls. No red team report exists in the findings directory.

**Fix:** Run `/pipeline:redteam` first to generate a red team report, then retry `/pipeline:compliance`.

---

### "Compliance mapping is not enabled."

**Commands:** `/pipeline:compliance`

**Why:** `compliance.enabled` is false or not present in `.claude/pipeline.yml`.

**Fix:** Add `compliance.enabled: true` to your config file:

```yaml
compliance:
  enabled: true
  frameworks: [nist_800_53, pci_dss, iso27001, nist_csf, soc2, gdpr, hipaa]
```

---

### "Purple team requires both a red team report and a remediation summary."

**Commands:** `/pipeline:purpleteam`

**Why:** Purple team validates that fixes actually resolve the findings. It needs both the original red team report and the remediation summary in `docs/findings/` to do that.

**Fix:** Run `/pipeline:redteam` first, then `/pipeline:remediate --source redteam`, then retry `/pipeline:purpleteam`. Or use `/pipeline:security` which orchestrates all three in sequence.

---

## Integration Errors

Pipeline detects optional tools at init time. When a tool is missing or becomes unavailable, Pipeline degrades gracefully — core commands always work, but you lose specific capabilities.

### Graceful Degradation

| Tool | What you lose without it | What still works |
|------|-------------------------|-----------------|
| PostgreSQL | Semantic search, structured task/finding tracking | Files tier: markdown sessions, decisions, gotchas. All commands run. |
| Ollama | Vector similarity search (embeddings) | FTS keyword search via Postgres, or no search on files tier |
| Platform CLI (`gh` / `az`) | PR creation from `/pipeline:finish`, lifecycle issue tracking (epics, finding issues) | Push manually, create PRs in browser, no issue tracking. Set `platform.issue_tracker: none` to suppress. |
| Playwright | Automated screenshots (secondary path) | Chrome DevTools MCP, or provide screenshots manually |
| Stitch / Figma MCP | AI design mockups in brainstorm and UI review | HTML wireframes via visual companion |
| Sentry | Auto-pull recent errors in `/pipeline:debug` | Describe errors manually when prompted |

---

### "This command requires Postgres."

**Commands:** `/pipeline:knowledge` (for: search, hybrid, index, add, check, cache, query, setup, task)

**Why:** You are on the files knowledge tier, but the command you ran requires the Postgres tier.

**Fix:** Run `/pipeline:init` and choose Postgres tier during setup, or run `/pipeline:knowledge setup` to upgrade an existing project. The files tier supports: `status`, `session`, `gotcha`, `decision`.

---

### "Cannot find module 'pg'"

**Commands:** Any command that persists to Postgres tier (commit, review, build, redteam, remediate, etc.)

**Why:** The `pg` npm package is not installed in the Pipeline scripts directory.

**Fix:** Navigate to the Pipeline `scripts/` directory and run `pnpm install` (or `npm install`). The scripts directory is at `$PIPELINE_DIR/scripts/` or `~/dev/pipeline/scripts/`.

---

### Embedding dimension mismatch

**Commands:** `/pipeline:knowledge hybrid`, `/pipeline:knowledge search`

**Why:** The Postgres embeddings table was indexed with a different vector dimension than the current Ollama model produces (e.g., you switched from a 1024-dim to a 768-dim model).

**Fix:** Re-index all embeddings:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-embed.js index --all
```
If you changed embedding models, you may need to drop and recreate the embeddings table first.

---

### PLATFORM_TWO_STORE: Unsupported platform

**Commands:** Any command that creates issues, PRs, or comments

**Why:** `platform.code_host` or `platform.issue_tracker` in `pipeline.yml` is set to an unsupported value. Supported values: `github`, `azure-devops`, `none`.

**Fix:** Edit `.claude/pipeline.yml` and set the platform fields to a supported value. Run `/pipeline:init` to re-detect from git remote URL.

---

### Platform CLI not authenticated

**Commands:** `/pipeline:finish` (PR creation), any command with issue tracking enabled

**Why:** The platform CLI is not authenticated:
- **GitHub:** `gh auth status` shows not logged in, or `GITHUB_TOKEN` is not set
- **Azure DevOps:** `az account show` fails, or `AZURE_DEVOPS_EXT_PAT` is not set

**Fix:**
- **GitHub:** Run `gh auth login` or set `GITHUB_TOKEN`
- **Azure DevOps:** Run `az login` or set `AZURE_DEVOPS_EXT_PAT`

To disable issue tracking entirely, set `platform.issue_tracker: none` in `pipeline.yml`.

---

### Azure DevOps extension not installed

**Commands:** Any command that uses Azure DevOps operations

**Why:** The `azure-devops` extension for Azure CLI is not installed.

**Fix:** Run `az extension add --name azure-devops`.

---

### Azure DevOps work item state transition failed

**Commands:** `/pipeline:remediate` (close finding issue), `/pipeline:finish` (close epic)

**Why:** The configured `done_state` is not a valid transition for the work item's current state. State names vary by process template (Basic, Agile, Scrum, CMMI).

**Fix:** Check your process template with `az devops project show --project <project> --query 'capabilities.processTemplate.templateName'`. Verify the `platform.azure_devops.done_state` in `pipeline.yml` matches your template. See `docs/security.md` section 10 for the state mapping table.

---

### Ollama not responding

**Commands:** `/pipeline:knowledge hybrid`, `/pipeline:knowledge search`

**Why:** Ollama is not running at `localhost:11434`, or the configured embedding model has not been pulled.

**Fix:**
1. Start Ollama: `ollama serve`
2. Pull the model: `ollama pull mxbai-embed-large` (or whichever model is in your config)

FTS keyword search still works without Ollama — only vector similarity search is affected.

---

### Stitch / Figma MCP not connected

**Commands:** `/pipeline:brainstorm` (visual companion), `/pipeline:ui-review`

**Why:** The MCP server for the design tool is not running or not configured in Claude Code settings.

**Fix:** See `docs/prerequisites.md` for setup instructions. Pipeline falls back to HTML wireframes automatically — no action needed unless you want design tool integration.

---

## Build Recovery

### "Found interrupted build from [timestamp]..."

**Commands:** `/pipeline:build`

**Why:** A previous build was interrupted mid-execution. Pipeline saves checkpoints to `.claude/build-state.json` after each completed task.

**Fix:** Pipeline will offer to resume from the last completed task. Accept to continue where you left off, or decline to start fresh (the stale state file is discarded).

---

### Stale build state from a different plan

**Commands:** `/pipeline:build`

**Why:** `.claude/build-state.json` exists but references a different plan file than the one you want to build now.

**Fix:** Pipeline will warn you. Choose to discard the old state and start fresh, or resume the old build if that is what you intended.

---

### Subagent dispatch fails

**Commands:** `/pipeline:build`, `/pipeline:redteam`, `/pipeline:audit`, `/pipeline:qa verify`

**Why:** The subagent could not be launched (context limit, API error, or resource exhaustion).

**Fix:** Pipeline falls back to sequential execution in the main context. The build continues but without parallelism. If the error persists, check your Claude API status and context usage.

---

## Git & Filesystem Errors

### Git push rejected

**Commands:** `/pipeline:commit` (push step), `/pipeline:finish`

**Why:** Remote has commits you do not have locally.

**Fix:** Pipeline attempts `git pull --rebase` automatically. If that fails due to merge conflicts, resolve the conflicts manually, then retry the command.

---

### Disk full / permission denied

**Commands:** Any

**Why:** Filesystem-level issue outside Pipeline's control.

**Fix:** Free disk space or fix file permissions. Pipeline cannot recover from these automatically.

---

## Orchestrator & Workflow Errors

### "No active workflow."

**Commands:** `orchestrator.js status`, `orchestrator.js next`, `orchestrator.js complete`

**Why:** No workflow has been started, or the Postgres `workflow_state` table is empty.

**Fix:** Start a workflow with `node scripts/orchestrator.js start <workflow-id>` (typically called by `/pipeline:init`).

---

### "Workflow already exists."

**Commands:** `orchestrator.js start`

**Why:** A workflow with the same ID already exists in `workflow_state`.

**Fix:** Use a different workflow ID, or check the existing workflow's status with `orchestrator.js status`.

---

### "Blocked: [step] — missing inputs"

**Commands:** `orchestrator.js next`

**Why:** The next step's preconditions are not met (e.g., review hasn't passed, plan file doesn't exist).

**Fix:** Complete the prerequisite step. The orchestrator shows which inputs are missing. See [workflow reference](workflow-reference.md) for the full step graph.

---

### "Loopback: [step] failed Nx — routing to architect"

**Commands:** `orchestrator.js next` (after purple team failure)

**Why:** A purple team finding has failed verification twice. The orchestrator routes to the architect step to re-examine whether the architectural standard is flawed.

**Fix:** This is intentional routing, not an error. Run `/pipeline:architect` to review the standard, then re-run the remediation and verification cycle.

---

### Postgres connection errors during orchestrator operations

**Commands:** Any command that calls `orchestrator.js`

**Why:** Postgres is unreachable. The orchestrator requires Postgres for workflow state.

**Fix:** Ensure PostgreSQL is running. Check connection settings. For TINY/MEDIUM changes that don't need orchestration, individual commands still work without Postgres (they use the files tier).

---

### "Task status mismatch" (three-store sync)

**Commands:** `/pipeline:dashboard`, `/pipeline:finish`

**Why:** Postgres, GitHub issues, and build-state have divergent data for the same task (e.g., Postgres shows "done" but GitHub issue is still open).

**Fix:** Postgres is the master store. Run `/pipeline:dashboard` to regenerate from Postgres. If GitHub issues are stale, manually close them or let `/pipeline:finish` reconcile on merge.
