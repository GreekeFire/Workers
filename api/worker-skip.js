/**
 * POST /api/worker-skip
 *
 * Body: { worker_id: UUID, listing_id?: number }
 * No DB change — queue advancement is client-side.
 */

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { listing_id } = req.body || {};
  return res.json({ ok: true, skipped: listing_id || null });
};
