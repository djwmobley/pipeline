#!/usr/bin/env node
// pipeline-init-integrations.js — Windows-safe integration probe for commands/init.md Step 3.
// Replaces chained POSIX bash (/dev/tcp port probes, hardcoded /c/Program Files MSYS paths,
// curl invocations, shell for-loops) with Node's net / http modules and fs.readdirSync on
// process.env-resolved paths. Emits structured JSON on stdout.
//
// Exit codes: 0 on success; 1 on any probe failure with one-line stderr naming the step.

const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { execFileSync } = require('child_process');
const { runWinBin } = require('./lib/shared');

// Env var presence flags only — never log the values themselves.
const env_vars = {
  sentry_auth_token_set: !!process.env.SENTRY_AUTH_TOKEN,
  posthog_api_key_set: !!process.env.POSTHOG_API_KEY,
  gamma_api_key_set: !!process.env.GAMMA_API_KEY,
  github_token_set: !!process.env.GITHUB_TOKEN,
};

function probeTcpPort(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };
    const socket = net.createConnection({ host: 'localhost', port, timeout: timeoutMs });
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('closed'));
    socket.once('error', () => finish('closed'));
  });
}

function probeHttp(port, requestPath, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const req = http.get(
      { host: 'localhost', port, path: requestPath, timeout: timeoutMs },
      (res) => {
        // Drain the body so the socket closes cleanly.
        res.on('data', () => {});
        res.on('end', () => finish({ responding: true, status: res.statusCode || null }));
      }
    );
    req.once('timeout', () => { req.destroy(); finish({ responding: false, status: null }); });
    req.once('error', () => finish({ responding: false, status: null }));
  });
}

function commandVersion(cmd, versionArgs = ['--version']) {
  try {
    const out = execFileSync(cmd, versionArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const first = out.trim().split('\n')[0];
    return first || null;
  } catch {
    return null;
  }
}

// Windows-aware variant for CLIs that ship as .cmd shims (npx, pnpm, yarn on
// npm-install paths, az from MSI). runWinBin handles PATHEXT resolution and the
// CVE-2024-27980 hardening that makes execFileSync refuse .cmd/.bat with
// shell:false on Node ≥22. Returns first stdout line or null on any failure.
function commandVersionWin(candidates, versionArgs = ['--version']) {
  try {
    const out = runWinBin(candidates, versionArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    const first = out.trim().split('\n')[0];
    return first || null;
  } catch {
    return null;
  }
}

async function step(name, fn) {
  try {
    return await fn();
  } catch (e) {
    process.stderr.write(`init-integrations: step "${name}" failed: ${e.message.split('\n')[0]}\n`);
    process.exit(1);
  }
}

// Postgres install-root directories, platform-aware. Replaces the bash block that
// hardcoded /c/Program Files/PostgreSQL/*/bin etc.
function listPostgresInstalls() {
  const installs = [];
  if (process.platform === 'win32') {
    for (const envKey of ['ProgramFiles', 'ProgramFiles(x86)']) {
      const base = process.env[envKey];
      if (!base) continue;
      const pgBase = path.join(base, 'PostgreSQL');
      if (!fs.existsSync(pgBase)) continue;
      try {
        for (const version of fs.readdirSync(pgBase)) {
          installs.push(path.join(pgBase, version));
        }
      } catch {}
    }
  } else {
    const debianBase = '/usr/lib/postgresql';
    if (fs.existsSync(debianBase)) {
      try {
        for (const version of fs.readdirSync(debianBase)) {
          installs.push(path.join(debianBase, version));
        }
      } catch {}
    }
    const homebrewBase = '/opt/homebrew/opt';
    if (fs.existsSync(homebrewBase)) {
      try {
        for (const entry of fs.readdirSync(homebrewBase)) {
          if (entry.startsWith('postgresql')) installs.push(path.join(homebrewBase, entry));
        }
      } catch {}
    }
  }
  return installs;
}

function findPgIsReady(installs) {
  // On PATH first.
  try {
    execFileSync('pg_isready', ['--version'], { stdio: 'ignore', timeout: 5000 });
    return 'on_path';
  } catch {}
  // Inside any detected install.
  const exe = process.platform === 'win32' ? 'pg_isready.exe' : 'pg_isready';
  for (const install of installs) {
    const full = path.join(install, 'bin', exe);
    if (fs.existsSync(full)) return { path: full };
  }
  // Direct bin dirs (macOS/Linux).
  if (process.platform !== 'win32') {
    for (const binDir of ['/usr/local/bin', '/opt/homebrew/bin']) {
      const full = path.join(binDir, 'pg_isready');
      if (fs.existsSync(full)) return { path: full };
    }
  }
  return null;
}

async function detectPostgres() {
  const installs_found = listPostgresInstalls();
  const pg_isready = findPgIsReady(installs_found);

  let port_5432 = await probeTcpPort(5432);
  if (port_5432 === 'open') {
    if (pg_isready) {
      try {
        const cmd = pg_isready === 'on_path' ? 'pg_isready' : pg_isready.path;
        execFileSync(cmd, ['-h', 'localhost', '-p', '5432'], {
          stdio: 'ignore',
          timeout: 5000,
        });
        port_5432 = 'accepting';
      } catch {
        port_5432 = 'not_responding';
      }
    } else {
      port_5432 = 'port_open';
    }
  } else {
    port_5432 = 'closed';
  }

  const alt_ports_open = [];
  for (const port of [5433, 5434, 54320]) {
    if ((await probeTcpPort(port)) === 'open') alt_ports_open.push(port);
  }

  return { pg_isready, installs_found, port_5432, alt_ports_open };
}

async function main() {
  const postgres = await step('postgres', detectPostgres);

  const ollamaProbe = await step('ollama', () => probeHttp(11434, '/api/tags'));
  const ollama = { responding: ollamaProbe.responding, version_if_known: null };

  const chromeProbe = await step('chrome', () => probeHttp(9222, '/json/version'));
  const chrome = { responding: chromeProbe.responding, port: 9222 };

  // npx is a .cmd shim on Windows (npm-installed) — use the Windows-aware variant
  // so detection works under Node ≥22 (CVE-2024-27980 refuses bare .cmd invocation).
  const playwrightVersion = await step('playwright', () =>
    commandVersionWin(['npx.cmd', 'npx.exe', 'npx'], ['playwright', '--version'])
  );
  const playwright = {
    installed: playwrightVersion !== null,
    version_if_known: playwrightVersion,
  };

  const ghVersion = await step('gh', () => commandVersion('gh'));
  const gh = { installed: ghVersion !== null, version_if_known: ghVersion };

  const output = { env_vars, postgres, ollama, chrome, playwright, gh };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main().catch((e) => {
  process.stderr.write(`init-integrations: failed: ${e.message.split('\n')[0]}\n`);
  process.exit(1);
});
