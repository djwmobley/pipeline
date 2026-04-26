# Chunker / Loader Implementation Plan

> **For agentic workers:** Use /pipeline:build to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `scripts/pipeline-chunker.js` and `scripts/pipeline-memory-loader.js` to eliminate Ollama token-overrun failures and achieve 100% embedding coverage on `memory_entries`, `policy_sections`, and `session_chunks`.

**Architecture:** A pure-function chunker (boundary-aware, token-budget parameterized) is consumed by a CLI loader that sources rows from the filesystem, chunks them, embeds via `ollamaEmbed()` in BATCH=8, and upserts idempotently. A unified SQL view (`v_memory_hits`) surfaces all three chunk tables through a single query surface for `cmdHybrid`. Encoded-cwd path computation is extracted to a shared utility to handle Windows backslash-to-dash encoding.

**Tech Stack:** Node.js, `scripts/lib/shared.js` (`ollamaEmbed`, `connect`, `loadConfig`), pgvector (HNSW), `crypto` (SHA256), `fs`/`path`/`os` (filesystem sources).

**Model Routing:** Chunker, loader, and test script are `code_draft` (qwen2.5-coder:32b if available, else sonnet). Doc updates are `short_draft` (qwen2.5:14b if available, else haiku). Plan reviewer is sonnet.

**Decisions:** Inline — see Architectural Constraints below.

**Branch:** `feat/chunker-loader-issue-60` | **Issue:** #142 | **Postgres task:** #60

---

## Architectural Constraints

Pulled from the debate verdict "Points of Agreement" and "Plan Must" items. Every task in this plan must comply. Any deviation requires an explicit decision record.

- Chunking is load-bearing regardless of embedder. Strategy B (bge-m3 swap) is a bounded follow-on, not an alternative. Do not conflate the two.
- Boundary priority order is fixed: heading → code-fence → paragraph → sentence → hard-split. Any reordering requires empirical test evidence from §6 pathological inputs.
- BATCH=8 with per-chunk error isolation (continue-on-error, log chunk identity) is required. BATCH=32 is the failure precedent.
- `chunkText()` must remain pure and table-agnostic. Context prefix injection belongs in the loader. No table name may appear in the chunker.
- The five §6 acceptance gate tests must cover pathological inputs; happy-path tests do not satisfy the gate.
- Implementation follows §7 order: chunker → migration → loader → embed view. Out-of-order implementation creates dependency failures.
- `v_memory_hits` must be created in the schema setup path, not post-loader. The view must exist before any agent queries it.
- `ollamaEmbed` must assert the returned embedding array is non-empty and has non-zero Euclidean magnitude before writing. Zero-vectors poison cosine rankings.
- HNSW vector index is required on `memory_entry_chunks.embedding` and `session_chunks.embedding`. Without it, cosine queries perform sequential scans at 5000+ chunks — a hard latency regression.
- Encoded-cwd path computation must live in `scripts/lib/encoded-cwd.js`, branch on `process.platform === 'win32'`, and be unit-tested with a path round-trip test. No inline platform branching in the loader.

### Decisions for This Feature

- **DECISION-001 — v_memory_hits scope:** SQL view kept over JS UNION ALL. Add explicit `source_row_id` (consistent row ID in each source table) and `source_ordinal` (session_num for session_chunks, NULL elsewhere) columns to resolve the parent_id semantic incoherence identified by Skeptic (verdict CP1). `parent_id` is documented as display-only in a SQL view comment. Callers requiring reliable row linkage must use `source_row_id`. Invalidate if: a caller demonstrates a case where `source_row_id` is still ambiguous across source tables.

- **DECISION-002 — Idempotence strategy:** SHA256 `content_hash` column on all three chunk tables. Loader computes hash of source text before upsert; skips the Ollama call when stored hash matches. `--force` flag bypasses hash checking for full rebuilds (e.g., after model change). Unconditional `embedding = NULL` reset is not used as default because 1700+ chunks make every invocation a 30-second full rebuild (verdict CP2). Invalidate if: content_hash produces incorrect cache hits due to non-deterministic source text construction.

- **DECISION-003 — Acceptance gate:** `scripts/test-chunker.js` ships alongside the chunker and automates all five §6 tests (verdict CP3). Script must exit 0 on pass and 1 on any failure. A logged passing-run output is required in the PR description before any merge request is opened. Full CI hook is deferred but the script must exist and pass at v1. Invalidate if: CI integration supersedes the manual run requirement before PR open.

- **DECISION-004 — Per-source token calibration:** `chunkText()` accepts a ceiling parameter (chars). Loader passes 560 chars for JSONL sources (2.5 chars/token — validated by Skeptic with dense JSON/code content in tool_result blocks) and 1400 chars for prose sources (4.0 chars/token). The 1400-char ceiling with 30% margin does not hold for JSONL; the verdict invalidated this assumption for session_chunks (verdict "Invalidated Assumptions" §1). Invalidate if: empirical testing shows JSONL tool_result blocks average closer to 3.5 chars/token, permitting a higher ceiling.

---

## Phase 1: Chunker

**Files:** Create `scripts/pipeline-chunker.js`
**Model:** code_draft | **TDD:** required

### Task 1.1: Scaffold `chunkText()` with parameter signature

- [ ] Create `scripts/pipeline-chunker.js` with the exported interface:
  ```js
  // scripts/pipeline-chunker.js
  'use strict';
  function chunkText(text, ceilingChars = 1400) {
    // returns Array<{ content: string, chunkIdx: number }>
  }
  module.exports = { chunkText };
  ```
- [ ] Add Node `assert` import at top for inline unit tests.
- [ ] Verify file is syntactically valid: `node -e "require('./scripts/pipeline-chunker.js')"`

### Task 1.2: Implement boundary rule 1 — markdown heading split

- [ ] Inside `chunkText()`, build a boundary scanner that splits on `/^#{1,6}\s/m`. The heading line begins the new chunk (not the prior one).
- [ ] Write an inline assert: a string with two H2 headings produces exactly 2 chunks with `chunkIdx` 0 and 1.
- [ ] Run `node scripts/pipeline-chunker.js` — expect zero assertion errors.

### Task 1.3: Implement boundary rules 2–4 — code-fence, paragraph, sentence

- [ ] Rule 2: `/^```/m` — split at the closing fence; fence line ends the current chunk.
- [ ] Rule 3: `\n\n` — split at blank-line paragraph break.
- [ ] Rule 4: period/`?`/`!` followed by space and uppercase — split after the punctuation.
- [ ] Inline assert: a string containing a fenced code block is never bisected mid-fence.
- [ ] Run `node scripts/pipeline-chunker.js` — zero assertion errors.

### Task 1.4: Implement rule 5 — hard-split with overlap re-seed

- [ ] Rule 5 fires when no boundary found within `ceilingChars`. Hard-split at the ceiling.
- [ ] When rule 5 fires, carry the last `Math.floor(ceilingChars * 0.14)` chars of the prior chunk as overlap seed for the next chunk (50-token overlap at 4 chars/token ≈ 200 chars; proportional to ceiling for JSONL ceiling of 560 → ~78 chars). This satisfies the verdict "Plan Must" §10 re-seed requirement.
- [ ] Inline assert: a 3000-char string of non-whitespace (no valid boundary) produces chunks all ≤ `ceilingChars` chars and overlap is present.
- [ ] Run `node scripts/pipeline-chunker.js` — zero assertion errors.

### Task 1.5: Implement tool_result primary rule

- [ ] Add an optional second param `contentType` (`'prose'` | `'tool_result'`). When `'tool_result'`, apply rule 2 (code-fence) as the primary split before falling through to rule 4. Rule 4 (sentence) must not fire on code inside tool_result blocks. (Verdict "Plan Must" §6.)
- [ ] Inline assert: a tool_result string containing a fenced block and prose sentences splits on the fence, not mid-sentence.
- [ ] Run `node scripts/pipeline-chunker.js` — zero assertion errors.

### Task 1.6: Commit Phase 1

- [ ] `git add scripts/pipeline-chunker.js`
- [ ] `git commit -m "feat(chunker): add chunkText() with boundary rules and per-source ceiling param"`

---

## Phase 2: Schema Migration

**Files:** Modify `scripts/setup-knowledge-db.sql`
**Model:** code_draft | **TDD:** optional

### Task 2.1: Add `chunk_idx` to `policy_sections` and fix unique constraint

- [ ] Append to `scripts/setup-knowledge-db.sql`:
  ```sql
  -- Phase 2: chunker/loader migration (issue #142)
  ALTER TABLE policy_sections
    ADD COLUMN IF NOT EXISTS chunk_idx INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE policy_sections
    DROP CONSTRAINT IF EXISTS policy_sections_doc_section_uniq;

  ALTER TABLE policy_sections
    ADD CONSTRAINT IF NOT EXISTS policy_sections_doc_section_chunk_uniq
    UNIQUE (doc_id, section_num, chunk_idx);
  ```
- [ ] Run migration: `psql $DATABASE_URL -f scripts/setup-knowledge-db.sql`
- [ ] Verify: `psql $DATABASE_URL -c "\d policy_sections"` — confirm `chunk_idx` column present.

### Task 2.2: Create `memory_entry_chunks` table with GIN + HNSW indexes

- [ ] Append to `scripts/setup-knowledge-db.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS memory_entry_chunks (
    id         SERIAL PRIMARY KEY,
    entry_id   INTEGER NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
    chunk_idx  INTEGER NOT NULL,
    content    TEXT NOT NULL,
    content_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (entry_id, chunk_idx)
  );
  ALTER TABLE memory_entry_chunks
    ADD COLUMN IF NOT EXISTS embedding vector(1024);
  ALTER TABLE memory_entry_chunks
    ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
  CREATE INDEX IF NOT EXISTS mem_chunks_fts_idx
    ON memory_entry_chunks USING gin(fts_vec);
  CREATE INDEX IF NOT EXISTS mem_chunks_hnsw_idx
    ON memory_entry_chunks USING hnsw (embedding vector_cosine_ops);
  ```
- [ ] **Checkpoint CP1 (HNSW):** Verify index created: `psql $DATABASE_URL -c "\d memory_entry_chunks"` — confirm `mem_chunks_hnsw_idx` listed.

### Task 2.3: Add `content_hash` to `session_chunks` and HNSW index

- [ ] Append to `scripts/setup-knowledge-db.sql`:
  ```sql
  ALTER TABLE session_chunks
    ADD COLUMN IF NOT EXISTS content_hash TEXT;
  CREATE INDEX IF NOT EXISTS session_chunks_hnsw_idx
    ON session_chunks USING hnsw (embedding vector_cosine_ops);
  ```
- [ ] Run migration and verify: `psql $DATABASE_URL -c "\d session_chunks"` — confirm `content_hash` and `session_chunks_hnsw_idx`.

### Task 2.4: Add `content_hash` to `policy_sections`

- [ ] Append to `scripts/setup-knowledge-db.sql`:
  ```sql
  ALTER TABLE policy_sections
    ADD COLUMN IF NOT EXISTS content_hash TEXT;
  ```
- [ ] Run migration and verify: `psql $DATABASE_URL -c "\d policy_sections"` — confirm `content_hash` column.

### Task 2.5: Create `v_memory_hits` view (DECISION-001, CP4)

- [ ] Append to `scripts/setup-knowledge-db.sql`:
  ```sql
  CREATE OR REPLACE VIEW v_memory_hits AS
  -- parent_id is display-only: row ID for memory_entry_chunks/policy_sections,
  -- session ordinal (sessions.num) for session_chunks. Use source_row_id for
  -- reliable cross-source linkage.
    SELECT 'memory_entry_chunks'        AS source_table,
           mc.id                        AS chunk_id,
           mc.entry_id                  AS parent_id,
           mc.id                        AS source_row_id,
           NULL::INTEGER                AS source_ordinal,
           mc.chunk_idx,
           (SELECT COUNT(*) FROM memory_entry_chunks x WHERE x.entry_id = mc.entry_id)
                                        AS total_chunks,
           me.name                      AS label,
           substring(mc.content, 1, 300) AS snippet,
           mc.embedding,
           mc.fts_vec
    FROM memory_entry_chunks mc
    JOIN memory_entries me ON me.id = mc.entry_id
  UNION ALL
    SELECT 'policy_sections',
           ps.id,
           ps.id,
           ps.id,
           NULL::INTEGER,
           ps.chunk_idx,
           (SELECT COUNT(*) FROM policy_sections x
            WHERE x.doc_id = ps.doc_id AND x.section_num = ps.section_num),
           ps.doc_id || ' §' || coalesce(ps.section_num::TEXT, ''),
           substring(ps.content, 1, 300),
           ps.embedding,
           ps.fts_vec
    FROM policy_sections ps
  UNION ALL
    SELECT 'session_chunks',
           sc.id,
           sc.session_num,
           sc.id,
           sc.session_num,
           sc.chunk_idx,
           (SELECT COUNT(*) FROM session_chunks x
            WHERE x.session_id = sc.session_id),
           sc.session_id || ' [' || sc.chunk_kind || ']',
           substring(sc.content, 1, 300),
           sc.embedding,
           sc.fts_vec
    FROM session_chunks sc;
  ```
- [ ] Run migration and verify: `psql $DATABASE_URL -c "\d v_memory_hits"` — confirm all columns including `source_row_id`, `source_ordinal`, `chunk_idx`, `total_chunks`.

### Task 2.6: Commit Phase 2

- [ ] `git add scripts/setup-knowledge-db.sql`
- [ ] `git commit -m "feat(schema): add chunk_idx, content_hash, HNSW indexes, memory_entry_chunks, v_memory_hits"`

---

## Phase 3: Encoded-CWD Utility

**Files:** Create `scripts/lib/encoded-cwd.js`
**Model:** code_draft | **TDD:** required

### Task 3.1: Implement `getClaudeProjectDir()`

- [ ] Create `scripts/lib/encoded-cwd.js`:
  ```js
  'use strict';
  const os = require('os');
  const path = require('path');

  function encodeCwd(cwd) {
    if (process.platform === 'win32') {
      // Windows: drive colon becomes dash, backslashes become dashes
      // e.g. C:\Users\foo\dev\proj → C--Users-foo-dev-proj
      return cwd.replace(/:/g, '').replace(/\\/g, '-').replace(/^-/, '');
    }
    // POSIX: forward slashes become dashes, leading dash stripped
    return cwd.replace(/\//g, '-').replace(/^-/, '');
  }

  function getClaudeProjectDir(cwd) {
    const root = cwd || process.cwd();
    return path.join(os.homedir(), '.claude', 'projects', encodeCwd(root));
  }

  module.exports = { getClaudeProjectDir, encodeCwd };
  ```
- [ ] **Checkpoint CP3 (Windows path):** Add inline round-trip asserts at bottom of file:
  ```js
  if (require.main === module) {
    const assert = require('assert');
    // POSIX round-trip
    const posix = encodeCwd('/home/user/dev/pipeline');
    assert.strictEqual(posix, 'home-user-dev-pipeline', 'POSIX encode');
    // Windows round-trip
    const saved = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const win = encodeCwd('C:\\Users\\djwmo\\dev\\pipeline');
    Object.defineProperty(process, 'platform', { value: saved, configurable: true });
    assert.strictEqual(win, 'C-Users-djwmo-dev-pipeline', 'Windows encode');
    console.log('encoded-cwd: all assertions passed');
  }
  ```
- [ ] Run: `node scripts/lib/encoded-cwd.js` — expect "all assertions passed".

### Task 3.2: Commit Phase 3

- [ ] `git add scripts/lib/encoded-cwd.js`
- [ ] `git commit -m "feat(lib): add encoded-cwd utility with Windows-aware path computation"`

---

## Phase 4: Ollama Response Validation

**Files:** Modify `scripts/lib/shared.js`
**Model:** code_draft | **TDD:** required

### Task 4.1: Harden `ollamaEmbed()` against empty-array responses

- [ ] Locate `ollamaEmbed()` in `scripts/lib/shared.js`. After the existing HTTP-status check and `parsed.embeddings` resolve, add:
  ```js
  const embedding = parsed.embeddings[0];
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(`ollamaEmbed: empty embedding array returned for input (length ${text.length})`);
  }
  const magnitude = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (magnitude === 0) {
    throw new Error(`ollamaEmbed: zero-vector returned for input (length ${text.length})`);
  }
  ```
- [ ] **Checkpoint CP2 (Ollama validation):** Write a minimal test: mock `ollamaEmbed` with `embeddings: [[]]` and confirm it throws rather than returning. Use Node `assert` directly.
- [ ] Run the mock test — confirm throw.

### Task 4.2: Commit Phase 4

- [ ] `git add scripts/lib/shared.js`
- [ ] `git commit -m "fix(shared): validate ollamaEmbed response array is non-empty and non-zero-vector"`

---

## Phase 5: Loader

**Files:** Create `scripts/pipeline-memory-loader.js`
**Model:** code_draft | **TDD:** optional

### Task 5.1: Scaffold CLI entrypoint with subcommand dispatch

- [ ] Create `scripts/pipeline-memory-loader.js` with:
  - Header comment: usage, description, subcommands (`memory`, `sessions`, `policy`, `--all`), `--force` flag.
  - `require` for `scripts/lib/shared.js` (`ollamaEmbed`, `connect`, `loadConfig`), `scripts/lib/encoded-cwd.js`, `scripts/pipeline-chunker.js`, `crypto`, `fs`, `path`, `os`.
  - `const BATCH = 8;`
  - `const CONST_PROSE_CEILING = 1400;` and `const CONST_JSONL_CEILING = 560;` (DECISION-004).
  - Argument parsing: `const [,, subcmd, ...flags] = process.argv;` — resolve `--all`, `--force`.
  - Main dispatch: call `loadMemory()`, `loadSessions()`, or `loadPolicy()` per subcmd.
- [ ] Verify: `node scripts/pipeline-memory-loader.js` with no args prints usage and exits 0.

### Task 5.2: Implement shared embed-and-upsert helper

- [ ] Write `async function embedAndUpsert(db, chunks, upsertFn, forceFull)`:
  - Accepts an array of `{ content, chunkIdx, ...sourceFields }` objects.
  - Computes SHA256 content_hash per chunk: `crypto.createHash('sha256').update(content).digest('hex')`.
  - Fetches stored hash via `upsertFn` lookup; skips Ollama call if hash matches and `!forceFull` (DECISION-002).
  - Processes chunks in `BATCH=8` windows.
  - On Ollama error per chunk: logs `[SKIP] table=<t> id=<id> chunk_idx=<n> err=<msg>` and continues. Never throws.
  - Prints summary at end: `N embedded, M skipped (hash match), P skipped (error)`.

### Task 5.3: Implement `loadMemory()` — memory_entries source

- [ ] Read `*.md` files from `getClaudeProjectDir()` + `/memory/`. For each file:
  - `name` = filename without `.md`.
  - `description` = first line if it starts with `#`, stripped of `#` and whitespace.
  - `body` = full file content.
  - Upsert parent row to `memory_entries` with `ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`.
  - Call `chunkText(body, CONST_PROSE_CEILING)` → chunks.
  - For each chunk: context prefix = `"Memory: {name}\n\n{chunk.content}"`.
  - Upsert to `memory_entry_chunks` with `ON CONFLICT (entry_id, chunk_idx) DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, embedding = NULL`.
  - Call `embedAndUpsert()` on that file's chunks.

### Task 5.4: Implement `loadSessions()` — JSONL source

- [ ] Enumerate `*.jsonl` files from `getClaudeProjectDir()`. For each file:
  - Read line-by-line. Parse each line as JSON.
  - Skip lines where `role` is not in `['user', 'assistant', 'tool_use', 'tool_result']`.
  - For `tool_result` content: call `chunkText(content, CONST_JSONL_CEILING, 'tool_result')`.
  - For all other roles: call `chunkText(content, CONST_JSONL_CEILING)`.
  - Upsert to `session_chunks` with `ON CONFLICT (session_id, chunk_idx) DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, embedding = NULL`.
  - **Checkpoint CP4 (per-source calibration):** Confirm 560-char ceiling is passed for all JSONL sources.
- [ ] Call `embedAndUpsert()` per session file.

### Task 5.5: Implement `loadPolicy()` — CLAUDE.md source

- [ ] Resolve project CLAUDE.md: `path.join(process.env.PROJECT_ROOT || process.cwd(), 'CLAUDE.md')`. `doc_id = 'CLAUDE.md'`.
- [ ] Resolve global CLAUDE.md: `path.join(os.homedir(), '.claude', 'CLAUDE.md')`. `doc_id = 'global-CLAUDE.md'`.
- [ ] For each file: split on heading boundaries (`/^#{1,6}\s/m`) to produce one section per heading. `section_num` = integer index (1-based).
- [ ] For each section: call `chunkText(sectionContent, CONST_PROSE_CEILING)` → sub-chunks.
- [ ] Upsert to `policy_sections` with `ON CONFLICT (doc_id, section_num, chunk_idx) DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, embedding = NULL`.
- [ ] Call `embedAndUpsert()` per document.

### Task 5.6: Commit Phase 5

- [ ] `git add scripts/pipeline-memory-loader.js`
- [ ] `git commit -m "feat(loader): add pipeline-memory-loader with memory/sessions/policy subcommands"`

---

## Phase 6: `cmdHybrid` Update

**Files:** Modify `scripts/pipeline-embed.js` (around line 339)
**Model:** code_draft | **TDD:** optional

### Task 6.1: Add `v_memory_hits` query to `cmdHybrid`

- [ ] In `cmdHybrid`, add a query against `v_memory_hits` for both semantic (cosine via embedding) and FTS (via `fts_vec`). Do not remove existing per-table queries if they serve non-chunk tables.
- [ ] Format result rows to display: `[source_table] label — snippet... (chunk N of M)`.
- [ ] Ensure existing TABLES queries continue to function; do not break non-chunk table output.
- [ ] Manual verification: `node scripts/pipeline-embed.js hybrid "destructive operation"` — confirm at least one result from `v_memory_hits` with chunk position indicator.

### Task 6.2: Create `v_memory_hits` in embed setup path

- [ ] In `pipeline-embed.js` setup/introspection path (where other schema objects are created), add the `CREATE OR REPLACE VIEW v_memory_hits AS ...` DDL. This ensures the view exists even if `setup-knowledge-db.sql` was not re-run, and satisfies the verdict constraint that the view must exist before any agent queries it.

### Task 6.3: Commit Phase 6

- [ ] `git add scripts/pipeline-embed.js`
- [ ] `git commit -m "feat(embed): query v_memory_hits in cmdHybrid with chunk position indicator"`

---

## Phase 7: Documentation

**Files:** Modify `docs/memory.md`, `CHANGELOG.md`
**Model:** short_draft | **TDD:** optional

### Task 7.1: Update `docs/memory.md` loader status (line 248 paragraph)

- [ ] Replace the paragraph at line 248 that begins "Pipeline does not ship a loader for these six tables" with:
  > Pipeline ships loaders for `memory_entries`, `policy_sections`, and `session_chunks` via `node scripts/pipeline-memory-loader.js`. Subcommands: `memory`, `sessions`, `policy`, `--all`. Use `--force` for a full rebuild. Loaders for `incidents`, `checklist_items`, and `corpus_files` are deferred.
- [ ] Verify line count in updated file is within expected range.

### Task 7.2: Update `docs/memory.md` Populator column (lines 60–66)

- [ ] In the table near lines 60–66, update the "Populator" column for `memory_entries`, `session_chunks`, and `policy_sections` from whatever current value to `pipeline-memory-loader.js`.

### Task 7.3: Add CHANGELOG entry

- [ ] In `CHANGELOG.md` under `[Unreleased]` > `Added`:
  ```
  - `scripts/pipeline-chunker.js`: boundary-aware text chunker with per-source token ceiling (1400 chars prose / 560 chars JSONL)
  - `scripts/pipeline-memory-loader.js`: loaders for memory_entries, policy_sections, session_chunks with idempotent SHA256 content_hash skip and BATCH=8 error isolation
  - `scripts/lib/encoded-cwd.js`: Windows-aware Claude project directory path utility
  - `v_memory_hits` SQL view: unified chunk retrieval surface with chunk position metadata
  - HNSW vector indexes on memory_entry_chunks.embedding and session_chunks.embedding
  ```

### Task 7.4: Commit Phase 7

- [ ] `git add docs/memory.md CHANGELOG.md`
- [ ] `git commit -m "docs: update memory.md loader status and add CHANGELOG entries for chunker/loader"`

---

## Phase 8: Test Gate (`scripts/test-chunker.js`)

**Files:** Create `scripts/test-chunker.js`
**Model:** code_draft | **TDD:** required

This is DECISION-003: automated test runner for all five §6 acceptance tests. Exit 0 = pass, exit 1 = fail.

### Task 8.1: Scaffold test runner with helpers

- [ ] Create `scripts/test-chunker.js` with:
  - `const assert = require('assert');`
  - `let passed = 0; let failed = 0;`
  - Helper `run(name, fn)` that calls `fn()` in try/catch, logs pass/fail, increments counters.
  - At end: `console.log(\`${passed} passed, ${failed} failed\`); process.exit(failed > 0 ? 1 : 0);`

### Task 8.2: Test 1 — Pathological policy section (>8000 chars)

- [ ] Construct a string of 8100 chars (mix of words and `##` headings every 2000 chars).
- [ ] Call `chunkText(str, 1400)`. Assert: `chunks.length >= 2`; no chunk's `content.length > 1600`; chunks cover the full source text without omission.
- [ ] Verify a mid-section phrase is retrievable by checking that phrase appears in one of the returned chunk `content` strings.

### Task 8.3: Test 2 — Pathological memory body (>20000 chars)

- [ ] Construct a 20500-char string with content spread across 10 sections.
- [ ] Call `chunkText(str, 1400)`. Assert: `chunks.length >= 5`; no Ollama overrun (chunk length ≤ 1600 chars); a phrase present only in the 4th or later chunk is found in chunk index ≥ 3.

### Task 8.4: Test 3 — Pathological session message (>4000 chars)

- [ ] Construct a 4200-char string with JSON-escaped content and a fenced code block (representing a tool_result).
- [ ] Call `chunkText(str, 560, 'tool_result')`. Assert: `chunks.length >= 2`; fenced block is not bisected mid-fence; all chunk lengths ≤ 672 chars (20% headroom over 560 ceiling).

### Task 8.5: Test 4 — Idempotence (content_hash logic)

- [ ] Simulate two loader runs against identical source text. On first run: hash stored = null, embed call made. On second run: stored hash matches computed hash → embed call skipped.
- [ ] Assert: row count identical after both simulated runs; Ollama call mock invoked exactly once total.

### Task 8.6: Test 5 — Ollama empty-array validation + partial failure resilience

- [ ] **Checkpoint CP2 (Ollama validation):** Mock `ollamaEmbed` to return `{ embeddings: [[]] }` for one chunk and valid embeddings for others.
- [ ] Assert: the empty-array chunk throws (caught per-chunk), is logged, and skipped. Neighboring chunks in the same BATCH=8 window embed successfully. The loader does not abort.

### Task 8.7: Test — Windows encoded-cwd path round-trip

- [ ] **Checkpoint CP3 (Windows path):** Import `encodeCwd` from `scripts/lib/encoded-cwd.js`.
- [ ] Assert POSIX: `encodeCwd('/home/user/dev/pipeline') === 'home-user-dev-pipeline'`.
- [ ] Assert Windows simulation: override `process.platform` temporarily; `encodeCwd('C:\\Users\\djwmo\\dev\\pipeline') === 'C-Users-djwmo-dev-pipeline'`.

### Task 8.8: Run test suite and confirm green

- [ ] `node scripts/test-chunker.js`
- [ ] Expected: all tests pass, exit 0. Fix any failures before proceeding to Phase 9.

### Task 8.9: Commit Phase 8

- [ ] `git add scripts/test-chunker.js`
- [ ] `git commit -m "test: add test-chunker.js covering all five §6 acceptance gate tests"`

---

## Phase 9: Verification Against Real Project Data

**Model:** no_llm (script execution only)

### Task 9.1: Run memory loader against this project's memory files

- [ ] `PROJECT_ROOT=$(pwd) node scripts/pipeline-memory-loader.js memory`
- [ ] Confirm output: `N embedded, M skipped (hash match), P skipped (error)`. Expect P = 0 on first run.
- [ ] `psql $DATABASE_URL -c "SELECT COUNT(*) FROM memory_entry_chunks;"` — confirm row count > 0.

### Task 9.2: Run policy loader against project and global CLAUDE.md

- [ ] `PROJECT_ROOT=$(pwd) node scripts/pipeline-memory-loader.js policy`
- [ ] Confirm no Ollama overrun errors (the "Destructive Operation Guards" section in CLAUDE.md exceeds 3000 chars and must be sub-chunked cleanly).
- [ ] `psql $DATABASE_URL -c "SELECT doc_id, COUNT(*) FROM policy_sections GROUP BY doc_id;"` — confirm both `CLAUDE.md` and `global-CLAUDE.md` present with multiple rows.

### Task 9.3: Run session loader against existing JSONLs

- [ ] `PROJECT_ROOT=$(pwd) node scripts/pipeline-memory-loader.js sessions`
- [ ] Confirm JSONL files are found (non-zero count). If count = 0, verify `getClaudeProjectDir()` resolves correctly on this platform.
- [ ] `psql $DATABASE_URL -c "SELECT COUNT(*) FROM session_chunks WHERE embedding IS NOT NULL;"` — confirm > 0.

### Task 9.4: Verify embedding stats

- [ ] `node scripts/pipeline-embed.js stats` — confirm 100% coverage on `memory_entry_chunks`, `policy_sections`, `session_chunks` (0 rows with null embedding after loader run).

### Task 9.5: Verify hybrid search returns chunk results

- [ ] `node scripts/pipeline-embed.js hybrid "destructive operation"` — expect at least one result from `v_memory_hits` with a `(chunk N of M)` position indicator.
- [ ] `node scripts/pipeline-embed.js hybrid "encoded cwd"` — expect result from session or memory chunks.

### Task 9.6: Final commit

- [ ] `git add -A`
- [ ] `git commit -m "chore: verify loader integration against real project data"`

---

## Build Sequence

1. **Phase 1** — `pipeline-chunker.js` (no dependencies; pure function)
2. **Phase 2** — Schema migration (depends on Phase 1 design being stable)
3. **Phase 3** — `encoded-cwd.js` (no dependencies; pure utility)
4. **Phase 4** — `ollamaEmbed` hardening (depends on understanding of expected interface; no code dependencies)
5. **Phase 5** — `pipeline-memory-loader.js` (depends on Phases 1, 2, 3, 4)
6. **Phase 6** — `cmdHybrid` update (depends on Phase 2 view DDL)
7. **Phase 7** — Documentation (depends on Phases 1–5 being implementation-stable)
8. **Phase 8** — `test-chunker.js` (depends on Phases 1, 3, 4; runs against real DB for Tests 4–5)
9. **Phase 9** — Verification (depends on all prior phases; required before PR open)

---

## Checkpoint Registry

| ID | Phase | Verdict reference | What to verify |
|----|-------|-------------------|----------------|
| CP1 | 2.2 | HNSW index — Invalidated Assumption §2 | `\d memory_entry_chunks` shows `mem_chunks_hnsw_idx` |
| CP2 | 4.1, 8.6 | Ollama empty-array — Invalidated Assumption §4 | `ollamaEmbed` throws on `embeddings: [[]]`; Test 5 passes |
| CP3 | 3.1, 8.7 | Windows encoded-cwd — Invalidated Assumption §5 | Round-trip asserts pass on Windows path format |
| CP4 | 5.4 | Per-source calibration — Invalidated Assumption §1 | JSONL loader passes 560-char ceiling; prose loader passes 1400-char ceiling |

All four checkpoints must be verified before any merge request is opened.

---

## Pre-Merge Gate

- [ ] `node scripts/test-chunker.js` exits 0 — paste full output in PR description (DECISION-003).
- [ ] Phase 9 verification complete — `pipeline-embed.js stats` shows 0 null-embedding rows on all three chunk tables.
- [ ] All four checkpoints CP1–CP4 verified.
- [ ] No chunk written with a zero-vector embedding (validate via `psql -c "SELECT COUNT(*) FROM memory_entry_chunks WHERE embedding IS NULL"` after loader run with no errors).
