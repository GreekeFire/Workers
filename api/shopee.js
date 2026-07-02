// Vercel Edge Function — tries Shopee's v4 item/get JSON API first (gives price),
// falls back to scraping the page HTML for og: meta tags when Cloudflare blocks us.
export const config = { runtime: 'edge', regions: ['sin1'] };

import { json } from '../lib/edge-json.js';

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

  // Match both legacy 32-char hex filenames and modern sg-NNNNN-* style filenames
  const cdnRe = /https?:\/\/cf\.shopee\.sg\/file\/([^\s"'<>?#&]+)/gi;
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

// Fallback: extract product name + description from JSON-LD structured data
// Shopee embeds this even when SSR og: tags are absent
function extractJsonLD(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' && item.name) {
          return { name: item.name || '', description: item.description || '' };
        }
      }
    } catch (e) { /* skip malformed blocks */ }
  }
  return { name: '', description: '' };
}

// Attempt Shopee's internal v4 JSON API. Usually Cloudflare-blocked from
// datacenter IPs, but free to try — returns price/sold/stock when it works.
async function tryV4(cleanUrl) {
  const m = cleanUrl.match(/i\.(\d+)\.(\d+)/) || cleanUrl.match(/\/product\/(\d+)\/(\d+)/);
  if (!m) return null;
  const [, shopid, itemid] = m;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 6000);
  try {
    const resp = await fetch(`https://shopee.sg/api/v4/item/get?itemid=${itemid}&shopid=${shopid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-SG,en;q=0.9',
        'Referer': 'https://shopee.sg/',
        'x-api-source': 'pc',
        'x-requested-with': 'XMLHttpRequest',
        'x-shopee-language': 'en',
      },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    const data = await resp.json();
    const item = data.item || data.data?.item || data.data;
    if (!item || !item.name) return null;
    return {
      title: item.name,
      description: item.description || '',
      images: (item.images || []).slice(0, 9).map(h => `https://down-sg.img.susercontent.com/file/${h}`),
      price: (item.price_min || item.price || 0) / 100000,
      price_max: (item.price_max || item.price || 0) / 100000,
      sold: item.historical_sold || item.sold || 0,
      stock: item.stock || 0,
      source: 'v4',
    };
  } catch (e) {
    return null;
  }
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
  let cleanUrl = url.includes('sg.shp.ee') ? url : url.split('?')[0];

  // Resolve sg.shp.ee short URLs to full shopee.sg product URL first
  if (url.includes('sg.shp.ee')) {
    try {
      const redir = await fetch(cleanUrl, { method: 'GET', redirect: 'manual' });
      const location = redir.headers.get('location');
      if (location && location.includes('shopee.sg')) {
        cleanUrl = location.split('?')[0];
      }
    } catch (e) { /* fall through with original URL */ }
  }

  // resolve=1 → just return the expanded URL (bookmarklet uses this for
  // sg.shp.ee short links, which the browser can't follow cross-origin)
  if (searchParams.get('resolve')) {
    return json({ url: cleanUrl });
  }

  // First try the v4 JSON API — gives price; silently falls back if blocked
  const v4 = await tryV4(cleanUrl);
  if (v4) return json(v4);

  const pageCtrl = new AbortController();
  const pageTo = setTimeout(() => pageCtrl.abort(), 12000);
  try {
    const response = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-SG,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: pageCtrl.signal,
    });
    clearTimeout(pageTo);

    if (!response.ok) {
      return json({ error: `Page returned HTTP ${response.status}` }, 502);
    }

    const html = await response.text();

    let title       = cleanTitle(extractMeta(html, 'og:title'));
    let description = cleanDescription(extractMeta(html, 'og:description'));
    const images    = extractAllImages(html);

    // If og: tags returned the Shopee homepage title or nothing, fall back to JSON-LD
    const isHomepage = !title || /^Shopee Singapore\b/i.test(title);
    if (isHomepage || !description) {
      const ld = extractJsonLD(html);
      if (ld.name)        title       = ld.name;
      if (ld.description) description = ld.description;
    }

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
