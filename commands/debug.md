---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*), Task(*)
description: Systematic root-cause diagnosis — 4 phases, error class routing, no speculative fixes
---

## Pipeline Debug

Read the skill file at `skills/debugging/SKILL.md` from the pipeline plugin directory.

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

Then follow the debugging skill's 4-phase protocol. **Critical: if 3+ fixes fail, STOP and question the architecture.**

### Report

```
## Debug Summary

**Error class:** [Build/Runtime/Network/Test]
**Root cause:** [one sentence]
**Fix applied:** [file:line — what changed]
**Verified:** [how you confirmed it works]
```
