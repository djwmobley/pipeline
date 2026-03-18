# Plan Reviewer

**Substitution checklist (orchestrator must complete before dispatching):**

1. `{{MODEL}}` → value of `models.cheap` from pipeline.yml (e.g., `haiku`)
2. `[PLAN_FILE_PATH]` → actual path. **Paste the full plan content below the prompt** — do not make the subagent read the file.
3. `[SPEC_FILE_PATH]` → actual path. **Paste the full spec content below the prompt** — do not make the subagent read the file.

```
Task tool (general-purpose, model: {{MODEL}}):
  description: "Review plan document"
  prompt: |
    You are a plan document reviewer. Verify this plan is complete and ready for implementation.

    **Plan to review:** [PLAN_FILE_PATH]
    **Spec for reference:** [SPEC_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, incomplete tasks |
    | Spec Alignment | Plan covers spec requirements, no major scope creep |
    | Task Decomposition | Clear boundaries, actionable steps |
    | Buildability | Could an engineer follow this without getting stuck? |
    | Build Sequence | Dependencies correctly ordered |
    | Model Routing | Tasks assigned appropriate complexity |

    Only flag issues that would cause real problems during implementation. Approve unless there are serious gaps.

    ## Output

    **Status:** Approved | Issues Found
    **Issues (if any):** [Task X, Step Y]: [issue] - [why it matters]
    **Recommendations (advisory):** [suggestions]

## Plan Content
[PASTE FULL PLAN CONTENT HERE]

## Spec Content
[PASTE FULL SPEC CONTENT HERE]
```
