---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*)
description: Update pipeline config — re-detect integrations, change commands, sectors, knowledge tier, or any setting
---

## Pipeline Update

Modify an existing `.claude/pipeline.yml`. Unlike init (full setup), update targets a specific section
and preserves everything else.

---

### Step 0 — Load existing config

Read `.claude/pipeline.yml` from the project root.

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

Parse the full config into memory — you'll write back the entire file with modifications.

---

### Step 1 — Route by argument

**No arguments** — Show current config summary and ask what to change:

```
## Current Pipeline Config

**Project:** [name] | **Repo:** [repo] | **Branch:** [branch]

**Commands:**
  typecheck: [value or disabled]
  lint:      [value or disabled]
  test:      [value or disabled]

**Knowledge:** [tier]
**Sectors:** [count or "none"]
**Integrations:** [list enabled ones]

What would you like to update?
1. Integrations (re-detect available tools)
2. Commands (test/lint/typecheck)
3. Review sectors
4. Knowledge tier
5. Project info (repo, branch, co-author)
6. Security checklist
7. A specific key (I'll tell you which)
```

Then follow the chosen route below.

---

### Route: `integrations`

Re-run all integration probes (single script to avoid parallel-cancel issues):

```bash
echo "=== ENV VARS ==="
echo "SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN:+SET}"
echo "FIGMA_ACCESS_TOKEN=${FIGMA_ACCESS_TOKEN:+SET}"
echo "POSTHOG_API_KEY=${POSTHOG_API_KEY:+SET}"
echo "GAMMA_API_KEY=${GAMMA_API_KEY:+SET}"
echo "GITHUB_TOKEN=${GITHUB_TOKEN:+SET}"

echo "=== PORT PROBES ==="
curl -s --connect-timeout 2 http://localhost:5432 2>&1 | head -1 || echo "postgres: no"
curl -s --connect-timeout 2 http://localhost:11434/api/tags 2>&1 | head -1 || echo "ollama: no"
curl -s --connect-timeout 2 http://localhost:9222/json/version 2>&1 | head -1 || echo "chrome: no"

echo "=== CLI TOOLS ==="
npx playwright --version 2>/dev/null || echo "playwright: no"
gh --version 2>/dev/null || echo "gh: no"

echo "=== DONE ==="
```

Compare results against current config. Show a diff:

```
## Integration Changes

  sentry:          disabled → enabled (SENTRY_AUTH_TOKEN found)
  chrome_devtools: enabled  → enabled (no change)
  ollama:          disabled → enabled (localhost:11434 responding)
  playwright:      enabled  → enabled (no change)

Apply these changes? (Y/n)
```

Update only the `integrations` section. Preserve all other config.

---

### Route: `commands`

Show current commands and ask what to change:

```
Current commands:
  typecheck: npx tsc --noEmit
  lint:      npx eslint src/
  test:      npx vitest run
  test_verbose: npx vitest run --reporter=verbose

Which command do you want to change? (or "detect" to auto-detect from project files)
```

If "detect": re-run the detection probes from init Step 1 and propose changes.
If a specific command: ask for the new value (or "null" to disable).

Update only the `commands` section.

---

### Route: `sectors`

Show current sectors:

```
Current review sectors:
  A: Auth & Routing — src/auth/**, src/routes/**
  B: Core Features — src/features/**

Options:
1. Auto-generate from current directory structure
2. Add a sector
3. Remove a sector
4. Replace all sectors
```

For auto-generate: scan source directories, propose new sectors, confirm.
For add: ask for name, id, and path globs.
For remove: show list, ask which to remove.

Update only the `review.sectors` section.

---

### Route: `knowledge`

Show current tier and what switching means:

```
Current knowledge tier: files

Switch to Postgres?
  + Semantic search across all past sessions
  + Structured task/decision/gotcha queries
  + File hash cache (skip re-reading unchanged files)
  + Embedding-powered "find related work"
  - Requires PostgreSQL on localhost:5432
  - Optional: Ollama for embeddings

Switch? (y/N)
```

If switching to Postgres: run the same setup as init Step 3 (locate scripts, npm install, setup DB).
If switching to files: create `docs/sessions/`, `docs/gotchas.md` if missing. Warn that Postgres data is preserved but won't be used.

Update only the `knowledge` section.

---

### Route: `project` / `repo` / `branch` / `co_author`

If given with a value (e.g., `/pipeline:update repo owner/repo`), set it directly.
If given without a value, ask for the new value.

Supported direct-set keys:
- `repo <owner/repo>` → `project.repo`
- `branch <name>` → `project.branch`
- `name <name>` → `project.name`
- `co_author <"Name <email>">` → `commit.co_author`
- `push <true/false>` → `commit.push_after_commit`

---

### Route: `security`

Show current security checklist and allow add/remove/edit:

```
Current security checklist:
  1. Database access? → Verify access control
  2. User input? → Sanitize before storage
  3. Network call? → TLS only, AbortController, no embedded secrets

Options:
1. Add a check
2. Remove a check
3. Edit a check
```

---

### Route: specific key

If the user says something like "change the lint error pattern" or "set review_gate_threshold to 5",
identify the YAML key path and update it directly. Confirm the change before writing:

```
Change routing.review_gate_threshold: 3 → 5?
```

---

### Step 2 — Write back

Read the existing `.claude/pipeline.yml` in full. Apply only the targeted changes.
Write the complete file back using the Write tool.

Report what changed:

```
## Config updated

Changed: [section] — [what changed]
Config written to `.claude/pipeline.yml`.
```
