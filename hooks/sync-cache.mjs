#!/usr/bin/env node
/**
 * sync-cache.mjs — SessionStart hook
 *
 * Keeps the plugin cache in sync with the source repo.
 * Compares the current git HEAD SHA against the SHA recorded in
 * installed_plugins.json and copies source files to the cache
 * when they diverge.
 *
 * Runs safely — logs sync status but never breaks session startup.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';

const HOME = process.env.HOME || process.env.USERPROFILE;
const REGISTRY_PATH = join(HOME, '.claude', 'plugins', 'installed_plugins.json');
const CACHE_ROOT = join(HOME, '.claude', 'plugins', 'cache', 'pipeline', 'pipeline');
const PLUGIN_ID = 'pipeline@pipeline';

// Directories and files to sync from source to cache.
// Excludes .git, node_modules, .claude, docs/findings, docs/specs, docs/plans
// (build artifacts that are project-specific, not plugin-distributable).
const SYNC_ITEMS = [
  '.claude-plugin',
  'commands',
  'hooks',
  'rules',
  'scripts',
  'skills',
  'templates',
  'CLAUDE.md',
  'LICENSE',
  'README.md',
];

try {
  // --- 1. Read registry ---------------------------------------------------
  if (!existsSync(REGISTRY_PATH)) process.exit(0);
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const entries = registry.plugins?.[PLUGIN_ID];
  if (!Array.isArray(entries) || !entries.length) process.exit(0);

  const entry = entries[0];
  const projectPath = entry.projectPath;
  if (!projectPath || !existsSync(projectPath)) process.exit(0);

  // --- 2. Only sync when CWD is the plugin project ------------------------
  const cwd = resolve(process.cwd());
  const project = resolve(projectPath);
  if (cwd !== project) process.exit(0);

  // --- 3. Compare HEAD SHA -------------------------------------------------
  let headSha;
  try {
    headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Not a git repo or git not available — skip
    process.exit(0);
  }

  if (headSha === entry.gitCommitSha) process.exit(0);

  // --- 4. Read version from marketplace.json --------------------------------
  const marketplacePath = join(projectPath, '.claude-plugin', 'marketplace.json');
  let version = 'unknown';
  try {
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    version = marketplace.plugins?.[0]?.version || 'unknown';
  } catch {
    // Fall back to plugin.json version
    try {
      const pluginJson = JSON.parse(
        readFileSync(join(projectPath, '.claude-plugin', 'plugin.json'), 'utf8')
      );
      version = pluginJson.version || 'unknown';
    } catch {
      // Use 'unknown'
    }
  }

  const newCachePath = join(CACHE_ROOT, version);
  const oldCachePath = resolve(entry.installPath);

  // --- 5. Remove stale cache(s) --------------------------------------------
  // Remove old version directory if it differs from the new one
  if (existsSync(oldCachePath) && oldCachePath !== resolve(newCachePath)) {
    rmSync(oldCachePath, { recursive: true, force: true });
  }
  // Remove current version directory for a clean copy
  if (existsSync(newCachePath)) {
    rmSync(newCachePath, { recursive: true, force: true });
  }

  // --- 6. Copy source to cache ---------------------------------------------
  mkdirSync(newCachePath, { recursive: true });

  for (const item of SYNC_ITEMS) {
    const src = join(projectPath, item);
    if (existsSync(src)) {
      cpSync(src, join(newCachePath, item), { recursive: true });
    }
  }

  // --- 7. Update registry ---------------------------------------------------
  entry.installPath = newCachePath;
  entry.version = version;
  entry.gitCommitSha = headSha;
  entry.lastUpdated = new Date().toISOString();

  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));

  // --- 8. Ensure plugin is enabled -----------------------------------------
  const settingsPath = join(projectPath, '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const plugins = settings.enabledPlugins || {};
      if (plugins[PLUGIN_ID] !== true) {
        plugins[PLUGIN_ID] = true;
        settings.enabledPlugins = plugins;
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
    } catch {
      // Settings file issues are non-fatal
    }
  }

  console.log(
    `[pipeline] Cache synced: ${entry.gitCommitSha.slice(0, 7)} → v${version} (${SYNC_ITEMS.length} items)`
  );
} catch {
  // Silent exit — never block session startup
  process.exit(0);
}
