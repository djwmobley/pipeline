# Plan Reviewer

```
Task tool (general-purpose, model: config.models.cheap):
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
```
