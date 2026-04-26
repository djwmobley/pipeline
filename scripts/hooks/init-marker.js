#!/usr/bin/env node
'use strict';
/**
 * init-marker.js — SessionStart hook
 *
 * Writes the active-skill marker to .claude/.active-skill at session start so
 * the very first PreToolUse call has a valid marker to read. Without this,
 * the marker file may not exist (gitignored, never committed) and routing-check.js
 * would fall through to its FALLBACK ('conversation_mode') anyway — but doing it
 * explicitly makes the contract observable and avoids any window where stale
 * state from a prior session could be read.
 *
 * Defaults to 'conversation_mode' (matches active-skill.js FALLBACK).
 * Always exits 0 — must never block session startup.
 */

const fs   = require('fs');
const path = require('path');

try {
  let projectRoot = process.env.PROJECT_ROOT;
  if (!projectRoot) {
    let dir = process.cwd();
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) { projectRoot = dir; break; }
      dir = path.dirname(dir);
    }
    if (!projectRoot) projectRoot = process.cwd();
  }

  const dir = path.join(projectRoot, '.claude');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, '.active-skill');
  const tmp    = `${target}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ skill: 'conversation_mode', ts: new Date().toISOString() }), 'utf8');
  fs.renameSync(tmp, target);
} catch (_) {
  // Best-effort — never block session startup
}

process.exit(0);
