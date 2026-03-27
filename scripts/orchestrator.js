#!/usr/bin/env node
/**
 * orchestrator.js — Content-blind state machine for pipeline workflow routing
 *
 * Routes between pipeline steps based on input availability and status codes.
 * Does NOT read file content or reason about findings — only checks existence,
 * status fields, and counts.
 *
 * Usage:
 *   node orchestrator.js status [workflow-id]      # Show current workflow state
 *   node orchestrator.js next [workflow-id]         # Determine and show next step
 *   node orchestrator.js start <workflow-id>        # Initialize a new workflow
 *   node orchestrator.js complete <step> <result>   # Record step completion
 *   node orchestrator.js check <step>               # Check if step's inputs are met
 *   node orchestrator.js graph                      # Print the step graph
 *
 * The orchestrator is called BY commands (e.g., /pipeline:build calls
 * `orchestrator.js complete build PASS` after building). It does not
 * invoke commands itself — it provides routing decisions.
 */

const { loadConfig, connect, c } = require('./lib/shared');
const fs = require('fs');
const path = require('path');

const CONFIG = loadConfig();

// ─── STEP GRAPH ─────────────────────────────────────────────────────────────
// Each step defines: inputs (preconditions), outputs (artifacts), and transitions.
// The orchestrator checks inputs before allowing a step to run.
//
// SECURITY: Step names are static constants. Never populate from user input.

const STEPS = {
  init: {
    order: 1,
    inputs: [],  // no preconditions — entry point
    outputs: [{ type: 'file', path: '.claude/pipeline.yml' }],
    next: 'brainstorm',
    required: true,
  },
  brainstorm: {
    order: 2,
    inputs: [{ type: 'file', path: '.claude/pipeline.yml' }],
    outputs: [{ type: 'glob', pattern: 'docs/specs/*.md' }],
    next: 'plan',
    required: true,
  },
  plan: {
    order: 3,
    inputs: [{ type: 'glob', pattern: 'docs/specs/*.md' }],
    outputs: [{ type: 'glob', pattern: 'docs/plans/*.md' }],
    next: 'debate',
    required: true,
  },
  debate: {
    order: 4,
    inputs: [{ type: 'glob', pattern: 'docs/plans/*.md' }],
    outputs: [{ type: 'glob', pattern: 'docs/findings/debate-*.md' }],
    next: 'architect',
    required: false,  // user can skip — MAY checkpoint
  },
  architect: {
    order: 5,
    inputs: [{ type: 'glob', pattern: 'docs/plans/*.md' }],
    outputs: [{ type: 'file', path: 'docs/architecture.md' }],
    next: 'build',
    required: false,  // auto-invoked for LARGE+, optional otherwise
  },
  build: {
    order: 6,
    inputs: [{ type: 'glob', pattern: 'docs/plans/*.md' }],
    outputs: [{ type: 'branch', description: 'feature branch with commits' }],
    next: 'review',
    required: true,
  },
  review: {
    order: 7,
    inputs: [{ type: 'branch', description: 'feature branch exists' }],
    outputs: [{ type: 'status', field: 'review_result' }],  // PASS or FAIL
    next: 'qa',
    required: true,
    onFail: 'build',  // review failure → back to build to fix
  },
  qa: {
    order: 8,
    inputs: [
      { type: 'status', step: 'review', expect: 'PASS' },
    ],
    outputs: [{ type: 'status', field: 'qa_result' }],
    next: 'redteam',
    required: true,
    onFail: 'build',  // qa failure → back to build
  },
  redteam: {
    order: 9,
    inputs: [
      { type: 'status', step: 'qa', expect: 'PASS' },
    ],
    outputs: [{ type: 'glob', pattern: 'docs/findings/redteam-*.md' }],
    next: 'purple',
    required: false,  // can skip for non-security-critical projects
  },
  purple: {
    order: 10,
    inputs: [{ type: 'glob', pattern: 'docs/findings/redteam-*.md' }],
    outputs: [{ type: 'status', field: 'purple_result' }],
    next: 'commit',
    required: false,  // only if redteam ran
    loopback: {
      // If purple fails on same finding 2+ times → route to architect
      maxFails: 2,
      target: 'architect',
      reason: 'Finding failed verification twice — the standard may be broken, not the fix',
    },
  },
  commit: {
    order: 11,
    inputs: [
      { type: 'status', step: 'review', expect: 'PASS' },
      { type: 'status', step: 'qa', expect: 'PASS' },
    ],
    outputs: [{ type: 'status', field: 'commit_ready' }],
    next: 'finish',
    required: true,
  },
  finish: {
    order: 12,
    inputs: [{ type: 'status', step: 'commit', expect: 'PASS' }],
    outputs: [{ type: 'status', field: 'merged' }],
    next: 'deploy',
    required: true,
  },
  deploy: {
    order: 13,
    inputs: [{ type: 'status', step: 'finish', expect: 'PASS' }],
    outputs: [{ type: 'status', field: 'deployed' }],
    next: null,  // terminal
    required: false,  // not all projects deploy via pipeline
  },
};

const STEP_NAMES = Object.keys(STEPS);

// ─── INPUT CHECKING ─────────────────────────────────────────────────────────
// Content-blind: checks file existence and Postgres status, never reads content.

function checkFileInput(input) {
  const fullPath = path.join(CONFIG.root, input.path);
  return fs.existsSync(fullPath);
}

function checkGlobInput(input) {
  // Simple glob: check if any file matches the pattern in the directory
  const dir = path.join(CONFIG.root, path.dirname(input.pattern));
  const base = path.basename(input.pattern).replace('*', '');
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir);
  return files.some(f => f.endsWith(base) || f.includes(base.replace('.md', '')));
}

async function checkStatusInput(client, workflowId, input) {
  const { rows } = await client.query(
    "SELECT result_code FROM workflow_state WHERE workflow_id = $1 AND step = $2 AND status = 'done' ORDER BY completed_at DESC LIMIT 1",
    [workflowId, input.step]
  );
  if (rows.length === 0) return false;
  return rows[0].result_code === input.expect;
}

async function checkInputs(client, workflowId, step) {
  const stepDef = STEPS[step];
  if (!stepDef) return { met: false, missing: [`Unknown step: ${step}`] };

  const missing = [];
  for (const input of stepDef.inputs) {
    let met = false;
    if (input.type === 'file') met = checkFileInput(input);
    else if (input.type === 'glob') met = checkGlobInput(input);
    else if (input.type === 'status') met = await checkStatusInput(client, workflowId, input);
    else if (input.type === 'branch') met = true; // checked externally by git

    if (!met) missing.push(input);
  }

  return { met: missing.length === 0, missing };
}

// ─── WORKFLOW STATE ─────────────────────────────────────────────────────────

async function getWorkflowState(client, workflowId) {
  const { rows } = await client.query(
    'SELECT step, status, result_code, fail_count, output_artifact, started_at, completed_at FROM workflow_state WHERE workflow_id = $1 ORDER BY created_at',
    [workflowId]
  );
  return rows;
}

async function getCurrentStep(client, workflowId) {
  const { rows } = await client.query(
    "SELECT step, status, result_code FROM workflow_state WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1",
    [workflowId]
  );
  return rows[0] || null;
}

async function getLatestWorkflowId(client) {
  const { rows } = await client.query(
    "SELECT DISTINCT workflow_id FROM workflow_state ORDER BY workflow_id DESC LIMIT 1"
  );
  return rows[0]?.workflow_id || null;
}

// ─── COMMANDS ───────────────────────────────────────────────────────────────

async function cmdStatus(client, workflowId) {
  const wfId = workflowId || await getLatestWorkflowId(client);
  if (!wfId) { console.log(c.yellow('No active workflow. Start one with: orchestrator.js start <workflow-id>')); return; }

  const states = await getWorkflowState(client, wfId);
  console.log(`${c.bold(`Workflow: ${wfId}`)}\n`);

  if (states.length === 0) {
    console.log(c.dim('No steps recorded yet.'));
    return;
  }

  for (const s of states) {
    const icon = s.status === 'done' ? (s.result_code === 'PASS' ? c.green('✓') : c.red('✗'))
      : s.status === 'running' ? c.cyan('►')
      : s.status === 'skipped' ? c.dim('○')
      : c.dim('·');
    const result = s.result_code ? ` [${s.result_code}]` : '';
    const fails = s.fail_count > 0 ? c.red(` (${s.fail_count} fails)`) : '';
    console.log(`  ${icon} ${s.step}${result}${fails}`);
  }
}

async function cmdNext(client, workflowId) {
  const wfId = workflowId || await getLatestWorkflowId(client);
  if (!wfId) { console.log(c.yellow('No active workflow.')); return; }

  const current = await getCurrentStep(client, wfId);

  // If current step is still running, report it
  if (current && current.status === 'running') {
    console.log(`${c.cyan('Running:')} ${current.step}`);
    return;
  }

  // If current step failed, check loopback rules
  if (current && current.status === 'done' && current.result_code === 'FAIL') {
    const stepDef = STEPS[current.step];

    // Check loopback rule (e.g., purple fail ≥ 2 → architect)
    if (stepDef?.loopback) {
      const { rows: [{ fail_count }] } = await client.query(
        "SELECT COALESCE(MAX(fail_count), 0) as fail_count FROM workflow_state WHERE workflow_id = $1 AND step = $2",
        [wfId, current.step]
      );
      if (parseInt(fail_count) >= stepDef.loopback.maxFails) {
        console.log(`${c.red('Loopback:')} ${current.step} failed ${fail_count}x → routing to ${c.bold(stepDef.loopback.target)}`);
        console.log(c.dim(`  Reason: ${stepDef.loopback.reason}`));
        console.log(JSON.stringify({ next: stepDef.loopback.target, reason: 'loopback', fails: parseInt(fail_count) }));
        return;
      }
    }

    // Regular failure routing
    if (stepDef?.onFail) {
      console.log(`${c.red('Failed:')} ${current.step} → routing back to ${c.bold(stepDef.onFail)}`);
      console.log(JSON.stringify({ next: stepDef.onFail, reason: 'failure' }));
      return;
    }
  }

  // Determine next step
  let nextStep = current ? STEPS[current.step]?.next : 'init';
  if (!nextStep) {
    console.log(c.green('Workflow complete — all steps done.'));
    return;
  }

  // Check inputs for next step
  const { met, missing } = await checkInputs(client, wfId, nextStep);

  // Skip non-required steps with unmet inputs
  if (!met && !STEPS[nextStep].required) {
    console.log(c.dim(`Skipping ${nextStep} (optional, inputs not met)`));
    // Record as skipped
    await client.query(
      "INSERT INTO workflow_state (workflow_id, step, status) VALUES ($1, $2, 'skipped')",
      [wfId, nextStep]
    );
    nextStep = STEPS[nextStep].next;
    if (!nextStep) { console.log(c.green('Workflow complete.')); return; }
  }

  if (met) {
    console.log(`${c.green('Next:')} ${c.bold(nextStep)} — inputs satisfied`);
    console.log(JSON.stringify({ next: nextStep, inputs: 'met' }));
  } else {
    console.log(`${c.yellow('Blocked:')} ${nextStep} — missing inputs:`);
    missing.forEach(m => {
      if (m.type === 'file') console.log(`  ${c.dim('•')} File: ${m.path}`);
      else if (m.type === 'glob') console.log(`  ${c.dim('•')} Files matching: ${m.pattern}`);
      else if (m.type === 'status') console.log(`  ${c.dim('•')} Step ${m.step} must be ${m.expect}`);
    });
    console.log(JSON.stringify({ next: nextStep, inputs: 'blocked', missing }));
  }
}

async function cmdStart(client, workflowId) {
  if (!workflowId) { console.error('Usage: start <workflow-id>'); process.exit(1); }

  // Check if workflow already exists
  const { rows } = await client.query(
    'SELECT COUNT(*) FROM workflow_state WHERE workflow_id = $1',
    [workflowId]
  );
  if (parseInt(rows[0].count) > 0) {
    console.error(c.red(`Workflow "${workflowId}" already exists. Use a different ID or check status.`));
    process.exit(1);
  }

  // Create initial state
  await client.query(
    "INSERT INTO workflow_state (workflow_id, step, status, inputs_met) VALUES ($1, 'init', 'pending', true)",
    [workflowId]
  );
  console.log(c.green(`Workflow "${workflowId}" started. Next step: init`));
}

async function cmdComplete(client, workflowId, step, resultCode, artifact) {
  if (!step || !resultCode) {
    console.error('Usage: complete <step> <PASS|FAIL|PARTIAL|BLOCKED> [artifact-path]');
    process.exit(1);
  }

  const wfId = workflowId || await getLatestWorkflowId(client);
  if (!wfId) { console.error(c.red('No active workflow.')); process.exit(1); }

  // Get current fail count for this step in this workflow
  const { rows: existing } = await client.query(
    "SELECT fail_count FROM workflow_state WHERE workflow_id = $1 AND step = $2 ORDER BY created_at DESC LIMIT 1",
    [wfId, step]
  );
  const prevFails = existing.length > 0 ? existing[0].fail_count : 0;
  const newFails = resultCode === 'FAIL' ? prevFails + 1 : 0;

  await client.query(
    `INSERT INTO workflow_state (workflow_id, step, status, result_code, fail_count, inputs_met, output_artifact, started_at, completed_at)
     VALUES ($1, $2, 'done', $3, $4, true, $5, NOW(), NOW())`,
    [wfId, step, resultCode, newFails, artifact || null]
  );

  const icon = resultCode === 'PASS' ? c.green('✓') : resultCode === 'FAIL' ? c.red('✗') : c.yellow('~');
  console.log(`${icon} ${step}: ${resultCode}${newFails > 0 ? c.red(` (fail #${newFails})`) : ''}`);

  // Show what's next
  await cmdNext(client, wfId);
}

async function cmdCheck(client, workflowId, step) {
  if (!step) { console.error('Usage: check <step>'); process.exit(1); }

  const wfId = workflowId || await getLatestWorkflowId(client);
  const { met, missing } = await checkInputs(client, wfId, step);

  if (met) {
    console.log(c.green(`${step}: all inputs met — ready to run`));
  } else {
    console.log(c.yellow(`${step}: blocked`));
    missing.forEach(m => {
      if (m.type === 'file') console.log(`  ${c.dim('•')} Missing file: ${m.path}`);
      else if (m.type === 'glob') console.log(`  ${c.dim('•')} No files matching: ${m.pattern}`);
      else if (m.type === 'status') console.log(`  ${c.dim('•')} Step ${m.step} must be ${m.expect}`);
    });
  }
  console.log(JSON.stringify({ step, met, missing }));
}

function cmdGraph() {
  console.log(`${c.bold('Pipeline Step Graph')}\n`);
  for (const [name, def] of Object.entries(STEPS)) {
    const req = def.required ? '' : c.dim(' (optional)');
    const next = def.next ? `→ ${def.next}` : c.green('(done)');
    const fail = def.onFail ? c.red(` | fail → ${def.onFail}`) : '';
    const loop = def.loopback ? c.red(` | ${def.loopback.maxFails}x fail → ${def.loopback.target}`) : '';
    const inputs = def.inputs.length > 0
      ? def.inputs.map(i => {
          if (i.type === 'file') return i.path;
          if (i.type === 'glob') return i.pattern;
          if (i.type === 'status') return `${i.step}=${i.expect}`;
          if (i.type === 'branch') return i.description || 'branch';
          return i.type;
        }).join(', ')
      : 'none';

    console.log(`  ${c.cyan(String(def.order).padStart(2))}. ${c.bold(name)}${req}`);
    console.log(`     inputs: ${c.dim(inputs)}`);
    console.log(`     ${next}${fail}${loop}\n`);
  }
}

// ─── CLI ENTRY ──────────────────────────────────────────────────────────────

async function cli() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
${c.bold('orchestrator.js')} — Content-blind workflow routing

  ${c.cyan('status')} [workflow-id]      Show workflow state
  ${c.cyan('next')} [workflow-id]        Determine next step
  ${c.cyan('start')} <workflow-id>       Initialize a new workflow
  ${c.cyan('complete')} <step> <result>  Record step completion (PASS/FAIL/PARTIAL/BLOCKED)
  ${c.cyan('check')} <step>             Check if step inputs are met
  ${c.cyan('graph')}                    Print the step graph
`);
    return;
  }

  if (cmd === 'graph') { cmdGraph(); return; }

  const client = await connect(CONFIG);
  try {
    if (cmd === 'status') {
      await cmdStatus(client, args[0]);
    } else if (cmd === 'next') {
      await cmdNext(client, args[0]);
    } else if (cmd === 'start') {
      await cmdStart(client, args[0]);
    } else if (cmd === 'complete') {
      await cmdComplete(client, null, args[0], args[1], args[2]);
    } else if (cmd === 'check') {
      await cmdCheck(client, null, args[0]);
    } else {
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = { STEPS, STEP_NAMES, checkInputs, getWorkflowState, getCurrentStep };

if (require.main === module) {
  cli().catch(err => {
    console.error(c.red('Error: ') + err.message);
    process.exit(1);
  });
}
