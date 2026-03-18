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

function findProjectRoot() {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// ─── CONFIG ─────────────────────────────────────────────────────────────────

function loadConfig() {
  const root = findProjectRoot();
  const configPath = path.join(root, '.claude', 'pipeline.yml');
  const defaults = {
    host: 'localhost', port: 5432,
    database: 'pipeline_context', user: 'postgres',
    project: path.basename(root),
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

  const projectName = getInSection('project', 'name') || defaults.project;
  const tier = getInSection('knowledge', 'tier');

  return {
    host: getInSection('knowledge', 'host') || defaults.host,
    port: parseInt(getInSection('knowledge', 'port') || defaults.port),
    database: getInSection('knowledge', 'database') || defaults.database,
    user: getInSection('knowledge', 'user') || defaults.user,
    project: projectName,
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

module.exports = { findProjectRoot, loadConfig, connect, c, ollamaDefaults };
