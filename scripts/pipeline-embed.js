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

const http = require('http');
const { loadConfig, connect, c, ollamaDefaults } = require('./lib/shared');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = loadConfig();
const OLLAMA_HOST = ollamaDefaults.host;
const OLLAMA_PORT = ollamaDefaults.port;
const EMBED_MODEL = CONFIG.embedding_model || ollamaDefaults.model;

// ─── TABLE DEFINITIONS ──────────────────────────────────────────────────────
// Each entry defines how to read, embed, and search a table.

const TABLES = [
  {
    name: 'code_index',
    idCol: 'path',
    textFn: (r) => `File: ${r.path}\n\n${r.description}`,
    selectCols: 'path, description',
    updateSql: 'UPDATE code_index SET embedding = $1 WHERE path = $2',
    label: (r) => r.path,
    snippet: (r) => r.description,
    ftsCol: 'fts_vec',
    ftsTarget: 'description',
  },
  {
    name: 'workflow_discovery',
    idCol: 'id',
    textFn: (r) => `[${r.item_type}] ${r.step || 'general'}: ${r.title}\n\n${r.detail || ''}`,
    selectCols: 'id, step, item_type, title, detail',
    updateSql: 'UPDATE workflow_discovery SET embedding = $1 WHERE id = $2',
    label: (r) => `[${r.item_type}] ${r.step || 'general'}: ${r.title}`,
    snippet: (r) => r.detail || r.title,
    ftsCol: 'fts_vec',
    ftsTarget: "coalesce(title, '') || ' ' || coalesce(detail, '')",
  },
  {
    name: 'agent_rewrites',
    idCol: 'id',
    textFn: (r) => `Agent: ${r.agent_name}\nAS-IS: ${r.as_is || ''}\nTO-BE: ${r.to_be || ''}\nGap: ${r.gap || ''}\nEffort: ${r.effort || ''}`,
    selectCols: 'id, agent_name, as_is, to_be, gap, effort',
    updateSql: 'UPDATE agent_rewrites SET embedding = $1 WHERE id = $2',
    label: (r) => `agent: ${r.agent_name} (${r.effort || '?'})`,
    snippet: (r) => r.gap || r.to_be || r.agent_name,
    ftsCol: 'fts_vec',
    ftsTarget: "coalesce(agent_name, '') || ' ' || coalesce(as_is, '') || ' ' || coalesce(to_be, '') || ' ' || coalesce(gap, '')",
  },
];

// ─── OLLAMA EMBED API ────────────────────────────────────────────────────────

function ollamaEmbed(texts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: EMBED_MODEL, input: texts });
    const opts = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/embed',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.embeddings) return reject(new Error(`Ollama error: ${JSON.stringify(parsed).slice(0, 200)}`));
          resolve(parsed.embeddings);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => {
      reject(new Error(`Cannot reach Ollama at ${OLLAMA_HOST}:${OLLAMA_PORT} — is it running? (${e.message})`));
    });
    req.write(body);
    req.end();
  });
}

// ─── CHECK TABLE EXISTS ─────────────────────────────────────────────────────

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = $1",
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(client, tableName, colName) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
    [tableName, colName]
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
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const texts = batch.map(tbl.textFn);
        const embeddings = await ollamaEmbed(texts);
        for (let j = 0; j < batch.length; j++) {
          const vec = `[${embeddings[j].join(',')}]`;
          await client.query(tbl.updateSql, [vec, batch[j][tbl.idCol]]);
          done++;
          process.stdout.write(`\r  ${done}/${rows.length} embedded...`);
        }
      }
      console.log(`\n${c.green('Done.')} ${tbl.name}: ${done} entries embedded.`);
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
    await client.query(
      `INSERT INTO code_index (path, description)
       VALUES ($1, $2)
       ON CONFLICT (path) DO UPDATE SET description = $2, embedding = NULL`,
      [filepath, description]
    );
    console.log(c.green(`Indexed: ${filepath}`));
    console.log(c.dim('Run "index" to generate embedding for this entry.'));
  } finally {
    await client.end();
  }
}

// ─── SEMANTIC SEARCH ─────────────────────────────────────────────────────────

async function cmdSearch(query) {
  console.log(`${c.bold('Semantic search:')} "${query}"\n`);

  const [qEmbedding] = await ollamaEmbed([query]);
  const vec = `[${qEmbedding.join(',')}]`;

  const client = await connect(CONFIG);
  try {
    let resultNum = 0;

    for (const tbl of TABLES) {
      if (!(await tableExists(client, tbl.name))) continue;
      if (!(await columnExists(client, tbl.name, 'embedding'))) continue;

      const { rows: check } = await client.query(
        `SELECT COUNT(*) FROM ${tbl.name} WHERE embedding IS NOT NULL`
      );
      if (parseInt(check[0].count) === 0) continue;

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
        const snippet = tbl.snippet(row).substring(0, 120).replace(/\n/g, ' ');
        console.log(`${c.cyan(String(resultNum).padStart(2))}. ${c.bold(tbl.label(row))} ${c.dim(`(${score}%)`)}`);
        console.log(`    ${snippet}...\n`);
      });
    }

    if (resultNum === 0) console.log(c.yellow('No results. Run "index" first.'));
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

    for (const tbl of TABLES) {
      if (!(await tableExists(client, tbl.name))) continue;

      const hasEmbeddings = (await columnExists(client, tbl.name, 'embedding'))
        && parseInt((await client.query(
            `SELECT COUNT(*) FROM ${tbl.name} WHERE embedding IS NOT NULL`
          )).rows[0].count) > 0;

      let rows;
      if (!hasEmbeddings) {
        // FTS-only fallback
        const hasFts = await columnExists(client, tbl.name, 'fts_vec');
        if (!hasFts) continue;

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
      } else {
        // Hybrid: 30% FTS + 70% vector
        if (!qEmb) {
          [qEmb] = await ollamaEmbed([query]);
        }
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
        const snippet = tbl.snippet(row).substring(0, 120).replace(/\n/g, ' ');
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
