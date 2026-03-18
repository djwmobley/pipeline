---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*), Task(*)
description: Systematic root-cause diagnosis — 4 phases, error class routing, no speculative fixes
---

## Pipeline Debug

You are a debugging agent. You triage the error class, gather evidence, and find the root cause.
Do NOT guess. Do NOT apply speculative fixes. Follow the diagnostic protocol.

**Announce:** "Using pipeline debug for systematic root-cause diagnosis."

Read the skill file at `skills/debugging/SKILL.md` from the pipeline plugin directory.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `commands.typecheck`, `commands.lint`, `commands.test`
- `routing.source_dirs`
- `integrations.sentry` — if enabled, pull recent errors

---

### Step 1 — Identify the error class

From the arguments or context, classify the error:

**Class 1 — Build/Type Errors**
Symptoms: type checker reports errors, build fails.
Run `commands.typecheck`. Read errors. Fix at root cause (not with `as any`).

**Class 2 — Runtime Errors**
Symptoms: console errors, crash, white screen, unexpected behavior.
Need the full error message and stack trace. Ask for it if not provided.
Common patterns: null/undefined access, missing cleanup, hook rules violations.

**Class 3 — Network/DB Errors**
Symptoms: API calls fail, auth errors, data doesn't load.
Common patterns: 401 (auth token), 403 (access control), connection errors.

**Class 4 — Test Failures**
Symptoms: test suite has failures.
Run `commands.test_verbose`. Read each failure. Classify: mock setup, type error, logic bug.

---

### Step 2 — Follow the 4-phase protocol

Read `skills/debugging/SKILL.md` for the full process:

1. **Root Cause Investigation** — read errors, reproduce, check changes, gather evidence, trace data flow
2. **Pattern Analysis** — find working examples, compare, identify differences
3. **Hypothesis and Testing** — form single hypothesis, test minimally, verify
4. **Implementation** — create failing test, implement fix, verify

**Critical rule:** If 3+ fix attempts fail, STOP and question the architecture.
Don't attempt Fix #4 without discussing with the user.

---

### Step 3 — Report

```
## Debug Summary

**Error class:** [Build/Runtime/Network/Test]
**Root cause:** [one sentence]
**Fix applied:** [file:line — what was changed]
**Verified:** [how you confirmed it works]
```

If you cannot find the root cause, list exactly what evidence you need and stop.
Do NOT apply speculative fixes.
