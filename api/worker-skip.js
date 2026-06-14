/**
 * POST /api/worker-skip
 *
 * Body: { worker_id: UUID, listing_id?: number }
 * No DB change — queue advancement is client-side.
 * Validates worker is real + active so the endpoint can't be spoofed.
 * Returns { ok: true, skipped: listing_id|null }
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { worker_id, listing_id } = req.body || {};
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, active').eq('id', worker_id).single();
  if (wErr || !worker) return res.status(404).json({ error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ error: 'worker-inactive' });

  return res.json({ ok: true, skipped: listing_id || null });
};
