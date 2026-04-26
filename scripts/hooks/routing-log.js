#!/usr/bin/env node
'use strict';
/**
 * routing-log.js — PostToolUse hook for routing telemetry
 *
 * Input:  JSON on stdin: { tool_name, tool_input, tool_output, model? }
 * Output: none (telemetry append only)
 * Fails open: any error is logged; hook never blocks.
 */

const fs   = require('fs');
const path = require('path');
const {
  loadConfig,
  loadSkillFrontmatter,
  appendJsonl,
  getProjectRoot,
  getPluginDir,
} = require('../lib/routing-config');

async function main() {
  let input;
  try {
    // Windows-portable stdin read — fs.readFileSync('/dev/stdin') is not
    // supported on Windows. Use async iterator over process.stdin instead.
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    input = JSON.parse(raw);
  } catch (_) { process.exit(0); }

  const toolName  = input.tool_name  || '';
  const toolInput = input.tool_input || {};
  const activeSkill = require('../lib/active-skill').read();

  let config;
  try { config = loadConfig(); } catch (_) { process.exit(0); }

  if (!config.routing || config.routing.enabled === false) process.exit(0);

  const skillFm = loadSkillFrontmatter(activeSkill);
  const promptBytes = Buffer.byteLength(
    toolInput.prompt || toolInput.command || toolInput.content || '', 'utf8'
  );
  const record = {
    ts:              new Date().toISOString(),
    tool:            toolName,
    model:           toolInput.model || process.env.CLAUDE_MODEL || null,
    skill:           activeSkill,
    operation_class: skillFm.operation_class || 'conversation_mode',
    prompt_bytes:    promptBytes,
    violation:       false,
  };

  try {
    if (config.knowledge.tier === 'postgres') {
      // stdio: ['ignore', 'pipe', 'ignore'] suppresses pipeline-db.js
      // stderr — same fix routing-config.js::writeViolation got in
      // commit 2e4b2f1. Without it, any DB error (verb missing,
      // connection refused, etc.) leaks into the hook's stderr stream
      // and surfaces in Claude Code output. Telemetry hooks must be silent.
      const { execFileSync } = require('child_process');
      execFileSync('node', [
        path.join(getPluginDir(), 'scripts', 'pipeline-db.js'),
        'routing-event',
        JSON.stringify(record),
      ], {
        cwd: getProjectRoot(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } else {
      appendJsonl(
        path.join(getProjectRoot(), 'logs', 'routing-events.jsonl'),
        JSON.stringify(record)
      );
    }
  } catch (_) {
    // Best-effort — telemetry loss is acceptable
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
