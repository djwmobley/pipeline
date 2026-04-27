#!/usr/bin/env node
/**
 * pipeline-generate-recon-prompt.js — Generator for data-shaped sections in
 * skills/architecture/recon-agent-prompt.md (and optionally other targets).
 *
 * Reads canonical ANCHOR_TYPES and ARCH_PATTERN_ALLOWLIST from
 * pipeline-lint-recon.js and rewrites HTML-comment-delimited regions in the
 * target file so those sections can never drift from the linter's own data.
 *
 * Usage:
 *   node scripts/pipeline-generate-recon-prompt.js --write [--target <path>]
 *   node scripts/pipeline-generate-recon-prompt.js --check [--target <path>]
 *   node scripts/pipeline-generate-recon-prompt.js --self-test
 *
 * Exit codes:
 *   0 — success / in-sync
 *   1 — drift detected (--check), target not found, or self-test failure
 *   2 — malformed input (unknown region id, unclosed region, bad CLI args)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { ANCHOR_TYPES, ARCH_PATTERN_ALLOWLIST } = require('./pipeline-lint-recon');

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

// ─── RENDER DETAIL MAP ───────────────────────────────────────────────────────
// This is the ONLY literal data owned by this generator.
// ANCHOR_TYPES (imported) still drives which rows appear.

const ANCHOR_RENDER = {
  File:     { syntax: '`[File: path/to/file.ext]` (or `[File: path:lineN]`)', useFor: 'Any claim backed by a file on disk' },
  Function: { syntax: '`[Function: name]`',                                    useFor: 'Named function/method found in source' },
  Field:    { syntax: '`[Field: name]`',                                       useFor: 'Struct/object field or DB column' },
  Pattern:  { syntax: '`[Pattern: name]`',                                     useFor: 'Named pattern from the allowlist (see below)' },
  Library:  { syntax: '`[Library: name]`',                                     useFor: 'Dependency from a manifest file' },
};

// ─── REGION RENDERERS ────────────────────────────────────────────────────────

/**
 * Renders the anchor-table region: a markdown table with one row per anchor type.
 * @returns {string[]} lines (no trailing newline)
 */
function renderAnchorTable() {
  const lines = [
    '| Anchor | Syntax | Use for |',
    '|--------|--------|---------|',
  ];
  for (const type of ANCHOR_TYPES) {
    const r = ANCHOR_RENDER[type];
    lines.push(`| ${type} | ${r.syntax} | ${r.useFor} |`);
  }
  return lines;
}

/**
 * Renders the pattern-allowlist region: alphabetically sorted tokens, comma-
 * separated, wrapped to ~85 chars per line, terminated with a period.
 * @returns {string[]} lines
 */
function renderPatternAllowlist() {
  const sorted = Array.from(ARCH_PATTERN_ALLOWLIST).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  const MAX_LINE = 85;
  const lines = [];
  let current = '';

  for (let i = 0; i < sorted.length; i++) {
    const token = sorted[i];
    const isLast = i === sorted.length - 1;
    const suffix = isLast ? '.' : ',';
    const piece = current.length === 0 ? token + suffix : ' ' + token + suffix;

    if (current.length > 0 && current.length + piece.length > MAX_LINE) {
      lines.push(current);
      current = token + suffix;
    } else {
      current = current.length === 0 ? token + suffix : current + ' ' + token + suffix;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

// ─── REGION DISPATCH ─────────────────────────────────────────────────────────

const KNOWN_REGIONS = new Set(['anchor-table', 'pattern-allowlist']);

/**
 * Generate content lines for a given region id.
 * Throws an Error with message `unknown region id: <id>` for unrecognized ids.
 * @param {string} regionId
 * @returns {string[]}
 */
function generateRegion(regionId) {
  switch (regionId) {
    case 'anchor-table':      return renderAnchorTable();
    case 'pattern-allowlist': return renderPatternAllowlist();
    default:
      throw new Error(`unknown region id: ${regionId}`);
  }
}

// ─── MARKER PARSING ──────────────────────────────────────────────────────────

const BEGIN_RE = /^<!-- BEGIN GENERATED: ([a-z0-9-]+) -->$/;
const END_RE   = /^<!-- END GENERATED: ([a-z0-9-]+) -->$/;

/**
 * Parse a file's lines and return an array of regions:
 *   { id, beginLine, endLine }  (0-based indices into `lines`)
 *
 * Throws on unclosed or mismatched regions.
 * Throws on unknown region ids.
 *
 * @param {string[]} lines
 * @returns {{ id: string, beginLine: number, endLine: number }[]}
 */
function parseRegions(lines) {
  const regions = [];
  let openId = null;
  let openIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const beginMatch = lines[i].match(BEGIN_RE);
    const endMatch   = lines[i].match(END_RE);

    if (beginMatch) {
      const id = beginMatch[1];
      if (!KNOWN_REGIONS.has(id)) {
        throw new Error(`unknown region id: ${id}`);
      }
      openId  = id;
      openIdx = i;
    } else if (endMatch) {
      const id = endMatch[1];
      if (openId === null) {
        throw new Error(`unclosed or mismatched region: ${id}`);
      }
      if (id !== openId) {
        throw new Error(`unclosed or mismatched region: ${openId}`);
      }
      regions.push({ id, beginLine: openIdx, endLine: i });
      openId  = null;
      openIdx = -1;
    }
  }

  if (openId !== null) {
    throw new Error(`unclosed or mismatched region: ${openId}`);
  }

  return regions;
}

// ─── CORE REWRITE ────────────────────────────────────────────────────────────

/**
 * Given the current file content (as a string), produce the rewritten content.
 * Returns the rewritten string (may be identical to input).
 *
 * @param {string} content
 * @returns {{ rewritten: string, regionIds: string[] }}
 */
function computeRewrite(content) {
  const lines   = content.split('\n');
  const regions = parseRegions(lines);  // throws on error

  if (regions.length === 0) {
    return { rewritten: content, regionIds: [] };
  }

  // Build output by slicing between regions
  const outLines = [];
  let cursor = 0;

  for (const { id, beginLine, endLine } of regions) {
    // Lines before this region (including BEGIN marker)
    outLines.push(...lines.slice(cursor, beginLine + 1));
    // Fresh generated content
    outLines.push(...generateRegion(id));
    // END marker
    outLines.push(lines[endLine]);
    cursor = endLine + 1;
  }

  // Remaining lines after last region
  outLines.push(...lines.slice(cursor));

  return { rewritten: outLines.join('\n'), regionIds: regions.map(r => r.id) };
}

// ─── SELF-TESTS ──────────────────────────────────────────────────────────────

function runSelfTests() {
  let passed = 0;
  let failed = 0;

  function assert(label, condition) {
    if (condition) {
      console.log(c.green('  PASS') + `  ${label}`);
      passed++;
    } else {
      console.log(c.red('  FAIL') + `  ${label}`);
      failed++;
    }
  }

  // ── Test 1: anchor-table renders 5 rows in correct order ─────────────────
  {
    const rows = renderAnchorTable();
    // header + separator + 5 data rows = 7 lines
    assert('Test 1: anchor-table has 7 lines (header + sep + 5 rows)', rows.length === 7);
    assert('Test 1: first data row is File', rows[2].startsWith('| File |'));
    assert('Test 1: second data row is Function', rows[3].startsWith('| Function |'));
    assert('Test 1: third data row is Field', rows[4].startsWith('| Field |'));
    assert('Test 1: fourth data row is Pattern', rows[5].startsWith('| Pattern |'));
    assert('Test 1: fifth data row is Library', rows[6].startsWith('| Library |'));
    assert('Test 1: File syntax contains [File: path/to/file.ext]', rows[2].includes('[File: path/to/file.ext]'));
    assert('Test 1: Pattern use-for references allowlist', rows[5].includes('allowlist'));
  }

  // ── Test 2: pattern-allowlist renders 19 tokens, alphabetical, period-terminated
  {
    const lines = renderPatternAllowlist();
    const full  = lines.join(' ');
    // Count commas: 18 commas for 19 items
    const commaCount = (full.match(/,/g) || []).length;
    assert('Test 2: pattern-allowlist has 18 commas (19 tokens)', commaCount === 18);
    assert('Test 2: final char is period', full.trimEnd().endsWith('.'));

    // Verify alphabetical order (case-insensitive)
    const tokens = full.replace(/[,\.]/g, '').split(/\s+/).filter(Boolean);
    assert('Test 2: 19 tokens present', tokens.length === 19);
    let sorted = true;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].toLowerCase() < tokens[i - 1].toLowerCase()) {
        sorted = false; break;
      }
    }
    assert('Test 2: tokens are case-insensitive alphabetical', sorted);

    // No line exceeds 85 chars
    const overlong = lines.some(l => l.length > 85);
    assert('Test 2: no line exceeds 85 chars', !overlong);
  }

  // ── Test 3: --write rewrites a stale region in a tmp file ────────────────
  {
    const tmpFile = path.join(os.tmpdir(), `gen-recon-test3-${Date.now()}.md`);
    const stale = [
      '# Test',
      '<!-- BEGIN GENERATED: anchor-table -->',
      '| Old | Stale | Content |',
      '<!-- END GENERATED: anchor-table -->',
      'After',
    ].join('\n');
    fs.writeFileSync(tmpFile, stale, 'utf8');

    const { rewritten, regionIds } = computeRewrite(fs.readFileSync(tmpFile, 'utf8'));
    fs.writeFileSync(tmpFile, rewritten, 'utf8');

    const after = fs.readFileSync(tmpFile, 'utf8');
    const hasOldContent = after.includes('| Old | Stale | Content |');
    const hasNewHeader  = after.includes('| Anchor | Syntax | Use for |');
    assert('Test 3: --write removes stale content', !hasOldContent);
    assert('Test 3: --write inserts fresh anchor-table header', hasNewHeader);
    assert('Test 3: regionIds includes anchor-table', regionIds.includes('anchor-table'));

    fs.unlinkSync(tmpFile);
  }

  // ── Test 4: --check exits 0 when target already matches ──────────────────
  {
    const tmpFile = path.join(os.tmpdir(), `gen-recon-test4-${Date.now()}.md`);
    // Build a file that is already in sync
    const freshRows    = renderAnchorTable();
    const freshContent = [
      '# Test',
      '<!-- BEGIN GENERATED: anchor-table -->',
      ...freshRows,
      '<!-- END GENERATED: anchor-table -->',
    ].join('\n');
    fs.writeFileSync(tmpFile, freshContent, 'utf8');

    const current    = fs.readFileSync(tmpFile, 'utf8');
    const { rewritten } = computeRewrite(current);
    const inSync = rewritten === current;
    assert('Test 4: --check exits 0 when target matches', inSync);

    fs.unlinkSync(tmpFile);
  }

  // ── Test 5: --check exits 1 when target is stale ─────────────────────────
  {
    const tmpFile = path.join(os.tmpdir(), `gen-recon-test5-${Date.now()}.md`);
    const stale = [
      '# Test',
      '<!-- BEGIN GENERATED: pattern-allowlist -->',
      'old content that is wrong',
      '<!-- END GENERATED: pattern-allowlist -->',
    ].join('\n');
    fs.writeFileSync(tmpFile, stale, 'utf8');

    const current = fs.readFileSync(tmpFile, 'utf8');
    const { rewritten } = computeRewrite(current);
    const drifted = rewritten !== current;
    assert('Test 5: --check detects drift on stale content', drifted);

    fs.unlinkSync(tmpFile);
  }

  // ── Test 6: Unknown region id throws ─────────────────────────────────────
  {
    const lines = [
      '<!-- BEGIN GENERATED: version-list -->',
      'stuff',
      '<!-- END GENERATED: version-list -->',
    ];
    let threw = false;
    try {
      parseRegions(lines);
    } catch (e) {
      threw = e.message.includes('unknown region id: version-list');
    }
    assert('Test 6: unknown region id throws with correct message', threw);
  }

  // ── Test 7: Unclosed region (BEGIN without END) throws ───────────────────
  {
    const lines = [
      '<!-- BEGIN GENERATED: anchor-table -->',
      'some content',
      '# no end marker here',
    ];
    let threw = false;
    try {
      parseRegions(lines);
    } catch (e) {
      threw = e.message.includes('unclosed or mismatched region');
    }
    assert('Test 7: BEGIN without END throws unclosed region error', threw);
  }

  console.log('');
  console.log(c.bold(`Self-tests: ${passed} passed, ${failed} failed`));
  return { passed, failed };
}

// ─── MAIN CLI ─────────────────────────────────────────────────────────────────

function main() {
  const argv  = process.argv.slice(2);
  const quiet = argv.includes('--quiet');

  if (argv.includes('--self-test')) {
    console.log(c.bold('pipeline-generate-recon-prompt self-tests'));
    console.log('');
    const { passed, failed } = runSelfTests();
    process.exit(failed > 0 ? 1 : 0);
  }

  const doWrite = argv.includes('--write');
  const doCheck = argv.includes('--check');

  if (!doWrite && !doCheck) {
    console.error('Usage: node scripts/pipeline-generate-recon-prompt.js --write|--check [--target <path>] [--quiet]');
    console.error('       node scripts/pipeline-generate-recon-prompt.js --self-test');
    process.exit(2);
  }

  if (doWrite && doCheck) {
    console.error('pipeline-generate-recon-prompt: --write and --check are mutually exclusive');
    process.exit(2);
  }

  // Resolve target path
  const projectRoot = path.resolve(__dirname, '..');
  const DEFAULT_TARGET = path.join(projectRoot, 'skills', 'architecture', 'recon-agent-prompt.md');

  let targetPath = DEFAULT_TARGET;
  const targetIdx = argv.indexOf('--target');
  if (targetIdx >= 0) {
    if (!argv[targetIdx + 1]) {
      console.error('pipeline-generate-recon-prompt: --target requires a path argument');
      process.exit(2);
    }
    const raw = argv[targetIdx + 1];
    targetPath = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
  }

  if (!fs.existsSync(targetPath)) {
    console.error(`pipeline-generate-recon-prompt: target not found: ${targetPath}`);
    process.exit(1);
  }

  let current;
  try {
    current = fs.readFileSync(targetPath, 'utf8');
  } catch (err) {
    console.error(`pipeline-generate-recon-prompt: error reading target: ${err.message}`);
    process.exit(1);
  }

  let rewritten, regionIds;
  try {
    ({ rewritten, regionIds } = computeRewrite(current));
  } catch (err) {
    const msg = err.message;
    if (msg.startsWith('unknown region id:') || msg.startsWith('unclosed or mismatched region:')) {
      console.error(`pipeline-generate-recon-prompt: ${msg}`);
      process.exit(2);
    }
    console.error(`pipeline-generate-recon-prompt: unexpected error: ${msg}`);
    process.exit(2);
  }

  const changed = rewritten !== current;

  if (doWrite) {
    if (changed) {
      fs.writeFileSync(targetPath, rewritten, 'utf8');
      if (!quiet) {
        console.log(`pipeline-generate-recon-prompt: rewrote ${regionIds.length} region(s) in ${targetPath}`);
      }
    } else {
      if (!quiet) {
        console.log(`pipeline-generate-recon-prompt: ${targetPath} already in sync`);
      }
    }
    process.exit(0);
  }

  // --check mode
  if (changed) {
    const driftedIds = regionIds; // all regions were processed; report those that changed
    console.error(`pipeline-generate-recon-prompt: ${targetPath} is out of sync; run --write to fix.`);
    for (const id of driftedIds) {
      console.error(`  region: ${id}`);
    }
    process.exit(1);
  } else {
    if (!quiet) {
      console.log(`pipeline-generate-recon-prompt: ${targetPath} is in sync.`);
    }
    process.exit(0);
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  computeRewrite,
  generateRegion,
  renderAnchorTable,
  renderPatternAllowlist,
  parseRegions,
};

if (require.main === module) { main(); }
