# Convention-not-reason Routing (Option D) — Test Plan

**Date:** 2026-04-25  
**Feature:** Routing decisions declared in skill frontmatter YAML; enforced mechanically at runtime with zero model judgment.  
**Scope:** Architecture validation, hook mechanics, adapter patterns, telemetry, init UX, integration boundaries.  
**Test Framework:** Linter checks, hook smoke tests, Postgres queries, JSONL file inspection. No framework.

---

## Risk Assessment

The following risks are extracted from the verdict file's Risk Register and supplemented with component-interaction risks identified from the specification:

| Risk ID | Category | Description | Likelihood | Impact | Mitigation Required |
|---------|----------|-------------|-----------|--------|-------------------|
| R1 | Drift | Skills drift from frontmatter declarations as they're maintained; YAML declarations become stale | Medium | High | Linter runs on skill load (PreToolUse hook); violations block execution; test linter coverage of all 22 skills |
| R2 | Validation | PreToolUse hook false positives block legitimate Opus orchestration; false negatives allow violations | High | High | Hook smoke tests with 5+ Opus usage patterns; PreToolUse algorithm validation (lines 450-480 spec); test both blocking and allow paths |
| R3 | Workarounds | Skills work around routing constraints by calling subagents or using conversation_mode fallback | Medium | High | Monitor skill code for "call agent" + "model:sonnet/opus" patterns; seam test: verify conversation_mode blocks tool use |
| R4 | Missing Declarations | New skills added without operation_class declaration; fallback mechanism triggers undefined behavior | High | Medium | Audit all 22 skills for complete frontmatter; test linter rejects skills with missing operation_class; test init Step 3c adds defaults to pipeline.yml |
| R5 | Data Growth | Telemetry tables (routing_events, routing_violations) grow unbounded; no cleanup policy defined | Low | Medium | Test Postgres schema has retention policy or archival path; test JSONL fallback respects knowledge-tier default (files/no-db) |
| R6 | Invisibility | Telemetry data is invisible to skill authors; routing violations accumulate silently | Medium | High | Test PostToolUse hook records routing_violations on every PreToolUse deny; test /pipeline:inspect exposes violations; seam test: routing_violations table queryable after each deny |
| R7 | Taxonomy Drift | Operation class enum values diverge from runtime tier map; new tiers added without updating skill YAML | Medium | High | Test routing grid schema validates operation_class → tier mapping on pipeline.yml load; test init Step 2c detects stale tiers; test schema enforces closed enum |
| R8 | Thresholds | Routing enforcement thresholds (confidence floors, token budgets) have no definition; policy changes silently | Low | High | Test: universal floor SQL patterns documented and enforced; test PostToolUse schema includes floor_applied (boolean); test init Step 3a loads thresholds from pipeline.yml |
| R9 | Component: Adapter → Routing Config | Adapter probe fails; hook retries indefinitely or silently downgrades to no-routing | High | High | Seam test: adapter probe timeout (5s) → hook logs error + allows execution (degraded); seam test: routing config malformed → init detects + alerts |
| R10 | Component: Hook → Telemetry | PostToolUse hook fires but telemetry write fails (Postgres down, JSONL permission denied); routing violation invisible | High | High | Seam test: PostToolUse hook captures write error + logs to stderr; seam test: JSONL fallback works when Postgres unavailable; integration test: routing_violations table consistent after 100 hook fires |
| R11 | Boundary: Init ↔ Adapter | Init probes local model host; adapter never gets called; upstream tools see no routing config | High | Medium | Seam test: init Step 3b detects Ollama host and writes adapter config to pipeline.yml; test adapter loaded on PreToolUse hook fire; test routing grid populated from adapter results |
| R12 | Boundary: Skill Dispatch ↔ PreToolUse | Tool use triggers hook but skill has no operation_class; linter accepts it; hook sees undefined enum | High | High | Linter test: skill with missing operation_class fails validation; PreToolUse hook test: undefined enum values logged as warnings, execution allowed (safe fallback) |

---

## Acceptance Criteria

| AC ID | Priority | Criterion | Source |
|-------|----------|-----------|--------|
| AC-001 | P0 | All 22 skills have operation_class, allowed_models, allowed_direct_write YAML fields declared and linter-validated | Task 1: Frontmatter Audit |
| AC-002 | P0 | PreToolUse hook blocks non-Opus tiers from calling Opus-only tools (operation_class = opus_orchestration); allows conversely | Spec §6.1 Hook: PreToolUse |
| AC-003 | P0 | PostToolUse hook records routing_events table with tool_name, model, tier, operation_class, blocked (boolean) for every tool call | Spec §6.2 Hook: PostToolUse |
| AC-004 | P0 | Local model adapter (Task 2) implements probe/complete/listModels interface; PreToolUse hook calls adapter.probe() on first load | Task 2: Adapter; Spec §5 Adapter Pattern |
| AC-005 | P0 | Init Step 3b detects Ollama or OpenAI endpoint in environment; populates pipeline.yml routing section with adapter config | Spec §3 Init Flow Step 3b |
| AC-006 | P0 | Routing grid schema in pipeline.yml enforces operation_class → allowed_models → allowed_direct_write mapping; init validates on load | Spec §4 Routing Grid Schema |
| AC-007 | P1 | Telemetry fallback: if Postgres unavailable, PostToolUse writes routing_events.jsonl to .claude/telemetry/; knowledge_tier selection respects files default | Spec §7.2 Telemetry: JSONL Fallback |
| AC-008 | P1 | Stop hook scans in-context drafts for Haiku-signature patterns (line breaks, truncations); records draft_suspicion_level in routing_events | Spec §6.3 Hook: Stop |
| AC-009 | P1 | Migration: old skill files without frontmatter YAML trigger linter warning (not error); init Step 3c adds default operation_class declarations | Spec §8 Migration Path |
| AC-010 | P1 | Rollback: if hooks disabled (feature flag false), routing config ignored; skills execute without tier checks (pre-routing behavior) | Spec §8 Rollback Path |
| AC-011 | P1 | Plugin distribution: routing hooks bundled in .claude-plugin/hooks/ directory; init Step 3a copies hooks to skills/ directory on first run | Spec §7.1 Plugin Distribution |
| AC-012 | P1 | Linter (pipeline-lint-agents.js) reports AC-001 violations; categorizes as ERROR if operation_class missing, WARNING if enum value unknown | Task 1: Linter Coverage |

---

## Test Scenarios

### TS-001: Skill Frontmatter Linter — Complete Audit
**Type:** Linter static check  
**Priority:** P0  
**Covers:** AC-001, AC-012, R1, R4, R12  
**Work Package:** WP-FRONTMATTER  
**Steps:**
1. `cd /c/Users/djwmo/dev/pipeline && node scripts/pipeline-lint-agents.js check-frontmatter`
2. Verify output includes all 22 skills (skills/**/SKILL.md)
3. For each skill, assert: operation_class is one of {opus_orchestration, sonnet_review, haiku_judgment, code_draft, short_draft, bulk_classify, script_exec, conversation_mode}
4. For each skill, assert: allowed_models is a list of {opus, sonnet, haiku, local} (local = Ollama)
5. For each skill, assert: allowed_direct_write is boolean
6. Assert: linter returns exit code 0 if all 22 skills pass; exits 1 if any field missing or enum unknown

**Edge Cases:**
- Skill with operation_class but no allowed_models → ERROR
- Skill with conversation_mode and allowed_direct_write=true → WARNING (conversation_mode should not use direct writes)
- New skill added during build without frontmatter → linter returns ERROR

**Test Intent:** Confirm linter enforces frontmatter completeness as baseline for all downstream routing checks. This is the mechanical enforcement gate before any hook fires.

---

### TS-002: PreToolUse Hook — Opus Blocking Sonnet Tool Calls
**Type:** Hook smoke test  
**Priority:** P0  
**Covers:** AC-002, AC-003, R2, R12  
**Work Package:** WP-HOOKS  
**Steps:**
1. Create test skill with operation_class=sonnet_review, allowed_models=[sonnet], allowed_direct_write=false
2. Invoke skill in Opus orchestration context (e.g., via /pipeline:review)
3. Hook intercepts Sonnet model request; PreToolUse fires before tool.use
4. Assert: hook logs "[BLOCKED] Sonnet tool requested in Opus orchestration context"
5. Assert: execution halts; tool call does NOT fire
6. Assert: routing_events table (or routing_events.jsonl) records: {tool_name: "review", model: "sonnet", tier: "sonnet_review", blocked: true}

**Edge Cases:**
- Tool call with explicit model override (e.g., model=sonnet in /pipeline:review) → still blocked
- Sonnet tier calling its own operation_class (sonnet_review) → allowed
- Haiku tier calling sonnet_review → blocked

**Test Intent:** Validate PreToolUse enforcement gates the highest-risk crossing (Opus→Sonnet); confirm blocking stops execution before the tool is dispatched.

---

### TS-003: PreToolUse Hook — Haiku Judgment Accept Path
**Type:** Hook smoke test  
**Priority:** P0  
**Covers:** AC-002, AC-003, R2  
**Work Package:** WP-HOOKS  
**Steps:**
1. Create test skill with operation_class=haiku_judgment, allowed_models=[haiku]
2. Invoke skill in Haiku context (e.g., via /pipeline:finish Step 2 prompt dispatch)
3. PreToolUse hook fires; determines Haiku tier matches operation_class
4. Assert: hook logs "[ALLOWED] Haiku judgment execution in haiku_judgment context"
5. Assert: tool call proceeds; execution completes normally
6. Assert: routing_events table records: {blocked: false, operation_class: "haiku_judgment", tier: "haiku_judgment"}

**Edge Cases:**
- Haiku calling opus_orchestration → blocked
- Sonnet calling haiku_judgment → allowed (higher tier can call lower)

**Test Intent:** Confirm allow path functions; validate tier hierarchy is correctly enforced.

---

### TS-004: PostToolUse Hook — Telemetry Record Completeness
**Type:** DB state check (Postgres query)  
**Priority:** P0  
**Covers:** AC-003, AC-006, R10  
**Work Package:** WP-HOOKS  
**Steps:**
1. Run /pipeline:debate with Routing Option D feature branch active
2. Debate workflow triggers 6+ tool calls (Advocate, Skeptic, Practitioner agents)
3. Each tool call fires PostToolUse hook
4. After debate completes, query Postgres: `SELECT COUNT(*) FROM routing_events WHERE created_at > NOW() - INTERVAL '5 minutes'`
5. Assert: row count >= 6
6. For each row, assert columns exist: tool_name, model, tier, operation_class, blocked, confidence, token_count, created_at
7. Spot-check 2+ rows: verify tool_name matches skill.SKILL.md filename, model matches tier mapping

**Edge Cases:**
- Tool call fails mid-execution; PostToolUse hook still fires → assert error logged
- Telemetry write timeout (Postgres slow); hook retries once, then logs warning → assert warning appears in stderr

**Test Intent:** Confirm PostToolUse hook records every tool call; telemetry data is complete and queryable for later audit.

---

### TS-005: Local Model Adapter — Probe Success Path
**Type:** Integration test (adapter ↔ hook)  
**Priority:** P0  
**Covers:** AC-004, AC-005, R9, R11  
**Work Package:** WP-ADAPTERS  
**Steps:**
1. Start Ollama server on localhost:11434 (or OLLAMA_HOST env var)
2. Run init Step 3b: `cd /c/Users/djwmo/dev/pipeline && node scripts/pipeline-init.js --step 3b`
3. Assert: step detects Ollama endpoint; writes to pipeline.yml routing section: {adapter: {type: "ollama", host: "localhost:11434"}}
4. Load adapter module: test adapter implements probe(), complete(model), listModels() interface per JSDoc
5. Call adapter.probe() with timeout=5s
6. Assert: returns {available: true, endpoint: "localhost:11434", models: [...]}
7. Call adapter.listModels(); assert returns list of available models

**Edge Cases:**
- Ollama endpoint unreachable; probe timeout after 5s → returns {available: false}; execution degrades gracefully
- OLLAMA_HOST env var points to wrong port → probe fails; init logs warning but continues

**Test Intent:** Validate adapter initialization path (init Step 3b) and probe mechanics. This is the foundation for routing to local models in subsequent steps.

---

### TS-006: Init Step 3b — Routing Grid Schema Validation
**Type:** Integration test (init ↔ config load)  
**Priority:** P0  
**Covers:** AC-005, AC-006, R7, R11  
**Work Package:** WP-INIT  
**Steps:**
1. Create malformed pipeline.yml with routing section: {operation_class: "unknown_value", allowed_models: ["invalid-tier"]}
2. Run init Step 3c: `node scripts/pipeline-init.js --step 3c --validate-schema`
3. Assert: schema validator reports ERROR: "operation_class must be one of {opus_orchestration, sonnet_review, ...}"
4. Assert: schema validator reports ERROR: "allowed_models contains invalid tier 'invalid-tier'"
5. Fix YAML; run Step 3c again
6. Assert: validator returns exit code 0; no errors
7. Query pipeline.yml in memory; assert routing grid is accessible via config.routing

**Edge Cases:**
- Routing section missing from pipeline.yml → init Step 3a adds default (all tiers allowed, operation_class=conversation_mode)
- Routing section present but empty {} → init logs WARNING, uses defaults

**Test Intent:** Confirm routing grid schema is enforced on load; catch stale YAML before runtime.

---

### TS-007: PreToolUse Hook — Confidence Floor Enforcement
**Type:** Hook smoke test (with telemetry)  
**Priority:** P1  
**Covers:** AC-002, AC-003, R8  
**Work Package:** WP-HOOKS  
**Steps:**
1. Configure pipeline.yml with routing section: {universal_floor_confidence: 0.85}
2. Invoke skill with low-confidence model response (simulated via mock)
3. PreToolUse hook calculates confidence floor; asserts confidence >= 0.85
4. If confidence < 0.85, log "[BLOCKED] Confidence below floor" and block execution
5. If confidence >= 0.85, allow execution
6. Assert: routing_events table records: {floor_applied: true, confidence: <value>, floor_threshold: 0.85, blocked: <boolean>}

**Edge Cases:**
- No universal_floor_confidence defined → default to 0.0 (allow all)
- Confidence exactly at floor (0.85) → allow execution

**Test Intent:** Validate universal floor SQL patterns and confidence-based gating (risk R8).

---

### TS-008: Stop Hook — Draft Suspicion Detection
**Type:** Hook smoke test  
**Priority:** P1  
**Covers:** AC-008, R6  
**Work Package:** WP-HOOKS  
**Steps:**
1. Run /pipeline:finish on a completed feature with Haiku-generated summary
2. Stop hook scans in-context draft for Haiku signatures: line-break patterns, truncation markers, <|end|>, token limits
3. Assert: hook records draft_suspicion_level in routing_events (0.0 to 1.0 scale)
4. Spot-check 2 rows: if Haiku generated summary, draft_suspicion_level > 0.5
5. If summary is human-written, draft_suspicion_level < 0.3

**Edge Cases:**
- Draft is all code (e.g., generated JavaScript); no natural language → suspicion_level stays low
- Draft has mixed Haiku + human writing → suspicion_level reflects proportion

**Test Intent:** Validate Stop hook can detect in-context drafts and raise suspicion flags for later review.

---

### TS-009: Telemetry Fallback — Postgres Unavailable
**Type:** Integration test (hook ↔ telemetry)  
**Priority:** P1  
**Covers:** AC-007, R10  
**Work Package:** WP-REPORTING  
**Steps:**
1. Stop Postgres service (or set DATABASE_URL to invalid connection string)
2. Run /pipeline:review on a sample feature
3. Review workflow triggers 3+ tool calls
4. PreToolUse and PostToolUse hooks fire normally (routing checks proceed)
5. PostToolUse hook attempts Postgres write; fails with connection error
6. Assert: hook catches error and writes to .claude/telemetry/routing_events.jsonl instead
7. Verify file exists and contains valid JSON: {tool_name: "...", model: "...", tier: "...", blocked: boolean, ...}
8. Restart Postgres; run hydration script: `node scripts/pipeline-telemetry.js hydrate-from-jsonl`
9. Assert: routing_events table populated from JSONL file; counts match

**Edge Cases:**
- JSONL file permission denied (read-only directory) → hook logs error to stderr; execution continues (telemetry loss accepted)
- Postgres unavailable, JSONL also unavailable → hook logs both failures; execution unblocked

**Test Intent:** Confirm telemetry resilience; routing decisions still enforced even if telemetry storage fails.

---

### TS-010: Migration — Old Skills Without Frontmatter
**Type:** Linter check + init logic  
**Priority:** P1  
**Covers:** AC-009, AC-012, R1, R4  
**Work Package:** WP-FRONTMATTER  
**Steps:**
1. Create old-style skill file without operation_class/allowed_models/allowed_direct_write YAML
2. Run linter: `node scripts/pipeline-lint-agents.js check-frontmatter`
3. Assert: linter outputs WARNING (not ERROR) for missing frontmatter
4. Run init Step 3c with --add-defaults flag: `node scripts/pipeline-init.js --step 3c --add-defaults`
5. Assert: step adds default operation_class=conversation_mode to old skill
6. Verify skill now has complete frontmatter: operation_class, allowed_models=[opus,sonnet,haiku], allowed_direct_write=false
7. Run linter again; assert WARNING is now resolved (no error reported)

**Edge Cases:**
- Old skill is missing only allowed_direct_write → linter warns; init Step 3c adds field with default=false
- Old skill has broken YAML syntax → linter reports PARSE_ERROR before checking frontmatter

**Test Intent:** Confirm migration path allows old skills to coexist with new routing system; automated tooling adds defaults so humans don't have to.

---

### TS-011: Rollback — Feature Flag Disabled
**Type:** Integration test (hook bypass)  
**Priority:** P1  
**Covers:** AC-010, R2  
**Work Package:** WP-FRONTMATTER  
**Steps:**
1. Set feature flag in pipeline.yml: {routing_enabled: false}
2. Run /pipeline:review workflow
3. PreToolUse hook fires but checks routing_enabled flag first
4. Assert: hook logs "[DISABLED] Routing checks bypassed" and returns early (no blocking)
5. Tool calls proceed without tier validation
6. Verify routing_events table NOT populated (telemetry also skipped)
7. Set routing_enabled: true; repeat workflow
8. Assert: routing_events table IS populated; blocking enforced

**Edge Cases:**
- routing_enabled key missing from pipeline.yml → defaults to true (routing active)
- routing_enabled: null → treated as false (safe default)

**Test Intent:** Confirm rollback path; ability to disable routing without code changes.

---

### TS-012: Plugin Distribution — Hook Files Copied on Init
**Type:** File state check  
**Priority:** P1  
**Covers:** AC-011  
**Work Package:** WP-REPORTING  
**Steps:**
1. Delete .claude/hooks/ directory (if it exists)
2. Run init: `node scripts/pipeline-init.js`
3. Assert: init Step 3a detects missing hooks directory
4. Assert: init copies routing-check.js, routing-log.js, routing-stop.js from .claude-plugin/hooks/ to .claude/hooks/
5. Verify all 3 files exist with correct content (match checksums)
6. Verify .gitignore includes .claude/hooks/ (hooks are not committed)
7. Repeat init; assert Step 3a detects existing hooks and skips copy (idempotent)

**Edge Cases:**
- .claude-plugin/hooks/ directory not found → init reports ERROR and halts
- Hook file in .claude/hooks/ has been modified by user → init warns but does not overwrite

**Test Intent:** Confirm plugin distribution mechanism works; hooks are available after init without manual setup.

---

### TS-013: Linter — Unknown Enum Values
**Type:** Linter static check  
**Priority:** P1  
**Covers:** AC-012, R7  
**Work Package:** WP-FRONTMATTER  
**Steps:**
1. Add skill with operation_class=unknown_future_tier (not in current enum)
2. Run linter: `node scripts/pipeline-lint-agents.js check-frontmatter`
3. Assert: linter reports WARNING: "operation_class 'unknown_future_tier' not in known enum; execution may be unrouted"
4. Assert: linter does NOT error (allow forward compatibility)
5. Verify linter exit code 0 (warning only)

**Edge Cases:**
- allowed_models contains unknown tier (e.g., local_gpt) → linter warns
- operation_class is null or empty string → linter reports ERROR (missing, not unknown)

**Test Intent:** Confirm linter catches taxonomy drift without blocking; allows evolution of enum values.

---

### TS-014: Hook Timeout — Adapter Probe Hangs
**Type:** Integration test (hook ↔ adapter)  
**Priority:** P1  
**Covers:** AC-004, R9  
**Work Package:** WP-ADAPTERS  
**Steps:**
1. Configure adapter with localhost:9999 (unreachable port)
2. Set adapter probe timeout to 5 seconds
3. Run PreToolUse hook with slow/unreachable adapter
4. Assert: hook waits up to 5s for adapter.probe() to return
5. After timeout, hook logs "[TIMEOUT] Adapter probe took >5s; degrading to pre-routing behavior"
6. Assert: execution proceeds WITHOUT tier checks (safe fallback)
7. Verify routing_events records: {adapter_status: "timeout", blocked: false}

**Edge Cases:**
- Adapter responds after 4.9s (within timeout) → use routing results normally
- Adapter responds after 5.1s (exceeds timeout) → treat as timeout

**Test Intent:** Confirm timeout safety; execution never hangs waiting for adapter.

---

### TS-015: Conflict Resolution — Skill Declares Both opus_orchestration and conversation_mode
**Type:** Linter static check  
**Priority:** P1  
**Covers:** AC-001, AC-012, R1  
**Work Package:** WP-FRONTMATTER  
**Steps:**
1. Create skill with operation_class=[opus_orchestration, conversation_mode]
2. Run linter: `node scripts/pipeline-lint-agents.js check-frontmatter`
3. Assert: linter reports ERROR: "operation_class must be a single value, not a list"
4. Fix YAML to operation_class=opus_orchestration
5. Run linter; assert ERROR resolved

**Edge Cases:**
- operation_class is a string (correct) → linter passes
- operation_class is a list with one element → linter reports ERROR (must be string)

**Test Intent:** Catch schema violations early; prevent runtime enum parsing errors.

---

## Seam Tests

### Seam-001: Hook Load ↔ Routing Config Parse
**Type:** Integration boundary test  
**Priority:** P0  
**Covers:** AC-006, AC-011, R7, R11  
**Work Package:** WP-SEAM  
**Description:** Verify hooks load routing config from pipeline.yml and cache it correctly.

**Steps:**
1. Start with valid pipeline.yml with routing section populated
2. Initialize hook: call require('./hooks/routing-check.js').init({config_path: '.claude/pipeline.yml'})
3. Assert: hook parses YAML and extracts routing grid into in-memory cache
4. Modify pipeline.yml (change operation_class mapping)
5. Call hook.reload() (simulated hot-reload)
6. Assert: hook detects change and updates in-memory cache
7. Call hook with updated tier mapping; verify new rules applied

**Test Intent:** Seam between hook initialization and config loading; ensure config changes propagate to hooks.

---

### Seam-002: PreToolUse Hook → Telemetry Write (routing_violations table)
**Type:** Integration boundary test  
**Priority:** P0  
**Covers:** AC-003, AC-002, R6, R10  
**Work Package:** WP-SEAM  
**Description:** When PreToolUse hook blocks execution, verify routing_violations table is populated immediately.

**Steps:**
1. Create scenario where Sonnet model is called in Opus orchestration (violation)
2. PreToolUse hook fires and blocks execution
3. Hook calls PostToolUse to log violation: {tool_name: "...", blocked: true, violation_type: "tier_mismatch"}
4. Query routing_violations table: `SELECT * FROM routing_violations WHERE blocked=true ORDER BY created_at DESC LIMIT 1`
5. Assert: new row appears within 100ms of block event
6. Verify row contains: tool_name, model, tier, operation_class, violation_reason

**Test Intent:** Seam between blocking decision (PreToolUse) and violation logging (PostToolUse ↔ Postgres); ensure violations are never silent.

---

### Seam-003: Init Step 3b ↔ Adapter Configuration
**Type:** Integration boundary test  
**Priority:** P0  
**Covers:** AC-005, AC-004, AC-006, R11  
**Work Package:** WP-SEAM  
**Description:** Verify init Step 3b detects local model host and writes adapter config that is immediately readable by hooks.

**Steps:**
1. Start with clean pipeline.yml (no routing section)
2. Set OLLAMA_HOST=http://localhost:11434
3. Run init Step 3b: `node scripts/pipeline-init.js --step 3b`
4. Assert: step detects Ollama endpoint and writes to pipeline.yml: {routing: {adapter: {type: "ollama", host: "http://localhost:11434"}}}
5. Load hook immediately after init
6. Hook reads pipeline.yml and caches adapter config
7. Call hook with Haiku tool request
8. Hook calls adapter.probe() using config from Step 3b
9. Assert: adapter uses correct host and returns available models
10. Verify hook can route Haiku calls to local Ollama correctly

**Test Intent:** Seam between init discovery (Step 3b) and runtime hook usage; ensure adapter config written by init is immediately usable by hooks.

---

### Seam-004: Skill Frontmatter Linter ↔ PreToolUse Hook Enum Validation
**Type:** Integration boundary test  
**Priority:** P1  
**Covers:** AC-001, AC-002, AC-012, R4, R12  
**Work Package:** WP-SEAM  
**Description:** Linter certifies skill frontmatter; hook validates enum at runtime. Both must use same enum definition.

**Steps:**
1. Define closed enum in shared module: {opus_orchestration, sonnet_review, haiku_judgment, ...}
2. Linter imports enum and validates skill operation_class values
3. PreToolUse hook imports same enum module and validates tool requests
4. Create skill with operation_class=sonnet_review
5. Run linter; assert it accepts sonnet_review (in enum)
6. Invoke tool in Haiku context; PreToolUse hook fires
7. Hook looks up Haiku ↔ sonnet_review mapping; determines it's a violation
8. Assert: hook blocks execution
9. Verify enum matches between linter and hook (no desynchronization)

**Test Intent:** Seam between static linter (frontmatter) and runtime hook (validation); both must share enum source of truth.

---

### Seam-005: Telemetry Fallback Path ↔ Knowledge Tier Selection
**Type:** Integration boundary test  
**Priority:** P1  
**Covers:** AC-007, R5, R10  
**Work Package:** WP-SEAM  
**Description:** Verify knowledge_tier config drives telemetry storage choice (Postgres vs. JSONL).

**Steps:**
1. Set pipeline.yml: {knowledge_tier: "files"}
2. Run workflow that triggers 3+ tool calls
3. PostToolUse hook attempts Postgres write
4. Hook detects knowledge_tier="files" and SKIPS Postgres attempt
5. Hook writes directly to .claude/telemetry/routing_events.jsonl
6. Verify JSONL file populated; Postgres table empty
7. Change pipeline.yml: {knowledge_tier: "database"}
8. Restart and run another workflow with 3+ tool calls
9. Hook detects knowledge_tier="database" and attempts Postgres write
10. Verify Postgres routing_events table populated; JSONL NOT updated for new calls

**Test Intent:** Seam between knowledge tier selection and telemetry backend choice; ensure hook respects config directive.

---

## Work Packages

### WP-FRONTMATTER: Skill YAML Frontmatter Audit & Linter
**Description:** Task 1 from plan. Audit all 22 skills for operation_class/allowed_models/allowed_direct_write declarations; build linter to enforce.

**Covered Tests:** TS-001, TS-009, TS-010, TS-013, TS-015, Seam-004  
**Acceptance Gates:**
- All 22 skills have complete frontmatter (AC-001)
- Linter validates frontmatter and rejects incomplete skills (AC-012)
- Linter accepts unknown future enums with warning, not error (TS-013)
- Migration path adds defaults to old skills (TS-009)
- Conflict detection (lists instead of strings) detected (TS-015)

---

### WP-HOOKS: PreToolUse, PostToolUse, Stop Hook Implementations
**Description:** Tasks 4, 5, 6 from plan. Implement three hooks with blocking, telemetry, and draft-suspicion logic.

**Covered Tests:** TS-002, TS-003, TS-004, TS-008, TS-014, Seam-001, Seam-002, Seam-004  
**Acceptance Gates:**
- PreToolUse blocks violations; allows compliant calls (TS-002, TS-003)
- PostToolUse records routing_events for every tool call (TS-004)
- PostToolUse cascades to routing_violations on blocks (Seam-002)
- Stop hook detects draft suspicion levels (TS-008)
- Hook timeout handles slow adapters gracefully (TS-014)
- Hook config loading and hot-reload work correctly (Seam-001)

---

### WP-ADAPTERS: Local Model Adapter Pattern & Ollama Integration
**Description:** Task 2 from plan. Implement adapter interface (probe/complete/listModels); support Ollama and OpenAI-compatible endpoints.

**Covered Tests:** TS-005, TS-014, Seam-003  
**Acceptance Gates:**
- Adapter implements JSDoc interface: probe(), complete(model), listModels() (TS-005)
- Adapter probe succeeds with Ollama and handles timeout (TS-005, TS-014)
- Adapter probe failure gracefully downgrades to pre-routing (TS-014)
- Init Step 3b populates adapter config for hooks to use (Seam-003)

---

### WP-INIT: Initialization Flow Steps 3b (Adapter), 3c (Schema)
**Description:** Task 8 from plan. Implement init Steps 3b (detect local model host) and 3c (add defaults to old skills).

**Covered Tests:** TS-006, TS-010, Seam-003, Seam-005  
**Acceptance Gates:**
- Init Step 3b detects Ollama/OpenAI host and writes adapter config (AC-005, Seam-003)
- Init Step 3c adds defaults to old skills without frontmatter (TS-010)
- Init Step 3c validates routing grid schema (AC-006, TS-006)
- Init respects knowledge_tier for telemetry backend selection (Seam-005)

---

### WP-REPORTING: PostToolUse Hook & Telemetry Schema (Postgres & JSONL)
**Description:** Task 7 from plan. Implement PostToolUse telemetry recording and JSONL fallback.

**Covered Tests:** TS-004, TS-007, TS-009, TS-012, Seam-005  
**Acceptance Gates:**
- routing_events table schema complete and queryable (TS-004)
- universal_floor_confidence enforcement in PostToolUse (TS-007)
- JSONL fallback works when Postgres unavailable (TS-009)
- Hook files bundled in .claude-plugin/hooks/ and copied on init (TS-012)
- knowledge_tier setting controls Postgres vs. JSONL selection (Seam-005)

---

### WP-SEAM: Integration Boundary Tests (Cross-Package)
**Description:** Integration tests spanning multiple work packages; focus on data flow and state consistency at component boundaries.

**Covered Tests:** Seam-001, Seam-002, Seam-003, Seam-004, Seam-005  
**Acceptance Gates:**
- Hook config loading and hot-reload (Seam-001)
- Block decision immediately reflected in routing_violations (Seam-002)
- Init Step 3b config immediately usable by hooks (Seam-003)
- Linter and hook enums match; no desynchronization (Seam-004)
- knowledge_tier controls telemetry backend (Seam-005)

---

## Coverage Matrix

| AC ID | Scenario | TS-001 | TS-002 | TS-003 | TS-004 | TS-005 | TS-006 | TS-007 | TS-008 | TS-009 | TS-010 | TS-011 | TS-012 | TS-013 | TS-014 | TS-015 | Seam-001 | Seam-002 | Seam-003 | Seam-004 | Seam-005 |
|-------|----------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|----------|----------|----------|----------|----------|
| AC-001 | Frontmatter complete | X |   |   |   |   |   |   |   |   | X |   |   |   |   | X |   |   |   | X |   |
| AC-002 | PreToolUse blocks violations | | X | X |   |   |   |   |   |   |   |   |   |   |   |   |   | X |   | X |   |
| AC-003 | PostToolUse records events |   | X | X | X |   |   | X |   |   |   |   |   |   |   |   |   | X |   |   |   |
| AC-004 | Adapter interface | | | | | X | | | | | | | | | X | | | | X | | |
| AC-005 | Init Step 3b | | | | | X | | | | | | | | | | | | | X | | |
| AC-006 | Routing grid schema | | | | | | X | | | | | | | | | | X | | X | X | |
| AC-007 | Telemetry fallback | | | | | | | | | X | | | | | | | | | | | X |
| AC-008 | Stop hook drafts | | | | | | | | X | | | | | | | | | | | | |
| AC-009 | Migration path | | | | | | | | | | X | | | | | | | | | | |
| AC-010 | Rollback feature flag | | | | | | | | | | | X | | | | | | | | | |
| AC-011 | Plugin distribution | | | | | | | | | | | | X | | | | | | | | |
| AC-012 | Linter validation | X | | | | | | | | | X | | | X | | X | | | | X | |

| Risk ID | Scenario | TS-001 | TS-002 | TS-003 | TS-004 | TS-005 | TS-006 | TS-007 | TS-008 | TS-009 | TS-010 | TS-011 | TS-012 | TS-013 | TS-014 | TS-015 | Seam-001 | Seam-002 | Seam-003 | Seam-004 | Seam-005 |
|---------|----------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|----------|----------|----------|----------|----------|
| R1 | Skill drift | X | | | | | | | | | X | | | | | X | | | | | |
| R2 | False positives/negatives | | X | X | | | | | | | | | | | | | | X | | X | |
| R3 | Workarounds | | | | | | | | X | | | | | | | | | | | | |
| R4 | Missing declarations | | | | | | | | | | X | | | X | | X | | | | X | |
| R5 | Data growth | | | | | | | | | | | | | | | | | | | | X |
| R6 | Invisibility | | | | | | | | X | | | | | | | | | X | | | |
| R7 | Taxonomy drift | | | | | | X | | | | | | | X | | | X | | X | X | |
| R8 | Threshold failures | | | | | | | X | | | | | | | | | | | | | X |
| R9 | Adapter failure | | | | | X | | | | | | | | | X | | | | X | | |
| R10 | Telemetry invisibility | | | | X | | | | | X | | | | | | | X | X | | | X |
| R11 | Init ↔ Adapter | | | | | X | | | | | | | | | | | | | X | | |
| R12 | Undefined enum | | | | | | | | | | | | | | | X | | | | X | |

---

## Quality Assurance Gates

### Pre-Build Verification
1. All 22 skills have operation_class declarations (TS-001)
2. Linter runs successfully on skill suite (AC-012)
3. Routing grid schema in pipeline.yml is valid (TS-006)

### Integration Checkpoint (After WP-HOOKS, WP-ADAPTERS, WP-INIT)
1. PreToolUse hook accepts and blocks calls correctly (TS-002, TS-003)
2. PostToolUse hook records telemetry with no data loss (TS-004)
3. Adapter probe succeeds with timeout safety (TS-005)
4. Init Step 3b detects local model host (TS-005)

### Seam Testing Checkpoint (After WP-REPORTING, WP-SEAM)
1. Hook config loading is synchronized (Seam-001)
2. Violations are immediately recorded (Seam-002)
3. Init Step 3b config is immediately usable (Seam-003)
4. Linter and hook enums match (Seam-004)
5. Telemetry backend selection respects knowledge_tier (Seam-005)

### Final Release Gate
1. All 15 test scenarios pass
2. All 5 seam tests pass
3. Rollback feature flag enables pre-routing behavior (TS-011)
4. Migration path handles old skills (TS-009)

---

## Test Execution Strategy

### Phase 1: Static Validation (WP-FRONTMATTER, WP-INIT)
- TS-001, TS-006, TS-009, TS-010, TS-012, TS-013, TS-015 (linter/init checks)
- Sequential; no dependency on runtime hooks
- Total runtime: ~2 min

### Phase 2: Hook Mechanics (WP-HOOKS, WP-ADAPTERS)
- TS-002, TS-003, TS-004, TS-005, TS-008, TS-014 (hook smoke, adapter tests)
- Can run in parallel after WP-INIT completes
- Total runtime: ~5 min

### Phase 3: Seam & Integration (WP-REPORTING, WP-SEAM)
- Seam-001 through Seam-005, TS-007, TS-009, TS-011
- Requires WP-HOOKS and WP-ADAPTERS complete
- Total runtime: ~8 min

### Total Estimated Test Run Time
**~15 minutes** for full test suite (phases 1–3 sequential)

---

## Test Result Reporting

After each test execution, record results in `.claude/test-results/routing-D-{date}-{phase}.json`:

```json
{
  "test_id": "TS-001",
  "name": "Skill Frontmatter Linter — Complete Audit",
  "status": "PASS|FAIL",
  "duration_ms": 1234,
  "assertion_count": 6,
  "assertion_failures": [],
  "work_package": "WP-FRONTMATTER",
  "covers_ac": ["AC-001", "AC-012"],
  "covers_risks": ["R1", "R4", "R12"],
  "timestamp": "2026-04-25T14:32:11Z"
}
```

Summary dashboard: `SELECT COUNT(*) as total, SUM(CASE WHEN status='PASS' THEN 1 ELSE 0 END) as passed FROM test_results WHERE test_run='2026-04-25';`

---

## Notes & Assumptions

1. **No test framework:** Tests are executed via linter checks, hook smoke tests, Postgres queries, and JSONL file inspection. Jest/Mocha are not used.
2. **Hook smoke tests:** Hooks are Node.js modules that can be required() and called directly; no separate test runner needed.
3. **Postgres queries:** routing_events and routing_violations tables exist; schema defined in task 7 of plan.
4. **JSONL fallback:** knowledge_tier="files" triggers .claude/telemetry/ JSONL writes; JSONL schema matches Postgres routing_events.
5. **Enum source of truth:** operation_class enum defined in shared module; imported by linter and PreToolUse hook; guarantees consistency.
6. **Feature flag:** routing_enabled in pipeline.yml controls hook bypass; defaults to true (routing active).
7. **Adapter interface:** JSDoc interface defined in task 2; probe/complete/listModels are async functions with timeout support.

