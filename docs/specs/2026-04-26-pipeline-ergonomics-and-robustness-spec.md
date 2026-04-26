---
title: Pipeline ergonomics and robustness sprint (post-PR-143 follow-ups)
date: 2026-04-26
status: draft
change_size: LARGE
related: [pr-143, postgres-task-tbd, github-issue-tbd]
---

# Spec: Pipeline Ergonomics and Robustness Sprint

## 1. Problem

PR #143 shipped the chunker/loader end-to-end and proved the embedding pipeline works in practice. Dogfooding it against real session output, however, surfaced ten friction points and gaps that were hidden until the path was live. Three categories emerged: correctness gaps that can cause silent data loss or partial failures (a missing unique constraint on `session_chunks` lets duplicate rows accumulate; `cmdIndex` processes embeddings in batches of 32 so one oversized row silently fails the whole batch); ergonomics gaps that create permission churn or manual ceremony per session (`platform.js issue create` has no `--stdin` flag, forcing heredoc workarounds that hit the 893-byte parser limit; `/pipeline:finish` does not auto-invoke the memory loader); and structural gaps that will compound as the schema grows (the `MEMORY_HITS_COVERED` constant is hardcoded rather than derived, so adding a new `*_chunks` table requires a manual constant update and will inevitably drift; the encoded-cwd path computation is duplicated across several scripts).

These ten items are small individually but together constitute a robustness surface. Left unaddressed, they will generate recurring friction in every dogfooding session and erode confidence in the embedding pipeline before it has time to prove its value. The right response is a focused sprint, not ten separate issues that never get sequenced.

The sprint is phased by leverage and dependency rather than by item size alone. Phase 1 delivers the highest user-visible impact (finish auto-loading, stdin support, hook warning) with the smallest blast radius. Phase 2 hardens the schema invariants that Phase 1 depends on. Phase 3 eliminates the shared code duplication and adds the CI gate that prevents regressions from shipping silently.

## 2. Goals

- Eliminate manual memory-loader invocation after merges: `/pipeline:finish` Step 4b runs `pipeline-memory-loader.js all` automatically.
- Eliminate `platform.js` heredoc workarounds: `issue create` and `pr create` both accept `--stdin` for body content.
- Eliminate duplicate embeddings in `session_chunks`: a `(session_id, chunk_idx) UNIQUE` constraint enforced at the schema level.
- Eliminate silent routing-hook parse failures: `routing-check.js` emits a once-per-session user-visible warning when stdin JSON is malformed.
- Eliminate `MEMORY_HITS_COVERED` drift: the constant is derived from `information_schema` at query time, not hardcoded.
- Consolidate encoded-cwd path computation to `scripts/lib/encoded-cwd.js` so adding a new script does not introduce a new copy.
- Reduce permission-dialog churn by widening Bash prefix entries in `.claude/settings.json` for verification one-liners; document the pattern in CLAUDE.md.
- Prevent `cmdIndex` whole-batch failures: the `embedWithRetry` helper used in `embedPending` is shared with `cmdIndex` so both paths have the same row-level retry and oversize guard.
- Add a CI gate: a GitHub Actions workflow runs `node scripts/test-chunker.js` (Test 6 path) on every PR so regressions are caught before merge.
- Offer `pipeline-memory-loader.js all` as optional Step 4d in `/pipeline:init` so a fresh project can seed memory immediately.

## 3. Non-goals

- Strategy B embedder swap (bge-m3, nomic-embed-text-v1.5) — separate decision pending benchmark results.
- Loaders for `incidents`, `checklist_items`, `corpus_files` — scope is `session_chunks` only for this sprint.
- Postgres tasks #59 (deterministic routing table) and #61 (LLM-routing daemon) — separate architectural sprint with its own spec.
- Search ranking and RRF weight tuning — no query-path changes in this sprint.
- Cross-project memory federation — not in scope until single-project path is stable.
- Streaming embed (chunking at ingest time rather than batch) — deferred to post-Phase-3 review.

## 4. Approach: phased delivery

Three PRs, sequenced by leverage.

### Phase 1 (TINY x 6 -> one PR): Ergonomics + Immediate Robustness

1. **Finish auto-loader** (`commands/finish.md`): Insert `node scripts/pipeline-memory-loader.js all` call in Step 4b, after the merge confirmation. Acceptance: finish run on a merged PR produces a non-zero chunk count without manual invocation.
2. **platform.js --stdin** (`scripts/platform.js`): Add `--stdin` flag to `issue create` and `pr create` subcommands; read body from `process.stdin` when flag is present. Acceptance: `echo "body text" | node scripts/platform.js issue create --title "T" --stdin` creates an issue with the correct body.
3. **Init optional loader step** (`commands/init.md`): Add Step 4d offering `pipeline-memory-loader.js all` after knowledge-DB setup. Acceptance: init presents the step; user can skip; no error if no chunks exist yet.
4. **session_chunks unique constraint** (`scripts/setup-knowledge-db.sql`): Add `CONSTRAINT session_chunks_unique UNIQUE (session_id, chunk_idx)`. Acceptance: inserting a duplicate (session_id, chunk_idx) pair raises a unique-violation error.
5. **routing-check.js parse-fail warning** (`scripts/hooks/routing-check.js`): On JSON parse failure of stdin, write a single warning line to stderr tagged with a session token so it fires only once per session. Acceptance: a malformed hook invocation produces a visible warning rather than silent fallthrough.
6. **Bash prefix hygiene** (`.claude/settings.json`, `CLAUDE.md`): Widen prefix entries for verification one-liners (`node scripts/pipeline-db.js`, `node scripts/pipeline-cost.js`). Document the widening rationale in a new subsection of CLAUDE.md under "Shell Safety". Acceptance: no new exact-match permission entries accumulate during a dogfooding session.

### Phase 2 (TINY x 2 -> second PR): Schema-Driven Invariants

7. **MEMORY_HITS_COVERED introspection** (`scripts/pipeline-db.js` or the query site): Replace the hardcoded constant with a query against `information_schema.tables WHERE table_name LIKE '%_chunks'`. Cache the result for the session lifetime. Acceptance: adding a new `foo_chunks` table is auto-detected without a code change.
8. **encoded-cwd consolidation** (`scripts/lib/encoded-cwd.js`): Extract the `~/.claude/projects/<encoded-cwd>/` path computation into a dedicated module. Audit callers in `scripts/` and replace inline copies. Acceptance: `grep -r "encoded" scripts/` returns only imports of `encoded-cwd.js`, no inline implementations.

### Phase 3 (MEDIUM x 2 -> separate PRs): Shared Helpers + CI

9. **embedWithRetry helper** (`scripts/pipeline-embed.js`): Extract shared `embedWithRetry(rows, options)` so `embedPending` (loader path) and `cmdIndex` (re-embed path) share invariants. Phase 3a PR.
10. **CI hook** (`.github/workflows/test-chunker.yml`): GitHub Actions workflow that runs `node scripts/test-chunker.js` on every PR. Phase 3b PR.

## 5. Design

### 5.1 Phase 1 design

**Item 1 — finish.md Step 4b**
File: `commands/finish.md`
After the merge-confirm block, append:
```
node scripts/pipeline-memory-loader.js all --quiet
```
The `--quiet` flag suppresses per-chunk progress output; only the summary line is printed. If the loader exits non-zero, finish prints a warning but does not abort (the merge already succeeded).

**Item 2 — platform.js --stdin**
File: `scripts/platform.js`
Add to both `issue create` and `pr create` option parsers:
```javascript
.option('--stdin', 'Read body from stdin')
```
When `--stdin` is set and `--body` is not, consume `process.stdin` synchronously before dispatching the GitHub API call. Body length limit: 65536 bytes (GitHub API cap); truncate with a trailing notice if exceeded.

**Item 3 — init.md Step 4d**
File: `commands/init.md`
Insert after Step 4c (knowledge-DB schema apply):
```
Optional: seed memory from existing sessions?
  [Y] node scripts/pipeline-memory-loader.js all
  [N] skip (can run manually later)
```
Default is skip. If no session files exist, the loader exits 0 with a "no sessions found" message; that is not an error.

**Item 4 — setup-knowledge-db.sql**
File: `scripts/setup-knowledge-db.sql`
Add after the `session_chunks` CREATE TABLE statement:
```sql
ALTER TABLE session_chunks
  ADD CONSTRAINT session_chunks_session_chunk_unique UNIQUE (session_id, chunk_idx);
```
Placed in the idempotent migration block so re-running the script on an existing schema is safe (wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`).

**Item 5 — routing-check.js parse-fail warning**
File: `scripts/hooks/routing-check.js`
Maintain a module-level `warnedThisSession` flag (initialized false, set on first warning).
On catch in the stdin-parse block:
```javascript
if (!warnedThisSession) {
  process.stderr.write('[routing-check] WARNING: stdin JSON parse failed; hook bypassed for this call.\n');
  warnedThisSession = true;
}
```

**Item 6 — settings.json prefix hygiene**
File: `.claude/settings.json`
Replace exact-match entries like `node scripts/pipeline-db.js query "SELECT ..."` with prefix entries:
```json
{ "type": "bash", "pattern": "node scripts/pipeline-db.js*" }
```
Document in `CLAUDE.md` under "Shell Safety > Permission entry discipline": always use prefix patterns for scripts that accept variable arguments.

### 5.2 Phase 2 design

**Item 7 — MEMORY_HITS_COVERED introspection**
File: `scripts/pipeline-db.js` (or wherever `MEMORY_HITS_COVERED` is consumed)
Replace:
```javascript
const MEMORY_HITS_COVERED = ['session_chunks'];
```
With a helper:
```javascript
async function getChunkTables(client) {
  const { rows } = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%_chunks' AND table_schema = 'public'"
  );
  return rows.map(r => r.table_name);
}
```
Cache in a module-level variable after first query to avoid per-call overhead.

**Item 8 — encoded-cwd.js**
New file: `scripts/lib/encoded-cwd.js`
Export:
```javascript
function encodedCwd() {
  return process.cwd().replace(/[/\\:]/g, '-');
}
function memoryCwdPath() {
  return path.join(os.homedir(), '.claude', 'projects', encodedCwd());
}
module.exports = { encodedCwd, memoryCwdPath };
```
Audit target: `grep -rn "projects/" scripts/` — replace every inline computation with `require('./lib/encoded-cwd').memoryCwdPath()`.

### 5.3 Phase 3 design

**Item 9 — embedWithRetry signature**
File: `scripts/pipeline-embed.js`
Extracted function:
```javascript
async function embedWithRetry(rows, { batchSize = 32, maxRetries = 3, onBatchError = null } = {}) {
  // Splits rows into batches of batchSize.
  // On batch error: logs, calls onBatchError if provided, retries individual rows.
  // Oversize guard: rows exceeding MAX_EMBED_BYTES are skipped with a warning rather than failing the batch.
}
```
Both `embedPending` and `cmdIndex` call this function. The key invariant: a single oversized row never fails the whole batch.

**Item 10 — CI Action shape**
File: `.github/workflows/test-chunker.yml`
```yaml
name: Test chunker E2E
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
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: psql -h localhost -U postgres -f scripts/setup-knowledge-db.sql
        env: { PGPASSWORD: postgres }
      - run: node scripts/test-chunker.js
        env: { DATABASE_URL: postgres://postgres:postgres@localhost/postgres }
```
Ollama is not available in CI; `test-chunker.js` must mock the embed call or skip embedding assertions when `OLLAMA_SKIP=1` is set.

## 6. Test plan

**Phase 1 acceptance gates:**
- Run `/pipeline:finish` on a test branch that has staged session files; confirm chunk count in `session_chunks` increases without manual loader invocation.
- `echo "$(cat /dev/urandom | head -c 1200 | base64)" | node scripts/platform.js issue create --title "Test --stdin" --stdin` creates an issue with a body exceeding 800 bytes.
- Run routing-check.js with malformed stdin; confirm exactly one warning line appears across multiple calls in the same process lifetime.
- Apply `setup-knowledge-db.sql` to a test DB; attempt to insert a duplicate `(session_id, chunk_idx)` pair; confirm unique-violation error.

**Phase 2 acceptance gates:**
- Add a `foo_chunks` table to the test schema; confirm `getChunkTables()` returns it without any code change to the caller.
- `grep -rn 'projects/' scripts/` returns only import lines from `encoded-cwd.js`, no inline path strings.

**Phase 3 acceptance gates:**
- Insert a row into `embedPending` with a body exceeding `MAX_EMBED_BYTES`; confirm the row is skipped with a warning and the remaining batch succeeds.
- Open a test PR against the repo; confirm the `test-chunker` CI job runs and passes (with `OLLAMA_SKIP=1`).

Existing pipeline tests (`npm test`) must pass as a regression gate before each phase PR is merged.

## 7. Implementation order

1. Phase 1 ships first. All six items share file scope across `commands/finish.md`, `commands/init.md`, `scripts/platform.js`, `scripts/setup-knowledge-db.sql`, `scripts/hooks/routing-check.js`, and `.claude/settings.json`. They can be developed and reviewed together without merge conflicts.
2. Phase 2 ships second. The `session_chunks` unique constraint from Phase 1 must be live before the introspection query in Phase 2 is meaningful (the constraint is part of what makes the table's chunk semantics trustworthy). `encoded-cwd.js` can land in Phase 2 because no Phase 1 item adds a new caller.
3. Phase 3a (`embedWithRetry`) ships after Phase 2. It touches `pipeline-embed.js` only and is independent of Phase 2 changes, but there is no urgency to parallelize it with Phase 2 given the low risk.
4. Phase 3b (CI hook) ships after Phase 3a so the CI job validates the refactored `embedWithRetry` path from its first run.

Phases 3a and 3b can land as separate PRs in the same sprint window if bandwidth allows; they have no shared files.

## 8. Out of scope (deferred)

- Strategy B embedder swap (bge-m3, nomic-embed-text-v1.5): no embedder changes in this sprint.
- Loaders for `incidents`, `checklist_items`, `corpus_files`: out until those tables have stable schemas.
- Postgres task #59 (deterministic routing table) and #61 (LLM-routing daemon): architectural sprint, separate spec required.
- Search ranking and RRF weight tuning: no changes to query paths.
- Cross-project memory federation: single-project path must be stable first.
- Streaming ingest (chunk at write time rather than batch): post-Phase-3 consideration.
- Replacing the Ollama HTTP client with the official JS SDK: orthogonal to this sprint.

## 9. Risks

**Risk 1: finish auto-loader adds latency to the merge path.**
If the session has thousands of chunks, the loader blocks finish Step 4b for tens of seconds. Mitigation: add a `--quiet --max-age 24h` flag to the loader invocation in finish so it only embeds chunks from the current session; document that a full reindex is a separate manual operation.

**Risk 2: platform.js --stdin piping breaks on Windows shells where stdin is not a TTY.**
The synchronous stdin read used in Item 2 may hang if the caller does not close stdin. Mitigation: add a 5-second timeout to the stdin read; emit an error and exit non-zero if the timeout is reached. Test explicitly on Windows with `echo body | node scripts/platform.js issue create --stdin`.

**Risk 3: CI Postgres service container and pgvector extension version drift.**
The `pgvector/pgvector:pg16` image may not match the production Postgres version in use. A schema mismatch would cause Test 6 to fail in CI but pass locally. Mitigation: pin the CI image to the same major version as the production instance (document the version in `.github/workflows/test-chunker.yml` as a comment); add a version-check assertion to `test-chunker.js` that fails fast if the extension version is below the minimum required.
