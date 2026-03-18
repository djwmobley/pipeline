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
-- CODE INDEX — file descriptions with FTS + optional vector embeddings
-- ═══════════════════════════════════════════════════════════════════════════════

-- Code index — one row per source file, FTS-searchable
CREATE TABLE IF NOT EXISTS code_index (
  path TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  fts_vec TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', description)) STORED,
  embedding vector(1024)       -- NULL until embeddings are generated
);

CREATE INDEX IF NOT EXISTS code_index_fts_idx ON code_index USING gin(fts_vec);

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
