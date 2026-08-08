-- ============================================================
-- Phase 6 — mode belongs to the worker, not the link
-- Run in Supabase Dashboard → SQL Editor
--
-- Queue mode was decided by `?queue=1` in the VA's URL, so a VA who trimmed or
-- retyped the link landed in the assigned-listings flow and saw "Queue empty"
-- with 12,626 items sitting in the pool. One column fixes it at the source: the
-- profile endpoint already runs on every page load, so nothing new is fetched.
--
-- Additive and reversible — the default flips everyone to the queue, which is
-- the flow in use. Set false per worker to put someone back on the scraper flow.
-- ============================================================

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS queue_mode BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN workers.queue_mode IS
  'true = claims from the shared work_queue pool; false = works listings pre-assigned via listings.assigned_worker_id (the old scraper flow, with a bookmarklet).';

-- ponytail: boolean, because there are exactly two flows. If a third VA flow
-- ever lands, widen to work_mode TEXT ('queue' | 'scrape' | …) then, not now.
