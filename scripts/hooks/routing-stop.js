#!/usr/bin/env node
'use strict';
/**
 * routing-stop.js — Stop hook for in-context draft detection (post-hoc, no blocking)
 *
 * Scans the assistant's turn text for substantive prose that should have been
 * dispatched to a lower tier. Writes a routing_violation record if threshold exceeded.
 * CANNOT block — Stop hook exit codes other than 0 are not supported by Claude Code.
 * This hook is accountability-only.
 *
 * Input:  JSON on stdin: { message: string }
 */

const fs = require('fs');
const path = require('path');
const {
  loadConfig,
  writeViolation,
  getProjectRoot,
} = require('../lib/routing-config');

// ─── Exclusion zones ──────────────────────────────────────────────────────────

function stripExcludedZones(text) {
  // 1. Remove code fences (``` ... ```)
  let t = text.replace(/```[\s\S]*?```/g, '');
  // 2. Remove blockquotes (lines starting with >)
  t = t.split('\n').filter(line => !line.match(/^\s*>/)).join('\n');
  // 3. Remove HTML <details> blocks
  t = t.replace(/<details[\s\S]*?<\/details>/gi, '');
  // 4. Remove tool-call narration lines
  t = t.split('\n').filter(line =>
    !line.match(/^(Reading|Writing|Running|Checking|Searching|Found|No |Updating|Loading)\s/)
  ).join('\n');
  // 5. Remove short list items (each item ≤ 12 words)
  t = t.split('\n').filter(line => {
    const listMatch = line.match(/^\s*[-*\d.]+\s+(.+)/);
    if (!listMatch) return true;
    const wordCount = listMatch[1].trim().split(/\s+/).length;
    return wordCount > 12; // keep only long list items
  }).join('\n');
  // 6. Remove pure file path / URL / command lines
  t = t.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.match(/^[`/\\].+[`]?$/) && !trimmed.includes(' ')) return false;
    if (trimmed.match(/^https?:\/\/\S+$/)) return false;
    return true;
  }).join('\n');
  return t;
}

function countWords(text) {
  return (text.match(/\b\w+\b/g) || []).length;
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    input = JSON.parse(raw);
  } catch (_) { process.exit(0); }

  const message = input.message || '';
  const activeSkill = process.env.PIPELINE_ACTIVE_SKILL || 'conversation_mode';

  let config;
  try { config = loadConfig(); } catch (_) { process.exit(0); }

  if (!config.routing || config.routing.enabled === false) process.exit(0);

  const threshold = config.routing.stop_hook_threshold || 150;
  const stripped  = stripExcludedZones(message);
  const wordCount = countWords(stripped);

  if (wordCount > threshold) {
    writeViolation({
      type:       'in_context_draft',
      tool:       'Stop',
      skill:      activeSkill,
      detail:     { word_count: wordCount, threshold },
    }, config);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
