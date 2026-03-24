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

-- Tasks — features, bugs, investigations
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'pending',     -- pending, in_progress, done, deferred
  phase TEXT DEFAULT 'backlog',
  priority TEXT DEFAULT 'medium',    -- low, medium, high, critical
  github_issue INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Decisions — finalized architectural choices with rationale
CREATE TABLE IF NOT EXISTS decisions (
  id SERIAL PRIMARY KEY,
  session_num INTEGER,
  topic TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gotchas — critical constraints ("never do this")
CREATE TABLE IF NOT EXISTS gotchas (
  id SERIAL PRIMARY KEY,
  issue TEXT NOT NULL,
  rule TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE
);

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
  github_issue INTEGER,                   -- Linked GitHub issue number
  commit_sha TEXT,                        -- Fix commit SHA
  task_id INTEGER REFERENCES tasks(id),   -- Linked pipeline task
  report_path TEXT,                       -- Original report file path
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add vector column for semantic search if pgvector is available
DO $$ BEGIN
  ALTER TABLE findings ADD COLUMN IF NOT EXISTS embedding vector(1024);
EXCEPTION WHEN OTHERS THEN
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
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping vector column — pgvector not installed. FTS search still works.';
END $$;

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
  SELECT id, title, phase, status, priority, github_issue, created_at
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

CREATE OR REPLACE VIEW open_findings AS
  SELECT id, source, severity, confidence, location, category,
         description, effort, status, github_issue, commit_sha
  FROM findings
  WHERE status NOT IN ('verified', 'wontfix')
  ORDER BY
    CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
    created_at;
