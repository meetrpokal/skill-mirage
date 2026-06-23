-- init.sql: bootstrap the jobmarket database
-- Covers all tables needed by the Skills Mirage platform

-- 1 ── Layer 1: Scraped jobs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  job_id            TEXT PRIMARY KEY,
  job_url           TEXT,
  title             TEXT NOT NULL,
  canonical_role    TEXT,
  company           TEXT,
  city              TEXT,
  state             TEXT,
  country           TEXT DEFAULT 'India',
  sector            TEXT,
  skills_list       TEXT[],
  salary_min        INT,
  salary_max        INT,
  posted_date       DATE,
  ai_tool_mentions  TEXT[],
  ai_mention_rate   REAL DEFAULT 0,
  job_description   TEXT,
  source            TEXT DEFAULT 'naukri',
  scrape_timestamp  TIMESTAMPTZ DEFAULT NOW()
);

-- 2 ── Aggregates (computed by processor) ───────────────────────────────
CREATE TABLE IF NOT EXISTS aggregates (
  id           SERIAL PRIMARY KEY,
  agg_type     TEXT NOT NULL,
  agg_key      TEXT NOT NULL,
  agg_value    INT NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3 ── Skill mentions (trending / declining) ────────────────────────────
CREATE TABLE IF NOT EXISTS skill_mentions (
  id                    SERIAL PRIMARY KEY,
  skill                 TEXT NOT NULL,
  city                  TEXT,
  sector                TEXT,
  mention_count         INT DEFAULT 0,
  week_over_week_change REAL DEFAULT 0,
  month_over_month_change REAL DEFAULT 0,
  direction             TEXT DEFAULT 'stable' CHECK (direction IN ('rising','declining','stable')),
  gov_training_seats    INT DEFAULT 0,
  gov_courses           JSONB DEFAULT '[]',
  has_gov_course        BOOLEAN DEFAULT FALSE,
  snapshot_date         TIMESTAMPTZ DEFAULT NOW()
);

-- 4 ── Vulnerability scores (role × city) ───────────────────────────────
CREATE TABLE IF NOT EXISTS vulnerability_scores (
  id                 SERIAL PRIMARY KEY,
  canonical_role     TEXT NOT NULL,
  city               TEXT NOT NULL,
  score              REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  risk_band          TEXT CHECK (risk_band IN ('Low','Medium','High','Critical')),
  hiring_decline     REAL DEFAULT 0,
  ai_mention_rate    REAL DEFAULT 0,
  displacement_ratio REAL DEFAULT 0,
  trend_direction    TEXT DEFAULT 'stable' CHECK (trend_direction IN ('rising','falling','stable')),
  delta_30d          REAL DEFAULT 0,
  snapshot_date      TIMESTAMPTZ DEFAULT NOW()
);

-- 5 ── Watchlist alerts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist_alerts (
  id                        SERIAL PRIMARY KEY,
  canonical_role            TEXT NOT NULL,
  city                      TEXT NOT NULL,
  decline_history           JSONB DEFAULT '[]',
  consecutive_decline_months INT DEFAULT 0,
  affected_workers          INT DEFAULT 0,
  severity                  TEXT DEFAULT 'warning' CHECK (severity IN ('warning','critical')),
  is_active                 BOOLEAN DEFAULT TRUE,
  triggered_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 6 ── Courses (NPTEL / SWAYAM / PMKVY) ────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  provider        TEXT NOT NULL CHECK (provider IN ('NPTEL','SWAYAM','PMKVY')),
  institution     TEXT,
  skill_cluster   TEXT[],
  duration        TEXT,
  hours_per_week  REAL,
  total_hours     REAL,
  cost            TEXT DEFAULT 'Free',
  modality        TEXT DEFAULT 'online' CHECK (modality IN ('online','in-person','hybrid')),
  centre_address  TEXT,
  city            TEXT,
  url             TEXT,
  level           TEXT DEFAULT 'beginner' CHECK (level IN ('beginner','intermediate','advanced'))
);

-- 7 ── Worker profiles (Layer 2) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_profiles (
  id                  SERIAL PRIMARY KEY,
  job_title           TEXT NOT NULL,
  canonical_role      TEXT NOT NULL,
  city                TEXT NOT NULL,
  years_of_experience INT NOT NULL,
  write_up            TEXT NOT NULL,
  extracted_skills    JSONB DEFAULT '{}',
  risk_score          REAL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_band           TEXT CHECK (risk_band IN ('Low','Medium','High','Critical')),
  risk_delta_30d      REAL DEFAULT 0,
  top_signals         TEXT[],
  peer_percentile     REAL DEFAULT 0,
  reskilling_path     JSONB DEFAULT '{}',
  last_computed_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_city ON jobs(city);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_canonical_role ON jobs(canonical_role);
CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs(posted_date);

-- 8 ── Users ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  job_title       TEXT,
  city            TEXT,
  writeup         TEXT,
  selected_skills TEXT[],
  years_of_experience INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_jobs_role_city_date ON jobs(canonical_role, city, posted_date);

CREATE INDEX IF NOT EXISTS idx_agg_type ON aggregates(agg_type);

CREATE INDEX IF NOT EXISTS idx_skill_mentions_skill ON skill_mentions(skill);
CREATE INDEX IF NOT EXISTS idx_skill_mentions_city ON skill_mentions(city);
CREATE INDEX IF NOT EXISTS idx_skill_mentions_dir ON skill_mentions(direction);

CREATE INDEX IF NOT EXISTS idx_vuln_role ON vulnerability_scores(canonical_role);
CREATE INDEX IF NOT EXISTS idx_vuln_city ON vulnerability_scores(city);
CREATE INDEX IF NOT EXISTS idx_vuln_role_city ON vulnerability_scores(canonical_role, city);

CREATE INDEX IF NOT EXISTS idx_watchlist_role_city ON watchlist_alerts(canonical_role, city);

CREATE INDEX IF NOT EXISTS idx_courses_skill ON courses USING GIN (skill_cluster);
CREATE INDEX IF NOT EXISTS idx_courses_city ON courses(city);

CREATE INDEX IF NOT EXISTS idx_worker_role_city ON worker_profiles(canonical_role, city);

-- ── Users (authentication & profile) ─────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  username          TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  job_title         TEXT,
  city              TEXT,
  writeup           TEXT,
  selected_skills   TEXT[] DEFAULT '{}',
  years_of_experience INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ── Notify trigger: fires when new jobs are inserted ─────────────────
CREATE OR REPLACE FUNCTION notify_new_jobs() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('new_data', json_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'ts', NOW())::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_notify ON jobs;
CREATE TRIGGER trg_jobs_notify
  AFTER INSERT ON jobs
  FOR EACH STATEMENT          -- fires once per batch, not per row
  EXECUTE FUNCTION notify_new_jobs();
