-- Pipeline Knowledge DB Setup
-- Run this when knowledge.tier is "postgres" in pipeline.yml
-- Creates tables for sessions, tasks, decisions, gotchas, and research

-- Enable pgvector if available (for semantic search)
CREATE EXTENSION IF NOT EXISTS vector;

-- Sessions table — tracks each working session
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  session_num INTEGER UNIQUE NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  test_count INTEGER DEFAULT 0,
  summary TEXT,
  project_name TEXT
);

-- Tasks table — tracks features, bugs, investigations
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  phase TEXT DEFAULT 'backlog',
  status TEXT DEFAULT 'open',
  priority TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  session_num INTEGER REFERENCES sessions(session_num),
  notes TEXT
);

-- Decisions table — finalized architectural choices
CREATE TABLE IF NOT EXISTS decisions (
  id SERIAL PRIMARY KEY,
  session_num INTEGER,
  topic TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Gotchas table — critical constraints and "never do this" rules
CREATE TABLE IF NOT EXISTS gotchas (
  id SERIAL PRIMARY KEY,
  issue TEXT NOT NULL,
  rule TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE
);

-- Research table — detailed research notes linked to tasks
CREATE TABLE IF NOT EXISTS research (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings table — for semantic search (requires pgvector)
CREATE TABLE IF NOT EXISTS embeddings (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,  -- 'file', 'research', 'decision', 'session'
  source_id TEXT NOT NULL,    -- file path or record ID
  chunk_text TEXT NOT NULL,
  embedding vector(1024),     -- mxbai-embed-large dimension
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast vector similarity search
CREATE INDEX IF NOT EXISTS embeddings_vector_idx
  ON embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index for source lookups
CREATE INDEX IF NOT EXISTS embeddings_source_idx
  ON embeddings (source_type, source_id);

-- Useful views
CREATE OR REPLACE VIEW open_tasks AS
  SELECT id, title, phase, status, priority, created_at
  FROM tasks
  WHERE status = 'open'
  ORDER BY priority DESC, created_at;

CREATE OR REPLACE VIEW recent_sessions AS
  SELECT session_num, started_at, ended_at, test_count, summary
  FROM sessions
  ORDER BY session_num DESC
  LIMIT 5;

CREATE OR REPLACE VIEW active_gotchas AS
  SELECT id, issue, rule
  FROM gotchas
  WHERE active = TRUE
  ORDER BY created_at DESC;
