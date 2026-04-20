#!/usr/bin/env node
// pipeline-init-knowledge.js — Windows-safe knowledge-tier setup for commands/init.md Step 4.
// Extracts the deterministic orchestration (pnpm install, db setup, verify, ollama pull,
// post-commit hook wiring) from the inline bash. Engagement-variant prompts in init.md stay
// inline — this script handles mechanics only, emits structured JSON on stdout for the caller
// to parse and report.
//
// Subcommands:
//   setup-postgres  — end-to-end Postgres tier setup
//   setup-files     — create docs/sessions, docs/specs, docs/plans
//
// Exit codes: 0 on success; 1 on unrecoverable failure with one-line stderr naming the step.

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const { projectToDbName } = require('./lib/shared');

const SCRIPTS_DIR = __dirname;
const CALLER_CWD = process.cwd();

// ─── ARG PARSING ───────────────────────────────────────────────────────────

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

// ─── PNPM INVOCATION ───────────────────────────────────────────────────────
// On Windows, pnpm is typically a .cmd shim (npm-installed) or .exe (standalone).
// Node's execFileSync with shell:false does not resolve PATHEXT, so the bare name
// fails with ENOENT. Try .cmd first (common case on Windows), fall back to .exe,
// fall back to bare name. On non-Windows, bare name works.
function runPnpm(args, opts) {
  const isWindows = process.platform === 'win32';
  const candidates = isWindows ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm'];
  let lastErr;
  for (const bin of candidates) {
    try {
      return execFileSync(bin, args, opts);
    } catch (e) {
      lastErr = e;
      if (e.code !== 'ENOENT') throw e;
    }
  }
  throw lastErr;
}

// ─── OLLAMA REACHABILITY ───────────────────────────────────────────────────

function probeOllama(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const req = http.get(
      { host: 'localhost', port: 11434, path: '/api/version', timeout: timeoutMs },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => finish(res.statusCode === 200));
      }
    );
    req.once('timeout', () => { req.destroy(); finish(false); });
    req.once('error', () => finish(false));
  });
}

// ─── IDEMPOTENCY PROBE ─────────────────────────────────────────────────────
// Connect to the admin `postgres` database. If the target DB exists AND already
// has the `sessions` table, we consider the project already set up and short-
// circuit setup-postgres without re-running pnpm install or pipeline-db.js setup.

async function probeAlreadySetUp(dbName) {
  const admin = new Client({
    host: 'localhost', port: 5432, database: 'postgres', user: 'postgres',
  });
  try {
    await admin.connect();
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) return false;
  } finally {
    await admin.end();
  }
  const project = new Client({
    host: 'localhost', port: 5432, database: dbName, user: 'postgres',
  });
  try {
    await project.connect();
    const { rows } = await project.query(
      "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'sessions'"
    );
    return rows.length > 0;
  } finally {
    await project.end();
  }
}

// ─── SETUP-POSTGRES ────────────────────────────────────────────────────────

async function setupPostgres(flags) {
  const log = [];
  const projectName = flags['project-name'];
  if (!projectName) {
    process.stderr.write('init-knowledge: setup-postgres requires --project-name\n');
    process.exit(1);
  }

  const dbName = projectToDbName(projectName);
  const postCommitHook = 'node $SCRIPTS_DIR/pipeline-embed.js index';

  // Step 1: idempotency probe.
  let alreadySetUp = false;
  try {
    alreadySetUp = await probeAlreadySetUp(dbName);
    log.push({ step: 'idempotency-probe', status: 'ok', already_set_up: alreadySetUp });
  } catch (e) {
    log.push({ step: 'idempotency-probe', status: 'failed', error: e.message.split('\n')[0] });
  }

  if (alreadySetUp) {
    process.stdout.write(JSON.stringify({
      tier: 'postgres',
      db_name: dbName,
      already_set_up: true,
      deps_installed: null,
      embedding_model: flags['embedding-model'] || null,
      ollama_pull_result: 'skipped',
      post_commit_hook: postCommitHook,
      log,
    }, null, 2) + '\n');
    return;
  }

  if (flags['dry-run']) {
    process.stdout.write(JSON.stringify({
      tier: 'postgres',
      db_name: dbName,
      already_set_up: false,
      dry_run: true,
      planned_actions: [
        flags['skip-pnpm-install'] ? null : `pnpm install in ${SCRIPTS_DIR}`,
        `node pipeline-db.js setup (PROJECT_ROOT=${CALLER_CWD}, db=${dbName})`,
        'node pipeline-db.js status',
        flags['embedding-model'] && !flags['skip-ollama-pull']
          ? `ollama pull ${flags['embedding-model']}`
          : null,
      ].filter(Boolean),
      post_commit_hook: postCommitHook,
      log,
    }, null, 2) + '\n');
    return;
  }

  // Step 2: pnpm install.
  let depsInstalled = false;
  if (!flags['skip-pnpm-install']) {
    const start = Date.now();
    try {
      runPnpm(['install'], { cwd: SCRIPTS_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
      depsInstalled = true;
      log.push({ step: 'pnpm-install', status: 'ok', duration_ms: Date.now() - start });
    } catch (e) {
      log.push({ step: 'pnpm-install', status: 'failed', error: e.message.split('\n')[0] });
      process.stderr.write(`init-knowledge: pnpm install failed in ${SCRIPTS_DIR}: ${e.message.split('\n')[0]}\n`);
      process.stderr.write(JSON.stringify({ tier: 'postgres', db_name: dbName, deps_installed: false, log }) + '\n');
      process.exit(1);
    }
  } else {
    log.push({ step: 'pnpm-install', status: 'skipped' });
  }

  // Step 3: pipeline-db.js setup.
  const nodeBin = process.execPath;
  try {
    execFileSync(nodeBin, [path.join(SCRIPTS_DIR, 'pipeline-db.js'), 'setup'], {
      cwd: SCRIPTS_DIR,
      env: { ...process.env, PROJECT_ROOT: CALLER_CWD },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log.push({ step: 'db-setup', status: 'ok', db_name: dbName });
  } catch (e) {
    log.push({ step: 'db-setup', status: 'failed', error: e.message.split('\n')[0] });
    process.stderr.write(`init-knowledge: pipeline-db.js setup failed: ${e.message.split('\n')[0]}\n`);
    process.exit(1);
  }

  // Step 4: pipeline-db.js status (verify).
  try {
    execFileSync(nodeBin, [path.join(SCRIPTS_DIR, 'pipeline-db.js'), 'status'], {
      cwd: SCRIPTS_DIR,
      env: { ...process.env, PROJECT_ROOT: CALLER_CWD },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log.push({ step: 'db-verify', status: 'ok' });
  } catch (e) {
    log.push({ step: 'db-verify', status: 'failed', error: e.message.split('\n')[0] });
    process.stderr.write(`init-knowledge: pipeline-db.js status verify failed: ${e.message.split('\n')[0]}\n`);
    process.exit(1);
  }

  // Step 5: Ollama pull (fail-graceful).
  let ollamaPullResult = 'skipped';
  const embeddingModel = flags['embedding-model'] || null;
  if (embeddingModel && !flags['skip-ollama-pull']) {
    const reachable = await probeOllama();
    if (!reachable) {
      ollamaPullResult = 'skipped';
      log.push({ step: 'ollama-pull', status: 'skipped', reason: 'ollama-not-reachable' });
    } else {
      try {
        execFileSync('ollama', ['pull', embeddingModel], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 300000, // 5 minutes
        });
        ollamaPullResult = 'ok';
        log.push({ step: 'ollama-pull', status: 'ok', model: embeddingModel });
      } catch (e) {
        ollamaPullResult = 'failed';
        log.push({ step: 'ollama-pull', status: 'failed', error: e.message.split('\n')[0] });
        // Fail-graceful: FTS still works without embeddings.
      }
    }
  }

  process.stdout.write(JSON.stringify({
    tier: 'postgres',
    db_name: dbName,
    already_set_up: false,
    deps_installed: depsInstalled,
    embedding_model: embeddingModel,
    ollama_pull_result: ollamaPullResult,
    post_commit_hook: postCommitHook,
    log,
  }, null, 2) + '\n');
}

// ─── SETUP-FILES ───────────────────────────────────────────────────────────

function setupFiles() {
  const log = [];
  const dirs = ['docs/sessions', 'docs/specs', 'docs/plans'];
  const created = [];

  for (const rel of dirs) {
    const abs = path.join(CALLER_CWD, rel);
    try {
      const existed = fs.existsSync(abs);
      fs.mkdirSync(abs, { recursive: true });
      created.push(rel);
      log.push({ step: 'mkdir', status: 'ok', path: rel, existed });
    } catch (e) {
      log.push({ step: 'mkdir', status: 'failed', path: rel, error: e.message.split('\n')[0] });
      process.stderr.write(`init-knowledge: mkdir ${rel} failed: ${e.message.split('\n')[0]}\n`);
      process.exit(1);
    }
  }

  process.stdout.write(JSON.stringify({
    tier: 'files',
    directories_created: created,
    log,
  }, null, 2) + '\n');
}

// ─── DISPATCH ──────────────────────────────────────────────────────────────

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (subcommand) {
    case 'setup-postgres':
      await setupPostgres(flags);
      break;
    case 'setup-files':
      setupFiles();
      break;
    default:
      process.stderr.write(
        `Usage: node pipeline-init-knowledge.js <subcommand> [options]\n` +
        `  setup-postgres --project-name <name> [--embedding-model <model>] [--skip-pnpm-install] [--skip-ollama-pull] [--dry-run]\n` +
        `  setup-files\n`
      );
      process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`init-knowledge: unhandled error: ${e.message.split('\n')[0]}\n`);
  process.exit(1);
});
