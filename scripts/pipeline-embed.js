#!/usr/bin/env node
/**
 * pipeline-embed.js — Embedding index for code_index, workflow_discovery,
 * and agent_rewrites using Ollama
 *
 * Generates vector embeddings for all indexable tables,
 * enabling semantic search across the codebase and v2 planning knowledge.
 *
 * Reads connection config from .claude/pipeline.yml.
 *
 * Usage:
 *   node pipeline-embed.js index              # Embed all unembedded entries
 *   node pipeline-embed.js index --all        # Re-embed everything
 *   node pipeline-embed.js search "<query>"   # Pure vector similarity search
 *   node pipeline-embed.js hybrid "<query>"   # FTS + vector hybrid search (best)
 *   node pipeline-embed.js add <path> "<desc>" # Add/update a file in the code index
 *   node pipeline-embed.js stats              # Show embedding coverage per table
 *
 * Requires:
 *   - Ollama running at localhost:11434
 *   - Model pulled: ollama pull mxbai-embed-large
 *   - PostgreSQL with pgvector extension
 */

const { loadConfig, connect, c, ollamaDefaults, ollamaEmbed, tryEmbed } = require('./lib/shared');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = loadConfig();
const OLLAMA_HOST = ollamaDefaults.host;
const OLLAMA_PORT = ollamaDefaults.port;
const EMBED_MODEL = CONFIG.embedding_model || ollamaDefaults.model;

// ─── TABLE DEFINITIONS ──────────────────────────────────────────────────────
// Each entry defines how to read, embed, and search a table.
// SECURITY: tbl.name, tbl.selectCols, and tbl.idCol are expanded into SQL
// identifiers. These MUST remain static source constants — never populated
// from pipeline.yml, user input, or any external data.

const TABLES = [
  {
    name: 'code_index',
    idCol: 'path',
    textFn: (r) => `File: ${r.path}\n\n${r.description}`,
    selectCols: 'path, description',
    updateSql: 'UPDATE code_index SET embedding = $1 WHERE path = $2',
    label: (r) => r.path || '(unknown)',
    snippet: (r) => r.description || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'workflow_discovery',
    idCol: 'id',
    textFn: (r) => `[${r.item_type || 'unknown'}] ${r.step || 'general'}: ${r.title || ''}\n\n${r.detail || ''}`,
    selectCols: 'id, step, item_type, title, detail',
    updateSql: 'UPDATE workflow_discovery SET embedding = $1 WHERE id = $2',
    label: (r) => `[${r.item_type || '?'}] ${r.step || 'general'}: ${r.title || '(untitled)'}`,
    snippet: (r) => r.detail || r.title || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'agent_rewrites',
    idCol: 'id',
    textFn: (r) => `Agent: ${r.agent_name || ''}\nAS-IS: ${r.as_is || ''}\nTO-BE: ${r.to_be || ''}\nGap: ${r.gap || ''}\nEffort: ${r.effort || ''}`,
    selectCols: 'id, agent_name, as_is, to_be, gap, effort',
    updateSql: 'UPDATE agent_rewrites SET embedding = $1 WHERE id = $2',
    label: (r) => `agent: ${r.agent_name || '?'} (${r.effort || '?'})`,
    snippet: (r) => r.gap || r.to_be || r.agent_name || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'decisions',
    idCol: 'id',
    textFn: (r) => `${r.topic || ''} ${r.decision || ''} ${r.reason || ''}`,
    selectCols: 'id, topic, decision, reason',
    updateSql: 'UPDATE decisions SET embedding = $1 WHERE id = $2',
    label: (r) => `decision: ${r.topic || '?'}`,
    snippet: (r) => r.decision || r.reason || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'sessions',
    idCol: 'num',
    textFn: (r) => r.summary || '',
    selectCols: 'num, summary',
    updateSql: 'UPDATE sessions SET embedding = $1 WHERE num = $2',
    label: (r) => `session #${r.num}`,
    snippet: (r) => r.summary || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'session_chunks',
    idCol: 'id',
    textFn: (r) => `Session ${r.session_num} ${r.chunk_kind || ''}: ${r.content || ''}`,
    selectCols: 'id, session_num, chunk_idx, chunk_kind, content',
    updateSql: 'UPDATE session_chunks SET embedding = $1 WHERE id = $2',
    label: (r) => `session #${r.session_num} — ${r.chunk_kind || 'chunk ' + r.chunk_idx}`,
    snippet: (r) => (r.content || '').substring(0, 120),
    ftsCol: 'fts_vec',
  },
  {
    name: 'gotchas',
    idCol: 'id',
    textFn: (r) => `${r.issue || ''} ${r.rule || ''}`,
    selectCols: 'id, issue, rule',
    updateSql: 'UPDATE gotchas SET embedding = $1 WHERE id = $2',
    label: (r) => `gotcha: ${r.issue || '?'}`,
    snippet: (r) => r.rule || r.issue || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'memory_entries',
    idCol: 'id',
    textFn: (r) => `Memory: ${r.name}\n${r.description || ''}\n\n${(r.body || '').substring(0, 5000)}`,
    selectCols: 'id, name, description, mem_type, body',
    updateSql: 'UPDATE memory_entries SET embedding = $1 WHERE id = $2',
    label: (r) => `memory: ${r.name || '?'}`,
    snippet: (r) => r.description || (r.body || '').substring(0, 120),
    ftsCol: 'fts_vec',
  },
  {
    name: 'policy_sections',
    idCol: 'id',
    textFn: (r) => `Policy: ${r.doc_id} ${r.section_num || ''}: ${r.section_title || ''}\n\n${(r.content || '')}`,
    selectCols: 'id, doc_id, section_num, section_title, content',
    updateSql: 'UPDATE policy_sections SET embedding = $1 WHERE id = $2',
    label: (r) => `policy: ${r.doc_id} ${r.section_num || ''}: ${r.section_title || ''}`,
    snippet: (r) => (r.content || '').substring(0, 120),
    ftsCol: 'fts_vec',
  },
  {
    name: 'checklist_items',
    idCol: 'id',
    textFn: (r) => `Checklist: ${r.checklist_name || ''} [${r.cadence || ''}]: ${r.title || ''}\n${r.description || ''}\n${r.verification_step || ''}`,
    selectCols: 'id, checklist_name, cadence, title, description, verification_step',
    updateSql: 'UPDATE checklist_items SET embedding = $1 WHERE id = $2',
    label: (r) => `checklist: ${r.checklist_name || '?'} [${r.cadence || '?'}]: ${r.title || '?'}`,
    snippet: (r) => r.description || r.title || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'incidents',
    idCol: 'id',
    textFn: (r) => `Incident: ${r.incident_code || ''}: ${r.title || ''}\nWhat happened: ${r.what_happened || ''}\nWhat we did: ${r.what_we_did || ''}\nWatch for: ${r.watch_for || ''}`,
    selectCols: 'id, incident_code, title, what_happened, what_we_did, watch_for',
    updateSql: 'UPDATE incidents SET embedding = $1 WHERE id = $2',
    label: (r) => `incident: ${r.incident_code || '?'}: ${r.title || '?'}`,
    snippet: (r) => r.what_happened || r.title || '',
    ftsCol: 'fts_vec',
  },
  {
    name: 'corpus_files',
    idCol: 'id',
    textFn: (r) => `File: ${r.path || ''}\nDomain: ${r.source_domain || ''}\n\n${r.summary || ''}`,
    selectCols: 'id, path, file_type, source_domain, summary',
    updateSql: 'UPDATE corpus_files SET embedding = $1 WHERE id = $2',
    label: (r) => `corpus: ${r.path || '?'}`,
    snippet: (r) => r.summary || `[binary: ${r.file_type || '?'}]`,
    ftsCol: 'fts_vec',
  },
];

// ─── CHUNK-COVERED TABLES ────────────────────────────────────────────────────
// Tables covered by v_memory_hits view — embedded as chunks, not as parent rows.
// cmdIndex skips these to avoid Ollama context-overrun on long parent-row bodies.
// cmdSearch and cmdHybrid query them via the view, not the parent tables directly.
const MEMORY_HITS_COVERED = new Set(['memory_entries', 'session_chunks', 'policy_sections', 'memory_entry_chunks']);

// ─── INTROSPECTION HELPERS ──────────────────────────────────────────────────

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(client, tableName, colName) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2",
    [tableName, colName]
  );
  return rows.length > 0;
}

async function hasAnyEmbeddings(client, tableName) {
  if (!(await columnExists(client, tableName, 'embedding'))) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM ${tableName} WHERE embedding IS NOT NULL LIMIT 1`
  );
  return rows.length > 0;
}

// ─── INDEX ───────────────────────────────────────────────────────────────────

async function cmdIndex(forceAll) {
  const client = await connect(CONFIG);
  try {
    let totalDone = 0;

    for (const tbl of TABLES) {
      if (!(await tableExists(client, tbl.name))) {
        console.log(c.dim(`Skipping ${tbl.name} — table does not exist.`));
        continue;
      }
      if (!(await columnExists(client, tbl.name, 'embedding'))) {
        console.log(c.dim(`Skipping ${tbl.name} — no embedding column. Run setup to add it.`));
        continue;
      }
      if (MEMORY_HITS_COVERED.has(tbl.name)) {
        console.log(c.dim(`Skipping ${tbl.name} — covered by v_memory_hits chunks.`));
        continue;
      }

      const query = forceAll
        ? `SELECT ${tbl.selectCols} FROM ${tbl.name} ORDER BY ${tbl.idCol}`
        : `SELECT ${tbl.selectCols} FROM ${tbl.name} WHERE embedding IS NULL ORDER BY ${tbl.idCol}`;
      const { rows } = await client.query(query);

      if (rows.length === 0) {
        console.log(c.green(`${tbl.name}: all entries already embedded.`));
        continue;
      }

      console.log(`${c.bold('Embedding')} ${rows.length} ${tbl.name} entries via ${EMBED_MODEL}...`);

      const BATCH = 32;
      let done = 0;
      try {
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const texts = batch.map(tbl.textFn);
          const embeddings = await ollamaEmbed(texts, CONFIG);

          if (embeddings.length !== batch.length) {
            throw new Error(
              `Ollama returned ${embeddings.length} embeddings for a batch of ${batch.length} ` +
              `(table: ${tbl.name}, batch offset: ${i}). ` +
              `This may indicate a context-length overrun. Try reducing BATCH size or truncating long text fields.`
            );
          }

          for (let j = 0; j < batch.length; j++) {
            const vec = `[${embeddings[j].join(',')}]`;
            await client.query(tbl.updateSql, [vec, batch[j][tbl.idCol]]);
            done++;
            process.stdout.write(`\r  ${done}/${rows.length} embedded...`);
          }
        }
        console.log(`\n${c.green('Done.')} ${tbl.name}: ${done} entries embedded.`);
      } catch (err) {
        console.error(`\n${c.red(`Error embedding ${tbl.name}:`)} ${err.message}`);
        console.error(c.dim(`  ${done} rows written before failure. Re-run "index" to resume.`));
      }
      totalDone += done;
    }

    console.log(`\n${c.bold('Total:')} ${totalDone} entries embedded across all tables.`);
  } finally {
    await client.end();
  }
}

// ─── ADD TO INDEX ────────────────────────────────────────────────────────────

async function cmdAdd(filepath, description) {
  const client = await connect(CONFIG);
  try {
    if (!(await tableExists(client, 'code_index'))) {
      console.error(c.red('code_index table does not exist. Run: node pipeline-db.js setup'));
      return;
    }
    await client.query(
      `INSERT INTO code_index (path, description)
       VALUES ($1, $2)
       ON CONFLICT (path) DO UPDATE SET description = $2, embedding = NULL`,
      [filepath, description]
    );
    console.log(c.green(`Indexed: ${filepath}`));
    await tryEmbed(client, 'code_index', 'path', filepath,
      `File: ${filepath}\n\n${description}`, CONFIG);
    console.log(c.dim('Embedding generated (or will be backfilled with "index").'));
  } finally {
    await client.end();
  }
}

// ─── SEMANTIC SEARCH ─────────────────────────────────────────────────────────

async function cmdSearch(query) {
  console.log(`${c.bold('Semantic search:')} "${query}"\n`);

  const client = await connect(CONFIG);
  try {
    // Pre-check: is there anything to search?
    let anyEmbedded = false;
    for (const tbl of TABLES) {
      if (await hasAnyEmbeddings(client, tbl.name)) { anyEmbedded = true; break; }
    }
    if (!anyEmbedded) {
      console.log(c.yellow('No embeddings found across any table. Run "index" first.'));
      return;
    }

    const [qEmbedding] = await ollamaEmbed([query], CONFIG);
    const vec = `[${qEmbedding.join(',')}]`;

    let resultNum = 0;

    // ── v_memory_hits (chunked: memory + sessions + policy) ──
    const { rows: viewExists } = await client.query(
      "SELECT 1 FROM pg_views WHERE viewname = 'v_memory_hits' LIMIT 1"
    );
    if (!viewExists.length) {
      console.log(c.yellow('  (v_memory_hits view not found — run setup to enable chunked memory search)'));
    } else {
      const { rows: viewRows } = await client.query(
        `SELECT source_table, chunk_id, source_row_id, source_ordinal, chunk_idx, total_chunks, label, snippet,
                1 - (embedding <=> $1::vector) AS cosine_similarity
         FROM v_memory_hits
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 5`,
        [vec]
      );
      if (viewRows.length > 0) {
        console.log(c.bold('── memory (chunked: memory + sessions + policy) ──'));
        viewRows.forEach((row) => {
          resultNum++;
          const score = (row.cosine_similarity * 100).toFixed(1);
          const chunkLabel = row.total_chunks > 1
            ? ` (chunk ${row.chunk_idx + 1}/${row.total_chunks})`
            : '';
          const snippet = (row.snippet || '').substring(0, 120).replace(/\n/g, ' ');
          console.log(`${c.cyan(String(resultNum).padStart(2))}. ${c.bold(`[${row.source_table}] ${row.label}${chunkLabel}`)} ${c.dim(`(${score}%)`)}`);
          console.log(`    ${snippet}...\n`);
        });
      }
    }

    for (const tbl of TABLES) {
      if (MEMORY_HITS_COVERED.has(tbl.name)) continue;
      if (!(await tableExists(client, tbl.name))) continue;

      const { rows: [{ count }] } = await client.query(`SELECT COUNT(*) FROM ${tbl.name}`);
      if (parseInt(count) === 0) continue;

      if (!(await hasAnyEmbeddings(client, tbl.name))) continue;

      const { rows } = await client.query(
        `SELECT ${tbl.selectCols},
                1 - (embedding <=> $1::vector) AS cosine_similarity
         FROM ${tbl.name}
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 5`,
        [vec]
      );

      if (rows.length === 0) continue;

      console.log(c.bold(`── ${tbl.name} ──`));
      rows.forEach((row) => {
        resultNum++;
        const score = (row.cosine_similarity * 100).toFixed(1);
        const snippet = (tbl.snippet(row) || '').substring(0, 120).replace(/\n/g, ' ');
        console.log(`${c.cyan(String(resultNum).padStart(2))}. ${c.bold(tbl.label(row))} ${c.dim(`(${score}%)`)}`);
        console.log(`    ${snippet}...\n`);
      });
    }

    if (resultNum === 0) console.log(c.yellow('No results.'));
  } finally {
    await client.end();
  }
}

// ─── HYBRID SEARCH (FTS + vector) ───────────────────────────────────────────

async function cmdHybrid(query) {
  console.log(`${c.bold('Hybrid search:')} "${query}"\n`);

  const client = await connect(CONFIG);
  try {
    let resultNum = 0;
    let qEmb = null;

    // ── v_memory_hits (chunked: memory + sessions + policy) ──
    const { rows: viewExists } = await client.query(
      "SELECT 1 FROM pg_views WHERE viewname = 'v_memory_hits' LIMIT 1"
    );
    if (!viewExists.length) {
      console.log(c.yellow('  (v_memory_hits view not found — run setup to enable chunked memory search)'));
    } else {
      if (!qEmb) { [qEmb] = await ollamaEmbed([query], CONFIG); }
      const vec = `[${qEmb.join(',')}]`;
      const { rows: viewRows } = await client.query(
        `SELECT source_table, chunk_id, source_row_id, source_ordinal, chunk_idx, total_chunks, label, snippet,
                ts_rank(fts_vec, plainto_tsquery($1)) * 0.3 +
                (1 - (embedding <=> $2::vector)) * 0.7 AS score
         FROM v_memory_hits
         WHERE embedding IS NOT NULL
         ORDER BY score DESC
         LIMIT 5`,
        [query, vec]
      );
      if (viewRows.length > 0) {
        console.log(c.bold('── memory (chunked: memory + sessions + policy) ──'));
        viewRows.forEach((row) => {
          resultNum++;
          const chunkLabel = row.total_chunks > 1
            ? ` (chunk ${row.chunk_idx + 1}/${row.total_chunks})`
            : '';
          const snippet = (row.snippet || '').substring(0, 120).replace(/\n/g, ' ');
          console.log(`${c.cyan(String(resultNum).padStart(2))}. ${c.bold(`[${row.source_table}] ${row.label}${chunkLabel}`)} ${c.dim(`(${(row.score * 100).toFixed(1)}%)`)}`);
          console.log(`    ${snippet}...\n`);
        });
      }
    }

    for (const tbl of TABLES) {
      if (MEMORY_HITS_COVERED.has(tbl.name)) continue;
      if (!(await tableExists(client, tbl.name))) continue;

      const { rows: [{ count }] } = await client.query(`SELECT COUNT(*) FROM ${tbl.name}`);
      if (parseInt(count) === 0) continue;

      const hasEmb = await hasAnyEmbeddings(client, tbl.name);
      const hasFts = await columnExists(client, tbl.name, 'fts_vec');

      let rows;
      if (!hasEmb) {
        // FTS-only fallback
        if (!hasFts) continue;
        console.log(c.yellow(`  (${tbl.name}: no embeddings — keyword-only results)`));

        const result = await client.query(
          `SELECT ${tbl.selectCols},
                  ts_rank(fts_vec, plainto_tsquery($1)) AS score
           FROM ${tbl.name}
           WHERE fts_vec @@ plainto_tsquery($1)
           ORDER BY score DESC
           LIMIT 5`,
          [query]
        );
        rows = result.rows;
      } else if (!hasFts) {
        // Vector-only (fts_vec missing — schema not updated)
        console.log(c.yellow(`  (${tbl.name}: no fts_vec column — vector-only results. Run setup to enable hybrid.)`));
        if (!qEmb) { [qEmb] = await ollamaEmbed([query], CONFIG); }
        const vec = `[${qEmb.join(',')}]`;

        const result = await client.query(
          `SELECT ${tbl.selectCols},
                  1 - (embedding <=> $1::vector) AS score
           FROM ${tbl.name}
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT 5`,
          [vec]
        );
        rows = result.rows;
      } else {
        // Hybrid: 30% FTS + 70% vector
        if (!qEmb) { [qEmb] = await ollamaEmbed([query], CONFIG); }
        const vec = `[${qEmb.join(',')}]`;

        const result = await client.query(
          `SELECT ${tbl.selectCols},
                  ts_rank(fts_vec, plainto_tsquery($1)) * 0.3 +
                  (1 - (embedding <=> $2::vector)) * 0.7 AS score
           FROM ${tbl.name}
           WHERE embedding IS NOT NULL
           ORDER BY score DESC
           LIMIT 5`,
          [query, vec]
        );
        rows = result.rows;
      }

      if (!rows || rows.length === 0) continue;

      console.log(c.bold(`── ${tbl.name} ──`));
      rows.forEach((row) => {
        resultNum++;
        const snippet = (tbl.snippet(row) || '').substring(0, 120).replace(/\n/g, ' ');
        console.log(`${c.cyan(String(resultNum).padStart(2))}. ${c.bold(tbl.label(row))} ${c.dim(`(${(row.score * 100).toFixed(1)}%)`)}`);
        console.log(`    ${snippet}...\n`);
      });
    }

    if (resultNum === 0) console.log(c.yellow('No results.'));
  } finally {
    await client.end();
  }
}

// ─── STATS ──────────────────────────────────────────────────────────────────

async function cmdStats() {
  const client = await connect(CONFIG);
  try {
    console.log(`${c.bold('Embedding coverage:')}\n`);
    for (const tbl of TABLES) {
      if (!(await tableExists(client, tbl.name))) {
        console.log(`  ${tbl.name}: ${c.dim('table does not exist')}`);
        continue;
      }

      const { rows: [{ count: total }] } = await client.query(
        `SELECT COUNT(*) FROM ${tbl.name}`
      );

      if (!(await columnExists(client, tbl.name, 'embedding'))) {
        console.log(`  ${tbl.name}: ${total} rows, ${c.yellow('no embedding column')}`);
        continue;
      }

      const { rows: [{ count: embedded }] } = await client.query(
        `SELECT COUNT(*) FROM ${tbl.name} WHERE embedding IS NOT NULL`
      );

      const pct = parseInt(total) > 0 ? ((parseInt(embedded) / parseInt(total)) * 100).toFixed(0) : 0;
      const color = pct == 100 ? c.green : pct > 0 ? c.yellow : c.red;
      console.log(`  ${tbl.name}: ${color(`${embedded}/${total} embedded (${pct}%)`)}`);
    }
  } finally {
    await client.end();
  }
}

// ─── HELP ────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
${c.bold('pipeline-embed.js')} — Multi-table embedding index + semantic search
${c.dim(`Database: ${CONFIG.database} | Ollama: ${OLLAMA_HOST}:${OLLAMA_PORT} | Model: ${EMBED_MODEL}`)}
${c.dim(`Tables: ${TABLES.map(t => t.name).join(', ')}`)}

  ${c.cyan('index')}
      Embed all unembedded entries across all tables

  ${c.cyan('index --all')}
      Re-embed everything (force refresh)

  ${c.cyan('add')} <path> "<description>"
      Add or update a file in the code index

  ${c.cyan('search')} "<query>"
      Pure vector similarity search (all tables)

  ${c.cyan('hybrid')} "<query>"
      FTS + vector hybrid search (best results, all tables)

  ${c.cyan('stats')}
      Show embedding coverage per table

Requires: Ollama running at ${OLLAMA_HOST}:${OLLAMA_PORT}
  ollama pull ${EMBED_MODEL}
`);
}

// ─── ENTRY ───────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

(async () => {
  try {
    if (!cmd || cmd === 'help' || cmd === '--help') {
      help();
    } else if (cmd === 'index') {
      await cmdIndex(args[0] === '--all');
    } else if (cmd === 'add') {
      if (!args[0] || !args[1]) {
        console.error('Usage: add <path> "<description>"');
        process.exit(1);
      }
      await cmdAdd(args[0], args.slice(1).join(' '));
    } else if (cmd === 'search') {
      await cmdSearch(args.join(' '));
    } else if (cmd === 'hybrid') {
      await cmdHybrid(args.join(' '));
    } else if (cmd === 'stats') {
      await cmdStats();
    } else {
      console.error(`Unknown command: ${cmd}`);
      help();
      process.exit(1);
    }
  } catch (err) {
    console.error(c.red('Error: ') + err.message);
    process.exit(1);
  }
})();
