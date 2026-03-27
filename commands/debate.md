---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*), Agent(*)
description: Antagonistic design debate — stress-test a spec with advocate, skeptic, and practitioner agents before planning
---

## Pipeline Debate

Locate and read the debate skill file:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/debate/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/debate/SKILL.md` to find it

### Step 0: Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.specs_dir` — where specs live (default: `docs/specs/`)
- `project.profile` — project profile for agent context
- `project.repo` — repository identifier
- `models.review` — model for debate agents (default: sonnet)
- `knowledge.tier` — `postgres` or `files`
- `integrations.postgres.enabled` — whether postgres is available
- `integrations.github.enabled` — whether GitHub CLI is available
- `integrations.github.issue_tracking` — whether to link issues
- `dashboard.enabled` — whether to regenerate dashboard

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

### Step 1: Find the spec

Check for the spec to debate:
1. If the user specified a path, use that
2. Otherwise, find the most recent file in `docs.specs_dir` (default: `docs/specs/`)
3. Sort by filename (YYYY-MM-DD prefix) and pick the latest

If no spec found, report: "No spec found in `[specs_dir]`. Run `/pipeline:brainstorm` first." and stop.

Read the spec file. Extract its title and full content.

### Step 2: Determine change size

Determine the change size from:
1. Spec metadata if present (YAML frontmatter `change_size:`)
2. Otherwise, heuristic from spec content:
   - Count files-to-create/modify list if present
   - Count components/subsystems described
   - **TINY** (1 file) — do not offer debate, skip with message: "Spec describes a TINY change. Debate not applicable. Proceed to `/pipeline:plan`."
   - **MEDIUM** (2-3 files, 1-2 components)
   - **LARGE** (4+ files, 3+ components)
   - **MILESTONE** (new subsystem, cross-cutting concerns)

If TINY, stop here.

### Step 3: Sell step

Present the sell based on change size.

<!-- checkpoint:MAY debate-medium -->

**For MEDIUM:**

```
## Design Debate (Optional)

Your spec covers a MEDIUM change (2-3 files).

**What it does:** 3 parallel agents — Advocate, Skeptic, and Domain Practitioner — stress-test your spec from first principles. They challenge assumptions, flag scope creep, identify failure modes, and produce design constraints for the plan.

**Cost:** ~15-30K tokens (~$0.05-0.10), 30-60 seconds
**Benefit:** Catches fundamental design flaws that cause full plan rewrites.
**Risk of skipping:** Low for MEDIUM changes. Most MEDIUM plans survive without debate.

Run the debate? (y/N — default: skip for MEDIUM)
```

<!-- checkpoint:SHOULD debate-large -->

**For LARGE or MILESTONE:**

```
## Design Debate (Recommended)

Your spec covers a LARGE change (4+ files / new subsystem).

**What it does:** 3 parallel agents — Advocate, Skeptic, and Domain Practitioner — stress-test your spec from first principles. They challenge assumptions, flag scope creep, identify failure modes, and produce design constraints for the plan.

**Cost:** ~15-30K tokens (~$0.05-0.10), 30-60 seconds
**Benefit:** Catches fundamental design flaws that cause full plan rewrites. In testing, plans written without debate required rewrite 100% of the time for LARGE features.
**Risk of skipping:** High for LARGE+ changes. Complex specs have hidden assumptions that only adversarial challenge surfaces.

Run the debate? (Y/n — default: run for LARGE+)
```

Wait for user response.

- **MEDIUM**: If user says nothing, presses enter, or says "n"/"no"/"skip" — debate is skipped. Only "y"/"yes" runs it.
- **LARGE/MILESTONE**: If user says nothing, presses enter, or says "y"/"yes" — debate runs. Only "n"/"no"/"skip" skips it.

If user declines a LARGE/MILESTONE debate: "Design debate: skipped by user. Proceed to `/pipeline:plan`." and stop.
If user declines a MEDIUM debate (default behavior): "Debate skipped. Proceed to `/pipeline:plan`." and stop. No skip logging needed for MAY checkpoints.

### Step 4: Dispatch agents

Load the three prompt templates from the debate skill directory:
- `advocate-prompt.md`
- `skeptic-prompt.md`
- `practitioner-prompt.md`

For each template, substitute all placeholders per the template's substitution checklist:
1. `{{MODEL}}` -> value of `models.review` from config
2. `[SPEC_TITLE]` -> extracted spec title
3. `[SPEC_CONTENT]` -> full spec content
4. `[PROJECT_PROFILE]` -> `project.profile` from config
5. `[CHANGE_SIZE]` -> determined change size
6. `[REJECTED_ALTERNATIVES]` (all three agents) -> scan the spec and brainstorm output for explicitly rejected alternatives. Look for phrases like "rejected", "ruled out", "decided against", "not using", "considered but". List each as a comma-separated string. If none found, use "None identified."

Dispatch all 3 agents **in parallel**. Each returns a position paper.

### Step 5: Synthesize verdict

Collect all 3 position papers. Synthesize into a structured verdict:

**Disposition** — one of:
- `proceed` — all panelists broadly agree the design is sound
- `proceed-with-constraints` — design is viable but contested points must be resolved
- `rethink` — fundamental assumptions are invalidated

**Points of agreement** — what all 3 panelists endorse. These become hard constraints for the plan.

**Contested points** — where panelists disagree, with each position stated. The plan author must make an explicit choice on each.

**Invalidated assumptions** — things the spec assumed that do not hold, as identified by any panelist.

**Risk register** — failure modes the plan must mitigate. Each entry: risk description, which panelist raised it, likelihood (HIGH/MEDIUM/LOW), required mitigation.

### Step 6: Present verdict

Present the full verdict to the user.

If disposition is `rethink`:
> "The debate panel recommends rethinking this design. Key invalidated assumptions and fundamental concerns are listed above. Consider re-running `/pipeline:brainstorm` with these findings as input constraints."

If disposition is `proceed-with-constraints`:
> "The debate panel recommends proceeding with constraints. The contested points above must be resolved during planning. Proceed to `/pipeline:plan` — the plan will read these constraints from the verdict file."

If disposition is `proceed`:
> "The debate panel endorses this design. Points of agreement above become hard constraints for the plan. Proceed to `/pipeline:plan`."

### Step 7: Save verdict

Save the verdict to `docs/findings/debate-[YYYY-MM-DD]-[topic-slug].md` where:
- `YYYY-MM-DD` is today's date
- `topic-slug` is derived from the spec title (lowercase, hyphens, no special characters)

The verdict file format:

```markdown
# Design Debate Verdict: [Spec Title]

**Date:** [YYYY-MM-DD]
**Spec:** [path to spec file]
**Disposition:** [proceed / proceed-with-constraints / rethink]

## Points of Agreement
[bulleted list — these are hard constraints for the plan]

## Contested Points
[for each: the point, Advocate's position, Skeptic's position, Practitioner's position]

## Invalidated Assumptions
[bulleted list with evidence/reasoning for each]

## Risk Register
| Risk | Raised By | Likelihood | Required Mitigation |
|------|-----------|------------|---------------------|
| ... | ... | ... | ... |

## Position Papers

### Advocate
[full advocate position paper]

### Skeptic
[full skeptic position paper]

### Practitioner
[full practitioner position paper]
```

Create the `docs/findings/` directory if it does not exist.

Report: "Verdict saved to `[path]`. The plan command will read this automatically."

---

### GitHub Epic Tracking

If `integrations.github.enabled` AND `integrations.github.issue_tracking`:

1. Read `github_epic: N` from the spec file's YAML frontmatter (same spec being debated).
2. If found, post a summary comment on the epic:
   ```bash
   cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment [N] --stdin
   ## Design Debate

   **Disposition:** [proceed / proceed-with-constraints / rethink]
   **Points of agreement:** [count]
   **Contested points:** [count]
   **Invalidated assumptions:** [count]
   **Risks identified:** [count]

   Verdict: `[path to verdict file]`
   EOF
   ```
   If the command fails, notify the user with the error and ask for guidance.
3. If no `github_epic` found in spec, skip — not all specs are tied to an epic.

---

### Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

Store the resolved absolute path and use it in the commands below.

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Record the debate session:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js record session "$(cat <<'TOPIC'
debate-[topic-slug]
TOPIC
)" "$(cat <<'SUMMARY'
[date]: Design debate for [spec title] — disposition: [disposition]
SUMMARY
)" "$(cat <<'DETAIL'
Panelists: Advocate, Skeptic, Practitioner. Points of agreement: [count]. Contested: [count]. Risks: [count]. Verdict file: [path].
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:**

Record the debate session:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js session "$(cat <<'TOPIC'
debate-[topic-slug]
TOPIC
)" "$(cat <<'SUMMARY'
[date]: Design debate — disposition: [disposition]
SUMMARY
)" "$(cat <<'DETAIL'
[spec title]. Agreement: [count], Contested: [count], Risks: [count]. Verdict: [path].
DETAIL
)"
```

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### What's Next

After the verdict is saved, present transition guidance:

**If disposition is `rethink`:**
```
Verdict saved to [path].

Recommended: Re-run /pipeline:brainstorm with these debate findings as input.
The invalidated assumptions and contested points should inform the next design iteration.
```

**If disposition is `proceed` or `proceed-with-constraints`:**
```
Verdict saved to [path].

Next: /pipeline:plan — the plan command will read the verdict file and incorporate
the constraints and risk mitigations automatically.
```

---

### Orchestrator

Record step completion with the verdict file as the output artifact. Map disposition to result code:

- `proceed` or `proceed-with-constraints` → `PASS`
- `rethink` → `FAIL` (routes back to brainstorm via orchestrator's onFail)

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete debate [PASS|FAIL] '[verdict file path]'
```

**If the debate was skipped** (TINY/MEDIUM change), still record a PASS so the orchestrator can advance past this step:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete debate PASS 'skipped'
```

Without this call, the workflow will be stuck waiting for debate to complete — the orchestrator does not auto-skip optional steps whose inputs are met.
