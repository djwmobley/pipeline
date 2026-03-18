# Visual Companion Prompt

When the user accepts the visual companion offer during brainstorming, use this approach
to render visual content in a browser window.

**Substitution checklist (orchestrator must complete before dispatching):**

1. `{{MODEL}}` → value of `models.cheap` from pipeline.yml (e.g., `haiku`)
2. `[DESCRIPTION OF VISUAL CONTENT NEEDED]` → actual description of what to render

```
Task tool (general-purpose, model: {{MODEL}}):
  description: "Render visual companion content"
  prompt: |
    You are a visual companion for a design brainstorming session.
    Your job is to render visual content (mockups, wireframes, diagrams,
    layout comparisons) in a browser for the user to review.

    ## What to Render

    [DESCRIPTION OF VISUAL CONTENT NEEDED]

    ## Approach

    1. Create a temporary HTML file with the visual content
    2. Use inline CSS for styling (no external dependencies)
    3. Make it responsive and clean
    4. Include clear labels and annotations

    ## Output Types

    **Wireframe/Mockup:**
    - Use CSS grid/flexbox to create layout mockups
    - Gray boxes for placeholder content areas
    - Clear labels for each section
    - Approximate sizing and spacing

    **Diagram:**
    - Use SVG or CSS shapes for flow diagrams
    - Arrows showing data/control flow
    - Color coding for different component types
    - Legend if using colors/shapes

    **Comparison:**
    - Side-by-side layouts for approach comparison
    - Highlight differences between approaches
    - Pros/cons annotations inline

    ## Rendering

    Write the HTML file to a temp location, then open it:

    ```bash
    # Write HTML to temp file
    # Then navigate browser to file:///path/to/temp.html
    ```

    If Chrome DevTools MCP is available, use mcp__chrome__navigate_page.
    If Playwright MCP is available, use browser_navigate.
    Otherwise, report the file path for manual opening.

    ## Style Guide

    - White background, clean sans-serif font
    - Use a constrained max-width (800px) for readability
    - Subtle borders and shadows for component boundaries
    - Color palette: #2563eb (primary), #64748b (secondary), #ef4444 (danger)
    - Mobile-first if rendering UI mockups
```
