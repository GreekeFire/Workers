/**
 * content.js — Wormhole Scraper
 * Injected into Shopee pages. Makes same-origin API calls and
 * extracts product data. Responds to messages from background.js.
 */

// ── Shopee API helpers (same-origin → no CORS, cookies included) ──────────────

async function apiGet(path) {
  const resp = await fetch('https://shopee.sg' + path, {
    credentials: 'include',
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      'x-api-source': 'pc',
      'Referer': 'https://shopee.sg/',
    },
  });
  if (!resp.ok) throw new Error(`API ${path} → HTTP ${resp.status}`);
  return resp.json();
}

// ── Search for products ───────────────────────────────────────────────────────

async function searchItems(keyword, limit = 10) {
  const q = encodeURIComponent(keyword);
  const data = await apiGet(
    `/api/v4/search/search_items?by=relevancy&keyword=${q}&limit=${limit}&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`
  );
  // API returns items under different keys across versions
  const raw = data.items || data.data?.items || [];
  return raw.map(r => r.item_basic || r).filter(Boolean);
}

// ── Get full product detail ───────────────────────────────────────────────────

async function getItemDetail(itemid, shopid) {
  try {
    // Try v4 first
    const d = await apiGet(`/api/v4/item/get?itemid=${itemid}&shopid=${shopid}`);
    return d.item || d.data?.item || d.data || null;
  } catch (_) {
    // Fallback — some listings use pdp endpoint
    const d = await apiGet(`/api/v4/pdp/get_pdp_info?item_id=${itemid}&shop_id=${shopid}`);
    return d.data?.item || d.item || null;
  }
}

// ── Get shop info ─────────────────────────────────────────────────────────────

async function getShopInfo(shopid) {
  try {
    const d = await apiGet(`/api/v4/product/get_shop_info?shopid=${shopid}`);
    return d.data || d;
  } catch (_) { return null; }
}

// ── Parse raw item → clean product object ────────────────────────────────────

function parseProduct(raw) {
  if (!raw) return null;
  const price = raw.price || raw.price_min || 0;
  const priceMax = raw.price_max || price;

  // Build slug from name
  const slug = (raw.name || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

  return {
    itemid: raw.itemid,
    shopid: raw.shopid,
    slug,
    name: raw.name || '',
    description: raw.description || '',
    price_min_sgd: (price / 100000).toFixed(2),       // Shopee stores in 100-thousandths
    price_max_sgd: (priceMax / 100000).toFixed(2),
    currency: 'SGD',
    images: (raw.images || []).filter(h => h && h.length > 5),
    sold: raw.sold || raw.historical_sold || 0,
    stock: raw.stock || 0,
    rating: raw.item_rating?.rating_star || raw.rating_star || 0,
    rating_count: raw.item_rating?.rating_count?.[0] || raw.rating_count || 0,
    liked_count: raw.liked_count || 0,
    shop_name: raw.shop_name || raw.shopee_verified?.shop_name || '',
    attributes: (raw.attributes || []).map(a => ({ name: a.name, value: a.value })),
    categories: (raw.categories || []).map(c => c.display_name || c.name).filter(Boolean),
    url: `https://shopee.sg/product/${raw.shopid}/${raw.itemid}`,
    scraped_at: new Date().toISOString(),
  };
}

// ── Scroll helper (trigger lazy images before screenshot) ─────────────────────

async function smoothScroll(px = 3000) {
  for (let y = 0; y < px; y += 300) {
    window.scrollBy(0, 300);
    await new Promise(r => setTimeout(r, 80));
  }
  await new Promise(r => setTimeout(r, 400));
  window.scrollTo(0, 0);
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {

  // SEARCH — returns array of basic item objects
  if (msg.action === 'SEARCH') {
    searchItems(msg.keyword, msg.limit || 10)
      .then(items => reply({ ok: true, items }))
      .catch(e => reply({ ok: false, error: e.message }));
    return true;
  }

  // GET_PRODUCT — full detail for one item
  if (msg.action === 'GET_PRODUCT') {
    getItemDetail(msg.itemid, msg.shopid)
      .then(raw => reply({ ok: true, product: parseProduct(raw) }))
      .catch(e => reply({ ok: false, error: e.message }));
    return true;
  }

  // SEARCH_AND_SCRAPE — search then get full detail for each result
  if (msg.action === 'SEARCH_AND_SCRAPE') {
    (async () => {
      try {
        const basics = await searchItems(msg.keyword, msg.limit || 8);
        const products = [];
        for (const b of basics) {
          try {
            const detail = await getItemDetail(b.itemid, b.shopid);
            const p = parseProduct(detail || b);
            if (p) products.push(p);
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
          } catch (_) {
            const p = parseProduct(b);
            if (p) products.push(p);
          }
        }
        reply({ ok: true, products, keyword: msg.keyword });
      } catch (e) {
        reply({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // SCROLL — for lazy-load triggering before screenshot
  if (msg.action === 'SCROLL') {
    smoothScroll(msg.px || 4000)
      .then(() => reply({ ok: true }))
      .catch(e => reply({ ok: false, error: e.message }));
    return true;
  }

  // GET_TRENDING — fetch Shopee SG hot search keywords
  if (msg.action === 'GET_TRENDING') {
    (async () => {
      const endpoints = [
        '/api/v4/search/get_hot_search_list?limit=30',
        '/api/v4/trending/get_keywords?limit=30',
      ];
      for (const path of endpoints) {
        try {
          const data = await apiGet(path);
          const items = (
            data?.data?.keywords ||
            data?.data?.search_keywords ||
            data?.keywords ||
            (Array.isArray(data?.data) ? data.data : null) ||
            []
          );
          if (!Array.isArray(items) || !items.length) continue;
          const keywords = items.slice(0, 30).map(item =>
            typeof item === 'string' ? item :
            (item.keyword || item.name || item.query || '')
          ).map(k => k.trim()).filter(k => k.length > 1);
          if (keywords.length) { reply({ ok: true, keywords }); return; }
        } catch (_) {}
      }
      reply({ ok: false, error: 'Shopee trending unavailable — may need login' });
    })();
    return true;
  }

  // PING
  if (msg.action === 'PING') {
    reply({ ok: true, url: location.href });
    return true;
  }
});

console.log('[Wormhole] content ready @', location.href);
