-- ============================================================
-- Phase 8 — one catalogue pass per Carousell account
-- Run in Supabase Dashboard → SQL Editor
--
-- The plan is the same 12,626 products listed on every account (auvra's design:
-- N small accounts, none looking like a whale). The queue held one row per
-- product and retired it on the first 'done', so a second account could never
-- be served it. This partitions the queue by account: the whole state machine
-- (pending → claimed → done/rejected) is unchanged, it just runs once per
-- account.
--
-- Existing 12,626 rows become account 1's pass. Adding an account later is one
-- call to clone_catalogue() — no re-scrape, no Apify run, no loader change.
--
-- Verified by test-accounts.py: cross-account isolation, independent passes of
-- the same product, rejection propagation, and account-scoped lease recovery.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Which account's pass a row belongs to
-- ────────────────────────────────────────────────────────────
ALTER TABLE work_queue
  ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'steadymart';

COMMENT ON COLUMN work_queue.account IS
  'Carousell account this row is a listing job for. Matches workers.account_name — claim_work only hands a worker rows for their own account.';

-- ────────────────────────────────────────────────────────────
-- 2. Unique per (product, account), not per product
--    Phase 5 made carousell_url globally unique, which is exactly what blocks a
--    second account's copy. Still one row per product per account, so a repeated
--    import can't double-load.
-- ────────────────────────────────────────────────────────────
ALTER TABLE work_queue DROP CONSTRAINT IF EXISTS work_queue_carousell_url_key;
ALTER TABLE work_queue DROP CONSTRAINT IF EXISTS work_queue_url_account_key;
ALTER TABLE work_queue
  ADD CONSTRAINT work_queue_url_account_key UNIQUE (carousell_url, account);

-- ────────────────────────────────────────────────────────────
-- 3. Claim index leads with account, or every claim scans every account's rows
-- ────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS work_queue_pending;
CREATE INDEX IF NOT EXISTS work_queue_pending
  ON work_queue (account, times_listed DESC, id)
  WHERE state = 'pending';

-- ────────────────────────────────────────────────────────────
-- 4. claim_work — account-scoped. Signature unchanged, so /api/worker-queue and
--    va.html need no edit.
--
--    The filter wraps BOTH branches deliberately. If it only covered the pending
--    branch, a worker on account B could recover an expired lease from account
--    A's pass and post A's product on B — a duplicate the queue would then never
--    hand to A. Account is read from the worker, so a VA cannot pick.
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
      WHERE account = (SELECT account_name FROM workers WHERE id = w)
        AND (state = 'pending'
             OR (state = 'claimed' AND claimed_at < now() - INTERVAL '4 hours'))
      ORDER BY times_listed DESC, id
      LIMIT n
      FOR UPDATE SKIP LOCKED
   )
  RETURNING *;
$$ LANGUAGE sql;

-- ────────────────────────────────────────────────────────────
-- 5. reject_work — a rejection is a fact about the PRODUCT, not the account
--    (China-only, margin won't clear, can't find it). So it kills that product's
--    untouched copies on every other account too; otherwise each dud is
--    rediscovered once per account and the VA pays for it N times.
--
--    Only 'pending' siblings are touched — never another account's in-progress
--    or already-posted row. Return value still reflects only the caller's row,
--    so the endpoint's 409 path is unchanged.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_work(w UUID, qid BIGINT, why TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
  WITH mine AS (
    UPDATE work_queue
       SET state = 'rejected', reject_reason = why, done_at = now()
     WHERE id = qid AND claimed_by = w AND state = 'claimed'
    RETURNING carousell_url
  ), siblings AS (
    UPDATE work_queue
       SET state         = 'rejected',
           reject_reason = COALESCE(why, 'rejected') || ' [via another account]',
           done_at       = now()
     WHERE state = 'pending'
       AND carousell_url IN (SELECT carousell_url FROM mine)
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM mine);
$$ LANGUAGE sql;

-- ────────────────────────────────────────────────────────────
-- 6. clone_catalogue — run once per new account, whenever its SIM lands.
--    Rejected rows are deliberately NOT cloned: unsourceable is unsourceable on
--    every account. Re-running is safe (ON CONFLICT DO NOTHING), so it also
--    tops a new account up after the source catalogue grows.
--
--      SELECT clone_catalogue('steadymart2');
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION clone_catalogue(new_account TEXT,
                                           from_account TEXT DEFAULT 'steadymart')
RETURNS BIGINT AS $$
  WITH ins AS (
    INSERT INTO work_queue (source, carousell_url, title, price_sgd, images,
                            times_listed, account)
    SELECT source, carousell_url, title, price_sgd, images, times_listed, new_account
      FROM work_queue
     WHERE account = from_account
       AND state <> 'rejected'
    ON CONFLICT (carousell_url, account) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) FROM ins;
$$ LANGUAGE sql;

-- ────────────────────────────────────────────────────────────
-- 7. Queue health, per account. The single-row view stays for the whole pool.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW work_queue_by_account AS
SELECT
  account,
  COUNT(*)                                   AS total,
  COUNT(*) FILTER (WHERE state = 'pending')  AS pending,
  COUNT(*) FILTER (WHERE state = 'claimed')  AS in_progress,
  COUNT(*) FILTER (WHERE state = 'done')     AS done,
  COUNT(*) FILTER (WHERE state = 'rejected') AS rejected
FROM work_queue
GROUP BY account
ORDER BY account;
