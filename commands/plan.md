---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*)
description: Create an implementation plan from a spec — bite-sized tasks with build sequence
---

## Pipeline Plan

Locate and read the planning skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/planning/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/planning/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.plans_dir` — where to save plans
- `docs.specs_dir` — where to find specs
- `models` — model routing for task assignment
- `commands.test` — test command for verification steps
- `routing.source_dirs` — source directories
- `architect` — architect config section (if present)
- `qa` — QA config section (if present)
- `project.profile` — project profile
- `integrations.github.enabled` — whether GitHub CLI is available
- `integrations.github.issue_tracking` — whether to create/link issues across lifecycle
- `project.repo` — GitHub repo (owner/repo)

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

**Spec selection:** If the user specified a spec file, use it. Otherwise, list files in `docs.specs_dir` and use the most recent one. If multiple exist with no clear recency, ask the user which to plan from.

---

### Debate Verdict (if available)

Check for a debate verdict file matching the spec being planned:

```bash
ls -t docs/findings/debate-*-*.md 2>/dev/null | head -5
```

If a verdict file exists whose topic matches the spec (by name or date proximity):
1. Read the verdict file
2. Extract: disposition, points of agreement, contested points, invalidated assumptions, risk register
3. Inject these as a `## Debate Constraints` section — the plan must honor points of agreement and explicitly address contested points

<!-- checkpoint:SHOULD plan-no-debate -->

If no verdict found and the spec is LARGE+ (4+ files or new subsystem):

```
**Note:** No debate verdict found for this spec. For LARGE+ changes, consider running
`/pipeline:debate` first to stress-test assumptions before planning.

Continue planning without debate? (Y/n)

Risk of skipping: Plans without debate have historically required full rewrites for LARGE features.
```

If the user accepts (continues without debate), log: `Debate prerequisite: skipped by user`

If the user declines, stop with: "Run `/pipeline:debate` with your spec, then re-run `/pipeline:plan`."

---

### Architecture Recon (silent — runs automatically)

Before planning, run architecture recon to understand the codebase's existing patterns and conventions. This is invisible to the builder — no separate command, no extra step.

Locate the architecture skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/architecture/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/architecture/SKILL.md` to find it

Follow the architecture skill's **Silent Mode** (MEDIUM path):

1. Dispatch the recon agent using `recon-agent-prompt.md` from the architecture skill directory
2. The recon agent returns a **Constraints Block** (existing stack, patterns, relevant domains, test coverage)
3. Inject the Constraints Block into the planning skill as an `## Architectural Constraints` section

**LARGE/MILESTONE auto-invoke:** If the recon agent identifies 3+ relevant domains AND `docs/architecture.md` does not exist, auto-invoke the full architecture mode:
1. Read the full architecture SKILL.md and follow the **Full Mode** path
2. This dispatches domain specialists and produces `docs/architecture.md`
3. The Constraints Summary from `docs/architecture.md` replaces the inline recon constraints

If `docs/architecture.md` already exists (user ran `/pipeline:architect` explicitly), skip recon entirely — read the existing Constraints Summary and inject it.

---

<!-- checkpoint:MUST plan-coverage — enforced in skills/planning/SKILL.md -->

Follow the planning skill exactly, passing the architectural constraints as context.

**Implementation readiness requirement:** The plan MUST be concrete enough to implement without further design decisions:
- Every task names specific files to create or modify
- Every new function has a signature or clear description
- Every data model change has field names and types
- Every API endpoint has method, path, and payload shape

**Inline TBD resolution:** If the spec contains TBDs, ambiguities, or underspecified areas, resolve them inline during planning. Do NOT send the user back to brainstorm.

**First, assess TBD density.** Count top-level spec requirements that cannot be resolved to concrete implementation steps without additional user input (i.e., neither decomposable into sub-decisions nor spikeable to a research task). If more than half fall into this category, report: "This spec needs more detail before planning. Specific gaps: [list]. Consider re-running `/pipeline:brainstorm` to flesh these out, or answer the questions above to continue."

**Otherwise, resolve each TBD inline** — never stop planning for individual TBDs:

1. **List each TBD** with its context from the spec
2. **For each TBD**, present options and ask the user to choose:
   - If the user is indecisive, ask WHY — the indecision often reveals a hidden constraint or missing information that, once surfaced, makes the choice obvious
   - If the TBD is decomposable (e.g., "TBD: auth strategy"), break it into concrete sub-decisions (session storage, token format, middleware placement) and resolve each
   - If the user remains unable to decide after the WHY question, treat the TBD as genuinely unresolvable and mark it as a spike task in the plan with a clear deliverable
   - If the TBD genuinely cannot be resolved without research, mark it as a spike task with a clear deliverable

---

### QA Strategy Section (inline — runs automatically for MEDIUM+)

After writing the implementation plan tasks but before the review loop, generate a QA section.

Locate the QA skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/qa/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/qa/SKILL.md` to find it

Follow the QA skill's **Plan Mode — Inline (MEDIUM)** path:

1. Read the spec, the architectural constraints (from recon), and the implementation plan tasks just written
2. Read existing test files in the codebase (use Glob to find test patterns, read 2-3 samples)
3. Identify the top 5 risks at component interaction points
4. Generate a `## QA Strategy` section and append it to the implementation plan

The QA section includes:
- Risk assessment (5 risks at component interaction level)
- P0 test scenarios with test intent
- Seam tests at integration boundaries

Build agents will see this section alongside their tasks and write tests that map to it.

**LARGE/MILESTONE auto-invoke:** If the change is LARGE or MILESTONE sized (determined by file count and scope from the plan), generate a standalone QA test plan by default. The user can skip if they want to handle QA themselves:

> "This is a LARGE change with [N] tasks across [M] files. Generating a standalone QA test plan with parallel work packages for better coverage. Skip with 'n' if you want to handle QA yourself. Generate QA test plan? (Y/n)"

If the user accepts (or doesn't respond, defaulting to Y): invoke the QA planner following the QA skill's "Plan Mode — Standalone" process. If the user declines: skip and proceed to knowledge tier persistence.

---

### Post-Plan Debate Offer (LARGE+)

After the plan is complete (tasks + QA strategy written, review loop passed) but **before
saving the plan file**, if the change is LARGE+ and no debate verdict already exists:

```
## Debate This Plan?

Running a debate now challenges your key decisions BEFORE implementation — when
changes are cheap.

**Key decisions that would be debated:**
[list 3-5 key decisions from the plan: technology choices, patterns, scope cuts.
 Count DECISION-NNN entries from Architectural Constraints, plus any technology
 or pattern choices made during TBD resolution.]

Run `/pipeline:debate` on this plan? (y/N — default: skip, proceed to build)
```

If the user accepts: do NOT save the plan file. Stop here. The user will run
`/pipeline:debate`, then re-run `/pipeline:plan`. On re-run, the Debate Verdict
section (at the top of this command) will load the verdict and inject constraints.

If the user declines or skips (default): proceed to save and persistence.

If a debate verdict already exists (was loaded in the Debate Verdict section above): skip this
offer entirely — the plan already incorporates debate constraints.

---

### Save and persist

**Save plans to:** `{docs.plans_dir}/YYYY-MM-DD-{feature-name}.md` (use `date +%Y-%m-%d` via Bash for today's date)

### Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

For each task in the plan, create a task record:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task new "$(cat <<'TITLE'
[task title from plan]
TITLE
)" 'build'
```

Record the planning decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision "$(cat <<'TOPIC'
plan-[feature-name]
TOPIC
)" "$(cat <<'SUMMARY'
Plan [date]: [N] tasks from spec [spec-name]
SUMMARY
)" "$(cat <<'DETAIL'
Saved to [plan file path]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:** No writes — tasks are in the plan file, decisions would bloat DECISIONS.md.

---

### GitHub Epic Update

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

1. Read the spec file used for this plan. Extract `github_epic: N` from its metadata (YAML frontmatter or metadata comment block).
2. If found:
   - Write `github_epic: [N]` into the plan file metadata (add after the first `---` line).
   - Comment on the epic:
     ```bash
     cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
     ## Plan Created

     **Tasks:** [count]
     **Plan:** `[plan file path]`
     [bulleted task title list]
     EOF
     ```
     If the command fails, notify the user with the error and ask for guidance.
   - Update the epic status checklist (edit the issue body to check `Plan`).
3. If not found: skip — user may have started from plan directly or GitHub tracking was added after brainstorm.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### Orchestrator

Record step completion with the plan file as the output artifact:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete plan PASS '[plan file path]'
```

If the plan was not saved (user abandoned or TBD density too high), record the failure:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete plan FAIL
```
