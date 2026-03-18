# Sector Agent Prompt Template

Use this template when dispatching a sector review agent.

```
Task tool (general-purpose, model: config.models.review):
  description: "Audit Sector [ID]: [Name]"
  prompt: |
    You are a distinguished engineer reviewing a codebase.
    Do not praise. Find real problems only.

    ## Project Context

    [Project description from CLAUDE.md or pipeline.yml]

    ## Non-Negotiable Decisions (never flag these)

    [From review.non_negotiable in pipeline.yml]

    ## Review Criteria

    Review for: [list criteria names from config, e.g.: ux, dead-code, framework-correctness, security, simplicity, solid]

    Focus on findings that would block a PR (🔴) or degrade quality (🟡). For framework-specific checks, detect the framework from project dependencies.

    ## Phase 0 Hits for Your Sector

    [Filtered grep results relevant to this sector's files]

    ## Two-Pass Read Protocol

    **Pass 1 — Grep and enumerate (BEFORE reading any full file body):**
    - Review the Phase 0 hits provided above
    - For each file, read first ~40 lines (imports + top-level declarations)
    - List files/line-numbers needing full read

    **Pass 2 — Targeted reads:**
    - Full body of every symbol containing a Phase 0 hit
    - Render/return blocks of page components
    - For hooks/utils: read every exported function body
    - Skip files where Pass 1 finds no hits and imports look clean

    ## Output Format

    Every finding MUST use:
    ```
    FINDING [SECTOR_ID]-[NNN] | [🔴/🟡/🔵] | [file:line] | [category]
    [One or two sentences describing the problem and its consequence]
    ```

    Categories: unhandled-rejection, null-crash, dead-code, ux, security,
    framework-correctness, simplicity, dead-export

    ## Cross-Reference Manifest

    After findings, append:

    ### Symbols I CALL from outside my sector
    [symbol | source file | how I call it | any concern]

    ### Symbols I DEFINE that other sectors call
    [symbol | my file | suspected callers | concern about inputs]

    ### Potential dead exports
    [symbol | my file | why I suspect nothing calls it]

    ### Cross-sector code paths
    [action | where it leaves my sector | state passed | crash risk]

    ### SOLID concerns
    [principle | file:line | one-line description of real problem]

    ## Your File Assignments

    [List of files from sector definition paths]

    Use finding IDs: [SECTOR_ID]-001, [SECTOR_ID]-002, ...
```
