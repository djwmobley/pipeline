# Pipeline Ergonomics and Robustness Implementation Plan

> **For agentic workers:** Use /pipeline:build to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver ten targeted follow-up items from the PR #143 dogfooding audit across four PRs, eliminating manual memory-loader ceremony, heredoc workarounds, silent data-loss surfaces, and shared-code duplication.

**Architecture:** Phase 1 touches six files with no shared state between items and ships as a single PR; Phase 2 adds schema-derived invariants that depend on Phase 1's unique constraint being live; Phase 3a extracts the `embedWithRetry` shared helper; Phase 3b adds the CI gate that validates Phase 3a from its first run. Each phase is a self-contained, narrowly reviewable PR. No new external dependencies are introduced in any phase.

**Tech Stack:** Node.js 20, PostgreSQL 16 + pgvector, GitHub Actions, existing `scripts/platform.js` custom argv-parser CLI (NOT commander), existing `scripts/hooks/routing-check.js` hook infrastructure, `assert` module for inline tests.

**Model Routing:** Haiku for file reads, grep audits, and smoke-test verification steps. Sonnet for all code drafting (platform.js help-banner update, SQL migration, YAML workflow, JS helper extraction). No Opus drafting.

**Decisions:** Inline — see Architectural Constraints below.

**Branch:** `feat/pipeline-ergonomics-and-robustness`
**Issue:** #144 (labeled `roadmap`)
**Postgres task:** `INSERT INTO roadmap_tasks (title, github_issue, status) VALUES ('Pipeline ergonomics and robustness sprint', 144, 'in_progress')` — run after first PR merges.

---

## Architectural Constraints

### Existing Stack
- **Node:** unspecified at root; Node 20+ implied. `scripts/package.json` declares `pg ^8.18.0` as the only Node dep. Root `package.json` does NOT exist (markdown-only plugin).
- **Postgres + pgvector:** Postgres 16, pgvector extension expected; the setup SQL has `CREATE EXTENSION IF NOT EXISTS vector` and gracefully skips vector columns when missing.
- **CLI in scripts/platform.js:** custom argv parser (`parseArgs` at line 557), NOT commander. Uses promisified `execFile`. Subcommand dispatch via switch at line 634+.
- **Embedding:** Ollama HTTP (mxbai-embed-large via pipeline.yml `knowledge.embedding_model`).
- **Test framework:** Node `assert` module, inline tests under `if (require.main === module)` blocks; no Jest, no Vitest. `scripts/test-chunker.js` is the regression gate (Tests 1-6, all green at HEAD `7991f5d`).
- **CI:** **NO `.github/` directory exists.** Phase 3b workflow is genuinely net-new — no existing workflows to model after.

### Established Patterns (verified from current code)
- **Idempotent SQL block:** `DO $$ BEGIN ... EXCEPTION WHEN undefined_object THEN RAISE NOTICE '...'; END $$` — used 14+ times in `scripts/setup-knowledge-db.sql` for vector columns and ALTER TABLE statements. Phase 1 Item 4 unique-constraint addition MUST follow this pattern (with `EXCEPTION WHEN duplicate_object THEN NULL` for constraint-already-exists).
- **stdin handling in platform.js:** `readStdin()` async function at line 187. The `--stdin` flag is captured at lines 565-566. Stdin is read once at lines 600-606 BEFORE dispatch. `stdinBody` is passed via `body: stdinBody || flags.body` to `issueCreate` (line 636), `issueComment` (639), `issueEdit` (651), `prCreate` (669), `prComment` (675). **The `--stdin` option-parser and runtime path are already fully wired for all subcommands including `issue create` and `pr create`.** What is missing: (a) help-banner docstring lines 12-27 only show `--stdin` for `comment` subcommands; (b) no smoke test verifying it round-trips for create.
- **Hook stdin parse:** `scripts/hooks/routing-check.js` lines 33-40 — chunks joined, `JSON.parse`'d, wrapped in try/catch that calls `logError` and proceeds with `process.exit(0)`. **No once-per-session warning surface today.**
- **Skill operation_class frontmatter:** verified across `skills/planning/SKILL.md`, `skills/qa/SKILL.md`, `skills/architecture/SKILL.md`. Pattern: YAML `name`, `description`, `operation_class` (closed enum), `allowed_models` (array, may be empty), `allowed_direct_write` (bool). Validated by `scripts/pipeline-lint-agents.js check-operation-class`.
- **Active-skill tracking:** commands write `node scripts/lib/active-skill.js write <skill>` in their preamble shell block. Live file at `.claude/.active-skill` (60s staleness window per gotcha #6).
- **Encoded-cwd helper at `scripts/lib/encoded-cwd.js`:** ALREADY EXISTS, exports `encodeCwd` and `getClaudeProjectDir`. Consumed by `scripts/pipeline-memory-loader.js:31` and `scripts/test-chunker.js:24`. NOT YET CONSUMED by `scripts/pipeline-cost.js` which still has inline `cwd.replace(/[^a-zA-Z0-9-]/g, '-')` at lines 33-40 — that is the only known inline caller.
- **Chunker migration block:** `scripts/setup-knowledge-db.sql` lines 510-545 has the post-PR-#143 migration with `policy_sections.chunk_idx`, `session_chunks.content_hash`, `memory_entry_chunks` table. The migration block is the natural home for the Phase 1 Item 4 UNIQUE constraint addition.
- **MEMORY_HITS_COVERED location:** The constant lives in `scripts/pipeline-embed.js` line 167 as `const MEMORY_HITS_COVERED = new Set(['memory_entries', 'session_chunks', 'policy_sections', 'memory_entry_chunks'])`. It is consumed at lines 211, 343, 423 (`cmdIndex`, `cmdSearch`, `cmdHybrid`). The spec incorrectly names `scripts/pipeline-db.js`; the correct target file is `scripts/pipeline-embed.js`.

### Live-code corrections to spec assumptions (CRITICAL)

1. **Spec Item 2 — `--stdin`:** Already fully plumbed in `platform.js` for `issue create` and `pr create`. **Plan adjustment:** Item 2 is reduced to (a) updating the help-banner docstring comment to add `--stdin` examples for create subcommands, and (b) a smoke-test verification step. NO option-parser change needed.

2. **Spec Item 4 — UNIQUE constraint on `session_chunks(session_id, chunk_idx)`:** Live code confirms NO existing constraint. Migration block at lines 525-527 only adds `content_hash`. The task lands cleanly in the migration block.

3. **Spec Item 7 — `MEMORY_HITS_COVERED` introspection:** Spec says `scripts/pipeline-db.js or the query site`. **Live code:** constant is in `scripts/pipeline-embed.js:167`. **Plan adjustment:** target `scripts/pipeline-embed.js` exclusively.

4. **Spec Item 8 — encoded-cwd consolidation:** Spec says "extract into a dedicated module". **Live code:** `scripts/lib/encoded-cwd.js` already exists from PR #143. **Plan adjustment:** audit + migrate `scripts/pipeline-cost.js:33-40` only — NOT module creation.

5. **Spec Item 11 (dogfood addition):** `/pipeline:plan` slash command runs 4+ orchestration substeps automatically. Raw `Agent` dispatch skips them. Plan includes a task (Task 2.5) to add an explicit guidance block to `skills/planning/SKILL.md` using option (b) — orchestrator-only documentation.

### Relevant Domains
- **DATA:** `setup-knowledge-db.sql` migration patterns; `information_schema` introspection.
- **CLI/HOOKS:** `platform.js` argv parser; `routing-check.js` stdin/JSON.parse error path.
- **COMMANDS:** `commands/finish.md`, `commands/init.md` Step 4-block edits.
- **TOOLING:** `scripts/lib/encoded-cwd.js` consumer migration; `scripts/pipeline-embed.js` extraction of `embedWithRetry`.
- **CI:** new `.github/workflows/test-chunker.yml`.

### Environment Requirements
- `PROJECT_ROOT` (set by all callers via `PROJECT_ROOT=$(pwd) node scripts/...`).
- `DATABASE_URL` optional; pipeline.yml `knowledge.*` is fallback.
- `OLLAMA_HOST` optional; default `http://localhost:11434`.
- `OLLAMA_SKIP=1` reserved for CI runs that lack Ollama (Phase 3b).

### Decisions for This Feature

- **DECISION-001: Phasing locked at 4 PRs.** Phase 1 bundles six TINY items (Items 1-6) into one PR to reduce ceremony cost. Phase 2 bundles three items (Items 7-8-11). Phase 3a (Item 9) and Phase 3b (Item 10) are separate PRs so each is narrowly reviewable. Invalidate if: any Phase 1 item conflicts with another such that they cannot ship together without a merge conflict or a runtime ordering dependency.

- **DECISION-002: `embedWithRetry(rows, embedFn, options)` API shape.** Options object: `{ batchSize = 32, maxRetries = 3, onBatchError = null }`. The oversize guard (skip rows exceeding `MAX_EMBED_BYTES`) lives inside `embedWithRetry`, not in callers. Invalidate if: a third caller emerges with requirements that cannot be satisfied by the options object without a breaking signature change.

- **DECISION-003: finish auto-loader is opt-in via config flag.** The config flag `finish.auto_load_memory: true` must be explicitly set; default is `false`. When `false`, finish prints a one-line hint instead of running the loader. Invalidate if: dogfooding across two or more sessions shows users always set the flag to `true`.

- **DECISION-004: MEMORY_HITS_COVERED replacement targets `scripts/pipeline-embed.js` only.** Spec named `pipeline-db.js`; live code shows the constant is in `pipeline-embed.js`. Query uses `current_schema()` for consistency with the existing `tableExists`/`columnExists` helpers in the same file. Invalidate if: grep finds the constant referenced in additional files.

- **DECISION-005: Item 11 uses option (b) — orchestrator-only guidance block.** `skills/planning/SKILL.md` gets a new section documenting the 4-step orchestration sequence. Option (a) (inline all steps into the planner prompt) is rejected: bloats the prompt past safe sizes. Invalidate if: the planning skill prompt budget can accommodate inlining.

---

## Phase 1: Ergonomics + Immediate Robustness (Items 1-6, one PR)

**Spec coverage:** Items 1, 2, 3, 4, 5, 6 (spec §4.1 through §5.1)
**Files touched:** `commands/finish.md`, `commands/init.md`, `scripts/platform.js`, `scripts/setup-knowledge-db.sql`, `scripts/hooks/routing-check.js`, `.claude/settings.json`, `CLAUDE.md`

---

### Task 1.1: Read finish.md to locate the Step 4b merge-confirm block

**Model:** haiku
**TDD:** optional

**Files:**
- Read: `commands/finish.md`

- [ ] **Step 1.1.1:** Read `commands/finish.md`. Identify the exact location of Step 4b's merge-confirm block and the line immediately after the merge confirmation output. Note the line range so Task 1.2 can insert precisely.

---

### Task 1.2: Wire memory loader into finish Step 4b (spec §4.1, §5.1 Item 1)

**Model:** sonnet
**TDD:** optional

**Files:**
- Read: `scripts/pipeline-memory-loader.js` (header / argv parser only)
- Modify: `commands/finish.md`

- [ ] **Step 1.2.0:** Pre-flight audit — confirm the loader supports the flags the finish edit will use. Read `scripts/pipeline-memory-loader.js` header (lines 1-100) and argv parser. Confirm: (a) `all` is a valid subcommand, (b) `--quiet` flag exists OR find the equivalent silent-output mode. If neither exists, STOP and surface to the orchestrator — the loader needs `--quiet` added in a sub-task before Task 1.2 can ship. Document the chosen flag in the next step.

- [ ] **Step 1.2.1:** After the merge-confirm output line in Step 4b, insert the conditional loader call using the flag confirmed in Step 1.2.0. When `finish.auto_load_memory` is `true` in pipeline.yml, append:

  ```
  node scripts/pipeline-memory-loader.js all --quiet
  ```

  If the loader exits non-zero, print:
  `Memory loader exited with error — merge succeeded, embedding skipped.`
  and continue. When the flag is `false` or absent, print instead:
  `Run node scripts/pipeline-memory-loader.js all to embed this session.`

- [ ] **Step 1.2.2:** Read back the modified `commands/finish.md` Step 4b block to confirm: the loader call is present, the non-zero-exit guard is present, the hint-only path is present, and the total heredoc body remains under 800 bytes.

---

### Task 1.3: Update platform.js help banner for --stdin on create subcommands (spec §4.2, §5.1 Item 2)

**Model:** sonnet
**TDD:** optional

**Files:**
- Modify: `scripts/platform.js` (lines 12-27 JSDoc header)

> **Live-code note:** The `--stdin` flag is already fully wired in `parseArgs` (line 565-566), `readStdin` gating (lines 600-606), `issueCreate` dispatch (line 636), and `prCreate` dispatch (line 669). NO option-parser change is needed. This task only updates the usage comment and adds a smoke-test verification.

- [ ] **Step 1.3.1:** In the JSDoc header block at the top of `scripts/platform.js`, update the usage lines for `issue create` and `pr create` to add `--stdin` examples alongside the existing `--body` examples:

  For `issue create` (after the existing example on line 12):
  ```
  *   node platform.js issue create --title "Fix bug" --stdin          # Read body from stdin
  ```
  For `pr create` (after the existing example on line 22):
  ```
  *   node platform.js pr create --title "feat: X" --stdin --source feat/x --target main
  ```

- [ ] **Step 1.3.2:** <!-- checkpoint:MUST phase1-stdin-smoke --> Smoke test — confirm `--stdin` is accepted without error for `issue create`:

  ```bash
  echo "test body from stdin" | node scripts/platform.js issue create --title "stdin-test-dry" --stdin 2>&1 | head -5
  ```

  Expected: output may include a backend auth error or config error, but must NOT include `Unknown flag: --stdin` or `--stdin flag set but no input received on stdin`.

---

### Task 1.4: Add optional Step 4d to pipeline:init (spec §4.3, §5.1 Item 3)

**Model:** sonnet
**TDD:** optional

**Files:**
- Modify: `commands/init.md`

- [ ] **Step 1.4.1:** Read `commands/init.md`. Locate Step 4c (knowledge-DB schema apply) and the content immediately following it.

- [ ] **Step 1.4.2:** Insert Step 4d after Step 4c:

  ```
  **Step 4d (optional) — Seed memory from existing sessions:**
  To embed existing session transcripts into the knowledge DB immediately, run:
    node scripts/pipeline-memory-loader.js all
  Skip this step if no sessions exist yet or you prefer to run the loader manually later.
  If no session files are found, the loader exits 0 with a "no sessions found" message — this is not an error.
  ```

- [ ] **Step 1.4.3:** Read back the modified section to confirm Step 4d is present, the skip path is described, and the zero-session-files case is documented.

---

### Task 1.5: Add UNIQUE constraint to session_chunks with pre-flight duplicate check (spec §4.4, §5.1 Item 4)

**Model:** sonnet
**TDD:** required

**Files:**
- Modify: `scripts/setup-knowledge-db.sql` (within the migration block at lines 525-545)

> **Ordering invariant:** The pre-flight diagnostic block (Step 1.5.2) MUST appear in the SQL file **before** the constraint block (Step 1.5.3). Insertion order in the SQL file determines execution order. The diagnostic raises an exception on existing duplicates so the constraint is never reached on a corrupted state. Steps below are written in the order they should appear in the final SQL file, top-to-bottom.

- [ ] **Step 1.5.1:** Read `scripts/setup-knowledge-db.sql` lines 497-548 to confirm the migration block boundaries and the exact location of the `session_chunks` `content_hash` addition at lines 525-527.

- [ ] **Step 1.5.2:** **Pre-flight diagnostic — INSERTED FIRST (before the constraint block in Step 1.5.3).** Immediately after the `session_chunks` `content_hash` column addition (line 527), insert:

  ```sql
  -- session_chunks — pre-flight: detect duplicates that would break the new UNIQUE constraint
  DO $$
  DECLARE dup_count INTEGER;
  BEGIN
    SELECT COUNT(*) INTO dup_count FROM (
      SELECT session_id, chunk_idx, COUNT(*) c
      FROM session_chunks
      WHERE session_id IS NOT NULL
      GROUP BY session_id, chunk_idx HAVING COUNT(*) > 1
    ) d;
    IF dup_count > 0 THEN
      RAISE EXCEPTION 'session_chunks has % duplicate (session_id, chunk_idx) rows — dedupe before applying UNIQUE constraint', dup_count;
    END IF;
  END $$;
  ```

  Rationale: the loader uses `content_hash` ON CONFLICT, but earlier rows pre-migration may have NULL `session_id` or pre-content-hash duplicates. Failing loud here is preferable to a silent constraint creation that blocks every subsequent loader run.

- [ ] **Step 1.5.3:** **Constraint block — INSERTED SECOND (immediately after the diagnostic above).** Append:

  ```sql
  -- session_chunks — prevent duplicate (session_id, chunk_idx) pairs
  DO $$ BEGIN
    ALTER TABLE session_chunks
      ADD CONSTRAINT session_chunks_session_chunk_unique UNIQUE (session_id, chunk_idx);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
  ```

- [ ] **Step 1.5.4:** Read back lines 525-555 to confirm the diagnostic block appears textually before the constraint block, and that `EXCEPTION WHEN duplicate_object THEN NULL` is on the constraint block (not `RAISE NOTICE` — the constraint already existing is a silent no-op).

- [ ] **Step 1.5.5:** <!-- checkpoint:MUST phase1-unique-constraint --> Smoke test: apply `scripts/setup-knowledge-db.sql` to a local test DB twice. Confirm no error on the second run. Then:

  ```bash
  psql $DATABASE_URL -c "INSERT INTO session_chunks (session_id, chunk_idx, content) VALUES ('test-sess', 0, 'a');"
  psql $DATABASE_URL -c "INSERT INTO session_chunks (session_id, chunk_idx, content) VALUES ('test-sess', 0, 'b');"
  ```

  Expected on the second INSERT: `ERROR:  duplicate key value violates unique constraint "session_chunks_session_chunk_unique"`.

- [ ] **Step 1.5.6:** Pre-flight failure smoke test: insert two duplicate rows, then re-apply `setup-knowledge-db.sql` against that DB. Expected: the diagnostic block raises `session_chunks has 1 duplicate (session_id, chunk_idx) rows — dedupe before applying UNIQUE constraint`. Confirms the diagnostic fires before the constraint is reached.

---

### Task 1.6: Add once-per-session parse-fail warning to routing-check.js (spec §4.5, §5.1 Item 5)

**Model:** sonnet
**TDD:** required

**Files:**
- Modify: `scripts/hooks/routing-check.js`

- [ ] **Step 1.6.1:** Read `scripts/hooks/routing-check.js` lines 29-42 to confirm the catch block structure. Verify that line 39 only calls `logError` and then `process.exit(0)` — no user-visible warning exists today.

- [ ] **Step 1.6.2:** Add a module-level flag immediately before the `async function main()` definition:

  ```javascript
  let warnedThisSession = false;
  ```

- [ ] **Step 1.6.3:** In the catch block, after the existing `logError(...)` call and before `process.exit(0)`, insert:

  ```javascript
    if (!warnedThisSession) {
      process.stderr.write('[routing-check] WARNING: stdin JSON parse failed; hook bypassed for this call.\n');
      warnedThisSession = true;
    }
  ```

- [ ] **Step 1.6.4:** Read back the modified catch block (lines 38-42 area) to confirm: `logError` still fires, the warning fires only on the first parse failure in the process lifetime, and `process.exit(0)` still follows (fail-open behavior preserved).

- [ ] **Step 1.6.5:** Smoke test:

  ```bash
  echo "not-json" | node scripts/hooks/routing-check.js 2>&1 | grep -c "WARNING"
  ```

  Expected output: `1`

---

### Task 1.7: Widen Bash prefix entries and document in CLAUDE.md (spec §4.6, §5.1 Item 6)

**Model:** sonnet
**TDD:** optional

**Files:**
- Modify: `.claude/settings.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1.7.1:** Read `.claude/settings.json`. List any exact-match Bash permission entries for `node scripts/pipeline-db.js`, `node scripts/pipeline-cost.js`, and related verification one-liners that accept variable arguments.

- [ ] **Step 1.7.2:** For each identified exact-match entry, replace with a prefix wildcard pattern. Example replacement:

  Before: `{ "type": "bash", "pattern": "node scripts/pipeline-db.js query \"SELECT * FROM roadmap_tasks\"" }`
  After: `{ "type": "bash", "pattern": "node scripts/pipeline-db.js*" }`

  Remove the exact-match entries — do not leave both in place.

- [ ] **Step 1.7.3:** Read `CLAUDE.md`. Locate the "Shell Safety" section.

- [ ] **Step 1.7.4:** Add a subsection `### Permission entry discipline` under "Shell Safety":

  ```
  ### Permission entry discipline

  Always use prefix wildcard patterns for scripts that accept variable arguments
  (e.g., SQL query strings, PR titles, issue body text).

  **Do:** `{ "type": "bash", "pattern": "node scripts/pipeline-db.js*" }`
  **Don't:** exact-match entries that accumulate per unique invocation.

  Never leave both an exact-match entry and a prefix entry for the same base command.
  When widening, remove the exact-match entries entirely.
  ```

- [ ] **Step 1.7.5:** Read back both files to confirm: prefix entries replaced exact-match entries in `settings.json`; the `### Permission entry discipline` subsection exists in CLAUDE.md under "Shell Safety".

---

### Task 1.8: Phase 1 regression check and commit

**Model:** haiku
**TDD:** optional

**Files:**
- Run: `node scripts/test-chunker.js`
- Run: `claude plugin validate .`

- [ ] **Step 1.8.1:** Run `PROJECT_ROOT=$(pwd) node scripts/test-chunker.js`. Expected: 6/6 pass. If any test fails, do not commit — investigate before proceeding.

- [ ] **Step 1.8.2:** Run `claude plugin validate .` from the pipeline root. Expected: no validation errors.

- [ ] **Step 1.8.3:** Commit all Phase 1 changes:

  ```bash
  git add commands/finish.md commands/init.md scripts/platform.js \
    scripts/setup-knowledge-db.sql scripts/hooks/routing-check.js \
    .claude/settings.json CLAUDE.md
  git commit -m "feat(ergonomics): Phase 1 — finish auto-loader, --stdin docs, init step 4d, unique constraint, parse-fail warning, prefix hygiene"
  ```

---

## Phase 2: Schema-Driven Invariants + Planning Skill Parity (Items 7-8-11, second PR)

**Spec coverage:** Items 7, 8 (spec §4.7, §4.8, §5.2) and Item 11 (dogfood addition 2026-04-26)
**Files touched:** `scripts/pipeline-embed.js`, `scripts/pipeline-cost.js`, `skills/planning/SKILL.md`

---

### Task 2.1: Locate MEMORY_HITS_COVERED and all call sites

**Model:** haiku
**TDD:** optional

**Files:**
- Grep: `scripts/`

- [ ] **Step 2.1.1:** Grep `scripts/` for `MEMORY_HITS_COVERED`. Confirm: constant defined at `scripts/pipeline-embed.js:167`; call sites at approximately lines 211, 343, 423 of the same file (`cmdIndex`, `cmdSearch`, `cmdHybrid`). Record if any additional files reference this constant.

- [ ] **Step 2.1.2:** Read `scripts/pipeline-embed.js` lines 163-170 to confirm the Set literal contains exactly `['memory_entries', 'session_chunks', 'policy_sections', 'memory_entry_chunks']`.

---

### Task 2.2: Replace MEMORY_HITS_COVERED with schema introspection (spec §4.7, §5.2 Item 7)

**Model:** sonnet
**TDD:** required

**Files:**
- Modify: `scripts/pipeline-embed.js` (lines ~163-167 constant definition; call sites at ~211, ~343, ~423)

> **Live-code note:** The constant is in `scripts/pipeline-embed.js`, NOT `scripts/pipeline-db.js`. The spec had the wrong file.

- [ ] **Step 2.2.1:** Remove the `MEMORY_HITS_COVERED` constant declaration at line 167. In its place, add a module-level cache variable and async helper:

  ```javascript
  // ─── CHUNK-COVERED TABLES ────────────────────────────────────────────────────
  // Derived from information_schema at first use; cached for the process lifetime.
  // Tables covered by v_memory_hits view — embedded as chunks, not as parent rows.
  // cmdIndex skips these to avoid Ollama context-overrun on long parent-row bodies.
  let _chunkTablesCached = null;

  async function getChunkTables(client) {
    if (_chunkTablesCached) return _chunkTablesCached;
    const { rows } = await client.query(
      "SELECT table_name FROM information_schema.tables " +
      "WHERE table_name LIKE '%_chunks' AND table_schema = current_schema()"
    );
    _chunkTablesCached = new Set(rows.map(r => r.table_name));
    return _chunkTablesCached;
  }
  ```

  Note: `current_schema()` is used (not the hardcoded literal `'public'`) for consistency with the existing `tableExists` and `columnExists` helpers already in this file.

- [ ] **Step 2.2.2:** In `cmdIndex`, call `await getChunkTables(client)` once before the `for (const tbl of TABLES)` loop. Store the result in `const chunkTables`. Replace:

  ```javascript
  if (MEMORY_HITS_COVERED.has(tbl.name)) {
  ```

  with:

  ```javascript
  if (chunkTables.has(tbl.name)) {
  ```

- [ ] **Step 2.2.3:** In `cmdSearch` and `cmdHybrid`, call `await getChunkTables(client)` once at the top of each function body (each has `client` in scope) and use the cached result in place of `MEMORY_HITS_COVERED`.

- [ ] **Step 2.2.4:** <!-- checkpoint:MUST phase2-chunk-tables-introspection --> Verify: in a test shell, create a `foo_chunks` table:

  ```bash
  psql $DATABASE_URL -c "CREATE TABLE IF NOT EXISTS foo_chunks (id SERIAL PRIMARY KEY, content TEXT);"
  ```

  Then run the indexer. Confirm `foo_chunks` appears in the skip-covered-tables log output (`Skipping foo_chunks — covered by v_memory_hits chunks.`) without any code change.

---

### Task 2.3: Audit inline encoded-cwd computations (spec §4.8, §5.2 Item 8 — audit step)

**Model:** haiku
**TDD:** optional

**Files:**
- Grep: `scripts/`

- [ ] **Step 2.3.1:** Grep `scripts/` for the literal pattern `[^a-zA-Z0-9-]` (the encoding replace regex) to identify all inline encoded-cwd implementations. Expected: `scripts/pipeline-cost.js` around line 39 is the only remaining inline copy. Record any additional hits.

- [ ] **Step 2.3.2:** Grep `scripts/` for `.claude/projects` to confirm no other script constructs the projects-directory path inline. Expected: only `scripts/lib/encoded-cwd.js` and any existing consumers.

---

### Task 2.4: Migrate pipeline-cost.js to use encoded-cwd.js (spec §4.8, §5.2 Item 8 — migration step)

**Model:** sonnet
**TDD:** required

**Files:**
- Modify: `scripts/pipeline-cost.js` (lines 30-41, the `transcriptDir` function)

> **Live-code note:** `scripts/lib/encoded-cwd.js` ALREADY EXISTS from PR #143. This task is a migration only — no new file creation. The module exports `encodeCwd` and `getClaudeProjectDir`.

- [ ] **Step 2.4.1:** At the top of `scripts/pipeline-cost.js`, in the existing `require` block, add:

  ```javascript
  const { getClaudeProjectDir } = require('./lib/encoded-cwd');
  ```

- [ ] **Step 2.4.2:** Replace the `transcriptDir` function body (the inline implementation at lines 33-41) with:

  ```javascript
  function transcriptDir() {
    return getClaudeProjectDir(process.cwd());
  }
  ```

  Remove the now-redundant inline comment block that explained the encoding rule (it is documented in `scripts/lib/encoded-cwd.js`).

- [ ] **Step 2.4.3:** <!-- checkpoint:MUST phase2-encoded-cwd --> Verify no inline copies remain:

  ```bash
  grep -rn "a-zA-Z0-9-" scripts/ | grep "replace" | grep -v "encoded-cwd.js" | grep -v ".git"
  ```

  Expected: no output. Any remaining hits are inline copies that must be migrated before this step is done.

- [ ] **Step 2.4.4:** Run `node scripts/pipeline-cost.js status` to confirm `transcriptDir()` resolves correctly. Expected: same directory path as before the refactor, no error.

---

### Task 2.5: Document planning skill orchestration substeps (Item 11 — dogfood addition 2026-04-26)

**Model:** sonnet
**TDD:** optional

**Files:**
- Modify: `skills/planning/SKILL.md`

> **Context:** `/pipeline:plan` automatically runs architecture recon, debate-offer, planner subagent, and plan-reviewer. A raw `Agent` dispatch of the planning skill skips all but the planner subagent. This task adds an explicit guidance block so manual invocations do not silently produce incomplete plans.

- [ ] **Step 2.5.1:** Read `skills/planning/SKILL.md` fully. Confirm: (a) `## Plan Review Loop` section exists, (b) note its line number for the insertion. If the section name has changed (e.g., now `## Plan Review` or `## Review`), use the actual heading and document the deviation in this step before proceeding. If no comparable section exists, STOP and surface to the orchestrator — Item 11 needs a different anchor.

- [ ] **Step 2.5.2:** Add a new section `## Manual Invocation — Required Substeps` immediately before the section located in Step 2.5.1:

  ```markdown
  ## Manual Invocation — Required Substeps

  `/pipeline:plan` (the slash command) automatically runs these orchestration steps
  before dispatching the planner subagent. If you invoke the planning skill directly
  via an `Agent` tool call without the slash command, you MUST run these substeps
  yourself, in order:

  1. **Architecture recon** — dispatch `/pipeline:architect` (or the architecture skill)
     against the files and directories the spec touches. Feed recon output into the
     `## Architectural Constraints` section of the planner prompt.
  2. **Debate (LARGE+ features only)** — dispatch `/pipeline:debate` with the spec as
     input. The debate verdict must be available before the planner prompt is composed.
     For MEDIUM changes this is offered but optional. For TINY changes skip it.
  3. **Planner subagent** — dispatch this skill (`skills/planning/SKILL.md`) with the
     full spec, recon constraints, and (if applicable) debate verdict as inputs.
  4. **Plan reviewer** — after the plan file is written, dispatch the plan-reviewer
     subagent (see `plan-reviewer-prompt.md` in this skill directory) to verify
     coverage and constraint compliance. Iterate until Approved or loop exceeds 3
     rounds (surface to human at that point).

  Skipping any of these steps produces an incomplete plan. The orchestrator is
  responsible for all four substeps; the planner subagent produces only Step 3 output.
  ```

- [ ] **Step 2.5.3:** Read back `skills/planning/SKILL.md` to confirm: the new section is present, it appears immediately before `## Plan Review Loop`, and all 4 numbered substeps are accurate.

---

### Task 2.6: Phase 2 regression check and commit

**Model:** haiku
**TDD:** optional

- [ ] **Step 2.6.1:** Run `PROJECT_ROOT=$(pwd) node scripts/test-chunker.js`. Expected: 6/6 pass.

- [ ] **Step 2.6.2:** Run `claude plugin validate .`.

- [ ] **Step 2.6.3:** Commit Phase 2 changes:

  ```bash
  git add scripts/pipeline-embed.js scripts/pipeline-cost.js \
    skills/planning/SKILL.md
  git commit -m "feat(ergonomics): Phase 2 — schema-derived chunk tables, encoded-cwd consolidation, planning skill parity docs"
  ```

---

## Phase 3a: embedWithRetry Shared Helper (Item 9, separate PR)

**Spec coverage:** Item 9 (spec §4.9, §5.3)
**Files touched:** `scripts/pipeline-embed.js`

---

### Task 3.1: Audit current embedPending and cmdIndex embed paths

**Model:** haiku
**TDD:** optional

**Files:**
- Read: `scripts/pipeline-embed.js`

- [ ] **Step 3.1.1:** Grep `scripts/pipeline-embed.js` for `MAX_EMBED_BYTES` and any similar `MAX_*BYTES` / `MAX_*CHARS` / `EMBED_LIMIT` guards. Record: (a) does such a constant already exist, (b) at what line, (c) what value. This determines whether Task 3.2 introduces a new constant or reuses an existing one.

- [ ] **Step 3.1.2:** Read `scripts/pipeline-embed.js` lines 1-160 to find: the batch size constant name and value; the location of `embedPending` (loader path) and its batch loop structure.

- [ ] **Step 3.1.3:** Read `scripts/pipeline-embed.js` lines 195-280 (`cmdIndex` batch-processing loop). Note: the structure of the current embed loop (batch slicing, Ollama HTTP call, SQL UPDATE), any existing per-row error handling, and whether `embedPending` and `cmdIndex` share or diverge on the batch size constant.

---

### Task 3.2: Extract embedWithRetry helper (spec §4.9, §5.3 Item 9)

**Model:** sonnet
**TDD:** required

**Files:**
- Modify: `scripts/pipeline-embed.js`

- [ ] **Step 3.2.1:** Resolve `MAX_EMBED_BYTES` based on Step 3.1.1's audit:
  - **If Task 3.1.1 found an existing `MAX_EMBED_BYTES` (or equivalent) constant:** reuse it. Do not redefine. Skip the rest of this step.
  - **If no existing guard was found:** define `const MAX_EMBED_BYTES = 2000;` at module scope, near other module-level constants. **Value rationale: 2000 chars is a safety guard for the mxbai-embed-large 512-token cap at ~4 chars/token, with margin.** The chunker enforces chunk-level limits at write time; this guard is the runtime safety net for non-chunked tables (`decisions`, `gotchas`, `code_index`) whose row bodies should already be short.

- [ ] **Step 3.2.2:** Define `embedWithRetry` as a standalone async function, positioned before its first caller. The function:
  - **Signature:** `async function embedWithRetry(rows, embedFn, { batchSize = 32, maxRetries = 3, onBatchError = null } = {})`
  - **Inputs:** `rows` is an array of `{ id, text, ... }` objects; `embedFn` is an async function `(string[]) => Promise<number[][]>` (one vector per input string).
  - **Oversize guard:** before calling `embedFn`, partition rows into eligible (`text.length <= MAX_EMBED_BYTES`) and oversized. Log oversized with the EXACT format `[embedWithRetry] Skipping row id=<id>: <text.length> chars exceeds MAX_EMBED_BYTES (<MAX_EMBED_BYTES>)` to stderr (use `process.stderr.write`, NOT `console.warn` — keeps stderr the single sink for warnings). Increment `skipped` count.
  - **Batching:** process eligible rows in batches of `batchSize`.
  - **Failure isolation:** on batch `embedFn` rejection, call `onBatchError(err, batch)` if provided; then retry each row in the batch individually with `maxRetries` attempts and exponential backoff (2s/4s/8s). A row that still fails after all retries increments `failed` and is logged with the same `[embedWithRetry]` prefix.
  - **Successful rows:** set `row._vector = vec` on each row whose embed succeeded. The caller (embedPending or cmdIndex) reads `row._vector` to write the DB.
  - **Return shape:** `{ embedded: <count>, skipped: <count>, failed: <count> }`. The mutated `rows` array carries the per-row vectors via `_vector`. Counts are summary; per-row state is on the rows themselves.

  Draft the body following these invariants. Anchor: log format and return shape are locked here so QA tests can assert exact strings.

- [ ] **Step 3.2.3:** Refactor `embedPending` to call `embedWithRetry` instead of its inline batch loop. Pass the existing Ollama embed call as `embedFn`. After `embedWithRetry` returns, write `row._vector` values to the DB (the DB-update loop follows `embedWithRetry` in `embedPending`).

- [ ] **Step 3.2.4:** Refactor `cmdIndex` to call `embedWithRetry`. Confirm `cmdIndex` now both skips chunk-covered tables (via `getChunkTables` from Phase 2) AND uses per-chunk retry via `embedWithRetry` on the remaining tables.

- [ ] **Step 3.2.5:** <!-- checkpoint:MUST phase3a-embed-retry --> Verify regression: insert a row into the embed queue with a body exceeding `MAX_EMBED_BYTES` bytes. Run `PROJECT_ROOT=$(pwd) node scripts/pipeline-embed.js index`. Confirm: the oversized row produces a `[embedWithRetry] Skipping row` warning; the remaining rows in the batch are embedded successfully.

---

### Task 3.3: Phase 3a regression check and commit

**Model:** haiku
**TDD:** optional

- [ ] **Step 3.3.1:** Run `PROJECT_ROOT=$(pwd) node scripts/test-chunker.js`. Expected: 6/6 pass.

- [ ] **Step 3.3.2:** Run `claude plugin validate .`.

- [ ] **Step 3.3.3:** Commit Phase 3a changes:

  ```bash
  git add scripts/pipeline-embed.js
  git commit -m "feat(ergonomics): Phase 3a — extract embedWithRetry; both embedPending and cmdIndex use uniform batch retry with oversize-row guard"
  ```

---

## Phase 3b: CI Gate (Item 10, separate PR)

**Spec coverage:** Item 10 (spec §4.10, §5.3)
**Files touched:** `.github/workflows/test-chunker.yml` (net-new), `CLAUDE.md`

---

### Task 4.1: Create GitHub Actions workflow (spec §4.10, §5.3 Item 10)

**Model:** sonnet
**TDD:** optional

**Files:**
- Create: `.github/workflows/test-chunker.yml`

> **Live-code note:** NO `.github/` directory exists. Both `.github/` and `.github/workflows/` must be created.

- [ ] **Step 4.1.1:** Verify `.github/` does not exist before creating (run from repo root):

  ```bash
  test -d .github && echo "EXISTS — STOP and reconcile" || echo "Does not exist — safe to create"
  ```

  Repo-relative path; works on any clone or CI runner.

- [ ] **Step 4.1.2:** Create `.github/workflows/test-chunker.yml`:

  ```yaml
  name: Test chunker E2E
  # Runs on every pull request to catch regressions before merge.
  # Postgres image is pinned to pg16 to match production instance.
  # Update the image tag AND this comment when upgrading.
  # Ollama is not available in CI; OLLAMA_SKIP=1 skips embedding
  # assertions while structural tests (chunker logic, DB schema,
  # incremental sync) still run.
  on: [pull_request]
  jobs:
    test-chunker:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: pgvector/pgvector:pg16
          env:
            POSTGRES_PASSWORD: postgres
          options: >-
            --health-cmd pg_isready
            --health-interval 10s
            --health-timeout 5s
            --health-retries 5
          ports:
            - 5432:5432
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'
        - name: Install dependencies
          run: npm ci
          working-directory: scripts
        - name: Apply knowledge DB schema
          run: psql -h localhost -U postgres -f scripts/setup-knowledge-db.sql
          env:
            PGPASSWORD: postgres
        - name: Run chunker tests
          run: node scripts/test-chunker.js
          env:
            DATABASE_URL: postgres://postgres:postgres@localhost/postgres
            OLLAMA_SKIP: '1'
  ```

- [ ] **Step 4.1.3:** <!-- checkpoint:MUST phase3b-ci-gate --> Read back `.github/workflows/test-chunker.yml` and verify:
  - Health-check options are on the `postgres` service block (not on a step)
  - `ports:` mapping `5432:5432` is present on the service
  - `working-directory: scripts` is on the `npm ci` step (because `package.json` lives in `scripts/`, not the repo root)
  - `OLLAMA_SKIP: '1'` is set on the test step
  - The pinning comment explains when to update the image tag

---

### Task 4.2: Document the CI gate in CLAUDE.md

**Model:** sonnet
**TDD:** optional

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 4.2.1:** Read `CLAUDE.md`. Locate the "Testing" section.

- [ ] **Step 4.2.2:** Add a subsection `### Embedding pipeline CI gate` under "Testing":

  ```markdown
  ### Embedding pipeline CI gate

  `node scripts/test-chunker.js` (6 tests) is the regression gate for the embedding
  pipeline. It runs automatically on every PR via `.github/workflows/test-chunker.yml`.

  - When `OLLAMA_SKIP=1` is set, Ollama embedding assertions are skipped; structural
    tests (chunker logic, DB schema, incremental sync) still run.
  - The CI Postgres service is pinned to `pgvector/pgvector:pg16`. Update the image
    tag in the workflow file and its comment together when upgrading.
  - `npm ci` runs in `scripts/` (where `package.json` lives), not the repo root.
  ```

- [ ] **Step 4.2.3:** Read back the modified section to confirm the note is present and the `working-directory` detail is included.

---

### Task 4.3: Phase 3b regression check and commit

**Model:** haiku
**TDD:** optional

- [ ] **Step 4.3.1:** Run `PROJECT_ROOT=$(pwd) node scripts/test-chunker.js`. Expected: 6/6 pass.

- [ ] **Step 4.3.2:** Run `claude plugin validate .`.

- [ ] **Step 4.3.3:** Commit Phase 3b changes:

  ```bash
  git add .github/workflows/test-chunker.yml CLAUDE.md
  git commit -m "feat(ergonomics): Phase 3b — CI gate running test-chunker.js on every PR with pgvector:pg16 service"
  ```

---

## Spec Requirements Traceability

| Spec Item | Description | Plan Task(s) |
|-----------|-------------|--------------|
| Item 1 | finish auto-loader in Step 4b | Task 1.2 |
| Item 2 | platform.js --stdin for issue create / pr create | Task 1.3 (docs + smoke test only — option-parser already wired) |
| Item 3 | init optional Step 4d | Task 1.4 |
| Item 4 | session_chunks UNIQUE constraint | Task 1.5 |
| Item 5 | routing-check.js parse-fail warning | Task 1.6 |
| Item 6 | Bash prefix hygiene in settings.json + CLAUDE.md | Task 1.7 |
| Item 7 | MEMORY_HITS_COVERED introspection (target: pipeline-embed.js) | Tasks 2.1-2.2 |
| Item 8 | encoded-cwd consolidation (audit + migrate pipeline-cost.js) | Tasks 2.3-2.4 |
| Item 9 | embedWithRetry shared helper | Tasks 3.1-3.2 |
| Item 10 | CI gate (.github/workflows/test-chunker.yml) | Tasks 4.1-4.2 |
| Item 11 | planning skill manual-invocation parity (dogfood addition) | Task 2.5 |

---

## Build Sequence

1. Task 1.1 — read finish.md to locate Step 4b merge-confirm block (no dependencies)
2. Task 1.2 — wire finish auto-loader (depends on: Task 1.1)
3. Task 1.3 — update platform.js help banner + smoke test (no dependencies)
4. Task 1.4 — add init Step 4d (no dependencies)
5. Task 1.5 — add UNIQUE constraint to session_chunks (no dependencies)
6. Task 1.6 — add parse-fail warning to routing-check.js (no dependencies)
7. Task 1.7 — widen Bash prefix entries in settings.json + CLAUDE.md (no dependencies)
8. Task 1.8 — Phase 1 regression + commit (depends on: Tasks 1.1-1.7 all complete)
9. Task 2.1 — audit MEMORY_HITS_COVERED and call sites (depends on: Task 1.8)
10. Task 2.2 — replace MEMORY_HITS_COVERED with schema introspection in pipeline-embed.js (depends on: Task 2.1; unique constraint from Task 1.5 must be live for the introspection to be meaningful)
11. Task 2.3 — audit inline encoded-cwd computations (depends on: Task 1.8; no ordering conflict with Task 2.2)
12. Task 2.4 — migrate pipeline-cost.js to encoded-cwd.js (depends on: Task 2.3)
13. Task 2.5 — document planning skill orchestration substeps (depends on: Task 1.8)
14. Task 2.6 — Phase 2 regression + commit (depends on: Tasks 2.1-2.5 all complete)
15. Task 3.1 — audit embedPending and cmdIndex embed paths (depends on: Task 2.6)
16. Task 3.2 — extract embedWithRetry helper (depends on: Task 3.1)
17. Task 3.3 — Phase 3a regression + commit (depends on: Tasks 3.1-3.2)
18. Task 4.1 — create CI workflow YAML (depends on: Task 3.3; CI must validate refactored embedWithRetry from its first run)
19. Task 4.2 — document CI gate in CLAUDE.md (depends on: Task 4.1)
20. Task 4.3 — Phase 3b regression + commit (depends on: Tasks 4.1-4.2)

## QA Strategy

### Risk Assessment

- **R1** [Task: 1.2] [Constraint: DECISION-003] [Files: commands/finish.md] — Boundary: /pipeline:finish Step 4b ↔ pipeline-memory-loader.js invocation. Failure mode: loader exits non-zero on a long session (Ollama transient failure or oversized row), and the merge has already succeeded — embedding is silently skipped while finish prints a single warning line. Severity: MEDIUM.

- **R2** [Task: 1.5] [Files: scripts/setup-knowledge-db.sql] — Boundary: setup-knowledge-db.sql UNIQUE constraint ↔ existing session_chunks rows. Failure mode: duplicate (session_id, chunk_index) pairs exist at migration time, causing constraint violation and schema inconsistency. Severity: CRITICAL.

- **R3** [Task: 1.6] [Field: warnedThisSession] — Boundary: routing-check.js process lifetime ↔ Claude Code per-invocation hook spawning. Failure mode: warnedThisSession is module-level and resets every time Claude Code spawns a fresh hook process; the "once per session" guarantee only holds within a single process lifetime, which may be every individual tool call. Severity: MEDIUM.

- **R4** [Task: 2.2] [Files: scripts/pipeline-embed.js] — Boundary: pipeline-embed.js schema cache ↔ dynamic *_chunks table creation. Failure mode: schema cache captured at process start becomes stale; embedWithRetry calls fail silently with "table not found". Severity: HIGH.

- **R5** [Task: 3.2] [Constraint: DECISION-002] [Field: maxRetries] — Boundary: embedWithRetry shared helper ↔ embedPending and cmdIndex callers. Failure mode: refactor regresses the per-chunk retry isolation already shipped in PR #143 — a single oversized row again fails the entire batch instead of being skipped with a warning. Severity: HIGH.

### P0 Test Scenarios

- **TS-001** [Risk: R1] [Task: 1.2] [Files: commands/finish.md] — When `finish.auto_load_memory: true` and pipeline-memory-loader.js exits non-zero, finish prints the documented warning ("Memory loader exited with error — merge succeeded, embedding skipped.") and proceeds; merge state is not rolled back. Type: integration.

- **TS-002** [Risk: R2] [Task: 1.5] [Files: scripts/setup-knowledge-db.sql] — Pre-flight check in [Task: 1.5] identifies (session_id, chunk_index) duplicates before constraint applied. If found, migration aborts with explicit error; CI gate enforces check. Type: integration.

- **TS-003** [Risk: R3] [Task: 1.6] [Field: warnedThisSession] — Within a single routing-check.js process invocation, two malformed stdin payloads in a row produce exactly one [routing-check] WARNING stderr line; the second invocation is a no-op for the warning even though the underlying parse failure still calls logError. Type: integration.

- **TS-004** [Risk: R4] [Task: 2.2] [Files: scripts/pipeline-embed.js] — Pipeline-embed.js schema introspection queries information_schema.tables directly per call (not cached at process start). Dynamic table creation detected immediately; no "table not found" errors. Type: unit.

- **TS-005** [Risk: R5] [Task: 3.2] [Constraint: DECISION-002] — Insert one row with body length > MAX_EMBED_BYTES alongside several normal-sized rows; run embedWithRetry; assert oversized row is skipped with a warning while the rest of the batch embeds successfully. Type: unit.

- **TS-006** [Risks: R1, R2, R3, R4, R5] [Tasks: 1.2, 1.5, 1.6, 2.2, 3.2] [Files: scripts/test-chunker.js] — All Phase 1-3 tasks merged; existing test-chunker.js Test 6 (loader → DB → Ollama → retrieval E2E) re-runs to confirm no regression. Acceptable that Test 6 does NOT directly cover finish auto-load (that gap is acknowledged in the plan and a follow-up test is left for a future sprint). Type: E2E regression.

- **TS-007** [Risk: R2] [Task: 1.5] [Files: scripts/setup-knowledge-db.sql] — CI gate runs pre-flight validation: UNIQUE constraint check, duplicate detection, data shape audit. All pass. If any fails, exit 1; CI rejects PR. Type: integration.

- **TS-008** [Risk: R5] [Task: 3.2] [Files: scripts/pipeline-embed.js] — After Phase 2, `/pipeline:knowledge` command retrieves documents. Embedding uses embedWithRetry with correct retry params (verified via mock spy). Documents ranked correctly. Type: integration.

### Seam Tests

- **SEAM-001** [Tasks: 1.2, 1.8] [Files: commands/finish.md, scripts/test-chunker.js] — finish.md Step 4b invokes pipeline-memory-loader.js; [Task: 1.2] guards on a non-zero exit with a single warning line and continues. [Task: 1.8] regression verifies the loader's success and failure paths are both observed without aborting finish.

- **SEAM-002** [Tasks: 1.5, 1.8] [Files: scripts/setup-knowledge-db.sql, scripts/test-chunker.js] — [Task: 1.5] migration adds UNIQUE constraint with pre-flight duplicate check. [Task: 1.8] regression confirms migration succeeds on test DB without schema error.

- **SEAM-003** [Tasks: 1.6, 1.8] [Files: scripts/hooks/routing-check.js, scripts/test-chunker.js] — [Task: 1.6] adds a module-level warnedThisSession flag in routing-check.js. [Task: 1.8] regression confirms a single process invocation with two malformed payloads produces exactly one warning line on stderr while existing logError behavior is preserved.

- **SEAM-004** [Tasks: 2.2, 2.6] [Files: scripts/pipeline-embed.js, scripts/test-chunker.js] — [Task: 2.2] replaces schema cache with direct information_schema.tables queries. [Task: 2.6] regression creates dynamic table and verifies embed function detects it without process restart.

- **SEAM-005** [Tasks: 3.2, 3.3] [Files: scripts/pipeline-embed.js, scripts/test-chunker.js] — [Task: 3.2] extracts embedWithRetry shared helper with caller-supplied retry params. [Task: 3.3] regression mocks both embedPending and cmdIndex callers, verifies param isolation.

### Test Intent Rule

**Every test must include a comment documenting business behavior and risk/scenario/seam coverage:**

```javascript
// Verifies: finish auto-loader non-zero exit prints documented warning line and merge continues (TS-001, R1, SEAM-001)
async function testFinishAutoLoaderFailureWarning() { ... }

// Verifies: setup-knowledge-db.sql pre-flight detects (session_id, chunk_idx) duplicates and aborts migration (TS-002, R2, SEAM-002)
async function testSessionChunksDuplicateDetection() { ... }

// Verifies: routing-check.js warnedThisSession flag suppresses second warning within a single process invocation (TS-003, R3, SEAM-003)
async function testRoutingCheckWarnedThisSessionFlag() { ... }

// Verifies: pipeline-embed.js schema query detects dynamically-added *_chunks tables without process restart (TS-004, R4, SEAM-004)
async function testSchemaDynamicTableDetection() { ... }

// Verifies: embedWithRetry oversize-row guard skips the bad row with a warning while remaining batch embeds (TS-005, R5, SEAM-005)
async function testEmbedWithRetryOversizeRowGuard() { ... }
```

---

## Final Verification

After all four PRs merge to main:

- [ ] Run `PROJECT_ROOT=$(pwd) node scripts/test-chunker.js` on main. Expected: 6/6 pass.
- [ ] Run `/pipeline:finish` on a test branch with `finish.auto_load_memory: true` in pipeline.yml. Confirm `session_chunks` count increases without manual loader invocation.
- [ ] Run `echo "body text" | node scripts/platform.js issue create --title "stdin test" --stdin`. Confirm command reaches the backend without rejecting `--stdin` as unknown.
- [ ] Apply `scripts/setup-knowledge-db.sql` to a clean test DB twice. Confirm no error on second run.
- [ ] Attempt to insert a duplicate `(session_id, chunk_idx)` pair into `session_chunks`. Confirm unique-violation error.
- [ ] Create a `foo_chunks` table in the test DB. Confirm `getChunkTables()` returns it without any code change.
- [ ] Run `grep -rn "a-zA-Z0-9-" scripts/ | grep replace | grep -v "encoded-cwd.js"`. Expected: no output.
- [ ] Run `grep -rn "MEMORY_HITS_COVERED" scripts/`. Expected: no output (constant removed).
- [ ] Insert an oversized row (> `MAX_EMBED_BYTES`) and run `pipeline-embed.js index`. Confirm row is skipped with a warning and remaining batch succeeds.
- [ ] Open a test PR. Confirm `test-chunker` GitHub Actions job appears and passes (with `OLLAMA_SKIP=1`).
- [ ] Run `claude plugin validate .` on main. Expected: no validation errors.
