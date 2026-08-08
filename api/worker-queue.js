/**
 * GET  /api/worker-queue?w=UUID&n=20
 *   Claims up to n items from the shared pool and returns them. Idempotent in
 *   the sense that matters: a worker who already holds a batch and calls again
 *   simply gets MORE — claim_work only ever hands out unheld rows.
 *
 * POST /api/worker-queue
 *   Body: { worker_id, queue_id, action: 'done' | 'reject', carousell_url?, reason? }
 *   Body: { worker_id, action: 'release' }   → give back everything still held
 *
 * Why this exists instead of extending /api/worker-listings: that endpoint
 * returns EVERY active row assigned to a worker with no limit. Measured against
 * a real backup, rows average 2,409 bytes, so a 12,626-item catalogue is a
 * 30 MB response every 10 seconds — past Vercel's ~4.5 MB serverless response
 * cap at roughly 1,800 rows. Claiming 20 at a time makes the payload ~50 KB.
 *
 * Never returns source_cost — VAs must not see margin data.
 */

const { sb, SERVICE_KEY, sgtToday } = require('../lib/sb');

const MAX_BATCH = 50;

async function getWorker(id) {
  const { data, error } = await sb
    .from('workers').select('id, active, daily_target, account_name').eq('id', id).single();
  if (error || !data) return { err: [404, 'worker-not-found'] };
  if (!data.active)   return { err: [403, 'worker-inactive'] };
  return { worker: data };
}

async function countToday(worker_id) {
  const { count, error } = await sb
    .from('worker_done')
    .select('id', { count: 'exact', head: true })
    .eq('worker_id', worker_id)
    .eq('date', sgtToday());
  if (error) { console.error('count_today error:', error); return null; }
  return count || 0;
}

module.exports = async function handler(req, res) {
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  // ── claim a batch ─────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const w = req.query.w;
    if (!w) return res.status(400).json({ error: 'w (worker UUID) required' });

    const n = Math.min(Math.max(parseInt(req.query.n, 10) || 20, 1), MAX_BATCH);
    const { worker, err } = await getWorker(w);
    if (err) return res.status(err[0]).json({ error: err[1] });

    const { data, error } = await sb.rpc('claim_work', { w, n });
    if (error) {
      console.error('claim_work error:', error);
      return res.status(500).json({ error: 'claim-failed' });
    }

    // RETURNING order is unspecified in Postgres — the right rows come back, but
    // shuffled. Sort here so the VA works the highest-prominence item first.
    const items = (data || [])
      .sort((a, b) => (b.times_listed - a.times_listed) || (a.id - b.id))
      .map(r => ({
        queue_id:      r.id,
        title:         r.title,
        price_sgd:     r.price_sgd,
        images:        r.images,
        times_listed:  r.times_listed,
        reference_url: r.carousell_url,
      }));

    // Pool depth for THIS worker's account. work_queue_stats spans every
    // account's pass, so with N accounts it reads N times what this VA can
    // actually be handed.
    const { count: pending } = await sb
      .from('work_queue')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending')
      .eq('account', worker.account_name);

    return res.json({
      ok:           true,
      items,
      count_today:  await countToday(w),
      daily_target: worker.daily_target,
      pending:      pending == null ? null : pending,
    });
  }

  // ── finish / reject / hand back ───────────────────────────────────────────
  if (req.method === 'POST') {
    const { worker_id, queue_id, action = 'done', carousell_url = null, reason = null } = req.body || {};
    if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

    const { err } = await getWorker(worker_id);
    if (err) return res.status(err[0]).json({ error: err[1] });

    if (action === 'release') {
      const { data, error } = await sb.rpc('release_work', { w: worker_id });
      if (error) {
        console.error('release_work error:', error);
        return res.status(500).json({ error: 'release-failed' });
      }
      return res.json({ ok: true, released: data || 0 });
    }

    if (!queue_id) return res.status(400).json({ error: 'queue_id required' });

    if (action === 'reject') {
      const { data, error } = await sb.rpc('reject_work', { w: worker_id, qid: queue_id, why: reason });
      if (error) {
        console.error('reject_work error:', error);
        return res.status(500).json({ error: 'reject-failed' });
      }
      if (!data) return res.status(409).json({ error: 'not-held-by-worker' });
      return res.json({ ok: true, rejected: true });
    }

    // action === 'done'
    if (carousell_url && !(/carousell\./i.test(carousell_url) && /\/p\/|\/sell\/|app\.link/i.test(carousell_url))) {
      return res.status(400).json({ error: 'invalid carousell_url — must be a listing link' });
    }

    // The lease can expire mid-batch, letting someone else claim the row. The
    // ownership check lives inside complete_work, so a false return means the
    // item is no longer this worker's — report it rather than double-count.
    const { data: ok, error } = await sb.rpc('complete_work', {
      w: worker_id, qid: queue_id, url: carousell_url,
    });
    if (error) {
      console.error('complete_work error:', error);
      return res.status(500).json({ error: 'complete-failed' });
    }
    if (!ok) return res.status(409).json({ error: 'not-held-by-worker' });

    const { data: row } = await sb
      .from('work_queue').select('title').eq('id', queue_id).single();

    const { error: doneErr } = await sb.from('worker_done').insert({
      worker_id,
      queue_id,
      listing_title: row ? row.title : '',
      date:          sgtToday(),
    });
    if (doneErr) console.error('worker_done insert error:', doneErr); // non-fatal

    return res.json({ ok: true, count_today: await countToday(worker_id) });
  }

  return res.status(405).json({ error: 'GET or POST only' });
};
