'use strict';
/**
 * active-skill.js — File-marker replacement for PIPELINE_ACTIVE_SKILL env var
 *
 * Hooks fire from a sibling Claude Code process; env vars do not cross process
 * boundaries. This module reads/writes a JSON file at .claude/.active-skill so
 * all hook processes can observe the active skill reliably.
 *
 * Exports: write(name), read(), clear()
 * CLI:     node scripts/lib/active-skill.js write <name>
 *          node scripts/lib/active-skill.js clear
 */

const fs   = require('fs');
const path = require('path');

const STALENESS_MS  = 60000;
const FALLBACK      = 'conversation_mode';

function getProjectRoot() {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function markerPath() {
  return path.join(getProjectRoot(), '.claude', '.active-skill');
}

/**
 * Atomically write the active skill marker.
 * @param {string} name  skill directory name (non-empty)
 */
function write(name) {
  const target = markerPath();
  const dir    = path.dirname(target);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ skill: name, ts: new Date().toISOString() }), 'utf8');
  fs.renameSync(tmp, target);
}

/**
 * Read the active skill name.
 * Returns FALLBACK when file missing, stale (>60 s), or malformed.
 * @returns {string}
 */
function read() {
  try {
    const raw  = fs.readFileSync(markerPath(), 'utf8');
    const obj  = JSON.parse(raw);
    if (!obj || !obj.ts) return FALLBACK;
    const age  = Date.now() - Date.parse(obj.ts);
    if (!Number.isFinite(age) || age > STALENESS_MS) return FALLBACK;
    return obj.skill || FALLBACK;
  } catch (_) {
    return FALLBACK;
  }
}

/**
 * Best-effort delete of the marker file.
 */
function clear() {
  try { fs.unlinkSync(markerPath()); } catch (_) {}
}

module.exports = { write, read, clear };

// ─── CLI entrypoint ───────────────────────────────────────────────────────────
if (require.main === module) {
  const [,, cmd, arg] = process.argv;
  if (cmd === 'write') {
    if (!arg || !arg.trim()) { process.stderr.write('active-skill write: name must be non-empty\n'); process.exit(1); }
    write(arg.trim());
  } else if (cmd === 'clear') {
    clear();
  } else {
    process.stderr.write('Usage: active-skill.js write <name> | clear\n');
    process.exit(1);
  }
}
