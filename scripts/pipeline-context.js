#!/usr/bin/env node
/**
 * pipeline-context.js — Data access layer for agent context injection
 *
 * Retrieves context from Postgres, GitHub, and repo files via predefined
 * query functions. Commands call these functions to build agent prompts.
 * Agents never self-fetch — they receive injected data.
 *
 * Three-store priority: Postgres (most reliable) → GitHub (audit trail) → Files (last resort)
 *
 * Usage (CLI):
 *   node pipeline-context.js task <id>           # Task context + related findings
 *   node pipeline-context.js arch-plan           # Architecture constraints summary
 *   node pipeline-context.js findings [options]  # Security findings (--status, --severity, --source)
 *   node pipeline-context.js decisions [limit]   # Recent architectural decisions
 *   node pipeline-context.js gotchas             # Active critical constraints
 *   node pipeline-context.js session             # Last session + open tasks
 *   node pipeline-context.js build-state <plan>  # Build progress from state file
 *   node pipeline-context.js github <issue-num>  # GitHub issue body + comments
 *   node pipeline-context.js full <task-id>      # Everything an implementer needs
 *
 * Usage (require):
 *   const ctx = require('./pipeline-context');
 *   const data = await ctx.getTaskContext(client, 42);
 *
 * All functions accept a connected pg Client and return plain objects.
 * CLI mode connects/disconnects automatically.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig, connect, c } = require('./lib/shared');

const CONFIG = loadConfig();

// ─── SHELL HELPERS ──────────────────────────────────────────────────────────

/**
 * Run platform.js with args array (no shell interpolation — safe from injection).
 * Routes all issue/PR operations through the platform abstraction layer.
 * Returns stdout as string, or null on failure.
 */
function platform(args) {
  const platformScript = path.join(__dirname, 'platform.js');
  try {
    return execFileSync(process.execPath, [platformScript, ...args], {
      encoding: 'utf8', timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (_) {
    return null;
  }
}

// ─── CONTEXT FUNCTIONS ──────────────────────────────────────────────────────
// Each function returns a structured object suitable for JSON serialization
// or direct injection into an agent prompt template.

/**
 * Task context: task details + related findings + decisions from the same phase.
 */
async function getTaskContext(client, taskId) {
  const { rows: [task] } = await client.query(
    'SELECT id, title, status, phase, priority, issue_ref, category FROM tasks WHERE id = $1',
    [taskId]
  );
  if (!task) return { error: `Task ${taskId} not found` };

  // Related findings linked to this task
  const { rows: findings } = await client.query(
    `SELECT id, severity, description, status, effort
     FROM findings WHERE task_id = $1
     ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`,
    [taskId]
  );

  // Issue body if linked — fetched via platform abstraction layer
  let issueBody = null;
  if (task.issue_ref) {
    const raw = platform(['issue', 'view', String(task.issue_ref)]);
    if (raw) {
      try { issueBody = JSON.parse(raw).body || null; } catch (_) { issueBody = raw; }
    }
  }

  return { task, findings, issueBody };
}

/**
 * Architecture plan: read the Constraints Summary from docs/architecture.md.
 * Returns the full doc if no Constraints Summary section found.
 */
function getArchPlan() {
  const archPath = path.join(CONFIG.root, 'docs', 'architecture.md');
  if (!fs.existsSync(archPath)) return { exists: false, constraints: null, fullDoc: null };

  const content = fs.readFileSync(archPath, 'utf8');

  // Extract sections by heading
  const extractSection = (heading) => {
    const re = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |\\n$|$)`, 'm');
    const m = content.match(re);
    return m ? m[1].trim() : null;
  };

  return {
    exists: true,
    constraints: extractSection('Constraints Summary'),
    bannedPatterns: extractSection('Banned Patterns'),
    securityStandards: extractSection('Security Standards'),
    testingStandards: extractSection('Testing Standards'),
    codePatterns: extractSection('Code Patterns'),
    fullDoc: content,
  };
}

/**
 * Security findings filtered by status, severity, and/or source.
 */
async function getSecurityFindings(client, options = {}) {
  let where = [];
  let params = [];
  let idx = 1;

  if (options.status) { where.push(`status = $${idx++}`); params.push(options.status); }
  if (options.severity) { where.push(`severity = $${idx++}`); params.push(options.severity); }
  if (options.source) { where.push(`source = $${idx++}`); params.push(options.source); }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await client.query(
    `SELECT id, source, severity, confidence, location, category, description, impact,
            remediation, effort, status, issue_ref
     FROM findings ${whereClause}
     ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END
     LIMIT 50`,
    params
  );
  return { count: rows.length, findings: rows };
}

/**
 * Recent architectural decisions.
 */
async function getRecentDecisions(client, limit = 20) {
  const { rows } = await client.query(
    'SELECT topic, decision, reason, created_at FROM decisions ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return { count: rows.length, decisions: rows };
}

/**
 * Active gotchas (critical constraints agents must respect).
 */
async function getActiveGotchas(client) {
  const { rows } = await client.query(
    'SELECT id, issue, rule FROM gotchas WHERE active = TRUE ORDER BY id'
  );
  return { count: rows.length, gotchas: rows };
}

/**
 * Session context: last session + open tasks + gotcha count.
 */
async function getSessionContext(client) {
  const { rows: sessions } = await client.query(
    'SELECT num, date, summary, tests FROM sessions ORDER BY num DESC LIMIT 1'
  );
  const { rows: tasks } = await client.query(
    "SELECT id, title, status, issue_ref FROM tasks WHERE status NOT IN ('done', 'deferred') ORDER BY id"
  );
  const { rows: [{ count: gotchaCount }] } = await client.query(
    'SELECT COUNT(*) FROM gotchas WHERE active = TRUE'
  );
  return {
    lastSession: sessions[0] || null,
    openTasks: tasks,
    activeGotchaCount: parseInt(gotchaCount),
  };
}

/**
 * Build state from .claude/build-state.json for a given plan.
 */
function getBuildState(planPath) {
  const statePath = path.join(CONFIG.root, '.claude', 'build-state.json');
  if (!fs.existsSync(statePath)) return { exists: false, state: null };

  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (planPath && state.plan !== planPath) return { exists: true, state: null, mismatch: true };
    return { exists: true, state };
  } catch (_) {
    return { exists: true, state: null, parseError: true };
  }
}

/**
 * Issue context: body + comments for A2A communication.
 * Uses platform.js (no shell) to prevent injection and support multiple platforms.
 */
function getGitHubContext(issueNum) {
  const num = String(issueNum);
  const raw = platform(['issue', 'view', num]);
  if (!raw) return { error: `Could not fetch issue #${num} — platform CLI not available or issue not found` };

  let issue;
  try { issue = JSON.parse(raw); } catch (_) {
    return { error: `Could not parse issue #${num} response` };
  }

  // platform.js issue view returns title,body,state,comments,labels
  const comments = issue.comments
    ? issue.comments.map((c) => c.body).join('\n---\n')
    : '(no comments)';

  return {
    issue,
    comments,
  };
}

/**
 * Full implementer context: everything an agent needs to work on a task.
 * Combines task, arch plan, active gotchas, and relevant findings.
 */
async function getFullContext(client, taskId) {
  const task = await getTaskContext(client, taskId);
  const arch = getArchPlan();
  const gotchas = await getActiveGotchas(client);
  const decisions = await getRecentDecisions(client, 10);
  const openFindings = await getSecurityFindings(client, { status: 'triaged' });

  return { task, arch, gotchas, decisions, openFindings };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function formatForPrompt(data) {
  return JSON.stringify(data, null, 2);
}

async function cli() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
${c.bold('pipeline-context.js')} — Data access layer for agent context injection

  ${c.cyan('task')} <id>              Task context + related findings
  ${c.cyan('arch-plan')}              Architecture constraints summary
  ${c.cyan('findings')} [opts]        Security findings (--status X --severity Y --source Z)
  ${c.cyan('decisions')} [limit]      Recent architectural decisions
  ${c.cyan('gotchas')}                Active critical constraints
  ${c.cyan('session')}                Last session + open tasks
  ${c.cyan('build-state')} <plan>     Build progress from state file
  ${c.cyan('github')} <issue-num>     GitHub issue body + comments
  ${c.cyan('full')} <task-id>         Full implementer context (all of the above)

Output is JSON — pipe to prompts or read programmatically.
`);
    return;
  }

  // Commands that don't need Postgres
  if (cmd === 'arch-plan') {
    console.log(formatForPrompt(getArchPlan()));
    return;
  }
  if (cmd === 'build-state') {
    console.log(formatForPrompt(getBuildState(args[0])));
    return;
  }
  if (cmd === 'github') {
    if (!args[0]) { console.error('Usage: github <issue-num>'); process.exit(1); }
    console.log(formatForPrompt(getGitHubContext(args[0])));
    return;
  }

  // Commands that need Postgres
  const client = await connect(CONFIG);
  try {
    if (cmd === 'task') {
      if (!args[0]) { console.error('Usage: task <id>'); process.exit(1); }
      console.log(formatForPrompt(await getTaskContext(client, parseInt(args[0]))));
    } else if (cmd === 'findings') {
      const opts = {};
      for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        opts[key] = args[i + 1];
      }
      console.log(formatForPrompt(await getSecurityFindings(client, opts)));
    } else if (cmd === 'decisions') {
      console.log(formatForPrompt(await getRecentDecisions(client, parseInt(args[0]) || 20)));
    } else if (cmd === 'gotchas') {
      console.log(formatForPrompt(await getActiveGotchas(client)));
    } else if (cmd === 'session') {
      console.log(formatForPrompt(await getSessionContext(client)));
    } else if (cmd === 'full') {
      if (!args[0]) { console.error('Usage: full <task-id>'); process.exit(1); }
      console.log(formatForPrompt(await getFullContext(client, parseInt(args[0]))));
    } else {
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

// ─── EXPORTS + ENTRY ────────────────────────────────────────────────────────

module.exports = {
  getTaskContext,
  getArchPlan,
  getSecurityFindings,
  getRecentDecisions,
  getActiveGotchas,
  getSessionContext,
  getBuildState,
  getGitHubContext,
  getFullContext,
};

if (require.main === module) {
  cli().catch(err => {
    console.error(c.red('Error: ') + err.message);
    process.exit(1);
  });
}
