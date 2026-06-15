/**
 * GET /api/worker-listings?w=UUID
 *
 * Called by va.html every 10s. Returns assigned active listings for this worker.
 * Also drains up to 3 pending scrape_inbox rows per call so new scrapes appear
 * without a separate webhook.
 *
 * Never returns source_cost — VA must not see margin data.
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

  // Validate worker
  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, active').eq('id', w).single();
  if (wErr || !worker) return res.status(404).json({ error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ error: 'worker-inactive' });

  // Drain pending inbox rows (fire-and-forget, non-blocking on failure)
  try {
    const { data: pending } = await sb
      .from('scrape_inbox')
      .select('id')
      .eq('worker_id', w)
      .eq('kind', 'shopee')
      .eq('consumed', false)
      .limit(3);

    if (pending && pending.length > 0) {
      const base = process.env.APP_URL || 'https://workers-v1.vercel.app';
      // Fire scrape calls concurrently and don't await — each call invokes Claude
      // (5-10 s) and awaiting them serially would stall the response for up to
      // 30 s (3 rows × 10 s), well past Vercel's function timeout.  The scrapes
      // run in the background; the VA's next 10 s poll picks up the resulting listings.
      for (const row of pending) {
        fetch(`${base}/api/worker-scrape`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ worker_id: w, inbox_id: row.id }),
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.error('inbox drain error:', e.message);
  }

  // Fetch assigned active listings — source_cost deliberately excluded
  const today = new Date().toISOString().slice(0, 10);
  const [listingsResult, countResult] = await Promise.all([
    sb.from('listings')
      .select('id, title, ai_title, ai_description, sell_price, images, shopee_url, guard_warnings, status, created_at')
      .eq('assigned_worker_id', w)
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
    sb.from('worker_done')
      .select('id', { count: 'exact', head: true })
      .eq('worker_id', w)
      .eq('date', today),
  ]);

  if (listingsResult.error) {
    console.error('listings error:', listingsResult.error);
    return res.status(500).json({ error: 'listings-failed' });
  }

  if (countResult.error) console.error('count_today error:', countResult.error);
  return res.json({ ok: true, listings: listingsResult.data || [], count_today: countResult.error ? null : (countResult.count || 0) });
};
