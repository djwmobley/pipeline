#!/usr/bin/env node
'use strict';
/**
 * pipeline-routing-report.js — Weekly tier-distribution and violation report
 *
 * Usage:
 *   PROJECT_ROOT=<path> node scripts/pipeline-routing-report.js [--days N] [--json]
 *
 * Output: markdown table to stdout (or JSON with --json)
 * Reads from: Postgres routing_events / routing_violations tables
 *             OR logs/routing-events.jsonl / logs/routing-violations.jsonl
 *
 * Also runs 90-day retention cleanup on routing_events (violations are retained forever).
 */

const fs   = require('fs');
const path = require('path');
const { loadConfig, connect, c } = require('./lib/shared');

async function main() {
  const args   = process.argv.slice(2);
  const asJson = args.includes('--json');
  const daysIdx = args.indexOf('--days');
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : 7;

  const config = loadConfig();

  if (config.knowledge.tier === 'postgres') {
    await reportFromPostgres(config, days, asJson);
  } else {
    reportFromJsonl(config, days, asJson);
  }
}

async function reportFromPostgres(config, days, asJson) {
  const client = await connect(config);
  try {
    // 90-day retention cleanup
    await client.query(
      `DELETE FROM routing_events WHERE ts < NOW() - INTERVAL '90 days'`
    );

    const { rows: tierDist } = await client.query(`
      SELECT operation_class, COUNT(*)::int AS calls
      FROM routing_events
      WHERE ts > NOW() - INTERVAL '${days} days'
      GROUP BY operation_class ORDER BY calls DESC
    `);

    const { rows: violBreakdown } = await client.query(`
      SELECT type, COUNT(*)::int AS count, MAX(ts) AS last_seen
      FROM routing_violations
      WHERE ts > NOW() - INTERVAL '${days} days'
      GROUP BY type ORDER BY count DESC
    `);

    const { rows: topSkills } = await client.query(`
      SELECT skill, COUNT(*)::int AS violations
      FROM routing_violations
      WHERE ts > NOW() - INTERVAL '${days} days'
      GROUP BY skill ORDER BY violations DESC LIMIT 5
    `);

    if (asJson) {
      console.log(JSON.stringify({
        tier_distribution: tierDist,
        violations: violBreakdown,
        top_violating_skills: topSkills,
      }, null, 2));
    } else {
      printMarkdownReport(tierDist, violBreakdown, topSkills, days);
    }
  } finally {
    await client.end();
  }
}

function reportFromJsonl(config, days, asJson) {
  const root = config.root || process.env.PROJECT_ROOT || process.cwd();
  const eventsFile = path.join(root, 'logs', 'routing-events.jsonl');
  const violFile   = path.join(root, 'logs', 'routing-violations.jsonl');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const readJsonl = (filePath) => {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
      .split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean)
      .filter(r => new Date(r.ts) >= since);
  };

  const events = readJsonl(eventsFile);
  const viols  = readJsonl(violFile);

  // Tier distribution
  const tierMap = {};
  for (const e of events) {
    tierMap[e.operation_class] = (tierMap[e.operation_class] || 0) + 1;
  }
  const tierDist = Object.entries(tierMap)
    .map(([operation_class, calls]) => ({ operation_class, calls }))
    .sort((a, b) => b.calls - a.calls);

  // Violation breakdown
  const violMap = {};
  for (const v of viols) {
    if (!violMap[v.type]) violMap[v.type] = { count: 0, last_seen: v.ts };
    violMap[v.type].count++;
    if (v.ts > violMap[v.type].last_seen) violMap[v.type].last_seen = v.ts;
  }
  const violBreakdown = Object.entries(violMap)
    .map(([type, d]) => ({ type, count: d.count, last_seen: d.last_seen }))
    .sort((a, b) => b.count - a.count);

  // Top violating skills
  const skillMap = {};
  for (const v of viols) {
    skillMap[v.skill] = (skillMap[v.skill] || 0) + 1;
  }
  const topSkills = Object.entries(skillMap)
    .map(([skill, violations]) => ({ skill, violations }))
    .sort((a, b) => b.violations - a.violations)
    .slice(0, 5);

  if (asJson) {
    console.log(JSON.stringify({
      tier_distribution: tierDist,
      violations: violBreakdown,
      top_violating_skills: topSkills,
    }, null, 2));
  } else {
    printMarkdownReport(tierDist, violBreakdown, topSkills, days);
  }
}

function printMarkdownReport(tierDist, violBreakdown, topSkills, days) {
  console.log(`\n## Routing Report (last ${days} days)\n`);

  console.log('### Tier Distribution\n');
  console.log('| operation_class | calls |');
  console.log('|----------------|-------|');
  for (const r of tierDist) {
    console.log(`| ${r.operation_class} | ${r.calls} |`);
  }
  if (tierDist.length === 0) console.log('_No events recorded._');

  console.log('\n### Violations\n');
  console.log('| type | count | last seen |');
  console.log('|------|-------|-----------|');
  for (const r of violBreakdown) {
    console.log(`| ${r.type} | ${r.count} | ${r.last_seen} |`);
  }
  if (violBreakdown.length === 0) console.log('_No violations recorded._');

  console.log('\n### Top Violating Skills\n');
  console.log('| skill | violations |');
  console.log('|-------|------------|');
  for (const r of topSkills) {
    console.log(`| ${r.skill} | ${r.violations} |`);
  }
  if (topSkills.length === 0) console.log('_No skill violations recorded._');
}

main().catch(e => { console.error(e.message); process.exit(1); });
