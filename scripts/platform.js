#!/usr/bin/env node
/**
 * platform.js — Platform abstraction layer for Pipeline
 *
 * Unified interface for issue tracking and code hosting operations.
 * Agents call this like any shell command — stdout on success, stderr on failure.
 * All verification, retry, and auth logic lives here in code, not in agent prompts.
 *
 * Backends: GitHub (gh CLI), Azure DevOps (az CLI + az rest)
 *
 * Usage:
 *   node platform.js issue create --title "Fix bug" --body "Description" --labels "pipeline,roadmap"
 *   node platform.js issue comment <ref> "Comment text"
 *   node platform.js issue comment <ref> --stdin           # Read body from stdin
 *   node platform.js issue close <ref>
 *   node platform.js issue list --labels "pipeline" --state open
 *   node platform.js issue view <ref>
 *   node platform.js issue edit <ref> --body "New body"
 *   node platform.js issue reopen <ref>
 *   node platform.js issue search <query> --state open
 *
 *   node platform.js pr create --title "feat: X" --body "Description" --source feat/x --target main
 *   node platform.js pr merge <ref> --squash
 *   node platform.js pr comment <ref> "Review findings"
 *   node platform.js pr comment <ref> --stdin              # Read body from stdin
 *   node platform.js pr diff <ref>
 *   node platform.js pr view <ref>
 *
 *   node platform.js auth check                            # Verify credentials
 *
 * Exit codes:
 *   0 — success (ref/URL/data on stdout)
 *   1 — failure (error message on stderr)
 */

const { execFile: execFileCb } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFile = promisify(execFileCb);

// ─── ANSI ──────────────────────────────────────────────────────────────────

const c = {
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ─── CONFIG ────────────────────────────────────────────────────────────────

function findProjectRoot() {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadPlatformConfig() {
  const root = findProjectRoot();
  const configPath = path.join(root, '.claude', 'pipeline.yml');
  if (!fs.existsSync(configPath)) {
    return { code_host: 'github', issue_tracker: 'github' };
  }

  const content = fs.readFileSync(configPath, 'utf8');

  // Always extract project.repo — needed for GitHub operations regardless of platform config
  const repoMatch = content.match(/^\s+repo:\s*["']?([^"'\s#]+)["']?/m);

  const platformMatch = content.match(/^platform:\s*$/m);
  if (!platformMatch) {
    const defaults = { code_host: 'github', issue_tracker: 'github' };
    if (repoMatch) defaults.repo = repoMatch[1];
    return defaults;
  }

  // Simple YAML extraction — no dependency needed for flat config
  const lines = content.split('\n');
  const startIdx = lines.indexOf('platform:');
  if (startIdx === -1) {
    const defaults = { code_host: 'github', issue_tracker: 'github' };
    if (repoMatch) defaults.repo = repoMatch[1];
    return defaults;
  }

  const config = { code_host: 'github', issue_tracker: 'github', azure_devops: {} };

  let inPlatform = false;
  let inAzure = false;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Stop at next top-level key (no leading whitespace)
    if (line.match(/^\S/) && line.trim() !== '') break;
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)[1].length;
    const kvMatch = line.trim().match(/^(\w+):\s*["']?([^"'\s#]+)["']?/);
    if (!kvMatch) continue;

    const [, key, value] = kvMatch;

    if (indent <= 4 && key === 'code_host') { config.code_host = value; inAzure = false; }
    else if (indent <= 4 && key === 'issue_tracker') { config.issue_tracker = value; inAzure = false; }
    else if (indent <= 4 && key === 'azure_devops') { inAzure = true; continue; }
    else if (inAzure || indent > 4) {
      config.azure_devops[key] = value;
      inAzure = true;
    }
  }

  // project.repo was already extracted above (before platform section parsing)
  if (repoMatch) config.repo = repoMatch[1];

  return config;
}

// ─── RETRY ─────────────────────────────────────────────────────────────────

const TRANSIENT_PATTERNS = [
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  /rate limit/i,
  /429/,
  /502/,
  /503/,
  /504/,
  /network error/i,
  /connect EHOSTUNREACH/i,
];

function isTransient(err) {
  const msg = (err.stderr || err.message || '').toString();
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

async function withRetry(fn, { maxAttempts = 3, baseDelay = 2000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts || !isTransient(err)) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── EXEC HELPERS ──────────────────────────────────────────────────────────

async function run(cmd, args) {
  try {
    const { stdout } = await execFile(cmd, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });
    return stdout.trim();
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString().trim();
    throw Object.assign(new Error(msg), { stderr: msg, exitCode: err.code });
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Escape single quotes for WIQL string literals ('' is the WIQL escape for ')
function escapeWiql(s) {
  return String(s).replace(/'/g, "''");
}

// ─── STDIN READER ──────────────────────────────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GITHUB BACKEND
// ═══════════════════════════════════════════════════════════════════════════

const github = {
  async authCheck() {
    await run('gh', ['auth', 'status']);
    return 'GitHub authentication verified';
  },

  // ─── Issues ────────────────────────────────────────────────────────────

  async issueCreate({ title, body, labels, repo }) {
    const args = ['issue', 'create', '--repo', repo, '--title', title];
    if (body) args.push('--body', body);
    if (labels) args.push('--label', labels);

    // gh issue create prints the issue URL on stdout; --json is not supported here.
    const url = await withRetry(() => run('gh', args));
    const m = url.match(/\/issues\/(\d+)/);
    if (!m) throw new Error(`Could not parse issue number from gh output: ${url}`);
    const ref = m[1];
    // Verify it was created
    await run('gh', ['issue', 'view', ref, '--repo', repo, '--json', 'number', '-q', '.number']);
    return ref;
  },

  async issueComment({ ref, body, repo }) {
    await withRetry(() => run('gh', ['issue', 'comment', String(ref), '--repo', repo, '--body', body]));
    return String(ref);
  },

  async issueClose({ ref, comment, repo }) {
    const args = ['issue', 'close', String(ref), '--repo', repo];
    if (comment) args.push('--comment', comment);
    await withRetry(() => run('gh', args));
    // Verify it actually closed
    const state = await run('gh', ['issue', 'view', String(ref), '--repo', repo, '--json', 'state', '-q', '.state']);
    if (state !== 'CLOSED') {
      throw new Error(`Issue ${ref} state is "${state}" after close attempt — expected CLOSED`);
    }
    return String(ref);
  },

  async issueList({ labels, state, search, repo, limit }) {
    const args = ['issue', 'list', '--repo', repo];
    if (labels) args.push('--label', labels);
    if (state) args.push('--state', state);
    if (search) args.push('--search', search);
    if (limit) args.push('--limit', String(limit));
    args.push('--json', 'number,title,state,labels,url');
    return await run('gh', args);
  },

  async issueView({ ref, repo }) {
    return await run('gh', ['issue', 'view', String(ref), '--repo', repo, '--json', 'title,body,state,comments,labels']);
  },

  async issueEdit({ ref, body, repo }) {
    await withRetry(() => run('gh', ['issue', 'edit', String(ref), '--repo', repo, '--body', body]));
    return String(ref);
  },

  async issueReopen({ ref, repo }) {
    await withRetry(() => run('gh', ['issue', 'reopen', String(ref), '--repo', repo]));
    const state = await run('gh', ['issue', 'view', String(ref), '--repo', repo, '--json', 'state', '-q', '.state']);
    if (state !== 'OPEN') {
      throw new Error(`Issue ${ref} state is "${state}" after reopen attempt — expected OPEN`);
    }
    return String(ref);
  },

  async issueSearch({ query, state, repo, limit }) {
    const args = ['issue', 'list', '--repo', repo];
    if (query) args.push('--search', query);
    if (state) args.push('--state', state);
    if (limit) args.push('--limit', String(limit));
    args.push('--json', 'number,title,state,labels');
    return await run('gh', args);
  },

  // ─── PRs ───────────────────────────────────────────────────────────────

  async prCreate({ title, body, source, target, repo }) {
    const args = ['pr', 'create', '--repo', repo, '--title', title, '--head', source];
    if (target) args.push('--base', target);
    if (body) args.push('--body', body);

    // gh pr create prints the PR URL on stdout; --json is not supported here.
    const url = await withRetry(() => run('gh', args));
    const m = url.match(/\/pull\/(\d+)/);
    if (!m) throw new Error(`Could not parse PR number from gh output: ${url}`);
    const ref = m[1];
    await run('gh', ['pr', 'view', ref, '--repo', repo, '--json', 'number', '-q', '.number']);
    return ref;
  },

  async prMerge({ ref, squash, deleteSourceBranch, message, repo }) {
    const args = ['pr', 'merge', String(ref), '--repo', repo];
    if (squash) args.push('--squash');
    if (deleteSourceBranch) args.push('--delete-branch');
    if (message) args.push('--body', message);

    await withRetry(() => run('gh', args));
    // Verify merge
    const state = await run('gh', ['pr', 'view', String(ref), '--repo', repo, '--json', 'state', '-q', '.state']);
    if (state !== 'MERGED') {
      throw new Error(`PR ${ref} state is "${state}" after merge attempt — expected MERGED. Check for merge conflicts or branch protection rules.`);
    }
    return String(ref);
  },

  async prComment({ ref, body, repo }) {
    await withRetry(() => run('gh', ['pr', 'comment', String(ref), '--repo', repo, '--body', body]));
    return String(ref);
  },

  async prDiff({ ref, repo }) {
    return await run('gh', ['pr', 'diff', String(ref), '--repo', repo]);
  },

  async prView({ ref, repo }) {
    return await run('gh', ['pr', 'view', String(ref), '--repo', repo, '--json', 'number,title,state,body,headRefName,baseRefName']);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AZURE DEVOPS BACKEND
// ═══════════════════════════════════════════════════════════════════════════

const azureDevops = {
  async authCheck(config) {
    await run('az', ['account', 'show', '--query', 'name', '--output', 'tsv']);
    // Verify DevOps extension is installed
    await run('az', ['extension', 'show', '--name', 'azure-devops', '--query', 'version', '--output', 'tsv']);
    // Verify project access
    const org = config.azure_devops.organization;
    const project = config.azure_devops.project;
    await run('az', ['devops', 'project', 'show', '--project', project, '--org', `https://dev.azure.com/${org}`, '--query', 'name', '--output', 'tsv']);
    return 'Azure DevOps authentication verified';
  },

  _orgArgs(config) {
    const org = config.azure_devops.organization;
    const project = config.azure_devops.project;
    return ['--org', `https://dev.azure.com/${org}`, '--project', project];
  },

  // ─── Issues (Work Items) ──────────────────────────────────────────────

  async issueCreate({ title, body, labels, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    const workItemType = config.azure_devops.work_item_type || 'Task';
    const args = ['boards', 'work-item', 'create', '--type', workItemType, '--title', title, ...orgArgs, '--output', 'json'];
    if (body) args.push('--description', body);
    if (labels) args.push('--fields', `System.Tags=${labels.replace(/,/g, ';')}`);

    const raw = await withRetry(() => run('az', args));
    const data = parseJson(raw);
    if (!data || !data.id) throw new Error('Failed to parse work item ID from response');
    // Verify it exists
    await run('az', ['boards', 'work-item', 'show', '--id', String(data.id), ...orgArgs, '--output', 'json']);
    return String(data.id);
  },

  async issueComment({ ref, body, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    await withRetry(() => run('az', ['boards', 'work-item', 'update', '--id', String(ref), '--discussion', body, ...orgArgs, '--output', 'json']));
    return String(ref);
  },

  async issueClose({ ref, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    const doneState = config.azure_devops.done_state || 'Closed';
    await withRetry(() => run('az', ['boards', 'work-item', 'update', '--id', String(ref), '--state', doneState, ...orgArgs, '--output', 'json']));
    // Verify state actually changed
    const raw = await run('az', ['boards', 'work-item', 'show', '--id', String(ref), ...orgArgs, '--output', 'json']);
    const data = parseJson(raw);
    const currentState = data?.fields?.['System.State'];
    if (currentState !== doneState) {
      throw new Error(`Work item ${ref} state is "${currentState}" after close — expected "${doneState}". Check valid transitions for your process template.`);
    }
    return String(ref);
  },

  async issueList({ labels, state, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    const doneState = config.azure_devops.done_state || 'Closed';
    const activeState = config.azure_devops.active_state || 'Active';

    let whereClause = '[System.TeamProject] = @project';
    if (labels) {
      const tags = labels.split(',').map((t) => `[System.Tags] CONTAINS '${escapeWiql(t.trim())}'`);
      whereClause += ` AND ${tags.join(' AND ')}`;
    }
    if (state === 'open') {
      whereClause += ` AND [System.State] <> '${doneState}'`;
    } else if (state === 'closed') {
      whereClause += ` AND [System.State] = '${doneState}'`;
    }

    const wiql = `SELECT [System.Id],[System.Title],[System.State],[System.Tags] FROM workitems WHERE ${whereClause} ORDER BY [System.Id]`;
    return await run('az', ['boards', 'query', '--wiql', wiql, ...orgArgs, '--output', 'json']);
  },

  async issueView({ ref, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    return await run('az', ['boards', 'work-item', 'show', '--id', String(ref), ...orgArgs, '--output', 'json']);
  },

  async issueEdit({ ref, body, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    await withRetry(() => run('az', ['boards', 'work-item', 'update', '--id', String(ref), '--description', body, ...orgArgs, '--output', 'json']));
    return String(ref);
  },

  async issueReopen({ ref, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    const activeState = config.azure_devops.active_state || 'Active';
    await withRetry(() => run('az', ['boards', 'work-item', 'update', '--id', String(ref), '--state', activeState, ...orgArgs, '--output', 'json']));
    const raw = await run('az', ['boards', 'work-item', 'show', '--id', String(ref), ...orgArgs, '--output', 'json']);
    const data = parseJson(raw);
    const currentState = data?.fields?.['System.State'];
    if (currentState !== activeState) {
      throw new Error(`Work item ${ref} state is "${currentState}" after reopen — expected "${activeState}"`);
    }
    return String(ref);
  },

  async issueSearch({ query, state, config, limit }) {
    const orgArgs = azureDevops._orgArgs(config);
    const doneState = config.azure_devops.done_state || 'Closed';

    let whereClause = `[System.TeamProject] = @project AND [System.Title] CONTAINS '${escapeWiql(query)}'`;
    if (state === 'open') {
      whereClause += ` AND [System.State] <> '${doneState}'`;
    }

    const wiql = `SELECT [System.Id],[System.Title],[System.State],[System.Tags] FROM workitems WHERE ${whereClause} ORDER BY [System.Id]`;
    const args = ['boards', 'query', '--wiql', wiql, ...orgArgs, '--output', 'json'];
    if (limit) args.push('--top', String(limit));
    return await run('az', args);
  },

  // ─── PRs ───────────────────────────────────────────────────────────────

  async prCreate({ title, body, source, target, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    const args = ['repos', 'pr', 'create', '--title', title, '--source-branch', source, ...orgArgs, '--output', 'json'];
    if (target) args.push('--target-branch', target);
    if (body) args.push('--description', body);

    const raw = await withRetry(() => run('az', args));
    const data = parseJson(raw);
    if (!data || !data.pullRequestId) throw new Error('Failed to parse PR ID from response');
    return String(data.pullRequestId);
  },

  async prMerge({ ref, squash, deleteSourceBranch, message, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    const args = ['repos', 'pr', 'update', '--id', String(ref), '--status', 'completed', ...orgArgs, '--output', 'json'];
    if (squash) args.push('--squash', 'true');
    if (deleteSourceBranch) args.push('--delete-source-branch', 'true');
    if (message) args.push('--merge-commit-message', message);

    await withRetry(() => run('az', args));
    // Verify merge status
    const raw = await run('az', ['repos', 'pr', 'show', '--id', String(ref), ...orgArgs, '--output', 'json']);
    const data = parseJson(raw);
    if (data?.status !== 'completed') {
      throw new Error(`PR ${ref} status is "${data?.status}" after merge — expected "completed". Check merge policies or conflicts.`);
    }
    return String(ref);
  },

  async prComment({ ref, body, config }) {
    const org = config.azure_devops.organization;
    const project = config.azure_devops.project;

    // Get repository ID from PR
    const orgArgs = azureDevops._orgArgs(config);
    const prRaw = await run('az', ['repos', 'pr', 'show', '--id', String(ref), ...orgArgs, '--output', 'json']);
    const prData = parseJson(prRaw);
    const repoId = prData?.repository?.id;
    if (!repoId) throw new Error('Could not determine repository ID from PR');

    const uri = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repoId}/pullRequests/${ref}/threads?api-version=7.2`;
    const payload = JSON.stringify({
      comments: [{ parentCommentId: 0, content: body, commentType: 'text' }],
      status: 'closed',
    });

    await withRetry(() => run('az', ['rest', '--method', 'POST', '--uri', uri, '--body', payload]));
    return String(ref);
  },

  async prDiff({ ref, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    const raw = await run('az', ['repos', 'pr', 'show', '--id', String(ref), ...orgArgs, '--output', 'json']);
    const data = parseJson(raw);
    const source = data?.sourceRefName?.replace('refs/heads/', '');
    const target = data?.targetRefName?.replace('refs/heads/', '');
    if (!source || !target) throw new Error('Could not determine source/target branches from PR');
    return await run('git', ['diff', `${target}...${source}`]);
  },

  async prView({ ref, config }) {
    const orgArgs = azureDevops._orgArgs(config);
    return await run('az', ['repos', 'pr', 'show', '--id', String(ref), ...orgArgs, '--output', 'json']);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK (no platform configured)
// ═══════════════════════════════════════════════════════════════════════════

const fallback = {
  async authCheck() {
    return 'SKIPPED — no platform configured';
  },

  async issueCreate() { process.stdout.write('SKIPPED'); return 'SKIPPED'; },
  async issueComment() { process.stdout.write('SKIPPED'); return 'SKIPPED'; },
  async issueClose() { process.stdout.write('SKIPPED'); return 'SKIPPED'; },
  async issueList() { process.stdout.write('[]'); return '[]'; },
  async issueView() { process.stdout.write('SKIPPED'); return 'SKIPPED'; },
  async issueEdit() { process.stdout.write('SKIPPED'); return 'SKIPPED'; },
  async issueReopen() { process.stdout.write('SKIPPED'); return 'SKIPPED'; },
  async issueSearch() { process.stdout.write('[]'); return '[]'; },

  async prCreate() { throw new Error('PLATFORM_TWO_STORE: No code host configured. Cannot create PR. Set platform.code_host in .claude/pipeline.yml'); },
  async prMerge() { throw new Error('PLATFORM_TWO_STORE: No code host configured. Cannot merge PR.'); },
  async prComment() { process.stdout.write('SKIPPED'); return 'SKIPPED'; },
  async prDiff() { throw new Error('PLATFORM_TWO_STORE: No code host configured. Cannot get PR diff.'); },
  async prView() { throw new Error('PLATFORM_TWO_STORE: No code host configured. Cannot view PR.'); },
};

// ═══════════════════════════════════════════════════════════════════════════
// DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════

function getBackend(type, config) {
  const platform = type === 'issue' ? config.issue_tracker : config.code_host;

  switch (platform) {
    case 'github':
      return github;
    case 'azure-devops':
      return azureDevops;
    case 'none':
      return fallback;
    default:
      throw new Error(`PLATFORM_TWO_STORE: Unsupported platform "${platform}" for ${type} operations. Supported: github, azure-devops, none`);
  }
}

// ─── ARG PARSING ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { positional: [], flags: {} };

  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (key === 'stdin') {
        result.flags.stdin = true;
        i++;
      } else if (key === 'squash' || key === 'delete-branch') {
        result.flags[key] = true;
        i++;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result.flags[key] = args[i + 1];
        i += 2;
      } else {
        result.flags[key] = true;
        i++;
      }
    } else {
      result.positional.push(args[i]);
      i++;
    }
  }

  return result;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  const [resource, action, ...rest] = positional;

  if (!resource || !action) {
    process.stderr.write('Usage: node platform.js <issue|pr|auth> <action> [args] [--flags]\n');
    process.exit(1);
  }

  const config = loadPlatformConfig();

  // Read body from stdin if --stdin flag is set
  let stdinBody = null;
  if (flags.stdin) {
    stdinBody = await readStdin();
    if (!stdinBody.trim()) {
      process.stderr.write('Error: --stdin flag set but no input received on stdin\n');
      process.exit(1);
    }
  }

  try {
    let result;

    if (resource === 'auth' && action === 'check') {
      // Allow --platform override for bootstrap (init runs before pipeline.yml exists)
      if (flags.platform) {
        config.code_host = flags.platform;
        config.issue_tracker = flags.platform;
      }
      // Auth check — verify both configured platforms
      const results = [];
      const issueBackend = getBackend('issue', config);
      const codeBackend = getBackend('pr', config);

      results.push(await issueBackend.authCheck(config));
      if (config.issue_tracker !== config.code_host) {
        results.push(await codeBackend.authCheck(config));
      }
      result = results.join('\n');

    } else if (resource === 'issue') {
      const backend = getBackend('issue', config);
      const repo = flags.repo || config.repo;

      switch (action) {
        case 'create':
          result = await backend.issueCreate({ title: flags.title, body: stdinBody || flags.body, labels: flags.labels || flags.label, repo, config });
          break;
        case 'comment':
          result = await backend.issueComment({ ref: rest[0], body: stdinBody || rest[1] || flags.body, repo, config });
          break;
        case 'close':
          result = await backend.issueClose({ ref: rest[0], comment: flags.comment, repo, config });
          break;
        case 'list':
          result = await backend.issueList({ labels: flags.labels || flags.label, state: flags.state, search: flags.search, repo, limit: flags.limit, config });
          break;
        case 'view':
          result = await backend.issueView({ ref: rest[0], repo, config });
          break;
        case 'edit':
          result = await backend.issueEdit({ ref: rest[0], body: stdinBody || flags.body, repo, config });
          break;
        case 'reopen':
          result = await backend.issueReopen({ ref: rest[0], repo, config });
          break;
        case 'search':
          result = await backend.issueSearch({ query: rest[0] || flags.query, state: flags.state, repo, limit: flags.limit, config });
          break;
        default:
          throw new Error(`Unknown issue action: ${action}. Supported: create, comment, close, list, view, edit, reopen, search`);
      }

    } else if (resource === 'pr') {
      const backend = getBackend('pr', config);
      const repo = flags.repo || config.repo;

      switch (action) {
        case 'create':
          result = await backend.prCreate({ title: flags.title, body: stdinBody || flags.body, source: flags.source || flags.head, target: flags.target || flags.base, repo, config });
          break;
        case 'merge':
          result = await backend.prMerge({ ref: rest[0], squash: flags.squash, deleteSourceBranch: flags['delete-branch'], message: flags.body || flags.message, repo, config });
          break;
        case 'comment':
          result = await backend.prComment({ ref: rest[0], body: stdinBody || rest[1] || flags.body, repo, config });
          break;
        case 'diff':
          result = await backend.prDiff({ ref: rest[0], repo, config });
          break;
        case 'view':
          result = await backend.prView({ ref: rest[0], repo, config });
          break;
        default:
          throw new Error(`Unknown pr action: ${action}. Supported: create, merge, comment, diff, view`);
      }

    } else {
      throw new Error(`Unknown resource: ${resource}. Supported: issue, pr, auth`);
    }

    // Output result to stdout — agent reads this
    if (result && result !== 'SKIPPED') {
      process.stdout.write(String(result) + '\n');
    }

  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
