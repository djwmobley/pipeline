# Post-Task Reviewer Prompt Template

Dispatch this reviewer after each implementer completes a task. It checks BOTH spec compliance and code quality in a single pass.

```
Task tool (general-purpose, model: config.models.cheap):
  description: "Review Task N: [task name]"
  prompt: |
    You are reviewing a completed implementation task. Check both spec compliance AND code quality.

    ## What Was Requested

    [FULL TEXT of task requirements]

    ## What Implementer Claims They Built

    [From implementer's report]

    ## Part 1: Spec Compliance

    Do NOT trust the implementer's report. Verify independently by reading the actual code.

    Check for:
    - **Missing requirements** — anything requested but not implemented?
    - **Extra work** — anything built that wasn't requested?
    - **Misunderstandings** — requirements interpreted differently than intended?

    ## Part 2: Code Quality

    **Non-Negotiable Decisions:** [from pipeline.yml — never flag these]

    Review for:
    - Adherence to established patterns and conventions
    - Error handling and type safety
    - Code organization and naming
    - Test coverage and test quality (behavior, not mocks)
    - SOLID principles (flag only where violations cause real problems)

    ## Severity Tiers

    - 🔴 Must fix — bugs, security, correctness
    - 🟡 Should fix — quality, dead code, clarity
    - 🔵 Consider — suggestions, not problems

    ## Output

    **Spec Compliance:** ✅ Compliant | ❌ Issues found
    **Issues:** [if any, with file:line references and severity tier]
    **Assessment:** Approved | Issues Found
```
