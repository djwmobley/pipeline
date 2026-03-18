---
allowed-tools: Bash(node*), Bash(cd*), Bash(npm*), Read(*)
description: Knowledge DB operations — setup, status, search, session recording, task management
---

## Pipeline Knowledge

Interact with the knowledge DB. Routes to the correct script based on the subcommand.

### Step 0 — Locate scripts

The pipeline plugin's scripts directory contains pipeline-db.js, pipeline-embed.js, and pipeline-cache.js.

To find it, check these locations in order:
1. If the environment has `PIPELINE_DIR` set, use `$PIPELINE_DIR/scripts/`
2. Check `$HOME/dev/pipeline/scripts/` (common dev location)
3. Search the Claude Code plugin cache: `find "$HOME/.claude" -name "pipeline-db.js" -path "*/pipeline/*/scripts/*" 2>/dev/null | head -1`
4. If none found, ask: "Where is the pipeline plugin installed? I need the path to the scripts/ directory."

Set `SCRIPTS_DIR` to the directory containing the scripts.

Ensure dependencies are installed:
```bash
cd $SCRIPTS_DIR && [ -d node_modules ] || npm install --silent
```

---

### Route by argument

**No arguments / "help"** — Show available commands:

```
## Pipeline Knowledge

### Session & context
  /pipeline:knowledge status                        — Session context (last 3 sessions, open tasks, gotchas)
  /pipeline:knowledge session <N> <tests> "<desc>"  — Record a session

### Tasks
  /pipeline:knowledge task new "<title>" [phase]    — Create a task
  /pipeline:knowledge task <id> <status>            — Update task (pending/in_progress/done/deferred)

### Gotchas
  /pipeline:knowledge gotcha "<issue>" "<rule>"     — Add a critical constraint

### Search
  /pipeline:knowledge search "<query>"              — FTS keyword search over code index
  /pipeline:knowledge hybrid "<query>"              — FTS + vector hybrid search (best)

### Code index
  /pipeline:knowledge index                         — Generate embeddings for unembedded entries
  /pipeline:knowledge index --all                   — Re-embed everything
  /pipeline:knowledge add <path> "<description>"    — Add/update a file in the code index

### File cache
  /pipeline:knowledge check <filepath>              — Check if file is cached (CACHE_HIT/MISS/STALE)
  /pipeline:knowledge cache <filepath> "<summary>"  — Cache a file with its hash + summary

### Setup
  /pipeline:knowledge setup                         — Create database and all tables
  /pipeline:knowledge query "<SQL>"                 — Run raw SQL
```

**"setup"** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js setup
```

**"status"** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js status
```

**"session" <N> <tests> "<summary>"** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js update session $N $TESTS "$SUMMARY"
```

**"task new" "<title>" [phase]** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js update task new "$TITLE" $PHASE
```

**"task" <id> <status>** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js update task $ID $STATUS
```

**"gotcha" "<issue>" "<rule>"** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js update gotcha new "$ISSUE" "$RULE"
```

**"search" "<query>"** →
```bash
cd $SCRIPTS_DIR && node pipeline-cache.js search "$QUERY"
```

**"hybrid" "<query>"** →
```bash
cd $SCRIPTS_DIR && node pipeline-embed.js hybrid "$QUERY"
```

**"index" [--all]** →
```bash
cd $SCRIPTS_DIR && node pipeline-embed.js index $FLAG
```

**"add" <path> "<description>"** →
```bash
cd $SCRIPTS_DIR && node pipeline-embed.js add "$PATH" "$DESC"
```

**"check" <filepath>** →
```bash
cd $SCRIPTS_DIR && node pipeline-cache.js check "$FILEPATH"
```

**"cache" <filepath> "<summary>"** →
```bash
cd $SCRIPTS_DIR && node pipeline-cache.js update "$FILEPATH" "$SUMMARY"
```

**"query" "<SQL>"** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js query "$SQL"
```
