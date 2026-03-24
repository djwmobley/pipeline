---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Task(*)
description: Subagent-driven plan execution — fresh agent per task with post-task review
---

## Pipeline Build

Locate and read the building skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/building/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/building/SKILL.md` to find it

### Resume detection

Check for an existing build state file at `.claude/build-state.json`:

**If it exists:**
1. Read it and parse the JSON
2. Check if the `plan_file` matches the plan the user wants to build (or the most recent plan if none specified)
3. **If plan matches:** Report what was completed and offer to resume:
   ```
   Found interrupted build from [started_at].
   Plan: [plan_file]
   Completed: [N] of [total] tasks
   Last completed: "[title of last done task]"

   Resume from task [next_task_id]? (Y/n)
   ```
   If user confirms: skip all tasks with `"status": "done"`, start from first `"pending"` or `"in_progress"` task. Use the stored `baseline_sha`.
4. **If plan differs:** Warn — this is stale state from a different build. Ask user whether to discard it and start fresh, or resume the old build.

**If it does not exist:** Proceed normally (fresh build).

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

**Initialize build state file:** Write `.claude/build-state.json` with the initial state:

```json
{
  "plan_file": "[path to plan being executed]",
  "baseline_sha": "[BASELINE_SHA]",
  "started_at": "[ISO 8601 timestamp]",
  "tasks": [
    { "id": 1, "title": "[task title from plan]", "status": "pending" },
    { "id": 2, "title": "[task title from plan]", "status": "pending" }
  ]
}
```

If resuming an existing build, do NOT overwrite — use the existing state file.

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

**Clean up state file:** After the user selects an option and the build is considered done, delete `.claude/build-state.json`. The knowledge tier persistence (below) is the permanent record — the state file is only for crash recovery.

**Fresh context rule:** When dispatching sub-agents for LARGE tasks, each agent receives ONLY:
1. The specific task description from the plan (paste the text — do not reference a file)
2. Relevant file contents (paste — do not ask the sub-agent to read files)
3. If Postgres tier: results from `pipeline-embed.js hybrid "<task description>"` for prior context
4. The project's non-negotiable decisions from config (`review.non_negotiable[]`)
5. Prior task summaries from `.claude/build-state.json` (title + status for each completed task)
6. Project profile from `project.profile` in pipeline.yml

Do NOT pass conversation history, prior task results, or accumulated context. Each sub-agent starts clean. This prevents context rot — quality degradation as context accumulates.

**Checkpoint after each task:** After a task passes post-task review, update `.claude/build-state.json`:
- Set the task's `status` to `"done"`
- Add `"commit"` with the current HEAD SHA (if the task produced a commit)
- Write the file immediately — do not batch updates

This ensures that if the session is interrupted, the next `/pipeline:build` invocation can resume from the last completed task.

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
