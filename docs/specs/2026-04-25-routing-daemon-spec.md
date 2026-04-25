---
title: Convention-not-reason model routing — daemon, hooks, telemetry
change_size: LARGE
date: 2026-04-25
---

# Convention-not-Reason Model Routing — Daemon-Mediated Execution

## Background and Motivation

Pipeline's Opus orchestrator today makes per-turn routing decisions: which executor (script, local model, Haiku, Sonnet) is appropriate for each operation. This violates the convention-not-reason axiom — routing by judgment creates drift surfaces that accumulate token waste. Evidence from this session: Opus read 520-line files and feedback documents (should be Haiku or on-demand memory daemon), drafted 400-word audit prompts (Sonnet minimum), hand-wrote SQL in Bash (should route through daemon), and dispatched Sonnet for bulk text classification of 51 fields (qwen2.5:14b or regex script sufficient). The user's mandate is to remove Opus's runtime judgment entirely — enforce routing through architecture (daemon-mediated tools, PreToolUse hooks, deterministic grid). The grid lives in `.claude/pipeline.yml` under `routing:` and is the sole source of truth for what tier handles which operation. No model picks its own executor; all restricted operations route through a daemon MCP server that looks up the grid and dispatches internally.

## Routing Grid

| Operation Type | Executor | Example Invocation | Detection Rule |
|---|---|---|---|
| File read (< 50 KB) | No-LLM (Read tool) | `Read /path/file.md` | Offset/limit provided; known file path |
| File read (metadata only) | No-LLM (Read tool) | `Read /path file start=0 limit=1` | Header extraction, schema inspection |
| Glob / file discovery | No-LLM (Glob tool) | `Glob "*.js" /path` | Pattern-based file search |
| Grep / content search | No-LLM (Grep tool) | `Grep "pattern" /path` | Substring/regex across files |
| SQL operation (read, write, schema) | Daemon → script or local model | `mcp__router__sql op_type="read" query="SELECT..."` | All SQL gates through daemon; daemon picks script (bulk) or qwen2.5:14b (small) |
| Bulk text classification | qwen2.5:14b (local) | `mcp__router__classify input="[...]" schema="{...}"` | >10 items, deterministic schema, no judgment prose required |
| Short prose drafting | qwen2.5:14b (local) | `mcp__router__draft_short prompt="..." max_tokens=500` | <1000 tokens, mechanical (status flips, short summaries, field rewrites) |
| Code/script drafting | qwen2.5-coder:32b (local) | `mcp__router__draft_code lang="..." context="..." prompt="..."` | Source code, Bash, regex, YAML — not prose |
| Judgment prose (architecture, review, design) | Sonnet | Dispatch via `Agent model=sonnet` | Contradictions, trade-offs, acceptance criteria, cross-doc consistency |
| Complex multi-step dispatch | Sonnet (via Agent tool) | `Agent model=sonnet` | Subagent orchestration; Sonnet reads context and decides approach |
| Conversation turn handling | Haiku (via Agent tool) | `Agent model=haiku prompt="..."` | Single-file fact lookup, status check, simple synthesis |
| File write (after drafted content) | Daemon → script | `mcp__router__file_write path="/..." content="$DRAFTED"` | All writes gate through daemon; daemon calls Edit/Write after validation |
| Ollama-mediated embedding | qwen2.5:14b (local) | `mcp__router__embed text="..." index="decisions"` | Vectorization of decisions, completions, gotchas (sidestep external HTTP) |

The grid is stored in `.claude/pipeline.yml`:

```yaml
routing:
  grid:
    - op: file_read
      executor: no_llm_read_tool
      max_size_kb: 50
    - op: sql_operation
      executor: daemon_sql
      daemon_tool: mcp__router__sql
    - op: short_prose_draft
      executor: qwen2.5:14b
      daemon_tool: mcp__router__draft_short
      max_tokens: 500
    # ... (10-12 rows total)
```

## Tool/Daemon Use vs. Direct Model Call

**Direct-call routing (today):** Opus sees a task ("read this file, then draft a summary"), picks Haiku for the read + Sonnet for the draft, invokes both. Opus is the router; the tier is implicit in the Agent tool destination. This is routing-by-judgment.

**Daemon-mediated routing (proposed):** Caller (any model) invokes a single tool corresponding to the operation family (e.g., `mcp__router__draft_short`). The daemon receives the invocation, looks up the grid in `.claude/pipeline.yml`, and dispatches internally to the appropriate executor (qwen2.5:14b, script, or escalates to Sonnet via Agent if judgment is needed). The caller never decides which tier runs. Example for short prose drafting: instead of Opus drafting a 200-word field summary directly, Opus calls `mcp__router__draft_short prompt="Summarize the findings..." max_tokens=200`. The daemon invokes qwen2.5:14b locally. If the prompt signals a judgment task (e.g., "decide whether this is critical"), the daemon escalates to Sonnet via Agent, not Opus.

## Prevention Layer

A `PreToolUse` hook in `.claude/settings.json` intercepts all Bash and Agent tool calls. The hook:

1. Inspects the tool invocation (tool name, args)
2. Maps the invocation to an operation type (e.g., Bash `grep` → grep operation; Agent with model=sonnet and a drafting prompt → judgment prose)
3. Looks up the grid in `.claude/pipeline.yml` to find the expected executor
4. If the invoked executor mismatches (e.g., Bash running SQL INSERT instead of routing through `mcp__router__sql`), exits with error code 2 and logs to routing_violations table

Example denied call:

```bash
# BLOCKED: Opus attempts direct SQL write
INSERT INTO roadmap_tasks ...

# Hook detects: Bash tool, SQL operation, expected executor: daemon_sql
# Error: "SQL operations must route through mcp__router__sql; see .claude/pipeline.yml routing.grid"
```

## Punishment Layer

A `routing_violations` Postgres table tracks every attempted bypass:

```sql
CREATE TABLE routing_violations (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW(),
  operation_type VARCHAR,
  attempted_executor VARCHAR,
  expected_executor VARCHAR,
  was_blocked BOOLEAN,
  hook_message TEXT,
  tool_name VARCHAR,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

Violations are visible in `/pipeline:finish` ship summaries under a "Routing Deviations" section, flagged in cost reports (avoidable spend), and aggregated weekly to surface systematic gaps in the grid.

## Bake-Into-Pipeline Path

The routing daemon, grid schema, PreToolUse hook template, and hook registry are shipped as part of the Pipeline plugin:

- `.claude-plugin/settings.json.template` includes `permissions.deny` entries that deny direct Bash/Agent calls for restricted op-types
- `scripts/lib/router-daemon.js` serves the MCP daemon (one tool per op-type family)
- `routing.yml` schema docs in `skills/init/`
- `init.md` command generates `.claude/pipeline.yml` with baseline routing grid from template
- Routing violations table is created on first `/pipeline:init` run

This makes the enforcement pattern reusable across projects; projects inherit the grid and can override per operation type via `.claude/pipeline.yml`.

## Meta-Context for Debate Panel (READ THIS, debate agents)

The user has repeatedly corrected Opus in this session for over-invoking elevated models: Opus read large files and feedback documents directly (should be Haiku or on-demand memory daemon), drafted a 400-word audit dispatch (Sonnet minimum), hand-wrote SQL in Bash (daemon gate), and dispatched Sonnet for bulk text classification (qwen2.5:14b sufficient). The user's directive is explicit: "remove Opus's runtime routing judgment entirely — enforced by architecture, not by reminders." The user stated Pipeline is "EXTREMELY token heavy" and the root cause is Opus over-elevating execution tier per-turn. This design must be evaluated against that constraint: **Does it make routing *deterministic and enforceable* so Opus cannot deviate?** If the grid is aspirational but hooks don't enforce it, or if the daemon still requires Opus judgment, the design has failed.

The Opus orchestrator drafting this dispatch flagged two additional mis-tierings in the grid above (rows for "Conversation turn handling" and "Complex multi-step dispatch") but did NOT correct them — those are surfaced for your scrutiny precisely because the orchestrator's judgment about routing is exactly what is being eliminated. Decide whether they are correct, and flag any other mis-tierings.
