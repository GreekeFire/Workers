/**
 * POST /api/worker-done
 *
 * Body: { worker_id: UUID, listing_id: number, warnings_overridden?: bool }
 *
 * 1. Validate worker + listing ownership
 * 2. Set listing status = 'done'
 * 3. Insert worker_done row (title snapshot + warnings_overridden flag)
 * 4. Return { ok, count_today }
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { worker_id, listing_id, warnings_overridden = false } = req.body || {};

  if (!worker_id)  return res.status(400).json({ error: 'worker_id required' });
  if (!listing_id) return res.status(400).json({ error: 'listing_id required' });

  // Validate worker
  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, active').eq('id', worker_id).single();
  if (wErr || !worker) return res.status(404).json({ error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ error: 'worker-inactive' });

  // Fetch listing — must be assigned to this worker and active
  const { data: listing, error: lErr } = await sb
    .from('listings')
    .select('id, title, ai_title, assigned_worker_id, status')
    .eq('id', listing_id)
    .single();
  if (lErr || !listing)                          return res.status(404).json({ error: 'listing-not-found' });
  if (listing.assigned_worker_id !== worker_id)  return res.status(403).json({ error: 'listing-not-assigned-to-worker' });
  if (listing.status !== 'active')               return res.status(409).json({ error: 'listing-not-active', status: listing.status });

  // Mark listing done
  const { error: updateErr } = await sb
    .from('listings').update({ status: 'done' }).eq('id', listing_id);
  if (updateErr) {
    console.error('listing update error:', updateErr);
    return res.status(500).json({ error: 'update-failed' });
  }

  // Insert worker_done row
  const today = new Date().toISOString().slice(0, 10);
  const { error: doneErr } = await sb.from('worker_done').insert({
    worker_id,
    listing_id,
    listing_title:       listing.ai_title || listing.title || '',
    date:                today,
    warnings_overridden: !!warnings_overridden,
  });
  if (doneErr) console.error('worker_done insert error:', doneErr); // non-fatal

  // Count today
  const { count } = await sb
    .from('worker_done')
    .select('id', { count: 'exact', head: true })
    .eq('worker_id', worker_id)
    .eq('date', today);

  return res.json({ ok: true, count_today: count || 0 });
};
