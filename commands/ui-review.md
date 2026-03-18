---
allowed-tools: Bash(*), Read(*), Task(*), mcp__chrome__take_screenshot, mcp__chrome__navigate_page, mcp__chrome__take_snapshot, mcp__plugin_playwright_playwright__browser_take_screenshot, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_snapshot
description: Capture a screenshot and analyze the UI — layout, hit targets, text, visual issues
---

## Pipeline UI Review

Capture a browser screenshot and dispatch an analysis agent.

---

### Step 0 — Load config

Read `.claude/pipeline.yml`. Check `integrations.chrome_devtools` and `integrations.playwright`.

---

### Step 1 — Capture screenshot

**Priority order:**

1. **Chrome DevTools MCP** (if `integrations.chrome_devtools.enabled`):
   ```
   mcp__chrome__take_screenshot
   ```
   If app not loaded, navigate first:
   ```
   mcp__chrome__navigate_page { url: "http://localhost:5173" }
   ```

2. **Playwright MCP** (if `integrations.playwright.enabled`):
   ```
   mcp__plugin_playwright_playwright__browser_take_screenshot
   ```

3. **Manual fallback:**
   Ask: "Please take a browser screenshot and provide the file path."
   Then read the file using the Read tool.

---

### Step 2 — Analyze

Launch a general-purpose sub-agent (model: haiku) to analyze the screenshot:

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
