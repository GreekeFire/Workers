-- ============================================================
-- Steadymart VA system — Phase 2 migrations
-- Run in Supabase Dashboard → SQL Editor AFTER migrations.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Enable pg_trgm (required for similarity() function)
--    Safe to run even if already enabled.
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ────────────────────────────────────────────────────────────
-- 2. sales_log table
--    Normalises the salesLog JSON blob (currently in app_state)
--    into a proper queryable table. listing_id links each sale
--    back to a listing row so worker conversion can be measured.
--    Old sales without a listing_id are allowed (nullable).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_log (
  id           BIGSERIAL    PRIMARY KEY,
  listing_id   INT          REFERENCES listings(id) ON DELETE SET NULL,
  name         TEXT,          -- listing title snapshot at time of sale
  price        NUMERIC(10,2), -- sell price (what buyer paid)
  source_cost  NUMERIC(10,2), -- source cost at time of sale
  category     TEXT,
  date         DATE,          -- YYYY-MM-DD (local date the owner logged it)
  ts           TIMESTAMPTZ,   -- exact log time (ISO string from app)
  created_at   TIMESTAMPTZ  DEFAULT now()
);

-- Index: fast worker attribution query (Task 3)
CREATE INDEX IF NOT EXISTS sales_log_listing_id
  ON sales_log (listing_id)
  WHERE listing_id IS NOT NULL;

-- Index: revenue-by-date queries
CREATE INDEX IF NOT EXISTS sales_log_date
  ON sales_log (date);

-- ────────────────────────────────────────────────────────────
-- 3. duplicate_log table
--    Written to by /api/worker-scrape when a near-match is found.
--    Logging only — never shown to VAs, reviewed by owner weekly.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS duplicate_log (
  id              BIGSERIAL    PRIMARY KEY,
  listing_id      INT          REFERENCES listings(id) ON DELETE SET NULL, -- existing match
  incoming_title  TEXT,
  incoming_url    TEXT,
  incoming_cost   NUMERIC(10,2),
  worker_id       UUID         REFERENCES workers(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS duplicate_log_created
  ON duplicate_log (created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 4. Postgres RPC: find_fuzzy_duplicate
--    Called by /api/worker-scrape to find near-match listings.
--    Uses pg_trgm similarity() — requires extension above.
--    Parameters:
--      p_title     TEXT    — incoming product title
--      p_cost      FLOAT   — incoming cost (e.g. 45.00)
--      p_threshold FLOAT   — similarity threshold (default 0.6)
--    Returns: listing_id, existing_title, similarity score
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION find_fuzzy_duplicate(
  p_title     TEXT,
  p_cost      FLOAT,
  p_threshold FLOAT DEFAULT 0.6
)
RETURNS TABLE(listing_id INT, existing_title TEXT, similarity_score FLOAT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    l.id                              AS listing_id,
    l.title                           AS existing_title,
    similarity(l.title, p_title)::FLOAT AS similarity_score
  FROM listings l
  WHERE
    l.status NOT IN ('deleted')
    AND l.source_cost IS NOT NULL
    AND l.source_cost BETWEEN (p_cost * 0.9) AND (p_cost * 1.1)
    AND similarity(l.title, p_title) >= p_threshold
  ORDER BY similarity_score DESC
  LIMIT 1;
$$;

-- Grant execute to the service role (used by API endpoints)
GRANT EXECUTE ON FUNCTION find_fuzzy_duplicate TO service_role;
