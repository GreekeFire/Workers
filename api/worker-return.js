/**
 * POST /api/worker-return
 *
 * Body: { worker_id: UUID, listing_id: number }
 * Unassigns the listing from the worker (sets assigned_worker_id = null).
 * Used when the VA finds a dead Shopee or Carousell link — returns it to
 * the owner's unassigned pool for manual handling.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { worker_id, listing_id } = req.body || {};
  if (!worker_id)  return res.status(400).json({ error: 'worker_id required' });
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });

  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, active').eq('id', worker_id).single();
  if (wErr || !worker) return res.status(404).json({ error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ error: 'worker-inactive' });

  // Fetch current guard_warnings so we can append without overwriting
  const { data: listing } = await sb
    .from('listings').select('guard_warnings').eq('id', listing_id).single();
  const existing = Array.isArray(listing?.guard_warnings) ? listing.guard_warnings : [];
  const warnings = existing.includes('dead-link') ? existing : [...existing, 'dead-link'];

  const { error } = await sb
    .from('listings')
    .update({ assigned_worker_id: null, guard_warnings: warnings })
    .eq('id', listing_id)
    .eq('assigned_worker_id', worker_id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
};
