/**
 * shared.js — Common utilities for pipeline scripts
 *
 * Exports: findProjectRoot, loadConfig, connect, c, ollamaDefaults
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// ─── ANSI ────────────────────────────────────────────────────────────────────

const c = {
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ─── OLLAMA DEFAULTS ────────────────────────────────────────────────────────

const ollamaDefaults = {
  host: 'localhost',
  port: 11434,
  model: 'mxbai-embed-large',
};

// ─── PROJECT ROOT ───────────────────────────────────────────────────────────

/**
 * Find the project root directory.
 *
 * Resolution order:
 * 1. process.env.PROJECT_ROOT — if set, used as-is (avoids the bug where
 *    scripts invoked via `cd <scripts_dir> && node pipeline-db.js` find
 *    the pipeline plugin's .git instead of the user project's .git).
 * 2. Walk up from cwd looking for a .git directory.
 * 3. Fall back to cwd.
 */
function findProjectRoot() {
  if (process.env.PROJECT_ROOT) return process.env.PROJECT_ROOT;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// ─── CONFIG ─────────────────────────────────────────────────────────────────

/**
 * Sanitize a project name into a valid Postgres database name.
 * Lowercase, replace non-alphanumeric with underscore, prefix with pipeline_.
 */
function projectToDbName(projectName) {
  const sanitized = projectName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `pipeline_${sanitized}`;
}

function loadConfig() {
  const root = findProjectRoot();
  const configPath = path.join(root, '.claude', 'pipeline.yml');
  const projectName = path.basename(root);
  const defaults = {
    host: 'localhost', port: 5432,
    database: projectToDbName(projectName), user: 'postgres',
    project: projectName,
  };

  if (!fs.existsSync(configPath)) return { ...defaults, root, tier: 'files', embedding_model: null };
  const content = fs.readFileSync(configPath, 'utf8');

  // Get a top-level key (not indented)
  const getTopLevel = (key) => {
    const match = content.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, 'm'));
    return match ? match[1].trim() : null;
  };

  // Extract a YAML section (from "key:" to next top-level key or EOF)
  const getSection = (section) => {
    const match = content.match(new RegExp(`^${section}:.*\\n((?:[ \\t]+.*\\n?)*)`, 'm'));
    return match ? match[1] : '';
  };

  // Get a value within a specific section
  const getInSection = (section, key) => {
    const sectionContent = getSection(section);
    const match = sectionContent.match(new RegExp(`^\\s*${key}:\\s*"?([^"\\n]+)"?`, 'm'));
    return match ? match[1].trim() : null;
  };

  const resolvedProjectName = getInSection('project', 'name') || defaults.project;
  const tier = getInSection('knowledge', 'tier');

  return {
    host: getInSection('knowledge', 'host') || defaults.host,
    port: parseInt(getInSection('knowledge', 'port') || defaults.port),
    database: getInSection('knowledge', 'database') || defaults.database,
    user: getInSection('knowledge', 'user') || defaults.user,
    project: resolvedProjectName,
    tier: tier || 'files',
    embedding_model: getInSection('knowledge', 'embedding_model') || null,
    root,
  };
}

// ─── CONNECT ────────────────────────────────────────────────────────────────

async function connect(config) {
  const cfg = config || loadConfig();
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
  });
  await client.connect();
  return client;
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = { findProjectRoot, loadConfig, connect, c, ollamaDefaults, projectToDbName };
