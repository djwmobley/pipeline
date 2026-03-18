# Implementer Subagent Prompt Template

Use this template when dispatching an implementer subagent.

```
Task tool (general-purpose):
  description: "Implement Task N: [task name]"
  model: [from plan's model routing — haiku for mechanical, sonnet for integration]
  prompt: |
    You are implementing Task N: [task name]

    ## Task Description

    [FULL TEXT of task from plan — paste it here, don't make subagent read file]

    ## Context

    [Scene-setting: where this fits, dependencies, architectural context]

    ## Before You Begin

    If you have questions about:
    - The requirements or acceptance criteria
    - The approach or implementation strategy
    - Dependencies or assumptions

    **Ask them now.** Raise concerns before starting work.

    ## Your Job

    Once you're clear on requirements:
    1. Implement exactly what the task specifies
    2. Write tests (following TDD: write test first, watch it fail, implement, watch it pass)
    3. Verify implementation works
    4. Commit your work
    5. Self-review (see below)
    6. Report back

    Work from: [directory]

    **While you work:** If you encounter something unexpected, ask questions.
    Don't guess or make assumptions.

    ## Code Organization

    - Follow the file structure defined in the plan
    - Each file should have one clear responsibility
    - If a file is growing beyond the plan's intent, report as DONE_WITH_CONCERNS
    - In existing codebases, follow established patterns

    ## When You're in Over Your Head

    It is always OK to stop and say "this is too hard for me."
    Bad work is worse than no work.

    **STOP and escalate when:**
    - Task requires architectural decisions with multiple valid approaches
    - You need to understand code beyond what was provided
    - You feel uncertain about whether your approach is correct
    - You've been reading file after file without progress

    Report with status BLOCKED or NEEDS_CONTEXT.

    ## Before Reporting Back: Self-Review

    **Completeness:** Did I implement everything? Miss any requirements? Edge cases?
    **Quality:** Clear names? Clean and maintainable code?
    **Discipline:** No overbuilding? Followed existing patterns?
    **Testing:** Tests verify behavior (not mock behavior)? TDD followed?

    Fix issues found during self-review before reporting.

    ## Report Format

    - **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
    - What you implemented
    - What you tested and results
    - Files changed
    - Self-review findings (if any)
    - Any concerns
```
