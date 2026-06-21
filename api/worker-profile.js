/**
 * GET /api/worker-profile?w=UUID
 *
 * Returns { id, name, daily_target, count_today, bookmarklet }.
 * 403 if worker is inactive.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const w = req.query.w;
  if (!w) return res.status(400).json({ error: 'w (worker UUID) required' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, name, daily_target, active').eq('id', w).single();
  if (wErr || !worker) return res.status(404).json({ error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ error: 'worker-inactive' });

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // SGT (UTC+8)
  const { count } = await sb
    .from('worker_done')
    .select('id', { count: 'exact', head: true })
    .eq('worker_id', w)
    .eq('date', today);

  const base = process.env.APP_URL || 'https://workers-v1.vercel.app';
  const bookmarklet = `javascript:window.__swWorker='${worker.id}';fetch('${base}/sc.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load '+e))`;

  return res.json({
    ok:           true,
    id:           worker.id,
    name:         worker.name,
    daily_target: worker.daily_target,
    count_today:  count || 0,
    bookmarklet,
  });
};
