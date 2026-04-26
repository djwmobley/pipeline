---
allowed-tools: Bash(node*), Bash(cd*), Bash(npm*), Bash(find*), Read(*), Glob(*)
description: Knowledge DB operations — setup, status, search, session recording, task management
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=script_exec
```


## Pipeline Knowledge

Interact with the knowledge DB. Routes to the correct script based on the subcommand.

### Step 0 — Locate scripts

The pipeline plugin's scripts directory contains pipeline-db.js, pipeline-embed.js, pipeline-cache.js, and pipeline-files.js.

To find it, check these locations in order:
1. If the environment has `PIPELINE_DIR` set, use `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/` (common dev location — `$USERPROFILE` is the Windows fallback for `$HOME`)
3. Search the Claude Code plugin cache: `find "${HOME:-$USERPROFILE}/.claude" -name "pipeline-db.js" -path "*/pipeline/*/scripts/*" 2>/dev/null | head -1`
4. If none found, ask: "Where is the pipeline plugin installed? I need the path to the scripts/ directory."

Set `SCRIPTS_DIR` to the directory containing the scripts. Store the resolved path as a literal string. Use this literal path (not a shell variable) in every subsequent Bash call, since shell state does not persist between tool invocations.

**Use this pattern for ALL script invocations:** `PROJECT_ROOT=[project_root] node [scripts_dir]/pipeline-db.js [args]` — this ensures scripts find the correct project, and avoids `cd` which would change the cwd to the pipeline plugin's git repo (causing scripts to read the wrong `pipeline.yml` and target the wrong database).

Ensure dependencies are installed. The `pg` package is required for Postgres tier commands. The plugin's scripts use pnpm (they have a `pnpm-lock.yaml`) — always use `pnpm install` here, regardless of the project's own package manager:
```bash
cd $SCRIPTS_DIR && [ -d node_modules ] || pnpm install --silent
```

If `node_modules` is missing and install fails, ask the user:
> "The pipeline scripts need their dependencies installed. Want me to run `pnpm install` in `[scripts_dir]`?"
If declined, show the command so they can do it themselves.

---

### Step 1 — Check knowledge tier

Read `.claude/pipeline.yml` in the project root and check `knowledge.tier`.

If tier is `"files"` (or not set), use `pipeline-files.js` instead of the Postgres scripts.
The files tier supports: `status`, `session`, `gotcha`, `decision`.

For commands not supported by files tier (`search`, `hybrid`, `index`, `add`, `check`, `cache`, `query`, `setup`, `task`), report:
"This command requires Postgres. Run `/pipeline:init` and choose Postgres tier, or use `/pipeline:knowledge setup` to upgrade."

---

### Route by argument

**No arguments / "help"** — Show available commands:

```
## Pipeline Knowledge

### Session & context
  /pipeline:knowledge status                        — Session context (last 3 sessions, open tasks, gotchas)
  /pipeline:knowledge session <N> <tests> "<desc>"  — Record a session

### Tasks (Postgres only)
  /pipeline:knowledge task new "<title>" [phase]    — Create a task
  /pipeline:knowledge task <id> <status>            — Update task (pending/in_progress/done/deferred)

### Gotchas
  /pipeline:knowledge gotcha "<issue>" "<rule>"     — Add a critical constraint

### Decisions
  /pipeline:knowledge decision "<topic>" "<decision>" "<reason>"  — Record a decision

### Search (Postgres only)
  /pipeline:knowledge search "<query>"              — FTS keyword search over code index
  /pipeline:knowledge hybrid "<query>"              — FTS + vector hybrid search (best)

### Code index (Postgres only)
  /pipeline:knowledge index                         — Generate embeddings for unembedded entries
  /pipeline:knowledge index --all                   — Re-embed everything
  /pipeline:knowledge add <path> "<description>"    — Add/update a file in the code index

### File cache (Postgres only)
  /pipeline:knowledge check <filepath>              — Check if file is cached (CACHE_HIT/MISS/STALE)
  /pipeline:knowledge cache <filepath> "<summary>"  — Cache a file with its hash + summary

### Setup (Postgres only)
  /pipeline:knowledge setup                         — Create database and all tables
  /pipeline:knowledge query "<SQL>"                 — Run raw SQL

### Cross-project transfer (Postgres only)
  /pipeline:knowledge export [file]                 — Export gotchas + decisions to JSON
  /pipeline:knowledge import <file_or_db>           — Preview what would be imported
  /pipeline:knowledge import <file_or_db> --all     — Import (duplicates skipped)
```

**"setup"** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js setup
```

**"status"** →
- Files tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-files.js status
```
- Postgres tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js status
```

**"session" <N> <tests> "<summary>"** →
- Files tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-files.js session $N $TESTS '$SUMMARY'
```
- Postgres tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js update session $N $TESTS '$SUMMARY'
```

**"task new" "<title>" [phase]** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js update task new '$TITLE' $PHASE
```

**"task" <id> <status>** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js update task $ID $STATUS
```

**"gotcha" "<issue>" "<rule>"** →
- Files tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-files.js gotcha '$ISSUE' '$RULE'
```
- Postgres tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js update gotcha new '$ISSUE' '$RULE'
```

**"decision" "<topic>" "<decision>" "<reason>"** →
- Files tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-files.js decision '$TOPIC' '$DECISION' '$REASON'
```
- Postgres tier:
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js update decision '$TOPIC' '$DECISION' '$REASON'
```

**Note:** Do NOT use raw SQL for decisions — single quotes in values will break the query. Use the `update decision` subcommand which handles parameterization.

**"search" "<query>"** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-cache.js search '$QUERY'
```

**"hybrid" "<query>"** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-embed.js hybrid '$QUERY'
```

**"index" [--all]** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-embed.js index $FLAG
```

**"add" <path> "<description>"** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-embed.js add '$PATH' '$DESC'
```

**"check" <filepath>** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-cache.js check '$FILEPATH'
```

**"cache" <filepath> "<summary>"** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-cache.js update '$FILEPATH' '$SUMMARY'
```

**"query" "<SQL>"** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js query '$SQL'
```

**"export" [file]** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js export $FILE
```

**"import" <source> [--all]** →
```bash
PROJECT_ROOT=$(pwd) node $SCRIPTS_DIR/pipeline-db.js import '$SOURCE' $FLAG
```
Without `--all`, this is a dry run — shows what would be imported. With `--all`, imports gotchas and decisions, skipping duplicates.
