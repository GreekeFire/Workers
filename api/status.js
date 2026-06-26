/**
 * GET /api/status
 *
 * Returns row counts for all tables so you can confirm the DB is intact.
 * Uses SERVICE_ROLE_KEY — never call this from client-side code.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const tables = ['listings', 'workers', 'worker_done', 'scrape_inbox'];
  const counts = {};
  const errors = {};

  await Promise.all(tables.map(async (t) => {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    if (error) errors[t] = error.message;
    else counts[t] = count;
  }));

  const ok = Object.keys(errors).length === 0;
  return res.status(ok ? 200 : 500).json({ ok, counts, errors });
};
