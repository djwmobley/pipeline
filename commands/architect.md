---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: Engineering Architect — technology decisions via recon + parallel domain specialists + synthesis
---

## Pipeline Architect

Produce `docs/architecture.md` — a committed engineering standards document that constrains
downstream planning, implementation, review, and security testing. This is the project's
engineering bible: code patterns, typed contracts, security standards, and banned patterns.

For MEDIUM changes, architecture runs silently inside `/pipeline:plan` (recon only).
This command is for LARGE/MILESTONE changes or initial project setup that need the full
document with parallel domain specialists.

---

### Load config + knowledge context

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.name`, `project.profile`
- `architect.*` (specialists, skip, enforce_in_build)
- `routing.source_dirs`
- `models.cheap`, `models.review`, `models.architecture`
- `review.non_negotiable[]`
- `knowledge.tier`
- `docs.specs_dir`
- `integrations.github.enabled`, `integrations.github.issue_tracking`
- `project.repo` — repo identifier (owner/repo)

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

**Query knowledge tier for prior decisions:**

If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "SELECT topic, decision, reason FROM decisions ORDER BY created_at DESC LIMIT 30"
```

If `knowledge.tier` is `"files"`:
- Read `DECISIONS.md` if it exists

Store results as `KNOWLEDGE_CONTEXT`.

**Spec selection:** If the user specified a spec file, use it. Otherwise, list files in `docs.specs_dir` and use the most recent one. If multiple exist with no clear recency, ask the user which to analyze.

---

### Locate and read the architecture skill

1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/architecture/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/architecture/SKILL.md` to find it

Follow the architecture skill's **Full Mode** process exactly:

---

### Step 1 — Recon

Dispatch recon agent using the skill's `recon-agent-prompt.md` template.

Substitutions:
- `{{MODEL}}` → `models.cheap`
- `[SOURCE_DIRS]` → `routing.source_dirs`
- `[SPEC_SUMMARY]` → 3-5 sentence summary from the spec
- `[KNOWLEDGE_CONTEXT]` → from knowledge tier query above
- `[PROJECT_PROFILE]` → `project.profile`

---

### Step 2 — Select relevant domains

Read the "Relevant Domains" section from recon output. Remove any domains listed in `architect.skip[]`.

If `architect.specialists` is not `"auto"`, use the explicit list instead of recon's recommendation.

**Fallback:** If recon identifies 0-1 relevant domains, report this and offer:
- Run in silent mode (single architect pass) — suitable for most cases
- Proceed with full mode anyway — if the user wants the ceremony

---

### Step 3 — Dispatch domain specialists

Read `domain-definitions.md` from the architecture skill directory.

For each relevant domain, dispatch a specialist using `specialist-agent-prompt.md`.

**Launch ALL specialists in parallel** (same dispatch pattern as red team specialists).

Substitutions per specialist:
- `{{MODEL}}` → `models.review`
- `[DOMAIN_ID]` → domain ID
- `[DOMAIN_NAME]` → full name from domain-definitions.md
- `[DOMAIN_CHECKLIST]` → checklist from domain-definitions.md
- `[RECON_CONSTRAINTS]` → full Constraints Block from recon
- `[SPEC_SUMMARY]` → same spec summary
- `[KNOWLEDGE_CONTEXT]` → from knowledge tier
- `[NON_NEGOTIABLE]` → `review.non_negotiable[]`
- `[SOURCE_DIRS]` → `routing.source_dirs`

---

### Step 4 — Lead architect synthesis

After ALL specialists complete, dispatch the lead architect using `lead-architect-prompt.md`.

Substitutions:
- `{{MODEL}}` → `models.architecture`
- `[SPECIALIST_OUTPUTS]` → full output from all specialists (paste all)
- `[RECON_CONSTRAINTS]` → full Constraints Block
- `[SPEC_SUMMARY]` → same spec summary
- `[KNOWLEDGE_CONTEXT]` → from knowledge tier
- `[NON_NEGOTIABLE]` → `review.non_negotiable[]`
- `[RELEVANT_DOMAINS]` → comma-separated list of domains analyzed
- `[PROJECT_PROFILE]` → `project.profile`

---

### Step 5 — Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Same as build command — locate pipeline plugin's `scripts/` directory.

**Postgres tier:** For each decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision "$(cat <<'TOPIC'
arch-[feature]-[domain]
TOPIC
)" "$(cat <<'SUMMARY'
[date]: [decision title]
SUMMARY
)" "$(cat <<'DETAIL'
[full decision text + rationale]
DETAIL
)"
```

**Files tier:** Append locked (HIGH confidence) decisions to `DECISIONS.md`.

---

### Step 6 — Save artifact

Save to `docs/architecture.md` at the project root. The format is defined in the architecture
SKILL.md Full Mode output section.

**If `docs/architecture.md` already exists, merge:**

1. Match existing decisions by domain and technology area — if the new run covers the
   same domain, the new decision wins; annotate with `**Updated:** [date]`
2. Existing decisions whose domain is NOT in the domains analyzed this run are kept unchanged
3. New decisions are appended, numbered sequentially after the last existing number
4. Sections (Project Structure, Code Patterns, Security Standards, Testing Standards, Banned
   Patterns) are merged by appending new items that do not already appear verbatim
5. Typed Contracts: new endpoints/interfaces are appended; existing ones with the same
   path or interface name are replaced
6. Regenerate the Constraints Summary from all sections after merging

---

### Step 7 — Present to builder

Show a summary:

```
## Architecture — [Project Name]

| # | Domain | Decision | Confidence |
|---|--------|----------|------------|
| DECISION-001 | DATA | Use Drizzle ORM | HIGH |
| DECISION-002 | API | Zod validation on all endpoints | HIGH |
| DECISION-003 | STATE | Server components + React Query | MEDIUM |

[N] decisions across [M] domains. [K] require your review (LOW confidence).
[P] typed contracts. [Q] security rules. [R] banned patterns.

Saved to: docs/architecture.md

What next?
a) Proceed to planning  (/pipeline:plan — architecture.md consumed as constraints)
b) Review/override decisions  (I'll walk you through LOW confidence items)
c) Re-run with different domains  (add/remove from analysis)
```

If the builder chooses to override, apply the override annotation to `docs/architecture.md`
and update knowledge tier.

---

### Decision Tracking

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

1. Find epic number from the spec file (`github_epic: N`).
2. Comment on the epic with the decisions summary table:
   ```bash
   cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
   ## Architectural Decisions

   | # | Domain | Decision | Confidence |
   |---|--------|----------|------------|
   [table rows from decisions]

   Architecture saved to `docs/architecture.md`
   EOF
   ```
   If the command fails, notify the user with the error and ask for guidance.
3. For each LOW-confidence decision, create a child issue:
   ```bash
   cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue create --title '[DECISION-NNN]: [title] (needs review)' --labels 'pipeline:decision' --stdin
   ## Architectural Decision — Needs Review

   **Domain:** [domain]
   **Decision:** [text]
   **Confidence:** LOW
   **Trade-offs:** [rationale]

   Linked to: #[EPIC_N]
   EOF
   ```
   If the command fails, notify the user with the error and ask for guidance.
4. If no epic found in spec: skip linking.

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml:

Locate and read the dashboard skill, then regenerate `docs/dashboard.html`.

---

### Orchestrator

Record step completion with `docs/architecture.md` as the output artifact:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete architect PASS 'docs/architecture.md'
```

If the architect step was skipped (non-LARGE change), still record a PASS so the orchestrator can advance past this step:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete architect PASS 'skipped'
```

Without this call, the workflow will be stuck waiting for architect to complete — the orchestrator does not auto-skip optional steps whose inputs are met.
