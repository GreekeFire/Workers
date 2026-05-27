// Vercel Edge Function — scrapes Shopee product page HTML for og: meta tags
// No auth needed; og: tags are embedded for SEO on every public listing.
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
  // Handles both property= and name= variants
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
  // og:image only gives one image; also look for Shopee CDN image hashes in the HTML
  const images = new Set();

  // og:image tags
  const ogRe = /<meta[^>]+(?:property)=["']og:image(?::\w+)?["'][^>]+content=["']([^"']+)["']/gi;
  let m;
  while ((m = ogRe.exec(html)) !== null) {
    if (m[1] && m[1].includes('shopee')) images.add(m[1].split('?')[0]);
  }

  // Shopee CDN hashes embedded in JSON/scripts: "cf.shopee.sg/file/HASH"
  const cdnRe = /https?:\/\/cf\.shopee\.sg\/file\/([a-f0-9]{32,})/gi;
  while ((m = cdnRe.exec(html)) !== null) {
    images.add(`https://cf.shopee.sg/file/${m[1]}`);
  }

  // Also try sg-live CDN
  const cdn2Re = /https?:\/\/down-[a-z]+\.img\.susercontent\.com\/file\/([a-z0-9_.-]+)/gi;
  while ((m = cdn2Re.exec(html)) !== null) {
    images.add(m[0].split('?')[0]);
  }

  return [...images].slice(0, 9);
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

  if (!url.includes('shopee.sg')) return json({ error: 'Only shopee.sg URLs are supported' }, 400);

  // Clean the URL — strip query params which can confuse Shopee's SSR
  const cleanUrl = url.split('?')[0];

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

    const title       = extractMeta(html, 'og:title');
    const description = extractMeta(html, 'og:description');
    const images      = extractAllImages(html);

    if (!title && !description && images.length === 0) {
      return json({
        error: 'Could not extract product data — Shopee may have served a bot-challenge page',
      }, 502);
    }

    // Try to extract price — strategies in order of reliability
    let price = null;

    // 1. JSON-LD structured data
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    if (ldMatch) {
      try {
        const ld = JSON.parse(ldMatch[1]);
        price = ld?.offers?.price ?? ld?.offers?.[0]?.price ?? null;
      } catch { /* ignore */ }
    }

    // 2. og:price:amount or product:price:amount meta tags
    if (price === null) {
      price = parseFloat(extractMeta(html, 'og:price:amount') || extractMeta(html, 'product:price:amount')) || null;
    }

    // 3. Shopee embeds price in script tags as raw JSON integers.
    // Prices are in units of 1/100000 SGD (e.g. 1990000 = $19.90).
    // Try price_min first (cheapest variant), then price.
    if (price === null) {
      for (const key of ['price_min', 'price']) {
        // Note: must use \\s and \\d inside new RegExp() string
        const m = html.match(new RegExp('"' + key + '"\\s*:\\s*(\\d{5,})'));
        if (m) {
          const raw = parseInt(m[1], 10);
          const candidate = raw / 100000;
          // Sanity check: reasonable SGD range $5–$2000 (below $5 is likely a fee/voucher field)
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
