---
allowed-tools: Bash(node*), Bash(cd*), Bash(npm*), Read(*)
description: Knowledge DB operations — setup, status, search, session recording, task management
---

## Pipeline Knowledge

Interact with the knowledge DB. Routes to the correct script based on the subcommand.

### Step 0 — Locate scripts

The pipeline plugin's scripts directory contains pipeline-db.js, pipeline-embed.js, pipeline-cache.js, and pipeline-files.js.

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
```

**"setup"** →
```bash
cd $SCRIPTS_DIR && node pipeline-db.js setup
```

**"status"** →
- Files tier:
```bash
cd $SCRIPTS_DIR && node pipeline-files.js status
```
- Postgres tier:
```bash
cd $SCRIPTS_DIR && node pipeline-db.js status
```

**"session" <N> <tests> "<summary>"** →
- Files tier:
```bash
cd $SCRIPTS_DIR && node pipeline-files.js session $N $TESTS "$SUMMARY"
```
- Postgres tier:
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
- Files tier:
```bash
cd $SCRIPTS_DIR && node pipeline-files.js gotcha "$ISSUE" "$RULE"
```
- Postgres tier:
```bash
cd $SCRIPTS_DIR && node pipeline-db.js update gotcha new "$ISSUE" "$RULE"
```

**"decision" "<topic>" "<decision>" "<reason>"** →
- Files tier:
```bash
cd $SCRIPTS_DIR && node pipeline-files.js decision "$TOPIC" "$DECISION" "$REASON"
```
- Postgres tier:
```bash
cd $SCRIPTS_DIR && node pipeline-db.js query "INSERT INTO decisions (topic, decision, reason) VALUES ('$TOPIC', '$DECISION', '$REASON')"
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
