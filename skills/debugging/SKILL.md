---
name: debugging
description: Systematic root-cause diagnosis — 4 mandatory phases, error class routing, no speculative fixes
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## The Four Phases

Complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully** — don't skip past errors. Read stack traces completely.
   Note line numbers, file paths, error codes.

2. **Reproduce Consistently** — can you trigger it reliably? What are the exact steps?
   If not reproducible → gather more data, don't guess.

3. **Check Recent Changes** — git diff, recent commits, new dependencies, config changes.

4. **Gather Evidence in Multi-Component Systems** — add diagnostic instrumentation at
   each component boundary. Run once to gather evidence showing WHERE it breaks.
   THEN investigate that specific component.

5. **Trace Data Flow** — where does the bad value originate? What called this with the
   bad value? Keep tracing up until you find the source. Fix at source, not at symptom.
   See `root-cause-tracing.md` in this skill's directory for the complete technique.

### Phase 2: Pattern Analysis

1. **Find Working Examples** — locate similar working code in the same codebase.
2. **Compare Against References** — read reference implementations COMPLETELY.
3. **Identify Differences** — list every difference, however small.
4. **Understand Dependencies** — what other components, settings, environment needed?

### Phase 3: Hypothesis and Testing

1. **Form Single Hypothesis** — "I think X is the root cause because Y." Be specific.
   Rate each hypothesis **HIGH / MEDIUM / LOW** confidence before testing. Test the highest-confidence hypothesis first.
2. **Test Minimally** — smallest possible change, one variable at a time.
3. **Verify Before Continuing** — worked → Phase 4. Didn't work → NEW hypothesis.
   DON'T add more fixes on top. After testing, update confidence. A disproven hypothesis drops to **REJECTED**.

### Phase 4: Implementation

1. **Create Failing Test Case** — simplest reproduction. Follow TDD.
2. **Implement Single Fix** — ONE change. No "while I'm here" improvements.
3. **Verify Fix** — test passes, no regressions, issue resolved.
4. **If Fix Doesn't Work:**
   - Count fixes attempted
   - If < 3: return to Phase 1 with new information
   - **If ≥ 3: STOP and question architecture**
   - Don't attempt Fix #4 without architectural discussion

5. **If 3+ Fixes Failed: Question Architecture**
   - Is this pattern fundamentally sound?
   - Should we refactor vs continue fixing symptoms?
   - Discuss with user before attempting more fixes

## Red Flags — STOP and Follow Process

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- Proposing solutions before tracing data flow
- "One more fix attempt" (when already tried 2+)
- Each fix reveals new problem in different place
- Implementing a fix based on a LOW confidence hypothesis without testing it first

**ALL mean: STOP. Return to Phase 1.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple" | Simple issues have root causes too |
| "Emergency, no time" | Systematic is FASTER than thrashing |
| "Just try this first" | First fix sets the pattern. Do it right. |
| "I see the problem" | Seeing symptoms ≠ understanding root cause |
| "One more fix" (after 2+) | 3+ failures = architectural problem |
