// Vercel Edge Function — scrapes Shopee product page for og: meta tags + price
// Price is fetched from Shopee's own JSON API (/api/v4/item/get) in parallel
// with the HTML fetch, using shopId/itemId extracted from the URL.
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

function extractMeta(html, property) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );
  return (html.match(re) || html.match(re2) || [])[1] || '';
}

function extractAllImages(html) {
  const images = new Set();

  const ogRe = /<meta[^>]+(?:property)=["']og:image(?::\w+)?["'][^>]+content=["']([^"']+)["']/gi;
  let m;
  while ((m = ogRe.exec(html)) !== null) {
    if (m[1] && m[1].includes('shopee')) images.add(m[1].split('?')[0]);
  }

  const cdnRe = /https?:\/\/cf\.shopee\.sg\/file\/([a-f0-9]{32,})/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    images.add(`https://cf.shopee.sg/file/${m[1]}`);
  }

  const cdn2Re = /https?:\/\/down-[a-z]+\.img\.susercontent\.com\/file\/([a-z0-9_.-]+)/gi;
  while ((m = cdn2Re.exec(html)) !== null) {
    images.add(m[0].split('?')[0]);
  }

  return [...images].slice(0, 9);
}

// Extract shopId + itemId from Shopee URL patterns:
//   shopee.sg/product/{shopId}/{itemId}
//   shopee.sg/{slug}.i.{shopId}.{itemId}
function extractIds(url) {
  const m = url.match(/\/product\/(\d+)\/(\d+)/) || url.match(/\.i\.(\d+)\.(\d+)/);
  return m ? { shopId: m[1], itemId: m[2] } : null;
}

const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

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
  if (!url.includes('shopee.sg')) return json({ error: 'Only shopee.sg URLs are supported' }, 400);

  const cleanUrl = url.split('?')[0];
  const ids = extractIds(cleanUrl);

  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), 12000)
    );

    // Fire HTML fetch and JSON API fetch in parallel
    const fetchPage = fetch(cleanUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-SG,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    // Shopee's own item API — returns price_min/price in 1/100000 SGD units
    const fetchApi = ids
      ? fetch(
          `https://shopee.sg/api/v4/item/get?itemid=${ids.itemId}&shopid=${ids.shopId}`,
          {
            headers: {
              'User-Agent': BROWSER_UA,
              'Referer': 'https://shopee.sg/',
              'Accept': 'application/json',
              'Accept-Language': 'en-SG,en;q=0.9',
              'X-Shopee-Language': 'en',
            },
          }
        )
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null);

    const [response, apiData] = await Promise.all([
      Promise.race([fetchPage, timeout]),
      fetchApi,
    ]);

    if (!response.ok) {
      return json({ error: `Page returned HTTP ${response.status}` }, 502);
    }

    const html = await response.text();

    const title       = extractMeta(html, 'og:title');
    const description = extractMeta(html, 'og:description');
    const images      = extractAllImages(html);

    if (!title && !description && images.length === 0) {
      return json({
        error: 'Could not extract product data — Shopee may have served a bot-challenge page',
      }, 502);
    }

    let price = null;

    // Strategy 1: Shopee JSON API — most reliable, actual DB price
    if (apiData?.data) {
      const raw = apiData.data.price_min ?? apiData.data.price ?? null;
      if (raw !== null) {
        const candidate = raw / 100000;
        if (candidate >= 1 && candidate <= 2000) {
          price = Math.round(candidate * 100) / 100;
        }
      }
    }

    // Strategy 2: JSON-LD structured data
    if (price === null) {
      const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
      if (ldMatch) {
        try {
          const ld = JSON.parse(ldMatch[1]);
          price = ld?.offers?.price ?? ld?.offers?.[0]?.price ?? null;
        } catch { /* ignore */ }
      }
    }

    // Strategy 3: og:price:amount / product:price:amount meta tags
    if (price === null) {
      price = parseFloat(extractMeta(html, 'og:price:amount') || extractMeta(html, 'product:price:amount')) || null;
    }

    // Strategy 4: embedded script JSON (price_min / price as raw 1/100000 integers)
    if (price === null) {
      for (const key of ['price_min', 'price']) {
        const m = html.match(new RegExp('"' + key + '"\\s*:\\s*(\\d{5,})'));
        if (m) {
          const candidate = parseInt(m[1], 10) / 100000;
          if (candidate >= 5 && candidate <= 2000) {
            price = Math.round(candidate * 100) / 100;
            break;
          }
        }
      }
    }

    return json({ title, description, images, price });

  } catch (err) {
    return json({ error: err.message || 'Failed to fetch Shopee page' }, 502);
  }
}
