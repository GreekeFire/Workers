-- ============================================================
-- Steadymart VA system — DB migrations
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. New table: workers
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT         NOT NULL,
  daily_target  INT          DEFAULT 100,
  active        BOOL         DEFAULT true,
  created_at    TIMESTAMPTZ  DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. New table: worker_done
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_done (
  id                  BIGSERIAL    PRIMARY KEY,
  worker_id           UUID         REFERENCES workers(id),
  listing_id          INT          REFERENCES listings(id),   -- nullable if listing deleted
  listing_title       TEXT,                                    -- snapshot at Done time
  done_at             TIMESTAMPTZ  DEFAULT now(),
  date                DATE         DEFAULT CURRENT_DATE,
  warnings_overridden BOOL         DEFAULT false               -- VA proceeded past soft warns
);

-- ────────────────────────────────────────────────────────────
-- 3. Add columns to listings
-- ────────────────────────────────────────────────────────────
ALTER TABLE listings ADD COLUMN IF NOT EXISTS assigned_worker_id  UUID  REFERENCES workers(id) DEFAULT NULL;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ai_title            TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS ai_description      TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS guard_warnings      JSONB;  -- e.g. ["non-sg-seller","low-rating"]

-- ────────────────────────────────────────────────────────────
-- 4. Add columns to scrape_inbox
-- ────────────────────────────────────────────────────────────
ALTER TABLE scrape_inbox ADD COLUMN IF NOT EXISTS worker_id      UUID;    -- NULL = owner scrape
ALTER TABLE scrape_inbox ADD COLUMN IF NOT EXISTS categories     TEXT[];  -- from v4 API
ALTER TABLE scrape_inbox ADD COLUMN IF NOT EXISTS shop_location  TEXT;    -- from v4 API
ALTER TABLE scrape_inbox ADD COLUMN IF NOT EXISTS rating_star    FLOAT;   -- from v4 API

-- ────────────────────────────────────────────────────────────
-- 5. Index: fast daily-count lookups for worker_done
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS worker_done_worker_date
  ON worker_done (worker_id, date);

-- ────────────────────────────────────────────────────────────
-- 6. Index: fast assigned listings lookups
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS listings_assigned_worker
  ON listings (assigned_worker_id)
  WHERE assigned_worker_id IS NOT NULL;
