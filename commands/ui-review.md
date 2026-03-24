---
allowed-tools: Bash(*), Read(*), Task(*), mcp__chrome__take_screenshot, mcp__chrome__navigate_page, mcp__chrome__take_snapshot, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_snapshot, mcp__stitch__list_screens, mcp__stitch__get_screen, mcp__stitch__get_project, mcp__figma__get_file_nodes, mcp__figma__get_images
description: Capture a screenshot and analyze the UI — layout, hit targets, text, visual issues
---

## Pipeline UI Review

Capture a browser screenshot and dispatch an analysis agent.

---

### Step 0 — Load config

Read `.claude/pipeline.yml`. Check:
- `integrations.chrome_devtools.enabled` and `integrations.playwright.enabled` (screenshot capture)
- `integrations.stitch.enabled` and `integrations.stitch.project_id` (design mockup comparison)
- `integrations.figma.enabled` (Figma design reference)

---

### Step 1 — Capture screenshot

**Priority order:**

1. **Chrome DevTools MCP** (if `integrations.chrome_devtools.enabled`):
   ```
   mcp__chrome__take_screenshot
   ```
   If app not loaded, navigate first. Check `integrations.chrome_devtools.dev_url` in pipeline.yml for the URL, or ask the user what URL to navigate to:
   ```
   mcp__chrome__navigate_page { url: "[dev_url from config, e.g. http://localhost:5173]" }
   ```

2. **Playwright MCP** (if `integrations.playwright.enabled`):
   ```
   mcp__plugin_playwright_playwright__browser_take_screenshot
   ```

3. **Manual fallback:**
   Ask: "Please take a browser screenshot and provide the file path."
   Then read the file using the Read tool.

---

### Step 1b — Load design reference (optional)

Check if a design tool has mockups to compare against.

**If Stitch is enabled but `integrations.stitch.project_id` is null:**
Skip Stitch comparison. Note: "No Stitch mockups yet for this project. Run `/pipeline:brainstorm` to generate design mockups first."

**If Stitch is enabled and `integrations.stitch.project_id` is set:**
1. Call `mcp__stitch__list_screens` with the project ID
2. If screens exist, present them:
   > "Found [N] Stitch mockups for this project:
   > [list screen names/descriptions]
   > Compare the screenshot against any of these? (Pick one, or skip)"
3. If user picks one, call `mcp__stitch__get_screen` to retrieve it
4. Store the mockup data for use in Step 2's analysis prompt

**If Figma is enabled:**
1. Ask: "Have a Figma file to compare against? Paste the URL, or skip."
2. If provided, use `mcp__figma__get_file_nodes` and `mcp__figma__get_images` to fetch relevant frames
3. Store the exported image for use in Step 2's analysis prompt

**If neither:** Skip — analyze the screenshot standalone (current behavior).

---

### Step 2 — Analyze

Launch a general-purpose sub-agent (model: haiku) to analyze the screenshot.

**If a design reference was loaded in Step 1b**, use the comparison prompt:

```
Task(general-purpose, model: "haiku"):
  "Read the screenshot at [PATH] and the design reference at [REFERENCE].

  Report:

  1. FIDELITY — How closely does the implementation match the design?
     For each difference: what's different, severity (cosmetic/functional/missing).

  2. LAYOUT OVERVIEW — Every visible section top to bottom.
     For each: what's in it, approximate height.

  3. INTERACTIVE ELEMENTS — Every tappable/interactive element.
     For each: label/icon, position, estimated hit target size.
     Flag anything under 44x44px.

  4. TEXT AUDIT — All visible text.
     Flag: truncated, too small (under 12px), low contrast.

  5. VISUAL ISSUES — Any of:
     - Misalignment
     - Inconsistent spacing
     - Elements clipped by viewport
     - Overlapping content
     - Responsive layout problems

  6. VERDICT — One sentence: most important fidelity gap or visual issue to fix."
```

**If no design reference**, use the standalone prompt (omit the FIDELITY section):

```
Task(general-purpose, model: "haiku"):
  "Read the screenshot at [PATH].

  Report:

  1. LAYOUT OVERVIEW — Every visible section top to bottom.
     For each: what's in it, approximate height.

  2. INTERACTIVE ELEMENTS — Every tappable/interactive element.
     For each: label/icon, position, estimated hit target size.
     Flag anything under 44x44px.

  3. TEXT AUDIT — All visible text.
     Flag: truncated, too small (under 12px), low contrast.

  4. VISUAL ISSUES — Any of:
     - Misalignment
     - Inconsistent spacing
     - Elements clipped by viewport
     - Overlapping content
     - Responsive layout problems

  5. VERDICT — One sentence: most important thing to fix."
```

Report the agent's full analysis back to the user.

---

### Step 3 — Persist findings

If the analysis found issues (hit targets flagged, text issues, visual issues, or fidelity gaps), write to `docs/findings/ui-review-YYYY-MM-DD.md`:

```bash
mkdir -p docs/findings
```

```markdown
# UI Review Findings — [date]

**Source:** ui-review
**Screenshot:** [path to screenshot]
**Design reference:** [path or "none"]

[full analysis output — all sections]
```

Then: "Run `/pipeline:remediate --source ui-review` to fix, or address manually."

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.
