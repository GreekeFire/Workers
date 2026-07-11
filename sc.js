/* Steadymart Shopee scraper — hosted loader target (sc.js).
 * Loaded by a tiny bookmarklet on every device:
 *   javascript:fetch('https://workers-v1.vercel.app/sc.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load '+e))
 *
 * VA bookmarklet (UUID hardcoded per worker):
 *   javascript:window.__swWorker='WORKER-UUID-HERE';fetch('https://workers-v1.vercel.app/sc.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load '+e))
 *
 * On a product page it FIRST reads the full item (title, description, images,
 * exact variant prices) out of window.dataLayer — which Shopee already
 * populated via its own signed request, so there's no fetch of ours and no
 * bot puzzle. Falls back to the v4 fetch if dataLayer isn't populated yet, and
 * always uses fetch for paste-box links (dataLayer only holds the page you're on).
 *
 * Toast is tagged ·page (read from memory, puzzle-free) or ·api (fetched).
 * Edit here and every device picks it up on next click — no re-pasting bookmarks.
 *
 * worker_id = null  → owner scrape (existing behaviour, zero regression)
 * worker_id = UUID  → VA scrape: /api/worker-scrape runs guards + AI gen
 */
(async () => {
  const K = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';
  const INBOX = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox';
  const CDN = 'https://down-sg.img.susercontent.com/file/';

  // Read worker UUID injected by the VA's personalised bookmarklet, or null for owner.
  const wid = window.__swWorker || null;

  // Best-effort enrichment from v4 pdp/get_pc — the only endpoint with
  // per-variant availability (has_stock) and shipping EDT; neither the
  // dataLayer nor v4 item/get carries them. Runs same-origin with the VA's
  // cookies. Any failure → payload posts unenriched (old behaviour).
  const enrich = async (p) => {
    try {
      const m = (p.url || '').match(/i\.(\d+)\.(\d+)/) || (p.url || '').match(/\/product\/(\d+)\/(\d+)/);
      if (!m) return p;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      let d;
      try {
        const r = await fetch('https://shopee.sg/api/v4/pdp/get_pc?item_id=' + m[2] + '&shop_id=' + m[1], {
          credentials: 'include',
          headers: { accept: 'application/json' },
          signal: ctrl.signal,
        });
        d = (await r.json()).data;
      } finally { clearTimeout(to); }
      if (!d || !d.item) return p;

      // Drop variants the source can no longer supply (only when explicitly flagged)
      const oos = new Set((d.item.models || []).filter(x => x && x.has_stock === false).map(x => x.name));
      if (oos.size && Array.isArray(p.models)) p.models = p.models.filter(x => !oos.has(x.name));

      // Shipping EDT (days) + origin — server turns this into the delivery promise
      const infos = (((d.product_shipping || {}).ungrouped_channel_infos) || [])
        .map(c => c && c.channel_delivery_info)
        .filter(i => i && i.estimated_delivery_time_max > 0);
      const ch = infos.find(i => i.is_fastest_edt_channel) || infos[0];
      if (ch) { p.edt_min = ch.estimated_delivery_time_min; p.edt_max = ch.estimated_delivery_time_max; }
      const from = ((d.product_shipping || {}).shipping_fee_info || {}).ship_from_location;
      if (from) p.ship_from = from;
    } catch (e) { /* enrichment is optional */ }
    return p;
  };

  const post = async (p) => {
    if (!p.unloaded) p = await enrich(p);
    const body = { kind: 'shopee', payload: p };
    // Include worker_id at top level on the scrape_inbox row so
    // /api/worker-scrape can find it without parsing the payload JSON.
    if (wid) body.worker_id = wid;

    const s = await fetch(INBOX, {
      method: 'POST',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    if (!s.ok) throw new Error('Supabase ' + s.status);
    return p;
  };

  const mapImg = (h) => (/^https?:/.test(h) ? h.split('?')[0] : CDN + h);

  // Read the full item for `itemid` out of window.dataLayer. Shopee pushes
  // several copies (some with prices nulled for analytics); we collect every
  // matching copy and merge — prices from the priced copy, description/images
  // from whichever copy has them. Returns null if no priced copy is present.
  //
  // NOTE: categories, shop_location, rating_star are marked TEST LATER — the
  // dataLayer schema varies. If a field isn't present we leave it undefined
  // so the server skips that guard (no false blocks). See VA-PLAN §guards.
  const fromDataLayer = (itemid) => {
    const dl = window.dataLayer;
    if (!Array.isArray(dl)) return null;
    const copies = [];
    const seen = new Set();
    const scan = (o, d) => {
      if (!o || typeof o !== 'object' || d > 10 || seen.has(o)) return;
      seen.add(o);
      try {
        if (String(o.itemid || o.item_id || '') === String(itemid) && Array.isArray(o.models)) copies.push(o);
      } catch (e) { /* cross-origin */ }
      let ks; try { ks = Object.keys(o); } catch (e) { return; }
      for (const k of ks) {
        if (['window', 'self', 'top', 'parent', 'frames', 'document'].includes(k)) continue;
        let v; try { v = o[k]; } catch (e) { continue; }
        if (v && typeof v === 'object') scan(v, d + 1);
      }
    };
    for (const e of dl) scan(e, 0);
    if (!copies.length) return null;

    const priced = copies.find(c => c.models.some(m => m && m.price != null));
    if (!priced) return null; // prices nulled everywhere → let caller fetch
    const withDesc = copies.find(c => c.description || c.rich_text_description) || priced;
    const withImgs = copies.find(c => Array.isArray(c.images) && c.images.length) || priced;

    const models = priced.models
      .filter(m => m && m.price != null)
      .map(m => ({ name: m.name, price: m.price / 1e5 }));
    const prices = models.map(m => m.price);

    // TEST LATER: confirm these field names exist in the dataLayer shape.
    // If absent, the keys are simply not included — server skips those guards.
    const extra = {};
    const cats = priced.categories || priced.breadcrumb || priced.category_list;
    if (Array.isArray(cats) && cats.length) {
      extra.categories = cats.map(c => (typeof c === 'string' ? c : c.name || c.display_name || String(c)));
    }
    // shop_location from dataLayer is unreliable (returns undefined or wrong value
    // for SG-shipping products) — only trust it from the v4 API fetch path.
    const rat = (priced.item_rating && priced.item_rating.rating_star) != null
      ? priced.item_rating.rating_star
      : priced.rating_star != null ? priced.rating_star : priced.shop_rating;
    if (rat != null) extra.rating_star = Number(rat);

    return {
      title: priced.name || priced.title || withDesc.name || '',
      description: withDesc.description || withDesc.rich_text_description || '',
      price_min: priced.price_min != null ? priced.price_min / 1e5 : Math.min(...prices),
      price_max: priced.price_max != null ? priced.price_max / 1e5 : Math.max(...prices),
      models,
      images: (withImgs.images || []).map(mapImg),
      sold: priced.historical_sold || priced.global_sold || 0,
      stock: priced.stock || 0,
      url: location.href.split('?')[0],
      worker_id: wid,
      ...extra,
    };
  };

  // Fetch path (v4 API) — used for paste-box links and as fallback.
  // This path definitively has categories, shop_location, rating_star.
  const fetchItem = async (L) => {
    if (/shp\.ee/.test(L)) {
      try {
        const rr = await fetch('https://workers-v1.vercel.app/api/shopee?url=' + encodeURIComponent(L) + '&resolve=1');
        L = (await rr.json()).url || L;
      } catch (e) { /* keep original */ }
    }
    const m = L.match(/i\.(\d+)\.(\d+)/) || L.match(/\/product\/(\d+)\/(\d+)/);
    if (!m) throw new Error('not a product link');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    let r;
    try {
      r = await fetch('https://shopee.sg/api/v4/item/get?itemid=' + m[2] + '&shopid=' + m[1], {
        credentials: 'include',
        headers: { 'x-api-source': 'pc', 'x-requested-with': 'XMLHttpRequest' },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(to);
    }
    const d = await r.json();
    const it = d.item || (d.data && (d.data.item || d.data));
    if (!it || !it.name) throw new Error('Shopee returned no item — solve the bot check, retry');

    // Extract categories: v4 returns categories[] array of objects with display_name
    let categories;
    if (Array.isArray(it.categories) && it.categories.length) {
      categories = it.categories.map(c => c.display_name || c.name || String(c.catid || ''));
    } else if (Array.isArray(it.fe_categories) && it.fe_categories.length) {
      categories = it.fe_categories.map(c => c.display_name || c.name || String(c.catid || ''));
    }

    const shop_location = it.shop_location || null;
    const rating_star = (it.item_rating && it.item_rating.rating_star != null)
      ? it.item_rating.rating_star : null;

    return {
      title: it.name,
      description: it.description || '',
      price_min: (it.price_min || it.price || 0) / 1e5,
      price_max: (it.price_max || it.price || 0) / 1e5,
      models: (it.models || []).map(x => ({ name: x.name, price: (x.price || 0) / 1e5 })).filter(x => x.price > 0),
      images: (it.images || []).map(mapImg),
      sold: it.historical_sold || it.sold || 0,
      stock: it.stock || 0,
      url: L.split('?')[0],
      worker_id: wid,
      ...(categories ? { categories } : {}),
      ...(shop_location != null ? { shop_location } : {}),
      ...(rating_star != null ? { rating_star } : {}),
    };
  };

  // Send a paste-box link (always fetch)
  const send = async (L) => post(await fetchItem(L));

  const note = (msg, bad, small, amber) => {
    try { window.dispatchEvent(new CustomEvent('sw:result', { detail: { ok: !bad, msg } })); } catch (e) {}
    const t = document.createElement('div');
    t.textContent = msg;
    const bg = bad ? '#dc2626' : amber ? '#b45309' : (small ? '#15803d' : '#16a34a');
    t.style.cssText = small
      ? 'position:fixed;top:14px;right:14px;z-index:999999;background:' + bg +
        ';color:#fff;padding:6px 12px;border-radius:6px;font:600 12px system-ui;opacity:.92;box-shadow:0 2px 8px rgba(0,0,0,.3)'
      : 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999999;background:' +
        bg + ';color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), small ? 2200 : 3500);
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const cur = /i\.\d+\.\d+|\/product\/\d+\/\d+/.test(location.href) ? location.href.split('?')[0] : '';
  if (cur) {
    const itemid = ((cur.match(/i\.\d+\.(\d+)/) || cur.match(/\/product\/\d+\/(\d+)/)) || [])[1];
    const AUTO = !!window.__swAuto;

    if (AUTO) {
      if (localStorage.getItem('sw_auto') !== '1') return;
      const dkey = 'sw_sent_' + itemid;
      if (sessionStorage.getItem(dkey)) return;
      sessionStorage.setItem(dkey, '1');
      try {
        let dl = null;
        for (let i = 0; i < 30 && !(dl && dl.title && dl.models.length); i++) {
          dl = fromDataLayer(itemid);
          if (dl && dl.title && dl.models.length) break;
          await sleep(500);
        }
        if (!(dl && dl.title && dl.models.length)) {
          if (document.visibilityState !== 'visible') { sessionStorage.removeItem(dkey); return; }
          const tkey = 'sw_tries_' + itemid;
          const tries = (+sessionStorage.getItem(tkey) || 0) + 1;
          sessionStorage.setItem(tkey, String(tries));
          if (tries < 3) { sessionStorage.removeItem(dkey); return; }
          sessionStorage.removeItem(tkey);
          await post({ url: cur, unloaded: true, worker_id: wid });
          note('⚠ no data — verify in work', 1, 1);
          return;
        }
        sessionStorage.removeItem('sw_tries_' + itemid);
        const p = await post(dl);
        note('✓ $' + Math.max(p.price_max, p.price_min, 0, ...p.models.map(x => x.price)).toFixed(2), 0, 1, false);
      } catch (e) {
        sessionStorage.removeItem(dkey);
        note('✗ ' + e.message, 1, 1);
      }
      return;
    }

    try {
      let p, via;
      let dl = null;
      for (let i = 0; i < 10 && !(dl && dl.title && dl.models.length); i++) {
        dl = fromDataLayer(itemid);
        if (dl && dl.title && dl.models.length) break;
        await sleep(300);
      }
      if (dl && dl.title && dl.models.length) { p = await post(dl); via = 'page'; }
      else { p = await send(cur); via = 'api'; }
      note('✓ $' + Math.max(p.price_max, p.price_min, 0, ...p.models.map(x => x.price)).toFixed(2) + ' · ' + p.images.length + ' imgs', false, false, via === 'api');
    } catch (e) {
      note('✗ ' + e.message, 1);
    }
    return;
  }

  note('Go to a Shopee product page first', true);
})();
