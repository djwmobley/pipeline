#!/usr/bin/env node
'use strict';
/**
 * routing-check.js — PreToolUse hook for convention-not-reason routing enforcement
 *
 * Input:  JSON on stdin: { tool_name: string, tool_input: object }
 * Output: exit 0 (allow), exit 2 with message on stdout (block)
 * Errors: logged to logs/routing-hook-errors.log; hook crashes are fail-open
 *         (Claude Code falls through on hook error — this is intentional).
 *
 * Environment:
 *   PIPELINE_DIR          — root of pipeline plugin (default: two levels above this script).
 *   PROJECT_ROOT          — root of the user project (default: walk up from cwd).
 */

const fs   = require('fs');
const path = require('path');

const {
  loadConfig,
  loadSkillFrontmatter,
  resolveAllowedModels,
  writeViolation,
  countLines,
  getProjectRoot,
  getPluginDir,
} = require('../lib/routing-config');

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    input = JSON.parse(raw);
  } catch (e) {
    logError(`Failed to parse stdin: ${e.message}`);
    process.exit(0); // Fail open — malformed input should not block work
  }

  const toolName  = input.tool_name  || '';
  const toolInput = input.tool_input || {};

  // R4 — bypass-on-dispatch. Subagent tool calls always include `agent_id` and
  // `agent_type` in the stdin payload (verified empirically 2026-04-26 — see
  // memory project_r4_bypass_signal_2026-04-26). Main-thread (orchestrator)
  // calls do not. Token-spender rules (tier-mismatch, direct-write threshold,
  // chain-dispatch) target the orchestrator's choice of action; subagents were
  // dispatched specifically to do the work and must not be re-constrained by
  // the same rules. Universal floor (destructive SQL) is about the action and
  // still applies to all callers — checked below before this guard takes effect.
  const isSubagentCall = !!input.agent_id;

  const activeSkill = require('../lib/active-skill').read();

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    logError(`Failed to load config: ${e.message}`);
    process.exit(0); // Fail open — config errors must not block work
  }

  // Routing disabled — allow all
  if (!config.routing || config.routing.enabled === false) {
    process.exit(0);
  }

  try {
    // ── Universal floor: Bash SQL/psql patterns ───────────────────────────────
    if (toolName === 'Bash') {
      // Array guard: Claude Code may pass command as an array; join so RegExp.test() doesn't coerce via Array.toString()
      const cmd = Array.isArray(toolInput.command) ? toolInput.command.join(' ') : (toolInput.command || '');
      const patterns = config.routing.universal_floor.bash_block_patterns;
      for (const pat of patterns) {
        if (new RegExp(pat).test(cmd)) {
          writeViolation({
            type: 'universal_floor',
            pattern: pat,
            tool: toolName,
            skill: activeSkill,
            detail: { command_excerpt: cmd.slice(0, 120) },
          }, config);
          block(
            `ROUTING BLOCK: Direct SQL/psql is not allowed.\n` +
            `Pattern matched: ${pat}\n` +
            `Use: node scripts/pipeline-db.js <verb> <args>\n` +
            `To disable routing enforcement: set routing.enabled: false in .claude/pipeline.yml`
          );
        }
      }
    }

    // Subagent bypass — rules below target Opus orchestrator choices, not subagent execution.
    if (isSubagentCall) {
      process.exit(0);
    }

    // ── Universal floor: Edit/Write above line threshold ──────────────────────
    if (toolName === 'Edit' || toolName === 'Write') {
      const content = toolInput.new_string || toolInput.content || '';
      const lineCount = countLines(content);
      const threshold = config.routing.direct_write_line_threshold || 100;
      if (lineCount > threshold) {
        const skillFm = loadSkillFrontmatter(activeSkill);
        if (!skillFm.allowed_direct_write) {
          writeViolation({
            type: 'direct_write',
            tool: toolName,
            skill: activeSkill,
            operation_class: skillFm.operation_class,
            detail: { lines: lineCount, threshold },
          }, config);
          block(
            `ROUTING BLOCK: Direct ${toolName} of ${lineCount} lines without allowed_direct_write.\n` +
            `Active skill: ${activeSkill} (operation_class: ${skillFm.operation_class})\n` +
            `Dispatch a qwen draft subagent first, then write its output.\n` +
            `Or set allowed_direct_write: true in skills/${activeSkill}/SKILL.md if this skill legitimately writes large outputs.`
          );
        }
      }
    }

    // ── Chain-the-dispatch: Agent/Task with large prompt ──────────────────────
    if (toolName === 'Agent' || toolName === 'Task') {
      const promptBytes = Buffer.byteLength(toolInput.prompt || '', 'utf8');
      const chainThreshold = config.routing.chain_dispatch_threshold || 2000;
      if (promptBytes > chainThreshold && activeSkill !== 'conversation_mode') {
        const skillFm = loadSkillFrontmatter(activeSkill);
        const oc = skillFm.operation_class || 'conversation_mode';
        if (oc !== 'opus_orchestration' && oc !== 'sonnet_review') {
          writeViolation({
            type: 'chain_dispatch',
            tool: toolName,
            skill: activeSkill,
            operation_class: oc,
            detail: { prompt_bytes: promptBytes, threshold: chainThreshold },
          }, config);
          block(
            `ROUTING BLOCK: Agent/Task prompt is ${promptBytes} bytes (threshold: ${chainThreshold}).\n` +
            `Active skill: ${activeSkill} (operation_class: ${oc})\n` +
            `Dispatch qwen to draft this prompt first, then pass its output as the subagent input.`
          );
        }
      }
    }

    // ── Tier check: Agent/Task model parameter ────────────────────────────────
    if ((toolName === 'Agent' || toolName === 'Task') && toolInput.model) {
      const skillFm = loadSkillFrontmatter(activeSkill);
      const oc = skillFm.operation_class || 'conversation_mode';
      const tier = (config.routing.tier_map || {})[oc];
      if (tier && tier !== 'mixed') {
        const allowed = resolveAllowedModels(tier, skillFm.allowed_models);
        const requested = toolInput.model;
        // Prefix match delimited by '-' or '@' prevents false positives like
        // allowed='haiku-Y' matching requested='haiku-X' (both start with 'haiku-').
        const isAllowed = allowed.some(a =>
          a === requested || requested.startsWith(a + '-') || requested.startsWith(a + '@')
        );
        if (!isAllowed && allowed.length > 0) {
          writeViolation({
            type: 'tier_mismatch',
            tool: toolName,
            skill: activeSkill,
            operation_class: oc,
            model: requested,
            detail: { requested, allowed, tier },
          }, config);
          block(
            `ROUTING BLOCK: Model "${requested}" is not allowed for skill "${activeSkill}".\n` +
            `Declared operation_class: ${oc} → tier: ${tier}\n` +
            `Allowed models: [${allowed.join(', ')}]\n` +
            `To allow this model: add it to allowed_models: in skills/${activeSkill}/SKILL.md`
          );
        }
      }
    }

    process.exit(0); // Allow

  } catch (e) {
    logError(`Hook error in routing-check.js: ${e.message}\n${e.stack}`);
    process.exit(0); // Fail open — hook crashes must not block work
  }
}

function block(message) {
  console.log(message);
  process.exit(2);
}

function logError(message) {
  try {
    const logPath = path.join(getProjectRoot(), 'logs', 'routing-hook-errors.log');
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (_) { /* best-effort */ }
}

main().catch(e => { logError(e.message); process.exit(0); });
