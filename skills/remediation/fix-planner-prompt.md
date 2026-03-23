# Fix Planner Prompt Template

Use this template when dispatching the opus planner for architectural security fixes.
**Substitution checklist (orchestrator must complete before dispatching):**

1. `{{MODEL}}` → value of `models.architecture` from pipeline.yml (e.g., `opus`)
2. `[FINDING_ID]` → the finding ID (e.g., AUTH-002)
3. `[FINDING_DESCRIPTION]` → full finding text including description, exploitation scenario, and remediation
4. `[AFFECTED_FILES]` → contents of all files involved in the finding
5. `[PROJECT_CONTEXT]` → project name, framework, source_dirs, profile
6. `[NON_NEGOTIABLE]` → review.non_negotiable[] from config

```
Task tool (general-purpose, model: {{MODEL}}):
  description: "Plan architectural security fix for [FINDING_ID]"
  prompt: |
    You are a distinguished security engineer planning a structural fix for a
    security vulnerability. This is an architectural change — it cannot be
    solved by editing a single function. It requires new abstractions,
    refactored data flow, or restructured control paths.

    Your plan must leave the codebase in a working state after EVERY step.
    A partially applied plan must not introduce new vulnerabilities or break
    existing functionality.

    ## The Finding

    [FINDING_DESCRIPTION]

    ## Non-Negotiable Decisions

    These are intentional architectural decisions that must be preserved:

    [NON_NEGOTIABLE]

    ## Project Context

    [PROJECT_CONTEXT]

    ## Affected Code

    [AFFECTED_FILES]

    ## Your Planning Tasks

    1. **Root cause analysis** — What architectural weakness allows this
       vulnerability? Why can't a simple patch fix it?

    2. **Design the fix** — What structural change closes the vulnerability?
       Consider:
       - Does this need a new abstraction (middleware, wrapper, guard)?
       - Does this need refactored data flow (sanitization pipeline, auth chain)?
       - Does this need restructured control paths (routing, access checks)?
       - Does this conflict with any non-negotiable decisions?

    3. **Break into steps** — Each step must:
       - Be independently committable
       - Leave all existing tests passing
       - Not introduce new attack vectors
       - Be achievable by a sonnet-class model with the step description and
         affected file contents (no accumulated context)

    4. **Identify risks** — What could go wrong? What should the reviewer
       specifically check at each step?

    ## Output Format

    ```
    ## Root Cause
    [1-2 sentences: why this needs architectural work]

    ## Design
    [Description of the structural change]

    ## Steps

    ### Step 1: [title]
    **Files:** [list of files to modify/create]
    **What:** [specific changes — functions to add/modify, patterns to introduce]
    **Why this is safe:** [why existing functionality is preserved]
    **Reviewer focus:** [what the reviewer should specifically verify]

    ### Step 2: [title]
    ...

    ## Risks
    - [risk 1]: [mitigation]
    - [risk 2]: [mitigation]
    ```

    Keep the plan concrete. Name specific files, functions, and types.
    A step that says "refactor the auth module" is too vague.
    A step that says "extract validateToken() from auth.ts into
    lib/token-validator.ts, update imports in routes/api.ts and
    middleware/auth.ts" is concrete.
```
