// Shopee internal API — uses session cookies stored in SHOPEE_COOKIES env var.
// Extracts shopid + itemid from URL, hits Shopee's product JSON endpoint.
export const config = { runtime: 'edge', regions: ['sin1'] };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function extractIds(url) {
  const m = url.match(/i\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { shopid: m[1], itemid: m[2] };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) return json({ error: 'url parameter required' }, 400);

  const cookieStr = process.env.SHOPEE_COOKIES || '';
  const hasCookies = cookieStr.length > 0;

  // Resolve short URLs first
  let resolvedUrl = url;
  if (url.includes('sg.shp.ee')) {
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'manual' });
      const loc = r.headers.get('location');
      if (loc && loc.includes('shopee.sg')) resolvedUrl = loc;
    } catch (e) {}
  }

  const ids = extractIds(resolvedUrl);
  if (!ids) return json({ error: 'Could not extract shopid/itemid from URL — must be a full shopee.sg product URL' }, 400);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Referer': `https://shopee.sg/product/${ids.shopid}/${ids.itemid}`,
    'Accept': 'application/json',
    'Accept-Language': 'en-SG,en;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (hasCookies) headers['Cookie'] = cookieStr;

  const endpoints = [
    `https://shopee.sg/api/v4/item/get?itemid=${ids.itemid}&shopid=${ids.shopid}`,
    `https://shopee.sg/api/v2/item/get?itemid=${ids.itemid}&shopid=${ids.shopid}`,
  ];

  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out')), 12000));
    let raw = null;

    for (const apiUrl of endpoints) {
      const resp = await Promise.race([fetch(apiUrl, { headers }), timeout]);
      raw = await resp.json();
      if (raw?.data) break;
    }

    const item = raw?.data;
    if (!item) return json({
      error: `API blocked (error ${raw?.error ?? 'unknown'})${!hasCookies ? ' — SHOPEE_COOKIES not set' : ' — cookies may have expired'}`,
      hasCookies,
      raw,
      ...ids,
    }, 502);

    const priceMin = item.price_min != null ? (item.price_min / 100000).toFixed(2) : null;
    const priceMax = item.price_max != null ? (item.price_max / 100000).toFixed(2) : null;
    const images   = (item.images || []).map(h => `https://cf.shopee.sg/file/${h}`).slice(0, 9);

    return json({
      ...ids,
      hasCookies,
      title: item.name || '',
      description: item.description || '',
      priceMin,
      priceMax,
      stock: item.stock ?? null,
      rating: item.item_rating?.rating_star?.toFixed(1) ?? null,
      sold: item.historical_sold ?? null,
      images,
      raw,
    });

  } catch (err) {
    return json({ error: err.message || 'Request failed', hasCookies, ...ids }, 502);
  }
}
