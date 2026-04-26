---
name: verification
description: Evidence before claims — run verification commands and confirm output before making any success claims
operation_class: haiku_judgment
allowed_models: []
allowed_direct_write: false
---

# Verification Before Completion

## Overview

Claiming work is complete without verification is dishonesty, not efficiency.

**Core principle:** Evidence before claims, always.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Agent completed | VCS diff shows changes | Agent reports "success" |

## Red Flags — STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- ANY wording implying success without running verification

## When To Apply

**ALWAYS before:**
- ANY success/completion claims
- Committing, PR creation, task completion
- Moving to next task
- Delegating to agents

## Confidence Levels for Verification Evidence

Verification evidence MUST include a confidence level:
- **HIGH** — "Tests pass" (for tested behavior), "Build succeeds with exit 0"
- **MEDIUM** — "Looks correct in code review", "Manual spot-check confirms"
- **LOW** — "Should work based on the change" — this is NOT verification. It is speculation. Do not claim completion based on LOW confidence evidence.

**The Bottom Line:** Run the command. Read the output. THEN claim the result. Non-negotiable.
