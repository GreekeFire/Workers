// Vercel Edge Function — scrapes Shopee product page HTML for og: meta tags
// Price extraction is not possible server-side (Shopee loads prices via JS/API with session cookies).
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

// Strip Shopee boilerplate from og:title and og:description
function cleanTitle(raw) {
  return raw
    .replace(/\s*\|\s*Shopee\s+Singapore\s*$/i, '')
    .replace(/\s*-\s*Shopee\s+Singapore\s*$/i, '')
    .trim();
}

function cleanDescription(raw) {
  // Strip trailing "- Buy <product name>" SEO tail that Shopee appends
  return raw.replace(/\s*-\s*Buy\s+.{0,120}$/, '').trim();
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
  if (!url.includes('shopee.sg') && !url.includes('sg.shp.ee')) return json({ error: 'Only shopee.sg or sg.shp.ee URLs are supported' }, 400);

  // Strip query params from full URLs only — short URLs (sg.shp.ee) need the path intact
  const cleanUrl = url.includes('sg.shp.ee') ? url : url.split('?')[0];

  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), 12000)
    );

    const fetchPage = fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-SG,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    const response = await Promise.race([fetchPage, timeout]);

    if (!response.ok) {
      return json({ error: `Page returned HTTP ${response.status}` }, 502);
    }

    const html = await response.text();

    const title       = cleanTitle(extractMeta(html, 'og:title'));
    const description = cleanDescription(extractMeta(html, 'og:description'));
    const images      = extractAllImages(html);

    if (!title && !description && images.length === 0) {
      return json({
        error: 'Could not extract product data — Shopee may have served a bot-challenge page',
      }, 502);
    }

    return json({ title, description, images });

  } catch (err) {
    return json({ error: err.message || 'Failed to fetch Shopee page' }, 502);
  }
}
