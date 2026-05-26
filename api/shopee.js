// Vercel serverless function — proxies Shopee's internal API to avoid browser CORS
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter is required' });

  // Extract shopId + itemId from URL
  // Handles: shopee.sg/Product-Name-i.SHOPID.ITEMID
  //          shopee.sg/shop/Product-Name-i.SHOPID.ITEMID
  const match = url.match(/i\.(\d+)\.(\d+)/);
  if (!match) {
    return res.status(400).json({
      error: 'Could not parse Shopee URL — expected format: shopee.sg/…-i.SHOPID.ITEMID'
    });
  }

  const shopId = match[1];
  const itemId = match[2];

  try {
    const apiUrl = `https://shopee.sg/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'Referer': 'https://shopee.sg/',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-SG,en-US;q=0.9,en;q=0.8',
        'x-api-source': 'rn',
      },
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();

    if (!data || !data.data) {
      return res.status(404).json({ error: 'Product not found or listing unavailable' });
    }

    const item = data.data;

    // Shopee image hashes → full CDN URLs (try both CDNs)
    const images = (item.images || [])
      .slice(0, 9)
      .map(hash => `https://cf.shopee.sg/file/${hash}`);

    // Price: Shopee stores as integer (price / 100000 = SGD)
    const price    = item.price     ? (item.price     / 100000) : null;
    const priceMax = item.price_max ? (item.price_max / 100000) : null;

    return res.status(200).json({
      title:       item.name        || '',
      description: item.description || '',
      images,
      price,
      priceMax,
    });
  } catch (err) {
    const msg = err.name === 'TimeoutError'
      ? 'Request timed out — Shopee did not respond'
      : (err.message || 'Unknown error');
    return res.status(502).json({ error: msg });
  }
};
