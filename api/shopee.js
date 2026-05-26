// Vercel Edge Function — runs at the nearest PoP to the user (Singapore for SG users)
// This avoids Shopee blocking requests from Vercel's default US region.
export const config = { runtime: 'edge' };

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
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
  }

  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) return json({ error: 'url parameter is required' }, 400);

  const match = url.match(/i\.(\d+)\.(\d+)/);
  if (!match) return json({ error: 'Could not parse Shopee URL — expected: shopee.sg/…-i.SHOPID.ITEMID' }, 400);

  const shopId = match[1];
  const itemId = match[2];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    'Referer': `https://shopee.sg/i.${shopId}.${itemId}`,
    'Origin': 'https://shopee.sg',
    'Accept': 'application/json',
    'Accept-Language': 'en-SG,en;q=0.9',
    'x-api-source': 'rn',
    'x-shopee-language': 'en',
  };

  const endpoints = [
    `https://shopee.sg/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
    `https://shopee.sg/api/v4/pdp/get_pc?item_id=${itemId}&shop_id=${shopId}`,
    `https://shopee.sg/api/v2/item/get?itemid=${itemId}&shopid=${shopId}`,
  ];

  for (const apiUrl of endpoints) {
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000)
      );
      const response = await Promise.race([fetch(apiUrl, { headers }), timeout]);
      const data = await response.json();

      // v4/item/get and v2 shape
      const item = data?.data || data?.item;
      if (item?.name) {
        const images = (item.images || [])
          .slice(0, 9)
          .map(hash => `https://cf.shopee.sg/file/${hash}`);
        return json({
          title:       item.name        || '',
          description: item.description || '',
          images,
          price:    item.price     ? item.price     / 100000 : null,
          priceMax: item.price_max ? item.price_max / 100000 : null,
        });
      }

      // v4/pdp/get_pc shape
      const pdp = data?.data?.pdp_info;
      if (pdp?.title || pdp?.name) {
        return json({
          title:       pdp.title || pdp.name || '',
          description: pdp.description || '',
          images:      (pdp.images || []).slice(0, 9).map(h => `https://cf.shopee.sg/file/${h}`),
        });
      }
    } catch {
      continue;
    }
  }

  return json({
    error: 'Shopee returned no product data — listing may be private or unavailable',
    shopId,
    itemId,
  }, 502);
}
