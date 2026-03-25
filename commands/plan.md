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

If no verdict found and the spec is LARGE+ (4+ files or new subsystem):

```
**Note:** No debate verdict found for this spec. For LARGE+ changes, consider running
`/pipeline:debate` first to stress-test assumptions before planning.

Continue planning without debate? (Y/n)
```

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

**LARGE/MILESTONE auto-invoke:** If the recon agent identifies 3+ relevant domains AND no decision records file exists in `docs.plans_dir` for the current spec, auto-invoke the full architecture mode:
1. Read the full architecture SKILL.md and follow the **Full Mode** path
2. This dispatches domain specialists and produces a decisions artifact
3. The decisions artifact's Constraints Summary replaces the inline recon constraints

If the user has already run `/pipeline:architect` explicitly (decision records file exists), skip recon entirely — read the existing decisions and inject their Constraints Summary.

---

Follow the planning skill exactly, passing the architectural constraints as context.

**Implementation readiness requirement:** The plan MUST be concrete enough to implement without further design decisions:
- Every task names specific files to create or modify
- Every new function has a signature or clear description
- Every data model change has field names and types
- Every API endpoint has method, path, and payload shape

If the spec is too vague to produce this level of detail, stop and report: "Spec lacks detail for implementation-ready planning. Run `/pipeline:brainstorm` first or clarify: [specific questions]."

**Save plans to:** `{docs.plans_dir}/YYYY-MM-DD-{feature-name}.md` (use `date +%Y-%m-%d` via Bash for today's date)

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
     gh issue comment [N] --repo '[project.repo]' --body "$(cat <<'EOF'
     ## Plan Created

     **Tasks:** [count]
     **Plan:** `[plan file path]`
     [bulleted task title list]
     EOF
     )"
     ```
   - Update the epic status checklist (edit the issue body to check `Plan`).
3. If not found: skip — user may have started from plan directly or GitHub tracking was added after brainstorm.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.
