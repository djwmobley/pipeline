---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*), Task(*)
description: Systematic root-cause diagnosis — 4 phases, error class routing, no speculative fixes
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=debugging
```


## Pipeline Debug

Locate and read the debugging skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/debugging/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/debugging/SKILL.md` to find it

### Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.typecheck`, `commands.lint`, `commands.test`, `commands.test_verbose`
- `routing.source_dirs`
- `integrations.sentry` — if enabled, pull recent errors

If no config file exists, use defaults for any missing values.

### Classify the error

From the arguments or context, identify the error class:

| Class | Symptoms | First action |
|---|---|---|
| Build/Type | Type checker errors, build fails | Run `commands.typecheck` |
| Runtime | Console errors, crash, white screen | Get full error + stack trace |
| Network/DB | API failures, auth errors, data missing | Check status codes, connection |
| Test | Test suite failures | Run `commands.test_verbose` |
| Environment | Missing env vars, corrupt lock files, version mismatch | Check env, dependencies, config |

If the error doesn't clearly fit a class, treat it as Runtime and proceed with Phase 1.

**Sentry integration:** If `integrations.sentry.enabled` is true, use the Sentry MCP tools (if available) or Sentry CLI to pull recent errors for the project before starting diagnosis. If neither is available, skip — Sentry is advisory, not required.

Then follow the debugging skill's 4-phase protocol. **Critical: if 3+ fix attempts fail (the code change didn't resolve the error), STOP and discuss architecture with the user before attempting more fixes.**

### Report

```
## Debug Summary

**Error class:** [Build/Runtime/Network/Test/Environment]
**Root cause:** [one sentence] **[HIGH/MEDIUM/LOW confidence]**
**Fix applied:** [file:line — what changed]
**Verified:** [verification command run + output confirming the fix — e.g., "npx vitest run: 42 passing, 0 failing"]

If confidence in the root cause is LOW, do NOT implement a fix. Report the uncertainty and gather more evidence.
```

---

### Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Store the root cause and fix as a gotcha:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update gotcha new "$(cat <<'TITLE'
[error class]: [root cause in one line]
TITLE
)" "$(cat <<'RULE'
[fix applied — what to do if this recurs]
RULE
)"
```

Record the debug decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'debug-resolution' "$(cat <<'SUMMARY'
[date]: [error class] — [root cause]. Confidence: [HIGH/MEDIUM/LOW]
SUMMARY
)" "$(cat <<'DETAIL'
Fix: [file:line — what changed]. Verified: [verification result]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:**

Store the root cause (debug gotchas are always worth recording):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js gotcha "$(cat <<'TITLE'
[error class]: [root cause in one line]
TITLE
)" "$(cat <<'RULE'
[fix applied — what to do if this recurs]
RULE
)"
```
