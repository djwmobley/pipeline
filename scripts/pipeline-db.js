#!/usr/bin/env node
/**
 * pipeline-db.js — Knowledge DB context helper for the pipeline plugin
 *
 * Reads connection config from .claude/pipeline.yml in the project root.
 * Falls back to localhost:5432/pipeline_<project_name> if no config found.
 *
 * Usage:
 *   node pipeline-db.js setup                                    # Create all tables
 *   node pipeline-db.js status                                   # Session context summary
 *   node pipeline-db.js update session <num> <tests> "<summary>" # Record a session
 *   node pipeline-db.js update task new "<title>" [phase] [issue] # Create a task
 *   node pipeline-db.js update task <id> <status>                # Update task status
 *   node pipeline-db.js update gotcha new "<issue>" "<rule>"     # Add a gotcha
 *   node pipeline-db.js query "<SQL>"                            # Run raw SQL
 *   node pipeline-db.js export [file]                            # Export gotchas + decisions to JSON
 *   node pipeline-db.js import <file_or_db> [--all]              # Import from JSON file or another project DB
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { loadConfig, connect, c } = require('./lib/shared');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = loadConfig();

function statusIcon(status) {
  return {
    done: c.green('✓'),
    in_progress: c.yellow('→'),
    pending: c.dim('○'),
    deferred: c.dim('…'),
  }[status] ?? '?';
}

// ─── SETUP ───────────────────────────────────────────────────────────────────

async function cmdSetup() {
  // First ensure the database exists
  const adminClient = new Client({
    host: CONFIG.host,
    port: CONFIG.port,
    database: 'postgres',
    user: CONFIG.user,
  });

  try {
    await adminClient.connect();
    const { rows } = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [CONFIG.database]
    );
    if (rows.length === 0) {
      await adminClient.query(`CREATE DATABASE "${CONFIG.database}"`);
      console.log(c.green(`Database "${CONFIG.database}" created.`));
    } else {
      console.log(c.dim(`Database "${CONFIG.database}" already exists.`));
    }
  } finally {
    await adminClient.end();
  }

  // Now run the setup SQL
  const client = await connect(CONFIG);
  try {
    const sqlPath = path.join(__dirname, 'setup-knowledge-db.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(sql);
    console.log(c.green('All tables and views created successfully.'));

    // Verify
    const { rows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    console.log(`\n${c.bold('Tables:')}`);
    rows.forEach(r => console.log(`  ${c.cyan('✓')} ${r.tablename}`));
  } finally {
    await client.end();
  }
}

// ─── STATUS ──────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const client = await connect(CONFIG);
  try {
    const sessions = await client.query('SELECT num, date, summary, tests FROM sessions ORDER BY num DESC LIMIT 3');
    const tasks = await client.query("SELECT id, title, status, github_issue, phase FROM tasks WHERE status NOT IN ('done', 'deferred') ORDER BY id");
    const gotchas = await client.query('SELECT issue, rule FROM gotchas WHERE active = TRUE ORDER BY id');

    console.log('\n' + c.bold(`═══ ${CONFIG.project} — Session Context ═══`));

    // Latest session
    if (sessions.rows.length > 0) {
      const fmtDate = (d) => new Date(d).toISOString().slice(0, 10);
      const latest = sessions.rows[0];
      console.log(`\n${c.bold('Last session:')} #${latest.num}  ${c.dim(fmtDate(latest.date))}  ${c.cyan(latest.tests + ' tests')}`);
      console.log(`  ${(latest.summary || '').replace(/\n/g, '\n  ')}`);

      if (sessions.rows.length > 1) {
        console.log(`\n${c.bold('Previous sessions:')}`);
        sessions.rows.slice(1).forEach(s => {
          console.log(`  #${s.num} ${c.dim(fmtDate(s.date))}  ${(s.summary || '').split('\n')[0].substring(0, 80)}`);
        });
      }
    } else {
      console.log(`\n${c.dim('No sessions recorded yet.')}`);
    }

    // Active tasks
    console.log(`\n${c.bold('Open tasks:')}`);
    if (tasks.rows.length === 0) {
      console.log(`  ${c.green('No open tasks.')}`);
    } else {
      tasks.rows.forEach(t => {
        const issue = t.github_issue ? c.dim(` #${t.github_issue}`) : '';
        console.log(`  ${statusIcon(t.status)} [${t.id}] ${t.title}${issue}`);
      });
    }

    // Gotchas
    if (gotchas.rows.length > 0) {
      console.log(`\n${c.bold('Critical gotchas:')}`);
      gotchas.rows.forEach(g => {
        console.log(`  ${c.red('!')} ${c.bold(g.issue)}`);
        console.log(`    ${g.rule.replace(/\n/g, '\n    ')}`);
      });
    }

    console.log('');
  } finally {
    await client.end();
  }
}

// ─── UPDATE ──────────────────────────────────────────────────────────────────

async function cmdUpdate(args) {
  const client = await connect(CONFIG);
  try {
    const [entity, ...rest] = args;

    if (entity === 'session') {
      const [num, tests, ...summaryParts] = rest;
      const summary = summaryParts.join(' ');
      if (!num || tests === undefined || !summary) {
        console.error('Usage: update session <num> <tests> "<summary>"');
        process.exit(1);
      }
      await client.query(
        `INSERT INTO sessions (num, date, summary, tests, project)
         VALUES ($1, CURRENT_DATE, $2, $3, $4)
         ON CONFLICT (num) DO UPDATE SET date=CURRENT_DATE, summary=$2, tests=$3, project=$4`,
        [parseInt(num), summary, parseInt(tests), CONFIG.project]
      );
      console.log(c.green(`Session #${num} saved (${tests} tests).`));

    } else if (entity === 'task') {
      const [idOrNew, ...taskRest] = rest;

      if (idOrNew === 'new') {
        const [title, phase = 'backlog', issueRaw] = taskRest;
        const issue = issueRaw ? parseInt(issueRaw) : null;
        if (!title) {
          console.error('Usage: update task new "<title>" [phase] [issue_num]');
          process.exit(1);
        }
        const r = await client.query(
          'INSERT INTO tasks (title, status, phase, github_issue) VALUES ($1, $2, $3, $4) RETURNING id',
          [title, 'pending', phase, issue]
        );
        console.log(c.green(`Task #${r.rows[0].id} "${title}" created.`));
      } else {
        const [status] = taskRest;
        const valid = ['pending', 'in_progress', 'done', 'deferred'];
        if (!valid.includes(status)) {
          console.error(`Status must be one of: ${valid.join(', ')}`);
          process.exit(1);
        }
        const r = await client.query(
          'UPDATE tasks SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING title',
          [status, parseInt(idOrNew)]
        );
        if (r.rowCount === 0) {
          console.error(`Task #${idOrNew} not found.`);
          process.exit(1);
        }
        console.log(c.green(`Task #${idOrNew} "${r.rows[0].title}" → ${status}`));
      }

    } else if (entity === 'gotcha') {
      const [subCmd, issue, rule] = rest;
      if (subCmd !== 'new' || !issue || !rule) {
        console.error('Usage: update gotcha new "<issue>" "<rule>"');
        process.exit(1);
      }
      await client.query('INSERT INTO gotchas (issue, rule) VALUES ($1, $2)', [issue, rule]);
      console.log(c.green(`Gotcha "${issue}" saved.`));

    } else {
      console.error(`Unknown entity "${entity}". Use: session | task | gotcha`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

// ─── RAW QUERY ───────────────────────────────────────────────────────────────

async function cmdQuery(sql) {
  const client = await connect(CONFIG);
  try {
    const r = await client.query(sql);
    if (r.rows && r.rows.length > 0) {
      console.table(r.rows);
    } else {
      console.log(c.dim(`Query OK (${r.rowCount ?? 0} rows affected).`));
    }
  } finally {
    await client.end();
  }
}

// ─── EXPORT ─────────────────────────────────────────────────────────────────

async function cmdExport(args) {
  const outFile = args[0] || `pipeline-export-${CONFIG.project}.json`;
  const client = await connect(CONFIG);
  try {
    const gotchas = await client.query('SELECT issue, rule, active FROM gotchas ORDER BY id');
    const decisions = await client.query('SELECT topic, decision, reason, created_at FROM decisions ORDER BY id');

    const exportData = {
      _meta: {
        version: 1,
        source_project: CONFIG.project,
        source_database: CONFIG.database,
        exported_at: new Date().toISOString(),
      },
      gotchas: gotchas.rows,
      decisions: decisions.rows,
    };

    fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2));
    console.log(c.green(`Exported ${gotchas.rows.length} gotchas + ${decisions.rows.length} decisions → ${outFile}`));
  } finally {
    await client.end();
  }
}

// ─── IMPORT ─────────────────────────────────────────────────────────────────

async function cmdImport(args) {
  const source = args[0];
  const importAll = args.includes('--all');

  if (!source) {
    console.error('Usage: import <file.json | database_name> [--all]');
    console.error('  file.json     — Import from a pipeline export file');
    console.error('  database_name — Import directly from another project\'s pipeline DB');
    process.exit(1);
  }

  let importData;

  if (source.endsWith('.json') || fs.existsSync(source)) {
    // Import from JSON file
    const raw = fs.readFileSync(source, 'utf8');
    importData = JSON.parse(raw);
    if (!importData._meta || importData._meta.version !== 1) {
      console.error('Invalid export file — missing _meta or wrong version.');
      process.exit(1);
    }
    console.log(c.dim(`Importing from ${importData._meta.source_project} (exported ${importData._meta.exported_at})`));
  } else {
    // Import directly from another project's database
    const sourceClient = new Client({
      host: CONFIG.host,
      port: CONFIG.port,
      database: source,
      user: CONFIG.user,
    });
    try {
      await sourceClient.connect();
      const gotchas = await sourceClient.query('SELECT issue, rule, active FROM gotchas ORDER BY id');
      const decisions = await sourceClient.query('SELECT topic, decision, reason, created_at FROM decisions ORDER BY id');
      importData = {
        _meta: { source_project: source, source_database: source },
        gotchas: gotchas.rows,
        decisions: decisions.rows,
      };
      console.log(c.dim(`Read ${gotchas.rows.length} gotchas + ${decisions.rows.length} decisions from DB "${source}"`));
    } finally {
      await sourceClient.end();
    }
  }

  // Preview what will be imported
  console.log(`\n${c.bold('Available to import:')}`);
  console.log(`  ${c.cyan('Gotchas:')} ${importData.gotchas.length}`);
  importData.gotchas.forEach(g => console.log(`    ${c.red('!')} ${g.issue}`));
  console.log(`  ${c.cyan('Decisions:')} ${importData.decisions.length}`);
  importData.decisions.forEach(d => console.log(`    ${c.dim('•')} ${d.topic}: ${d.decision}`));

  if (!importAll) {
    console.log(`\n${c.yellow('Dry run — no changes made.')}`);
    console.log(`Re-run with ${c.bold('--all')} to import everything, or use the output above to pick specific items.`);
    console.log(`Example: node pipeline-db.js query "INSERT INTO gotchas (issue, rule) VALUES ('...', '...')"`);
    return;
  }

  // Actually import
  const client = await connect(CONFIG);
  try {
    let gotchaCount = 0;
    for (const g of importData.gotchas) {
      // Skip duplicates by checking issue text
      const existing = await client.query('SELECT 1 FROM gotchas WHERE issue = $1', [g.issue]);
      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO gotchas (issue, rule, active) VALUES ($1, $2, $3)',
          [g.issue, g.rule, g.active !== false]
        );
        gotchaCount++;
      }
    }

    let decisionCount = 0;
    for (const d of importData.decisions) {
      const existing = await client.query('SELECT 1 FROM decisions WHERE topic = $1 AND decision = $2', [d.topic, d.decision]);
      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO decisions (topic, decision, reason) VALUES ($1, $2, $3)',
          [d.topic, d.decision, d.reason]
        );
        decisionCount++;
      }
    }

    console.log(c.green(`\nImported ${gotchaCount} gotchas + ${decisionCount} decisions (duplicates skipped).`));
  } finally {
    await client.end();
  }
}

// ─── HELP ────────────────────────────────────────────────────────────────────

function help() {
  console.log(`
${c.bold('pipeline-db.js')} — Pipeline knowledge DB helper
${c.dim(`Database: ${CONFIG.database} @ ${CONFIG.host}:${CONFIG.port}`)}

  ${c.cyan('setup')}
      Create database and all tables (idempotent)

  ${c.cyan('status')}
      Print session context (last 3 sessions, open tasks, gotchas)

  ${c.cyan('update session')} <num> <tests> "<summary>"
      Insert or replace a session record

  ${c.cyan('update task new')} "<title>" [phase] [github_issue_num]
      Add a new task

  ${c.cyan('update task')} <id> <status>
      Update task status (pending | in_progress | done | deferred)

  ${c.cyan('update gotcha new')} "<issue>" "<rule>"
      Add a critical gotcha

  ${c.cyan('query')} "<SQL>"
      Run raw SQL and print results

  ${c.cyan('export')} [file.json]
      Export gotchas + decisions to JSON (default: pipeline-export-<project>.json)

  ${c.cyan('import')} <file.json | database_name> [--all]
      Preview import from file or another project's DB
      Add --all to actually import (duplicates are skipped)
`);
}

// ─── ENTRY ───────────────────────────────────────────────────────────────────

const [, , cmd, ...rest] = process.argv;

(async () => {
  try {
    if (!cmd || cmd === 'help' || cmd === '--help') {
      help();
    } else if (cmd === 'setup') {
      await cmdSetup();
    } else if (cmd === 'status') {
      await cmdStatus();
    } else if (cmd === 'update') {
      await cmdUpdate(rest);
    } else if (cmd === 'query') {
      await cmdQuery(rest.join(' '));
    } else if (cmd === 'export') {
      await cmdExport(rest);
    } else if (cmd === 'import') {
      await cmdImport(rest);
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
