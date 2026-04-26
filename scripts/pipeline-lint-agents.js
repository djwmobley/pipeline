#!/usr/bin/env node
/**
 * pipeline-lint-agents.js — Deterministic structural linting for agent prompt templates
 *
 * Runs 7 regex/string checks against prompt templates and outputs structured findings.
 * No external dependencies — Node.js stdlib only.
 *
 * Usage:
 *   node pipeline-lint-agents.js lint                              # Lint all templates
 *   node pipeline-lint-agents.js lint --changed                    # Lint only git-changed templates
 *   node pipeline-lint-agents.js lint --json                       # Machine-readable JSON output
 *   node pipeline-lint-agents.js lint --files "file1.md file2.md"  # Lint specific files
 *
 * Exit codes:
 *   0 — No HIGH findings (pass)
 *   1 — HIGH findings present (fail)
 *
 * Environment:
 *   PIPELINE_DIR — Root of the pipeline plugin (default: script's parent directory)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ─── ANSI ────────────────────────────────────────────────────────────────────

const c = {
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const PLUGIN_ROOT = process.env.PIPELINE_DIR || path.resolve(__dirname, '..');

// Known section-level substitutions that use {{}} legitimately (entire block replacements)
// These are exempt from the LA-CON-001 brace convention check
const SECTION_LEVEL_EXEMPTIONS = new Set([
  'MODEL', // Always exempt — model name
]);

// Valid operation_class enum values for skills
const VALID_OPERATION_CLASSES = new Set([
  'opus_orchestration',
  'sonnet_review',
  'haiku_judgment',
  'code_draft',
  'short_draft',
  'bulk_classify',
  'script_exec',
  'conversation_mode',
]);

// ─── FILE DISCOVERY ──────────────────────────────────────────────────────────

function discoverTemplates(opts) {
  if (opts.files) {
    return opts.files.split(/\s+/).filter(f => f.endsWith('-prompt.md'));
  }

  if (opts.changed) {
    try {
      // Tracked changes (staged + unstaged) compared to HEAD
      const tracked = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
        cwd: PLUGIN_ROOT,
        encoding: 'utf8',
      }).trim();
      // Untracked new files
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: PLUGIN_ROOT,
        encoding: 'utf8',
      }).trim();
      const all = [tracked, untracked].filter(Boolean).join('\n');
      if (!all) return [];
      return all.split('\n').filter(f => f.endsWith('-prompt.md'));
    } catch {
      // No git or no HEAD — fall back to all
      return discoverAll();
    }
  }

  return discoverAll();
}

function discoverAll() {
  const skillsDir = path.join(PLUGIN_ROOT, 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const results = [];
  walkDir(skillsDir, (filePath) => {
    if (filePath.endsWith('-prompt.md')) {
      results.push(path.relative(PLUGIN_ROOT, filePath).replace(/\\/g, '/'));
    }
  });
  return results;
}

function walkDir(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else {
      callback(fullPath);
    }
  }
}

// ─── CHECK ENGINE ────────────────────────────────────────────────────────────

/**
 * Run all checks against a single template file.
 * Returns array of finding objects.
 */
function checkTemplate(relPath) {
  const absPath = path.join(PLUGIN_ROOT, relPath);
  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split('\n');
  const findings = [];

  function addFinding(id, severity, line, checkId, message) {
    findings.push({ id, severity, confidence: 'HIGH', file: relPath, line, checkId, message });
  }

  // ── Parse template structure ──────────────────────────────────────────────

  // Find substitution checklist section
  const checklistStartIdx = lines.findIndex(l =>
    /substitution checklist/i.test(l)
  );

  // Find the code block containing the dispatch format (if present)
  const codeBlockStart = lines.findIndex(l => /^```/.test(l));
  const codeBlockEnd = codeBlockStart >= 0
    ? lines.findIndex((l, i) => i > codeBlockStart && /^```/.test(l))
    : -1;

  // Detect template type: dispatch-wrapped (has Task tool code block) or direct prompt
  const hasDispatchBlock = codeBlockStart >= 0 && /Task tool.*model:/i.test(
    lines.slice(codeBlockStart, codeBlockEnd >= 0 ? codeBlockEnd : undefined).join('\n')
  );

  // Extract checklist region
  let checklistRegion = '';
  if (checklistStartIdx >= 0) {
    const checklistEnd = hasDispatchBlock ? codeBlockStart : lines.findIndex((l, i) =>
      i > checklistStartIdx + 1 && /^---\s*$/.test(l)
    );
    checklistRegion = lines.slice(checklistStartIdx, checklistEnd >= 0 ? checklistEnd : undefined).join('\n');
  }

  // Extract body region:
  // - Dispatch-wrapped: content inside the code block
  // - Direct prompt: everything after the checklist separator (---) or after the checklist
  let bodyRegion = '';
  let bodyStartLine = 0;
  if (hasDispatchBlock && codeBlockStart >= 0 && codeBlockEnd >= 0) {
    bodyRegion = lines.slice(codeBlockStart + 1, codeBlockEnd).join('\n');
    bodyStartLine = codeBlockStart + 1;
  } else {
    // Direct prompt: find the --- separator after checklist, body is everything after
    const separatorIdx = checklistStartIdx >= 0
      ? lines.findIndex((l, i) => i > checklistStartIdx && /^---\s*$/.test(l))
      : -1;
    if (separatorIdx >= 0) {
      bodyRegion = lines.slice(separatorIdx + 1).join('\n');
      bodyStartLine = separatorIdx + 1;
    } else if (checklistStartIdx >= 0) {
      // No separator — body starts after last numbered checklist item
      let lastChecklistItem = checklistStartIdx;
      for (let i = checklistStartIdx + 1; i < lines.length; i++) {
        if (/^\d+\.\s/.test(lines[i])) lastChecklistItem = i;
        else if (lines[i].trim() && !/^\s*$/.test(lines[i])) break;
      }
      bodyRegion = lines.slice(lastChecklistItem + 1).join('\n');
      bodyStartLine = lastChecklistItem + 1;
    }
  }

  // ── Identify output format regions (to exclude from placeholder detection) ─

  // Lines inside output format / format reference sections are not substitution points
  const outputFormatLines = new Set();
  let inOutputSection = false;
  const bodyEnd = hasDispatchBlock && codeBlockEnd >= 0 ? codeBlockEnd : lines.length;
  for (let i = bodyStartLine; i < bodyEnd; i++) {
    const line = lines[i];
    // Detect output format section headings (must be actual markdown headings)
    if (/^\s*#{1,4}\s+.*(?:Output Format|Format Reference|Structured Output)/i.test(line)) {
      inOutputSection = true;
    }
    // A new heading at the same or higher level exits the output section
    if (inOutputSection && /^\s*#{1,3}\s/.test(line) && !/Output|Format/i.test(line)) {
      inOutputSection = false;
    }
    if (inOutputSection) {
      outputFormatLines.add(i);
    }
  }

  // ── Extract placeholders ──────────────────────────────────────────────────

  // [BRACKET_CAPS] placeholders in the body, excluding output format lines
  // Must be 3+ chars to avoid matching output format tokens like [N], [M], [ID]
  const bodyBracketPlaceholders = new Set();
  const bracketRe = /\[([A-Z][A-Z0-9_]{2,})\]/g;
  let m;
  // Scan only non-format lines in the body
  for (let i = bodyStartLine; i < bodyEnd; i++) {
    if (outputFormatLines.has(i)) continue;
    const line = lines[i];
    // Skip table rows (lines with | delimiters) — these are format examples
    if ((line.match(/\|/g) || []).length >= 2) continue;
    // Skip structured output format lines: PREFIX-[TOKEN], `KEYWORD [TOKEN]`, etc.
    if (/^\s*(FINDING|DECISION|RULE|MANIFEST|XREF|PLACEHOLDER|DUPLICATE|CONFIG_KEY|OUTPUT_CONTRACT|STRUCTURAL_PATTERN|FIXED|RESULT)\b/.test(line.trim())) continue;
    // Skip lines that are clearly format examples: [TOKEN]: [description] or [TOKEN] [description]
    if (/^\s*\[[A-Z].*\]:\s/.test(line)) continue;
    while ((m = bracketRe.exec(line)) !== null) {
      const before = line.substring(0, m.index);
      const after = line.substring(m.index + m[0].length);
      // Skip tokens embedded in prefix patterns like PREFIX-[TOKEN]
      if (/[A-Z]-$/.test(before)) continue;
      // Skip tokens inside backtick code spans (format examples)
      const ticksBefore = (before.match(/`/g) || []).length;
      if (ticksBefore % 2 === 1) continue; // Inside an unclosed backtick
      // Skip tokens that are path components: /[TOKEN] or [TOKEN]/
      if (/\/$/.test(before) || /^\//.test(after)) continue;
      bodyBracketPlaceholders.add(m[1]);
    }
  }

  // {{DOUBLE_BRACE}} placeholders in the body (same filtering as bracket placeholders)
  const bodyBracePlaceholders = new Set();
  const braceRe = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
  for (let i = bodyStartLine; i < bodyEnd; i++) {
    if (outputFormatLines.has(i)) continue;
    const line = lines[i];
    if ((line.match(/\|/g) || []).length >= 2) continue;
    while ((m = braceRe.exec(line)) !== null) {
      // Skip matches inside backtick code spans
      const before = line.substring(0, m.index);
      const ticksBefore = (before.match(/`/g) || []).length;
      if (ticksBefore % 2 === 1) continue;
      bodyBracePlaceholders.add(m[1]);
    }
  }

  // All body placeholders (both syntaxes)
  const allBodyPlaceholders = new Set([...bodyBracketPlaceholders, ...bodyBracePlaceholders]);

  // Checklist items — extract placeholder names from numbered list items
  // Patterns: `[NAME]`, `{{NAME}}`
  const checklistPlaceholders = new Set();
  const checklistItemRe = /`\[([A-Z][A-Z0-9_]*)\]`|`\{\{([A-Z][A-Z0-9_]*)\}\}`/g;
  while ((m = checklistItemRe.exec(checklistRegion)) !== null) {
    checklistPlaceholders.add(m[1] || m[2]);
  }

  // ── LA-STRUCT-001: Has substitution checklist section ─────────────────────

  if (checklistStartIdx < 0) {
    addFinding('LA-STRUCT-001', 'HIGH', 1, 'missing-checklist',
      'No substitution checklist section found');
  }

  // ── LA-STRUCT-002: Every [PLACEHOLDER] in body appears in checklist ───────

  for (const name of allBodyPlaceholders) {
    if (!checklistPlaceholders.has(name)) {
      // Find the line where this placeholder first appears in body
      const lineIdx = lines.findIndex((l, i) =>
        i >= bodyStartLine && (l.includes(`[${name}]`) || l.includes(`{{${name}}}`))
      );
      addFinding('LA-STRUCT-002', 'HIGH', (lineIdx >= 0 ? lineIdx + 1 : 1), 'orphan-in-body',
        `Placeholder [${name}] in body not found in substitution checklist`);
    }
  }

  // ── LA-STRUCT-003: Every checklist item appears in body ───────────────────
  // MODEL is exempt: it's used by the orchestrator for the Agent tool model parameter,
  // not substituted into the prompt body text. In dispatch-wrapped templates it appears
  // in the code block header, not the prompt content.

  for (const name of checklistPlaceholders) {
    if (name === 'MODEL') continue;
    if (!allBodyPlaceholders.has(name)) {
      // Find where it appears in the checklist
      const lineIdx = lines.findIndex(l =>
        l.includes(`[${name}]`) || l.includes(`{{${name}}}`)
      );
      addFinding('LA-STRUCT-003', 'HIGH', (lineIdx >= 0 ? lineIdx + 1 : 1), 'orphan-in-checklist',
        `Checklist item [${name}] not found in prompt body — dead substitution`);
    }
  }

  // ── LA-STRUCT-004: {{MODEL}} present ──────────────────────────────────────

  if (!content.includes('{{MODEL}}')) {
    addFinding('LA-STRUCT-004', 'HIGH', 1, 'missing-model',
      '{{MODEL}} placeholder not found in template');
  }

  // ── LA-STRUCT-005: Dispatch format block present ──────────────────────────
  // Two valid template structures exist:
  //   1. Dispatch-wrapped: code block with "Task tool (general-purpose, model: {{MODEL}})"
  //   2. Direct prompt: no dispatch wrapper, content is the prompt itself
  // Both are valid. Only flag if NEITHER structure is detected — i.e., the file has
  // a code block but it's not a dispatch block AND there's no body content outside
  // code blocks either. This catches genuinely malformed templates.

  if (codeBlockStart >= 0 && !hasDispatchBlock && bodyRegion.trim().length === 0) {
    addFinding('LA-STRUCT-005', 'MEDIUM', codeBlockStart + 1, 'missing-dispatch-block',
      'Code block found but no dispatch format, and no direct prompt body detected');
  }

  // ── LA-SEC-001: All DATA tags have role + do-not-interpret-as-instructions ─

  const dataTagRe = /<DATA\b([^>]*)>/g;
  while ((m = dataTagRe.exec(content)) !== null) {
    const attrs = m[1];
    const lineIdx = content.substring(0, m.index).split('\n').length;
    const hasRole = /\brole\s*=/.test(attrs);
    const hasDoNot = /do-not-interpret-as-instructions/.test(attrs);

    if (!hasRole) {
      addFinding('LA-SEC-001', 'HIGH', lineIdx, 'data-tag-missing-role',
        'DATA tag missing "role" attribute');
    }
    if (!hasDoNot) {
      addFinding('LA-SEC-001', 'HIGH', lineIdx, 'data-tag-missing-do-not-interpret',
        'DATA tag missing "do-not-interpret-as-instructions" attribute');
    }
  }

  // ── LA-SEC-002: IMPORTANT instruction about DATA tags exists ──────────────

  if (!/IMPORTANT.*DATA tag/i.test(content) && !/IMPORTANT.*content between DATA/i.test(content)) {
    // Only flag if there are DATA tags present (no DATA tags = no need for the instruction)
    if (/<DATA\b/.test(content)) {
      addFinding('LA-SEC-002', 'MEDIUM', 1, 'missing-data-instruction',
        'Template has DATA tags but no IMPORTANT instruction about treating DATA content as raw input');
    }
  }

  // ── LA-CON-001: Placeholder syntax convention ─────────────────────────────
  // {{DOUBLE_BRACE}} should only be used for MODEL and section-level substitutions
  // (section-level = appears on its own line, is an entire block replacement)

  for (const name of bodyBracePlaceholders) {
    if (SECTION_LEVEL_EXEMPTIONS.has(name)) continue;

    // Check if this appears on its own line (section-level substitution)
    const isSectionLevel = lines.some(l => {
      const trimmed = l.trim();
      return trimmed === `{{${name}}}`;
    });

    if (!isSectionLevel) {
      const lineIdx = lines.findIndex(l => l.includes(`{{${name}}}`));
      addFinding('LA-CON-001', 'MEDIUM', (lineIdx >= 0 ? lineIdx + 1 : 1), 'brace-convention-violation',
        `{{${name}}} uses double-brace syntax but is inline content substitution. Convention: use [${name}]`);
    }
  }

  return findings;
}

// ─── OUTPUT FORMATTING ───────────────────────────────────────────────────────

function formatFinding(f) {
  return `${f.id} | ${f.severity} | ${f.confidence} | ${f.file}:${f.line} | ${f.checkId}\n  > ${f.message}`;
}

function formatReport(allFindings, templateCount, jsonMode) {
  if (jsonMode) {
    return JSON.stringify({ templates: templateCount, findings: allFindings }, null, 2);
  }

  const high = allFindings.filter(f => f.severity === 'HIGH');
  const medium = allFindings.filter(f => f.severity === 'MEDIUM');

  const lines = [];
  lines.push('');
  lines.push(c.bold('Agent Template Lint Report'));
  lines.push('');
  lines.push(`Templates scanned: ${templateCount} | Findings: ${allFindings.length} (${c.red(high.length + ' HIGH')} / ${c.yellow(medium.length + ' MEDIUM')})`);
  lines.push('');

  if (high.length > 0) {
    lines.push(c.red('─── HIGH ───────────────────────────────────────────'));
    for (const f of high) {
      lines.push(c.red(formatFinding(f)));
    }
    lines.push('');
  }

  if (medium.length > 0) {
    lines.push(c.yellow('─── MEDIUM ─────────────────────────────────────────'));
    for (const f of medium) {
      lines.push(c.yellow(formatFinding(f)));
    }
    lines.push('');
  }

  if (allFindings.length === 0) {
    lines.push(c.green('No findings. All templates pass structural lint.'));
    lines.push('');
  }

  const result = high.length > 0 ? c.red('FAIL') : c.green('PASS');
  lines.push(`Result: ${result} (${high.length} HIGH)`);
  lines.push('');

  return lines.join('\n');
}

// ─── CHECK OPERATION_CLASS ──────────────────────────────────────────────────

function checkOperationClass() {
  const skillsDir = 'skills';
  const skillDirs = fs.readdirSync(skillsDir).filter(d =>
    fs.statSync(path.join(skillsDir, d)).isDirectory()
  );

  const errors = [];
  const results = [];

  for (const dir of skillDirs) {
    const skillFile = path.join(skillsDir, dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      errors.push({ skill: dir, error: 'SKILL.md not found' });
      continue;
    }
    const content = fs.readFileSync(skillFile, 'utf8');
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
      errors.push({ skill: dir, error: 'No YAML frontmatter found' });
      continue;
    }
    const fm = fmMatch[1];
    const ocMatch = fm.match(/^operation_class:\s*(\S+)/m);
    if (!ocMatch) {
      errors.push({ skill: dir, error: 'Missing operation_class field' });
      continue;
    }
    const oc = ocMatch[1];
    if (!VALID_OPERATION_CLASSES.has(oc)) {
      errors.push({ skill: dir, error: `Invalid operation_class: "${oc}"` });
      continue;
    }
    results.push({ skill: dir, operation_class: oc });
  }

  // Print results
  for (const r of results) {
    console.log(c.green('  PASS') + `  ${r.skill} → ${r.operation_class}`);
  }
  for (const e of errors) {
    console.log(c.red('  FAIL') + `  ${e.skill}: ${e.error}`);
  }

  if (errors.length > 0) {
    console.log(c.bold(c.red(`\n${errors.length} skill(s) failed operation_class check.`)));
    process.exit(1);
  }
  console.log(c.bold(c.green(`\nAll ${results.length} skills have valid operation_class.`)));
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'check-operation-class') {
    checkOperationClass();
    return;
  }

  if (command !== 'lint') {
    console.log(`Usage: node pipeline-lint-agents.js lint [--changed] [--json] [--files "f1 f2"] [--exclude "pattern1,pattern2"]`);
    console.log(`       node pipeline-lint-agents.js check-operation-class`);
    process.exit(0);
  }

  const opts = {
    changed: args.includes('--changed'),
    json: args.includes('--json'),
    files: null,
    exclude: [],
  };

  const filesIdx = args.indexOf('--files');
  if (filesIdx >= 0 && args[filesIdx + 1]) {
    opts.files = args[filesIdx + 1];
  }

  const excludeIdx = args.indexOf('--exclude');
  if (excludeIdx >= 0 && args[excludeIdx + 1]) {
    opts.exclude = args[excludeIdx + 1].split(',').map(s => s.trim()).filter(Boolean);
  }

  let templates = discoverTemplates(opts);

  // Apply exclude patterns (simple substring/glob matching)
  if (opts.exclude.length > 0) {
    templates = templates.filter(tmpl => {
      const normalized = tmpl.replace(/\\/g, '/');
      return !opts.exclude.some(pattern => {
        // Support simple wildcard: skills/deprecated/* matches skills/deprecated/anything
        if (pattern.includes('*')) {
          // Escape regex special chars except *, then replace * with .*
          const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
          const re = new RegExp('^' + escaped + '$');
          return re.test(normalized);
        }
        return normalized.includes(pattern);
      });
    });
  }

  if (templates.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ templates: 0, findings: [] }));
    } else {
      console.log(c.dim('No prompt templates found to lint.'));
    }
    process.exit(0);
  }

  const allFindings = [];
  for (const tmpl of templates) {
    try {
      const findings = checkTemplate(tmpl);
      allFindings.push(...findings);
    } catch (err) {
      console.error(c.red(`Error reading ${tmpl}: ${err.message}`));
    }
  }

  // Sort: HIGH first, then MEDIUM, then by file
  allFindings.sort((a, b) => {
    const sevOrder = { HIGH: 0, MEDIUM: 1 };
    const diff = (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
    if (diff !== 0) return diff;
    return a.file.localeCompare(b.file);
  });

  console.log(formatReport(allFindings, templates.length, opts.json));

  const hasHigh = allFindings.some(f => f.severity === 'HIGH');
  process.exit(hasHigh ? 1 : 0);
}

main();
