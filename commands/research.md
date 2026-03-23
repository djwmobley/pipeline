---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*), Task(*)
description: Parallel research agents for technical unknowns — confidence-scored findings before planning
---

## Pipeline Research

You are the research orchestrator. Your job is to investigate technical unknowns BEFORE planning or implementation begins. You dispatch parallel research agents and synthesize their findings with confidence scores.

**WHEN TO USE:** Before `/pipeline:brainstorm` or `/pipeline:plan` when the task involves:
- An unfamiliar API, library, or framework
- An architectural decision with multiple viable approaches
- Integration with a system you haven't used in this project before
- Any question where training data may be stale (assume 6-18 months old)

**WHEN TO SKIP:** The change is in well-understood territory with established patterns in the codebase.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `models.research` — model for research agents (default: haiku)
- `knowledge.tier` — if Postgres, use semantic search for prior research
- `routing.source_dirs` — where to look for existing patterns

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

---

### Step 1 — Define research questions

Parse the user's request into 2-4 distinct research questions. Each question should be:
- Specific enough to answer in one focused investigation
- Independent enough to run in parallel

Present the questions for confirmation:
> "I'll investigate these questions in parallel:
> 1. [question]
> 2. [question]
> ...
> Adjust or approve?"

---

### Step 2 — Check prior research

If `knowledge.tier` is `"postgres"`, resolve `$SCRIPTS_DIR` first:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

Then run semantic search for each question:
```
PROJECT_ROOT=$(pwd) node <resolved_scripts_dir>/pipeline-embed.js hybrid "<question>"
```
If relevant prior research exists, show it and ask: "Found prior research on [topic]. Still want to re-investigate, or use the existing findings?"

---

### Step 3 — Dispatch parallel research agents

For each approved question, dispatch a Task agent (model: value of `models.research` from config):

```
Task tool (general-purpose, model: [models.research value]):
```

Each research agent receives this prompt:

---
**You are a technical researcher. Investigate this question thoroughly.**

**Question:** [question]

**Source hierarchy (use in this order):**
1. **Existing codebase** — grep/glob for patterns, read relevant files
2. **Official documentation** — use Context7 MCP if available, otherwise WebSearch
3. **Community sources** — WebSearch for recent discussions, Stack Overflow, GitHub issues

**Rules:**
- You MUST assign a confidence level to every finding: **HIGH** (verified in docs/code), **MEDIUM** (multiple sources agree), **LOW** (single source or inference)
- You MUST NOT present training data as fact. If you cannot verify a claim, mark it LOW confidence and say why
- Negative findings are valuable — "X does NOT support Y" with evidence is better than silence
- Include version numbers when relevant — verify against package registries, not memory

**Output format:**
```
## [Question restated]

### Findings
- [Finding 1] **[HIGH/MEDIUM/LOW]** — [source/evidence]
- [Finding 2] **[HIGH/MEDIUM/LOW]** — [source/evidence]
...

### Recommendation
[Prescriptive recommendation — "Use X" not "Consider X or Y"]

### Unknowns
[What couldn't be determined and why]
```
---

Launch ALL research agents in a single message (parallel dispatch).

---

### Step 4 — Synthesize findings

After all agents return, synthesize into a unified research brief:

```
## Research Brief: [topic]

### Key Findings
1. [Finding] — **[confidence]** — [source]
2. ...

### Decisions Ready to Lock
- [Decision with HIGH confidence that can be locked before planning]

For each decision ready to lock, if knowledge.tier is postgres: `PROJECT_ROOT=[project_root] node [scripts_dir]/pipeline-db.js update decision '[topic]' '[decision text]' 'locked'`. For files tier: append `[LOCKED]` prefix to the decision in DECISIONS.md.

### Open Questions
- [Anything still uncertain that brainstorm/arch should address]

### Sources
- [List of verified sources]
```

---

### Step 5 — Store results

**Postgres tier:** Use the `update decision` subcommand (parameterized) rather than raw SQL to avoid injection. Use the same `<resolved_scripts_dir>` from Step 2.
```bash
PROJECT_ROOT=$(pwd) node <resolved_scripts_dir>/pipeline-db.js update decision 'research-[topic]' '[one-line summary]' '[full research brief]'
```
Then update embeddings:
```bash
PROJECT_ROOT=$(pwd) node <resolved_scripts_dir>/pipeline-embed.js index
```

**Files tier:** Write to `docs/research/YYYY-MM-DD-[topic].md`

---

### Step 6 — Handoff

Present the research brief and suggest next step:
> "Research complete. [N] findings ([X] HIGH, [Y] MEDIUM, [Z] LOW confidence).
>
> Ready to lock [N] decisions. Proceed to `/pipeline:brainstorm` or `/pipeline:plan`?"
