---
title: Chunker / loader for high-fidelity semantic memory retrieval
date: 2026-04-26
status: draft
change_size: LARGE
related: [postgres-task-60, github-issue-tbd, deferred-from-issue-109]
---

# Spec: Chunker / Loader for High-Fidelity Semantic Memory Retrieval

## 1. Problem

On 2026-04-26 a peer Claude session attempted to populate three previously-empty memory
tables: `session_chunks` (327 rows), `memory_entries` (43 rows), and `policy_sections`
(853 rows). All three batches failed with Ollama's "input length exceeds context length"
error and landed at 0 rows embedded. Four other tables — sessions, gotchas,
checklist_items, corpus_files — embedded cleanly because their content is short by
construction. The failure is not random; it is structurally guaranteed for any table whose
`textFn` produces output that exceeds mxbai-embed-large's 512-token hard cap.

The root cause is threefold. First, mxbai-embed-large enforces a 512-token context limit
that cannot be lifted by passing `num_ctx` to Ollama — the model's native cap is fixed.
Second, `policy_sections.textFn` applies no truncation at all (line 124 of
`scripts/pipeline-embed.js`), so a section like the Destructive Operation Guards block in
CLAUDE.md — which runs to several thousand chars — reaches the embedder intact.
`memory_entries.body` truncates to 5000 chars (line 114), which is approximately 1250
tokens at 4 chars/token — still 2.4× over the cap. Third, `cmdIndex` batches in groups
of 32 and fails the entire batch on a single Ollama error, so one oversized row silently
discards up to 31 others with no per-row retry.

The practical consequence is that the six memory tables listed at `docs/memory.md:248`
("Pipeline does not ship a loader for these six tables") remain permanently empty in every
real project. Semantic memory — the feature that lets agents retrieve relevant context from
past sessions, policy, and auto-memory files — is a dead letter. This spec closes that gap
for the three highest-value tables: `memory_entries`, `policy_sections`, and
`session_chunks`.

## 2. Goals

- Ship `scripts/pipeline-chunker.js`: a standalone, pure-function text chunker with
  configurable token budget and boundary-aware splitting.
- Ship `scripts/pipeline-memory-loader.js`: loaders for `memory_entries`,
  `policy_sections`, and `session_chunks` that source rows from the filesystem and
  embed via the chunker.
- Eliminate Ollama "input length exceeds context length" errors for all three tables by
  guaranteeing no chunk exceeds 400 tokens (= 1600 chars at 4 chars/token).
- Achieve 100% embedding coverage on pathological inputs: policy sections > 8000 chars,
  memory bodies > 20000 chars, session messages > 4000 chars.
- Ensure idempotent loader runs: re-running the loader never duplicates rows.
- Limit blast radius per Ollama error to 8 rows by batching at BATCH=8 in the loader
  (down from cmdIndex's BATCH=32).
- Require no schema migration to existing tables except adding `chunk_idx` to
  `policy_sections` (default 0) and creating the `memory_entry_chunks` sibling table.

## 3. Non-goals

- Swapping mxbai-embed-large for a longer-context model (bge-m3 at 1024 dims or
  nomic-embed-text-v1.5 at 768 dims) — this is Strategy B and a separate spec.
- Loaders for `incidents`, `checklist_items`, or `corpus_files` — low value in this
  project; no natural filesystem source-of-truth exists for these tables.
- PDF or binary content extraction for `corpus_files`.
- Changing the `embedding_model` config key or Ollama model selection logic.
- Search ranking tuning (RRF weights, score thresholds, reranking).
- Multi-project or cross-project memory federation.

## 4. Recommended Approach: Strategy A — Chunker with mxbai-embed-large

**Recommendation: implement Strategy A.** Build the chunker; keep mxbai-embed-large as the
embedder. Do not swap the model in this PR.

Strategy B (switch embedder to bge-m3 or nomic-embed-text-v1.5) is insufficient on its
own. bge-m3 has an 8192-token native context, which covers most policy sections and memory
bodies. But a single multi-message assistant turn in a Claude Code session JSONL can exceed
10,000 tokens — a `tool_result` block containing a large file read, followed by a long
reasoning response, easily hits this ceiling. Strategy B defers the overrun problem rather
than solving it. Chunking is mandatory for `session_chunks` regardless, because that table
is literally designed as a chunk table.

Strategy C (bge-m3 for short tables + chunker for unbounded tables) gives the best
embedding fidelity — fewer chunks, richer context per vector — but doubles this PR's
surface area. It requires a schema migration to align vector dimensions (bge-m3 = 1024, but
nomic-embed-text-v1.5 = 768 requires column type changes), a re-embed pass over all
existing rows, and validation that the new model's similarity space is coherent with existing
cosine-distance thresholds. That is a separate, careful migration, not a tack-on.

The chunker is the load-bearing piece. Once it ships and proves out on real projects, the
bge-m3 follow-up becomes a bounded, low-risk upgrade: swap the model, re-run the loader,
validate search quality. The inverse order — swap the model first, add the chunker later —
leaves `session_chunks` broken throughout.

## 5. Design

### 5.1 Chunker (`scripts/pipeline-chunker.js`)

**Token-counting strategy:** char-based heuristic at 1 token ≈ 4 chars. Conservative for
English prose and mixed code. A 1400-char window yields ≤ 350 tokens, providing a 30%
safety margin below the 512-token hard cap even if the heuristic is off by 15% for
dense code or CJK content.

**Chunk parameters:**
- Target size: 350 tokens (1400 chars)
- Hard max: 400 tokens (1600 chars)
- Overlap: 50 tokens (200 chars) carried from the tail of the prior chunk into the head of
  the next, preserving sentence continuity at boundaries

**Boundary rules (evaluated in priority order):**

1. Markdown heading lines matching `/^#{1,6}\s/m` — always split before a heading; the
   heading line begins the new chunk.
2. Code-fence boundaries matching `/^```/m` — split at the closing fence; the fence line
   ends the current chunk.
3. Blank-line paragraph breaks (`\n\n`) — split at the blank line.
4. Sentence breaks: period or question mark or exclamation followed by a space and an
   uppercase letter — split after the punctuation.
5. Fixed-char window at 1400 chars with no boundary found — hard split; no overlap
   adjustment at this fallback.

**Exported interface:**

```js
// scripts/pipeline-chunker.js
function chunkText(text, opts = {}) {
  // opts: { targetChars, maxChars, overlapChars }
  // returns Array<{ content: string, chunkIdx: number }>
}
module.exports = { chunkText };
```

Context prefix is injected by the loader (not the chunker) so the chunker stays
table-agnostic.

### 5.2 Loader (`scripts/pipeline-memory-loader.js`)

**Sources by table:**

- `memory_entries` — reads `~/.claude/projects/<encoded-cwd>/memory/*.md`. Each file maps
  to one parent row: `name` = filename without `.md` extension, `description` = first line
  if it starts with `#`, `body` = full file content. Chunks written to
  `memory_entry_chunks`.
- `session_chunks` — reads `~/.claude/projects/<encoded-cwd>/*.jsonl`. Each JSONL line is
  one message. Messages with role `user`, `assistant`, `tool_use`, or `tool_result` become
  chunks. `chunk_kind` = message role. If a single message's content exceeds 1600 chars,
  `chunkText()` sub-chunks it; sub-chunks share `session_id` and increment `chunk_idx`.
- `policy_sections` — reads project `CLAUDE.md` (at `$PROJECT_ROOT/CLAUDE.md`) and global
  `~/.claude/CLAUDE.md`. Splits on heading boundaries to produce one row per section.
  `doc_id` = filename (`CLAUDE.md` or `global-CLAUDE.md`). If a section's content exceeds
  1600 chars, sub-chunks it; sub-chunks share `doc_id + section_num` and increment
  `chunk_idx`.

**Idempotence keys:**

| Table | Dedup key |
|-------|-----------|
| `memory_entries` | `name` |
| `memory_entry_chunks` | `(entry_id, chunk_idx)` |
| `session_chunks` | `(session_id, chunk_idx)` |
| `policy_sections` | `(doc_id, section_num, chunk_idx)` |

Re-running the loader issues `INSERT ... ON CONFLICT (...) DO UPDATE SET content = EXCLUDED.content, embedding = NULL` so stale embeddings are cleared and re-queued.

**Embedding orchestration:** The loader calls `ollamaEmbed()` from `scripts/lib/shared.js`
directly. It does not go through `pipeline-embed.js cmdIndex`. The loader owns its embed
loop with BATCH=8. On an Ollama error for any chunk, the loader logs the error with chunk
identity (`table, id, chunk_idx`) and continues to the next batch. It does not abort. After
all chunks are attempted, it prints a summary: `N chunks embedded, M skipped (errors)`.

### 5.3 Schema Additions

**`policy_sections`** already acts as a chunk table (one row per heading). Add one column:

```sql
ALTER TABLE policy_sections
  ADD COLUMN IF NOT EXISTS chunk_idx INTEGER NOT NULL DEFAULT 0;

ALTER TABLE policy_sections
  DROP CONSTRAINT IF EXISTS policy_sections_doc_section_uniq;

ALTER TABLE policy_sections
  ADD CONSTRAINT policy_sections_doc_section_chunk_uniq
  UNIQUE (doc_id, section_num, chunk_idx);
```

**`memory_entry_chunks`** (new sibling table):

```sql
CREATE TABLE IF NOT EXISTS memory_entry_chunks (
  id          SERIAL PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  chunk_idx   INTEGER NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entry_id, chunk_idx)
);
ALTER TABLE memory_entry_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE memory_entry_chunks
  ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
CREATE INDEX IF NOT EXISTS mem_chunks_fts_idx
  ON memory_entry_chunks USING gin(fts_vec);
```

**`session_chunks`** — no schema change. The table already has `session_id`, `chunk_idx`,
`chunk_kind`, `content`, `embedding vector(1024)`, `fts_vec`. The loader populates it
directly.

**Context prefix format injected by loader before embedding:**

- `memory_entry_chunks`: `"Memory: {name}\n\n{chunk_content}"`
- `policy_sections`: `"Policy: {doc_id} §{section_num} {section_title}\n\n{chunk_content}"`
- `session_chunks`: `"Session: {session_id} [{chunk_kind}]\n\n{chunk_content}"`

### 5.4 Search-Time Reassembly (`pipeline-embed.js` `cmdHybrid`)

Add a SQL view `v_memory_hits` that unions all three chunk sources into a single shape:

```sql
CREATE OR REPLACE VIEW v_memory_hits AS
  SELECT 'memory_entry_chunks' AS source_table,
         mc.id AS chunk_id, mc.entry_id AS parent_id,
         me.name AS label,
         substring(mc.content, 1, 120) AS snippet,
         mc.embedding, mc.fts_vec
  FROM memory_entry_chunks mc
  JOIN memory_entries me ON me.id = mc.entry_id
UNION ALL
  SELECT 'policy_sections', ps.id, ps.id,
         ps.doc_id || ' §' || coalesce(ps.section_num, '') AS label,
         substring(ps.content, 1, 120),
         ps.embedding, ps.fts_vec
  FROM policy_sections ps
UNION ALL
  SELECT 'session_chunks', sc.id, sc.session_num,
         sc.session_id || ' [' || sc.chunk_kind || ']' AS label,
         substring(sc.content, 1, 120),
         sc.embedding, sc.fts_vec
  FROM session_chunks sc;
```

`cmdHybrid` queries `v_memory_hits` for semantic and FTS search. Callers receive
`(source_table, chunk_id, parent_id, label, snippet, score)` and never stitch across
tables manually. The view is created in `pipeline-embed.js` setup path alongside other
schema introspection.

## 6. Test Plan (CRITICAL)

The following five tests are a hard acceptance gate. **Any failure in items 1–5 is a hard
blocker for merge.** "Works on my machine" with typical data is not acceptance. The tests
must be run against the pathological inputs described below.

**Test 1 — Pathological policy section.**
Construct or identify a `CLAUDE.md` section whose content exceeds 8000 chars (the
Destructive Operation Guards section in the project CLAUDE.md is a candidate; pad if
needed). Run the loader. Assert: (a) no Ollama overrun errors logged; (b) `SELECT
COUNT(*) FROM policy_sections WHERE doc_id = 'CLAUDE.md'` shows ≥ 2 rows for that
section (chunk_idx 0 and 1 at minimum); (c) `node scripts/pipeline-embed.js hybrid
"<phrase verbatim from the middle of the section>"` returns a result whose snippet
contains that phrase.

**Test 2 — Pathological memory body.**
Create a `.md` file in `~/.claude/projects/<encoded-cwd>/memory/` whose body is > 20000
chars (approximately 5000 tokens). Run the loader. Assert: (a) `SELECT COUNT(*) FROM
memory_entry_chunks WHERE entry_id = <id>` ≥ 5; (b) no Ollama overrun errors; (c) hybrid
search for a phrase that appears only in chunk index 3 or later returns a result from that
chunk.

**Test 3 — Pathological session transcript.**
Identify or construct a JSONL where a single assistant message body exceeds 4000 chars.
Run the loader. Assert: (a) that message produces ≥ 2 rows in `session_chunks` with
distinct `chunk_idx` values; (b) all embed without error; (c) hybrid search for a phrase
from the second sub-chunk returns that chunk.

**Test 4 — Idempotence.**
Run the loader twice against identical sources without modifying any source files between
runs. Assert: row counts in `memory_entry_chunks`, `session_chunks`, and `policy_sections`
are identical after both runs. No duplicate rows.

**Test 5 — Partial failure resilience.**
Inject one chunk whose content is 2000 chars of repeated non-ASCII characters (which
exceed the 512-token cap even under the conservative heuristic) by directly inserting a
row with `embedding = NULL` and an oversize `content` value. Run `node
scripts/pipeline-embed.js index`. Assert: (a) the oversize chunk is logged as an error
with its table and id; (b) all other chunks in the same BATCH=8 window that are within
budget embed successfully; (c) the loader does not abort or throw an uncaught exception.

## 7. Implementation Order

Dependencies must be resolved in this sequence:

1. **`scripts/pipeline-chunker.js`** — pure function, no DB or filesystem dependencies.
   Write and unit-test in isolation before touching any other file.

2. **Migration SQL** (add to `scripts/setup-knowledge-db.sql` and run manually in dev):
   `ALTER TABLE policy_sections ADD COLUMN IF NOT EXISTS chunk_idx INTEGER NOT NULL DEFAULT 0`,
   drop/recreate unique constraint, `CREATE TABLE IF NOT EXISTS memory_entry_chunks`.

3. **`scripts/pipeline-memory-loader.js`** — depends on `pipeline-chunker.js` and
   `scripts/lib/shared.js` (`ollamaEmbed`, `connect`, `loadConfig`). No dependency on
   `pipeline-embed.js`.

4. **`scripts/pipeline-embed.js`** — add `CREATE OR REPLACE VIEW v_memory_hits` to the
   setup/introspection path; update `cmdHybrid` to query `v_memory_hits` in addition to
   (or instead of) individual chunk table queries.

5. **`docs/memory.md`** — update the paragraph at line 248 that states "Pipeline does not
   ship a loader for these six tables." Replace with: "Pipeline ships loaders for
   `memory_entries`, `policy_sections`, and `session_chunks`. Loaders for `incidents`,
   `checklist_items`, and `corpus_files` are deferred."

## 8. Out of Scope (Follow-up Work)

- **Strategy B — longer-context embedder swap.** Switching to bge-m3 (1024 dims, 8192
  native context) or nomic-embed-text-v1.5 (768 dims, 8192 context) is a clean follow-on
  after the chunker proves out. bge-m3 is dimension-compatible with existing `vector(1024)`
  columns; nomic requires a column type migration. Both require a full re-embed pass.
  Tracked as separate spec.
- **`corpus_files` PDF/binary content extraction.** Requires a text-extraction pipeline
  (pdftotext or equivalent) before chunking is possible.
- **Loaders for `incidents` and `checklist_items`.** No natural filesystem source-of-truth
  in this project. These tables are populated via pipeline commands, not file mirrors.
- **Search ranking and RRF weight tuning.** The current hybrid search weights are
  unchanged by this spec.
- **Multi-project memory federation.** Each loader run is scoped to the project root of
  the calling process.

## 9. Risks

**Risk 1 — Char-based heuristic underestimates token count for code and CJK.**
Dense code blocks and CJK text have higher token density than English prose. A 1400-char
chunk of Japanese text can be 700+ tokens, well over the 512-token cap.
Mitigation: the 1400-char target (350 tokens at the heuristic rate) provides a 30% margin
below the 512-token cap. Code-fence boundary detection (rule 2) splits before and after
fenced blocks, limiting code density within a chunk. If the margin proves insufficient in
testing, reduce target to 1200 chars (300 tokens) with no other changes.

**Risk 2 — BATCH=8 loader is 4× slower than cmdIndex BATCH=32.**
The loader's conservative batch size reduces throughput. For a project with 853 policy
sections each producing 2 chunks on average (1706 chunks), BATCH=8 means 214 Ollama calls
vs. 54 at BATCH=32. At ~150 ms per Ollama call, that is ~32 seconds vs. ~8 seconds.
Mitigation: loaders run infrequently (on-demand, not in the hot path). The throughput
tradeoff is accepted in exchange for per-chunk error isolation. BATCH can be raised to 16
in a follow-up once the overrun risk is validated against real data.

**Risk 3 — `memory_entry_chunks` fragments memory retrieval across two tables.**
Adding a sibling chunk table means queries that previously scanned `memory_entries` miss
chunk-level content unless they also scan `memory_entry_chunks`. Agents that bypass
`cmdHybrid` and query directly will see only the parent row.
Mitigation: `v_memory_hits` view unifies all three chunk sources behind a single query
surface. `cmdHybrid` is the sole search entry point documented for agent use. Parent rows
in `memory_entries` remain intact and searchable for short bodies that fit in a single
chunk (chunk_idx = 0 only).
