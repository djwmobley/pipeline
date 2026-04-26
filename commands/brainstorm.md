---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*), mcp__stitch__create_project, mcp__stitch__list_projects, mcp__stitch__get_project, mcp__stitch__list_screens, mcp__stitch__get_screen, mcp__stitch__generate_screen_from_text, mcp__stitch__edit_screens, mcp__stitch__generate_variants, mcp__figma__get_file_nodes, mcp__figma__get_images
description: Design before LARGE changes — explore context, clarify requirements, propose approaches, write spec
---

```bash
# Set active skill for routing enforcement
node scripts/lib/active-skill.js write brainstorming
```


## Pipeline Brainstorm

Locate and read the brainstorming skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/brainstorming/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/brainstorming/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.specs_dir` — where to save spec documents
- `review.non_negotiable` — intentional decisions to respect
- `security` — security checklist to evaluate against
- `models.research` — model for research verification agents (default: haiku)
- `routing.source_dirs` — where to look for existing patterns
- `integrations.stitch.enabled` — whether Stitch MCP is available for design mockups
- `integrations.stitch.project_id` — existing Stitch project for this pipeline project (may be null)
- `integrations.stitch.device_type` — target device for generated screens
- `integrations.figma.enabled` — whether Figma MCP is available for design reference
- `integrations.github.enabled` — whether issue tracker is available
- `integrations.github.issue_tracking` — whether to create/link issues across lifecycle

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

Follow the brainstorming skill exactly. Pass the config values to each step that needs them.

**Decision lock check:** Before proposing approaches, check for locked decisions.

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

Store the resolved absolute path and use it in the command below.

**Postgres tier:**
```bash
PROJECT_ROOT=$(pwd) node <resolved_scripts_dir>/pipeline-db.js query "SELECT topic, decision FROM decisions WHERE status = 'locked' ORDER BY created_at DESC LIMIT 20"
```

**Files tier:** Read `DECISIONS.md` from the project root if it exists. In DECISIONS.md, lines prefixed with `[LOCKED]` are constraints. Lines without the prefix are informational context.

Locked decisions are constraints, not suggestions. You MUST NOT propose alternatives to locked decisions. If a locked decision conflicts with the current task, flag it explicitly:
> "Warning: Locked decision [topic] constrains this design: [decision]. Working within this constraint."

**Research gate:** The brainstorming skill includes a research verification step (step 4). When dispatching research agents, locate and read `researcher-prompt.md` from the brainstorming skill directory (same directory as `SKILL.md`). Substitute all placeholders per its checklist before dispatching. Pass `models.research` as the model and `routing.source_dirs` as the source directories.

The brainstorming skill includes a hard gate against premature implementation. Enforce it.

---

### Persist to knowledge tier

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Using the same `SCRIPTS_DIR` resolved earlier for the locked-decisions query:

Record the design decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision "$(cat <<'TOPIC'
design-[feature-name]
TOPIC
)" "$(cat <<'SUMMARY'
[date]: [chosen approach name/summary]
SUMMARY
)" "$(cat <<'DETAIL'
[1-2 sentences: what was decided and key trade-offs considered]
DETAIL
)"
```

If any decisions should be locked (user said "lock this" or the decision is a hard constraint):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "UPDATE decisions SET status = 'locked' WHERE topic = '[topic]'"
```

**If `knowledge.tier` is `"files"`:**

Only record if the decision is locked — unlocked design decisions go to postgres only to avoid bloating DECISIONS.md:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js decision "$(cat <<'TOPIC'
[LOCKED] design-[feature-name]
TOPIC
)" "$(cat <<'SUMMARY'
[chosen approach]
SUMMARY
)" "$(cat <<'DETAIL'
[key trade-offs]
DETAIL
)"
```

---

### Issue Tracking

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

1. Create the feature epic:
   ```bash
   cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue create --title '[Feature name from spec title]' --labels 'pipeline:epic' --stdin
   ## Feature Epic

   [2-3 sentence summary from spec]

   ### Spec
   `[spec file path]`

   ### Status
   - [x] Brainstorm
   - [ ] Plan
   - [ ] Build
   - [ ] QA
   - [ ] Review
   - [ ] Ship
   EOF
   ```
   If the command fails, notify the user with the error and ask for guidance.

2. Store the returned issue number.
3. Append `github_epic: [N]` to the spec file metadata (add after the first `---` line if YAML frontmatter exists, or add a metadata comment block at the top).
4. Report: "Created feature epic: #[N]"

If `integrations.github.enabled` is false OR `integrations.github.issue_tracking` is false: skip this section entirely.

---

### Postgres Task Creation

This ensures every brainstormed feature has a Postgres task from day one, preventing drift between stores.

Using the same `SCRIPTS_DIR` resolved earlier for the locked-decisions query:

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

**Case 1 — Epic was created (issue number is available):**

Create a task linked to the epic:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task new '[feature name]' 'design' [issue_ref_number]
```

**Case 2 — Issue tracker is NOT enabled but Postgres IS (no issue number):**

Create a task without the issue link:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task new '[feature name]' 'design'
```

**In either case**, capture the new task ID from the output (it prints `Task #N ...`), then set the task as a roadmap item:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task [new_id] category roadmap
```
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task [new_id] readme_label '[feature name]'
```

Report: "Created Postgres task #[new_id] for [feature name] (linked to epic #[N])" — or without the epic reference if issue tracking was skipped.

If `knowledge.tier` is not `"postgres"` OR `integrations.postgres.enabled` is false: skip this section entirely.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### What's Next

After the spec is saved, present size-aware routing to the user:

**If the spec describes a LARGE or MILESTONE change** (3+ components, cross-cutting concerns, new technology choices):

```
Spec saved to [path].

Next steps for a change this size:
1. /pipeline:architect — technology decisions with parallel domain specialists
2. /pipeline:plan — implementation tasks with QA strategy

Or skip straight to /pipeline:plan if you've already made your technology choices.
```

**If the spec describes a MEDIUM change** (1-2 components, familiar tech):

```
Spec saved to [path].

Next: /pipeline:plan
```

**If the spec describes a TINY change:**

```
Spec saved to [path].

This might not need a full plan. You can implement directly and /pipeline:commit.
```

Determine the size from the spec's scope — component count, file count estimates, whether new technology choices are needed. When in doubt, recommend the larger workflow.

---

### Orchestrator

Record step completion with the spec file as the output artifact:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete brainstorm PASS '[spec file path]'
```

If brainstorm failed (no spec was saved), record the failure so the orchestrator has history of the attempt:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete brainstorm FAIL
```
