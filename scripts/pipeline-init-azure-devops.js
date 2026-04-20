#!/usr/bin/env node
// pipeline-init-azure-devops.js — Windows-safe Azure DevOps verification helper.
// Mechanical az CLI invocations for the init-azure-devops subagent. The subagent
// (dispatched via Task tool from commands/init.md Step 1c) interprets the structured
// JSON output via the error-interpretation table in skills/init-azure-devops/SKILL.md.
//
// Subcommands:
//   verify --org <org> --project <project>      — runs three az calls, each reported
//                                                  as a separate step in the output JSON:
//                                                  (1) az extension show --name azure-devops
//                                                  (2) az account show
//                                                  (3) az devops project show
//   detect-process-template --org <org> --project <project>
//                                                — runs az devops project show with
//                                                  --query capabilities.processTemplate.templateName
//   set-defaults --org <org> --project <project>
//                                                — runs az devops configure --defaults
//                                                  organization=https://dev.azure.com/<org>
//                                                  project=<project>
//
// Safety:
//   - runWinBin (from lib/shared.js) wraps execFileSync with two Windows fixes:
//     * PATHEXT resolution via az.cmd → az.exe → az candidate order (ENOENT → next).
//     * CVE-2024-27980 hardening: .cmd/.bat invocations on Node 22+ that would
//       EINVAL-fail are rerouted via `cmd.exe /d /s /c` with quoted args.
//   - 10s timeout per az call.
//   - AZURE_DEVOPS_EXT_PAT presence flag only in output; never log the value.
//
// Exit codes:
//   0 — helper invocation succeeded (even if individual az calls returned non-zero;
//       those are reported in the JSON for the subagent to interpret).
//   1 — helper itself failed (az not on PATH, missing required flag, etc.) — caller
//       should treat as a hard stop rather than an ADO-specific error.

const { runWinBin } = require('./lib/shared');

const AZ_CANDIDATES = ['az.cmd', 'az.exe', 'az'];
const DEFAULT_TIMEOUT_MS = 10000;

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

function requireFlag(flags, name) {
  if (!flags[name] || flags[name] === true) {
    process.stderr.write(`init-azure-devops: missing required --${name}\n`);
    process.exit(1);
  }
  return flags[name];
}

// ─── AZ INVOCATION ─────────────────────────────────────────────────────────
// Wraps runWinBin with duration capture and a uniform {bin, args, exit_code,
// stdout_first_line, stderr_first_line, duration_ms} result shape that the
// subagent can reason over without pg_typeof-style conditionals. Command-level
// failures (non-zero az exit, timeout) return a result — the subagent interprets
// via skills/init-azure-devops/SKILL.md's error table. Invocation-level failures
// (az not found on PATH) exit the helper non-zero for caller hard-stop handling.

function runAz(args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const start = Date.now();
  try {
    const stdout = runWinBin(AZ_CANDIDATES, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    return {
      bin: AZ_CANDIDATES[0],
      args,
      exit_code: 0,
      stdout_first_line: (stdout || '').trim().split('\n')[0] || null,
      stderr_first_line: null,
      duration_ms: Date.now() - start,
    };
  } catch (e) {
    if (e.code === 'ENOENT') {
      process.stderr.write(`init-azure-devops: az CLI not found on PATH (tried: ${AZ_CANDIDATES.join(', ')}): ${e.message.split('\n')[0]}\n`);
      process.exit(1);
    }
    // Non-ENOENT: az ran but exited non-zero, or timed out.
    const stdout = e.stdout ? e.stdout.toString('utf8').trim() : '';
    const stderr = e.stderr ? e.stderr.toString('utf8').trim() : '';
    const isTimeout = e.code === 'ETIMEDOUT' || e.signal === 'SIGTERM';
    return {
      bin: AZ_CANDIDATES[0],
      args,
      exit_code: typeof e.status === 'number' ? e.status : (isTimeout ? -1 : -2),
      stdout_first_line: stdout.split('\n')[0] || null,
      stderr_first_line: stderr.split('\n')[0] || (isTimeout ? 'timeout' : e.message.split('\n')[0]),
      duration_ms: Date.now() - start,
      timed_out: isTimeout || undefined,
    };
  }
}

// ─── ENV REDACTION ─────────────────────────────────────────────────────────
// Never log PAT values. Surface presence only so the subagent can reason about auth
// mode without leaking secrets.

function envVarsFlags() {
  return {
    azure_devops_ext_pat_set: !!process.env.AZURE_DEVOPS_EXT_PAT,
    azure_subscription_set: !!process.env.AZURE_SUBSCRIPTION_ID,
  };
}

// ─── SUBCOMMANDS ───────────────────────────────────────────────────────────

function cmdVerify(flags) {
  const org = requireFlag(flags, 'org');
  const project = requireFlag(flags, 'project');
  const orgUrl = `https://dev.azure.com/${org}`;

  const steps = [];

  // Step 1: extension check.
  const extension_check = runAz(['extension', 'show', '--name', 'azure-devops', '--query', 'version', '--output', 'tsv']);
  steps.push({ stage: 'extension_check', ...extension_check });

  // Step 2: account show (auth verification). Only run if extension is present; if not,
  // the subsequent call will fail with an unhelpful error.
  if (extension_check.exit_code === 0) {
    const account_show = runAz(['account', 'show', '--query', 'name', '--output', 'tsv']);
    steps.push({ stage: 'account_show', ...account_show });

    // Step 3: project access. Only if auth check passed.
    if (account_show.exit_code === 0) {
      const project_show = runAz([
        'devops', 'project', 'show',
        '--project', project,
        '--org', orgUrl,
        '--query', 'name',
        '--output', 'tsv',
      ]);
      steps.push({ stage: 'project_show', ...project_show });
    }
  }

  process.stdout.write(JSON.stringify({
    subcommand: 'verify',
    org,
    project,
    org_url: orgUrl,
    env_vars: envVarsFlags(),
    steps,
  }, null, 2) + '\n');
}

function cmdDetectProcessTemplate(flags) {
  const org = requireFlag(flags, 'org');
  const project = requireFlag(flags, 'project');
  const orgUrl = `https://dev.azure.com/${org}`;

  const result = runAz([
    'devops', 'project', 'show',
    '--project', project,
    '--org', orgUrl,
    '--query', 'capabilities.processTemplate.templateName',
    '--output', 'tsv',
  ]);

  process.stdout.write(JSON.stringify({
    subcommand: 'detect-process-template',
    org,
    project,
    org_url: orgUrl,
    process_template: result.exit_code === 0 ? result.stdout_first_line : null,
    step: { stage: 'process_template', ...result },
  }, null, 2) + '\n');
}

function cmdSetDefaults(flags) {
  const org = requireFlag(flags, 'org');
  const project = requireFlag(flags, 'project');
  const orgUrl = `https://dev.azure.com/${org}`;

  const result = runAz([
    'devops', 'configure', '--defaults',
    `organization=${orgUrl}`,
    `project=${project}`,
  ]);

  process.stdout.write(JSON.stringify({
    subcommand: 'set-defaults',
    org,
    project,
    org_url: orgUrl,
    step: { stage: 'set_defaults', ...result },
  }, null, 2) + '\n');
}

// ─── DISPATCH ──────────────────────────────────────────────────────────────

function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (subcommand) {
    case 'verify':
      cmdVerify(flags);
      break;
    case 'detect-process-template':
      cmdDetectProcessTemplate(flags);
      break;
    case 'set-defaults':
      cmdSetDefaults(flags);
      break;
    default:
      process.stderr.write(
        `Usage: node pipeline-init-azure-devops.js <subcommand> [options]\n` +
        `  verify                  --org <org> --project <project>\n` +
        `  detect-process-template --org <org> --project <project>\n` +
        `  set-defaults            --org <org> --project <project>\n`
      );
      process.exit(1);
  }
}

main();
