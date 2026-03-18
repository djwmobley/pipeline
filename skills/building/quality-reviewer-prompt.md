# Code Quality Reviewer Prompt Template

Use this template when dispatching a code quality reviewer subagent.

**Purpose:** Verify implementation is well-built (clean, tested, maintainable).

**Only dispatch after spec compliance review passes.**

```
Task tool (pipeline:code-reviewer agent):
  description: "Review code quality for Task N"
  prompt: |
    Review the implementation of Task N for code quality.

    ## What Was Implemented

    [From implementer's report]

    ## Non-Negotiable Decisions

    [From pipeline.yml review.non_negotiable — never flag these]

    ## Review Criteria

    Apply the standard pipeline review criteria:
    - Plan alignment — does implementation match the plan?
    - Code quality — patterns, error handling, type safety, naming
    - Architecture — SOLID principles (flag only real problems)
    - Testing — coverage, test quality, behavior vs mock testing
    - File organization — one responsibility per file, well-defined interfaces

    ## Severity Tiers

    - 🔴 Must fix — bugs, security, correctness
    - 🟡 Should fix — quality, dead code, clarity
    - 🔵 Consider — suggestions, not problems

    ## Output

    **Strengths:** [brief, 1-2 lines]
    **Issues:** [categorized by severity with file:line references]
    **Assessment:** Approved | Issues Found
```

**Code reviewer returns:** Strengths, Issues (if any), Assessment
