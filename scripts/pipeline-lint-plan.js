#!/usr/bin/env node
/**
 * pipeline-lint-plan.js — Deterministic structural linter for Pipeline plan markdown documents.
 *
 * Validates that the ## QA Strategy section's claims (Task IDs, file paths,
 * function/field names, decision references) actually resolve against the plan body
 * and the filesystem. Fabricated references fail CI / block the planning ceremony.
 *
 * Usage:
 *   node scripts/pipeline-lint-plan.js --plan <path> [--strict|--lenient] [--json] [--quiet]
 *   node scripts/pipeline-lint-plan.js --self-test
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — at least one finding (failed anchor resolution OR unanchored row in strict mode)
 *   2 — usage error or file not found
 *   3 — internal parser error (malformed plan structure preventing analysis)
 *
 * No external dependencies — Node.js stdlib only (fs, path).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── ANSI ────────────────────────────────────────────────────────────────────

const c = {
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  info:   (s) => `\x1b[34m${s}\x1b[0m`,
};

// ─── FINDING CLASS ───────────────────────────────────────────────────────────

class Finding {
  constructor({ rule, severity, line, rowId, message, suggestion }) {
    this.rule       = rule;
    this.severity   = severity;   // 'error' | 'warning' | 'info'
    this.line       = line;
    this.row_id     = rowId || null;
    this.message    = message;
    this.suggestion = suggestion || null;
  }
}

// ─── PLAN PARSER ─────────────────────────────────────────────────────────────

/**
 * parsePlan(markdownString) => {
 *   tasks,        // Map<string, { header, lineNo, filesBlock, codeBlocks }>
 *   decisions,    // Set<string> — e.g. 'DECISION-001'
 *   risks,        // Set<string> — e.g. 'R1'
 *   qaSection,    // { startLine, endLine, lines: string[], subsections }
 *   lines,        // string[] — all plan lines (0-indexed)
 * }
 */
function parsePlan(markdownString) {
  const lines = markdownString.split('\n');

  // ── Task discovery ────────────────────────────────────────────────────────
  // Match: ### Task N.M: ... (any casing, with or without colon)
  const taskRe = /^#{1,4}\s+Task\s+(\d+\.\d+)[\s:]/i;
  const tasks  = new Map();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(taskRe);
    if (!m) continue;
    const id = m[1]; // e.g. '1.5'

    // Collect **Files:** block below the task header (up to next task header or H2)
    let filesBlock = '';
    let j = i + 1;
    while (j < lines.length && !/^#{1,3}\s/.test(lines[j])) {
      if (/^\*\*Files:\*\*/i.test(lines[j].trim())) {
        j++;
        while (j < lines.length && (lines[j].trim() === '' || /^[-*]?\s*(Create|Modify|Read|Test):/.test(lines[j].trim()))) {
          filesBlock += lines[j] + '\n';
          j++;
        }
        break;
      }
      j++;
    }

    // Find where this task ends (next same-or-higher level heading)
    const taskHeadLevel = (lines[i].match(/^(#+)/) || ['', ''])[1].length;
    let taskEnd = lines.length;
    for (let l = i + 1; l < lines.length; l++) {
      const hm = lines[l].match(/^(#+)\s/);
      if (hm && hm[1].length <= taskHeadLevel) { taskEnd = l; break; }
    }

    // Collect fenced code blocks within this task body
    const codeBlocks = [];
    let inFence = false;
    let fenceContent = '';
    for (let k = i + 1; k < taskEnd; k++) {
      if (/^```/.test(lines[k])) {
        if (!inFence) {
          inFence = true;
          fenceContent = '';
        } else {
          codeBlocks.push(fenceContent);
          inFence = false;
          fenceContent = '';
        }
      } else if (inFence) {
        fenceContent += lines[k] + '\n';
      }
    }

    tasks.set(id, { header: lines[i], lineNo: i + 1, filesBlock, codeBlocks, taskEnd });
  }

  // ── Decision discovery ────────────────────────────────────────────────────
  // Match: **DECISION-NNN:...** — the number immediately followed by colon.
  // Live plan format: "- **DECISION-001: Phasing locked at 4 PRs.** ..."
  // The closing ** comes at the end of the description phrase, not after the colon.
  const decisionRe = /\*\*DECISION-(\d+):/g;
  const decisions  = new Set();
  for (const line of lines) {
    let dm;
    while ((dm = decisionRe.exec(line)) !== null) {
      decisions.add(`DECISION-${dm[1].padStart(3, '0')}`);
    }
  }

  // ── QA section discovery ─────────────────────────────────────────────────
  let qaStart = -1;
  let qaEnd   = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+QA Strategy/i.test(lines[i])) { qaStart = i; break; }
  }
  if (qaStart >= 0) {
    for (let i = qaStart + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { qaEnd = i; break; }
    }
  }

  const qaLines = qaStart >= 0 ? lines.slice(qaStart, qaEnd) : [];

  // Find subsections within QA
  const subsections = {};
  const subRe = /^###\s+(.+)/;
  for (let i = 0; i < qaLines.length; i++) {
    const sm = qaLines[i].match(subRe);
    if (sm) {
      const name = sm[1].trim();
      subsections[name] = { startIdx: i, lineNo: qaStart + i + 1 };
    }
  }

  // ── Risk discovery (bold **R<n>** markers in QA Risk Assessment) ──────────
  const risks = new Set();
  const riskRe = /\*\*R(\d+)\*\*/g;
  for (const line of qaLines) {
    let rm;
    while ((rm = riskRe.exec(line)) !== null) {
      risks.add(`R${rm[1]}`);
    }
  }

  return {
    tasks,
    decisions,
    risks,
    qaSection: {
      startLine: qaStart >= 0 ? qaStart + 1 : -1,
      endLine:   qaEnd,
      lines:     qaLines,
      subsections,
    },
    lines,
  };
}

// ─── ANCHOR PARSER ───────────────────────────────────────────────────────────

/**
 * parseAnchors(rowText) => {
 *   task:       string | null
 *   tasks:      string[]
 *   files:      string[]
 *   risks:      string[]
 *   constraint: string | null
 *   func:       string | null
 *   field:      string | null
 *   raw:        string[]
 * }
 */
function parseAnchors(rowText) {
  const result = {
    task:       null,
    tasks:      [],
    files:      [],
    risks:      [],
    constraint: null,
    func:       null,
    field:      null,
    raw:        [],
  };

  const anchorRe = /\[([A-Za-z]+):\s*([^\]]+)\]/g;
  let m;
  while ((m = anchorRe.exec(rowText)) !== null) {
    const key   = m[1].trim();
    const value = m[2].trim();
    result.raw.push(`[${key}: ${value}]`);

    const vals = value.split(',').map(s => s.trim()).filter(Boolean);
    const kl   = key.toLowerCase();

    if (kl === 'task') {
      result.task = vals[0] || null;
      result.tasks.push(...vals);
    } else if (kl === 'tasks') {
      result.tasks.push(...vals);
    } else if (kl === 'files' || kl === 'file') {
      result.files.push(...vals);
    } else if (kl === 'risk' || kl === 'risks') {
      result.risks.push(...vals);
    } else if (kl === 'constraint') {
      result.constraint = vals[0] || null;
    } else if (kl === 'function') {
      result.func = vals[0] || null;
    } else if (kl === 'field') {
      result.field = vals[0] || null;
    }
  }

  return result;
}

// ─── UTILITY ─────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDecisionId(raw) {
  // Normalize DECISION-1 → DECISION-001, DECISION-001 → DECISION-001
  return raw.replace(/DECISION-(\d+)/, (_, n) => `DECISION-${String(parseInt(n, 10)).padStart(3, '0')}`);
}

function findClosestTaskId(target, allTaskIds) {
  if (!allTaskIds || allTaskIds.length === 0) return null;
  const pm = target.match(/^(\d+)\.(\d+)$/);
  if (pm) {
    const major = parseInt(pm[1], 10);
    const minor = parseInt(pm[2], 10);
    let best = null;
    let bestDist = Infinity;
    for (const id of allTaskIds) {
      const im = id.match(/^(\d+)\.(\d+)$/);
      if (!im) continue;
      const dist = Math.abs(parseInt(im[1], 10) - major) * 10 + Math.abs(parseInt(im[2], 10) - minor);
      if (dist < bestDist) { bestDist = dist; best = id; }
    }
    return best;
  }
  return null;
}

// ─── PROSE-CLAIM VALIDATOR ───────────────────────────────────────────────────

/**
 * Strip anchor tags from a row to get the prose body.
 */
function stripAnchors(rowText) {
  return rowText.replace(/\[[A-Za-z]+:\s*[^\]]+\]/g, '');
}

/**
 * Extract path-like tokens from prose. A path-like token is any string containing
 * a `/` and at least one `.` extension, OR a leading-dot dotfile path.
 *
 * Examples that match: `.claude/pipeline.yml`, `scripts/foo.js`, `commands/init.md`
 * Examples that don't:  `Mitigation:`, `embedWithRetry()`, `100ms`
 */
function extractPathTokens(prose) {
  const tokens = new Set();
  // Match path-like tokens including those starting with dot or alphanumeric.
  const pathRe = /(?:\b|[`"'])([./a-zA-Z][a-zA-Z0-9_\-./]*\/[a-zA-Z0-9_\-./]+)\b/g;
  let m;
  while ((m = pathRe.exec(prose)) !== null) {
    const tok = m[1];
    // Ignore single-segment URLs and pure version numbers
    if (tok.split('/').length < 2) continue;
    if (/^\d+\.\d+$/.test(tok)) continue;
    if (tok.includes('://')) continue;        // URLs
    if (tok.startsWith('//')) continue;       // doubled slash
    if (/^\d/.test(tok) && !tok.includes('.')) continue; // numeric only
    tokens.add(tok);
  }
  return Array.from(tokens);
}

/**
 * For each path-like token in prose, verify it appears in the cited Task's body
 * (Files block, prose, or code blocks) OR in any anchor on the row.
 *
 * Returns Finding[].
 */
function validateProsePathClaims({ rowText, rowLineNo, rowId, parsedPlan, citedTaskIds, anchors }) {
  const findings = [];
  const prose    = stripAnchors(rowText);
  const tokens   = extractPathTokens(prose);
  if (tokens.length === 0) return findings;

  // Build the union of: cited tasks' bodies + anchored Files paths
  const anchoredFilesSet = new Set((anchors && anchors.files) || []);
  const taskBodies       = [];
  if (citedTaskIds && citedTaskIds.length > 0) {
    for (const taskId of citedTaskIds) {
      const task = parsedPlan.tasks.get(taskId);
      if (!task) continue;
      const taskLineStart = task.lineNo - 1;
      const taskEnd       = task.taskEnd || parsedPlan.lines.length;
      taskBodies.push(parsedPlan.lines.slice(taskLineStart, taskEnd).join('\n'));
    }
  }

  for (const tok of tokens) {
    // 1. Already anchored on the row? OK.
    if (anchoredFilesSet.has(tok)) continue;
    // 2. Appears in any cited Task's body? OK.
    let foundInTask = false;
    for (const body of taskBodies) {
      if (body.includes(tok)) { foundInTask = true; break; }
    }
    if (foundInTask) continue;

    // Fabrication.
    const citedStr = (citedTaskIds && citedTaskIds.length) ? citedTaskIds.join(', ') : '(none)';
    findings.push(new Finding({
      rule:     'prose-path-fabrication',
      severity: 'error',
      line:     rowLineNo,
      rowId,
      message:  `prose names path "${tok}" but it appears in neither the cited Task body (${citedStr}) nor any [Files: ...] anchor on this row`,
      suggestion: `Either anchor "${tok}" with [Files: ${tok}] (and verify the path exists / is referenced by a cited Task), or rewrite the failure mode without naming this path.`,
    }));
  }

  return findings;
}

// ─── ANCHOR VALIDATOR ────────────────────────────────────────────────────────

/**
 * validateAnchor — validates a single anchor value.
 * Returns Finding | null.
 */
function validateAnchor({ anchorType, anchorValue, rowLineNo, rowId, parsedPlan, projectRoot, allTaskIds }) {
  const { tasks, decisions, risks } = parsedPlan;

  if (anchorType === 'task') {
    if (!tasks.has(anchorValue)) {
      return new Finding({
        rule:       'task-anchor-resolution',
        severity:   'error',
        line:       rowLineNo,
        rowId,
        message:    `cites [Task: ${anchorValue}] — no such task exists in plan`,
        suggestion: findClosestTaskId(anchorValue, allTaskIds),
      });
    }
    return null;
  }

  if (anchorType === 'decision') {
    const normalized = normalizeDecisionId(anchorValue);
    if (!decisions.has(normalized) && !decisions.has(anchorValue)) {
      return new Finding({
        rule:       'decision-anchor-resolution',
        severity:   'error',
        line:       rowLineNo,
        rowId,
        message:    `cites [Constraint: ${anchorValue}] — no such decision exists in plan`,
        suggestion: null,
      });
    }
    return null;
  }

  if (anchorType === 'risk') {
    if (!risks.has(anchorValue)) {
      return new Finding({
        rule:       'risk-anchor-resolution',
        severity:   'error',
        line:       rowLineNo,
        rowId,
        message:    `cites [Risk: ${anchorValue}] — not found in QA Risk Assessment section`,
        suggestion: null,
      });
    }
    return null;
  }

  return null;
}

// ─── FILE PATH VALIDATOR ─────────────────────────────────────────────────────

const REPO_PATH_PREFIXES = [
  'scripts/', 'commands/', 'skills/', '.github/', 'docs/', 'templates/',
  '.claude/', 'CLAUDE.md', 'package.json', 'README.md',
];

function looksLikeRepoPath(fp) {
  for (const prefix of REPO_PATH_PREFIXES) {
    if (fp.startsWith(prefix) || fp === prefix.replace(/\/$/, '')) return true;
  }
  return false;
}

/**
 * validateFilePath — check (a) file exists on disk OR (b) path mentioned in cited Task's body.
 * Returns Finding[].
 */
function validateFilePath({ filePath, rowLineNo, rowId, parsedPlan, projectRoot, citedTaskIds }) {
  const fp = filePath.trim();
  if (!looksLikeRepoPath(fp)) return [];

  const absPath = path.resolve(projectRoot, fp);
  if (fs.existsSync(absPath)) return [];

  // Check if mentioned in any cited task's body (Files block or task prose)
  if (citedTaskIds && citedTaskIds.length > 0) {
    for (const taskId of citedTaskIds) {
      const task = parsedPlan.tasks.get(taskId);
      if (!task) continue;
      if (task.filesBlock.includes(fp)) return [];
      // Check task body text
      const taskLineStart = task.lineNo - 1;
      const taskEnd       = task.taskEnd || parsedPlan.lines.length;
      const taskBody      = parsedPlan.lines.slice(taskLineStart, taskEnd).join('\n');
      if (taskBody.includes(fp)) return [];
    }
  }

  return [new Finding({
    rule:     'file-anchor-resolution',
    severity: 'error',
    line:     rowLineNo,
    rowId,
    message:  `cites [Files: ${fp}] — file not on disk and not in any cited Task's Files block`,
    suggestion: null,
  })];
}

// ─── FUNCTION/FIELD VALIDATOR ─────────────────────────────────────────────────

/**
 * Checks that `name` appears as a word-boundary token in:
 *   (a) the body / code blocks of any cited Task, OR
 *   (b) the Decisions for This Feature subsection text (when a Constraint anchor is cited).
 *
 * Returns Finding | null.
 */
function validateFunctionOrField({ name, kind, rowLineNo, rowId, parsedPlan, citedTaskIds, citedConstraintId }) {
  const hasTask = citedTaskIds && citedTaskIds.length > 0;
  const hasConstraint = !!citedConstraintId;
  if (!hasTask && !hasConstraint) return null;

  const wordRe = new RegExp(`\\b${escapeRegex(name)}\\b`);

  if (hasTask) {
    for (const taskId of citedTaskIds) {
      const task = parsedPlan.tasks.get(taskId);
      if (!task) continue;

      for (const cb of task.codeBlocks) {
        if (wordRe.test(cb)) return null;
      }
      const taskLineStart = task.lineNo - 1;
      const taskEnd       = task.taskEnd || parsedPlan.lines.length;
      const taskBody      = parsedPlan.lines.slice(taskLineStart, taskEnd).join('\n');
      if (wordRe.test(taskBody)) return null;
    }
  }

  if (hasConstraint) {
    // Find the line declaring the cited DECISION-NNN and scan its multi-line body
    // (continues until the next - **DECISION-... or a blank line followed by ## or ---).
    const normalized = normalizeDecisionId(citedConstraintId);
    const decisionStartRe = new RegExp(`\\*\\*${escapeRegex(normalized)}:`);
    let startIdx = -1;
    for (let i = 0; i < parsedPlan.lines.length; i++) {
      if (decisionStartRe.test(parsedPlan.lines[i])) { startIdx = i; break; }
    }
    if (startIdx >= 0) {
      // Scan until next decision line or section heading
      let endIdx = parsedPlan.lines.length;
      for (let i = startIdx + 1; i < parsedPlan.lines.length; i++) {
        const ln = parsedPlan.lines[i];
        if (/^- \*\*DECISION-\d+:/.test(ln)) { endIdx = i; break; }
        if (/^##\s/.test(ln) || /^---\s*$/.test(ln)) { endIdx = i; break; }
      }
      const decisionBody = parsedPlan.lines.slice(startIdx, endIdx).join('\n');
      if (wordRe.test(decisionBody)) return null;
    }
  }

  const cited = [];
  if (hasTask)       cited.push(`tasks (${citedTaskIds.join(', ')})`);
  if (hasConstraint) cited.push(`constraint ${citedConstraintId}`);
  return new Finding({
    rule:     `${kind.toLowerCase()}-anchor-resolution`,
    severity: 'error',
    line:     rowLineNo,
    rowId,
    message:  `cites [${kind}: ${name}] — token does not appear in cited ${cited.join(' or ')}`,
    suggestion: `Verify "${name}" is named in the cited ${cited.join(' or ')}, or anchor it to where it IS defined.`,
  });
}

// ─── QA SECTION LINTER ───────────────────────────────────────────────────────

/**
 * lintQaSection(parsedPlan, projectRoot, options) => Finding[]
 */
function lintQaSection(parsedPlan, projectRoot, options) {
  const strict   = (options && options.strict !== false);
  const findings = [];
  const { qaSection, tasks, lines } = parsedPlan;
  const allTaskIds = Array.from(tasks.keys());

  // ── QA section present check ─────────────────────────────────────────────
  if (qaSection.startLine < 0) {
    findings.push(new Finding({
      rule:     'qa-section-missing',
      severity: 'error',
      line:     1,
      rowId:    null,
      message:  '## QA Strategy section not found in plan',
    }));
    return findings;
  }

  // ── Subsection presence and order ─────────────────────────────────────────
  const REQUIRED_SUBS = ['Risk Assessment', 'P0 Test Scenarios', 'Seam Tests'];

  const missing = REQUIRED_SUBS.filter(s => !qaSection.subsections[s]);
  if (missing.length > 0) {
    findings.push(new Finding({
      rule:     'qa-subsection-missing',
      severity: 'error',
      line:     qaSection.startLine,
      rowId:    null,
      message:  `QA Strategy missing required subsections: ${missing.join(', ')}`,
    }));
  }

  const presentSubs = REQUIRED_SUBS.filter(s => qaSection.subsections[s])
    .map(s => ({ name: s, lineNo: qaSection.subsections[s].lineNo }));

  for (let i = 1; i < presentSubs.length; i++) {
    if (presentSubs[i].lineNo < presentSubs[i - 1].lineNo) {
      findings.push(new Finding({
        rule:     'qa-subsection-order',
        severity: 'error',
        line:     presentSubs[i].lineNo,
        rowId:    null,
        message:  `QA subsection "${presentSubs[i].name}" appears before "${presentSubs[i - 1].name}" — required order: Risk Assessment → P0 Test Scenarios → Seam Tests`,
      }));
    }
  }

  if (!qaSection.subsections['Test Intent Rule']) {
    findings.push(new Finding({
      rule:     'qa-test-intent-rule-missing',
      severity: 'info',
      line:     qaSection.startLine,
      rowId:    null,
      message:  'QA Strategy: optional ### Test Intent Rule subsection is absent',
    }));
  }

  // ── Determine which subsection each QA line belongs to ───────────────────
  const qaLines    = qaSection.lines;
  const qaStartOff = qaSection.startLine - 1; // 0-indexed offset in full document

  const subsectionOrder = [];
  for (let i = 0; i < qaLines.length; i++) {
    const sm = qaLines[i].match(/^###\s+(.+)/);
    if (sm) subsectionOrder.push({ name: sm[1].trim(), idx: i });
  }

  function getSubsection(lineIdx) {
    let current = null;
    for (const sub of subsectionOrder) {
      if (sub.idx <= lineIdx) current = sub.name;
      else break;
    }
    return current;
  }

  // ── Row-type regexes ──────────────────────────────────────────────────────
  // Accept both table format (`| **R1** | ... |`) and bullet format (`- **R1** ...`).
  // Bullet format is preferred per the qa SKILL contract; table format is grandfathered.
  const riskRowRe = /^\s*[-*|]\s*\*\*R(\d+)\*\*/;
  const tsRowRe   = /^\s*[-*|]\s*\*\*TS-(\d+)[*:\s]/;
  const seamRowRe = /^\s*[-*|]\s*\*\*SEAM-(\d+)[*:\s]/;

  // Informal "Task T<N>" prose detection
  const informalTaskRe = /\bTask\s+T(\d+)\b/g;

  for (let i = 0; i < qaLines.length; i++) {
    const line   = qaLines[i];
    const lineNo = qaStartOff + i + 1;
    const subsec = getSubsection(i);

    // ── Informal Task T<N> references ─────────────────────────────────────
    let itm;
    informalTaskRe.lastIndex = 0;
    while ((itm = informalTaskRe.exec(line)) !== null) {
      findings.push(new Finding({
        rule:     'informal-task-reference',
        severity: 'error',
        line:     lineNo,
        rowId:    null,
        message:  `informal "Task T${itm[1]}" reference — use dot-notation [Task: N.M] anchor instead`,
        suggestion: 'Convert to [Task: N.M] anchor format',
      }));
    }

    // ── Risk rows (in Risk Assessment subsection) ─────────────────────────
    const rm = line.match(riskRowRe);
    if (rm && subsec === 'Risk Assessment') {
      const rowId   = `R${rm[1]}`;
      const anchors = parseAnchors(line);

      // Design-claim prose ban: risks describe FAILURE MODE only.
      // Mitigation/Implementation/Resolution prose is the most fabrication-prone surface
      // (the agent invents design elements not in the cited Task). The mitigation IS
      // the cited Task by definition. Forbid these keywords entirely.
      const designClaimRe = /\b(Mitigation|Mitigated by|Implementation|Solution|Resolution)\s*:/i;
      const dc = line.match(designClaimRe);
      if (dc) {
        findings.push(new Finding({
          rule:     'risk-row-design-claim',
          severity: 'error',
          line:     lineNo,
          rowId,
          message:  `${rowId} row contains "${dc[1]}:" prose — risks describe failure mode only`,
          suggestion: 'Remove design-claim prose. The cited [Task: N.M] IS the mitigation. Risk rows: Boundary + Failure Mode + Severity only.',
        }));
      }

      if (anchors.tasks.length === 0 && !anchors.constraint) {
        findings.push(new Finding({
          rule:     'risk-row-unanchored',
          severity: strict ? 'error' : 'warning',
          line:     lineNo,
          rowId,
          message:  `${rowId} row has no [Task: ...] or [Constraint: DECISION-...] anchor${strict ? ' (strict mode)' : ''}`,
          suggestion: 'Add [Task: N.M] or [Constraint: DECISION-NNN] anchor',
        }));
      } else {
        for (const taskId of anchors.tasks) {
          const f = validateAnchor({ anchorType: 'task', anchorValue: taskId, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, allTaskIds });
          if (f) findings.push(f);
        }
        if (anchors.constraint) {
          const f = validateAnchor({ anchorType: 'decision', anchorValue: anchors.constraint, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, allTaskIds });
          if (f) findings.push(f);
        }
      }

      for (const fp of anchors.files) {
        findings.push(...validateFilePath({ filePath: fp, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, citedTaskIds: anchors.tasks }));
      }
      if (anchors.func) {
        if (anchors.tasks.length === 0) {
          findings.push(new Finding({ rule: 'function-anchor-no-task', severity: 'error', line: lineNo, rowId, message: `${rowId} cites [Function: ${anchors.func}] with no [Task: ...] anchor`, suggestion: 'Add [Task: N.M] anchor' }));
        } else {
          const f = validateFunctionOrField({ name: anchors.func, kind: 'Function', rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, citedConstraintId: anchors.constraint });
          if (f) findings.push(f);
        }
      }
      if (anchors.field) {
        if (anchors.tasks.length === 0) {
          findings.push(new Finding({ rule: 'field-anchor-no-task', severity: 'error', line: lineNo, rowId, message: `${rowId} cites [Field: ${anchors.field}] with no [Task: ...] anchor`, suggestion: 'Add [Task: N.M] anchor' }));
        } else {
          const f = validateFunctionOrField({ name: anchors.field, kind: 'Field', rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, citedConstraintId: anchors.constraint });
          if (f) findings.push(f);
        }
      }
      // Prose-claim path validation: any path-like token in the prose body
      // must appear in cited Task body OR be anchored via [Files: ...].
      findings.push(...validateProsePathClaims({ rowText: line, rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, anchors }));
    }

    // ── P0 Test Scenario rows ─────────────────────────────────────────────
    const tsm = line.match(tsRowRe);
    if (tsm && subsec === 'P0 Test Scenarios') {
      const rowId   = `TS-${String(tsm[1]).padStart(3, '0')}`;
      const anchors = parseAnchors(line);
      const missingRequired = [];
      if (anchors.risks.length === 0) missingRequired.push('[Risk: R<n>]');
      if (anchors.tasks.length === 0) missingRequired.push('[Task: N.M]');

      if (missingRequired.length > 0) {
        findings.push(new Finding({
          rule:     'p0-row-unanchored',
          severity: strict ? 'error' : 'warning',
          line:     lineNo,
          rowId,
          message:  `${rowId} row missing required anchor(s): ${missingRequired.join(', ')}${strict ? ' (strict mode)' : ''}`,
          suggestion: 'Add all required anchors to the row',
        }));
      }

      for (const taskId of anchors.tasks) {
        const f = validateAnchor({ anchorType: 'task', anchorValue: taskId, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, allTaskIds });
        if (f) findings.push(f);
      }
      for (const risk of anchors.risks) {
        const f = validateAnchor({ anchorType: 'risk', anchorValue: risk, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, allTaskIds });
        if (f) findings.push(f);
      }
      for (const fp of anchors.files) {
        findings.push(...validateFilePath({ filePath: fp, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, citedTaskIds: anchors.tasks }));
      }
      if (anchors.func) {
        if (anchors.tasks.length === 0) {
          findings.push(new Finding({ rule: 'function-anchor-no-task', severity: 'error', line: lineNo, rowId, message: `${rowId} cites [Function: ${anchors.func}] with no [Task: ...] anchor`, suggestion: 'Add [Task: N.M] anchor' }));
        } else {
          const f = validateFunctionOrField({ name: anchors.func, kind: 'Function', rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, citedConstraintId: anchors.constraint });
          if (f) findings.push(f);
        }
      }
      if (anchors.field) {
        if (anchors.tasks.length === 0) {
          findings.push(new Finding({ rule: 'field-anchor-no-task', severity: 'error', line: lineNo, rowId, message: `${rowId} cites [Field: ${anchors.field}] with no [Task: ...] anchor`, suggestion: 'Add [Task: N.M] anchor' }));
        } else {
          const f = validateFunctionOrField({ name: anchors.field, kind: 'Field', rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, citedConstraintId: anchors.constraint });
          if (f) findings.push(f);
        }
      }
      findings.push(...validateProsePathClaims({ rowText: line, rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, anchors }));
    }

    // ── Seam Test rows ────────────────────────────────────────────────────
    const sm2 = line.match(seamRowRe);
    if (sm2 && subsec === 'Seam Tests') {
      const rowId   = `SEAM-${String(sm2[1]).padStart(3, '0')}`;
      const anchors = parseAnchors(line);
      const missingRequired = [];
      if (anchors.tasks.length < 2) missingRequired.push('[Tasks: N.M, P.Q] (≥2 tasks required)');
      if (anchors.files.length < 2) missingRequired.push('[Files: a, b] (≥2 files required)');

      if (missingRequired.length > 0) {
        findings.push(new Finding({
          rule:     'seam-row-unanchored',
          severity: strict ? 'error' : 'warning',
          line:     lineNo,
          rowId,
          message:  `${rowId} row missing required anchor(s): ${missingRequired.join(', ')}${strict ? ' (strict mode)' : ''}`,
          suggestion: 'Add [Tasks: N.M, P.Q] (≥2) and [Files: a, b] (≥2) anchors',
        }));
      }

      for (const taskId of anchors.tasks) {
        const f = validateAnchor({ anchorType: 'task', anchorValue: taskId, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, allTaskIds });
        if (f) findings.push(f);
      }
      for (const fp of anchors.files) {
        findings.push(...validateFilePath({ filePath: fp, rowLineNo: lineNo, rowId, parsedPlan, projectRoot, citedTaskIds: anchors.tasks }));
      }
      if (anchors.func) {
        const f = validateFunctionOrField({ name: anchors.func, kind: 'Function', rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, citedConstraintId: anchors.constraint });
        if (f) findings.push(f);
      }
      findings.push(...validateProsePathClaims({ rowText: line, rowLineNo: lineNo, rowId, parsedPlan, citedTaskIds: anchors.tasks, anchors }));
    }
  }

  return findings;
}

// ─── HUMAN-READABLE OUTPUT ────────────────────────────────────────────────────

function formatHuman(findings, planPath, parsedPlan, options) {
  const quiet = options && options.quiet;
  const out   = [];

  const allTaskIds = Array.from(parsedPlan.tasks.keys()).sort((a, b) => {
    const [am, an] = a.split('.').map(Number);
    const [bm, bn] = b.split('.').map(Number);
    return am !== bm ? am - bm : an - bn;
  });
  const taskRange = allTaskIds.length > 0
    ? ` (${allTaskIds[0]}–${allTaskIds[allTaskIds.length - 1]})`
    : '';

  out.push(`pipeline-lint-plan: scanning ${planPath}`);
  out.push(`  Tasks defined: ${parsedPlan.tasks.size}${taskRange}`);
  out.push(`  Decisions: ${parsedPlan.decisions.size} (${Array.from(parsedPlan.decisions).sort().join(', ') || 'none'})`);
  out.push(`  QA section: lines ${parsedPlan.qaSection.startLine}–${parsedPlan.qaSection.endLine}`);
  out.push('');

  const errors   = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  const infos    = findings.filter(f => f.severity === 'info');

  for (const f of errors) {
    const loc = f.row_id ? `${f.row_id} ` : '';
    // suggestion is a task ID for task-anchor-resolution; guidance text for other rules
    const sug = f.suggestion
      ? (f.rule === 'task-anchor-resolution' ? ` (closest match: ${f.suggestion})` : ` — hint: ${f.suggestion}`)
      : '';
    out.push(c.red('✗ FAIL') + ` line ${f.line}: ${loc}${f.message}${sug}`);
  }
  for (const f of warnings) {
    const loc = f.row_id ? `${f.row_id} ` : '';
    const sug = f.suggestion ? ` — hint: ${f.suggestion}` : '';
    out.push(c.yellow('⚠ WARN') + ` line ${f.line}: ${loc}${f.message}${sug}`);
  }
  for (const f of infos) {
    out.push(c.info('ℹ INFO') + ` line ${f.line}: ${f.message}`);
  }

  if (findings.length === 0 && !quiet) {
    out.push(c.green('✓ All checks passed.'));
  }

  if (errors.length + warnings.length > 0) {
    out.push('');
    out.push(`${errors.length + warnings.length} finding(s) across QA Strategy section.`);
    if (errors.length > 0) out.push('Exit 1.');
  }

  return out.join('\n');
}

// ─── SELF-TESTS ──────────────────────────────────────────────────────────────

function runSelfTests() {
  let passed = 0;
  let failed = 0;
  const FAKE_ROOT = path.join(__dirname, '..', 'nonexistent-test-root');

  function assert(label, condition) {
    if (condition) {
      console.log(c.green('  PASS') + `  ${label}`);
      passed++;
    } else {
      console.log(c.red('  FAIL') + `  ${label}`);
      failed++;
    }
  }

  // ── Test 1: Clean anchored Risk row resolves cleanly ──────────────────────
  {
    const md = [
      '# Plan',
      '',
      '### Decisions for This Feature',
      '',
      '- **DECISION-001:** Phase locked.',
      '',
      '### Task 1.5: Add UNIQUE constraint',
      '',
      '**Files:**',
      '- Modify: `scripts/setup-knowledge-db.sql`',
      '',
      '```sql',
      'ALTER TABLE session_chunks ADD CONSTRAINT u UNIQUE (session_id, chunk_idx);',
      '```',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '| Priority | **R1** | Component | Severity | Mitigation [Task: 1.5] |',
      '',
      '### P0 Test Scenarios',
      '',
      '| **TS-001** | Test desc [Risk: R1] [Task: 1.5] | Integration | R1 | Phase 1 |',
      '',
      '### Seam Tests',
      '',
      '| **SEAM-001** | desc [Tasks: 1.5, 1.5] [Files: scripts/setup-knowledge-db.sql, scripts/setup-knowledge-db.sql] | Boundary |',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const errors   = findings.filter(f => f.severity === 'error');
    assert('Test 1: clean anchored rows produce no errors', errors.length === 0);
  }

  // ── Test 2: Fabricated Task ID (T2) fails ─────────────────────────────────
  {
    const md = [
      '# Plan',
      '',
      '### Task 1.5: Real task',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '| **R1** | Something bad [Task: T2] | CRITICAL |',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const taskFail = findings.some(f => f.rule === 'task-anchor-resolution' && f.message.includes('T2'));
    assert('Test 2: fabricated [Task: T2] → task-anchor-resolution error', taskFail);
  }

  // ── Test 3: Fabricated file path fails ────────────────────────────────────
  {
    const md = [
      '# Plan',
      '',
      '### Task 3.2: Extract helper',
      '',
      '**Files:**',
      '- Modify: `scripts/pipeline-embed.js`',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '| **R1** | Risk desc [Task: 3.2] [Files: scripts/lib/embedWithRetry.js] | HIGH |',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const fileFail = findings.some(f => f.rule === 'file-anchor-resolution' && f.message.includes('embedWithRetry.js'));
    assert('Test 3: fabricated [Files: scripts/lib/embedWithRetry.js] → file-anchor-resolution error', fileFail);
  }

  // ── Test 4: Unanchored row in strict mode is error ────────────────────────
  {
    const md = [
      '# Plan',
      '',
      '### Task 1.5: Real task',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '| **R1** | No anchors here whatsoever | HIGH |',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const strictErr = findings.some(f => f.rule === 'risk-row-unanchored' && f.severity === 'error');
    assert('Test 4: unanchored Risk row in strict mode → error', strictErr);
  }

  // ── Test 5: Unanchored row in lenient mode is warning only ────────────────
  {
    const md = [
      '# Plan',
      '',
      '### Task 1.5: Real task',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '| **R1** | No anchors here whatsoever | HIGH |',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed       = parsePlan(md);
    const findings     = lintQaSection(parsed, FAKE_ROOT, { strict: false });
    const warnPresent  = findings.some(f => f.rule === 'risk-row-unanchored' && f.severity === 'warning');
    const noError      = !findings.some(f => f.severity === 'error');
    assert('Test 5: unanchored Risk row in lenient mode → warning, no error', warnPresent && noError);
  }

  // ── Test 6: parseAnchors extracts all anchor types ────────────────────────
  {
    const row = '| **TS-001** | desc [Task: 1.5] [Risk: R1] [Files: scripts/foo.js] [Function: getChunkTables] |';
    const a   = parseAnchors(row);
    assert('Test 6: parseAnchors extracts task, risk, files, function correctly',
      a.tasks.includes('1.5') &&
      a.risks.includes('R1') &&
      a.files.includes('scripts/foo.js') &&
      a.func === 'getChunkTables'
    );
  }

  // ── Test 7: Informal "Task T<N>" prose reference is flagged ──────────────
  {
    const md = [
      '# Plan',
      '',
      '### Task 1.5: Real task',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '| **R1** | Before Task T2 runs, check session_chunks for dupes. | CRITICAL |',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const informal = findings.some(f => f.rule === 'informal-task-reference' && f.message.includes('T2'));
    assert('Test 7: informal "Task T2" prose reference → informal-task-reference error', informal);
  }

  // ── Test 8: Risk row with "Mitigation:" prose is rejected ────────────────
  {
    const md = [
      '# Plan',
      '',
      '### Task 1.5: Add unique constraint',
      '',
      '**Files:**',
      '- Modify: `scripts/setup-knowledge-db.sql`',
      '',
      'Body of task.',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '- **R1** [Task: 1.5] [Files: scripts/setup-knowledge-db.sql] — UNIQUE migration may collide with existing duplicate rows. Severity: CRITICAL. Mitigation: [Task: 1.5] adds a pre-flight duplicate check that aborts the migration.',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const claim    = findings.some(f => f.rule === 'risk-row-design-claim');
    assert('Test 8: Risk row with "Mitigation:" prose → risk-row-design-claim error', claim);
  }

  // ── Test 9: Risk row WITHOUT design-claim prose passes ───────────────────
  {
    const md = [
      '# Plan',
      '',
      '### Task 1.5: Add unique constraint',
      '',
      '**Files:**',
      '- Modify: `scripts/setup-knowledge-db.sql`',
      '',
      'Body of task.',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '- **R1** [Task: 1.5] [Files: scripts/setup-knowledge-db.sql] — Boundary: setup-knowledge-db.sql ↔ existing session_chunks rows. Failure mode: UNIQUE constraint creation may collide with pre-migration duplicates. Severity: CRITICAL.',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const noDesignClaim = !findings.some(f => f.rule === 'risk-row-design-claim');
    assert('Test 9: Risk row without "Mitigation:" prose → no risk-row-design-claim error', noDesignClaim);
  }

  // ── Test 10: Prose names path not in cited Task body → fabrication error ─
  {
    const md = [
      '# Plan',
      '',
      '### Task 1.6: Add warning flag',
      '',
      '**Files:**',
      '- Modify: `scripts/hooks/routing-check.js`',
      '',
      'Adds `warnedThisSession` module-level flag. Uses in-process memory.',
      '',
      '## QA Strategy',
      '',
      '### Risk Assessment',
      '',
      '- **R1** [Task: 1.6] [Files: scripts/hooks/routing-check.js] — Boundary: routing-check.js. Failure mode: state written to .claude/pipeline.yml never persists. Severity: HIGH.',
      '',
      '### P0 Test Scenarios',
      '',
      '### Seam Tests',
    ].join('\n');

    const parsed   = parsePlan(md);
    const findings = lintQaSection(parsed, FAKE_ROOT, { strict: true });
    const fabrication = findings.some(f => f.rule === 'prose-path-fabrication' && f.message.includes('claude/pipeline.yml'));
    assert('Test 10: prose names path not in cited Task → prose-path-fabrication error', fabrication);
  }

  console.log('');
  console.log(c.bold(`Self-tests: ${passed} passed, ${failed} failed`));
  if (failed > 0) {
    console.log(c.red('FAIL'));
    process.exit(1);
  } else {
    console.log(c.green('PASS'));
  }
}

// ─── MAIN CLI ─────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    console.log(c.bold('pipeline-lint-plan self-tests'));
    console.log('');
    runSelfTests();
    process.exit(0);
  }

  // Parse flags
  const jsonMode = argv.includes('--json');
  const quiet    = argv.includes('--quiet');
  const lenient  = argv.includes('--lenient');
  const strict   = !lenient;

  // Resolve plan path
  let planPath = null;
  const planIdx = argv.indexOf('--plan');
  if (planIdx >= 0 && argv[planIdx + 1]) {
    planPath = argv[planIdx + 1];
  } else {
    planPath = argv.find(a => !a.startsWith('--')) || null;
  }

  if (!planPath) {
    console.error('Usage: node scripts/pipeline-lint-plan.js --plan <path> [--strict|--lenient] [--json] [--quiet]');
    process.exit(2);
  }

  // Resolve project root from script location
  const scriptDir   = path.resolve(__dirname);
  const projectRoot = path.resolve(scriptDir, '..');

  const resolvedPlan = path.isAbsolute(planPath) ? planPath : path.resolve(projectRoot, planPath);

  if (!fs.existsSync(resolvedPlan)) {
    console.error(`pipeline-lint-plan: file not found: ${resolvedPlan}`);
    process.exit(2);
  }

  let markdownString;
  try {
    markdownString = fs.readFileSync(resolvedPlan, 'utf8');
  } catch (err) {
    console.error(`pipeline-lint-plan: error reading file: ${err.message}`);
    process.exit(2);
  }

  let parsedPlan;
  try {
    parsedPlan = parsePlan(markdownString);
  } catch (err) {
    console.error(`pipeline-lint-plan: internal parser error: ${err.message}`);
    process.exit(3);
  }

  let findings;
  try {
    findings = lintQaSection(parsedPlan, projectRoot, { strict });
  } catch (err) {
    console.error(`pipeline-lint-plan: internal linter error: ${err.message}`);
    process.exit(3);
  }

  if (jsonMode) {
    const out = findings.map(f => ({
      rule:       f.rule,
      severity:   f.severity,
      line:       f.line,
      row_id:     f.row_id,
      message:    f.message,
      suggestion: f.suggestion,
    }));
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    console.log(formatHuman(findings, resolvedPlan, parsedPlan, { quiet }));
  }

  const hasErrors = findings.some(f => f.severity === 'error');
  process.exit(hasErrors ? 1 : 0);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { parsePlan, parseAnchors, lintQaSection, validateAnchor, Finding };

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}
