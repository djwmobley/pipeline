'use strict';
/**
 * routing-config.js — Shared config + frontmatter helpers for routing hooks
 *
 * Used by: routing-check.js, routing-log.js, routing-stop.js
 * No external dependencies. Uses same regex-based config parsing as shared.js.
 */

const fs   = require('fs');
const path = require('path');

// Cache within a single process lifetime (hooks are short-lived)
let _config = null;
let _fmCache = {};
let _pluginDir = null;

function getPluginDir() {
  if (_pluginDir) return _pluginDir;
  // Hook scripts live at scripts/hooks/; plugin dir is two levels up
  _pluginDir = process.env.PIPELINE_DIR || path.resolve(__dirname, '..', '..');
  return _pluginDir;
}

function getProjectRoot() {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadConfig() {
  if (_config) return _config;
  const root = getProjectRoot();
  const configPath = path.join(root, '.claude', 'pipeline.yml');
  if (!fs.existsSync(configPath)) {
    _config = { routing: { enabled: false } };
    return _config;
  }
  const content = fs.readFileSync(configPath, 'utf8');

  const getSection = (section) => {
    const match = content.match(new RegExp(`^${section}:.*\\n((?:[ \\t]+.*\\n?)*)`, 'm'));
    return match ? match[1] : '';
  };
  const getInSection = (section, key) => {
    const sectionContent = getSection(section);
    const match = sectionContent.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?`, 'm'));
    return match ? match[1].trim() : null;
  };
  const getNestedSection = (section, subsection) => {
    const sec = getSection(section);
    const match = sec.match(new RegExp(`^\\s*${subsection}:.*\\n((?:\\s{4,}.*\\n?)*)`, 'm'));
    return match ? match[1] : '';
  };

  const knowledgeTier = getInSection('knowledge', 'tier') || 'files';
  const routingEnabled = getInSection('routing', 'enabled');
  const chainThreshold = parseInt(getInSection('routing', 'chain_dispatch_threshold') || '2000');
  const writeThreshold = parseInt(getInSection('routing', 'direct_write_line_threshold') || '10');
  const stopThreshold  = parseInt(getInSection('routing', 'stop_hook_threshold') || '150');

  // Parse bash_block_patterns from universal_floor section.
  // The spec shipped with `\\s` etc. in regex literals — that matches
  // a literal backslash followed by `s`, not a whitespace metachar. In
  // a JS regex *literal* you write the metachar with a single backslash
  // (`\s`); the double-escape form is only correct when the pattern is
  // a string passed to `new RegExp(...)`. Without this fix, every
  // user-configured pattern was silently dropped and bashPatterns
  // always defaulted to the hardcoded fallback.
  const floorSection = getNestedSection('routing', 'universal_floor');
  const bashPatterns = [];
  const bpMatches = floorSection.matchAll(/^\s*-\s*"([^"]+)"/gm);
  for (const m of bpMatches) bashPatterns.push(m[1]);

  // Parse tier_map — same regex-literal escaping fix. Without it,
  // tierMap was always {} and the entire tier-mismatch enforcement path
  // in routing-check.js was permanently dead because `tier_map[oc]`
  // was always `undefined`.
  const tierMapSection = getNestedSection('routing', 'tier_map');
  const tierMap = {};
  for (const m of tierMapSection.matchAll(/^\s*(\w+):\s*(\S+)/gm)) {
    tierMap[m[1]] = m[2];
  }

  // Parse local_models.prose and local_models.coder
  const localProseEndpoint = getInSection('local_models', 'endpoint') || null;

  _config = {
    knowledge: { tier: knowledgeTier },
    routing: {
      enabled: routingEnabled !== 'false',
      chain_dispatch_threshold: chainThreshold,
      direct_write_line_threshold: writeThreshold,
      stop_hook_threshold: stopThreshold,
      tier_map: tierMap,
      universal_floor: {
        bash_block_patterns: bashPatterns.length > 0 ? bashPatterns : [
          // Defaults if not configured in pipeline.yml
          '^psql\\s',
          'INSERT INTO\\s',
          'UPDATE\\s+\\w+\\s+SET\\s',
          'DROP TABLE\\s',
          'DELETE FROM\\s+\\w+\\s*$',
        ],
      },
    },
    _root: root,
    _configPath: configPath,
  };
  return _config;
}

function loadSkillFrontmatter(skillName) {
  if (_fmCache[skillName]) return _fmCache[skillName];

  const pluginDir = getPluginDir();
  const skillFile = path.join(pluginDir, 'skills', skillName, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    const fm = { operation_class: 'conversation_mode', allowed_direct_write: false, _missing: true };
    _fmCache[skillName] = fm;
    return fm;
  }

  const content = fs.readFileSync(skillFile, 'utf8');
  // CRLF tolerant: Windows files have \r\n line endings; the linter in
  // Task 1 already learned this lesson, but the spec for this module
  // shipped with \n-only regex. Without \r? here, every SKILL.md on a
  // Windows checkout falls through to the _malformed default and the
  // hooks downstream silently treat every skill as conversation_mode.
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    const fm = { operation_class: 'conversation_mode', allowed_direct_write: false, _malformed: true };
    _fmCache[skillName] = fm;
    return fm;
  }

  const fm = fmMatch[1];
  const ocMatch = fm.match(/^operation_class:\s*(\S+)/m);
  const adwMatch = fm.match(/^allowed_direct_write:\s*(\S+)/m);
  const amMatch = fm.match(/^allowed_models:\s*\[([^\]]*)\]/m);

  const result = {
    operation_class:     ocMatch  ? ocMatch[1]  : 'conversation_mode',
    allowed_direct_write: adwMatch ? adwMatch[1] === 'true' : false,
    allowed_models:       amMatch  ? amMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [],
  };
  _fmCache[skillName] = result;
  return result;
}

function resolveAllowedModels(tier, overrides) {
  // Tier-to-model-name mapping (what Claude Code passes as `model` in tool_input)
  const TIER_MODELS = {
    opus:       ['claude-opus-4-5', 'claude-opus-4', 'claude-3-opus-20240229', 'opus'],
    sonnet:     ['claude-sonnet-4-5', 'claude-sonnet-4', 'claude-3-5-sonnet-20241022', 'sonnet'],
    haiku:      ['claude-haiku-4-5', 'claude-haiku-3', 'claude-3-haiku-20240307', 'haiku'],
    qwen_coder: ['qwen2.5-coder:32b', 'qwen2.5-coder'],
    qwen_prose: ['qwen2.5:14b', 'qwen2.5'],
    no_llm:     [],
    mixed:      [], // conversation_mode — handled separately
  };
  const base = TIER_MODELS[tier] || [];
  // overrides are shorthand names (e.g., 'sonnet') — expand them
  const expanded = [];
  for (const o of (overrides || [])) {
    expanded.push(...(TIER_MODELS[o] || [o]));
  }
  return [...new Set([...base, ...expanded])];
}

function writeViolation(record, config) {
  const cfg = config || loadConfig();
  const ts = new Date().toISOString();
  const full = { ts, ...record };
  const line = JSON.stringify(full);

  if (cfg.knowledge.tier === 'postgres') {
    // Write to Postgres via pipeline-db.js to avoid inline SQL.
    // stdio: ['ignore', 'pipe', 'ignore'] suppresses the child's
    // stderr — without it, "Unknown command: routing-violation"
    // (or any other pipeline-db error) leaks into the hook's
    // own stderr stream, which Claude Code surfaces above the
    // intentional block message. Hook output should only be the
    // ROUTING BLOCK message.
    const { execFileSync } = require('child_process');
    try {
      execFileSync('node', [
        path.join(getPluginDir(), 'scripts', 'pipeline-db.js'),
        'routing-violation',
        JSON.stringify(full),
      ], {
        cwd: cfg._root || getProjectRoot(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (_) {
      // Fall through to JSONL on DB write failure
      appendJsonl(path.join(cfg._root || getProjectRoot(), 'logs', 'routing-violations.jsonl'), line);
    }
  } else {
    appendJsonl(path.join(cfg._root || getProjectRoot(), 'logs', 'routing-violations.jsonl'), line);
  }
}

function appendJsonl(filePath, line) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch (_) {
    // Best-effort; do not crash the hook
  }
}

function countLines(text) {
  if (!text) return 0;
  return (text.match(/\n/g) || []).length + 1;
}

module.exports = {
  loadConfig,
  loadSkillFrontmatter,
  resolveAllowedModels,
  writeViolation,
  appendJsonl,
  countLines,
  getProjectRoot,
  getPluginDir,
};
