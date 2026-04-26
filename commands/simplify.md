---
allowed-tools: Bash(*), Read(*), Edit(*), Glob(*), Grep(*)
description: Targeted code simplification — reviews specific files for SOLID violations, premature abstraction, dead code
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=reviewing
```


## Pipeline Simplify

Simplify specific files flagged by `/pipeline:review` or `/pipeline:audit`.
Does NOT do a full re-review — applies targeted simplification only.

---

### Step 0 — Load config

Read `.claude/pipeline.yml`. Extract `review.non_negotiable`.

---

### Step 1 — Identify targets

From arguments, get the list of files to simplify. These come from:
- The "Simplify candidates" block of `/pipeline:review` output
- The "Simplify candidates" block of `/pipeline:audit` synthesis output
- Direct user specification

If no files specified: "No simplify targets provided. Run `/pipeline:review` first
to identify candidates, or specify files directly."

---

### Step 2 — For each file

Read the full file. Review for:

**SOLID violations** (only where they cause a real problem):
- SRP: component/hook doing too many jobs → split responsibilities
- OCP: growing if/else or switch → extract to strategy/map pattern
- ISP: large interfaces where callers use subsets → split interfaces
- DIP: direct service/DB imports → inject through abstractions

**Premature abstraction:**
- Helpers/utilities used exactly once → inline them
- Configuration for scenarios that don't exist → remove
- Error handling for impossible paths → remove

**Dead code:**
- Unused functions, variables, imports → remove
- Unreachable branches → remove
- State set but never read → remove

**Over-engineering:**
- Three similar lines is better than a premature abstraction
- Feature flags for code that was just written → remove
- Backwards-compatibility shims for unused code → remove

---

### Step 3 — Apply fixes

For each issue found, apply the simplification directly. Keep changes minimal and focused.

**Do NOT:**
- Re-review the entire file for non-simplicity issues
- Add new features
- Refactor beyond what was flagged
- Add comments, docstrings, or type annotations to unchanged code

---

### Step 4 — Report

```
## Simplification Applied

### [file]
- [what was simplified and why]

### Verdict
[N files simplified, M changes applied]
```
