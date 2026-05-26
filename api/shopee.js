// Vercel serverless function — proxies Shopee's internal API to avoid browser CORS
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter is required' });

  // Extract shopId + itemId
  const match = url.match(/i\.(\d+)\.(\d+)/);
  if (!match) {
    return res.status(400).json({
      error: 'Could not parse Shopee URL — expected format: shopee.sg/…-i.SHOPID.ITEMID'
    });
  }

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
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };

  // Try endpoints in order
  const endpoints = [
    `https://shopee.sg/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
    `https://shopee.sg/api/v4/pdp/get_pc?item_id=${itemId}&shop_id=${shopId}`,
    `https://shopee.sg/api/v2/item/get?itemid=${itemId}&shopid=${shopId}`,
  ];

  for (const apiUrl of endpoints) {
    let data;
    try {
      const response = await fetch(apiUrl, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      try { data = JSON.parse(text); } catch { continue; }
    } catch { continue; }

    // v4/item/get and v2 response
    const item = data?.data || data?.item;
    if (item && item.name) {
      const images = (item.images || [])
        .slice(0, 9)
        .map(hash => `https://cf.shopee.sg/file/${hash}`);
      return res.status(200).json({
        title:       item.name        || '',
        description: item.description || '',
        images,
        price:    item.price     ? item.price     / 100000 : null,
        priceMax: item.price_max ? item.price_max / 100000 : null,
        _source: apiUrl,
      });
    }

    // v4/pdp/get_pc response shape
    if (data?.data?.pdp_info) {
      const pdp  = data.data.pdp_info;
      const name = pdp.title || pdp.name || '';
      const desc = pdp.description || '';
      const imgs = (pdp.images || []).slice(0, 9).map(h => `https://cf.shopee.sg/file/${h}`);
      if (name) {
        return res.status(200).json({
          title: name, description: desc, images: imgs, _source: apiUrl,
        });
      }
    }

    // Log what Shopee actually returned (visible in Vercel function logs)
    console.log(`[shopee] ${apiUrl} → error=${data?.error} hasData=${!!data?.data}`);
  }

  return res.status(502).json({
    error: 'Shopee returned no product data — the listing may be unavailable or region-blocked',
    shopId,
    itemId,
  });
};
