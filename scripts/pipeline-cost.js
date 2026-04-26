#!/usr/bin/env node
/**
 * pipeline-cost.js — Per-feature token-usage tracker.
 *
 * Mines Claude Code transcripts (~/.claude/projects/<encoded-cwd>/*.jsonl) for
 * per-branch token counts, cache efficiency, and tool-call patterns. Writes to
 * the `feature_token_usage` table in the project's pipeline_* DB.
 *
 * No USD cost is stored — Claude Max is flat-rate. The signal is relative
 * token volume across features, cache-hit ratio, and tool-call distribution,
 * for identifying cache-inefficient or tool-heavy patterns.
 *
 * Subcommands:
 *   session-total                                          — current-session totals
 *   feature-total --branch <name> [--since ISO] [--until ISO]  — per-branch aggregate
 *   trailer --branch <name>                                — emit commit-trailer lines
 *   record --branch <name> [--pr N] [--issue M] [--notes <text>]  — insert DB row
 *
 * Usage examples:
 *   node pipeline-cost.js feature-total --branch feat/foo
 *   node pipeline-cost.js trailer --branch feat/foo >> COMMIT_EDITMSG
 *   node pipeline-cost.js record --branch feat/foo --pr 101 --issue 100
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig, connect } = require('./lib/shared');

// ─── TRANSCRIPT RESOLUTION ─────────────────────────────────────────────────

function transcriptDir() {
  // Claude Code encodes the cwd into a directory name under ~/.claude/projects/.
  // Example: C:\Users\djwmo\dev\pipeline → C--Users-djwmo-dev-pipeline
  // Rule: every char that's not alphanumeric and not "-" becomes "-". That maps
  // ":", "\", "/", "." all to "-" and produces the double-dash after drive letters.
  const home = os.homedir();
  const cwd = process.cwd();
  const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(home, '.claude', 'projects', encoded);
}

function listTranscripts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f));
}

// ─── AGGREGATION ───────────────────────────────────────────────────────────

function emptyAgg() {
  return {
    branch: null,
    msgs: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    cache_read_tokens: 0,
    started_at: null,
    completed_at: null,
    model: null,
    session_ids: new Set(),
    tool_calls: {},
  };
}

function addMessage(agg, d) {
  const msg = d.message || {};
  const u = msg.usage || {};
  const cc = u.cache_creation || {};
  agg.msgs += 1;
  agg.input_tokens += u.input_tokens || 0;
  agg.output_tokens += u.output_tokens || 0;
  agg.cache_creation_5m_tokens += cc.ephemeral_5m_input_tokens || 0;
  agg.cache_creation_1h_tokens += cc.ephemeral_1h_input_tokens || 0;
  agg.cache_read_tokens += u.cache_read_input_tokens || 0;
  const ts = d.timestamp || null;
  if (ts) {
    if (!agg.started_at || ts < agg.started_at) agg.started_at = ts;
    if (!agg.completed_at || ts > agg.completed_at) agg.completed_at = ts;
  }
  if (d.sessionId) agg.session_ids.add(d.sessionId);
  if (msg.model && !agg.model) agg.model = msg.model;
  for (const block of msg.content || []) {
    if (block && typeof block === 'object' && block.type === 'tool_use' && block.name) {
      agg.tool_calls[block.name] = (agg.tool_calls[block.name] || 0) + 1;
    }
  }
}

function finalizeAgg(agg) {
  const inputSide =
    agg.input_tokens +
    agg.cache_creation_5m_tokens +
    agg.cache_creation_1h_tokens +
    agg.cache_read_tokens;
  const cache_hit_pct = inputSide === 0 ? null : Number(((agg.cache_read_tokens / inputSide) * 100).toFixed(2));
  return {
    branch: agg.branch,
    msgs: agg.msgs,
    input_tokens: agg.input_tokens,
    output_tokens: agg.output_tokens,
    cache_creation_5m_tokens: agg.cache_creation_5m_tokens,
    cache_creation_1h_tokens: agg.cache_creation_1h_tokens,
    cache_read_tokens: agg.cache_read_tokens,
    cache_hit_pct,
    started_at: agg.started_at,
    completed_at: agg.completed_at,
    model: agg.model,
    session_ids: [...agg.session_ids],
    tool_calls: agg.tool_calls,
  };
}

function aggregate(filterFn) {
  const agg = emptyAgg();
  for (const file of listTranscripts(transcriptDir())) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d.type !== 'assistant') continue;
      if (!filterFn(d)) continue;
      addMessage(agg, d);
    }
  }
  return finalizeAgg(agg);
}

// ─── FORMATTING ─────────────────────────────────────────────────────────────

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function topTools(tool_calls, n = 6) {
  return Object.entries(tool_calls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => `${name}=${count}`)
    .join(' ');
}

function emitTrailer(result) {
  const lines = [];
  const readStr = fmtTokens(result.cache_read_tokens);
  const cwStr =
    result.cache_creation_1h_tokens > 0
      ? `${fmtTokens(result.cache_creation_1h_tokens)}-cw1h`
      : result.cache_creation_5m_tokens > 0
      ? `${fmtTokens(result.cache_creation_5m_tokens)}-cw5m`
      : '0-cw';
  lines.push(`Tokens: ${readStr}-read ${cwStr} ${fmtTokens(result.output_tokens)}-out`);
  lines.push(`Cache: ${result.cache_hit_pct !== null ? result.cache_hit_pct.toFixed(1) + '%' : 'n/a'}`);
  const tools = topTools(result.tool_calls);
  lines.push(`Tools: ${tools || '(none)'}`);
  lines.push(`Model: ${result.model || 'unknown'}`);
  lines.push(`Msgs: ${result.msgs}`);
  return lines.join('\n');
}

// ─── ARG PARSING ────────────────────────────────────────────────────────────

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

// ─── SUBCOMMANDS ────────────────────────────────────────────────────────────

function cmdSessionTotal() {
  // Use the most recently modified transcript as "current session".
  const dir = transcriptDir();
  const files = listTranscripts(dir);
  if (files.length === 0) {
    process.stderr.write(`No transcripts found at ${dir}\n`);
    process.exit(1);
  }
  const mostRecent = files
    .map((f) => ({ f, mtime: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;
  const targetSessionId = path.basename(mostRecent, '.jsonl');
  const result = aggregate((d) => d.sessionId === targetSessionId);
  result.session_ids = [targetSessionId];
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function cmdFeatureTotal(flags) {
  const branch = flags.branch;
  if (!branch) {
    process.stderr.write('feature-total requires --branch <name>\n');
    process.exit(1);
  }
  const since = flags.since || null;
  const until = flags.until || null;
  const result = aggregate((d) => {
    if (d.gitBranch !== branch) return false;
    if (since && d.timestamp && d.timestamp < since) return false;
    if (until && d.timestamp && d.timestamp > until) return false;
    return true;
  });
  result.branch = branch;
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function cmdTrailer(flags) {
  const branch = flags.branch;
  if (!branch) {
    process.stderr.write('trailer requires --branch <name>\n');
    process.exit(1);
  }
  const result = aggregate((d) => d.gitBranch === branch);
  result.branch = branch;
  if (result.msgs === 0) {
    process.stderr.write(`No assistant messages found for branch '${branch}' in local transcripts.\n`);
    process.exit(1);
  }
  process.stdout.write(emitTrailer(result) + '\n');
}

async function cmdRecord(flags) {
  const branch = flags.branch;
  if (!branch) {
    process.stderr.write('record requires --branch <name>\n');
    process.exit(1);
  }
  const since = flags.since || null;
  const until = flags.until || null;
  const result = aggregate((d) => {
    if (d.gitBranch !== branch) return false;
    if (since && d.timestamp && d.timestamp < since) return false;
    if (until && d.timestamp && d.timestamp > until) return false;
    return true;
  });
  if (result.msgs === 0) {
    process.stderr.write(`No assistant messages found for branch '${branch}' in local transcripts. Skipping insert.\n`);
    process.exit(1);
  }
  const pr = flags.pr ? parseInt(flags.pr, 10) : null;
  const issue = flags.issue ? parseInt(flags.issue, 10) : null;
  const notes = typeof flags.notes === 'string' ? flags.notes : null;

  const config = loadConfig();
  if (config.knowledge.tier !== 'postgres') {
    process.stderr.write(`knowledge.tier is '${config.knowledge.tier}', not 'postgres' — skipping DB insert.\n`);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  const client = await connect(config);
  try {
    const { rows } = await client.query(
      `INSERT INTO feature_token_usage
         (branch, pr_number, github_issue, started_at, completed_at, model,
          assistant_msgs, input_tokens, output_tokens,
          cache_creation_5m_tokens, cache_creation_1h_tokens, cache_read_tokens,
          cache_hit_pct, tool_calls, session_ids, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        branch,
        pr,
        issue,
        result.started_at,
        result.completed_at,
        result.model,
        result.msgs,
        result.input_tokens,
        result.output_tokens,
        result.cache_creation_5m_tokens,
        result.cache_creation_1h_tokens,
        result.cache_read_tokens,
        result.cache_hit_pct,
        JSON.stringify(result.tool_calls),
        result.session_ids,
        notes,
      ]
    );
    process.stdout.write(`Inserted feature_token_usage id=${rows[0].id}\n`);
    process.stdout.write(emitTrailer(result) + '\n');
  } finally {
    await client.end();
  }
}

// ─── DISPATCH ───────────────────────────────────────────────────────────────

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (subcommand) {
    case 'session-total':
      cmdSessionTotal();
      break;
    case 'feature-total':
      cmdFeatureTotal(flags);
      break;
    case 'trailer':
      cmdTrailer(flags);
      break;
    case 'record':
      await cmdRecord(flags);
      break;
    default:
      process.stderr.write(
        `Usage: node pipeline-cost.js <subcommand> [options]\n` +
        `  session-total\n` +
        `  feature-total --branch <name> [--since <ISO-ts>] [--until <ISO-ts>]\n` +
        `  trailer       --branch <name>\n` +
        `  record        --branch <name> [--pr N] [--issue M] [--notes <text>] [--since <ISO-ts>] [--until <ISO-ts>]\n`
      );
      process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`pipeline-cost: ${e.message.split('\n')[0]}\n`);
  process.exit(1);
});
