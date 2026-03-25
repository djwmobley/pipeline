---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: Security red team assessment — recon + parallel specialist agents + lead analyst synthesis
---

## Pipeline Red Team

Security assessment with parallel domain specialists. Probes your codebase from an attacker's perspective — injection, auth bypass, XSS, data exposure, and more.

**Read-only assessment.** No source code is modified. Findings saved to `docs/findings/`.

---

### Step 0 — Load config + knowledge context

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.name`, `project.profile`
- `redteam.*` (mode, url, specialists, skip, html_report, recon_patterns)
- `routing.source_dirs`
- `models.cheap`, `models.review`, `models.architecture`
- `security[]`
- `review.non_negotiable[]`
- `knowledge.tier`
- `integrations.github.enabled`, `integrations.github.issue_tracking`
- `project.repo` — GitHub repo (owner/repo)

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

**source_dirs shell safety:** Validate each `routing.source_dirs` entry matches `[a-zA-Z0-9/_.-]+` only. If any entry contains shell metacharacters, reject it and stop.

**Query knowledge tier for security context:**

If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:

```bash
node scripts/pipeline-db.js query "SELECT topic, decision, reason FROM decisions WHERE topic ILIKE '%security%' OR topic ILIKE '%auth%' OR topic ILIKE '%encrypt%' OR topic ILIKE '%token%' OR topic ILIKE '%session%' ORDER BY created_at DESC LIMIT 20"
```

```bash
node scripts/pipeline-db.js query "SELECT issue, rule FROM gotchas WHERE issue ILIKE '%security%' OR issue ILIKE '%auth%' OR issue ILIKE '%vuln%' OR issue ILIKE '%inject%' OR issue ILIKE '%xss%' ORDER BY created_at DESC LIMIT 20"
```

If `integrations.ollama.enabled`:
```bash
node scripts/pipeline-embed.js hybrid "security vulnerabilities authentication authorization injection"
```

Store results as `KNOWLEDGE_CONTEXT` — feed to recon agent and specialists.

If `knowledge.tier` is `"files"`:
- Check `DECISIONS.md` for security-related entries (grep for "security", "auth", "token", "session")
- Check `docs/gotchas.md` for security-related entries

---

### Step 1 — Sell the assessment

Before spending tokens, present the value proposition. First, determine the specialist count using Step 3 logic (profile + framework detection) to calculate the estimate accurately.

Run the framework detection script (same as `commands/update.md` Route: sectors, Step 1):

```bash
echo "=== FRAMEWORK DETECTION ==="
for f in next.config.js next.config.ts next.config.mjs; do test -f "$f" && echo "FRAMEWORK: nextjs"; done
for f in nuxt.config.ts nuxt.config.js; do test -f "$f" && echo "FRAMEWORK: nuxt"; done
for f in svelte.config.js svelte.config.ts; do test -f "$f" && echo "FRAMEWORK: sveltekit"; done
for f in remix.config.js remix.config.ts; do test -f "$f" && echo "FRAMEWORK: remix"; done
for f in astro.config.mjs astro.config.ts; do test -f "$f" && echo "FRAMEWORK: astro"; done
test -f angular.json && echo "FRAMEWORK: angular"
test -f capacitor.config.ts -o -f capacitor.config.json && echo "FRAMEWORK: capacitor"
test -f package.json && grep -q '"expo"' package.json 2>/dev/null && echo "FRAMEWORK: expo"
test -f package.json && grep -q '"react-native"' package.json 2>/dev/null && echo "FRAMEWORK: react-native"
test -f package.json && grep -q '"express"' package.json 2>/dev/null && echo "FRAMEWORK: express"
test -f package.json && grep -q '"fastify"' package.json 2>/dev/null && echo "FRAMEWORK: fastify"
test -f package.json && grep -q '"hono"' package.json 2>/dev/null && echo "FRAMEWORK: hono"
test -f package.json && grep -q '"koa"' package.json 2>/dev/null && echo "FRAMEWORK: koa"
test -f package.json && grep -q '"@ionic"' package.json 2>/dev/null && echo "FRAMEWORK: ionic"
test -f ionic.config.json && echo "FRAMEWORK: ionic"
# React + Vite (not a meta-framework)
test -f package.json && grep -q '"react"' package.json 2>/dev/null && grep -q '"vite"' package.json 2>/dev/null && ! grep -q '"next"' package.json 2>/dev/null && ! grep -q '"remix"' package.json 2>/dev/null && ! grep -q '"astro"' package.json 2>/dev/null && echo "FRAMEWORK: react-vite"
# Vue + Vite (not Nuxt)
test -f package.json && grep -q '"vue"' package.json 2>/dev/null && grep -q '"vite"' package.json 2>/dev/null && ! grep -q '"nuxt"' package.json 2>/dev/null && echo "FRAMEWORK: vue-vite"
test -f manage.py && echo "FRAMEWORK: django"
test -f package.json 2>/dev/null || {
  grep -q "fastapi" requirements.txt pyproject.toml 2>/dev/null && echo "FRAMEWORK: fastapi"
  grep -q "flask" requirements.txt pyproject.toml 2>/dev/null && echo "FRAMEWORK: flask"
}
test -f artisan && echo "FRAMEWORK: laravel"
test -f Gemfile && grep -q "rails" Gemfile 2>/dev/null && echo "FRAMEWORK: rails"
test -f go.mod && {
  grep -q "echo" go.mod 2>/dev/null && echo "FRAMEWORK: echo"
  grep -q "gin" go.mod 2>/dev/null && echo "FRAMEWORK: gin"
  grep -q "fiber" go.mod 2>/dev/null && echo "FRAMEWORK: fiber"
  test -d cmd && echo "FRAMEWORK: go-cli"
}
test -f Cargo.toml && {
  grep -q "axum" Cargo.toml 2>/dev/null && echo "FRAMEWORK: axum"
  grep -q "actix" Cargo.toml 2>/dev/null && echo "FRAMEWORK: actix"
  grep -q "clap" Cargo.toml 2>/dev/null && echo "FRAMEWORK: clap-cli"
}
test -f pom.xml && grep -q "spring" pom.xml 2>/dev/null && echo "FRAMEWORK: spring"
test -f build.gradle && grep -q "spring" build.gradle 2>/dev/null && echo "FRAMEWORK: spring"
test -f build.gradle.kts && grep -q "ktor" build.gradle.kts 2>/dev/null && echo "FRAMEWORK: ktor"
test -f firebase.json && echo "FRAMEWORK: firebase"
test -f package.json && grep -q '"firebase"' package.json 2>/dev/null && echo "FRAMEWORK: firebase"
test -f pubspec.yaml && grep -q "flutter" pubspec.yaml 2>/dev/null && echo "FRAMEWORK: flutter"
echo "=== DONE ==="
```

Store the detected framework as `DETECTED_FRAMEWORK`.

**Framework label → checklist mapping:**

| Detection Label | Checklist Heading |
|---|---|
| nextjs | Next.js |
| nuxt | Nuxt |
| sveltekit | SvelteKit |
| remix | Remix |
| astro | Astro |
| angular | Angular |
| react-vite | React + Vite |
| vue-vite | Vue + Vite |
| react-native | React Native / Expo |
| expo | React Native / Expo |
| capacitor | Capacitor / Ionic |
| ionic | Capacitor / Ionic |
| flutter | Flutter |
| express | Express |
| fastify | Fastify |
| hono | Hono |
| koa | Koa |
| django | Django |
| fastapi | FastAPI |
| flask | Flask |
| laravel | Laravel |
| rails | Rails |
| echo | Echo / Gin / Fiber (Go) |
| gin | Echo / Gin / Fiber (Go) |
| fiber | Echo / Gin / Fiber (Go) |
| axum | Axum / Actix (Rust) |
| actix | Axum / Actix (Rust) |
| spring | Spring Boot |
| ktor | Ktor |
| firebase | Firebase |
| go-cli | *(no framework checklist — use generic domain checklist)* |
| clap-cli | *(no framework checklist — use generic domain checklist)* |

Use this table to look up the correct section heading when extracting framework-specific checklists from `skills/redteam/framework-checklists.md`.

Now determine specialist count using the profile-based selection table (Step 3) and `redteam.skip`.

Present:

```
## Security Assessment

**What this does:** Launches parallel security specialists that probe your codebase
from an attacker's perspective — injection, auth bypass, XSS, data exposure, and more.
Each specialist gets framework-specific checklists for [DETECTED_FRAMEWORK].

**When to run:**
- Before first beta deployment
- Before production launch
- After adding auth, payments, or user data handling
- After a major dependency upgrade

**Token estimate:** ~[N]K tokens ([M] specialists × ~20K each + ~8K recon + ~25K synthesis[+ ~7K HTML report])
**Mode:** [redteam.mode from config]
**Framework:** [DETECTED_FRAMEWORK or "generic"]
**Specialists:** [list of specialist IDs and names]
[If knowledge context found: "**Prior context:** [N] security decisions, [M] gotchas loaded"]

Proceed? (Y/n)
```

If user declines, stop.

---

### Step 2 — Recon (haiku)

**If mode is `black-box`:** Skip the full recon agent. Instead, set `ATTACK_SURFACE_MAP` to a minimal map containing only:
- The target URL from `redteam.url`
- Knowledge context from Step 0
- Note: "Black-box mode — attack surface inferred from framework profile, not source code"

Specialists in black-box mode will probe the running application rather than read source.

**If mode is `white-box` (default):**

Read the recon prompt template from `skills/redteam/recon-agent-prompt.md` (locate via the plugin's skill directory).

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.cheap` from config
2. `[RECON_PATTERNS]` → all entries from `redteam.recon_patterns[]`
3. `[SOURCE_DIRS]` → `routing.source_dirs` from config
4. `[DETECTED_FRAMEWORK]` → framework detected in Step 1
5. `[KNOWLEDGE_CONTEXT]` → security decisions/gotchas from Step 0 (or "None" if empty)

Dispatch the recon agent. Store its output as `ATTACK_SURFACE_MAP`.

---

### Step 3 — Select specialists

**Profile-based baseline** (when `redteam.specialists` is `"auto"`):

| Profile | Specialists |
|---------|------------|
| spa | INJ, AUTH, XSS, CSRF, CONFIG, DEPS, ACL, DATA |
| fullstack | INJ, AUTH, XSS, CSRF, CRYPTO, CONFIG, DEPS, ACL, RATE, DATA |
| mobile | INJ, AUTH, CRYPTO, CONFIG, DEPS, ACL, DATA, CERT |
| mobile-web | INJ, AUTH, XSS, CSRF, CRYPTO, CONFIG, DEPS, ACL, DATA, CERT |
| api | INJ, AUTH, CRYPTO, CONFIG, DEPS, ACL, RATE, DATA |
| cli | INJ, CONFIG, DEPS, FILE, ACL |
| library | INJ, DEPS, FILE, DATA |

If `redteam.specialists` is an explicit list (e.g., `[INJ, AUTH, XSS]`), use that instead.

Remove any IDs listed in `redteam.skip[]`.

Read framework-specific checklists from `skills/redteam/framework-checklists.md`. For each selected specialist, extract the checklist matching `DETECTED_FRAMEWORK` + specialist domain. If no framework-specific checklist exists, use the generic domain checklist from `skills/redteam/specialist-domains.md`.

Show the final specialist list:

```
## Specialists Selected ([DETECTED_FRAMEWORK] [profile])

| ID | Domain | Framework Focus |
|---|---|---|
| [ID] | [Name] | [1-line framework-specific focus] |
| ... | ... | ... |

Launch [N] specialists? (Y/n)
```

If user declines, stop.

---

### Step 4 — Launch specialists (parallel, sonnet)

Read the specialist prompt template from `skills/redteam/specialist-agent-prompt.md`.

For each selected specialist, dispatch a subagent:

**Substitution checklist (per specialist):**
1. `{{MODEL}}` → value of `models.review` from config
2. `[DOMAIN_ID]` → specialist ID (e.g., `INJ`)
3. `[DOMAIN_NAME]` → specialist full name (e.g., `Injection`)
4. `[DOMAIN_CHECKLIST]` → from `specialist-domains.md`
5. `[FRAMEWORK_CHECKLIST]` → framework-specific checklist for this domain (from `framework-checklists.md`)
6. `[RECON_HITS]` → relevant entries from `ATTACK_SURFACE_MAP` filtered by domain
7. `[SECURITY_CHECKLIST]` → `security[]` entries from config
8. `[NON_NEGOTIABLE]` → `review.non_negotiable[]` from config
9. `[KNOWLEDGE_CONTEXT]` → security decisions/gotchas from Step 0
10. `[MODE]` → `redteam.mode` from config
11. `[URL]` → `redteam.url` from config (for black-box mode)
12. `[SOURCE_DIRS]` → `routing.source_dirs` from config
13. `[SECURITY_AUDIT_CMD]` → `commands.security_audit` from config (or `"null"` if not configured)

Launch **all specialists in parallel** using the Agent tool. Each agent gets `description: "Red Team Specialist [DOMAIN_ID]: [DOMAIN_NAME]"`.

---

### Step 5 — Collect reports

Wait for all specialist agents to complete. Each returns structured findings:

```
FINDING [DOMAIN_ID]-[NNN] | [CRITICAL/HIGH/MEDIUM/LOW/INFO] | [HIGH/MEDIUM/LOW] | [file:line or URL:path] | [CWE-ID]
[Description + exploitation scenario + remediation]
```

Collect all specialist outputs into `SPECIALIST_REPORTS`.

If any specialist failed or returned empty, note it but continue with available reports.

---

### Step 6 — Lead analyst synthesis (opus)

Read the lead analyst prompt template from `skills/redteam/lead-analyst-prompt.md`.

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.architecture` from config
2. `[SPECIALIST_REPORTS]` → all collected specialist outputs
3. `[PROJECT_NAME]` → `project.name` from config
4. `[NON_NEGOTIABLE]` → `review.non_negotiable[]` from config
5. `[KNOWLEDGE_CONTEXT]` → security decisions/gotchas from Step 0

Dispatch the lead analyst agent. Store its output as `FINAL_REPORT`.

---

### Step 7 — Present report

Create the output directory if needed:
```bash
mkdir -p docs/findings
```

Format the lead analyst's output into the final markdown report. Save to `docs/findings/redteam-[YYYY-MM-DD].md`.

Present the executive summary, risk matrix, and critical/high findings to the user inline. Full report is in the file.

---

### Step 8 — HTML report artifact

If `redteam.html_report` is true (default):

Read the HTML report prompt template from `skills/redteam/html-report-prompt.md`.

**Substitution checklist:**
1. `{{MODEL}}` → value of `models.cheap` from config
2. `[MARKDOWN_REPORT]` → the complete markdown report from Step 7
3. `[PROJECT_NAME]` → `project.name` from config
4. `[DATE]` → today's date
5. `[SPECIALIST_COUNT]` → number of specialists run

Dispatch haiku agent to generate a self-contained HTML file. Save to `docs/findings/redteam-[YYYY-MM-DD].html`.

Report: "HTML report saved to `docs/findings/redteam-[date].html` — open in any browser to share with stakeholders."

---

### Step 9 — Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

Store the resolved absolute path. Use `PROJECT_ROOT=$(pwd) node [scripts_dir]/...` for all commands below.

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Record the session:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update session [next_session_number] 0 "$(cat <<'EOF'
Red team assessment: [N] findings ([C] critical, [H] high, [M] medium, [L] low)
EOF
)"
```

For each CRITICAL or HIGH finding, store as a gotcha:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update gotcha new "$(cat <<'TITLE'
[finding ID]: [brief summary]
TITLE
)" "$(cat <<'RULE'
[remediation action]
RULE
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'security-assessment' "$(cat <<'SUMMARY'
Red team [date]: [overall verdict]
SUMMARY
)" "$(cat <<'DETAIL'
[summary of security posture and key risks]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:**

Record session (auto-rotates to keep 5 most recent):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js session [next_session_number] 0 "$(cat <<'EOF'
Red team assessment: [N] findings ([C] critical, [H] high, [M] medium, [L] low)
EOF
)"
```

For each CRITICAL or HIGH finding only, store as a gotcha:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js gotcha "$(cat <<'TITLE'
[finding ID]: [brief summary]
TITLE
)" "$(cat <<'RULE'
[remediation action]
RULE
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js decision 'security-assessment' "$(cat <<'SUMMARY'
Red team [date]: [overall verdict]
SUMMARY
)" "$(cat <<'DETAIL'
[summary of security posture and key risks]
DETAIL
)"
```

Prune stale decisions:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js prune
```

---

### GitHub Security Tracking

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

Find the epic number: check the most recent spec or plan file for `github_epic: N`.

1. For each CRITICAL or HIGH finding, check for existing issue first:
   ```bash
   gh issue list --repo '[project.repo]' --search '[FINDING_ID] in:title' --state open --json number --limit 1
   ```
   If an issue already exists for this finding ID, skip creation. Otherwise:
   ```bash
   gh issue create --repo '[project.repo]' \
     --title "$(cat <<'TITLE'
   [FINDING_ID]: [brief summary]
   TITLE
   )" \
     --body "$(cat <<'EOF'
   ## Security Finding

   **Severity:** [CRITICAL/HIGH]
   **Confidence:** [HIGH/MEDIUM]
   **Location:** [file:line or URL:path]
   **CWE:** [CWE-ID]
   **Domain:** [specialist domain]

   [description + exploitation scenario + remediation]

   Linked to: #[EPIC_N]
   EOF
   )" \
     --label "redteam" --label "[severity]"
   ```
2. Comment the summary on the epic:
   ```bash
   gh issue comment [N] --repo '[project.repo]' --body "$(cat <<'EOF'
   ## Red Team Assessment Complete

   **Findings:** [C] critical, [H] high, [M] medium, [L] low
   **Report:** `[report file path]`
   EOF
   )"
   ```

MEDIUM and LOW findings do NOT get issues — they stay in `docs/findings/` only.

If no epic found: skip — red team works without GitHub tracking.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### Report format

The final markdown report follows this structure:

```markdown
# Red Team Assessment — [project name]

**Date:** [date] | **Mode:** [white-box/black-box] | **Framework:** [detected] | **Specialists:** [count]

## Executive Summary
[2-3 sentences: overall security posture, critical count, top risk]

## Risk Matrix
| Impact \ Likelihood | Likely | Possible | Unlikely |
|---------------------|--------|----------|----------|
| Critical            |        |          |          |
| High                |        |          |          |
| Medium              |        |          |          |
| Low                 |        |          |          |

## Critical & High Findings
[Each finding with: ID, severity, confidence, location, CWE, description, exploitation scenario, remediation]

## Medium & Low Findings
[Same format, less detail on exploitation scenarios]

## Informational
[INFO-level findings — observations and hardening suggestions]

## Exploit Chains
[Multi-step attack paths combining findings from different specialists]

## Remediation Roadmap

### Quick wins (< 1 hour each)
- [list with finding IDs]

### Medium effort (1-4 hours)
- [list with finding IDs]

### Architectural changes
- [list with finding IDs]

## Assessment Metadata
- **Specialists:** [list with IDs and names]
- **Framework:** [detected framework]
- **Mode:** [white-box/black-box]
- **Knowledge context:** [N decisions, M gotchas loaded]
- **Total findings:** [N] ([C] critical, [H] high, [M] medium, [L] low, [I] info)
- **Token usage:** ~[N]K estimated
```

End with: "Run `/pipeline:remediate --source redteam` to batch-fix findings, or `/pipeline:remediate` to auto-detect the latest report."
