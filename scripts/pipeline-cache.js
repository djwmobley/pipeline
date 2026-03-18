#!/usr/bin/env node
/**
 * pipeline-cache.js — File hash cache + keyword search
 *
 * Prevents re-reading files that haven't changed. Also provides
 * full-text search over the code index for finding files by keyword.
 *
 * Reads connection config from .claude/pipeline.yml.
 *
 * Usage:
 *   node pipeline-cache.js check   <filepath>           # CACHE_HIT or CACHE_MISS
 *   node pipeline-cache.js update  <filepath> "<desc>"  # Cache a file
 *   node pipeline-cache.js search  "<terms>"            # FTS keyword search
 *   node pipeline-cache.js list                         # Show all cached files
 *   node pipeline-cache.js invalidate <filepath>        # Force re-read next time
 */

const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadConfig() {
  const root = findProjectRoot();
  const configPath = path.join(root, '.claude', 'pipeline.yml');
  const defaults = {
    host: 'localhost', port: 5432,
    database: 'pipeline_context', user: 'postgres',
  };

  if (!fs.existsSync(configPath)) return { ...defaults, root };

  const content = fs.readFileSync(configPath, 'utf8');
  const get = (key) => {
    const match = content.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?`, 'm'));
    return match ? match[1].trim() : null;
  };

  return {
    host: get('host') || defaults.host,
    port: parseInt(get('port') || defaults.port),
    database: get('database') || defaults.database,
    user: get('user') || defaults.user,
    root,
  };
}

const CONFIG = loadConfig();

async function connect() {
  const client = new Client({
    host: CONFIG.host, port: CONFIG.port,
    database: CONFIG.database, user: CONFIG.user,
  });
  await client.connect();
  return client;
}

// ─── ANSI ────────────────────────────────────────────────────────────────────

const c = {
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

function hashFile(filepath) {
  const abs = path.resolve(CONFIG.root, filepath);
  const buf = fs.readFileSync(abs);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const lines = buf.toString().split('\n').length;
  return { sha256, lines, abs };
}

// ─── CHECK ───────────────────────────────────────────────────────────────────

async function cmdCheck(filepath) {
  const client = await connect();
  try {
    let sha256;
    try {
      ({ sha256 } = hashFile(filepath));
    } catch {
      console.log('FILE_NOT_FOUND');
      return;
    }

    const r = await client.query(
      'SELECT summary, key_symbols FROM file_cache WHERE path = $1 AND sha256 = $2',
      [filepath, sha256]
    );

    if (r.rows.length > 0) {
      await client.query('UPDATE file_cache SET last_read = NOW() WHERE path = $1', [filepath]);
      const row = r.rows[0];
      const syms = row.key_symbols ? row.key_symbols.join(',') : '';
      console.log('CACHE_HIT');
      console.log(`SUMMARY:${row.summary}`);
      if (syms) console.log(`SYMBOLS:${syms}`);
    } else {
      const stale = await client.query('SELECT sha256 FROM file_cache WHERE path = $1', [filepath]);
      console.log(stale.rows.length > 0 ? 'CACHE_STALE' : 'CACHE_MISS');
    }
  } finally {
    await client.end();
  }
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

async function cmdUpdate(filepath, summary, symbolsArg) {
  const client = await connect();
  try {
    let sha256, lines;
    try {
      ({ sha256, lines } = hashFile(filepath));
    } catch {
      console.error(c.red(`File not found: ${filepath}`));
      process.exit(1);
    }

    const symbols = symbolsArg ? symbolsArg.split(',').map(s => s.trim()) : null;

    await client.query(
      `INSERT INTO file_cache (path, sha256, summary, key_symbols, line_count, last_read, last_changed)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (path) DO UPDATE SET
         sha256 = $2, summary = $3, key_symbols = $4, line_count = $5,
         last_read = NOW(), last_changed = NOW()`,
      [filepath, sha256, summary, symbols, lines]
    );
    console.log(c.green(`Cached: ${filepath} (${lines} lines, ${sha256.slice(0, 8)}...)`));
  } finally {
    await client.end();
  }
}

// ─── SEARCH ──────────────────────────────────────────────────────────────────

async function cmdSearch(terms) {
  const client = await connect();
  try {
    const r = await client.query(
      `SELECT path,
              ts_headline('english', description, plainto_tsquery($1),
                          'MaxWords=30, MinWords=10, StartSel=>, StopSel=<') AS snippet,
              ts_rank(fts_vec, plainto_tsquery($1)) AS rank
       FROM code_index
       WHERE fts_vec @@ plainto_tsquery($1)
       ORDER BY rank DESC
       LIMIT 8`,
      [terms]
    );

    if (r.rows.length === 0) {
      console.log(c.yellow(`No results for: "${terms}"`));
      return;
    }

    console.log(`\n${c.bold(`Code index search: "${terms}"`)}\n`);
    r.rows.forEach((row, i) => {
      console.log(`${c.cyan(String(i + 1).padStart(2))}. ${c.bold(row.path)}`);
      console.log(`    ${row.snippet.replace(/\n/g, ' ')}\n`);
    });
  } finally {
    await client.end();
  }
}

// ─── LIST ────────────────────────────────────────────────────────────────────

async function cmdList() {
  const client = await connect();
  try {
    const r = await client.query(
      `SELECT path, line_count, LEFT(sha256, 8) as hash, last_read, last_changed
       FROM file_cache ORDER BY path`
    );
    if (r.rows.length === 0) {
      console.log(c.yellow('Cache is empty.'));
      return;
    }
    console.log(`\n${c.bold('File cache')} (${r.rows.length} entries)\n`);
    r.rows.forEach(row => {
      const stale = row.last_changed > row.last_read ? c.yellow(' [stale?]') : '';
      console.log(`  ${c.dim(row.hash)}  ${String(row.line_count).padStart(5)}L  ${row.path}${stale}`);
    });
    console.log('');
  } finally {
    await client.end();
  }
}

// ─── INVALIDATE ──────────────────────────────────────────────────────────────

async function cmdInvalidate(filepath) {
  const client = await connect();
  try {
    const r = await client.query('DELETE FROM file_cache WHERE path = $1 RETURNING path', [filepath]);
    console.log(r.rowCount > 0 ? c.green(`Invalidated: ${filepath}`) : c.yellow(`Not in cache: ${filepath}`));
  } finally {
    await client.end();
  }
}

// ─── HELP ────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
${c.bold('pipeline-cache.js')} — File hash cache + keyword search
${c.dim(`Database: ${CONFIG.database} @ ${CONFIG.host}:${CONFIG.port}`)}

  ${c.cyan('check')}   <filepath>
      CACHE_HIT / CACHE_MISS / CACHE_STALE / FILE_NOT_FOUND

  ${c.cyan('update')}  <filepath> "<summary>" [sym1,sym2,...]
      Cache a file with its hash, summary, and key symbols

  ${c.cyan('search')}  "<search terms>"
      FTS keyword search over the code index

  ${c.cyan('list')}
      Show all cached files

  ${c.cyan('invalidate')} <filepath>
      Remove a file from cache (force re-read next time)
`);
}

// ─── ENTRY ───────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

(async () => {
  try {
    switch (cmd) {
      case 'check':      await cmdCheck(args[0]); break;
      case 'update':     await cmdUpdate(args[0], args[1], args[2]); break;
      case 'search':     await cmdSearch(args.join(' ')); break;
      case 'list':       await cmdList(); break;
      case 'invalidate': await cmdInvalidate(args[0]); break;
      default:
        help();
        if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
    }
  } catch (err) {
    console.error(c.red('Error: ') + err.message);
    process.exit(1);
  }
})();
