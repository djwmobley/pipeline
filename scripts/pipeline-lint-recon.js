#!/usr/bin/env node
/**
 * pipeline-lint-recon.js — Deterministic structural linter for architecture-recon
 * Constraints Block output.
 *
 * Validates that [File:], [File:line], [Function:], [Field:], [Pattern:], and
 * [Library:] anchors actually resolve against the filesystem and that prose lines
 * inside the Constraints Block do not contain unanchored path-like or function-call-
 * like tokens.
 *
 * Usage:
 *   node scripts/pipeline-lint-recon.js --recon <path> [--strict|--lenient] [--json] [--quiet]
 *   node scripts/pipeline-lint-recon.js --self-test
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — at least one finding
 *   2 — usage error or file not found
 *   3 — internal parser error (malformed Constraints Block preventing analysis)
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

// ─── ANCHOR VOCABULARY (canonical — exported for downstream generators) ─────
// The five anchor types this linter recognizes. [File: ...] additionally
// supports a `:line` variant (e.g., [File: scripts/foo.js:42]); that is a
// validator-level detail, not a separate anchor type.
const ANCHOR_TYPES = ['File', 'Function', 'Field', 'Pattern', 'Library'];

// Recommended retry cap for orchestrators that re-dispatch a recon agent
// after a failing lint pass. Architecture skill's Step 1b uses this value.
const MAX_LINT_ITERATIONS = 3;

// ─── PATTERN ALLOWLIST ───────────────────────────────────────────────────────

const ARCH_PATTERN_ALLOWLIST = new Set([
  'named-export', 'default-export', 'function-component', 'arrow-component',
  'kebab-case', 'camelCase', 'PascalCase', 'use-client', 'use-server',
  'feature-based', 'layer-based', 'hybrid', 'raw-sql', 'orm', 'query-builder',
  'middleware', 'repository', 'factory', 'singleton',
]);

// ─── PROSE STOP-WORDS ────────────────────────────────────────────────────────
// Common English words that end with "(" in natural language constructs.
// Prevents false positives in function-in-prose-without-anchor detection.
const PROSE_STOP_WORDS = new Set([
  'if', 'when', 'while', 'for', 'switch', 'catch', 'function', 'return',
  'await', 'async', 'new', 'delete', 'typeof', 'instanceof', 'void',
  'throw', 'try', 'with', 'in', 'of', 'not', 'and', 'or', 'but', 'so',
  'because', 'since', 'after', 'before', 'until', 'unless', 'although',
  'though', 'even', 'just', 'only', 'also', 'then', 'thus', 'hence',
  'via', 'per', 'e', 'i', 'etc', 'eg', 'ie', 'note', 'see', 'check',
  'use', 'run', 'set', 'get', 'add', 'put', 'has', 'is', 'are', 'was',
  'be', 'do', 'did', 'does', 'can', 'could', 'should', 'would', 'may',
  'might', 'must', 'shall', 'will', 'let', 'var', 'const', 'class',
]);

// ─── REGEX MATCH HELPER ──────────────────────────────────────────────────────
// Wraps global regex iteration without using the .exec() method name directly.
// Returns an array of match objects for a global regex on a string.
function allMatches(re, str) {
  return Array.from(str.matchAll(re));
}

// ─── CONSTRAINTS BLOCK EXTRACTOR ─────────────────────────────────────────────

/**
 * extractConstraintsBlock(markdownString) => {
 *   blockLines: string[],  // lines of the Constraints Block only
 *   startLine:  number,    // 1-indexed line number in the original file
 *   endLine:    number,    // 1-indexed line number of last line
 * }
 * Returns null if no Constraints Block found.
 */
function extractConstraintsBlock(markdownString) {
  const lines = markdownString.split('\n');

  // If the file starts with ## Constraints Block, treat the whole file as the block.
  if (lines[0] && /^##\s+Constraints Block/i.test(lines[0].trim())) {
    return { blockLines: lines, startLine: 1, endLine: lines.length };
  }

  // Otherwise, find ## Constraints Block heading inside a larger document.
  let blockStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Constraints Block/i.test(lines[i])) {
      blockStart = i;
      break;
    }
  }

  if (blockStart < 0) {
    // No heading — if file looks like a standalone block (starts with ### Existing Stack), accept it.
    const firstNonBlank = lines.findIndex(l => l.trim() !== '');
    if (firstNonBlank >= 0 && /^###\s+Existing Stack/i.test(lines[firstNonBlank])) {
      return { blockLines: lines, startLine: 1, endLine: lines.length };
    }
    return null;
  }

  // Find the end: next ## heading or EOF
  let blockEnd = lines.length;
  for (let i = blockStart + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { blockEnd = i; break; }
  }

  return {
    blockLines: lines.slice(blockStart, blockEnd),
    startLine:  blockStart + 1,
    endLine:    blockStart + (blockEnd - blockStart),
  };
}

// ─── CONSTRAINTS BLOCK PARSER ────────────────────────────────────────────────

/**
 * parseConstraintsBlock(blockLines) => {
 *   sections: Map<string, { startIdx, lines: {text, lineIdx}[] }>
 *   stackEntries: { name, version, lineIdx }[]
 *   patternLines: { text, lineIdx }[]
 *   domainLines:  { text, lineIdx }[]
 *   testLines:    { text, lineIdx }[]
 *   envLines:     { text, lineIdx }[]
 * }
 */
function parseConstraintsBlock(blockLines) {
  const sections = new Map();
  let currentSection = null;

  const SECTION_NAMES = [
    'Existing Stack', 'Established Patterns', 'Relevant Domains',
    'Existing Test Coverage', 'Environment Requirements',
  ];

  for (let i = 0; i < blockLines.length; i++) {
    const line = blockLines[i];
    const hm = line.match(/^###\s+(.+)/);
    if (hm) {
      const name = hm[1].trim();
      if (SECTION_NAMES.includes(name)) {
        currentSection = name;
        sections.set(name, { startIdx: i, lines: [] });
      } else {
        currentSection = null;
      }
      continue;
    }
    if (currentSection && sections.has(currentSection)) {
      sections.get(currentSection).lines.push({ text: line, lineIdx: i });
    }
  }

  // ── Derived slices ────────────────────────────────────────────────────────
  function secLines(name) {
    const sec = sections.get(name);
    return sec ? sec.lines.filter(l => l.text.trim() !== '' && !/^(###|##)/.test(l.text)) : [];
  }

  const stackEntries = secLines('Existing Stack').map(({ text, lineIdx }) => {
    const sm = text.match(/^\[?([^\]]+)\]?\s*:\s*(.+)/);
    return sm ? { name: sm[1].trim(), version: sm[2].trim(), lineIdx } : null;
  }).filter(Boolean);

  return {
    sections,
    stackEntries,
    patternLines: secLines('Established Patterns'),
    domainLines:  secLines('Relevant Domains'),
    testLines:    secLines('Existing Test Coverage'),
    envLines:     secLines('Environment Requirements'),
  };
}

// ─── ANCHOR PARSER ───────────────────────────────────────────────────────────

/**
 * parseLineAnchors(lineText) => { files, functions, fields, patterns, libraries }
 */
function parseLineAnchors(lineText) {
  const result = { files: [], functions: [], fields: [], patterns: [], libraries: [] };
  const anchorRe = /\[([A-Za-z]+):\s*([^\]]+)\]/g;
  for (const m of allMatches(anchorRe, lineText)) {
    const key   = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'file')     result.files.push(value);
    if (key === 'function') result.functions.push(value);
    if (key === 'field')    result.fields.push(value);
    if (key === 'pattern')  result.patterns.push(value);
    if (key === 'library')  result.libraries.push(value);
  }
  return result;
}

// ─── UTILITY ─────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readFileLines(absPath) {
  try {
    return fs.readFileSync(absPath, 'utf8').split('\n');
  } catch (_) {
    return null;
  }
}

/**
 * nameAppearsInFile — checks for common code declaration patterns.
 */
function nameAppearsInFile(name, fileLines) {
  const escaped = escapeRegex(name);
  const pats = [
    new RegExp(`\\bfunction\\s+${escaped}\\b`),
    new RegExp(`\\bconst\\s+${escaped}\\s*=`),
    new RegExp(`\\blet\\s+${escaped}\\s*=`),
    new RegExp(`\\bvar\\s+${escaped}\\s*=`),
    new RegExp(`\\b${escaped}\\s*\\(`),
    new RegExp(`\\b${escaped}\\s*:`),
    new RegExp(`\\b${escaped}\\s*=>`),
    new RegExp(`\\bclass\\s+${escaped}\\b`),
    new RegExp(`["']${escaped}["']`),
    new RegExp(`^\\s*${escaped}\\s*$`, 'm'),
  ];
  const content = fileLines.join('\n');
  return pats.some(re => re.test(content));
}

/**
 * loadPackageJsonDeps(projectRoot) => Set<string>
 * Reads dependencies + devDependencies from package.json and scripts/package.json.
 */
function loadPackageJsonDeps(projectRoot) {
  const deps = new Set();
  const candidates = [
    path.join(projectRoot, 'package.json'),
    path.join(projectRoot, 'scripts', 'package.json'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const key of Object.keys(pkg.dependencies || {})) deps.add(key);
      for (const key of Object.keys(pkg.devDependencies || {})) deps.add(key);
    } catch (_) { /* ignore malformed package.json */ }
  }
  return deps;
}

// ─── ANCHOR VALIDATORS ───────────────────────────────────────────────────────

/**
 * validateFileAnchor — resolves a [File: path] or [File: path:NN] anchor.
 */
function validateFileAnchor({ rawValue, lineNo, projectRoot }) {
  const lineNumMatch = rawValue.match(/^(.+):(\d+)$/);
  const filePart  = lineNumMatch ? lineNumMatch[1].trim() : rawValue.trim();
  const lineNum   = lineNumMatch ? parseInt(lineNumMatch[2], 10) : null;

  const absPath = path.resolve(projectRoot, filePart);
  if (!fs.existsSync(absPath)) {
    return [new Finding({
      rule:       'file-anchor-resolution',
      severity:   'error',
      line:       lineNo,
      rowId:      null,
      message:    `[File: ${rawValue}] — path does not exist: ${filePart}`,
      suggestion: `Verify the path is correct relative to the project root.`,
    })];
  }

  if (lineNum !== null) {
    const fileLines = readFileLines(absPath);
    if (!fileLines || fileLines.length < lineNum) {
      return [new Finding({
        rule:       'file-line-out-of-range',
        severity:   'error',
        line:       lineNo,
        rowId:      null,
        message:    `[File: ${rawValue}] — line ${lineNum} out of range (file has ${fileLines ? fileLines.length : '?'} lines)`,
        suggestion: `Check the line number. File has ${fileLines ? fileLines.length : 'unknown'} lines.`,
      })];
    }
  }

  return [];
}

/**
 * validateFunctionAnchor — [Function: name] must co-cite [File: path]
 * and name must appear in that file.
 */
function validateFunctionAnchor({ funcName, fileAnchors, lineNo, projectRoot }) {
  if (fileAnchors.length === 0) {
    return [new Finding({
      rule:       'function-no-file',
      severity:   'error',
      line:       lineNo,
      rowId:      null,
      message:    `[Function: ${funcName}] has no co-cited [File: ...] anchor on the same line`,
      suggestion: `Add [File: path/to/file] on the same line to anchor the function claim.`,
    })];
  }

  for (const rawFile of fileAnchors) {
    const filePart = rawFile.replace(/:(\d+)$/, '').trim();
    const absPath  = path.resolve(projectRoot, filePart);
    if (!fs.existsSync(absPath)) continue; // file-anchor-resolution will report this
    const fileLines = readFileLines(absPath);
    if (!fileLines) continue;
    if (nameAppearsInFile(funcName, fileLines)) return [];
  }

  return [new Finding({
    rule:       'function-not-found',
    severity:   'error',
    line:       lineNo,
    rowId:      null,
    message:    `[Function: ${funcName}] — name not found in co-cited file(s): ${fileAnchors.join(', ')}`,
    suggestion: `Verify "${funcName}" is declared in the cited file(s), or correct the anchor.`,
  })];
}

/**
 * validateFieldAnchor — same rules as Function anchor.
 */
function validateFieldAnchor({ fieldName, fileAnchors, lineNo, projectRoot }) {
  if (fileAnchors.length === 0) {
    return [new Finding({
      rule:       'field-no-file',
      severity:   'error',
      line:       lineNo,
      rowId:      null,
      message:    `[Field: ${fieldName}] has no co-cited [File: ...] anchor on the same line`,
      suggestion: `Add [File: path/to/file] on the same line to anchor the field claim.`,
    })];
  }

  for (const rawFile of fileAnchors) {
    const filePart = rawFile.replace(/:(\d+)$/, '').trim();
    const absPath  = path.resolve(projectRoot, filePart);
    if (!fs.existsSync(absPath)) continue;
    const fileLines = readFileLines(absPath);
    if (!fileLines) continue;
    if (nameAppearsInFile(fieldName, fileLines)) return [];
  }

  return [new Finding({
    rule:       'field-not-found',
    severity:   'error',
    line:       lineNo,
    rowId:      null,
    message:    `[Field: ${fieldName}] — name not found in co-cited file(s): ${fileAnchors.join(', ')}`,
    suggestion: `Verify "${fieldName}" appears in the cited file(s), or correct the anchor.`,
  })];
}

/**
 * validatePatternAnchor — [Pattern: name] is valid if name is in the allowlist
 * OR a co-cited [File: path] exists and name appears as a string in that file.
 */
function validatePatternAnchor({ patternName, fileAnchors, lineNo, projectRoot, strict }) {
  if (ARCH_PATTERN_ALLOWLIST.has(patternName)) return [];

  if (fileAnchors.length === 0) {
    return [new Finding({
      rule:       'pattern-not-in-allowlist-or-file',
      severity:   strict ? 'error' : 'warning',
      line:       lineNo,
      rowId:      null,
      message:    `[Pattern: ${patternName}] — not in arch-pattern allowlist and no [File: ...] anchor cited`,
      suggestion: `Either use a recognized pattern name (${Array.from(ARCH_PATTERN_ALLOWLIST).slice(0, 4).join(', ')}, ...) or cite a [File: ...] where this pattern is documented.`,
    })];
  }

  for (const rawFile of fileAnchors) {
    const filePart = rawFile.replace(/:(\d+)$/, '').trim();
    const absPath  = path.resolve(projectRoot, filePart);
    if (!fs.existsSync(absPath)) continue;
    const fileLines = readFileLines(absPath);
    if (!fileLines) continue;
    if (fileLines.some(l => l.includes(patternName))) return [];
  }

  return [new Finding({
    rule:       'pattern-not-in-allowlist-or-file',
    severity:   strict ? 'error' : 'warning',
    line:       lineNo,
    rowId:      null,
    message:    `[Pattern: ${patternName}] — not in allowlist and string not found in co-cited file(s)`,
    suggestion: `Verify "${patternName}" appears in the cited file(s) or correct the pattern name.`,
  })];
}

/**
 * validateLibraryAnchor — [Library: name] must be in any package.json deps.
 */
function validateLibraryAnchor({ libName, lineNo, allDeps }) {
  // Strip optional version suffix so [Library: react@18] matches a "react" key.
  const bareLib = libName.replace(/@[^\s]*$/, '');
  if (allDeps.has(libName) || allDeps.has(bareLib)) return [];
  return [new Finding({
    rule:       'library-not-in-deps',
    severity:   'error',
    line:       lineNo,
    rowId:      null,
    message:    `[Library: ${libName}] — not found in dependencies of any package.json`,
    suggestion: `Check that "${libName}" is listed in package.json or scripts/package.json dependencies.`,
  })];
}

// ─── PROSE-FABRICATION VALIDATORS ────────────────────────────────────────────

/**
 * buildFenceSet — returns a Set of line indices that are inside code fences.
 */
function buildFenceSet(blockLines) {
  const fenced = new Set();
  let inside = false;
  for (let i = 0; i < blockLines.length; i++) {
    if (/^```/.test(blockLines[i])) inside = !inside;
    if (inside) fenced.add(i);
  }
  return fenced;
}

/**
 * checkPathInProse — raise finding if a line has a path-like file token not
 * covered by a [File: ...] anchor on the same line.
 */
function checkPathInProse({ lineText, lineNo, fileAnchors, strict }) {
  const pathRe = /[a-z][\w.\-/]*\.(js|ts|tsx|jsx|md|sql|yml|yaml|json|sh|py|go|rs|toml|env)\b/gi;
  const prose  = lineText.replace(/\[[A-Za-z]+:\s*[^\]]+\]/g, '');
  const anchoredPaths = new Set(fileAnchors.map(f => f.replace(/:(\d+)$/, '').trim()));

  const findings = [];
  for (const m of allMatches(pathRe, prose)) {
    const tok = m[0];
    if (anchoredPaths.has(tok)) continue;
    const alreadyAnchored = Array.from(anchoredPaths).some(p => p.endsWith(tok) || tok.endsWith(p));
    if (alreadyAnchored) continue;
    findings.push(new Finding({
      rule:       'path-in-prose-without-anchor',
      severity:   strict ? 'error' : 'warning',
      line:       lineNo,
      rowId:      null,
      message:    `prose names path-like token "${tok}" without a [File: ${tok}] anchor on the same line`,
      suggestion: `Replace with [File: ${tok}] anchor or remove the path reference.`,
    }));
  }
  return findings;
}

/**
 * checkFunctionInProse — raise finding if a line has identifier-paren token not
 * covered by [Function: ...] or [File: ...] anchor on the same line.
 */
function checkFunctionInProse({ lineText, lineNo, anchors, strict }) {
  if (anchors.files.length > 0)     return []; // file anchor present — exempt
  if (anchors.functions.length > 0) return []; // function anchor present — exempt

  const funcRe = /\b([a-z_][a-zA-Z0-9_]*)\s*\(/g;
  const prose  = lineText.replace(/\[[A-Za-z]+:\s*[^\]]+\]/g, '');

  for (const m of allMatches(funcRe, prose)) {
    const name = m[1];
    if (PROSE_STOP_WORDS.has(name)) continue;
    if (name.length <= 2) continue;
    return [new Finding({
      rule:       'function-in-prose-without-anchor',
      severity:   strict ? 'error' : 'warning',
      line:       lineNo,
      rowId:      null,
      message:    `prose contains function-call token "${name}(" without a [Function: ${name}] or [File: ...] anchor`,
      suggestion: `Add [Function: ${name}] with a co-cited [File: ...], or add [File: ...] alone if citing context only.`,
    })];
  }
  return [];
}

/**
 * checkClaimWithoutAnchor — raise finding if a content line in the anchor-required
 * sections has no [File: ...], [Pattern: ...], or [Library: ...] anchor.
 */
function checkClaimWithoutAnchor({ lineText, lineNo, strict }) {
  const anchors = parseLineAnchors(lineText);
  const hasAnchor = anchors.files.length > 0 || anchors.patterns.length > 0 || anchors.libraries.length > 0;
  if (hasAnchor) return [];

  // Short label lines like "Test framework: vitest" (6 words or fewer) are exempt.
  if (/^[-*]?\s*[\w\s]+:\s*\S/.test(lineText.trim()) && lineText.trim().split(' ').length <= 6) return [];

  return [new Finding({
    rule:       'claim-without-anchor',
    severity:   strict ? 'error' : 'warning',
    line:       lineNo,
    rowId:      null,
    message:    `content line has no [File: ...], [Pattern: ...], or [Library: ...] anchor`,
    suggestion: `Add at least one anchor to substantiate this claim, or restructure as a bullet entry with an anchor.`,
  })];
}

// ─── MAIN LINTER ─────────────────────────────────────────────────────────────

/**
 * lintConstraintsBlock(blockLines, blockStartLine, projectRoot, options) => Finding[]
 */
function lintConstraintsBlock(blockLines, blockStartLine, projectRoot, options) {
  const strict   = options && options.strict !== false;
  const findings = [];
  const allDeps  = loadPackageJsonDeps(projectRoot);
  const parsed   = parseConstraintsBlock(blockLines);
  const fenced   = buildFenceSet(blockLines);

  // ── Section presence ──────────────────────────────────────────────────────
  const REQUIRED = ['Existing Stack', 'Established Patterns', 'Relevant Domains', 'Existing Test Coverage'];
  for (const sec of REQUIRED) {
    if (!parsed.sections.has(sec)) {
      findings.push(new Finding({
        rule:       'section-missing',
        severity:   'warning',
        line:       blockStartLine,
        rowId:      null,
        message:    `Constraints Block missing ### ${sec} section`,
        suggestion: `Add the ### ${sec} section per the recon agent output format.`,
      }));
    }
  }

  // ── Validate all anchors on every non-fenced line ─────────────────────────
  for (let i = 0; i < blockLines.length; i++) {
    if (fenced.has(i)) continue;
    const lineText = blockLines[i];
    const lineNo   = blockStartLine + i;
    const anchors  = parseLineAnchors(lineText);

    // [File: ...] and [File: path:NN]
    for (const rawFile of anchors.files) {
      findings.push(...validateFileAnchor({ rawValue: rawFile, lineNo, projectRoot }));
    }

    // [Function: name]
    for (const funcName of anchors.functions) {
      findings.push(...validateFunctionAnchor({ funcName, fileAnchors: anchors.files, lineNo, projectRoot }));
    }

    // [Field: name]
    for (const fieldName of anchors.fields) {
      findings.push(...validateFieldAnchor({ fieldName, fileAnchors: anchors.files, lineNo, projectRoot }));
    }

    // [Pattern: name]
    for (const patternName of anchors.patterns) {
      findings.push(...validatePatternAnchor({ patternName, fileAnchors: anchors.files, lineNo, projectRoot, strict }));
    }

    // [Library: name]
    for (const libName of anchors.libraries) {
      findings.push(...validateLibraryAnchor({ libName, lineNo, allDeps }));
    }
  }

  // ── Prose-fabrication checks on anchor-required sections ──────────────────
  const CLAIM_SECTIONS = ['Established Patterns', 'Relevant Domains', 'Existing Test Coverage'];
  for (const secName of CLAIM_SECTIONS) {
    const sec = parsed.sections.get(secName);
    if (!sec) continue;
    for (const { text, lineIdx } of sec.lines) {
      if (text.trim() === '' || /^###/.test(text)) continue;
      if (fenced.has(lineIdx)) continue;
      const lineNo  = blockStartLine + lineIdx;
      const anchors = parseLineAnchors(text);

      findings.push(...checkPathInProse({ lineText: text, lineNo, fileAnchors: anchors.files, strict }));
      findings.push(...checkFunctionInProse({ lineText: text, lineNo, anchors, strict }));
      findings.push(...checkClaimWithoutAnchor({ lineText: text, lineNo, strict }));
    }
  }

  return findings;
}

// ─── HUMAN-READABLE OUTPUT ────────────────────────────────────────────────────

function formatHuman(findings, reconPath, parsed, blockInfo, options) {
  const quiet = options && options.quiet;
  const out   = [];

  const stackSec = parsed.sections.get('Existing Stack');
  const patSec   = parsed.sections.get('Established Patterns');
  const domSec   = parsed.sections.get('Relevant Domains');

  const countLines = (sec) => sec ? sec.lines.filter(l => l.text.trim() !== '').length : 0;

  out.push(`pipeline-lint-recon: scanning ${reconPath}`);
  out.push(`  Stack entries: ${countLines(stackSec)}`);
  out.push(`  Patterns: ${countLines(patSec)}`);
  out.push(`  Domains: ${countLines(domSec)}`);
  out.push(`  Constraints Block: lines ${blockInfo.startLine}-${blockInfo.endLine}`);
  out.push('');

  const errors   = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  const infos    = findings.filter(f => f.severity === 'info');

  for (const f of errors) {
    const loc = f.row_id ? `${f.row_id} ` : '';
    const sug = f.suggestion ? ` — hint: ${f.suggestion}` : '';
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
    out.push(`${errors.length + warnings.length} finding(s) across Constraints Block.`);
    if (errors.length > 0) out.push('Exit 1.');
  }

  return out.join('\n');
}

// ─── SELF-TESTS ──────────────────────────────────────────────────────────────

function runSelfTests() {
  let passed = 0;
  let failed = 0;

  const REAL_ROOT    = path.resolve(__dirname, '..');
  const EMBED_PATH   = 'scripts/pipeline-embed.js';
  const EMBED_EXISTS = fs.existsSync(path.join(REAL_ROOT, EMBED_PATH));

  function assert(label, condition) {
    if (condition) {
      console.log(c.green('  PASS') + `  ${label}`);
      passed++;
    } else {
      console.log(c.red('  FAIL') + `  ${label}`);
      failed++;
    }
  }

  function lint(md, opts) {
    const block = extractConstraintsBlock(md);
    if (!block) {
      return [new Finding({ rule: 'no-block', severity: 'error', line: 1, rowId: null, message: 'No Constraints Block found' })];
    }
    return lintConstraintsBlock(block.blockLines, block.startLine, REAL_ROOT, opts || { strict: true });
  }

  // ── Test 1: Clean well-anchored block → zero errors ───────────────────────
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '[DB]: pg 8.x [Library: pg]',
      '',
      '### Established Patterns',
      '- Uses [Pattern: raw-sql] for all queries',
      '',
      '### Relevant Domains',
      '- DATA: database layer [Pattern: repository]',
      '',
      '### Existing Test Coverage',
      '- Test framework: none [Pattern: named-export]',
      '',
      '### Environment Requirements',
      'DATABASE_URL required',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const errors   = findings.filter(f => f.severity === 'error');
    assert('Test 1: clean well-anchored block → zero errors', errors.length === 0);
  }

  // ── Test 2: [File: missing.js] → file-anchor-resolution error ────────────
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '',
      '### Established Patterns',
      '- [File: path/to/totally-missing-file-99999.js] pattern here',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const fileFail = findings.some(f => f.rule === 'file-anchor-resolution' && f.message.includes('totally-missing-file-99999.js'));
    assert('Test 2: [File: missing.js] → file-anchor-resolution error', fileFail);
  }

  // ── Test 3: [File: scripts/pipeline-lint-plan.js:99999] → line out of range
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '',
      '### Established Patterns',
      '- [File: scripts/pipeline-lint-plan.js:99999] something',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const lineFail = findings.some(f => f.rule === 'file-line-out-of-range');
    assert('Test 3: [File: scripts/pipeline-lint-plan.js:99999] → file-line-out-of-range error', lineFail);
  }

  // ── Test 4: [Function: cmdIndex] + [File: pipeline-embed.js] → resolves ───
  {
    if (!EMBED_EXISTS) {
      console.log(c.yellow('  SKIP') + `  Test 4: ${EMBED_PATH} not found — skipping`);
    } else {
      const md = [
        '## Constraints Block',
        '',
        '### Existing Stack',
        '',
        '### Established Patterns',
        `- [Function: cmdIndex] [File: ${EMBED_PATH}]`,
        '',
        '### Relevant Domains',
        '',
        '### Existing Test Coverage',
      ].join('\n');

      const findings = lint(md, { strict: true });
      const funcErr  = findings.some(f => f.rule === 'function-not-found' || f.rule === 'function-no-file');
      assert('Test 4: [Function: cmdIndex] + [File: pipeline-embed.js] → resolves cleanly', !funcErr);
    }
  }

  // ── Test 5: [Function: nonexistentFuncXYZ123] + real file → not-found ─────
  {
    if (!EMBED_EXISTS) {
      console.log(c.yellow('  SKIP') + `  Test 5: ${EMBED_PATH} not found — skipping`);
    } else {
      const md = [
        '## Constraints Block',
        '',
        '### Existing Stack',
        '',
        '### Established Patterns',
        `- [Function: nonexistentFuncXYZ123] [File: ${EMBED_PATH}]`,
        '',
        '### Relevant Domains',
        '',
        '### Existing Test Coverage',
      ].join('\n');

      const findings = lint(md, { strict: true });
      const funcFail = findings.some(f => f.rule === 'function-not-found' && f.message.includes('nonexistentFuncXYZ123'));
      assert('Test 5: [Function: nonexistentFuncXYZ123] + real file → function-not-found error', funcFail);
    }
  }

  // ── Test 6: [Function: foo] with no co-cited [File:] → function-no-file ───
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '',
      '### Established Patterns',
      '- [Function: foo] some description',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const noFile   = findings.some(f => f.rule === 'function-no-file' && f.message.includes('foo'));
    assert('Test 6: [Function: foo] with no [File:] → function-no-file error', noFile);
  }

  // ── Test 7: [Library: react] not in any package.json → library-not-in-deps
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '[Framework]: React 18 [Library: react]',
      '',
      '### Established Patterns',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const libFail  = findings.some(f => f.rule === 'library-not-in-deps' && f.message.includes('react'));
    assert('Test 7: [Library: react] not in package.json → library-not-in-deps error', libFail);
  }

  // ── Test 8: [Library: pg] IS in scripts/package.json → resolves cleanly ───
  {
    const pgExists = loadPackageJsonDeps(REAL_ROOT).has('pg');
    if (!pgExists) {
      console.log(c.yellow('  SKIP') + '  Test 8: pg not found in scripts/package.json — skipping');
    } else {
      const md = [
        '## Constraints Block',
        '',
        '### Existing Stack',
        '[DB]: pg 8.x [Library: pg]',
        '',
        '### Established Patterns',
        '',
        '### Relevant Domains',
        '',
        '### Existing Test Coverage',
      ].join('\n');

      const findings = lint(md, { strict: true });
      const libErr   = findings.some(f => f.rule === 'library-not-in-deps' && f.message.includes('pg'));
      assert('Test 8: [Library: pg] in scripts/package.json → resolves cleanly', !libErr);
    }
  }

  // ── Test 9: [Pattern: named-export] in allowlist → resolves cleanly ───────
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '',
      '### Established Patterns',
      '- Components use [Pattern: named-export] style',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const patErr   = findings.some(f => f.rule === 'pattern-not-in-allowlist-or-file' && f.message.includes('named-export'));
    assert('Test 9: [Pattern: named-export] in allowlist → no error', !patErr);
  }

  // ── Test 10: [Pattern: bespoke-undocumented-thing] not in allowlist ────────
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '',
      '### Established Patterns',
      '- Uses [Pattern: bespoke-undocumented-thing]',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const patFail  = findings.some(f => f.rule === 'pattern-not-in-allowlist-or-file' && f.message.includes('bespoke-undocumented-thing'));
    assert('Test 10: [Pattern: bespoke-undocumented-thing] not in allowlist → error', patFail);
  }

  // ── Test 11: Path-in-prose → warning in lenient, error in strict ──────────
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '',
      '### Established Patterns',
      '- Components live in src/components/Button.tsx without an anchor',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const strictFindings  = lint(md, { strict: true });
    const lenientFindings = lint(md, { strict: false });

    const strictErr   = strictFindings.some(f => f.rule === 'path-in-prose-without-anchor' && f.severity === 'error');
    const lenientWarn = lenientFindings.some(f => f.rule === 'path-in-prose-without-anchor' && f.severity === 'warning');
    assert('Test 11: path-in-prose → error in strict, warning in lenient', strictErr && lenientWarn);
  }

  // ── Test 12: claim-without-anchor in Established Patterns → error strict ───
  {
    const md = [
      '## Constraints Block',
      '',
      '### Existing Stack',
      '',
      '### Established Patterns',
      '- This is a long-form arch claim with no anchors whatsoever making an interesting architectural statement',
      '',
      '### Relevant Domains',
      '',
      '### Existing Test Coverage',
    ].join('\n');

    const findings = lint(md, { strict: true });
    const claimErr = findings.some(f => f.rule === 'claim-without-anchor' && f.severity === 'error');
    assert('Test 12: unanchored claim in Established Patterns → error in strict', claimErr);
  }

  console.log('');
  console.log(c.bold(`Self-tests: ${passed} passed, ${failed} failed`));
  return { passed, failed };
}

// ─── MAIN CLI ─────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) {
    console.log(c.bold('pipeline-lint-recon self-tests'));
    console.log('');
    const { passed, failed } = runSelfTests();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Parse flags
  const jsonMode = argv.includes('--json');
  const quiet    = argv.includes('--quiet');
  const lenient  = argv.includes('--lenient');
  const strict   = !lenient;

  // Resolve recon path
  let reconPath = null;
  const reconIdx = argv.indexOf('--recon');
  if (reconIdx >= 0 && argv[reconIdx + 1]) {
    reconPath = argv[reconIdx + 1];
  } else {
    reconPath = argv.find(a => !a.startsWith('--')) || null;
  }

  if (!reconPath) {
    console.error('Usage: node scripts/pipeline-lint-recon.js --recon <path> [--strict|--lenient] [--json] [--quiet]');
    process.exit(2);
  }

  // Resolve project root from script location
  const scriptDir   = path.resolve(__dirname);
  const projectRoot = path.resolve(scriptDir, '..');

  const resolvedRecon = path.isAbsolute(reconPath) ? reconPath : path.resolve(projectRoot, reconPath);

  if (!fs.existsSync(resolvedRecon)) {
    console.error(`pipeline-lint-recon: file not found: ${resolvedRecon}`);
    process.exit(2);
  }

  let markdownString;
  try {
    markdownString = fs.readFileSync(resolvedRecon, 'utf8');
  } catch (err) {
    console.error(`pipeline-lint-recon: error reading file: ${err.message}`);
    process.exit(2);
  }

  let blockInfo;
  try {
    blockInfo = extractConstraintsBlock(markdownString);
  } catch (err) {
    console.error(`pipeline-lint-recon: internal parser error: ${err.message}`);
    process.exit(3);
  }

  if (!blockInfo) {
    console.error('pipeline-lint-recon: no ## Constraints Block found in file');
    process.exit(3);
  }

  const parsed = parseConstraintsBlock(blockInfo.blockLines);

  let findings;
  try {
    findings = lintConstraintsBlock(blockInfo.blockLines, blockInfo.startLine, projectRoot, { strict });
  } catch (err) {
    console.error(`pipeline-lint-recon: internal linter error: ${err.message}`);
    process.exit(3);
  }

  if (jsonMode) {
    const out = {
      path:     resolvedRecon,
      findings: findings.map(f => ({
        rule:       f.rule,
        severity:   f.severity,
        line:       f.line,
        row_id:     f.row_id,
        message:    f.message,
        suggestion: f.suggestion,
      })),
      summary: {
        errors:   findings.filter(f => f.severity === 'error').length,
        warnings: findings.filter(f => f.severity === 'warning').length,
        infos:    findings.filter(f => f.severity === 'info').length,
      },
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    console.log(formatHuman(findings, resolvedRecon, parsed, blockInfo, { quiet }));
  }

  const hasErrors = findings.some(f => f.severity === 'error');
  process.exit(hasErrors ? 1 : 0);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  extractConstraintsBlock,
  parseConstraintsBlock,
  parseLineAnchors,
  lintConstraintsBlock,
  Finding,
  ANCHOR_TYPES,
  ARCH_PATTERN_ALLOWLIST,
  MAX_LINT_ITERATIONS,
};

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if (require.main === module) {
  main();
}
