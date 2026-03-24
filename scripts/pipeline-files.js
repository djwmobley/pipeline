#!/usr/bin/env node
/**
 * pipeline-files.js — File-based knowledge management (no Postgres required)
 *
 * Stores session records, gotchas, and decisions as plain markdown files
 * in the project directory. This is the default "files" tier.
 *
 * Usage:
 *   node pipeline-files.js status                                  # Show recent sessions, gotchas
 *   node pipeline-files.js session <N> <tests> "<desc>"            # Record session N
 *   node pipeline-files.js gotcha "<issue>" "<rule>"               # Append a gotcha
 *   node pipeline-files.js decision "<topic>" "<decision>" "<reason>"  # Record a decision
 *   node pipeline-files.js prune                                      # Archive stale decisions, rotate sessions
 */

const fs = require('fs');
const path = require('path');
const { findProjectRoot, c } = require('./lib/shared');

const ROOT = findProjectRoot();
const SESSIONS_DIR = path.join(ROOT, 'docs', 'sessions');
const GOTCHAS_PATH = path.join(ROOT, 'docs', 'gotchas.md');
const DECISIONS_PATH = path.join(ROOT, 'DECISIONS.md');
const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive');

const MAX_SESSIONS = 5;
const DECISION_RETAIN_DAYS = 7;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

// ─── STATUS ───────────────────────────────────────────────────────────────────

function cmdStatus() {
  console.log(c.bold('\n=== Pipeline Status (files tier) ===\n'));

  // Sessions
  if (fs.existsSync(SESSIONS_DIR)) {
    const files = fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-3);

    if (files.length > 0) {
      console.log(c.cyan('Recent sessions:'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8');
        const summaryMatch = content.match(/^\*\*Summary:\*\*\s*(.+)$/m);
        const dateMatch = content.match(/^\*\*Date:\*\*\s*(.+)$/m);
        const testsMatch = content.match(/^\*\*Tests:\*\*\s*(.+)$/m);
        const numMatch = file.match(/^(\d+)\.md$/);
        const num = numMatch ? parseInt(numMatch[1]) : file;
        const summary = summaryMatch ? summaryMatch[1] : '(no summary)';
        const date = dateMatch ? dateMatch[1] : '';
        const tests = testsMatch ? testsMatch[1] : '';
        console.log(`  ${c.bold(`S${num}`)} ${c.dim(date)} tests:${tests} — ${summary}`);
      }
    } else {
      console.log(c.dim('No sessions recorded yet.'));
    }
  } else {
    console.log(c.dim('No sessions recorded yet.'));
  }

  // Gotchas
  if (fs.existsSync(GOTCHAS_PATH)) {
    const content = fs.readFileSync(GOTCHAS_PATH, 'utf8');
    const entries = content.split('---').filter(s => s.trim() && !s.trim().startsWith('# Gotchas'));
    if (entries.length > 0) {
      console.log(c.yellow(`\nGotchas (${entries.length}):`));
      for (const entry of entries) {
        const lines = entry.trim().split('\n').filter(Boolean);
        const title = lines[0] ? lines[0].replace(/^###\s*/, '') : '(untitled)';
        const rule = lines.slice(1).join(' ').trim();
        console.log(`  ${c.red('!')} ${c.bold(title)}`);
        if (rule) console.log(`    ${c.dim(rule)}`);
      }
    }
  }

  // Decisions (show count)
  if (fs.existsSync(DECISIONS_PATH)) {
    const content = fs.readFileSync(DECISIONS_PATH, 'utf8');
    const count = (content.match(/^###\s+/gm) || []).length;
    if (count > 0) {
      console.log(c.cyan(`\nDecisions: ${count} recorded`) + c.dim(` (see DECISIONS.md)`));
    }
  }

  console.log();
}

// ─── SESSION ──────────────────────────────────────────────────────────────────

function cmdSession(num, tests, desc) {
  if (!num || tests === undefined || !desc) {
    console.error(c.red('Usage: ') + 'pipeline-files.js session <N> <tests> "<description>"');
    process.exit(1);
  }

  ensureDir(SESSIONS_DIR);

  const filename = `${pad3(parseInt(num))}.md`;
  const filepath = path.join(SESSIONS_DIR, filename);

  const content = `# Session ${num}

**Date:** ${today()}
**Tests:** ${tests}
**Summary:** ${desc}
`;

  fs.writeFileSync(filepath, content, 'utf8');
  console.log(c.green('Session recorded: ') + filepath);

  // Rotate: keep only the most recent MAX_SESSIONS files
  const allSessions = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();
  if (allSessions.length > MAX_SESSIONS) {
    const toDelete = allSessions.slice(0, allSessions.length - MAX_SESSIONS);
    for (const old of toDelete) {
      fs.unlinkSync(path.join(SESSIONS_DIR, old));
    }
    console.log(c.dim(`Rotated: removed ${toDelete.length} old session(s), keeping ${MAX_SESSIONS}`));
  }
}

// ─── GOTCHA ───────────────────────────────────────────────────────────────────

function cmdGotcha(issue, rule) {
  if (!issue || !rule) {
    console.error(c.red('Usage: ') + 'pipeline-files.js gotcha "<issue>" "<rule>"');
    process.exit(1);
  }

  ensureDir(path.dirname(GOTCHAS_PATH));

  if (!fs.existsSync(GOTCHAS_PATH)) {
    fs.writeFileSync(GOTCHAS_PATH, '# Gotchas\n\n', 'utf8');
  }

  const entry = `### ${issue}\n${rule}\n\n---\n\n`;
  fs.appendFileSync(GOTCHAS_PATH, entry, 'utf8');
  console.log(c.green('Gotcha added: ') + issue);
}

// ─── DECISION ─────────────────────────────────────────────────────────────────

function cmdDecision(topic, decision, reason) {
  if (!topic || !decision || !reason) {
    console.error(c.red('Usage: ') + 'pipeline-files.js decision "<topic>" "<decision>" "<reason>"');
    process.exit(1);
  }

  if (!fs.existsSync(DECISIONS_PATH)) {
    fs.writeFileSync(DECISIONS_PATH, '# Decisions\n\n', 'utf8');
  }

  const entry = `### ${topic}\n**Decision:** ${decision}\n**Reason:** ${reason}\n**Date:** ${today()}\n\n---\n\n`;
  fs.appendFileSync(DECISIONS_PATH, entry, 'utf8');
  console.log(c.green('Decision recorded: ') + topic);
}

// ─── PRUNE ────────────────────────────────────────────────────────────────────

function cmdPrune() {
  let pruned = 0;

  // Prune decisions: keep [LOCKED] + last DECISION_RETAIN_DAYS days
  if (fs.existsSync(DECISIONS_PATH)) {
    const content = fs.readFileSync(DECISIONS_PATH, 'utf8');
    const header = '# Decisions\n\n';
    const entries = content.replace(/^# Decisions\s*\n*/, '').split('---').filter(s => s.trim());

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DECISION_RETAIN_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const keep = [];
    const archive = [];

    for (const entry of entries) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const isLocked = trimmed.includes('[LOCKED]');
      const dateMatch = trimmed.match(/\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/);
      const entryDate = dateMatch ? dateMatch[1] : null;

      if (isLocked || (entryDate && entryDate >= cutoffStr)) {
        keep.push(trimmed);
      } else {
        archive.push(trimmed);
        pruned++;
      }
    }

    // Archive old decisions
    if (archive.length > 0) {
      ensureDir(ARCHIVE_DIR);
      const archivePath = path.join(ARCHIVE_DIR, `decisions-${today()}.md`);
      const archiveContent = archive.map(e => `${e}\n\n---\n`).join('\n');

      if (fs.existsSync(archivePath)) {
        fs.appendFileSync(archivePath, '\n' + archiveContent, 'utf8');
      } else {
        fs.writeFileSync(archivePath, `# Archived Decisions — ${today()}\n\n${archiveContent}`, 'utf8');
      }
    }

    // Rewrite DECISIONS.md with only kept entries
    const kept = keep.length > 0
      ? header + keep.map(e => `${e}\n\n---\n`).join('\n')
      : header;
    fs.writeFileSync(DECISIONS_PATH, kept, 'utf8');
  }

  if (pruned > 0) {
    console.log(c.green(`Pruned: ${pruned} stale decision(s) archived to docs/archive/`));
  } else {
    console.log(c.dim('Nothing to prune.'));
  }
}

// ─── HELP ─────────────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`
${c.bold('pipeline-files.js')} — File-based knowledge management

${c.cyan('Commands:')}
  ${c.bold('status')}                                    Show recent sessions, gotchas, decisions
  ${c.bold('session')} <N> <tests> "<desc>"              Record session N
  ${c.bold('gotcha')} "<issue>" "<rule>"                  Add a critical constraint
  ${c.bold('decision')} "<topic>" "<decision>" "<reason>" Record an architectural decision
  ${c.bold('prune')}                                     Archive stale decisions, rotate sessions
  ${c.bold('help')}                                      Show this message

${c.cyan('Storage:')}
  docs/sessions/NNN.md   Session records
  docs/gotchas.md        Critical constraints
  DECISIONS.md           Architectural decisions
`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

(async () => {
  try {
    switch (cmd) {
      case 'status':
        cmdStatus();
        break;
      case 'session':
        cmdSession(args[0], args[1], args[2]);
        break;
      case 'gotcha':
        cmdGotcha(args[0], args[1]);
        break;
      case 'decision':
        cmdDecision(args[0], args[1], args[2]);
        break;
      case 'prune':
        cmdPrune();
        break;
      case 'help':
      case undefined:
        cmdHelp();
        break;
      default:
        console.error(c.red(`Unknown command: ${cmd}`));
        cmdHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(c.red('Error: ') + err.message);
    process.exit(1);
  }
})();
