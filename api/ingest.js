// Vercel Edge Function — receives a RAW Shopee v4 item/get JSON body that the
// phone already fetched (with the user's cookies, from a residential IP), then
// reshapes it into the standard scrape_inbox payload and inserts it. This keeps
// the iOS/Android Shortcut dumb: it only has to GET the v4 JSON and POST it here.
//
// Usage from the Shortcut:
//   POST https://workers-v1.vercel.app/api/ingest?url=<product url>
//   body: the raw response text from shopee.sg/api/v4/item/get
export const config = { runtime: 'edge', regions: ['sin1'] };

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
    });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url') || '';

  let raw;
  try {
    raw = await req.text();
    if (!raw) throw new Error('empty body');
  } catch (e) {
    return json({ error: 'no body — POST the raw Shopee v4 JSON' }, 400);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return json({ error: 'body is not JSON — Shopee likely served a bot/login page' }, 422);
  }

  const it = data.item || (data.data && (data.data.item || data.data));
  if (!it || !it.name) {
    // is_login:false / error code means the cookie was missing or expired
    return json({ error: 'Shopee returned no item — cookies missing/expired, re-copy them', shopee_error: data.error ?? null }, 422);
  }

  // Extract guard-relevant fields from the v4 response so worker-scrape.js
  // can apply category / location / rating guards on items ingested via the
  // iOS Shortcut (same fields the bookmarklet sets on sc.js fetch path).
  let categories;
  if (Array.isArray(it.categories) && it.categories.length) {
    categories = it.categories.map(c => c.display_name || c.name || String(c.catid || ''));
  } else if (Array.isArray(it.fe_categories) && it.fe_categories.length) {
    categories = it.fe_categories.map(c => c.display_name || c.name || String(c.catid || ''));
  }
  const shop_location = it.shop_location || null;
  const rating_star = (it.item_rating && it.item_rating.rating_star != null)
    ? it.item_rating.rating_star : null;

  const payload = {
    title: it.name,
    description: it.description || '',
    price_min: (it.price_min || it.price || 0) / 1e5,
    price_max: (it.price_max || it.price || 0) / 1e5,
    models: (it.models || []).map(x => ({ name: x.name, price: (x.price || 0) / 1e5 })).filter(x => x.price > 0),
    images: (it.images || []).map(h => `https://down-sg.img.susercontent.com/file/${h}`),
    sold: it.historical_sold || it.sold || 0,
    stock: it.stock || 0,
    url: url.split('?')[0] || '',
    ...(categories      ? { categories }                : {}),
    ...(shop_location   ? { shop_location }             : {}),
    ...(rating_star !== null && rating_star !== undefined ? { rating_star } : {}),
  };

  try {
    const s = await fetch(`${SUPABASE_URL}/rest/v1/scrape_inbox`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ kind: 'shopee', payload }),
    });
    if (!s.ok) return json({ error: `Supabase ${s.status}` }, 502);
  } catch (e) {
    return json({ error: 'Supabase insert failed: ' + (e.message || 'unknown') }, 502);
  }

  const price = Math.max(payload.price_max, payload.price_min, 0, ...payload.models.map(m => m.price));
  return json({ ok: true, title: payload.title, price, images: payload.images.length });
}
