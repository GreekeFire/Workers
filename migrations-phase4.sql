-- Phase 4: allow deleting listings that a VA has already marked done.
--
-- worker_done.listing_id was created as REFERENCES listings(id) with no
-- ON DELETE action, so deleting a done listing from the Listings tools
-- failed with a foreign-key violation ("Delete failed" toast).
-- listing_title is stored on worker_done itself, so the VA output log
-- keeps its meaning after the link is nulled.
--
-- Run in the Supabase SQL editor. Idempotent + finds the FK name itself.

DO $$
DECLARE
  cname text;
BEGIN
  SELECT c.conname INTO cname
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'worker_done'::regclass
    AND c.contype = 'f'
    AND a.attname = 'listing_id';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE worker_done DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE worker_done
  ADD CONSTRAINT worker_done_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE SET NULL;
