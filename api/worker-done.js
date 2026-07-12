/**
 * POST /api/worker-done
 *
 * Body: { worker_id: UUID, listing_id: number, warnings_overridden?: bool,
 *         carousell_url?: string, skip?: bool }
 *
 * 1. Validate worker + listing ownership
 * 2. Set listing status = 'done' — or DELETE the listing entirely when skip=true
 * 3. Insert worker_done row (title snapshot + warnings_overridden flag) — done only
 * 4. Return { ok, count_today } (skip returns { ok, skipped })
 */

const { sb, SERVICE_KEY, sgtToday } = require('../lib/sb');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const { worker_id, listing_id, warnings_overridden = false, carousell_url = null, skip = false } = req.body || {};

  if (!worker_id)   return res.status(400).json({ error: 'worker_id required' });
  if (!listing_id)  return res.status(400).json({ error: 'listing_id required' });
  if (!skip && carousell_url && !(/carousell\./i.test(carousell_url) && /\/p\/|\/sell\/|app\.link/i.test(carousell_url))) {
    return res.status(400).json({ error: 'invalid carousell_url — must be a listing link' });
  }

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

  // skip=true → the VA isn't listing this item, so remove it entirely. Hard
  // delete: the row (Shopee link and all) is gone, not archived. No worker_done
  // row — a skip is not a completion. Ownership + active checks above still gate
  // it, so a VA can only delete their own unlisted item.
  if (skip) {
    const { error: delErr } = await sb.from('listings').delete().eq('id', listing_id);
    if (delErr) {
      console.error('listing delete error:', delErr);
      return res.status(500).json({ error: 'delete-failed' });
    }
    return res.json({ ok: true, skipped: true });
  }

  // Mark listing done + save Carousell URL if provided
  const update = { status: 'done' };
  if (carousell_url) update.carousell_url = carousell_url;
  const { error: updateErr } = await sb
    .from('listings').update(update).eq('id', listing_id);
  if (updateErr) {
    console.error('listing update error:', updateErr);
    return res.status(500).json({ error: 'update-failed' });
  }

  const today = sgtToday();
  const { error: doneErr } = await sb.from('worker_done').insert({
    worker_id,
    listing_id,
    listing_title:       listing.ai_title || listing.title || '',
    date:                today,
    warnings_overridden: !!warnings_overridden,
  });
  if (doneErr) console.error('worker_done insert error:', doneErr); // non-fatal

  const { count } = await sb
    .from('worker_done')
    .select('id', { count: 'exact', head: true })
    .eq('worker_id', worker_id)
    .eq('date', today);

  return res.json({ ok: true, count_today: count || 0 });
};
