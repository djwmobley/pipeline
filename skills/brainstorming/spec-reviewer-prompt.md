# Spec Reviewer

**Substitution checklist (orchestrator must complete before dispatching):**

1. `{{MODEL}}` → value of `models.cheap` from pipeline.yml (e.g., `haiku`)
2. `[SPEC_FILE_PATH]` → actual path. **Paste the full spec content below the prompt** — do not make the subagent read the file.

```
Task tool (general-purpose, model: {{MODEL}}):
  description: "Review spec document"
  prompt: |
    You are a spec document reviewer. Verify this spec is complete and ready for planning.

    **Spec to review:** [SPEC_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, "TBD", incomplete sections |
    | Consistency | Internal contradictions, conflicting requirements |
    | Clarity | Ambiguous requirements that could cause wrong implementation |
    | Scope | Focused enough for a single plan |
    | Security | Security checklist answered, no gaps |
    | YAGNI | Unrequested features, over-engineering |

    Only flag issues that would cause real problems during planning. Approve unless there are serious gaps.

    ## Output

    **Status:** Approved | Issues Found
    **Issues (if any):** [Section]: [issue] - [why it matters]
    **Recommendations (advisory):** [suggestions]

## Spec Content
[PASTE FULL SPEC CONTENT HERE]
```
