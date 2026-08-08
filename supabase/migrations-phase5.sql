-- ============================================================
-- Phase 5 — pull-based work queue
-- Run in Supabase Dashboard → SQL Editor
--
-- Replaces static `listings.assigned_worker_id` hand-outs with a shared pool
-- workers claim from. Additive: nothing here touches listings / workers /
-- worker_done data, and the old assigned-listings path keeps working.
--
-- Verified before writing: test-claim-queue.py, 12,626 rows / 8 concurrent
-- workers → every row claimed exactly once, zero double-handing, 0.66s.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. The queue
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_queue (
  id             BIGSERIAL    PRIMARY KEY,
  source         TEXT         NOT NULL DEFAULT 'closingdownsale',  -- which catalogue this came from
  carousell_url  TEXT         UNIQUE,        -- his listing — the dedupe key on import
  title          TEXT         NOT NULL,      -- his title (reference; we write our own)
  price_sgd      NUMERIC(10,2),              -- his asking price
  images         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  times_listed   INT          NOT NULL DEFAULT 1,   -- catalogue prominence → work order
  state          TEXT         NOT NULL DEFAULT 'pending',
  claimed_by     UUID         REFERENCES workers(id),
  claimed_at     TIMESTAMPTZ,
  done_at        TIMESTAMPTZ,
  done_url       TEXT,                       -- OUR resulting Carousell listing
  reject_reason  TEXT,
  attempts       INT          NOT NULL DEFAULT 0,   -- claims so far; >3 = something's wrong with it
  created_at     TIMESTAMPTZ  DEFAULT now(),
  CONSTRAINT work_queue_state_chk
    CHECK (state IN ('pending', 'claimed', 'done', 'rejected'))
);

-- Serves the claim function's first branch (fresh work, best first).
CREATE INDEX IF NOT EXISTS work_queue_pending
  ON work_queue (times_listed DESC, id)
  WHERE state = 'pending';

-- Serves its second branch (expired leases). Without this the lease sweep is a
-- seq scan over the whole queue on every claim.
CREATE INDEX IF NOT EXISTS work_queue_expiring
  ON work_queue (claimed_at)
  WHERE state = 'claimed';

CREATE INDEX IF NOT EXISTS work_queue_claimed_by
  ON work_queue (claimed_by) WHERE claimed_by IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. Let worker_done record queue completions too
--    (listing_id stays for the old scrape-driven path; exactly one is set)
-- ────────────────────────────────────────────────────────────
ALTER TABLE worker_done
  ADD COLUMN IF NOT EXISTS queue_id BIGINT REFERENCES work_queue(id);

-- ────────────────────────────────────────────────────────────
-- 3. claim_work — hand out a batch, atomically
--
--    FOR UPDATE SKIP LOCKED is what makes this safe with N concurrent workers:
--    a worker locks the rows it takes, and anyone arriving mid-flight steps over
--    the locked ones instead of blocking. Selecting, marking claimed and
--    returning happen in ONE statement, so there is no read-then-write gap for a
--    second worker to slip into.
--
--    The OR branch is a 30-minute lease: a worker who closes the tab mid-batch
--    releases their rows automatically, no admin needed.
--
--    NOTE: ORDER BY governs WHICH rows are claimed, not the order RETURNING
--    hands them back — that is unspecified in Postgres. Sort in the caller.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_work(w UUID, n INT DEFAULT 20)
RETURNS SETOF work_queue AS $$
  UPDATE work_queue
     SET state      = 'claimed',
         claimed_by = w,
         claimed_at = now(),
         attempts   = attempts + 1
   WHERE id IN (
     SELECT id FROM work_queue
      WHERE state = 'pending'
         OR (state = 'claimed' AND claimed_at < now() - INTERVAL '30 minutes')
      ORDER BY times_listed DESC, id
      LIMIT n
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$ LANGUAGE sql;

-- ────────────────────────────────────────────────────────────
-- 4. complete_work — the VA posted it. Ownership-checked, so a worker can only
--    complete rows they currently hold.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION complete_work(w UUID, qid BIGINT, url TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
  WITH upd AS (
    UPDATE work_queue
       SET state = 'done', done_at = now(), done_url = COALESCE(url, done_url)
     WHERE id = qid AND claimed_by = w AND state = 'claimed'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$ LANGUAGE sql;

-- ────────────────────────────────────────────────────────────
-- 5. reject_work — unsourceable (China-only, margin won't clear, can't find it).
--    Deliberately NOT back to 'pending': the next VA would burn the same time
--    rediscovering it. Rejections are the signal for what to prune.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_work(w UUID, qid BIGINT, why TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
  WITH upd AS (
    UPDATE work_queue
       SET state = 'rejected', reject_reason = why, done_at = now()
     WHERE id = qid AND claimed_by = w AND state = 'claimed'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM upd);
$$ LANGUAGE sql;

-- ────────────────────────────────────────────────────────────
-- 6. release_work — end of shift. Gives back everything still held so the pool
--    refills immediately instead of waiting out the 30-minute lease.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_work(w UUID)
RETURNS INT AS $$
  WITH upd AS (
    UPDATE work_queue
       SET state = 'pending', claimed_by = NULL, claimed_at = NULL
     WHERE claimed_by = w AND state = 'claimed'
    RETURNING 1
  )
  SELECT COUNT(*)::INT FROM upd;
$$ LANGUAGE sql;

-- ────────────────────────────────────────────────────────────
-- 7. Queue health — for the owner's WORKERS tab
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW work_queue_stats AS
SELECT
  COUNT(*)                                          AS total,
  COUNT(*) FILTER (WHERE state = 'pending')         AS pending,
  COUNT(*) FILTER (WHERE state = 'claimed')         AS in_progress,
  COUNT(*) FILTER (WHERE state = 'done')            AS done,
  COUNT(*) FILTER (WHERE state = 'rejected')        AS rejected,
  COUNT(*) FILTER (WHERE state = 'claimed'
                     AND claimed_at < now() - INTERVAL '30 minutes') AS lease_expired,
  COUNT(*) FILTER (WHERE attempts > 3
                     AND state <> 'done')           AS repeatedly_reclaimed
FROM work_queue;

-- ────────────────────────────────────────────────────────────
-- 8. Lock it to the service role. Every VA path goes through /api/worker-queue,
--    which uses the service key, so no client policy is needed. RLS on with no
--    policies = anon/publishable key cannot read or write this table.
--    If the owner's work.html should read it directly (it uses the publishable
--    key), add a SELECT policy — do that deliberately, not by default.
-- ────────────────────────────────────────────────────────────
ALTER TABLE work_queue ENABLE ROW LEVEL SECURITY;
