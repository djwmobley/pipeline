-- Pipeline Knowledge DB Setup
-- Run via: node scripts/pipeline-db.js setup
-- Creates all tables for the Postgres knowledge tier
--
-- Requires:
--   - PostgreSQL running on localhost:5432
--   - pgvector extension (for semantic search — optional, degrades gracefully)
--   - Ollama with mxbai-embed-large (for embedding — optional)

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- pgvector for semantic search (optional — scripts degrade to FTS-only without it)
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not installed — semantic search disabled. Install: https://github.com/pgvector/pgvector';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CORE TABLES — session history, tasks, decisions, gotchas, research
-- ═══════════════════════════════════════════════════════════════════════════════

-- Sessions — one row per working session
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  num INTEGER UNIQUE NOT NULL,
  date DATE DEFAULT CURRENT_DATE,
  tests INTEGER DEFAULT 0,
  summary TEXT,
  project TEXT
);

-- Add vector column for semantic search if pgvector is available (idempotent)
DO $$ BEGIN
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on sessions — pgvector not installed.';
END $$;

-- FTS on summary
-- NOTE: ADD COLUMN on a STORED generated column rewrites every existing row
-- under an ACCESS EXCLUSIVE lock. Acceptable at Pipeline's current scale
-- (kilobytes). Schedule a migration window on user DBs with large histories.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(summary, ''))) STORED;
CREATE INDEX IF NOT EXISTS sessions_fts_idx ON sessions USING gin(fts_vec);

-- Tasks — features, bugs, investigations
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending',     -- pending, in_progress, done, deferred
  phase TEXT DEFAULT 'backlog',
  priority TEXT DEFAULT 'medium',    -- low, medium, high, critical
  issue_ref INTEGER,
  readme_label TEXT,                 -- bold text shown in README roadmap (null = not a roadmap item)
  category TEXT DEFAULT 'internal',  -- roadmap, build, finding, internal
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column additions for existing databases
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS readme_label TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'internal';

-- Decisions — finalized architectural choices with rationale
CREATE TABLE IF NOT EXISTS decisions (
  id SERIAL PRIMARY KEY,
  session_num INTEGER,
  topic TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add vector column for semantic search if pgvector is available (idempotent)
DO $$ BEGIN
  ALTER TABLE decisions ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on decisions — pgvector not installed.';
END $$;

-- FTS on topic + decision + reason
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(topic, '') || ' ' || coalesce(decision, '') || ' ' || coalesce(reason, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS decisions_fts_idx ON decisions USING gin(fts_vec);

-- Gotchas — critical constraints ("never do this")
CREATE TABLE IF NOT EXISTS gotchas (
  id SERIAL PRIMARY KEY,
  issue TEXT NOT NULL,
  rule TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE
);

-- Add vector column for semantic search if pgvector is available (idempotent)
DO $$ BEGIN
  ALTER TABLE gotchas ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on gotchas — pgvector not installed.';
END $$;

-- FTS on issue + rule
ALTER TABLE gotchas ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(issue, '') || ' ' || coalesce(rule, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS gotchas_fts_idx ON gotchas USING gin(fts_vec);

-- Research — detailed notes linked to tasks
CREATE TABLE IF NOT EXISTS research (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FINDINGS — unified finding records from all pipeline workflows
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,                    -- Source-prefixed ID: RT-INJ-001, AUD-003, REV-012, UI-002, EXT-001
  source TEXT NOT NULL,                   -- redteam, audit, review, ui-review, external
  severity TEXT NOT NULL,                 -- CRITICAL, HIGH, MEDIUM, LOW, INFO
  confidence TEXT NOT NULL,               -- HIGH, MEDIUM, LOW
  location TEXT NOT NULL,                 -- file:line or descriptive path
  category TEXT NOT NULL,                 -- security/CWE-89, dead-code, naming, ux/hit-target, custom
  description TEXT NOT NULL,              -- One-line summary
  impact TEXT NOT NULL,                   -- What happens if unfixed
  remediation TEXT NOT NULL,              -- Fix steps
  effort TEXT NOT NULL,                   -- quick, medium, architectural, none
  verification_domain TEXT,               -- INJ, sector-api, changed-files, screenshot, manual
  status TEXT DEFAULT 'triaged',          -- triaged, in_progress, fixed, verified, wontfix
  issue_ref INTEGER,                      -- Linked issue/work-item reference
  commit_sha TEXT,                        -- Fix commit SHA
  task_id INTEGER REFERENCES tasks(id),   -- Linked pipeline task
  report_path TEXT,                       -- Original report file path
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add vector column for semantic search if pgvector is available
DO $$ BEGIN
  ALTER TABLE findings ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on findings — pgvector not installed.';
END $$;

-- FTS on description + impact + remediation
ALTER TABLE findings ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english', description || ' ' || impact || ' ' || remediation)
  ) STORED;

CREATE INDEX IF NOT EXISTS findings_fts_idx ON findings USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS findings_status_idx ON findings (status);
CREATE INDEX IF NOT EXISTS findings_source_idx ON findings (source);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CODE INDEX — file descriptions with FTS + optional vector embeddings
-- ═══════════════════════════════════════════════════════════════════════════════

-- Code index — one row per source file, FTS-searchable
CREATE TABLE IF NOT EXISTS code_index (
  path TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  fts_vec TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', description)) STORED
);

CREATE INDEX IF NOT EXISTS code_index_fts_idx ON code_index USING gin(fts_vec);

-- Add vector column if pgvector is available (idempotent)
DO $$ BEGIN
  ALTER TABLE code_index ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column — pgvector not installed. FTS search still works.';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- WORKFLOW DISCOVERY — findings, cross-cutting behaviors, decisions, workflow steps
-- from structured review sessions (e.g. roleplay walkthroughs)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workflow_discovery (
  id SERIAL PRIMARY KEY,
  step TEXT,                             -- pipeline step name (init, debate, plan, etc.)
  item_type TEXT,                        -- finding, cross_cutting, decision, workflow_step
  number INTEGER,
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT DEFAULT 'open',
  persona TEXT,                          -- which persona surfaced this (advocate, skeptic, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FTS on title + detail
ALTER TABLE workflow_discovery ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(detail, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS wd_fts_idx ON workflow_discovery USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS wd_item_type_idx ON workflow_discovery (item_type);
CREATE INDEX IF NOT EXISTS wd_step_idx ON workflow_discovery (step);

-- Add vector column if pgvector is available (idempotent)
DO $$ BEGIN
  ALTER TABLE workflow_discovery ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on workflow_discovery — pgvector not installed.';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- AGENT REWRITES — AS-IS/TO-BE agent transformation specs from v2 planning
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_rewrites (
  id SERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL,
  skill_path TEXT,
  as_is TEXT,
  to_be TEXT,
  gap TEXT,
  effort TEXT,                           -- small, large, rewrite
  depends_on TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FTS on agent_name + as_is + to_be + gap
ALTER TABLE agent_rewrites ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(agent_name, '') || ' ' ||
      coalesce(as_is, '') || ' ' ||
      coalesce(to_be, '') || ' ' ||
      coalesce(gap, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS ar_fts_idx ON agent_rewrites USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS ar_effort_idx ON agent_rewrites (effort);

-- Add vector column if pgvector is available (idempotent)
DO $$ BEGIN
  ALTER TABLE agent_rewrites ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on agent_rewrites — pgvector not installed.';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE CACHE — hash-based cache to skip re-reading unchanged files
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- WORKFLOW STATE — orchestrator tracks current step, completed steps, results
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workflow_state (
  id SERIAL PRIMARY KEY,
  workflow_id TEXT NOT NULL,              -- unique ID per workflow run (e.g., "feat-auth-2026-03-27")
  step TEXT NOT NULL,                     -- current or completed step name
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, done, failed, skipped
  result_code TEXT,                       -- step-specific: PASS, FAIL, PARTIAL, BLOCKED, etc.
  fail_count INTEGER DEFAULT 0,          -- consecutive failures (for loopback rules)
  inputs_met BOOLEAN DEFAULT FALSE,      -- were preconditions satisfied?
  output_artifact TEXT,                   -- path to output file if any (spec, plan, report)
  metadata JSONB DEFAULT '{}',           -- step-specific data (finding counts, test results, etc.)
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ws_workflow_idx ON workflow_state (workflow_id);
CREATE INDEX IF NOT EXISTS ws_step_idx ON workflow_state (step);
CREATE INDEX IF NOT EXISTS ws_status_idx ON workflow_state (status);

-- Current workflow position (latest per workflow)
CREATE OR REPLACE VIEW workflow_current AS
  SELECT DISTINCT ON (workflow_id)
    workflow_id, step, status, result_code, fail_count, started_at, completed_at
  FROM workflow_state
  ORDER BY workflow_id, created_at DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FILE CACHE — hash-based cache to skip re-reading unchanged files
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS file_cache (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  summary TEXT,
  key_symbols TEXT[],
  line_count INTEGER,
  last_read TIMESTAMPTZ DEFAULT NOW(),
  last_changed TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEWS — convenient queries for session startup and status checks
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW open_tasks AS
  SELECT id, title, phase, status, priority, issue_ref, created_at
  FROM tasks
  WHERE status NOT IN ('done', 'deferred')
  ORDER BY
    CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    created_at;

CREATE OR REPLACE VIEW recent_sessions AS
  SELECT num, date, tests, summary, project
  FROM sessions
  ORDER BY num DESC
  LIMIT 5;

CREATE OR REPLACE VIEW active_gotchas AS
  SELECT id, issue, rule
  FROM gotchas
  WHERE active = TRUE
  ORDER BY created_at DESC;

CREATE OR REPLACE VIEW roadmap_tasks AS
  SELECT id, title, readme_label, status, issue_ref, category, updated_at
  FROM tasks
  WHERE category = 'roadmap'
  ORDER BY
    CASE status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 WHEN 'deferred' THEN 3 END,
    id;

CREATE OR REPLACE VIEW open_findings AS
  SELECT id, source, severity, confidence, location, category,
         description, effort, status, issue_ref, commit_sha
  FROM findings
  WHERE status NOT IN ('verified', 'wontfix')
  ORDER BY
    CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
    created_at;

-- Per-feature token usage — mined from Claude Code transcripts.
-- One row per feature (branch + pr_number). Populated at commit time via
-- `scripts/pipeline-cost.js record`. Enables relative-cost comparison across
-- features, cache-hit analysis, and tool-use pattern inspection.
-- No USD cost stored — Claude Max is flat-rate; the signal is relative volume.
CREATE TABLE IF NOT EXISTS feature_token_usage (
  id SERIAL PRIMARY KEY,
  branch TEXT NOT NULL,
  pr_number INTEGER,
  github_issue INTEGER,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  model TEXT NOT NULL,
  assistant_msgs INTEGER NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cache_creation_5m_tokens BIGINT NOT NULL DEFAULT 0,
  cache_creation_1h_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  cache_hit_pct NUMERIC(5,2),
  tool_calls JSONB NOT NULL DEFAULT '{}'::jsonb,
  session_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feature_token_usage_branch_idx ON feature_token_usage (branch);
CREATE INDEX IF NOT EXISTS feature_token_usage_pr_idx ON feature_token_usage (pr_number);
CREATE INDEX IF NOT EXISTS feature_token_usage_created_idx ON feature_token_usage (created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROUTING TELEMETRY — per-tool-call events + violation log
-- ═══════════════════════════════════════════════════════════════════════════════

-- Routing telemetry (all tool calls)
CREATE TABLE IF NOT EXISTS routing_events (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tool            TEXT NOT NULL,
  model           TEXT,
  skill           TEXT NOT NULL,
  operation_class TEXT NOT NULL,
  prompt_bytes    INTEGER,
  violation       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS routing_events_ts_idx        ON routing_events (ts);
CREATE INDEX IF NOT EXISTS routing_events_skill_idx     ON routing_events (skill);
CREATE INDEX IF NOT EXISTS routing_events_violation_idx ON routing_events (violation) WHERE violation = TRUE;

-- Routing violations (written at block time by PreToolUse hook)
CREATE TABLE IF NOT EXISTS routing_violations (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type            TEXT NOT NULL,
  tool            TEXT,
  model           TEXT,
  skill           TEXT NOT NULL,
  operation_class TEXT,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS routing_violations_ts_idx   ON routing_violations (ts);
CREATE INDEX IF NOT EXISTS routing_violations_type_idx ON routing_violations (type);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INTER-SESSION MEMORY — auto-memory entries, chunked session transcripts,
-- policy sections, checklists, incidents, file corpus. Mirrors files in
-- ~/.claude/projects/<encoded-cwd>/memory/ and supports semantic recall across
-- Claude Code sessions. Loader (file → row sync) lives outside this script.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Memory entries — one row per ~/.claude/projects/<encoded-cwd>/memory/<file>.md
CREATE TABLE IF NOT EXISTS memory_entries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,                    -- frontmatter: name
  description TEXT,                      -- frontmatter: description
  mem_type TEXT,                         -- frontmatter: type (user, feedback, project, reference)
  body TEXT NOT NULL,
  source_file TEXT UNIQUE,               -- relative path to memory/<file>.md
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on memory_entries — pgvector not installed.';
END $$;

ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(body, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS memory_entries_fts_idx ON memory_entries USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS memory_entries_type_idx ON memory_entries (mem_type);

-- Session chunks — Claude Code transcripts chunked by message/tool boundary
CREATE TABLE IF NOT EXISTS session_chunks (
  id SERIAL PRIMARY KEY,
  session_num INTEGER,                   -- references sessions.num if mapped
  session_id TEXT,                       -- session UUID from JSONL filename
  chunk_idx INTEGER NOT NULL,
  chunk_kind TEXT,                       -- user, assistant, tool_use, tool_result, summary
  content TEXT NOT NULL,
  source_jsonl TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE session_chunks ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on session_chunks — pgvector not installed.';
END $$;

ALTER TABLE session_chunks ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
CREATE INDEX IF NOT EXISTS session_chunks_fts_idx ON session_chunks USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS session_chunks_session_idx ON session_chunks (session_num);
CREATE INDEX IF NOT EXISTS session_chunks_kind_idx ON session_chunks (chunk_kind);

-- Policy sections — CLAUDE.md and other policy docs broken into addressable sections
CREATE TABLE IF NOT EXISTS policy_sections (
  id SERIAL PRIMARY KEY,
  doc_id TEXT NOT NULL,                  -- e.g. "CLAUDE.md", "security-policy"
  section_num TEXT,                      -- hierarchical e.g. "1.2"
  section_title TEXT,
  content TEXT NOT NULL,
  source_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE policy_sections ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on policy_sections — pgvector not installed.';
END $$;

ALTER TABLE policy_sections ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(section_title, '') || ' ' ||
      coalesce(content, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS policy_sections_fts_idx ON policy_sections USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS policy_sections_doc_idx ON policy_sections (doc_id);

-- Checklist items — process gates (pre-commit, release-prep, etc.)
CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  checklist_name TEXT NOT NULL,          -- e.g. "pre-commit", "release-prep"
  cadence TEXT,                          -- e.g. "every-feature", "milestone", "on-demand"
  title TEXT NOT NULL,
  description TEXT,
  verification_step TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on checklist_items — pgvector not installed.';
END $$;

ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(verification_step, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS checklist_items_fts_idx ON checklist_items USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS checklist_items_name_idx ON checklist_items (checklist_name);

-- Incidents — post-incident notes for organizational memory
CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  incident_code TEXT UNIQUE,             -- e.g. "INC-2026-04-25-pgvector"
  title TEXT NOT NULL,
  what_happened TEXT,
  what_we_did TEXT,
  watch_for TEXT,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE incidents ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on incidents — pgvector not installed.';
END $$;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(what_happened, '') || ' ' ||
      coalesce(what_we_did, '') || ' ' ||
      coalesce(watch_for, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS incidents_fts_idx ON incidents USING gin(fts_vec);

-- Corpus files — arbitrary file corpus (PDFs, docs, summaries) for grounded retrieval
CREATE TABLE IF NOT EXISTS corpus_files (
  id SERIAL PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  file_type TEXT,                        -- pdf, md, ts, json, etc.
  source_domain TEXT,                    -- e.g. "claude-code-docs", "internal-runbooks"
  summary TEXT,
  bytes BIGINT,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE corpus_files ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'Skipping vector column on corpus_files — pgvector not installed.';
END $$;

ALTER TABLE corpus_files ADD COLUMN IF NOT EXISTS fts_vec TSVECTOR
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(path, '') || ' ' ||
      coalesce(source_domain, '') || ' ' ||
      coalesce(summary, ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS corpus_files_fts_idx ON corpus_files USING gin(fts_vec);
CREATE INDEX IF NOT EXISTS corpus_files_domain_idx ON corpus_files (source_domain);
CREATE INDEX IF NOT EXISTS corpus_files_type_idx ON corpus_files (file_type);
