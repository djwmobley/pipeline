---
debate_date: 2026-04-26
spec: docs/specs/2026-04-26-chunking-loader-spec.md
github_issue: 142
postgres_task: 60
panelists: [advocate, skeptic, practitioner]
disposition: proceed-with-constraints
---

# Debate Verdict: Chunker / Loader for Semantic Memory

## Disposition: proceed-with-constraints

The chunker/loader architecture is fundamentally sound. Boundary-aware splitting, per-chunk error isolation, idempotent upsert, and a unified query view are the correct primitives for making semantic memory functional after it has been non-operational since launch. Four HIGH-likelihood correctness gaps surfaced across the three panels — char-heuristic failure on JSONL content that causes silent token overruns, a missing HNSW vector index that degrades cosine query performance to sequential scans, Ollama returning HTTP 200 with an empty embedding array that poisons cosine rankings silently, and Windows encoded-cwd path computation that discovers zero JSONL files — any one of which would leave semantic memory either non-functional or silently corrupt in production. The plan must resolve all four before merge. The remaining contested points require explicit choices by the plan author but do not block the architecture.

## Points of Agreement

These items received explicit endorsement from two or more panelists and are hard constraints. The plan must not violate them.

- **Chunking is load-bearing regardless of embedder.** Even bge-m3's 8192-token ceiling cannot eliminate the need to split long session transcripts into retrieval units. A single tool_result block from a large file read can exceed 10,000 tokens. Strategy B (embedder swap) is a bounded follow-on, not an alternative, and must be treated as such in the plan. (Advocate, Skeptic by non-contestation, Practitioner)

- **Boundary priority order heading → code-fence → paragraph → sentence → hard-split is correct.** This mirrors the actual structure of CLAUDE.md and JSONL content and matches LangChain MarkdownTextSplitter production behavior. Fixed-window chunking would routinely bisect fenced code blocks and heading sections. Any plan that reorders these rules must provide empirical justification from a test run against the pathological inputs in §6. (Advocate, Practitioner)

- **BATCH=8 with per-chunk error isolation is the right blast-radius control.** The prior BATCH=32 silent-discard failure mode (cmdIndex) is the direct precedent. Reducing to BATCH=8 limits blast radius 4x and enables chunk-identity logging on failure. LlamaIndex OllamaEmbedding uses BATCH=10; BATCH=8 is in the correct range. Continue-on-error with logged chunk identity is standard practice. (Advocate, Practitioner)

- **chunkText() must remain pure and table-agnostic.** Context prefix injection belongs in the loader, not in the chunker. The plan must not couple chunk construction to any specific table's schema. Any function that requires a table name to compute chunk boundaries has violated this constraint. (Advocate — hard constraint, uncontested)

- **The five §6 acceptance gate tests must cover pathological inputs, not happy paths.** The oversized JSONL block, code-fence bisection, idempotent re-run, Windows path round-trip, and non-ASCII Ollama response are exactly the failure modes that broke prior implementations. Happy-path tests validate nothing the prior implementation did not already handle. (Advocate, Practitioner)

- **Implementation must follow §7 order: chunker → migration → loader → embed view.** Out-of-order implementation creates dependency failures. The migration must exist before the loader runs; the view must exist before agents query it. No plan deliverable may skip a step or reorder them without a dependency analysis. (Advocate, uncontested)

- **Semantic memory is currently non-functional and this spec is the minimum viable intervention.** Zero rows in memory_entry_chunks, session_chunks, and policy_sections since launch. No panelist argued for deferral of the entire feature. The debate result is proceed-with-constraints, not rethink. (All three panelists)

- **v_memory_hits must be created in the embed setup path, not post-loader.** The view must exist before any agent queries it. Including it in the post-loader migration creates a window where agents receive errors on memory queries if the loader has not yet run. (Advocate, implied by Practitioner's HNSW index placement recommendation)

## Contested Points

### CP1 — v_memory_hits: SQL view vs. JS UNION ALL

**View (Advocate):** The SQL view enforces a single query surface so agents cannot bypass chunk-level content by querying source tables directly. The consistency guarantee is worth the schema complexity.

**JS UNION ALL (Skeptic):** parent_id is semantically incoherent across the three source tables: memory_entry_chunks.parent_id is a row ID, session_chunks.parent_id is a session ordinal (sessions.num — a different concept), and policy_sections.parent_id is a self-referential row ID. Any caller using parent_id for grouping or linkage receives incompatible integers depending on source_table. The view masks this type mismatch; a JS-constructed UNION ALL allows per-source aliasing that resolves it transparently.

**Recommendation for the plan:** Keep the SQL view but surface the mismatch explicitly rather than masking it. Add source_row_id (consistent row ID in each source table) and source_ordinal (session_num for session_chunks, NULL elsewhere) as explicit columns alongside parent_id. Document parent_id as display-only in the view comment. Callers needing reliable row linkage must use source_row_id. This preserves the single-query-surface guarantee while eliminating the silent type mismatch.

### CP2 — Idempotence strategy: unconditional embedding = NULL reset vs. content-hash skip

**Unconditional reset (Advocate):** Simple, correct, guarantees fresh embeddings on every re-run. A content-hash approach adds schema complexity and a migration.

**Content-hash skip (Skeptic):** For 1700+ chunks, unconditional reset causes 30+ seconds of unnecessary Ollama inference on every incremental loader run. Every call to the loader becomes a full rebuild costing 30+ seconds regardless of whether source content changed. This makes the loader unusable as a routine incremental sync tool. SHA256 content_hash costs one migration column per chunk table and one hash comparison per upsert.

**Recommendation for the plan:** Add SHA256 content_hash column to all three chunk tables in the §5.3 migration. The loader computes the hash of source text before upsert and skips the Ollama call when the stored hash matches. Retain unconditional reset as a --force flag for full rebuilds when a model change or schema migration invalidates all embeddings. This makes the loader usable as both a routine incremental sync and a full rebuild, and it costs one migration and approximately ten lines of JS.

### CP3 — Acceptance gate automation: test script vs. manual checklist

**Manual (Advocate):** §6 tests are well-specified; a competent implementer can run them manually. Gate enforcement is the plan author's responsibility.

**Automated (Skeptic):** A hard gate with no test runner, no script, and no CI hook is a naming convention. "Hard merge gate" without an automated check means the gate will be skipped under time pressure. The four prior zero-row tables are evidence that manual quality gates fail in this codebase.

**Recommendation for the plan:** Add scripts/test-chunker.js covering all five §6 cases as runnable automated tests. The script must exit 0 on pass and 1 on failure. Gate enforcement requires a logged passing run output in the PR description before any merge. Full CI integration can follow as a separate task; the script must exist and pass at v1.

### CP4 — v_memory_hits snippet length and chunk position metadata

**Status quo (implicit in spec):** Snippet at 120 chars, no chunk position indicator.

**Extended (Skeptic / Practitioner):** Production retrieval UIs surface 200-400 chars of snippet. Callers have no way to determine whether a returned chunk is the first or fifteenth in a sequence without chunk_idx and total_chunks, which are necessary for accurate context reconstruction.

**Recommendation for the plan:** Extend snippet to 300 chars in the view DDL. Add chunk_idx and total_chunks as computed columns via subquery on each chunk table grouped by source row. Both changes are view-DDL only and do not touch the embedding pipeline or chunker.

## Invalidated Assumptions

**1. "A 1400-char ceiling provides a 30% safety margin for the 512-token cap."**
The spec assumes 4 chars/token uniformly across all source tables, yielding a 1400-char ceiling with 30% margin below the 512-token embed model limit. Skeptic refuted with direct evidence: Claude Code JSONL transcripts contain JSON-escaped strings, code inside tool_result blocks, and URL-dense content that averages 2-2.5 chars/token, not 4. A 1400-char chunk of a session tool_result is 560-700 tokens — 10-37% over the cap. The 30% safety margin disappears precisely on session_chunks, the table that motivated the chunking feature. The loader silently skips oversize chunks with the same token-overrun error the prior implementation produced. The plan must implement per-source chars-per-token calibration: JSONL sources use a 560-char ceiling (2.5 chars/token); prose sources retain the 1400-char ceiling (4.0 chars/token). The caller (loader) selects mode by source table name. chunkText() receives the ceiling as a parameter, not a hardcoded constant.

**2. "The GIN index on fts_vec is sufficient for retrieval performance."**
The spec creates a GIN index on fts_vec for full-text search but specifies no vector index on the embedding column. Practitioner refuted with standard pgvector behavior: without CREATE INDEX USING hnsw (embedding vector_cosine_ops) on memory_entry_chunks.embedding, every cosine similarity query performs a sequential scan over all chunk rows. At 5000+ chunks — readily reached after a few weeks of session history — this is a hard latency regression on every agent memory lookup. The HNSW index is not optional performance tuning; it is a correctness requirement for usable retrieval at realistic data volumes. The plan must add HNSW indexes on memory_entry_chunks.embedding and session_chunks.embedding in the §5.3 migration.

**3. "§6 constitutes a hard merge gate."**
The spec labels five tests a hard merge gate with no test runner, no automation path, and no CI hook attached. Skeptic refuted the assumption that the gate label is self-enforcing: a gate without an automated check is a naming convention. The evidence is the semantic memory tables themselves — they have been non-functional since launch, implying prior quality gates were insufficient. The plan must ship scripts/test-chunker.js alongside the chunker and require a passing run before merge.

**4. "ollamaEmbed can detect failure via HTTP status code."**
Pre-0.3.0 Ollama returns HTTP 200 with an empty embedding array (not an error status) when processing certain repeated non-ASCII inputs. The spec's Test 5 targets this scenario but does not specify that ollamaEmbed must check array content rather than only HTTP status. Practitioner refuted via Ollama release history. If ollamaEmbed checks only for non-200, it silently writes a zero-vector (or writes no row with no logged error depending on implementation) to the chunk table. A zero-vector embedding poisons all cosine rankings: the chunk's distance to every query vector becomes near-1.0, causing it to surface in every retrieval regardless of semantic relevance. The plan must validate that the returned embedding array is non-empty and that its Euclidean magnitude is non-zero before writing. Log the chunk identity and skip on failure; never write a zero-vector.

**5. "JSONL path computation is cross-platform."**
The spec describes loading session JSONL from ~/.claude/projects/<encoded-cwd>/ without specifying encoding rules per platform. Practitioner refuted with Claude Code internals: on Windows, the cwd encoding uses backslash-to-dash substitution, producing a directory name that no POSIX-rule path computation resolves. The loader discovers zero JSONL files silently on Windows — the same outcome as if session_chunks were empty, with no error surfaced. The plan must abstract encoded-cwd path computation into scripts/lib/encoded-cwd.js that branches on process.platform, and cover it with a path round-trip unit test in scripts/test-chunker.js.

## Risk Register

| Risk | Source | Likelihood | Mitigation the plan must include |
|------|--------|------------|----------------------------------|
| Char heuristic at 4 chars/token overflows the 512-token embed cap on JSONL tool_result blocks (real density: 2-2.5 chars/token, producing 560-700 token chunks) | Skeptic | HIGH | Per-source calibration: JSONL ceiling 560 chars (2.5 chars/token), prose ceiling 1400 chars (4.0 chars/token); loader selects mode by source table; chunkText() receives ceiling as a parameter |
| Missing HNSW vector index causes sequential cosine scans on memory_entry_chunks.embedding; latency regression at 5000+ chunks makes agent memory lookups unusable | Practitioner | HIGH | Add CREATE INDEX USING hnsw (embedding vector_cosine_ops) on memory_entry_chunks.embedding and session_chunks.embedding in §5.3 migration |
| Pre-0.3.0 Ollama returns HTTP 200 with empty embedding array for repeated non-ASCII input; ollamaEmbed writes zero-vector, poisoning all cosine rankings silently | Practitioner | HIGH | ollamaEmbed must assert returned array is non-empty and has non-zero magnitude before write; log chunk identity and skip on failure; include assertion in Test 5 of scripts/test-chunker.js |
| Windows encoded-cwd path computation (POSIX rules applied to backslash-to-dash Windows encoding) finds zero JSONL files with no error surfaced | Practitioner | HIGH | Abstract to scripts/lib/encoded-cwd.js; branch on process.platform === 'win32'; cover with path round-trip unit test |
| Unconditional embedding = NULL reset makes every loader invocation a 30+ second full rebuild for 1700+ chunks; loader is unusable as incremental sync | Skeptic | MEDIUM | Add SHA256 content_hash column to chunk tables; skip embed when hash matches stored value; --force flag for full rebuild |
| Rule-5 hard-split fallback fires on JSONL tool_result content, bisecting mid-expression at sentence boundaries inside code blocks | Practitioner | MEDIUM | Detect tool_result message type from JSONL entry structure; apply code-fence (rule 2) as primary split boundary for tool_result content; sentence rule (rule 4) applies to prose types only |
| parent_id type mismatch in v_memory_hits (row ID vs. session ordinal vs. self-referential row ID) misleads callers grouping chunks across source tables | Skeptic | MEDIUM | Add source_row_id and source_ordinal columns; document parent_id as display-only; callers use source_row_id for reliable linkage |
| Rule-5 hard-split fallback produces chunks with no overlap re-seeding, violating the 50-token overlap contract established by rules 1-4 | Practitioner | LOW | When rule-5 fires, carry the last 50-token window of the prior chunk as seed for the next split boundary; matches the overlap contract of boundary-rule splits |

## Plan Must

1. **Implement per-source chars-per-token calibration in chunkText()**: Accept a charsPerToken parameter from the caller (loader). JSONL sources pass 2.5 (560-char ceiling); prose sources pass 4.0 (1400-char ceiling). chunkText() must not hardcode 4.0. The loader selects mode by source table name at call time. This is the minimum fix to prevent silent token overruns on session_chunks, the primary motivation for the feature.

2. **Add HNSW vector index to §5.3 migration for memory_entry_chunks and session_chunks**: CREATE INDEX USING hnsw (embedding vector_cosine_ops) on each table's embedding column. Without this, cosine similarity queries perform sequential scans. At realistic data volumes (5000+ chunks after several weeks of use) this causes latency that renders agent memory lookups unusable. Include index creation in the same migration that adds the chunk tables.

3. **Validate Ollama response array before writing embedding**: ollamaEmbed must check that the returned array is non-empty and that its Euclidean magnitude is non-zero. On failure, log the chunk_id and source_table and skip the row — never write a zero-vector. Include this validation as a required assertion in Test 5 of scripts/test-chunker.js.

4. **Abstract encoded-cwd path computation into scripts/lib/encoded-cwd.js**: Implement platform detection via process.platform === 'win32' and apply the correct cwd encoding for each platform. All JSONL discovery paths in the loader must import from this utility. No inline platform branching in the loader or chunker. Add a path round-trip unit test to scripts/test-chunker.js.

5. **Add SHA256 content_hash column to all three chunk tables in §5.3 migration**: The loader computes hash of source text before upsert. When the stored hash matches, skip the Ollama call and do not reset embedding to NULL. Provide a --force flag to bypass hash checking for full rebuilds (e.g., after a model change). This makes the loader viable as a routine incremental sync tool, not just a full rebuild.

6. **Detect tool_result message type in JSONL loader and apply code-fence boundary as primary rule**: Parse the JSONL entry structure to identify tool_result content. For tool_result content, apply rule-2 (code-fence boundary) as the primary split rule before falling through to rule-4 (sentence boundary). Sentence splitting must not fire on code inside tool_result blocks. This prevents mid-expression splits on the highest-volume source content type.

7. **Extend v_memory_hits snippet to 300 chars and add chunk_idx, total_chunks, source_row_id, and source_ordinal**: snippet at 120 chars is below the production minimum for retrieval UIs. chunk_idx and total_chunks enable callers to reconstruct sequence context. source_row_id provides reliable cross-source linkage; source_ordinal exposes session_num for session_chunks. All changes are in the view DDL only and do not affect the embedding pipeline.

8. **Add scripts/test-chunker.js covering all five §6 pathological cases as automated tests**: Test 1: oversized single JSONL block split correctly with per-source ceiling. Test 2: code-fence not bisected by boundary rules. Test 3: idempotent re-run produces no duplicate rows and respects content_hash skip. Test 4: Windows encoded-cwd path round-trip resolves correctly on all platforms. Test 5: Ollama empty-array response does not write a zero-vector; row is skipped and logged. Script must exit 0 on pass and exit 1 on any failure with a descriptive message.

9. **Gate merge on passing scripts/test-chunker.js run**: PR description must include logged output of node scripts/test-chunker.js with exit 0 before any merge request is opened. This converts the §6 "hard merge gate" from a naming convention into an enforced checkpoint.

10. **Re-seed 50-token overlap after rule-5 hard-split**: When the hard-split fallback fires, carry the last 50-token window of the prior chunk as the seed for the next split boundary. This matches the overlap contract established by the boundary-rule splits (rules 1-4) and prevents information loss at hard-cut boundaries in long content blocks.

11. **Create v_memory_hits in the §5.3 setup migration, not post-loader**: The view must exist before any agent attempts a memory query. Including it in a post-loader migration creates a gap where agents receive query errors if the loader has not yet run. The view DDL is independent of loader state; include it in the same migration that creates the chunk tables.

12. **Document parent_id as display-only in v_memory_hits**: Add a SQL comment on the view explaining that parent_id semantics differ by source_table (row ID for memory_entry_chunks and policy_sections, session ordinal for session_chunks). Callers requiring reliable row linkage must use source_row_id. This prevents silent bugs in any downstream code that treats parent_id as a homogeneous foreign key.

## Recommended Deferrals

- **Strategy B embedder swap (bge-m3)**: The architecture is a bounded follow-on once session_chunks is populated and the HNSW index is in place. No blocker in the current spec — defer to a standalone spec after this one ships and baseline retrieval quality is established.

- **Per-table batch size configuration**: BATCH=8 is acceptable for all three tables at v1 scale. policy_sections entries are short-by-construction and rarely need isolation, making larger batches a reasonable optimization there. Per-table batch config is three lines of code but zero correctness value until profiling data from production use exists.

- **Weekly aggregation reporting on chunk-level embed failures**: The per-chunk error log from BATCH=8 error isolation already captures the raw signal. Aggregating into a weekly report belongs after the loader has shipped and produced real failure data. Adding it now would be instrumenting a path that may not fail in practice.

- **Full-text search integration with v_memory_hits**: The GIN index on fts_vec supports full-text queries, but the loader and chunk tables do not yet populate tsvector columns consistently across all three source tables. Integrating FTS with the semantic retrieval path is a separate feature; it belongs after cosine retrieval is verified working and delivering value.

- **BATCH=8 adjustment for policy_sections**: Short-by-construction sections make per-chunk error isolation less valuable for that specific table. Tuning batch size per table is a legitimate optimization but adds configuration surface area that has no correctness impact at v1 scale.
