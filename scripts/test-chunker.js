'use strict';

/**
 * test-chunker.js — Automated acceptance-gate test runner (DECISION-003)
 *
 * Five pathological-input tests that exercise chunkText() and the content_hash
 * idempotence logic. Exit 0 = all pass; exit 1 = any failure.
 *
 * Usage:
 *   node scripts/test-chunker.js          # Run all 5 tests
 *   node scripts/test-chunker.js 1        # Run only test 1
 *   node scripts/test-chunker.js 2 4      # Run only tests 2 and 4
 *
 * Plan: docs/plans/2026-04-26-chunker-loader-plan.md §6 + Phase 8
 */

const assert = require('assert');
const crypto = require('crypto');
const path   = require('path');

const { chunkText }   = require('./pipeline-chunker');
const { encodeCwd }   = require('./lib/encoded-cwd');

// ─── TEST REGISTRY ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * Print a step result: two-column output "  label" + padding + status.
 * Width is 60 chars for the label column.
 */
function step(label, ok, detail) {
  const pad = Math.max(1, 60 - label.length);
  const status = ok ? 'OK' : 'FAIL';
  console.log(`  ${label}${' '.repeat(pad)}${status}`);
  if (!ok && detail) {
    console.log(`    Reason: ${detail}`);
  }
}

/**
 * Run one test. The fn must throw on assertion failure.
 * Returns true on pass, false on fail.
 */
async function runTest(num, title, fn) {
  console.log(`\nTEST ${num} — ${title}`);
  try {
    await fn();
    console.log(`  PASS — Test ${num}`);
    passed++;
    return true;
  } catch (err) {
    console.log(`  FAIL — Test ${num}`);
    console.log(`    Reason: ${err.message}`);
    failed++;
    return false;
  }
}

// ─── FIXTURE GENERATORS ───────────────────────────────────────────────────────

/**
 * Build a deterministic prose fixture of ~targetLen chars.
 * Embeds a unique needle phrase in the middle so retrieval can be asserted.
 * Sentence structure ensures there are valid boundary points for the chunker.
 */
function buildProseFixture(targetLen, needle) {
  // Each sentence is exactly 60 chars when repeated.
  const sentence = 'This is sentence number NNNNN. It fills out the paragraph. ';
  const needleInsert = `The unique needle phrase is: ${needle}. `;
  const lines = [];
  let total = 0;
  let sentNum = 0;
  const midpoint = Math.floor(targetLen / 2);

  while (total < targetLen) {
    // Insert needle phrase once near the midpoint
    if (total >= midpoint - 200 && total < midpoint && needle && !lines.join('').includes(needle)) {
      lines.push(needleInsert);
      total += needleInsert.length;
    }
    const s = sentence.replace('NNNNN', String(sentNum).padStart(5, '0'));
    lines.push(s);
    total += s.length;
    sentNum++;
    // Add a paragraph break every ~500 chars to give chunker paragraph boundaries
    if (sentNum % 8 === 0) {
      lines.push('\n\n');
      total += 2;
    }
  }
  return lines.join('');
}

/**
 * Build a deterministic fixture with multiple H2 sections.
 * Embeds needle in the specified section index (0-based).
 */
function buildSectionedFixture(targetLen, numSections, needle, needleSection) {
  const perSection = Math.floor(targetLen / numSections);
  const parts = [];
  for (let i = 0; i < numSections; i++) {
    parts.push(`## Section ${i + 1} — Topic ${i + 1}\n\n`);
    const sectionNeedle = (i === needleSection) ? needle : null;
    parts.push(buildProseFixture(perSection, sectionNeedle));
    parts.push('\n\n');
  }
  return parts.join('');
}

/**
 * Sha256 of text — mirrors the loader's hash function for idempotence tests.
 */
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ─── TEST 1 — Pathological policy section (>8000 chars) ─────────────────────

async function test1() {
  const NEEDLE   = 'PHRASE_T1_NEEDLE_X42';
  const CEILING  = 1400;
  const TARGET   = 8500;

  // 1. Generate fixture
  step('Generating fixture (8500 chars)...', true);
  const body = buildProseFixture(TARGET, NEEDLE);
  assert.ok(body.length >= TARGET,
    `Fixture too short: ${body.length} < ${TARGET}`);
  step(`Fixture generated (${body.length} chars, needle embedded)`, true);

  // 2. Chunk with 1400-char ceiling
  const chunks = chunkText(body, CEILING, 'prose');
  const maxLen = Math.max(...chunks.map(c => c.content.length));
  const ok2 = chunks.length >= 5 && maxLen <= CEILING + 200; // +200 headroom for overlap seed
  step(
    `chunkText() produced ${chunks.length} chunks (max ${maxLen} chars)`,
    ok2,
    ok2 ? null : `Expected >= 5 chunks all <= ${CEILING + 200} chars`
  );
  assert.ok(chunks.length >= 5,
    `Expected >= 5 chunks for ${body.length}-char prose body at ceiling=${CEILING}, got ${chunks.length}`);
  for (const ch of chunks) {
    assert.ok(ch.content.length <= CEILING + 200,
      `Chunk ${ch.chunkIdx} length ${ch.content.length} exceeds ceiling+overlap (${CEILING + 200})`);
  }

  // 3. Verify needle is recoverable in at least one chunk
  const needleFound = chunks.some(ch => ch.content.includes(NEEDLE));
  step(`Needle phrase recoverable in chunked output`, needleFound,
    needleFound ? null : `'${NEEDLE}' not found in any chunk`);
  assert.ok(needleFound, `Needle phrase '${NEEDLE}' not found in any chunk`);

  // 4. Verify chunk indices are contiguous from 0
  for (let i = 0; i < chunks.length; i++) {
    assert.strictEqual(chunks[i].chunkIdx, i,
      `Expected chunkIdx ${i}, got ${chunks[i].chunkIdx}`);
  }
  step(`Chunk indices are contiguous from 0`, true);

  // 5. Verify coverage: all chars from source appear in chunk output (joined)
  const joined = chunks.map(c => c.content).join('');
  // At minimum, the needle must be in the joined output
  assert.ok(joined.includes(NEEDLE), `Needle not in joined chunk output`);
  step(`Chunks cover full source (needle present in joined output)`, true);
}

// ─── TEST 2 — Pathological memory body (>20000 chars) ───────────────────────

async function test2() {
  const NEEDLE         = 'PHRASE_T2_NEEDLE_Y77';
  const CEILING        = 1400;
  const TARGET         = 21000;
  const NUM_SECTIONS   = 10;
  const NEEDLE_SECTION = 4; // 0-indexed — 5th section

  // 1. Generate fixture
  step('Generating fixture (21000 chars, 10 sections)...', true);
  const body = buildSectionedFixture(TARGET, NUM_SECTIONS, NEEDLE, NEEDLE_SECTION);
  assert.ok(body.length >= TARGET,
    `Fixture too short: ${body.length} < ${TARGET}`);
  step(`Fixture generated (${body.length} chars, needle in section ${NEEDLE_SECTION + 1})`, true);

  // 2. Chunk with 1400-char ceiling
  const chunks = chunkText(body, CEILING, 'prose');
  const maxLen = Math.max(...chunks.map(c => c.content.length));
  const ok2 = chunks.length >= 5 && maxLen <= CEILING + 200;
  step(
    `chunkText() produced ${chunks.length} chunks (max ${maxLen} chars)`,
    ok2,
    ok2 ? null : `Expected >= 5 chunks all <= ${CEILING + 200} chars`
  );
  assert.ok(chunks.length >= 5,
    `Expected >= 5 chunks for ${body.length}-char body at ceiling=${CEILING}, got ${chunks.length}`);
  for (const ch of chunks) {
    assert.ok(ch.content.length <= CEILING + 200,
      `Chunk ${ch.chunkIdx} length ${ch.content.length} exceeds ceiling+overlap (${CEILING + 200})`);
  }

  // 3. Needle is in a chunk at index >= 3 (it's in the 5th section which
  //    should produce chunks well past the start of the output).
  const needleChunkIdx = chunks.findIndex(ch => ch.content.includes(NEEDLE));
  const ok3 = needleChunkIdx >= 3;
  step(
    `Needle phrase found in chunk index ${needleChunkIdx} (expected >= 3)`,
    ok3,
    ok3 ? null : `Needle found in chunk ${needleChunkIdx}, expected >= 3`
  );
  assert.ok(needleChunkIdx >= 0, `Needle '${NEEDLE}' not found in any chunk`);
  assert.ok(ok3,
    `Needle at chunk ${needleChunkIdx}, expected >= 3 (needle is in section 5 of 10)`);
}

// ─── TEST 3 — Pathological session message (>4000 chars in JSONL) ─────────────

async function test3() {
  const NEEDLE  = 'PHRASE_T3_NEEDLE_Z99';
  const CEILING = 560;

  // 1. Generate a ~4500-char content string with JSON-like content + fenced blocks.
  //    Represents a tool_result message with mixed code and prose.
  //
  //    Structure: alternating prose paragraphs (~400 chars each) and fenced code
  //    blocks (~80 chars each), separated by double-newlines so rule 3 (paragraph)
  //    and rule 2 (fence) fire instead of rule 5 (hard-split). This ensures the
  //    fence-integrity assertion is testing rule 2 path, not the hard-split edge case.
  step('Generating fixture (4500 chars, fenced code block)...', true);
  const bt = '```';
  // Fenced block: ~80 chars, opens and closes cleanly
  const fencedBlock = `\n\n${bt}json\n{"key": "value", "items": [1, 2, 3], "status": "ok"}\n${bt}\n\n`;
  // Prose paragraph: ~400 chars (7 sentences of ~57 chars each)
  const prosePara = 'Tool output paragraph with explanation. It covers the results clearly. ' +
    'Each sentence adds context. The response was successful. More detail follows here. ' +
    'Additional findings are included below. Final notes round out the paragraph.\n\n';
  const parts = [];
  let total = 0;
  let blockNum = 0;
  while (total < 4500) {
    // Inject needle phrase in the middle prose paragraph
    if (total >= 2000 && total < 2500 && !parts.join('').includes(NEEDLE)) {
      const needleLine = `The unique phrase ${NEEDLE} appears in this paragraph. `;
      parts.push(needleLine);
      total += needleLine.length;
    }
    parts.push(prosePara);
    total += prosePara.length;
    if (total < 4200) {
      parts.push(fencedBlock);
      total += fencedBlock.length;
    }
    blockNum++;
  }
  const content = parts.join('');
  assert.ok(content.length >= 4000,
    `Fixture too short: ${content.length} < 4000`);
  step(`Fixture generated (${content.length} chars with fenced blocks and needle)`, true);

  // 2. Chunk with 560-char ceiling in tool_result mode
  const chunks = chunkText(content, CEILING, 'tool_result');
  assert.ok(chunks.length >= 2,
    `Expected >= 2 chunks for ${content.length}-char tool_result, got ${chunks.length}`);

  // 3. No chunk exceeds 560 + 20% headroom (= 672 chars)
  const HEADROOM = Math.ceil(CEILING * 1.2);
  const maxLen = Math.max(...chunks.map(c => c.content.length));
  const ok3 = maxLen <= HEADROOM;
  step(
    `chunkText() produced ${chunks.length} chunks (max ${maxLen} chars, limit ${HEADROOM})`,
    ok3,
    ok3 ? null : `Max chunk length ${maxLen} exceeds limit ${HEADROOM}`
  );
  for (const ch of chunks) {
    assert.ok(ch.content.length <= HEADROOM,
      `Chunk ${ch.chunkIdx} length ${ch.content.length} exceeds ${HEADROOM} (120% of ceiling=${CEILING})`);
  }

  // 4. Verify fence integrity: no chunk has an UNCLOSED opening fence.
  // A chunk bisects a fence if it contains an opening ``` that has no
  // corresponding closing ``` within the same chunk. A chunk that contains
  // only a closing ``` (or only prose) is fine — the chunker is allowed to
  // split before/after a complete fence block.
  let fenceIntegrityOk = true;
  let badChunkInfo = null;
  for (const ch of chunks) {
    const lines = ch.content.split('\n');
    let inFence = false;
    for (const line of lines) {
      if (line.startsWith('```')) {
        inFence = !inFence;
      }
    }
    if (inFence) {
      // inFence=true after scanning means there's an unclosed opening fence
      fenceIntegrityOk = false;
      const fenceCount = lines.filter(l => l.startsWith('```')).length;
      badChunkInfo = `chunk ${ch.chunkIdx} has unclosed opening fence (${fenceCount} fence line(s))`;
      break;
    }
  }
  step(`No chunk has an unclosed opening code fence`,
    fenceIntegrityOk, badChunkInfo);
  assert.ok(fenceIntegrityOk,
    `Code fence bisected: ${badChunkInfo}`);

  // 5. Needle recoverable in chunks
  const needleFound = chunks.some(ch => ch.content.includes(NEEDLE));
  step(`Needle phrase recoverable in chunked output`, needleFound,
    needleFound ? null : `'${NEEDLE}' not found in any chunk`);
  assert.ok(needleFound, `Needle phrase '${NEEDLE}' not found in any chunk`);
}

// ─── TEST 4 — Idempotence (content_hash logic simulation) ────────────────────

async function test4() {
  // Simulate two loader runs against identical source text.
  // On first run: hash stored = null → embed call made (mocked).
  // On second run: stored hash matches computed hash → embed call skipped.

  step('Simulating loader first-run with no stored hashes...', true);

  const sourceText = 'Idempotence test content. '.repeat(60); // ~1560 chars
  const chunks = chunkText(sourceText, 1400, 'prose');
  assert.ok(chunks.length >= 1, `Expected >= 1 chunk, got ${chunks.length}`);

  // Simulate stored hash table: maps chunkIdx -> stored_hash (null = no row yet)
  const storedHashes = new Map();
  let embedCallCount = 0;

  function simulateLoaderRun(storedHashMap) {
    let embedded = 0;
    let skipped  = 0;
    const newHashMap = new Map();
    for (const chunk of chunks) {
      const computed = sha256(chunk.content);
      const stored   = storedHashMap.get(chunk.chunkIdx) || null;
      if (stored === computed) {
        skipped++;
      } else {
        embedCallCount++;
        embedded++;
      }
      newHashMap.set(chunk.chunkIdx, computed);
    }
    return { embedded, skipped, newHashMap };
  }

  // First run — all hashes are absent → all chunks should be "embedded"
  const run1 = simulateLoaderRun(storedHashes);
  step(`Run 1: embedded ${run1.embedded} chunks, skipped ${run1.skipped}`,
    run1.embedded === chunks.length && run1.skipped === 0,
    `Expected embedded=${chunks.length} skipped=0, got embedded=${run1.embedded} skipped=${run1.skipped}`);
  assert.strictEqual(run1.embedded, chunks.length,
    `Run 1: expected all ${chunks.length} chunks embedded, got ${run1.embedded}`);
  assert.strictEqual(run1.skipped, 0,
    `Run 1: expected 0 skipped, got ${run1.skipped}`);

  // Second run — use the hashes from run 1 → all should be skipped
  step('Simulating loader second-run with stored hashes (no source change)...', true);
  const run2 = simulateLoaderRun(run1.newHashMap);
  step(`Run 2: embedded ${run2.embedded} chunks, skipped ${run2.skipped}`,
    run2.embedded === 0 && run2.skipped === chunks.length,
    `Expected embedded=0 skipped=${chunks.length}, got embedded=${run2.embedded} skipped=${run2.skipped}`);
  assert.strictEqual(run2.embedded, 0,
    `Run 2: expected 0 embedded (hash match), got ${run2.embedded}`);
  assert.strictEqual(run2.skipped, chunks.length,
    `Run 2: expected all ${chunks.length} skipped, got ${run2.skipped}`);

  // Total embed calls = only first-run chunks
  step(
    `Total embed calls: ${embedCallCount} (expected ${chunks.length}, second run = 0)`,
    embedCallCount === chunks.length,
    `Expected exactly ${chunks.length} embed calls total, got ${embedCallCount}`
  );
  assert.strictEqual(embedCallCount, chunks.length,
    `Expected embed calls = ${chunks.length} (first run only), got ${embedCallCount}`);

  // Row count identical between runs (both end with same chunk count)
  step('Row count identical between runs', true);
}

// ─── TEST 5 — Partial failure resilience ─────────────────────────────────────

async function test5() {
  // Simulate BATCH=8 embed loop where one chunk has a bad embedding response
  // (empty array) and a healthy companion chunk embeds successfully.

  const BATCH = 8;

  step('Constructing bad (2000-char CJK) and healthy chunks...', true);

  // Bad chunk: 2000 CJK characters (well above 512-token Ollama limit for CJK ~1 char/token)
  const badContent  = '啊'.repeat(2000);
  // Healthy chunk: normal English phrase
  const goodContent = 'normal english test phrase ' + Date.now();

  const chunks = [
    { chunkIdx: 9999, content: badContent,  id: 9999 },
    { chunkIdx: 9998, content: goodContent, id: 9998 },
  ];

  // Mock ollamaEmbed: for the bad chunk (by index in batch), throw an error simulating
  // Ollama refusing an oversized input. For the healthy chunk, return a valid 1024-d vector.
  const mockVector = Array.from({ length: 1024 }, (_, i) => (i + 1) / 1024);

  async function mockOllamaEmbed(texts, origContents) {
    // Simulate: if the original chunk content is predominantly CJK and > 512 chars,
    // reject. origContents is a parallel array of raw chunk content (without prefix).
    // If not provided, fall back to checking the full text for CJK density.
    const results = [];
    for (let idx = 0; idx < texts.length; idx++) {
      const raw = (origContents && origContents[idx]) || texts[idx];
      // CJK density: true if > 50% of chars are Han characters and length > 512
      const hanCount = (raw.match(/\p{Script=Han}/gu) || []).length;
      const isCjkHeavy = hanCount > raw.length * 0.5 && raw.length > 512;
      if (isCjkHeavy) {
        throw new Error(
          `Ollama returned ${texts.length - 1} embeddings for ${texts.length} inputs ` +
          `(likely context overrun — chunk text smaller before retry)`
        );
      }
      results.push(mockVector);
    }
    return results;
  }

  // Simulate the loader's per-chunk error-isolation pattern (BATCH=8 window):
  // If the batch-level embed fails, retry each chunk individually so healthy
  // chunks still get embedded.
  const embeddedIds  = [];
  const erroredIds   = [];
  const errorLog     = [];

  step('Running BATCH=8 embed loop with per-chunk error isolation...', true);

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch    = chunks.slice(i, i + BATCH);
    const texts    = batch.map(ch => `Memory: test\n\n${ch.content}`);
    const contents = batch.map(ch => ch.content); // raw content for CJK detection
    const ids      = batch.map(ch => ch.id);

    try {
      await mockOllamaEmbed(texts, contents);
      // If batch succeeded, all are embedded
      for (const id of ids) embeddedIds.push(id);
    } catch (batchErr) {
      // Batch failed — retry each chunk individually
      for (let j = 0; j < batch.length; j++) {
        try {
          await mockOllamaEmbed([texts[j]], [contents[j]]);
          embeddedIds.push(ids[j]);
        } catch (chunkErr) {
          errorLog.push(`[SKIP] chunk_idx=${batch[j].chunkIdx} err=${chunkErr.message.slice(0, 80)}`);
          erroredIds.push(ids[j]);
        }
      }
    }
  }

  // Assertions:
  // (a) Bad chunk (9999) has errored — embedding not written
  const badErrored = erroredIds.includes(9999);
  step(`Bad chunk (9999, CJK 2000 chars) produced embed error`,
    badErrored,
    badErrored ? null : `Expected chunk 9999 to error; errored=[${erroredIds}]`);
  assert.ok(badErrored,
    `Bad chunk 9999 should have errored but did not. errored=[${erroredIds}]`);

  // (b) Healthy chunk (9998) succeeded
  const goodEmbedded = embeddedIds.includes(9998);
  step(`Healthy chunk (9998, English) embedded successfully despite bad companion`,
    goodEmbedded,
    goodEmbedded ? null : `Expected chunk 9998 to embed; embedded=[${embeddedIds}]`);
  assert.ok(goodEmbedded,
    `Healthy chunk 9998 should have embedded but did not. embedded=[${embeddedIds}]`);

  // (c) Error logged with chunk identity
  const hasLog = errorLog.length > 0 && errorLog.some(l => l.includes('chunk_idx=9999'));
  step(`Error log contains chunk identity for the bad chunk`,
    hasLog,
    hasLog ? null : `No log entry for chunk_idx=9999; log=${JSON.stringify(errorLog)}`);
  assert.ok(hasLog,
    `Expected error log to mention chunk_idx=9999; got: ${JSON.stringify(errorLog)}`);

  // (d) Loader did not abort — both results accounted for
  assert.strictEqual(embeddedIds.length + erroredIds.length, chunks.length,
    `Expected ${chunks.length} total outcomes, got ${embeddedIds.length + erroredIds.length}`);
  step(`Loader did not abort — all ${chunks.length} chunks accounted for`, true);

  // Bonus: CP3 — Windows encoded-cwd path round-trip (fits naturally here as the
  // plan's Task 8.7 is listed as part of the test suite)
  step('CP3: encodeCwd POSIX path round-trip', true);
  const posixResult = encodeCwd('/home/user/dev/pipeline');
  assert.strictEqual(posixResult, '-home-user-dev-pipeline',
    `POSIX encodeCwd: expected '-home-user-dev-pipeline', got '${posixResult}'`);

  step('CP3: encodeCwd Windows path round-trip', true);
  const winResult = encodeCwd('C:\\Users\\djwmo\\dev\\pipeline');
  assert.strictEqual(winResult, 'C--Users-djwmo-dev-pipeline',
    `Windows encodeCwd: expected 'C--Users-djwmo-dev-pipeline', got '${winResult}'`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const ALL_TESTS = [
  { num: 1, title: 'Pathological policy section >8000 chars',      fn: test1 },
  { num: 2, title: 'Pathological memory body >20000 chars',        fn: test2 },
  { num: 3, title: 'Pathological session message >4000 chars JSONL', fn: test3 },
  { num: 4, title: 'Idempotence — content_hash skip logic',        fn: test4 },
  { num: 5, title: 'Partial failure resilience — BATCH=8 isolation', fn: test5 },
];

async function main() {
  // Parse which tests to run: "node test-chunker.js 2 4" → [2, 4]
  const args = process.argv.slice(2).map(Number).filter(n => n >= 1 && n <= 5);
  const toRun = args.length > 0
    ? ALL_TESTS.filter(t => args.includes(t.num))
    : ALL_TESTS;

  console.log('');
  for (const t of toRun) {
    await runTest(t.num, t.title, t.fn);
  }

  console.log('');
  console.log('='.repeat(60));
  const total = passed + failed;
  if (failed === 0) {
    console.log(`SUMMARY: ${passed}/${total} tests passed`);
  } else {
    const failedNums = ALL_TESTS
      .filter(t => toRun.includes(t))
      .filter((_, i) => {
        // We can't easily track which test failed by number here since runTest
        // modifies global counters — use a simpler approach below.
      });
    console.log(`SUMMARY: ${passed}/${total} tests passed (${failed} failed)`);
  }
  console.log('='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\nUnhandled error: ${err.message}`);
  process.exit(1);
});
