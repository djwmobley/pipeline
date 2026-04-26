# Convention-not-reason Routing (Option D) Implementation Plan

> **For agentic workers:** Use /pipeline:build to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce tier-correct model routing by declaration at skill-authoring time (YAML frontmatter) and mechanical hook enforcement at runtime, eliminating all runtime routing judgment.

**Architecture:** Each SKILL.md gains a required `operation_class` field mapping it to a tier (e.g., `code_draft` → `qwen_coder`). A narrow PreToolUse hook reads the active skill's frontmatter via a file lookup and blocks any tool call that violates the declared tier — no prompt classification, no daemon process. PostToolUse appends telemetry and a Stop hook provides post-hoc in-context draft visibility.

**Tech Stack:** Node.js (CommonJS), pg@^8.18.0, Ollama HTTP API, OpenAI-compatible HTTP API, Claude Code hook events (PreToolUse / PostToolUse / Stop), YAML frontmatter (parsed by regex per existing shared.js convention).

**Model Routing:**
- Tasks 1, 3, 6: `script` — frontmatter edits, SQL migrations, settings.json edits are mechanical text changes; no LLM needed
- Task 2: `qwen2.5-coder:32b` — adapter pattern implementation (~200 lines Node.js)
- Task 4: `qwen2.5-coder:32b` — hook scripts (~150 lines combined Node.js)
- Task 5: `qwen2.5-coder:32b` — PostToolUse hook + init-detect extension (~120 lines)
- Task 7: `qwen2.5-coder:32b` — routing-report script (~80 lines)
- Task 8: `qwen2.5:14b` — init UX prompt templates (prose, no code logic)

**Decisions:** `docs/findings/debate-2026-04-25-routing-opus-tier.md` (Opus-tier verdict) + inline decisions below.

---

## Architectural Constraints (from recon + Opus debate verdict)

- Markdown-only Claude Code plugin. No traditional source code; validation via static linter only.
- PostgreSQL via `pg@^8.18.0` (CommonJS). All DB writes use `node scripts/pipeline-db.js` or the existing `connect()` from `scripts/lib/shared.js`.
- Embedding: Ollama `mxbai-embed-large` (existing). New local model invocations for chat completion use a separate adapter.
- pnpm package manager; `pnpm-lock.yaml` present.
- Test framework: NONE. Validation via `scripts/pipeline-lint-agents.js` (static linter) + manual hook invocation tests.
- 22 skills (`skills/*/SKILL.md`), 29 commands (`commands/*.md`), 14 top-level scripts + `scripts/lib/shared.js`.
- All scripts use `loadConfig()` / `connect()` / `c` (ANSI) / `ollamaDefaults` from `scripts/lib/shared.js`. New scripts follow this same pattern.
- Config resolution: `.claude/pipeline.yml` loaded by `findProjectRoot()` + regex extractors. NOT a YAML library. New config fields parsed using the same `getSection()` / `getInSection()` pattern already in `shared.js`.
- `PROJECT_ROOT` env var pattern required by all scripts.
- Postgres conventions: every table has `id` (PK integer), `created_at` (tz timestamp). Search tables have `embedding` + `fts_vec`. New tables (`routing_events`, `routing_violations`) follow this convention.
- Skill frontmatter today: only `name` and `description`. Three new fields added: `operation_class` (required), `allowed_models` (optional), `allowed_direct_write` (optional).
- `settings.json` today: NO hook entries. Three new hook entries added (PreToolUse, PostToolUse, Stop) pointing to absolute paths under `/c/Users/djwmo/dev/pipeline/scripts/hooks/`.
- Static linter: `scripts/pipeline-lint-agents.js` — extend with `--check-operation-class` flag.
- Hook scripts run in the Git Bash shell (Unix path syntax). All hook script paths in `settings.json` use forward-slash `/c/Users/...` form.
- Active-skill detection: **Bash-at-command-start** (pre-resolved caveat 3). Each command sets `PIPELINE_ACTIVE_SKILL=<skill_dir_name>` via a Bash invocation at the top of its execution flow. This matches the existing orientation/preflight pattern. SessionStart-per-command approach rejected (22 entries that drift independently).

---

## Debate Constraints

### Points of Agreement (all 3 Opus panelists)
- Binary rubric: violations must be prevented by architecture, not caught after the fact.
- "Conversation turn handling" and "Complex multi-step dispatch" grid rows require prompt classification — cut from v1 entirely.
- Original 4-tool MCP daemon is out of scope. Drafting tools (`draft_short`, `draft_code`) are scope leak.
- The convention must be declared in YAML and enforced by deterministic file lookup. No classifier, no judgment surface in the runtime path.
- Opus's pre-tool-call in-context drafting is the largest waste source; A/B/C miss it. D addresses it by constraining what Opus is allowed to produce via skill `operation_class` discipline.

### Critical Contested Point (resolved)
CP1 resolved in favor of Skeptic + Practitioner: intent classification at runtime is the wrong problem. D removes it by moving routing decisions to authoring time. Runtime is purely mechanical lookup.

### Invalidated Assumptions
- That Opus's pre-tool-call drafting can be intercepted by any hook. Resolution: constrain via `operation_class` discipline, surface via Stop hook as post-hoc telemetry.
- That "build cost in Sonnet sessions" is the right comparison axis. Resolution: 6-month maintenance burden dominates; D has 1 update surface vs 3 for the daemon.
- That the daemon's escalation logic is separable from the convention-not-reason axiom. Rejected — escalation is the same problem one layer down.
- That A's MCP server provides necessary routing affordances. Rejected — `scripts/pipeline-db.js` already exists.

### Risk Register (must be mitigated in plan)
| Risk | Required Mitigation | Task |
|------|---------------------|------|
| `operation_class` declarations drift out of sync with actual skill behavior | Linter validates every skill declares `operation_class` and value is in closed enum | Task 1 |
| PreToolUse false positives on Bash containing SQL keywords | Anchor regex on `^psql\s` and full patterns — high-confidence, narrow; never classify content | Task 4 |
| Opus works around hook by avoiding active skill | Hook defaults to `conversation_mode` with strict limits when no active skill detected | Task 4 |
| New skills ship without `operation_class` | Linter blocks commit if any skill lacks `operation_class` | Task 1 |
| `routing_violations` grows unbounded | 90-day retention cleanup in reporting script | Task 7 |
| Telemetry never gets read | Surface in `/pipeline:finish` as required section | Task 7 |
| `operation_class` taxonomy becomes a drift surface (new classes invented per-skill) | Closed enum in `pipeline.yml` `routing.tier_map`; linter validates against this list | Tasks 1 + 6 |
| Direct Edit/Write threshold fails for legitimate inline writes | Per-skill `allowed-direct-write: true` override; audit usage in weekly report | Task 4 |

### Decisions for This Feature
- DECISION-001: `operation_class` naming (not `allowed-models`) — Practitioner naming wins; more semantically rich; one canonical name maps to a tier, allowing tier policy changes without per-skill edits. Invalidate if: new operation class is needed that doesn't cleanly map to a single tier.
- DECISION-002: Postgres telemetry (not JSONL-only) — Skeptic durability wins; routing_events + routing_violations survive `/clear`, are queryable, embeddable. JSONL fallback when `knowledge.tier != postgres`. Invalidate if: user never runs Postgres-tier projects.
- DECISION-003: Bash-at-command-start for active-skill detection — Pre-resolved caveat 3. Rejected: SessionStart-per-command (22 hook entries that drift independently). Each command file gets a Bash block at top that exports `PIPELINE_ACTIVE_SKILL`.
- DECISION-004: Hook fails open on crash (non-zero exit without output) — Claude Code falls through on hook crash; log to `logs/routing-hook-errors.log` and do not block work. Intentional — hook bugs must not prevent development. Invalidate if: Claude Code changes fail-open behavior.
- DECISION-005: No silent escalation to Sonnet on local model failure — Options are retry once, escalate to Haiku with violation logged, or block. Silent Sonnet promotion is never acceptable. Invalidate if: Haiku becomes unavailable.

---

## File Structure

### New Files (create)
```
scripts/hooks/routing-check.js          # PreToolUse hook — tier enforcement
scripts/hooks/routing-log.js            # PostToolUse hook — telemetry append
scripts/hooks/routing-stop.js           # Stop hook — in-context draft scanner
scripts/lib/local-model-adapter.js      # Adapter factory + OllamaAdapter + OpenAICompatibleAdapter
scripts/lib/routing-config.js           # Shared config loader for hooks (cached)
scripts/pipeline-routing-report.js      # Weekly tier-distribution + violation report
logs/.gitkeep                           # Ensure logs/ dir exists in repo
```

### Modified Files (extend)
```
skills/auditing/SKILL.md                # Add operation_class frontmatter
skills/architecture/SKILL.md            # Add operation_class frontmatter
skills/brainstorming/SKILL.md           # Add operation_class frontmatter
skills/building/SKILL.md                # Add operation_class frontmatter
skills/checkpoints/SKILL.md             # Add operation_class frontmatter
skills/compliance/SKILL.md              # Add operation_class frontmatter
skills/dashboard/SKILL.md               # Add operation_class frontmatter
skills/debate/SKILL.md                  # Add operation_class frontmatter
skills/debugging/SKILL.md               # Add operation_class frontmatter
skills/github-tracking/SKILL.md         # Add operation_class frontmatter
skills/init-azure-devops/SKILL.md       # Add operation_class frontmatter
skills/lint-agents/SKILL.md             # Add operation_class frontmatter
skills/markdown-review/SKILL.md         # Add operation_class frontmatter
skills/orientation/SKILL.md             # Add operation_class frontmatter
skills/planning/SKILL.md                # Add operation_class frontmatter
skills/purpleteam/SKILL.md              # Add operation_class frontmatter
skills/qa/SKILL.md                      # Add operation_class frontmatter
skills/redteam/SKILL.md                 # Add operation_class frontmatter
skills/remediation/SKILL.md             # Add operation_class frontmatter
skills/reviewing/SKILL.md               # Add operation_class frontmatter + allowed_models: [sonnet]
skills/tdd/SKILL.md                     # Add operation_class frontmatter
skills/verification/SKILL.md            # Add operation_class frontmatter
scripts/pipeline-lint-agents.js         # Add --check-operation-class flag and validation
scripts/pipeline-init-detect.js         # Add local-model port probes (Step 3b)
scripts/pipeline-init-knowledge.js      # Add routing_events + routing_violations table migration
templates/pipeline.yml                  # Add full routing: block with all new fields
.claude/settings.json                   # Add three hook entries + permissions for new scripts
commands/*.md (all 29)                  # Add PIPELINE_ACTIVE_SKILL= Bash block at command start
```

---

## Tasks

### Task 1: Skill Frontmatter Audit — operation_class Declarations

**Model:** script (mechanical text edit; no LLM; use Edit tool with predetermined values)
**TDD:** optional

**Files:**
- Modify: all 22 `skills/*/SKILL.md` files (frontmatter only)
- Modify: `scripts/pipeline-lint-agents.js` (add `--check-operation-class` validation)

**operation_class assignments (authoritative list):**

| Skill | operation_class | allowed_models | allowed_direct_write |
|-------|----------------|---------------|---------------------|
| auditing | `sonnet_review` | `[sonnet]` | false |
| architecture | `sonnet_review` | `[sonnet]` | false |
| brainstorming | `haiku_judgment` | | false |
| building | `code_draft` | | false |
| checkpoints | `script_exec` | | false |
| compliance | `haiku_judgment` | | false |
| dashboard | `script_exec` | | false |
| debate | `sonnet_review` | `[sonnet]` | false |
| debugging | `haiku_judgment` | | false |
| github-tracking | `script_exec` | | false |
| init-azure-devops | `code_draft` | `[sonnet]` | true |
| lint-agents | `script_exec` | | false |
| markdown-review | `haiku_judgment` | | false |
| orientation | `script_exec` | | false |
| planning | `sonnet_review` | `[sonnet]` | true |
| purpleteam | `sonnet_review` | `[sonnet]` | false |
| qa | `haiku_judgment` | | false |
| redteam | `sonnet_review` | `[sonnet]` | false |
| remediation | `code_draft` | `[sonnet]` | false |
| reviewing | `sonnet_review` | `[sonnet]` | false |
| tdd | `code_draft` | | false |
| verification | `haiku_judgment` | | false |

- [ ] **Step 1: Add operation_class to each SKILL.md**

For each skill in the table above, add the three new fields immediately after the `description:` line. Example for `skills/building/SKILL.md`:

```yaml
---
name: building
description: Subagent-driven plan execution with post-task review
operation_class: code_draft
allowed_models: []
allowed_direct_write: false
---
```

Example for `skills/reviewing/SKILL.md` (legitimate Sonnet use):

```yaml
---
name: reviewing
description: Per-change quality review process — config-driven criteria, severity tiers, non-negotiable filtering
operation_class: sonnet_review
allowed_models: [sonnet]
allowed_direct_write: false
---
```

Example for `skills/planning/SKILL.md` (writes large structural outputs):

```yaml
---
name: planning
description: Create implementation plans from specs — bite-sized tasks, file structure, build sequence, model routing
operation_class: sonnet_review
allowed_models: [sonnet]
allowed_direct_write: true
---
```

Apply all 22 edits. Use the Edit tool for each file individually.

- [ ] **Step 2: Extend pipeline-lint-agents.js with --check-operation-class**

Add a new `checkOperationClass` function and a `check-operation-class` sub-command to `scripts/pipeline-lint-agents.js`. The valid enum is defined as a constant in the script; the linter does NOT read it from `pipeline.yml` (the script has no project root context, and the enum is stable enough to maintain inline).

Add after the existing `SECTION_LEVEL_EXEMPTIONS` constant:

```js
const VALID_OPERATION_CLASSES = new Set([
  'opus_orchestration',
  'sonnet_review',
  'haiku_judgment',
  'code_draft',
  'short_draft',
  'bulk_classify',
  'script_exec',
  'conversation_mode',
]);
```

Add the `checkOperationClass` function that:
1. Globs all `skills/*/SKILL.md` files under `PLUGIN_ROOT`
2. For each, reads the file and parses frontmatter between the first two `---` delimiters using a regex: `/^operation_class:\s*(\S+)/m`
3. Collects errors for: missing `operation_class` field; value not in `VALID_OPERATION_CLASSES`
4. Prints a summary table and exits 1 if any errors found

```js
function checkOperationClass() {
  const skillsDir = path.join(PLUGIN_ROOT, 'skills');
  const skillDirs = fs.readdirSync(skillsDir).filter(d =>
    fs.statSync(path.join(skillsDir, d)).isDirectory()
  );

  const errors = [];
  const results = [];

  for (const dir of skillDirs) {
    const skillFile = path.join(skillsDir, dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      errors.push({ skill: dir, error: 'SKILL.md not found' });
      continue;
    }
    const content = fs.readFileSync(skillFile, 'utf8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      errors.push({ skill: dir, error: 'No YAML frontmatter found' });
      continue;
    }
    const fm = fmMatch[1];
    const ocMatch = fm.match(/^operation_class:\s*(\S+)/m);
    if (!ocMatch) {
      errors.push({ skill: dir, error: 'Missing operation_class field' });
      continue;
    }
    const oc = ocMatch[1];
    if (!VALID_OPERATION_CLASSES.has(oc)) {
      errors.push({ skill: dir, error: `Invalid operation_class: "${oc}"` });
      continue;
    }
    results.push({ skill: dir, operation_class: oc });
  }

  // Print results
  for (const r of results) {
    console.log(c.green('  PASS') + `  ${r.skill} → ${r.operation_class}`);
  }
  for (const e of errors) {
    console.log(c.red('  FAIL') + `  ${e.skill}: ${e.error}`);
  }

  if (errors.length > 0) {
    console.log(c.bold(c.red(`\n${errors.length} skill(s) failed operation_class check.`)));
    process.exit(1);
  }
  console.log(c.bold(c.green(`\nAll ${results.length} skills have valid operation_class.`)));
}
```

Add the `check-operation-class` sub-command to the main dispatch block.

- [ ] **Step 3: Verify linter passes**

```bash
PROJECT_ROOT=/c/Users/djwmo/dev/pipeline node /c/Users/djwmo/dev/pipeline/scripts/pipeline-lint-agents.js check-operation-class
```

Expected: `All 22 skills have valid operation_class.` with exit code 0.

- [ ] **Step 4: Commit**

```bash
git add skills/*/SKILL.md scripts/pipeline-lint-agents.js
git commit -m "feat(routing): add operation_class frontmatter to all 22 skills + linter check"
```

---

### Task 2: Local Model Adapter Library

**Model:** qwen2.5-coder:32b
**TDD:** optional (validated via manual probe test against live Ollama)

**Files:**
- Create: `scripts/lib/local-model-adapter.js`

- [ ] **Step 1: Create scripts/lib/local-model-adapter.js**

The file implements the factory + two adapter classes. No external dependencies — use Node.js built-in `http` and `https` modules only (consistent with existing `ollamaEmbed` in `shared.js`).

```js
'use strict';
/**
 * local-model-adapter.js — Host-agnostic local model completion adapter
 *
 * v1 implements: OllamaAdapter, OpenAICompatibleAdapter
 * Custom adapters: implement LocalModelAdapter interface, place in
 *   scripts/lib/adapters/<name>-adapter.js, register in ADAPTER_MAP below.
 *
 * Usage:
 *   const { getAdapter } = require('./local-model-adapter');
 *   const adapter = getAdapter('ollama');
 *   const models = await adapter.listModels({ endpoint: 'http://localhost:11434', modelName: '', apiProtocol: 'ollama_native', timeoutMs: 5000, maxRetries: 1 });
 *   const text = await adapter.complete(cfg, 'Write a short commit message.', { maxTokens: 100, temperature: 0.2 });
 */

const http  = require('http');
const https = require('https');

// ─── Error types ─────────────────────────────────────────────────────────────

class LocalModelUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'LocalModelUnavailableError'; }
}
class LocalModelBadOutputError extends Error {
  constructor(message) { super(message); this.name = 'LocalModelBadOutputError'; }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpRequest(url, method, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method,
      headers: bodyStr
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
        : {},
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function httpRequestWithRetry(url, method, body, cfg) {
  const timeoutMs = cfg.timeoutMs || 30000;
  const maxRetries = cfg.maxRetries !== undefined ? cfg.maxRetries : 2;
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await httpRequest(url, method, body, timeoutMs);
    } catch (e) {
      lastErr = e;
      // Only retry on network errors (ECONNREFUSED, ETIMEDOUT, ECONNRESET)
      if (e.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(e.code)) continue;
      if (e.message && e.message.includes('timed out')) continue;
      throw e; // Not a transient error — bubble immediately
    }
  }
  throw new LocalModelUnavailableError(`Host unreachable at ${url}: ${lastErr.message}`);
}

// ─── OllamaAdapter ───────────────────────────────────────────────────────────

const OllamaAdapter = {
  hostType: 'ollama',

  async probe(cfg) {
    const url = `${cfg.endpoint}/api/tags`;
    let res;
    try {
      res = await httpRequestWithRetry(url, 'GET', null, cfg);
    } catch (e) {
      throw new LocalModelUnavailableError(`Ollama not reachable at ${cfg.endpoint}: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`Ollama /api/tags returned ${res.status}`);
    }
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelUnavailableError(`Ollama /api/tags returned non-JSON`);
    }
    if (!cfg.modelName) return; // Just checking host reachability
    const names = (parsed.models || []).map(m => m.name);
    if (!names.some(n => n === cfg.modelName || n.startsWith(cfg.modelName + ':'))) {
      throw new LocalModelUnavailableError(
        `Model "${cfg.modelName}" not found on Ollama. Available: ${names.join(', ')}\n` +
        `Pull it with: ollama pull ${cfg.modelName}`
      );
    }
  },

  async listModels(cfg) {
    const url = `${cfg.endpoint}/api/tags`;
    const res = await httpRequestWithRetry(url, 'GET', null, cfg);
    if (res.status !== 200) return [];
    try {
      const parsed = JSON.parse(res.body);
      return (parsed.models || []).map(m => m.name);
    } catch (_) { return []; }
  },

  async complete(cfg, prompt, opts = {}) {
    const url = `${cfg.endpoint}/api/generate`;
    const body = {
      model:  cfg.modelName,
      prompt,
      stream: false,
      options: {
        ...(opts.maxTokens  ? { num_predict:  opts.maxTokens }  : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : { temperature: 0.2 }),
      },
      ...(opts.system ? { system: opts.system } : {}),
    };
    let res;
    try {
      res = await httpRequestWithRetry(url, 'POST', body, cfg);
    } catch (e) {
      if (e instanceof LocalModelUnavailableError) throw e;
      throw new LocalModelUnavailableError(`Ollama request failed: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`Ollama /api/generate returned ${res.status}: ${res.body.slice(0, 200)}`);
    }
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelBadOutputError(`Ollama returned non-JSON response`);
    }
    if (!parsed.response || parsed.response.trim().length === 0) {
      throw new LocalModelBadOutputError(`Ollama returned empty response for model ${cfg.modelName}`);
    }
    return parsed.response;
  },
};

// ─── OpenAICompatibleAdapter ─────────────────────────────────────────────────

const OpenAICompatibleAdapter = {
  hostType: 'openai_compatible',

  async probe(cfg) {
    const url = `${cfg.endpoint}/v1/models`;
    let res;
    try {
      res = await httpRequestWithRetry(url, 'GET', null, cfg);
    } catch (e) {
      throw new LocalModelUnavailableError(`OpenAI-compatible host not reachable at ${cfg.endpoint}: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`${cfg.endpoint}/v1/models returned ${res.status}`);
    }
    if (!cfg.modelName) return;
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelUnavailableError(`${cfg.endpoint}/v1/models returned non-JSON`);
    }
    const ids = (parsed.data || []).map(m => m.id);
    if (!ids.includes(cfg.modelName)) {
      throw new LocalModelUnavailableError(
        `Model "${cfg.modelName}" not found. Available: ${ids.join(', ')}`
      );
    }
  },

  async listModels(cfg) {
    const url = `${cfg.endpoint}/v1/models`;
    try {
      const res = await httpRequestWithRetry(url, 'GET', null, cfg);
      if (res.status !== 200) return [];
      const parsed = JSON.parse(res.body);
      return (parsed.data || []).map(m => m.id);
    } catch (_) { return []; }
  },

  async complete(cfg, prompt, opts = {}) {
    const url = `${cfg.endpoint}/v1/chat/completions`;
    const body = {
      model:    cfg.modelName,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: prompt },
      ],
      ...(opts.maxTokens    ? { max_tokens:   opts.maxTokens  } : {}),
      temperature: opts.temperature !== undefined ? opts.temperature : 0.2,
    };
    let res;
    try {
      res = await httpRequestWithRetry(url, 'POST', body, cfg);
    } catch (e) {
      if (e instanceof LocalModelUnavailableError) throw e;
      throw new LocalModelUnavailableError(`OpenAI-compatible request failed: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`/v1/chat/completions returned ${res.status}: ${res.body.slice(0, 200)}`);
    }
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelBadOutputError(`OpenAI-compatible host returned non-JSON`);
    }
    const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
    if (!content || content.trim().length === 0) {
      throw new LocalModelBadOutputError(`OpenAI-compatible host returned empty content`);
    }
    return content;
  },
};

// ─── Factory ─────────────────────────────────────────────────────────────────

const ADAPTER_MAP = {
  ollama:           OllamaAdapter,
  openai_compatible: OpenAICompatibleAdapter,
  // Community adapters: add entries here keyed by host_type string
  // e.g., custom: require('./adapters/custom-adapter'),
};

function getAdapter(hostType) {
  const adapter = ADAPTER_MAP[hostType];
  if (!adapter) {
    throw new Error(
      `Unknown local model host type: "${hostType}". ` +
      `Valid types: ${Object.keys(ADAPTER_MAP).join(', ')}`
    );
  }
  return adapter;
}

module.exports = {
  getAdapter,
  LocalModelUnavailableError,
  LocalModelBadOutputError,
  OllamaAdapter,
  OpenAICompatibleAdapter,
};
```

- [ ] **Step 2: Smoke test adapter probe against local Ollama (if running)**

```bash
node -e "
const { getAdapter } = require('/c/Users/djwmo/dev/pipeline/scripts/lib/local-model-adapter');
const a = getAdapter('ollama');
a.listModels({ endpoint: 'http://localhost:11434', modelName: '', apiProtocol: 'ollama_native', timeoutMs: 5000, maxRetries: 1 })
  .then(models => console.log('Models:', models))
  .catch(e => console.log('Ollama not running or no models (expected if offline):', e.message));
"
```

Expected: prints model list or prints error message (not a crash).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/local-model-adapter.js
git commit -m "feat(routing): add local-model-adapter.js — OllamaAdapter + OpenAICompatibleAdapter"
```

---

### Task 3: Routing Config Shared Module

**Model:** script (mechanical extraction from shared.js patterns)
**TDD:** optional

**Files:**
- Create: `scripts/lib/routing-config.js`

This module is shared by all three hooks. It caches the config per process (hooks are short-lived processes, so this is per-invocation caching) and provides frontmatter parsing helpers.

- [ ] **Step 1: Create scripts/lib/routing-config.js**

```js
'use strict';
/**
 * routing-config.js — Shared config + frontmatter helpers for routing hooks
 *
 * Used by: routing-check.js, routing-log.js, routing-stop.js
 * No external dependencies. Uses same regex-based config parsing as shared.js.
 */

const fs   = require('fs');
const path = require('path');

// Cache within a single process lifetime (hooks are short-lived)
let _config = null;
let _fmCache = {};
let _pluginDir = null;

function getPluginDir() {
  if (_pluginDir) return _pluginDir;
  // Hook scripts live at scripts/hooks/; plugin dir is two levels up
  _pluginDir = process.env.PIPELINE_DIR || path.resolve(__dirname, '..', '..');
  return _pluginDir;
}

function getProjectRoot() {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadConfig() {
  if (_config) return _config;
  const root = getProjectRoot();
  const configPath = path.join(root, '.claude', 'pipeline.yml');
  if (!fs.existsSync(configPath)) {
    _config = { routing: { enabled: false } };
    return _config;
  }
  const content = fs.readFileSync(configPath, 'utf8');

  const getSection = (section) => {
    const match = content.match(new RegExp(`^${section}:.*\\n((?:[ \\t]+.*\\n?)*)`, 'm'));
    return match ? match[1] : '';
  };
  const getInSection = (section, key) => {
    const sectionContent = getSection(section);
    const match = sectionContent.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?`, 'm'));
    return match ? match[1].trim() : null;
  };
  const getNestedSection = (section, subsection) => {
    const sec = getSection(section);
    const match = sec.match(new RegExp(`^\\s*${subsection}:.*\\n((?:\\s{4,}.*\\n?)*)`, 'm'));
    return match ? match[1] : '';
  };

  const knowledgeTier = getInSection('knowledge', 'tier') || 'files';
  const routingEnabled = getInSection('routing', 'enabled');
  const chainThreshold = parseInt(getInSection('routing', 'chain_dispatch_threshold') || '2000');
  const writeThreshold = parseInt(getInSection('routing', 'direct_write_line_threshold') || '10');
  const stopThreshold  = parseInt(getInSection('routing', 'stop_hook_threshold') || '150');

  // Parse bash_block_patterns from universal_floor section
  const floorSection = getNestedSection('routing', 'universal_floor');
  const bashPatterns = [];
  const bpMatches = floorSection.matchAll(/^\\s*-\\s*"([^"]+)"/gm);
  for (const m of bpMatches) bashPatterns.push(m[1]);

  // Parse tier_map
  const tierMapSection = getNestedSection('routing', 'tier_map');
  const tierMap = {};
  for (const m of tierMapSection.matchAll(/^\\s*(\\w+):\\s*(\\S+)/gm)) {
    tierMap[m[1]] = m[2];
  }

  // Parse local_models.prose and local_models.coder
  const localProseEndpoint = getInSection('local_models', 'endpoint') || null;

  _config = {
    knowledge: { tier: knowledgeTier },
    routing: {
      enabled: routingEnabled !== 'false',
      chain_dispatch_threshold: chainThreshold,
      direct_write_line_threshold: writeThreshold,
      stop_hook_threshold: stopThreshold,
      tier_map: tierMap,
      universal_floor: {
        bash_block_patterns: bashPatterns.length > 0 ? bashPatterns : [
          // Defaults if not configured in pipeline.yml
          '^psql\\s',
          'INSERT INTO\\s',
          'UPDATE\\s+\\w+\\s+SET\\s',
          'DROP TABLE\\s',
          'DELETE FROM\\s+\\w+\\s*$',
        ],
      },
    },
    _root: root,
    _configPath: configPath,
  };
  return _config;
}

function loadSkillFrontmatter(skillName) {
  if (_fmCache[skillName]) return _fmCache[skillName];

  const pluginDir = getPluginDir();
  const skillFile = path.join(pluginDir, 'skills', skillName, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    const fm = { operation_class: 'conversation_mode', allowed_direct_write: false, _missing: true };
    _fmCache[skillName] = fm;
    return fm;
  }

  const content = fs.readFileSync(skillFile, 'utf8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    const fm = { operation_class: 'conversation_mode', allowed_direct_write: false, _malformed: true };
    _fmCache[skillName] = fm;
    return fm;
  }

  const fm = fmMatch[1];
  const ocMatch = fm.match(/^operation_class:\s*(\S+)/m);
  const adwMatch = fm.match(/^allowed_direct_write:\s*(\S+)/m);
  const amMatch = fm.match(/^allowed_models:\s*\[([^\]]*)\]/m);

  const result = {
    operation_class:     ocMatch  ? ocMatch[1]  : 'conversation_mode',
    allowed_direct_write: adwMatch ? adwMatch[1] === 'true' : false,
    allowed_models:       amMatch  ? amMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [],
  };
  _fmCache[skillName] = result;
  return result;
}

function resolveAllowedModels(tier, overrides) {
  // Tier-to-model-name mapping (what Claude Code passes as `model` in tool_input)
  const TIER_MODELS = {
    opus:       ['claude-opus-4-5', 'claude-opus-4', 'claude-3-opus-20240229', 'opus'],
    sonnet:     ['claude-sonnet-4-5', 'claude-sonnet-4', 'claude-3-5-sonnet-20241022', 'sonnet'],
    haiku:      ['claude-haiku-4-5', 'claude-haiku-3', 'claude-3-haiku-20240307', 'haiku'],
    qwen_coder: ['qwen2.5-coder:32b', 'qwen2.5-coder'],
    qwen_prose: ['qwen2.5:14b', 'qwen2.5'],
    no_llm:     [],
    mixed:      [], // conversation_mode — handled separately
  };
  const base = TIER_MODELS[tier] || [];
  // overrides are shorthand names (e.g., 'sonnet') — expand them
  const expanded = [];
  for (const o of (overrides || [])) {
    expanded.push(...(TIER_MODELS[o] || [o]));
  }
  return [...new Set([...base, ...expanded])];
}

function writeViolation(record, config) {
  const cfg = config || loadConfig();
  const ts = new Date().toISOString();
  const full = { ts, ...record };
  const line = JSON.stringify(full);

  if (cfg.knowledge.tier === 'postgres') {
    // Write to Postgres via pipeline-db.js to avoid inline SQL
    const { execFileSync } = require('child_process');
    try {
      execFileSync('node', [
        path.join(getPluginDir(), 'scripts', 'pipeline-db.js'),
        'routing-violation',
        JSON.stringify(full),
      ], { cwd: cfg._root || getProjectRoot(), encoding: 'utf8' });
    } catch (_) {
      // Fall through to JSONL on DB write failure
      appendJsonl(path.join(cfg._root || getProjectRoot(), 'logs', 'routing-violations.jsonl'), line);
    }
  } else {
    appendJsonl(path.join(cfg._root || getProjectRoot(), 'logs', 'routing-violations.jsonl'), line);
  }
}

function appendJsonl(filePath, line) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch (_) {
    // Best-effort; do not crash the hook
  }
}

function countLines(text) {
  if (!text) return 0;
  return (text.match(/\n/g) || []).length + 1;
}

module.exports = {
  loadConfig,
  loadSkillFrontmatter,
  resolveAllowedModels,
  writeViolation,
  appendJsonl,
  countLines,
  getProjectRoot,
  getPluginDir,
};
```

- [ ] **Step 2: Verify module loads without error**

```bash
node -e "const rc = require('/c/Users/djwmo/dev/pipeline/scripts/lib/routing-config.js'); console.log('loaded ok:', typeof rc.loadConfig);"
```

Expected: `loaded ok: function`

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/routing-config.js
git commit -m "feat(routing): add routing-config.js shared module for hooks"
```

---

### Task 4: PreToolUse Hook — routing-check.js

**Model:** qwen2.5-coder:32b
**TDD:** optional (validated via manual invocation test)

**Files:**
- Create: `scripts/hooks/routing-check.js`
- Create: `scripts/hooks/` directory

- [ ] **Step 1: Create scripts/hooks/ directory and routing-check.js**

```bash
mkdir -p /c/Users/djwmo/dev/pipeline/scripts/hooks
```

```js
#!/usr/bin/env node
'use strict';
/**
 * routing-check.js — PreToolUse hook for convention-not-reason routing enforcement
 *
 * Input:  JSON on stdin: { tool_name: string, tool_input: object }
 * Output: exit 0 (allow), exit 2 with message on stdout (block)
 * Errors: logged to logs/routing-hook-errors.log; hook crashes are fail-open
 *         (Claude Code falls through on hook error — this is intentional).
 *
 * Environment:
 *   PIPELINE_ACTIVE_SKILL — skill directory name (e.g., "building"). If unset: "conversation_mode".
 *   PIPELINE_DIR          — root of pipeline plugin (default: two levels above this script).
 *   PROJECT_ROOT          — root of the user project (default: walk up from cwd).
 */

const fs   = require('fs');
const path = require('path');

const {
  loadConfig,
  loadSkillFrontmatter,
  resolveAllowedModels,
  writeViolation,
  countLines,
  getProjectRoot,
  getPluginDir,
} = require('../lib/routing-config');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let input;
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    input = JSON.parse(raw);
  } catch (e) {
    logError(`Failed to parse stdin: ${e.message}`);
    process.exit(0); // Fail open — malformed input should not block work
  }

  const toolName  = input.tool_name  || '';
  const toolInput = input.tool_input || {};

  const activeSkill = process.env.PIPELINE_ACTIVE_SKILL || 'conversation_mode';

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    logError(`Failed to load config: ${e.message}`);
    process.exit(0); // Fail open — config errors must not block work
  }

  // Routing disabled — allow all
  if (!config.routing || config.routing.enabled === false) {
    process.exit(0);
  }

  try {
    // ── Universal floor: Bash SQL/psql patterns ───────────────────────────────
    if (toolName === 'Bash') {
      const cmd = toolInput.command || '';
      const patterns = config.routing.universal_floor.bash_block_patterns;
      for (const pat of patterns) {
        if (new RegExp(pat).test(cmd)) {
          writeViolation({
            type: 'universal_floor',
            pattern: pat,
            tool: toolName,
            skill: activeSkill,
            detail: { command_excerpt: cmd.slice(0, 120) },
          }, config);
          block(
            `ROUTING BLOCK: Direct SQL/psql is not allowed.\n` +
            `Pattern matched: ${pat}\n` +
            `Use: node scripts/pipeline-db.js <verb> <args>\n` +
            `To disable routing enforcement: set routing.enabled: false in .claude/pipeline.yml`
          );
        }
      }
    }

    // ── Universal floor: Edit/Write above line threshold ──────────────────────
    if (toolName === 'Edit' || toolName === 'Write') {
      const content = toolInput.new_string || toolInput.content || '';
      const lineCount = countLines(content);
      const threshold = config.routing.direct_write_line_threshold || 10;
      if (lineCount > threshold) {
        const skillFm = loadSkillFrontmatter(activeSkill);
        if (!skillFm.allowed_direct_write) {
          writeViolation({
            type: 'direct_write',
            tool: toolName,
            skill: activeSkill,
            operation_class: skillFm.operation_class,
            detail: { lines: lineCount, threshold },
          }, config);
          block(
            `ROUTING BLOCK: Direct ${toolName} of ${lineCount} lines without allowed_direct_write.\n` +
            `Active skill: ${activeSkill} (operation_class: ${skillFm.operation_class})\n` +
            `Dispatch a qwen draft subagent first, then write its output.\n` +
            `Or set allowed_direct_write: true in skills/${activeSkill}/SKILL.md if this skill legitimately writes large outputs.`
          );
        }
      }
    }

    // ── Chain-the-dispatch: Agent/Task with large prompt ──────────────────────
    if (toolName === 'Agent' || toolName === 'Task') {
      const promptBytes = Buffer.byteLength(toolInput.prompt || '', 'utf8');
      const chainThreshold = config.routing.chain_dispatch_threshold || 2000;
      if (promptBytes > chainThreshold && activeSkill !== 'conversation_mode') {
        const skillFm = loadSkillFrontmatter(activeSkill);
        const oc = skillFm.operation_class || 'conversation_mode';
        if (oc !== 'opus_orchestration' && oc !== 'sonnet_review') {
          writeViolation({
            type: 'chain_dispatch',
            tool: toolName,
            skill: activeSkill,
            operation_class: oc,
            detail: { prompt_bytes: promptBytes, threshold: chainThreshold },
          }, config);
          block(
            `ROUTING BLOCK: Agent/Task prompt is ${promptBytes} bytes (threshold: ${chainThreshold}).\n` +
            `Active skill: ${activeSkill} (operation_class: ${oc})\n` +
            `Dispatch qwen to draft this prompt first, then pass its output as the subagent input.`
          );
        }
      }
    }

    // ── Tier check: Agent/Task model parameter ────────────────────────────────
    if ((toolName === 'Agent' || toolName === 'Task') && toolInput.model) {
      const skillFm = loadSkillFrontmatter(activeSkill);
      const oc = skillFm.operation_class || 'conversation_mode';
      const tier = (config.routing.tier_map || {})[oc];
      if (tier && tier !== 'mixed') {
        const allowed = resolveAllowedModels(tier, skillFm.allowed_models);
        const requested = toolInput.model;
        // Check if requested model matches any allowed name (substring match for partial names)
        const isAllowed = allowed.some(a =>
          a === requested || requested.startsWith(a) || a.startsWith(requested)
        );
        if (!isAllowed && allowed.length > 0) {
          writeViolation({
            type: 'tier_mismatch',
            tool: toolName,
            skill: activeSkill,
            operation_class: oc,
            model: requested,
            detail: { requested, allowed, tier },
          }, config);
          block(
            `ROUTING BLOCK: Model "${requested}" is not allowed for skill "${activeSkill}".\n` +
            `Declared operation_class: ${oc} → tier: ${tier}\n` +
            `Allowed models: [${allowed.join(', ')}]\n` +
            `To allow this model: add it to allowed_models: in skills/${activeSkill}/SKILL.md`
          );
        }
      }
    }

    process.exit(0); // Allow

  } catch (e) {
    logError(`Hook error in routing-check.js: ${e.message}\n${e.stack}`);
    process.exit(0); // Fail open — hook crashes must not block work
  }
}

function block(message) {
  console.log(message);
  process.exit(2);
}

function logError(message) {
  try {
    const logPath = path.join(getProjectRoot(), 'logs', 'routing-hook-errors.log');
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (_) { /* best-effort */ }
}

main().catch(e => { logError(e.message); process.exit(0); });
```

- [ ] **Step 2: Smoke test PreToolUse hook — allow case**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"node scripts/platform.js issue list"}}' | \
  PIPELINE_DIR=/c/Users/djwmo/dev/pipeline \
  PROJECT_ROOT=/c/Users/djwmo/dev/pipeline \
  node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-check.js
echo "Exit code: $?"
```

Expected: no output, exit code 0.

- [ ] **Step 3: Smoke test PreToolUse hook — universal floor block**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"psql -U postgres -d mydb -c SELECT 1"}}' | \
  PIPELINE_DIR=/c/Users/djwmo/dev/pipeline \
  PROJECT_ROOT=/c/Users/djwmo/dev/pipeline \
  node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-check.js
echo "Exit code: $?"
```

Expected: prints `ROUTING BLOCK: Direct SQL/psql...`, exit code 2.

Note: If `routing.enabled` is not set in `.claude/pipeline.yml` yet (Task 6 adds it), the hook exits 0 (routing disabled path). That is correct behavior — the routing block will activate once Task 6 writes the config.

- [ ] **Step 4: Commit**

```bash
git add scripts/hooks/routing-check.js
git commit -m "feat(routing): add PreToolUse hook routing-check.js"
```

---

### Task 5: PostToolUse Hook + Telemetry Schema

**Model:** qwen2.5-coder:32b
**TDD:** optional

**Files:**
- Create: `scripts/hooks/routing-log.js`
- Modify: `scripts/pipeline-db.js` (add `routing-violation` and `routing-event` verbs)
- Modify: `scripts/pipeline-init-knowledge.js` (add table migration)

- [ ] **Step 1: Add routing_events + routing_violations to pipeline-init-knowledge.js**

Locate the SQL migration block in `scripts/pipeline-init-knowledge.js`. Add these two tables to the migration:

```sql
-- Routing telemetry (all tool calls)
CREATE TABLE IF NOT EXISTS routing_events (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tool            TEXT NOT NULL,
  model           TEXT,
  skill           TEXT NOT NULL,
  operation_class TEXT NOT NULL,
  prompt_bytes    INTEGER,
  violation       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS routing_events_ts_idx        ON routing_events (ts);
CREATE INDEX IF NOT EXISTS routing_events_skill_idx     ON routing_events (skill);
CREATE INDEX IF NOT EXISTS routing_events_violation_idx ON routing_events (violation) WHERE violation = TRUE;

-- Routing violations (written at block time by PreToolUse hook)
CREATE TABLE IF NOT EXISTS routing_violations (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type            TEXT NOT NULL,
  tool            TEXT,
  model           TEXT,
  skill           TEXT NOT NULL,
  operation_class TEXT,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS routing_violations_ts_idx   ON routing_violations (ts);
CREATE INDEX IF NOT EXISTS routing_violations_type_idx ON routing_violations (type);
```

- [ ] **Step 2: Add routing-violation and routing-event verbs to pipeline-db.js**

These verbs are invoked by hook scripts via `node scripts/pipeline-db.js routing-violation <json>` and `node scripts/pipeline-db.js routing-event <json>`. Add them to the dispatch block in `pipeline-db.js`:

```js
case 'routing-violation': {
  // Args: JSON string of violation record
  const record = JSON.parse(args[0] || '{}');
  await client.query(
    `INSERT INTO routing_violations (ts, type, tool, model, skill, operation_class, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      record.ts || new Date().toISOString(),
      record.type || 'unknown',
      record.tool || null,
      record.model || null,
      record.skill || 'unknown',
      record.operation_class || null,
      record.detail ? JSON.stringify(record.detail) : null,
    ]
  );
  console.log('routing-violation recorded');
  break;
}
case 'routing-event': {
  const record = JSON.parse(args[0] || '{}');
  await client.query(
    `INSERT INTO routing_events (ts, tool, model, skill, operation_class, prompt_bytes, violation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      record.ts || new Date().toISOString(),
      record.tool || 'unknown',
      record.model || null,
      record.skill || 'conversation_mode',
      record.operation_class || 'conversation_mode',
      record.prompt_bytes || 0,
      record.violation === true,
    ]
  );
  break;
}
```

- [ ] **Step 3: Create scripts/hooks/routing-log.js**

```js
#!/usr/bin/env node
'use strict';
/**
 * routing-log.js — PostToolUse hook for routing telemetry
 *
 * Input:  JSON on stdin: { tool_name, tool_input, tool_output, model? }
 * Output: none (telemetry append only)
 * Fails open: any error is logged; hook never blocks.
 */

const fs   = require('fs');
const path = require('path');
const {
  loadConfig,
  loadSkillFrontmatter,
  appendJsonl,
  getProjectRoot,
  getPluginDir,
} = require('../lib/routing-config');

async function main() {
  let input;
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    input = JSON.parse(raw);
  } catch (_) { process.exit(0); }

  const toolName  = input.tool_name  || '';
  const toolInput = input.tool_input || {};
  const activeSkill = process.env.PIPELINE_ACTIVE_SKILL || 'conversation_mode';

  let config;
  try { config = loadConfig(); } catch (_) { process.exit(0); }

  if (!config.routing || config.routing.enabled === false) process.exit(0);

  const skillFm = loadSkillFrontmatter(activeSkill);
  const promptBytes = Buffer.byteLength(
    toolInput.prompt || toolInput.command || toolInput.content || '', 'utf8'
  );
  const record = {
    ts:              new Date().toISOString(),
    tool:            toolName,
    model:           toolInput.model || process.env.CLAUDE_MODEL || null,
    skill:           activeSkill,
    operation_class: skillFm.operation_class || 'conversation_mode',
    prompt_bytes:    promptBytes,
    violation:       false,
  };

  try {
    if (config.knowledge.tier === 'postgres') {
      const { execFileSync } = require('child_process');
      execFileSync('node', [
        path.join(getPluginDir(), 'scripts', 'pipeline-db.js'),
        'routing-event',
        JSON.stringify(record),
      ], { cwd: getProjectRoot(), encoding: 'utf8' });
    } else {
      appendJsonl(
        path.join(getProjectRoot(), 'logs', 'routing-events.jsonl'),
        JSON.stringify(record)
      );
    }
  } catch (_) {
    // Best-effort — telemetry loss is acceptable
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
```

- [ ] **Step 4: Smoke test PostToolUse hook**

```bash
echo '{"tool_name":"Read","tool_input":{"file_path":"CLAUDE.md"}}' | \
  PIPELINE_ACTIVE_SKILL=building \
  PIPELINE_DIR=/c/Users/djwmo/dev/pipeline \
  PROJECT_ROOT=/c/Users/djwmo/dev/pipeline \
  node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-log.js
echo "Exit code: $?"
```

Expected: exit code 0, and (if `knowledge.tier == files`) a new line in `logs/routing-events.jsonl`.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/routing-log.js scripts/pipeline-db.js scripts/pipeline-init-knowledge.js
git commit -m "feat(routing): add PostToolUse hook routing-log.js + DB verbs + table migration"
```

---

### Task 6: Stop Hook + Config Extension + settings.json Hook Entries

**Model:** qwen2.5-coder:32b (hook script); script (settings.json and pipeline.yml edits)
**TDD:** optional

**Files:**
- Create: `scripts/hooks/routing-stop.js`
- Modify: `templates/pipeline.yml` (add full routing: block)
- Modify: `.claude/settings.json` (add three hook entries + script permissions)
- Create: `logs/.gitkeep`

- [ ] **Step 1: Create scripts/hooks/routing-stop.js**

```js
#!/usr/bin/env node
'use strict';
/**
 * routing-stop.js — Stop hook for in-context draft detection (post-hoc, no blocking)
 *
 * Scans the assistant's turn text for substantive prose that should have been
 * dispatched to a lower tier. Writes a routing_violation record if threshold exceeded.
 * CANNOT block — Stop hook exit codes other than 0 are not supported by Claude Code.
 * This hook is accountability-only.
 *
 * Input:  JSON on stdin: { message: string }
 */

const fs = require('fs');
const path = require('path');
const {
  loadConfig,
  writeViolation,
  getProjectRoot,
} = require('../lib/routing-config');

// ─── Exclusion zones ──────────────────────────────────────────────────────────

function stripExcludedZones(text) {
  // 1. Remove code fences (``` ... ```)
  let t = text.replace(/```[\s\S]*?```/g, '');
  // 2. Remove blockquotes (lines starting with >)
  t = t.split('\n').filter(line => !line.match(/^\s*>/)).join('\n');
  // 3. Remove HTML <details> blocks
  t = t.replace(/<details[\s\S]*?<\/details>/gi, '');
  // 4. Remove tool-call narration lines
  t = t.split('\n').filter(line =>
    !line.match(/^(Reading|Writing|Running|Checking|Searching|Found|No |Updating|Loading)\s/)
  ).join('\n');
  // 5. Remove short list items (each item ≤ 12 words)
  t = t.split('\n').filter(line => {
    const listMatch = line.match(/^\s*[-*\d.]+\s+(.+)/);
    if (!listMatch) return true;
    const wordCount = listMatch[1].trim().split(/\s+/).length;
    return wordCount > 12; // keep only long list items
  }).join('\n');
  // 6. Remove pure file path / URL / command lines
  t = t.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.match(/^[`/\\].+[`]?$/) && !trimmed.includes(' ')) return false; // bare path
    if (trimmed.match(/^https?:\/\/\S+$/)) return false; // URL
    return true;
  }).join('\n');
  return t;
}

function countWords(text) {
  return (text.match(/\b\w+\b/g) || []).length;
}

async function main() {
  let input;
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    input = JSON.parse(raw);
  } catch (_) { process.exit(0); }

  const message = input.message || '';
  const activeSkill = process.env.PIPELINE_ACTIVE_SKILL || 'conversation_mode';

  let config;
  try { config = loadConfig(); } catch (_) { process.exit(0); }

  if (!config.routing || config.routing.enabled === false) process.exit(0);

  const threshold = config.routing.stop_hook_threshold || 150;
  const stripped  = stripExcludedZones(message);
  const wordCount = countWords(stripped);

  if (wordCount > threshold) {
    writeViolation({
      type:       'in_context_draft',
      tool:       'Stop',
      skill:      activeSkill,
      detail:     { word_count: wordCount, threshold },
    }, config);
    // No exit(2) — Stop hook cannot block
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
```

- [ ] **Step 2: Add routing: block to templates/pipeline.yml**

Add after the existing `routing:` section (which only has source_dirs and size routing today). Replace the existing `routing:` block with the extended version:

```yaml
# Size routing + convention routing
routing:
  # Size routing (unchanged)
  source_dirs: ["src/"]
  tiny_max_files: 1
  tiny_max_lines: 30
  medium_max_files: 3
  review_gate_threshold: 3   # files changed >= this requires review

  # Convention routing (Option D)
  enabled: true                          # Set false to disable all routing enforcement
  chain_dispatch_threshold: 2000         # Bytes; Agent prompt above this triggers chain-dispatch rule
  direct_write_line_threshold: 10        # Edit/Write blocked above this count without allowed_direct_write
  stop_hook_threshold: 150               # Words of non-excluded prose in a Stop hook turn before violation

  # Tier map: operation_class -> executor tier name
  tier_map:
    opus_orchestration: opus
    sonnet_review: sonnet
    haiku_judgment: haiku
    code_draft: qwen_coder
    short_draft: qwen_prose
    bulk_classify: qwen_prose
    script_exec: no_llm
    conversation_mode: mixed

  # Local model hosts — populated by /pipeline:init Step 3b
  local_models:
    prose:
      name: "qwen2.5:14b"
      host_type: "ollama"
      endpoint: "http://localhost:11434"
      api_protocol: "ollama_native"
      context_window: 8192
    coder:
      name: "qwen2.5-coder:32b"
      host_type: "ollama"
      endpoint: "http://localhost:11434"
      api_protocol: "ollama_native"
      context_window: 16384

  # Universal floor — blocked regardless of operation_class
  universal_floor:
    bash_block_patterns:
      - "^psql\\s"
      - "INSERT INTO\\s"
      - "UPDATE\\s+\\w+\\s+SET\\s"
      - "DROP TABLE\\s"
      - "DELETE FROM\\s+\\w+\\s*$"

  # conversation_mode — active when no /pipeline:* command is in flight
  conversation_mode:
    description: "Default when no pipeline skill is active"
    tiers:
      no_llm:
        tools: [Glob, Grep, Read]
        description: "File reads, search, deterministic lookups"
      qwen_prose:
        tools: [Agent, Task]
        max_prompt_bytes: 500
        description: "Short prose drafts"
      qwen_coder:
        tools: [Agent, Task]
        max_prompt_bytes: 1000
        description: "Code drafts, script generation"
      haiku:
        tools: [Agent, Task]
        requires_explicit_dispatch: true
        description: "Single-file judgment where local model quality is insufficient"
      sonnet:
        tools: [Agent, Task]
        requires_explicit_dispatch: true
        justification_required: true
        description: "Explicit dispatch only"
      opus:
        role: "conversation_only"
        description: "Read tool output, decide what to dispatch, scope prompts. NO deliverable drafting."
```

- [ ] **Step 3: Add hook entries to .claude/settings.json**

Add the three hook entries to the `hooks` object (create it if absent). Also add Bash permissions for the new scripts:

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
    ],
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
    ],
    "Stop": [
      {
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

Note: The Stop hook entry references `routing-stop.js`, not `routing-check.js`. Verify the correct script name when editing.

Also add to `permissions.allow`:
```
"Bash(node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-check.js)",
"Bash(node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-log.js)",
"Bash(node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-stop.js)",
"Bash(node /c/Users/djwmo/dev/pipeline/scripts/pipeline-routing-report.js *)"
```

- [ ] **Step 4: Create logs/.gitkeep**

```bash
mkdir -p /c/Users/djwmo/dev/pipeline/logs
touch /c/Users/djwmo/dev/pipeline/logs/.gitkeep
```

Add to `.gitignore` (if present): `logs/*.jsonl` and `logs/*.log`

- [ ] **Step 5: Verify Stop hook loads**

```bash
echo '{"message":"This is a short message."}' | \
  PIPELINE_DIR=/c/Users/djwmo/dev/pipeline \
  PROJECT_ROOT=/c/Users/djwmo/dev/pipeline \
  node /c/Users/djwmo/dev/pipeline/scripts/hooks/routing-stop.js
echo "Exit code: $?"
```

Expected: exit code 0 (word count below threshold).

- [ ] **Step 6: Commit**

```bash
git add scripts/hooks/routing-stop.js templates/pipeline.yml .claude/settings.json logs/.gitkeep
git commit -m "feat(routing): add Stop hook, routing: config block, hook entries in settings.json"
```

---

### Task 7: Reporting Script + /pipeline:finish Integration

**Model:** qwen2.5-coder:32b
**TDD:** optional

**Files:**
- Create: `scripts/pipeline-routing-report.js`
- Modify: `commands/finish.md` (add routing report section to ship summary)

- [ ] **Step 1: Create scripts/pipeline-routing-report.js**

```js
#!/usr/bin/env node
'use strict';
/**
 * pipeline-routing-report.js — Weekly tier-distribution and violation report
 *
 * Usage:
 *   PROJECT_ROOT=<path> node scripts/pipeline-routing-report.js [--days N] [--json]
 *
 * Output: markdown table to stdout (or JSON with --json)
 * Reads from: Postgres routing_events / routing_violations tables
 *             OR logs/routing-events.jsonl / logs/routing-violations.jsonl
 *
 * Also runs 90-day retention cleanup on routing_events (violations are retained forever).
 */

const fs   = require('fs');
const path = require('path');
const { loadConfig, connect, c } = require('./lib/shared');

async function main() {
  const args   = process.argv.slice(2);
  const asJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : 7;

  const config = loadConfig();

  if (config.tier === 'postgres') {
    await reportFromPostgres(config, days, asJson);
  } else {
    reportFromJsonl(config, days, asJson);
  }
}

async function reportFromPostgres(config, days, asJson) {
  const client = await connect(config);
  try {
    // 90-day retention cleanup
    await client.query(
      `DELETE FROM routing_events WHERE ts < NOW() - INTERVAL '90 days'`
    );

    const { rows: tierDist } = await client.query(`
      SELECT operation_class, COUNT(*)::int AS calls
      FROM routing_events
      WHERE ts > NOW() - INTERVAL '${days} days'
      GROUP BY operation_class ORDER BY calls DESC
    `);

    const { rows: violBreakdown } = await client.query(`
      SELECT type, COUNT(*)::int AS count, MAX(ts) AS last_seen
      FROM routing_violations
      WHERE ts > NOW() - INTERVAL '${days} days'
      GROUP BY type ORDER BY count DESC
    `);

    const { rows: topSkills } = await client.query(`
      SELECT skill, COUNT(*)::int AS violations
      FROM routing_violations
      WHERE ts > NOW() - INTERVAL '${days} days'
      GROUP BY skill ORDER BY violations DESC LIMIT 5
    `);

    if (asJson) {
      console.log(JSON.stringify({ tier_distribution: tierDist, violations: violBreakdown, top_violating_skills: topSkills }, null, 2));
    } else {
      printMarkdownReport(tierDist, violBreakdown, topSkills, days);
    }
  } finally {
    await client.end();
  }
}

function reportFromJsonl(config, days, asJson) {
  const root = config.root || process.env.PROJECT_ROOT || process.cwd();
  const eventsFile = path.join(root, 'logs', 'routing-events.jsonl');
  const violFile   = path.join(root, 'logs', 'routing-violations.jsonl');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const readJsonl = (filePath) => {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean)
      .filter(r => new Date(r.ts) >= since);
  };

  const events = readJsonl(eventsFile);
  const viols  = readJsonl(violFile);

  // Tier distribution
  const tierMap = {};
  for (const e of events) {
    tierMap[e.operation_class] = (tierMap[e.operation_class] || 0) + 1;
  }
  const tierDist = Object.entries(tierMap)
    .map(([operation_class, calls]) => ({ operation_class, calls }))
    .sort((a, b) => b.calls - a.calls);

  // Violation breakdown
  const violMap = {};
  for (const v of viols) {
    if (!violMap[v.type]) violMap[v.type] = { count: 0, last_seen: v.ts };
    violMap[v.type].count++;
    if (v.ts > violMap[v.type].last_seen) violMap[v.type].last_seen = v.ts;
  }
  const violBreakdown = Object.entries(violMap)
    .map(([type, d]) => ({ type, count: d.count, last_seen: d.last_seen }))
    .sort((a, b) => b.count - a.count);

  // Top violating skills
  const skillMap = {};
  for (const v of viols) {
    skillMap[v.skill] = (skillMap[v.skill] || 0) + 1;
  }
  const topSkills = Object.entries(skillMap)
    .map(([skill, violations]) => ({ skill, violations }))
    .sort((a, b) => b.violations - a.violations)
    .slice(0, 5);

  if (asJson) {
    console.log(JSON.stringify({ tier_distribution: tierDist, violations: violBreakdown, top_violating_skills: topSkills }, null, 2));
  } else {
    printMarkdownReport(tierDist, violBreakdown, topSkills, days);
  }
}

function printMarkdownReport(tierDist, violBreakdown, topSkills, days) {
  console.log(`\n## Routing Report (last ${days} days)\n`);

  console.log('### Tier Distribution\n');
  console.log('| operation_class | calls |');
  console.log('|----------------|-------|');
  for (const r of tierDist) {
    console.log(`| ${r.operation_class} | ${r.calls} |`);
  }
  if (tierDist.length === 0) console.log('_No events recorded._');

  console.log('\n### Violations\n');
  console.log('| type | count | last seen |');
  console.log('|------|-------|-----------|');
  for (const r of violBreakdown) {
    console.log(`| ${r.type} | ${r.count} | ${r.last_seen} |`);
  }
  if (violBreakdown.length === 0) console.log('_No violations recorded._');

  console.log('\n### Top Violating Skills\n');
  console.log('| skill | violations |');
  console.log('|-------|------------|');
  for (const r of topSkills) {
    console.log(`| ${r.skill} | ${r.violations} |`);
  }
  if (topSkills.length === 0) console.log('_No skill violations recorded._');
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Add routing report to commands/finish.md**

Find the section in `commands/finish.md` where the ship summary is assembled. Add a required routing report step:

```markdown
### Step N: Routing Report

Run the routing report and include it in the ship summary:

```bash
PROJECT_ROOT=$(pwd) node scripts/pipeline-routing-report.js
```

Include the full markdown output as a `## Routing Report` section in the ship summary comment posted to the epic issue.
```

- [ ] **Step 3: Verify report script runs without error**

```bash
PROJECT_ROOT=/c/Users/djwmo/dev/pipeline node /c/Users/djwmo/dev/pipeline/scripts/pipeline-routing-report.js
```

Expected: prints report (may show "_No events recorded._" if hooks haven't fired yet — that is correct).

- [ ] **Step 4: Commit**

```bash
git add scripts/pipeline-routing-report.js commands/finish.md
git commit -m "feat(routing): add pipeline-routing-report.js + integrate into /pipeline:finish"
```

---

### Task 8: Init Extension — Step 3b Local Model Host Detection

**Model:** qwen2.5:14b (prompt template prose); qwen2.5-coder:32b (detection script logic)
**TDD:** optional

**Files:**
- Modify: `scripts/pipeline-init-detect.js` (add local-model port probes)
- Modify: `commands/init.md` (add Step 3b prompt flow)

- [ ] **Step 1: Extend pipeline-init-detect.js with local-model probes**

Add a `detectLocalModelHosts()` function that probes known ports and returns a results array:

```js
async function detectLocalModelHosts() {
  const { getAdapter } = require('./lib/local-model-adapter');

  const probes = [
    { name: 'Ollama',       hostType: 'ollama',           endpoint: 'http://localhost:11434', apiProtocol: 'ollama_native'     },
    { name: 'LM Studio',    hostType: 'openai_compatible', endpoint: 'http://localhost:1234',  apiProtocol: 'openai_compatible' },
    { name: 'vLLM',         hostType: 'openai_compatible', endpoint: 'http://localhost:8000',  apiProtocol: 'openai_compatible' },
    { name: 'llama.cpp',    hostType: 'openai_compatible', endpoint: 'http://localhost:8080',  apiProtocol: 'openai_compatible' },
  ];

  const results = [];
  for (const probe of probes) {
    try {
      const adapter = getAdapter(probe.hostType);
      const cfg = { endpoint: probe.endpoint, modelName: '', apiProtocol: probe.apiProtocol, timeoutMs: 3000, maxRetries: 0 };
      const models = await adapter.listModels(cfg);
      results.push({ ...probe, detected: true, models });
    } catch (_) {
      results.push({ ...probe, detected: false, models: [] });
    }
  }
  return results;
}
```

Export `detectLocalModelHosts` from the script's module.exports (or add to its CLI dispatch block under a `detect-local-models` sub-command).

- [ ] **Step 2: Add Step 3b to commands/init.md**

Locate the init command's step flow. After Step 3 (integration detection) and before Step 4 (knowledge tier), add:

```markdown
### Step 3b: Local Model Host Detection

Run local model detection:

```bash
PROJECT_ROOT=$(pwd) node scripts/pipeline-init-detect.js detect-local-models
```

The script probes Ollama (`:11434`), LM Studio (`:1234`), vLLM (`:8000`), and llama.cpp (`:8080`).

**If `routing.local_models` already exists in `.claude/pipeline.yml` with non-null values:**

Display current config and ask:
> "Existing local model config found:
> - prose: [current prose model name] via [host_type] at [endpoint]
> - coder: [current coder model name] via [host_type] at [endpoint]
>
> Keep existing local model config? (Y/n)"
>
> If Y: skip to Step 4.
> If N: re-run detection.

**Guided engagement (if no prior config):**

Display detection results, then ask:
> "Convention routing uses local models to run short drafts and code generation for free.
>
> Detected: [list hosts that responded with model counts, or 'none']
>
> Which local model server are you using?
> 1. Ollama ([detected/not detected] — [N models])
> 2. LM Studio (OpenAI-compatible, [detected/not detected])
> 3. vLLM (OpenAI-compatible, [detected/not detected])
> 4. llama.cpp server (OpenAI-compatible, [detected/not detected])
> 5. Other OpenAI-compatible endpoint — enter URL
> 6. None — Anthropic models only (Haiku will substitute for local tiers)"

After host selection, list available models from the host and ask:
> "Which model should serve **prose drafts** (memory entries, comments, short summaries)?
> Which model should serve **code drafts** (scripts, SQL, YAML, regex)?"

If no models are listed:
> "No models found at [endpoint]. Pull models first (e.g., `ollama pull qwen2.5:14b`), then re-run `/pipeline:init` or `/pipeline:update routing`."

**Expert engagement:**
> "Local model host? (ollama / lmstudio / vllm / llamacpp / openai-compat [url] / none)"
> Prose model name? Coder model name?

**Quick mode:** Use first detected host. If Ollama already configured, use it. If nothing detected, set `none`.

**What gets written to `.claude/pipeline.yml`:**
- `routing.enabled: true`
- `routing.local_models.prose`: name, host_type, endpoint, api_protocol, context_window: 8192
- `routing.local_models.coder`: name, host_type, endpoint, api_protocol, context_window: 16384
- Full `routing.tier_map` block (all eight operation classes)
- Full `routing.universal_floor.bash_block_patterns` block

**Hook entries added to `.claude/settings.json`:**
The three hook entries (PreToolUse, PostToolUse, Stop) pointing to absolute paths under the plugin's `scripts/hooks/` directory.
```

- [ ] **Step 3: Verify detect-local-models sub-command**

```bash
PROJECT_ROOT=/c/Users/djwmo/dev/pipeline node /c/Users/djwmo/dev/pipeline/scripts/pipeline-init-detect.js detect-local-models
```

Expected: prints detection results (detected/not detected for each known host).

- [ ] **Step 4: Commit**

```bash
git add scripts/pipeline-init-detect.js commands/init.md
git commit -m "feat(routing): extend init with Step 3b local model host detection"
```

---

### Task 9: PIPELINE_ACTIVE_SKILL Wiring — All 29 Commands

**Model:** script (mechanical pattern — same Bash block prepended to each command file)
**TDD:** optional

**Files:**
- Modify: all 29 `commands/*.md` files

- [ ] **Step 1: Identify the skill name each command maps to**

Commands dispatch to exactly one skill. The mapping is: command filename → skill directory name. Commands that have no skill equivalent (pure orchestration) use `conversation_mode`.

| Command file | PIPELINE_ACTIVE_SKILL value |
|---|---|
| `commands/architect.md` | `architecture` |
| `commands/audit.md` | `auditing` |
| `commands/brainstorm.md` | `brainstorming` |
| `commands/build.md` | `building` |
| `commands/chain.md` | `building` |
| `commands/commit.md` | `orientation` |
| `commands/compliance.md` | `compliance` |
| `commands/dashboard.md` | `dashboard` |
| `commands/debate.md` | `debate` |
| `commands/debug.md` | `debugging` |
| `commands/finish.md` | `orientation` |
| `commands/init.md` | `orientation` |
| `commands/knowledge.md` | `script_exec` |
| `commands/lint-agents.md` | `lint-agents` |
| `commands/markdown-review.md` | `markdown-review` |
| `commands/plan.md` | `planning` |
| `commands/purpleteam.md` | `purpleteam` |
| `commands/qa.md` | `qa` |
| `commands/redteam.md` | `redteam` |
| `commands/release.md` | `orientation` |
| `commands/remediate.md` | `remediation` |
| `commands/review.md` | `reviewing` |
| `commands/security.md` | `redteam` |
| `commands/simplify.md` | `reviewing` |
| `commands/test.md` | `tdd` |
| `commands/triage.md` | `debugging` |
| `commands/ui-review.md` | `reviewing` |
| `commands/update.md` | `orientation` |
| `commands/worktree.md` | `orientation` |

- [ ] **Step 2: Add PIPELINE_ACTIVE_SKILL Bash block to each command**

For each command file, add a Bash block immediately after the YAML frontmatter (before any other content) that exports the skill name for the session:

```markdown
```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=<skill_name>
```
```

The block must be the first executable content in the command so the env var is set before any tool calls fire.

Tip: Write a small Node script to add the block programmatically rather than editing 29 files by hand:

```bash
node -e "
const fs = require('fs');
const path = require('path');
const mapping = {
  'architect': 'architecture', 'audit': 'auditing', 'brainstorm': 'brainstorming',
  'build': 'building', 'chain': 'building', 'commit': 'orientation',
  'compliance': 'compliance', 'dashboard': 'dashboard', 'debate': 'debate',
  'debug': 'debugging', 'finish': 'orientation', 'init': 'orientation',
  'knowledge': 'script_exec', 'lint-agents': 'lint-agents', 'markdown-review': 'markdown-review',
  'plan': 'planning', 'purpleteam': 'purpleteam', 'qa': 'qa', 'redteam': 'redteam',
  'release': 'orientation', 'remediate': 'remediation', 'review': 'reviewing',
  'security': 'redteam', 'simplify': 'reviewing', 'test': 'tdd', 'triage': 'debugging',
  'ui-review': 'reviewing', 'update': 'orientation', 'worktree': 'orientation'
};
const cmdsDir = '/c/Users/djwmo/dev/pipeline/commands';
for (const [cmd, skill] of Object.entries(mapping)) {
  const file = path.join(cmdsDir, cmd + '.md');
  if (!fs.existsSync(file)) { console.log('MISSING:', file); continue; }
  let content = fs.readFileSync(file, 'utf8');
  // Find end of frontmatter
  const fmEnd = content.indexOf('---', 3);
  if (fmEnd === -1) { console.log('NO FM:', file); continue; }
  const insertAt = fmEnd + 3;
  const block = '\n\n\`\`\`bash\n# Set active skill for routing enforcement\nexport PIPELINE_ACTIVE_SKILL=' + skill + '\n\`\`\`\n';
  // Only add if not already present
  if (content.includes('PIPELINE_ACTIVE_SKILL=')) { console.log('SKIP (already set):', cmd); continue; }
  content = content.slice(0, insertAt) + block + content.slice(insertAt);
  fs.writeFileSync(file, content, 'utf8');
  console.log('UPDATED:', cmd, '->', skill);
}
"
```

- [ ] **Step 3: Verify a sample command**

```bash
head -20 /c/Users/djwmo/dev/pipeline/commands/build.md
```

Expected: frontmatter followed by the `export PIPELINE_ACTIVE_SKILL=building` Bash block.

- [ ] **Step 4: Run linter to confirm no frontmatter breakage**

```bash
PROJECT_ROOT=/c/Users/djwmo/dev/pipeline node /c/Users/djwmo/dev/pipeline/scripts/pipeline-lint-agents.js lint
```

Expected: exit code 0 (no HIGH findings).

- [ ] **Step 5: Commit**

```bash
git add commands/*.md
git commit -m "feat(routing): wire PIPELINE_ACTIVE_SKILL export to all 29 command files"
```

---

### Task 10: Migration Guide + docs/MANIFEST.md Update

**Model:** qwen2.5:14b (prose)
**TDD:** optional

**Files:**
- Modify: `docs/MANIFEST.md` (add routing section entries)
- Modify: `docs/reference/*.md` or relevant reference doc (add routing frontmatter reference)

- [ ] **Step 1: Check docs/MANIFEST.md for routing-related entries**

```bash
grep -i routing /c/Users/djwmo/dev/pipeline/docs/MANIFEST.md
```

If no routing entries exist, add them:

```markdown
## Routing (Convention-not-reason, Option D)
- `docs/specs/2026-04-25-routing-D-spec.md` — full specification
- `docs/findings/debate-2026-04-25-routing-opus-tier.md` — Opus-tier debate verdict
- `docs/plans/2026-04-25-routing-D-plan.md` — this plan

### Reference docs requiring update
- Skill authoring reference: document `operation_class`, `allowed_models`, `allowed_direct_write` fields
- Init reference: document Step 3b local model host detection
- Config reference: document full `routing:` block schema
```

- [ ] **Step 2: Add operation_class field documentation to skill authoring reference**

Find the skill authoring reference (likely in `docs/reference/` or `CLAUDE.md`). Add a `Routing Fields` section documenting all three new frontmatter fields with the closed enum table.

- [ ] **Step 3: Commit**

```bash
git add docs/MANIFEST.md docs/reference/
git commit -m "docs(routing): update MANIFEST.md + skill authoring reference with operation_class fields"
```

---

## Build Sequence

1. **Task 1** — operation_class frontmatter on all 22 skills + linter check (no dependencies; foundational)
2. **Task 2** — local-model-adapter.js (no dependencies; isolated library)
3. **Task 3** — routing-config.js shared module (depends on Task 1 for correct skill file reads; depends on Task 2 only for adapter validation)
4. **Task 4** — PreToolUse hook routing-check.js (depends on Task 3)
5. **Task 5** — PostToolUse hook routing-log.js + DB verbs + table migration (depends on Task 3; shares config loading)
6. **Task 6** — Stop hook + templates/pipeline.yml routing block + settings.json hook entries (depends on Tasks 4, 5; hooks must exist before being registered)
7. **Task 7** — pipeline-routing-report.js + finish integration (depends on Task 5 tables/JSONL; can be parallelized with Task 6)
8. **Task 8** — init Step 3b detection (depends on Task 2 adapter for probing; depends on Task 6 for knowing what to write to pipeline.yml)
9. **Task 9** — PIPELINE_ACTIVE_SKILL wiring in all 29 commands (depends on Task 6 hooks being registered; skills must be set before hooks fire)
10. **Task 10** — docs/MANIFEST.md + reference doc updates (depends on all tasks complete)

---

## Plan Coverage Checkpoint

Every spec requirement traced to at least one task:

| Spec Requirement | Task(s) |
|---|---|
| Skill frontmatter: `operation_class`, `allowed_models`, `allowed_direct_write` on all ~22 skills | Task 1 |
| Closed enum for `operation_class` validated by linter (`--check-operation-class`) | Task 1 |
| `scripts/lib/local-model-adapter.js` — OllamaAdapter + OpenAICompatibleAdapter | Task 2 |
| Adapter factory `getAdapter(hostType)` | Task 2 |
| `LocalModelUnavailableError`, `LocalModelBadOutputError` error types | Task 2 |
| Shared routing config module for hooks | Task 3 |
| PreToolUse hook: universal floor bash_block_patterns | Task 4 |
| PreToolUse hook: direct_write_line_threshold check | Task 4 |
| PreToolUse hook: chain_dispatch_threshold check | Task 4 |
| PreToolUse hook: tier_mismatch check (Agent/Task model param) | Task 4 |
| PreToolUse hook: fail-open on crash; log to routing-hook-errors.log | Task 4 |
| PreToolUse hook: PIPELINE_ACTIVE_SKILL defaults to conversation_mode | Task 4 |
| `routing_events` + `routing_violations` Postgres tables + indexes | Task 5 |
| JSONL fallback when knowledge.tier != postgres | Tasks 3, 5 |
| `pipeline-db.js` routing-violation + routing-event verbs | Task 5 |
| PostToolUse hook: telemetry append per tool call | Task 5 |
| Stop hook: substantive prose heuristic with 6 exclusion zones | Task 6 |
| Stop hook: configurable threshold via `routing.stop_hook_threshold` | Task 6 |
| Stop hook: post-hoc only (no blocking) | Task 6 |
| `routing:` block in `templates/pipeline.yml` with all new fields | Task 6 |
| Three hook entries in `.claude/settings.json` | Task 6 |
| `logs/.gitkeep` (logs directory exists) | Task 6 |
| `pipeline-routing-report.js` — tier distribution, violation breakdown, top violating skills | Task 7 |
| 90-day retention cleanup in reporting script | Task 7 |
| Reporting integrated into `/pipeline:finish` ship summary | Task 7 |
| `/pipeline:init` Step 3b local model host detection (all 5 host types probed) | Task 8 |
| Init guided / expert / quick engagement modes | Task 8 |
| Init idempotency: skip if `routing.local_models` already configured | Task 8 |
| What gets written to `pipeline.yml` + `settings.json` by init | Task 8 |
| `PIPELINE_ACTIVE_SKILL` env var wiring in all 29 commands | Task 9 |
| Bash-at-command-start active-skill detection mechanism (pre-resolved caveat) | Task 9 |
| `docs/MANIFEST.md` updated with routing sections | Task 10 |
| Skill authoring reference updated with new frontmatter fields | Task 10 |
| Rollback path: `routing.enabled: false` disables enforcement | Task 6 (config flag documented in template) |
| `conversation_mode` default tier declaration | Task 6 (pipeline.yml template) |
| No silent escalation policy | Tasks 3, 4 (routing-config.js writeViolation; routing-check.js block messages) |
| TGI and custom adapter deferred to v2 | Documented in spec; no task needed |
| MCP daemon deferred to v2 | Documented in spec; no task needed |
