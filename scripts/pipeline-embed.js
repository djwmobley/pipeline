#!/usr/bin/env node
/**
 * pipeline-embed.js — Embedding index for code_index using Ollama
 *
 * Generates vector embeddings for file descriptions in code_index,
 * enabling semantic search across the codebase.
 *
 * Reads connection config from .claude/pipeline.yml.
 *
 * Usage:
 *   node pipeline-embed.js index              # Embed all unembedded entries
 *   node pipeline-embed.js index --all        # Re-embed everything
 *   node pipeline-embed.js search "<query>"   # Pure vector similarity search
 *   node pipeline-embed.js hybrid "<query>"   # FTS + vector hybrid search (best)
 *   node pipeline-embed.js add <path> "<desc>" # Add/update a file in the index
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

// ─── INDEX ───────────────────────────────────────────────────────────────────

async function cmdIndex(forceAll) {
  const client = await connect(CONFIG);
  try {
    const query = forceAll
      ? 'SELECT path, description FROM code_index ORDER BY path'
      : 'SELECT path, description FROM code_index WHERE embedding IS NULL ORDER BY path';
    const { rows } = await client.query(query);

    if (rows.length === 0) {
      console.log(c.green('All entries already embedded. Use --all to refresh.'));
      return;
    }

    console.log(`${c.bold('Embedding')} ${rows.length} code_index entries via ${EMBED_MODEL}...`);

    const BATCH = 32;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const texts = batch.map(r => `File: ${r.path}\n\n${r.description}`);
      const embeddings = await ollamaEmbed(texts);
      for (let j = 0; j < batch.length; j++) {
        const vec = `[${embeddings[j].join(',')}]`;
        await client.query(
          'UPDATE code_index SET embedding = $1 WHERE path = $2',
          [vec, batch[j].path]
        );
        done++;
        process.stdout.write(`\r  ${done}/${rows.length} embedded...`);
      }
    }
    console.log(`\n${c.green('Done.')} ${done} entries embedded.`);
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

  const client = await connect(CONFIG);
  try {
    const { rows: check } = await client.query(
      'SELECT COUNT(*) FROM code_index WHERE embedding IS NOT NULL'
    );
    if (parseInt(check[0].count) === 0) {
      console.log(c.yellow('No embeddings yet. Run: node pipeline-embed.js index'));
      return;
    }

    const vec = `[${qEmbedding.join(',')}]`;
    const { rows } = await client.query(
      `SELECT path, description,
              1 - (embedding <=> $1::vector) AS cosine_similarity
       FROM code_index
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 8`,
      [vec]
    );

    if (rows.length === 0) { console.log(c.yellow('No results.')); return; }

    rows.forEach((row, i) => {
      const score = (row.cosine_similarity * 100).toFixed(1);
      const snippet = row.description.substring(0, 120).replace(/\n/g, ' ');
      console.log(`${c.cyan(String(i + 1).padStart(2))}. ${c.bold(row.path)} ${c.dim(`(${score}%)`)}`);
      console.log(`    ${snippet}...\n`);
    });
  } finally {
    await client.end();
  }
}

// ─── HYBRID SEARCH (FTS + vector) ───────────────────────────────────────────

async function cmdHybrid(query) {
  const client = await connect(CONFIG);
  try {
    const { rows: check } = await client.query(
      'SELECT COUNT(*) FROM code_index WHERE embedding IS NOT NULL'
    );
    const hasEmbeddings = parseInt(check[0].count) > 0;

    if (!hasEmbeddings) {
      // FTS-only fallback
      console.log(c.dim('(no embeddings — using FTS only)'));
      const { rows } = await client.query(
        `SELECT path,
                ts_headline('english', description, plainto_tsquery($1),
                            'MaxWords=25, MinWords=8, StartSel=>, StopSel=<') AS snippet,
                ts_rank(fts_vec, plainto_tsquery($1)) AS rank
         FROM code_index WHERE fts_vec @@ plainto_tsquery($1)
         ORDER BY rank DESC LIMIT 8`,
        [query]
      );
      if (rows.length === 0) { console.log(c.yellow('No results.')); return; }
      rows.forEach((row, i) => {
        console.log(`${c.cyan(String(i + 1).padStart(2))}. ${c.bold(row.path)}`);
        console.log(`    ${row.snippet}\n`);
      });
      return;
    }

    // Hybrid: 30% FTS + 70% vector
    const [qEmb] = await ollamaEmbed([query]);
    const vec = `[${qEmb.join(',')}]`;
    const { rows } = await client.query(
      `SELECT path, description,
              ts_rank(fts_vec, plainto_tsquery($1)) * 0.3 +
              (1 - (embedding <=> $2::vector)) * 0.7 AS score
       FROM code_index
       WHERE embedding IS NOT NULL
       ORDER BY score DESC
       LIMIT 8`,
      [query, vec]
    );

    console.log(`${c.bold('Hybrid search:')} "${query}"\n`);
    rows.forEach((row, i) => {
      const snippet = row.description.substring(0, 120).replace(/\n/g, ' ');
      console.log(`${c.cyan(String(i + 1).padStart(2))}. ${c.bold(row.path)} ${c.dim(`(${(row.score * 100).toFixed(1)}%)`)}`);
      console.log(`    ${snippet}...\n`);
    });
  } finally {
    await client.end();
  }
}

// ─── HELP ────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
${c.bold('pipeline-embed.js')} — Code index + semantic search
${c.dim(`Database: ${CONFIG.database} | Ollama: ${OLLAMA_HOST}:${OLLAMA_PORT} | Model: ${EMBED_MODEL}`)}

  ${c.cyan('index')}
      Embed all unembedded code_index entries

  ${c.cyan('index --all')}
      Re-embed everything (force refresh)

  ${c.cyan('add')} <path> "<description>"
      Add or update a file in the code index

  ${c.cyan('search')} "<query>"
      Pure vector similarity search

  ${c.cyan('hybrid')} "<query>"
      FTS + vector hybrid search (best results)

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
