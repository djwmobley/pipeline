---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Task(*)
description: Subagent-driven plan execution — fresh agent per task with post-task review
---

## Pipeline Build

Locate and read the building skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/building/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/building/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `models` — model routing for task assignment
- `models.cheap` — for document reviews and mechanical tasks
- `commands.test` — test command for verification
- `review.non_negotiable` — intentional decisions for reviewer
- `docs.plans_dir` — where to find plans

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

**Plan selection:** If the user specified a plan file, use it. Otherwise, list files in `docs.plans_dir` and use the most recent one. If multiple exist with no clear recency, ask the user which to execute.

Follow the building skill exactly. Use the value of `models.cheap` from pipeline.yml (e.g., `haiku`) for mechanical tasks and document reviews. Use the value of `models.implement` (e.g., `sonnet`) for integration tasks. When dispatching subagents, substitute these literal model strings into the prompt templates — do not pass config key names.

**Baseline tracking:** Before dispatching the first task, record the current commit SHA:

```bash
git rev-parse HEAD 2>/dev/null || echo "NO_COMMITS"
```

Store this as `BASELINE_SHA`. After all tasks complete, include it in the completion message so `/pipeline:review` can diff against it.

**Completion message:** When all tasks are done, present options:

```
Build complete. [N] tasks executed. Baseline: [BASELINE_SHA]

What next?

1. Review + commit + finish  (full workflow — review, commit, merge/push)
2. Review only  (/pipeline:review --since [BASELINE_SHA])
3. Skip review, commit directly  (/pipeline:commit reviewed:✓)
4. Leave as-is  (I'll handle it)

Which option? (default: 1)
```

**Default to the most complete option.** If the user says "finish it", "ship it", or similar — execute option 1 without further prompting.

**Fresh context rule:** When dispatching sub-agents for LARGE tasks, each agent receives ONLY:
1. The specific task description from the plan (paste the text — do not reference a file)
2. Relevant file contents (paste — do not ask the sub-agent to read files)
3. If Postgres tier: results from `pipeline-embed.js hybrid "<task description>"` for prior context
4. The project's non-negotiable decisions from config

Do NOT pass conversation history, prior task results, or accumulated context. Each sub-agent starts clean. This prevents context rot — quality degradation as context accumulates.

**Fallback:** If subagents are unavailable, execute tasks sequentially in main context.

---

### Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Record the build session (use `query "SELECT COALESCE(MAX(number),0)+1 FROM sessions"` to get next session number):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update session [next_number] [test_count] "$(cat <<'EOF'
Build: [N] tasks executed from plan [plan-name]
EOF
)"
```

For each completed task, update its status:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task [task_id] done
```

For any deferred tasks:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task [task_id] deferred
```

**If `knowledge.tier` is `"files"`:**

Record session only (auto-rotates to keep 5 most recent):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js session [next_number] [test_count] "$(cat <<'EOF'
Build: [N] tasks executed from plan [plan-name]
EOF
)"
```

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.
