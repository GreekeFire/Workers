-- ============================================================
-- Phase 7 — lease 30 minutes → 4 hours
-- Run in Supabase Dashboard → SQL Editor
--
-- The lease has to outlast a batch, not a listing. 20 rows at the measured pace
-- (under a minute each) is 15-20 minutes, which fits inside 30 — but a VA idling
-- mid-batch with the tab open, or a handful of slow products (hunting a supplier,
-- a tricky variant), pushes past it. Then the tail of their batch reads as
-- available, a second VA is handed the same products, both post the same item,
-- and whoever presses Done second gets a 409 after doing the work.
--
-- 4 hours because the lease is only a crash backstop: closing the tab already
-- releases the batch via the pagehide beacon (verified — released 21 rows), and
-- release_work covers end of shift. Holding 20 of 12,626 rows for a few hours
-- after a hard crash costs nothing.
--
-- Idempotent: both objects are CREATE OR REPLACE, unchanged except the interval.
-- ============================================================

-- claim_work — the OR branch is the lease; everything else is phase 5 verbatim.
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
         OR (state = 'claimed' AND claimed_at < now() - INTERVAL '4 hours')
      ORDER BY times_listed DESC, id
      LIMIT n
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$ LANGUAGE sql;

-- Keep the health view in step, or lease_expired counts rows claim_work will not
-- actually hand out.
CREATE OR REPLACE VIEW work_queue_stats AS
SELECT
  COUNT(*)                                          AS total,
  COUNT(*) FILTER (WHERE state = 'pending')         AS pending,
  COUNT(*) FILTER (WHERE state = 'claimed')         AS in_progress,
  COUNT(*) FILTER (WHERE state = 'done')            AS done,
  COUNT(*) FILTER (WHERE state = 'rejected')        AS rejected,
  COUNT(*) FILTER (WHERE state = 'claimed'
                     AND claimed_at < now() - INTERVAL '4 hours') AS lease_expired,
  COUNT(*) FILTER (WHERE attempts > 3
                     AND state <> 'done')           AS repeatedly_reclaimed
FROM work_queue;
