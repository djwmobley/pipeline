#!/usr/bin/env node
// pipeline-init-detect.js — Windows-safe project detection probe for commands/init.md Step 1.
// Replaces chained POSIX bash (test -f loops, grep pipe chains, find | wc -l) with
// fs.existsSync / fs.readdirSync and argv-array execFileSync for git. Emits structured
// JSON on stdout for the calling LLM to parse and reason over.
//
// Exit codes: 0 on success; 1 on any probe failure with one-line stderr naming the step.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const cwd = process.cwd();

// ─── Sub-command dispatch ─────────────────────────────────────────────────────

const subCommand = process.argv[2];

if (subCommand === 'detect-local-models') {
  detectLocalModelHosts().then((results) => {
    for (const r of results) {
      const status = r.detected ? 'DETECTED' : 'not detected';
      const modelInfo = r.detected ? ` — ${r.models.length} model(s): ${r.models.slice(0, 5).join(', ')}${r.models.length > 5 ? '...' : ''}` : '';
      process.stdout.write(`${r.name} (${r.endpoint}): ${status}${modelInfo}\n`);
    }
  }).catch((e) => {
    process.stderr.write(`detect-local-models failed: ${e.message}\n`);
    process.exit(1);
  });
  // Exit before running the rest of the module
  return;
}

async function detectLocalModelHosts() {
  const { getAdapter } = require('./lib/local-model-adapter');

  const probes = [
    { name: 'Ollama',    hostType: 'ollama',            endpoint: 'http://localhost:11434', apiProtocol: 'ollama_native'     },
    { name: 'LM Studio', hostType: 'openai_compatible', endpoint: 'http://localhost:1234',  apiProtocol: 'openai_compatible' },
    { name: 'vLLM',      hostType: 'openai_compatible', endpoint: 'http://localhost:8000',  apiProtocol: 'openai_compatible' },
    { name: 'llama.cpp', hostType: 'openai_compatible', endpoint: 'http://localhost:8080',  apiProtocol: 'openai_compatible' },
  ];

  const results = [];
  for (const probe of probes) {
    try {
      const adapter = getAdapter(probe.hostType);
      const cfg = { endpoint: probe.endpoint, modelName: '', apiProtocol: probe.apiProtocol, timeoutMs: 3000, maxRetries: 0 };
      const models = await adapter.listModels(cfg);
      results.push({ ...probe, detected: true, models });
    } catch (_) {
      results.push({ ...probe, detected: false, models: [] });
    }
  }
  return results;
}

function step(name, fn) {
  try {
    return fn();
  } catch (e) {
    process.stderr.write(`init-detect: step "${name}" failed: ${e.message.split('\n')[0]}\n`);
    process.exit(1);
  }
}

function exists(relative) {
  return fs.existsSync(path.join(cwd, relative));
}

function isDir(relative) {
  try {
    return fs.statSync(path.join(cwd, relative)).isDirectory();
  } catch {
    return false;
  }
}

function readOrNull(relative) {
  try {
    return fs.readFileSync(path.join(cwd, relative), 'utf8');
  } catch {
    return null;
  }
}

function gitOrNull(args) {
  try {
    return (
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

function commandAvailable(cmd) {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Project manifest files — presence check for each candidate.
const projectFileCandidates = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'pom.xml',
  'build.gradle',
  'requirements.txt',
];
const project_files = step('project_files', () =>
  projectFileCandidates.map((name) => ({ name, exists: exists(name) }))
);

// Git remote + branch.
const git = step('git', () => {
  const remote = gitOrNull(['remote', 'get-url', 'origin']);
  const branch = gitOrNull(['branch', '--show-current']);
  return remote ? { remote, branch } : null;
});

// Dependency markers across the three big manifest formats.
const deps = step('deps', () => {
  const result = {
    package_json_keys: [],
    package_json_bin: false,
    package_json_main_or_exports: false,
    cargo_markers: [],
    go_mod_present: exists('go.mod'),
  };
  const pkg = readOrNull('package.json');
  if (pkg) {
    const markers = [
      'vitest', 'jest', 'mocha', 'ava', 'eslint', 'biome', 'oxlint',
      'typescript', 'react-native', 'expo', 'next', 'nuxt', 'svelte',
      'remix', 'react', 'vue', 'angular', 'express', 'fastify', 'koa',
      'hono', 'capacitor',
    ];
    for (const marker of markers) {
      if (new RegExp(`"${marker}"`).test(pkg)) result.package_json_keys.push(marker);
    }
    result.package_json_bin = /"bin"/.test(pkg);
    result.package_json_main_or_exports = /"(main|exports)"/.test(pkg);
  }
  const cargo = readOrNull('Cargo.toml');
  if (cargo) {
    const markers = ['[[bin]]', 'axum', 'actix', 'clap', 'rocket'];
    for (const marker of markers) {
      if (cargo.includes(marker)) result.cargo_markers.push(marker);
    }
  }
  return result;
});

// Source directory presence.
const sourceDirCandidates = [
  'src', 'lib', 'app', 'pkg', 'cmd', 'internal',
  'ios', 'android', 'server', 'prisma', 'drizzle',
];
const source_dirs = step('source_dirs', () => sourceDirCandidates.filter((d) => isDir(d)));

// Framework config files.
const configFileCandidates = [
  'next.config.js', 'next.config.ts', 'next.config.mjs',
  'nuxt.config.ts', 'nuxt.config.js',
  'svelte.config.js', 'remix.config.js',
  'capacitor.config.ts', 'capacitor.config.json',
  'vite.config.ts', 'vite.config.js',
  'webpack.config.js',
];
const config_files = step('config_files', () => configFileCandidates.filter((f) => exists(f)));

// Package manager — lockfile > command-available > default.
const pkg_manager = step('pkg_manager', () => {
  if (exists('pnpm-lock.yaml')) return { name: 'pnpm', detection_source: 'pnpm-lock.yaml' };
  if (exists('bun.lockb')) return { name: 'bun', detection_source: 'bun.lockb' };
  if (exists('bun.lock')) return { name: 'bun', detection_source: 'bun.lock' };
  if (exists('yarn.lock')) return { name: 'yarn', detection_source: 'yarn.lock' };
  if (exists('package-lock.json')) return { name: 'npm', detection_source: 'package-lock.json' };
  if (exists('package.json')) {
    return commandAvailable('pnpm')
      ? { name: 'pnpm', detection_source: 'command-available (no lockfile)' }
      : { name: 'npm', detection_source: 'default (no lockfile, pnpm unavailable)' };
  }
  return { name: 'none', detection_source: 'no package.json' };
});

// Recursive source-file count — replaces `find src/ lib/ app/ ... | wc -l`. Skips
// node_modules and hidden directories to avoid the same traps `find` would hit.
const sourceFileExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.rs', '.go', '.py']);
function countSourceFiles(dir) {
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countSourceFiles(full);
    } else if (entry.isFile() && sourceFileExtensions.has(path.extname(entry.name))) {
      count += 1;
    }
  }
  return count;
}
const source_file_count = step('source_file_count', () => {
  let total = 0;
  for (const d of ['src', 'lib', 'app']) {
    if (isDir(d)) total += countSourceFiles(path.join(cwd, d));
  }
  return total;
});

// Greenfield flag — derived from the two signals the original bash also used.
const greenfield = source_dirs.length === 0 || source_file_count < 5;

const output = {
  project_files,
  git,
  deps,
  source_dirs,
  config_files,
  pkg_manager,
  source_file_count,
  greenfield,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');
