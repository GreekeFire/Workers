/**
 * POST /api/worker-skip
 *
 * Body: { worker_id: UUID, listing_id: number }
 *
 * Permanently removes an unposted listing from the worker's queue. Skip used
 * to be client-side session state only, so a page refresh brought the listing
 * back. Hard delete matches Deactivate / Clear listings semantics: an active
 * listing never reached Carousell so there's nothing to keep, and freeing the
 * shopee_url lets the item be re-scraped deliberately later.
 */

const { sb, SERVICE_KEY } = require('../lib/sb');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const { worker_id, listing_id } = req.body || {};
  if (!worker_id)  return res.status(400).json({ error: 'worker_id required' });
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });

  // Validate worker
  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, active').eq('id', worker_id).single();
  if (wErr || !worker) return res.status(404).json({ error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ error: 'worker-inactive' });

  // Delete only if assigned to this worker and still unposted — the filters
  // double as the ownership check, so a worker can never delete another
  // worker's listing or anything already posted (status 'done').
  const { error: delErr, count } = await sb
    .from('listings')
    .delete({ count: 'exact' })
    .eq('id', listing_id)
    .eq('assigned_worker_id', worker_id)
    .eq('status', 'active');
  if (delErr) {
    console.error('skip delete error:', delErr);
    return res.status(500).json({ error: 'skip-failed' });
  }
  if (!count) return res.status(404).json({ error: 'listing-not-found-or-not-active' });

  return res.json({ ok: true });
};
