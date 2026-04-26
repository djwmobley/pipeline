---
title: Convention-not-reason routing — Option D (skill-frontmatter declarative + host-agnostic)
change_size: LARGE
date: 2026-04-25
supersedes: docs/specs/2026-04-25-routing-daemon-spec.md
verdict: docs/findings/debate-2026-04-25-routing-opus-tier.md
github_epic: 116
---

# Convention-not-reason routing — Option D

## Background and Motivation

Pipeline's current state delegates all routing decisions to the Opus orchestrator at each conversation turn. When Opus decides whether to dispatch a subagent via the Task tool, write directly via Edit/Write, or invoke Bash, that decision is made by reasoning inside the model. The CLAUDE.md axiom is explicit: **runtime reasoning IS drift**. Every "I'll use Sonnet here because this looks judgment-heavy" thought inside Opus is the problem, not a solution. The result is a token profile that accumulates expensive Sonnet and Opus calls for work that qwen2.5:14b or a plain script could do for free. The cost is not just financial — it is semantic drift in the pipeline's own quality enforcement.

The user's mandate is a binary rubric: routing violations must be prevented by architecture, not caught after the fact. The three prior candidate architectures (A: full MCP daemon, B: hybrid hook + CP5, C: CP5 alone) were debated by three independent Opus panelists. All three candidates embed intent classification somewhere in the runtime path — the daemon classifies via op-type tagging, the hybrid hook classifies via prompt-regex, CP5 classifies at review time. The Opus Skeptic and Practitioner independently converged on the same structural diagnosis: **intent classification at runtime is the wrong problem to solve**. The correct escape is Option D: routing decisions happen at skill-authoring time, declared in YAML frontmatter, enforced by mechanical file-lookup in a narrow hook. No classification, no prompt inspection, no judgment surface.

Option D enforces the convention-not-reason axiom by construction. The hook makes a deterministic lookup against a static field in a file. There is no model the hook reasons about, no threshold it calibrates, no classifier it wraps. A skill that declares `operation_class: short_draft` gets routed to qwen2.5:14b. A skill that lacks the field is blocked until it is added. Rigidity is the feature: the convention is declared by a human, once, in the file where the dispatch happens. Runtime is mechanical execution of what was decided at authoring time.

## Architecture Overview

```
Conversation turn (Opus orchestrator — reads tool output, scopes prompts, emits response)
  │
  ├─ Tool call fires → PreToolUse hook (scripts/hooks/routing-check.js)
  │     │
  │     ├─ Read PIPELINE_ACTIVE_SKILL env var
  │     │     └─ If unset: active_skill = "conversation_mode" (default)
  │     │
  │     ├─ Load skill frontmatter: skills/<active_skill>/SKILL.md
  │     │     └─ Extract: operation_class, allowed_models[], allowed_direct_write
  │     │
  │     ├─ Universal floor checks (regardless of skill):
  │     │     ├─ Bash command matches SQL_BLOCK_PATTERNS? → EXIT 2 (block)
  │     │     └─ Edit/Write > N lines AND allowed_direct_write != true? → EXIT 2 (block)
  │     │
  │     ├─ Grid lookup: routing.tier_map[operation_class] → declared_tier
  │     │
  │     ├─ Tool call matches declared_tier? → EXIT 0 (allow)
  │     │
  │     └─ Mismatch → write routing_violation + EXIT 2 (block + message)
  │
  ├─ Tool call completes → PostToolUse hook (scripts/hooks/routing-log.js)
  │     └─ Append {timestamp, tool, model, skill, operation_class} to violations log
  │           ├─ knowledge.tier == "postgres": INSERT INTO routing_violations
  │           └─ knowledge.tier == "files": append to logs/routing-violations.jsonl
  │
  └─ Conversation turn ends → Stop hook (scripts/hooks/routing-stop.js)
        ├─ Scan assistant output for substantive prose (see Stop Hook section)
        ├─ Count words outside excluded zones
        └─ Exceeds threshold → write routing_violation (post-hoc; no block)
```

**Chain-the-dispatch rule (enforced in PreToolUse):** When Opus drafts a long subagent prompt in its own context window and then dispatches it via Task, the hook detects a prompt longer than `routing.chain_dispatch_threshold` bytes sent to a tier lower than Sonnet for a skill whose `operation_class` is not `opus_orchestration`. The correct path is to dispatch qwen first to draft the prompt, then pass qwen's output as the subagent input. The hook blocks the large-prompt dispatch and emits: "Prompt exceeds chain-dispatch threshold. Dispatch a qwen draft step first."

## Skill Frontmatter Extensions

All SKILL.md files gain three new frontmatter fields. All three are validated by `scripts/pipeline-lint-agents.js`.

```yaml
---
name: building
description: Subagent-driven plan execution with post-task review
operation_class: code_draft          # REQUIRED — closed enum; see routing.tier_map
allowed_models: []                   # OPTIONAL — override declared tier for specific models
                                     # e.g., [sonnet] for skills that legitimately need review
allowed_direct_write: false          # OPTIONAL — set true only for skills that write large
                                     # structural outputs (e.g., config generation in init)
---
```

**Closed enum for `operation_class`** (defined in `routing.tier_map` in `pipeline.yml`; linter enforces this list):

| Value | Meaning | Default tier |
|---|---|---|
| `opus_orchestration` | Opus reads context, decides what to dispatch, emits conversation turn | opus |
| `sonnet_review` | Architecture review, code review, judgment-prose analysis | sonnet |
| `haiku_judgment` | Single-file judgment, nuanced fact lookup, mid-tier synthesis | haiku |
| `code_draft` | Code drafting, script generation, SQL/regex templates, YAML/JSON construction | qwen_coder |
| `short_draft` | Short prose drafts (memory entries, comments, status notes, summaries ≤ 200 words) | qwen_prose |
| `bulk_classify` | Structured synthesis from multiple inputs, bulk classification | qwen_prose |
| `script_exec` | Deterministic transforms, file reads, Glob, Grep, structural one-liner edits | no_llm |
| `conversation_mode` | Default when no pipeline skill is active | (see conversation_mode section) |

**Example: simple script-exec skill (lint-agents):**

```yaml
---
name: lint-agents
description: Static validation of skill frontmatter — operation_class declared and valid
operation_class: script_exec
allowed_direct_write: false
---
```

**Example: skill that legitimately needs Sonnet:**

```yaml
---
name: reviewing
description: Code and architecture review
operation_class: sonnet_review
allowed_models: [sonnet]
allowed_direct_write: false
---
```

**Example: skill that writes large structural outputs:**

```yaml
---
name: init
description: Project setup and pipeline.yml generation
operation_class: code_draft
allowed_models: [sonnet]
allowed_direct_write: true
---
```

## Routing Grid Schema (in `.claude/pipeline.yml`)

The `routing:` block is extended. The existing `routing.source_dirs` and size-routing fields are preserved unchanged.

```yaml
routing:
  # Existing fields (unchanged)
  source_dirs: ["commands/", "skills/"]
  tiny_max_files: 1
  tiny_max_lines: 30
  medium_max_files: 3
  review_gate_threshold: 3

  # New: convention routing
  enabled: true                        # Set false to disable all routing enforcement
                                       # (for disable path — see Migration section)
  chain_dispatch_threshold: 2000       # Bytes; Agent prompt above this triggers chain-dispatch rule
  direct_write_line_threshold: 10      # Edit/Write blocked above this line count without allowed_direct_write

  # Tier map: operation_class → executor tier name
  tier_map:
    opus_orchestration: opus
    sonnet_review: sonnet
    haiku_judgment: haiku
    code_draft: qwen_coder
    short_draft: qwen_prose
    bulk_classify: qwen_prose
    script_exec: no_llm
    conversation_mode: mixed            # Special: see conversation_mode section

  # Local model hosts — populated by /pipeline:init
  local_models:
    prose:
      name: "qwen2.5:14b"              # Abstract name used in tier_map resolution
      host_type: "ollama"              # ollama | openai_compatible | custom
      endpoint: "http://localhost:11434"
      api_protocol: "ollama_native"    # ollama_native | openai_compatible
      context_window: 8192
    coder:
      name: "qwen2.5-coder:32b"
      host_type: "ollama"
      endpoint: "http://localhost:11434"
      api_protocol: "ollama_native"
      context_window: 16384
    # If no local models configured, local tiers fall back to haiku (with violation logged)

  # Universal floor — blocked regardless of operation_class
  universal_floor:
    bash_block_patterns:
      - "^psql\\s"                     # Direct psql invocation
      - "INSERT INTO\\s"               # Inline SQL INSERT
      - "UPDATE\\s+\\w+\\s+SET\\s"     # Inline SQL UPDATE
      - "DROP TABLE\\s"                # DROP TABLE (also covered by destructive-ops guard)
      - "DELETE FROM\\s+\\w+\\s*$"     # Whole-table DELETE (no WHERE clause)
    # Note: node scripts/pipeline-db.js is already in permissions.allow and is the correct path
```

## Init Detection Flow

`/pipeline:init` is extended with a new **Step 3b — Local model host detection**, inserted after the existing Step 3 (integration detection) and before Step 4 (knowledge tier).

### Step 3b — Local model host detection

The detection probe (`scripts/pipeline-init-detect.js`) is extended to probe known local-model server ports:

| Host type | Default endpoint | Probe method |
|---|---|---|
| Ollama | `http://localhost:11434/api/tags` | HTTP GET; success if 200 and JSON body has `models` array |
| LM Studio | `http://localhost:1234/v1/models` | HTTP GET; success if 200 (OpenAI-compatible) |
| vLLM | `http://localhost:8000/v1/models` | HTTP GET; success if 200 (OpenAI-compatible) |
| llama.cpp server | `http://localhost:8080/v1/models` | HTTP GET; success if 200 (OpenAI-compatible) |
| TGI (text-generation-inference) | `http://localhost:3000/info` | HTTP GET; success if 200 |

**If Ollama is already detected** (existing `integrations.ollama.enabled: true`), the Ollama result from Step 3 is reused — no re-probe.

**Interactive prompt (guided engagement):**

> "Convention routing uses local models to run short drafts and code generation for free.
>
> Detected: [list probed hosts that responded, or 'none']
>
> Which local model server are you using?
> 1. Ollama (detected / not detected)
> 2. LM Studio (OpenAI-compatible)
> 3. vLLM (OpenAI-compatible)
> 4. llama.cpp server (OpenAI-compatible)
> 5. Other OpenAI-compatible endpoint — enter URL
> 6. None — Anthropic models only (Haiku will substitute for local tiers)"

**Expert prompt:**

> "Local model host? (ollama / lmstudio / vllm / llamacpp / openai-compat [url] / none)"

**Quick mode:** Use first detected host. If Ollama is already configured, use it. If nothing detected, set `none`.

**Model selection (guided):**

After host is confirmed, list available models from the host's `/api/tags` or `/v1/models` endpoint. Present the list and ask the user to identify which model serves prose drafts and which serves code drafts. If no models are pulled/loaded, show:

> "No models found at [endpoint]. Pull models first (e.g., `ollama pull qwen2.5:14b`), then re-run `/pipeline:init` or `/pipeline:update routing`."

Set `routing.local_models.prose.name` and `routing.local_models.coder.name` from the user's selection.

**Idempotency:** If `routing.local_models` already exists in `pipeline.yml` with non-null values, Step 3b displays the current configuration and asks: "Keep existing local model config? (Y/n)". If yes, skip. If no, re-run detection. The existing `routing.enabled` state is preserved across re-init unless the user explicitly changes it.

**What gets written to `pipeline.yml`:** The full `routing.local_models` block (both `prose` and `coder` entries), `routing.enabled: true`, and `routing.tier_map` with all eight operation classes. The `universal_floor` block ships with the default patterns listed above.

## Adapter Pattern (Local Model Hosts)

All local-model invocations route through an adapter. The adapter lives at `scripts/lib/local-model-adapter.js`.

**Adapter interface (JSDoc):**

```js
/**
 * @typedef {Object} LocalModelAdapter
 * @property {string} hostType - 'ollama' | 'openai_compatible' | 'custom'
 * @property {function(AdapterConfig): Promise<void>} probe
 *   - Verifies host is reachable and model is available.
 *   - Throws LocalModelUnavailableError if host is down or model not pulled.
 * @property {function(AdapterConfig, string, CompletionOptions): Promise<string>} complete
 *   - Sends prompt, returns completion string.
 *   - Throws LocalModelUnavailableError on network failure.
 *   - Throws LocalModelBadOutputError if response is empty or malformed.
 * @property {function(AdapterConfig): Promise<string[]>} listModels
 *   - Returns array of available model names from the host.
 */

/**
 * @typedef {Object} AdapterConfig
 * @property {string} endpoint - Base URL of the host
 * @property {string} modelName - Model identifier on the host
 * @property {string} apiProtocol - 'ollama_native' | 'openai_compatible'
 * @property {number} timeoutMs - Request timeout (default: 30000)
 * @property {number} maxRetries - Retry count on transient failure (default: 2)
 */

/**
 * @typedef {Object} CompletionOptions
 * @property {number} [maxTokens] - Max tokens for response
 * @property {number} [temperature] - Sampling temperature (default: 0.2 for drafts)
 * @property {string} [system] - System prompt
 */
```

**v1 adapter: OllamaAdapter**

- Endpoint: `POST {endpoint}/api/generate`
- Request body: `{ model, prompt, stream: false, options: { num_predict: maxTokens, temperature } }`
- Response: parse `response` field from JSON body
- Probe: `GET {endpoint}/api/tags` — check model name exists in `models[].name`
- Timeout: 30s default; configurable via `routing.local_models.prose.timeout_ms`
- Retry: 2 retries on connection refused or timeout; no retry on 4xx

**v1 adapter: OpenAICompatibleAdapter**

- Endpoint: `POST {endpoint}/v1/chat/completions`
- Request body: `{ model, messages: [{role: "user", content: prompt}], max_tokens, temperature }`
- Response: parse `choices[0].message.content`
- Probe: `GET {endpoint}/v1/models` — check model id exists in `data[].id`
- Timeout and retry: same as OllamaAdapter

**Custom adapter contract (v2 community contribution):** Implement the `LocalModelAdapter` interface. Export from a file at `scripts/lib/adapters/<name>-adapter.js`. Register in `scripts/lib/local-model-adapter.js` by adding to the `ADAPTER_MAP` object keyed by `host_type` string. No other changes required.

**Factory function:** `getAdapter(hostType: string): LocalModelAdapter` — throws if `hostType` is not in `ADAPTER_MAP`. Called by the hook and by init probe.

## PreToolUse Hook Implementation

**Hook entry in `.claude/settings.json` (project-level):**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-check.js"
          }
        ]
      }
    ]
  }
}
```

The `matcher` is empty — the hook runs on every tool call. The script filters internally.

**Script:** `scripts/hooks/routing-check.js`

**Input:** Claude Code passes a JSON object on stdin with `tool_name` and `tool_input` fields.

**Active-skill detection mechanism:** The hook reads `process.env.PIPELINE_ACTIVE_SKILL`. This env var is set by each pipeline command at session start via a SessionStart hook (see Plugin Distribution section). The var contains the skill directory name (e.g., `building`, `reviewing`, `debate`). If unset or empty, the hook defaults to `conversation_mode`.

**Algorithm (pseudo-code):**

```
input = JSON.parse(stdin)
tool_name = input.tool_name
tool_input = input.tool_input

active_skill = process.env.PIPELINE_ACTIVE_SKILL || "conversation_mode"
config = loadPipelineYml()                     # cached after first read

if (!config.routing?.enabled) exit(0)          # routing disabled — allow all

# Universal floor checks
if (tool_name == "Bash") {
  cmd = tool_input.command || ""
  for pattern in config.routing.universal_floor.bash_block_patterns:
    if (new RegExp(pattern).test(cmd)):
      writeViolation({type: "universal_floor", pattern, tool: tool_name, skill: active_skill})
      exit(2, "ROUTING BLOCK: Direct SQL/psql not allowed. Use node scripts/pipeline-db.js instead.")
}

if (tool_name in ["Edit", "Write"]) {
  lineCount = countLines(tool_input.new_string || tool_input.content || "")
  threshold = config.routing.direct_write_line_threshold  # default 10
  if (lineCount > threshold) {
    skill_fm = loadSkillFrontmatter(active_skill)
    if (!skill_fm.allowed_direct_write) {
      writeViolation({type: "direct_write", lines: lineCount, skill: active_skill})
      exit(2, `ROUTING BLOCK: Direct write of ${lineCount} lines without allowed_direct_write.
              Dispatch a qwen draft subagent first, then write the output.`)
    }
  }
}

# Chain-the-dispatch check (Agent/Task calls only)
if (tool_name in ["Agent", "Task"]) {
  prompt_bytes = Buffer.byteLength(tool_input.prompt || "", "utf8")
  threshold = config.routing.chain_dispatch_threshold  # default 2000
  if (prompt_bytes > threshold && active_skill != "conversation_mode") {
    skill_fm = loadSkillFrontmatter(active_skill)
    if (skill_fm.operation_class != "opus_orchestration" && skill_fm.operation_class != "sonnet_review") {
      writeViolation({type: "chain_dispatch", bytes: prompt_bytes, skill: active_skill})
      exit(2, `ROUTING BLOCK: Agent prompt is ${prompt_bytes} bytes. Dispatch qwen to draft this prompt first, then pass its output as the subagent input.`)
    }
  }
}

# Tier check (Agent/Task model parameter)
if (tool_name in ["Agent", "Task"] && tool_input.model) {
  skill_fm = loadSkillFrontmatter(active_skill)
  tier = config.routing.tier_map[skill_fm.operation_class]
  allowed = resolveAllowedModels(tier, skill_fm.allowed_models, config)
  if (tool_input.model not in allowed) {
    writeViolation({type: "tier_mismatch", requested: tool_input.model, allowed, skill: active_skill})
    exit(2, `ROUTING BLOCK: ${active_skill} declares operation_class=${skill_fm.operation_class}.
            Allowed models: [${allowed.join(", ")}]. Requested: ${tool_input.model}.`)
  }
}

exit(0)
```

**`loadSkillFrontmatter(skill_name)`:** Reads `$PLUGIN_DIR/skills/<skill_name>/SKILL.md`, parses YAML frontmatter (between `---` delimiters). Cached per process. If skill file not found, defaults to `{operation_class: "conversation_mode", allowed_direct_write: false}` and writes a violation of type `missing_skill_declaration`.

**`resolveAllowedModels(tier, overrides, config)`:** Returns the model name list for the tier. `overrides` (from `allowed_models:` frontmatter) are additive — they extend, not replace, the tier's declared models.

## PostToolUse Hook Implementation

**Hook entry in `.claude/settings.json`:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-log.js"
          }
        ]
      }
    ]
  }
}
```

**Script:** `scripts/hooks/routing-log.js`

**Input:** JSON on stdin with `tool_name`, `tool_input`, `tool_output`, and optionally `model` (when available from the Claude Code hook payload).

**Algorithm:** Append a telemetry record for every Tool call (not just violations). This is how the weekly report gets its tier-distribution data.

```js
record = {
  ts: new Date().toISOString(),
  tool: tool_name,
  model: tool_input.model || process.env.CLAUDE_MODEL || null,
  skill: process.env.PIPELINE_ACTIVE_SKILL || "conversation_mode",
  operation_class: lookupOperationClass(skill),
  prompt_bytes: Buffer.byteLength(tool_input.prompt || tool_input.command || "", "utf8"),
  violation: false
}
writeRecord(record, config)
```

`writeRecord` checks `config.knowledge.tier`:
- `"postgres"`: `INSERT INTO routing_events (ts, tool, model, skill, operation_class, prompt_bytes, violation) VALUES (...)`
- `"files"`: append JSON line to `logs/routing-events.jsonl` (create file if absent)

The `routing_violations` table/file is written by the PreToolUse hook at block time. The PostToolUse hook writes to `routing_events` (all calls, for distribution reporting).

## Stop Hook Implementation (in-context drafting)

The Stop hook fires when the assistant's turn ends. It scans the assistant's text output for substantive prose that should have been dispatched to a lower tier rather than drafted inline by Opus.

**Hook entry in `.claude/settings.json`:**

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-stop.js"
          }
        ]
      }
    ]
  }
}
```

**Script:** `scripts/hooks/routing-stop.js`

**Input:** JSON on stdin with `message` field containing the full assistant turn text.

**"Substantive content" heuristic (concrete exclusions first):**

Remove the following zones from the word count before applying the threshold:

1. Code fences (content between triple-backtick pairs, including YAML/JSON blocks)
2. Tool-call narration: lines matching `^(Reading|Writing|Running|Checking|Searching|Found|No |Updating|Loading)\s` (these are mechanical status lines, not drafted prose)
3. Ordered and unordered lists where each item is ≤ 12 words (structural enumeration)
4. Blockquotes (content starting with `>` — these are typically quoted tool output)
5. Content inside HTML `<details>` tags
6. Lines that are solely a file path, URL, or command (no sentence structure)

**Threshold:** 150 words of non-excluded prose in a single turn triggers a violation record. Initial value; tunable via `routing.stop_hook_threshold` in `pipeline.yml`. The Stop hook does NOT block (exit codes other than 0 in a Stop hook are not supported by Claude Code — it is post-hoc visibility only).

**Algorithm:**

```
text = input.message
stripped = applyExclusions(text)  # remove all excluded zones
word_count = countWords(stripped)
threshold = config.routing?.stop_hook_threshold || 150

if (word_count > threshold) {
  writeViolation({
    type: "in_context_draft",
    word_count,
    skill: process.env.PIPELINE_ACTIVE_SKILL || "conversation_mode",
    ts: new Date().toISOString()
  })
  # No exit(2) — Stop hook cannot block; this is accountability-only
}
```

## Universal Floor

The universal floor applies on every PreToolUse call regardless of `operation_class`. It cannot be overridden by `allowed_direct_write` or `allowed_models`. These patterns represent operations that must always route through the `pipeline-db.js` script layer:

| Pattern | Matched against | Rationale |
|---|---|---|
| `^psql\s` | `tool_input.command` | Direct psql bypasses the three-store write path |
| `INSERT INTO\s` | `tool_input.command` | Inline SQL; use pipeline-db.js |
| `UPDATE\s+\w+\s+SET\s` | `tool_input.command` | Inline SQL UPDATE |
| `DROP TABLE\s` | `tool_input.command` | Always a destructive-op checkpoint |
| `DELETE FROM\s+\w+\s*$` | `tool_input.command` | Whole-table DELETE (no WHERE clause) |

The `pipeline-db.js` script is already in `permissions.allow` (`Bash(node scripts/pipeline-db.js *)`). The correct path for all DB writes is `node scripts/pipeline-db.js <verb> <args>`.

**Override mechanism:** There is no per-call override for the universal floor. It is unconditional. If a legitimate use case arises that requires direct SQL, a new `pipeline-db.js` verb must be added to cover it.

## Failure Modes and Policies

| Failure | Behavior | Override |
|---|---|---|
| Local model host down | PreToolUse blocks the Agent/Task call if the declared tier requires a local model. Error message: "Local model host unreachable at [endpoint]. Either start [host_type] or set `routing.enabled: false` in pipeline.yml." | Set `routing.enabled: false` in `pipeline.yml` to disable enforcement; violations are no longer logged. |
| Model not pulled on host | probe() throws `LocalModelUnavailableError`. Same block behavior as host-down. Message names the missing model and the pull command. | Same disable path. |
| Hook script error (routing-check.js crashes) | Claude Code interprets a non-zero exit with no output as a hook error; the tool call is NOT blocked (Claude Code falls through on hook crash). Log stderr to `logs/routing-hook-errors.log`. This is the fail-open case — hook errors do not prevent work. | Fix the script; no workaround needed. |
| qwen output unusable (empty or malformed) | `LocalModelBadOutputError` is thrown by the adapter's `complete()`. The dispatching skill's prompt template must specify a fallback behavior; Pipeline's convention is to re-dispatch once with a simplified prompt, then escalate to haiku with a `routing_violation` of type `local_model_fallback`. No silent escalation to Sonnet. | N/A |
| Postgres unavailable (knowledge.tier = postgres) | Violation writes fall back to JSONL flat file (`logs/routing-violations.jsonl`) automatically. No failure propagated. | N/A |
| `PIPELINE_ACTIVE_SKILL` unset | Defaults to `conversation_mode`. Applies `conversation_mode` tier limits. Logs nothing unless a violation fires. | N/A |
| Skill file missing (`skills/<name>/SKILL.md` not found) | Defaults to `conversation_mode` operation class. Writes `missing_skill_declaration` violation. | Add the skill file or add `operation_class` frontmatter. |

**No silent escalation policy (explicit):** Under no circumstances does a local model failure cause silent promotion to a higher Anthropic tier. The options are: retry with simplified prompt (once), escalate to haiku with violation logged, or block. Escalating to Sonnet without a logged violation is never an acceptable outcome.

## Telemetry Schema

### Postgres tables

```sql
-- All tool calls (for tier-distribution reporting)
CREATE TABLE routing_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tool        TEXT NOT NULL,
  model       TEXT,
  skill       TEXT NOT NULL,
  operation_class TEXT NOT NULL,
  prompt_bytes INTEGER,
  violation   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX routing_events_ts_idx ON routing_events (ts);
CREATE INDEX routing_events_skill_idx ON routing_events (skill);
CREATE INDEX routing_events_violation_idx ON routing_events (violation) WHERE violation = TRUE;

-- Violation detail (written at block time by PreToolUse hook)
CREATE TABLE routing_violations (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type        TEXT NOT NULL,          -- tier_mismatch | universal_floor | direct_write
                                      --   chain_dispatch | in_context_draft
                                      --   local_model_fallback | missing_skill_declaration
  tool        TEXT,
  model       TEXT,
  skill       TEXT NOT NULL,
  operation_class TEXT,
  detail      JSONB                   -- type-specific fields (pattern, bytes, word_count, etc.)
);

CREATE INDEX routing_violations_ts_idx ON routing_violations (ts);
CREATE INDEX routing_violations_type_idx ON routing_violations (type);
```

**Retention:** `routing_events` rows older than 90 days are deleted by a cleanup query run by `scripts/pipeline-routing-report.js` at report time. `routing_violations` rows are retained indefinitely (violations are decisions-level data).

### JSONL alternative (knowledge.tier = files)

File: `logs/routing-events.jsonl`
File: `logs/routing-violations.jsonl`

Each line is a minified JSON object matching the Postgres column set. The reporting script reads whichever file exists.

### Queries surfaced in `/pipeline:finish`

`scripts/pipeline-routing-report.js` runs these queries and includes output in the ship summary:

```sql
-- Tier distribution since last report
SELECT operation_class, COUNT(*) AS calls
FROM routing_events
WHERE ts > NOW() - INTERVAL '7 days'
GROUP BY operation_class ORDER BY calls DESC;

-- Violation breakdown
SELECT type, COUNT(*) AS count, MAX(ts) AS last_seen
FROM routing_violations
WHERE ts > NOW() - INTERVAL '7 days'
GROUP BY type ORDER BY count DESC;

-- Top violating skills
SELECT skill, COUNT(*) AS violations
FROM routing_violations
WHERE ts > NOW() - INTERVAL '7 days'
GROUP BY skill ORDER BY violations DESC LIMIT 5;
```

## Plugin Distribution

The following files ship in the Pipeline plugin or are generated per-project by `/pipeline:init`:

**Plugin repo (ships in `.claude-plugin/` or `scripts/`):**

| File | Purpose |
|---|---|
| `scripts/hooks/routing-check.js` | PreToolUse hook — tier enforcement |
| `scripts/hooks/routing-log.js` | PostToolUse hook — telemetry append |
| `scripts/hooks/routing-stop.js` | Stop hook — in-context draft scanner |
| `scripts/lib/local-model-adapter.js` | Adapter factory + OllamaAdapter + OpenAICompatibleAdapter |
| `scripts/pipeline-routing-report.js` | Weekly tier-distribution report |
| `scripts/pipeline-init-detect.js` | Extended with local-model port probes (v2 of existing script) |
| `templates/pipeline.yml` | Updated with `routing:` block including all new fields |

**All SKILL.md files** are updated to add `operation_class` frontmatter (audit of ~22 skills; handled in a dedicated implementation session).

**Per-project (written by `/pipeline:init` Step 3b and Step 5):**

| Location | Content added |
|---|---|
| `.claude/pipeline.yml` | Full `routing:` block with `local_models`, `tier_map`, `universal_floor`, `enabled: true` |
| `.claude/settings.json` | Three hook entries (PreToolUse, PostToolUse, Stop) added to `hooks` object |

**SessionStart hook** (sets `PIPELINE_ACTIVE_SKILL`): Each pipeline command (`/pipeline:build`, `/pipeline:review`, etc.) sets this env var at its start using a `SessionStart` hook entry in `.claude/settings.json`, or alternatively by prepending `PIPELINE_ACTIVE_SKILL=<skill_name>` to the hook command. The concrete mechanism: each command's `allowed-tools` frontmatter documents the expected active-skill name, and the init step adds a per-command env-set entry to `.claude/settings.json`. The hook script reads it via `process.env`.

**Note on hook script paths:** Hook command paths use the plugin's install location. The init step resolves `$PIPELINE_DIR` (same logic as existing `$SCRIPTS_DIR` resolution) and writes absolute paths into `.claude/settings.json`. On Windows with Git Bash, paths use `/c/Users/...` forward-slash form (consistent with existing entries in `.claude/settings.json`).

**Shell environment requirement:** Hook scripts assume bash/Unix syntax and are executed by Claude Code via the configured shell. The project CLAUDE.md specifies Unix shell syntax throughout. Windows users access this via Git Bash (already required for the existing hook entries in `.claude/settings.json`). Hook scripts must not use Windows-specific path syntax or cmd.exe constructs.

## Migration and Rollback

### Enabling on an existing Pipeline project

1. Run `/pipeline:init` (interactive or `--quick`). Step 3b is new; it will trigger the local-model host detection flow. All prior steps are idempotent — previously configured sections are skipped.
2. Init writes the `routing:` block into `pipeline.yml` and adds the three hook entries to `.claude/settings.json`.
3. After init completes, run `node scripts/pipeline-lint-agents.js --check-operation-class` to identify skills lacking `operation_class` frontmatter. The linter output lists the skills that need updating.
4. Update identified skills with `operation_class` declarations before the next session.

Alternatively: `/pipeline:update routing` (a new update-command sub-flow, scoped to just the routing block) can be added as a follow-on task to avoid requiring full re-init.

### Disabling (clean rollback)

**Option 1 — Config flag (preferred):** Set `routing.enabled: false` in `.claude/pipeline.yml`. The PreToolUse hook reads this flag on every call and exits 0 immediately. No hook entries need to be removed. Re-enable by setting `true`.

**Option 2 — settings.local.json override:** Add a deny entry in `.claude/settings.local.json` to block the hook scripts from running. This requires no edits to the checked-in `settings.json`.

**Option 3 — Remove hook entries:** Edit `.claude/settings.json` and remove the three hook entries. This is the nuclear option; prefer the config flag.

No source edits to skills or commands are required for either rollback path. The `operation_class` frontmatter fields are inert if routing is disabled.

## `conversation_mode` Default Declaration

The `conversation_mode` operation class is the active class when no `/pipeline:*` command is running. Its tier list is declared in `pipeline.yml` as a special mixed entry and enforced by the hook.

```yaml
routing:
  conversation_mode:
    description: "Default when no pipeline skill is active (open conversation with Opus orchestrator)"
    tiers:
      no_llm:
        tools: [Glob, Grep, Read]               # Always allowed; no model invoked
        description: "File reads, search, deterministic lookups"
      qwen_prose:
        tools: [Agent, Task]
        max_prompt_bytes: 500
        description: "Short prose drafts: memory entries, comments, status notes"
      qwen_coder:
        tools: [Agent, Task]
        max_prompt_bytes: 1000
        description: "Code drafts, script generation, SQL/regex/YAML construction"
      haiku:
        tools: [Agent, Task]
        requires_explicit_dispatch: true
        description: "Single-file judgment where local model quality is insufficient"
      sonnet:
        tools: [Agent, Task]
        requires_explicit_dispatch: true
        justification_required: true
        description: "Explicit dispatch only: architecture review, code review, design judgment"
      opus:
        role: "conversation_only"
        description: "Read tool output, decide what to dispatch, scope subagent prompts, emit turn. NO deliverable drafting."
        blocked:
          - Edit                                 # No direct edits above line threshold
          - Write                                # No direct writes above line threshold
          - "Agent(model=sonnet) without active sonnet_review skill"
```

**Enforcement for `conversation_mode`:** The `requires_explicit_dispatch: true` tiers (haiku, sonnet) are blocked unless the dispatching context includes an explicit skill that declares those tiers. Opus dispatching Sonnet while in `conversation_mode` (no active skill) writes a violation.

## Open Questions Deferred to v2

| Item | Reason for deferral |
|---|---|
| Anthropic model abstraction (OpenRouter / model router / proxy) | Haiku/Sonnet/Opus names are hardcoded in `tier_map`. A proxy layer that routes `haiku` → any cheap model via an OpenAI-compatible endpoint is a clean abstraction point but requires zero measured need in v1. Defer until a user has a reason to swap Anthropic models. |
| MCP daemon | The Opus Practitioner explicitly recommends deferring until v1 logs prove a high-frequency violation class that skill frontmatter cannot solve. The daemon adds process-lifecycle complexity and the `pipeline-db.js` script already exists. Build only when measured. |
| Agent-tool prompt content classification | Named the LangChain-router trap by the Practitioner. Any classification in the hook reintroduces judgment behind a different name. Cut entirely from v1 and v2 planning until there is an existence proof that classification-free enforcement is insufficient. |
| "Conversation turn handling" and "Complex multi-step dispatch" grid rows | Both require runtime prompt classification to resolve (which dispatch pattern applies to this turn?). Cut from the grid; Opus handles them as `opus_orchestration`, which is already the declared default. |
| TGI and custom adapter implementations | v1 ships OllamaAdapter and OpenAICompatibleAdapter. TGI's `/generate` API is non-standard; implement when a user reports using TGI as their local host. |
| Violation embedding in RAG pipeline | `routing_violations` rows should be vectorized and searchable alongside decisions/gotchas. The embedding infrastructure exists. Wire it in after v1 telemetry proves the table is being used. |

## Implementation Roadmap

1. **Skill frontmatter audit + `operation_class` declarations** (1 Sonnet session)
   Deliverable: all ~22 SKILL.md files updated with `operation_class` field. `pipeline-lint-agents.js` extended with `--check-operation-class` flag that validates all skills declare the field and value is in the closed enum. Linter integrated into `/pipeline:lint-agents`.
   Dependency: none — this is the foundation; subsequent sessions consume the declared classes.

2. **`routing.yml` template + `pipeline-init-detect.js` extension** (1 Sonnet session)
   Deliverable: `templates/pipeline.yml` updated with full `routing:` block. `pipeline-init-detect.js` extended with local-model port probes. `local-model-adapter.js` scaffolded (OllamaAdapter and OpenAICompatibleAdapter implemented and tested against real hosts). Init Step 3b prompt templates written for all three engagement styles.
   Dependency: session 1 (needs the closed enum to populate `tier_map`).

3. **PreToolUse hook: `routing-check.js`** (1 Sonnet session)
   Deliverable: full hook script with universal floor, direct-write check, chain-dispatch check, and tier-mismatch check. PIPELINE_ACTIVE_SKILL env var wiring in each command's SessionStart hook. Hook entry added to `templates/settings.json`. Integration test: run against a known-violating tool call and verify exit-code-2 + violation record.
   Dependency: session 2 (needs `local-model-adapter.js` probe path; needs `routing.yml` schema for config loading).

4. **PostToolUse hook + telemetry schema** (0.5 Sonnet session)
   Deliverable: `routing-log.js` script. Postgres migration adding `routing_events` and `routing_violations` tables. JSONL fallback path. Migration script added to `scripts/pipeline-init-knowledge.js` (run at knowledge setup time).
   Dependency: session 3 (hooks share config-loading code from routing-check.js; refactor into `scripts/lib/routing-config.js`).

5. **Stop hook: `routing-stop.js`** (0.5 Sonnet session)
   Deliverable: stop hook script with substantive-content heuristic and configurable threshold. Unit tests for the exclusion zones (code fences, tool narration, lists). Hook entry added to settings template.
   Dependency: session 4 (shares violation write path from routing-log.js).

6. **`pipeline-routing-report.js` + `/pipeline:finish` integration** (0.5 Sonnet session)
   Deliverable: reporting script that reads Postgres or JSONL, produces tier-distribution and violation summary. Integrated as a required section in the `/pipeline:finish` ship summary. Report format: markdown table, emitted to stdout, pasted into ship summary by finish command.
   Dependency: session 4 (needs tables/JSONL to exist).

7. **Init UX + migration path** (0.5 Sonnet session)
   Deliverable: `/pipeline:init` Step 3b fully implemented with all engagement-style variants. Idempotency for re-init. `/pipeline:update routing` sub-flow for existing projects that want to enable without full re-init. docs/MANIFEST.md updated with new `routing` sections in reference and guide docs.
   Dependency: sessions 2 and 3 (init writes hooks + config).

**Total estimate: 5 Sonnet sessions.** The original daemon spec (Architecture A) was recalibrated by the Opus Skeptic to 6–9 sessions with hidden costs. D's 5-session estimate is honest: there is no MCP lifecycle, no daemon process, no stdio handler, no JSON-RPC framing. The three hooks are each under 100 lines. The adapter layer is the largest new surface and is well-scoped.
