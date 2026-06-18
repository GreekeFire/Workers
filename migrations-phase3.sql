-- ============================================================
-- Phase 3: done_at timestamp on listings
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- Lets the LISTINGS tab "recently done" view sort by actual completion time
-- instead of creation order, so worker-completed listings surface correctly.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;
