/* Steadymart Shopee scraper — hosted loader target (sc.js).
 * Loaded by a tiny bookmarklet on every device:
 *   javascript:fetch('https://workers-v1.vercel.app/sc.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load '+e))
 *
 * On a product page it FIRST reads the full item (title, description, images,
 * exact variant prices) out of window.dataLayer — which Shopee already
 * populated via its own signed request, so there's no fetch of ours and no
 * bot puzzle. Falls back to the v4 fetch if dataLayer isn't populated yet, and
 * always uses fetch for paste-box links (dataLayer only holds the page you're on).
 *
 * Toast is tagged ·page (read from memory, puzzle-free) or ·api (fetched).
 * Edit here and every device picks it up on next click — no re-pasting bookmarks.
 */
(async () => {
  const K = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';
  const INBOX = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox';
  const CDN = 'https://down-sg.img.susercontent.com/file/';

  const post = async (p) => {
    const s = await fetch(INBOX, {
      method: 'POST',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ kind: 'shopee', payload: p }),
    });
    if (!s.ok) throw new Error('Supabase ' + s.status);
    return p;
  };

  const mapImg = (h) => (/^https?:/.test(h) ? h.split('?')[0] : CDN + h);

  // Read the full item for `itemid` out of window.dataLayer. Shopee pushes
  // several copies (some with prices nulled for analytics); we collect every
  // matching copy and merge — prices from the priced copy, description/images
  // from whichever copy has them. Returns null if no priced copy is present.
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
    };
  };

  // Fetch path (v4 API) — used for paste-box links and as fallback
  const fetchItem = async (L) => {
    if (/shp\.ee/.test(L)) {
      try {
        const rr = await fetch('https://workers-v1.vercel.app/api/shopee?url=' + encodeURIComponent(L) + '&resolve=1');
        L = (await rr.json()).url || L;
      } catch (e) { /* keep original */ }
    }
    const m = L.match(/i\.(\d+)\.(\d+)/) || L.match(/\/product\/(\d+)\/(\d+)/);
    if (!m) throw new Error('not a product link');
    // Abort if the v4 call hangs (e.g. a bot challenge). Without this, a
    // backgrounded iOS tab can stall here forever with no error surfaced.
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
    };
  };

  // Send a paste-box link (always fetch)
  const send = async (L) => post(await fetchItem(L));

  const note = (msg, bad, small, amber) => {
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

  // Product page → try dataLayer first, fall back to fetch (manual click only).
  // AUTO mode (userscript-driven, gated by the sw_auto toggle): dataLayer ONLY —
  // poll until Shopee populates a priced copy, then send; NEVER fall back to the
  // v4 fetch (that's what triggers bot puzzles). Dedup per item via sessionStorage.
  // Shopee product URLs come in two shapes: …-i.<shopid>.<itemid> and
  // /product/<shopid>/<itemid>. Recognise both.
  const cur = /i\.\d+\.\d+|\/product\/\d+\/\d+/.test(location.href) ? location.href.split('?')[0] : '';
  if (cur) {
    const itemid = ((cur.match(/i\.\d+\.(\d+)/) || cur.match(/\/product\/\d+\/(\d+)/)) || [])[1];
    const AUTO = !!window.__swAuto;

    if (AUTO) {
      if (localStorage.getItem('sw_auto') !== '1') return;      // toggle off
      const dkey = 'sw_sent_' + itemid;
      if (sessionStorage.getItem(dkey)) return;                  // already sent this item
      sessionStorage.setItem(dkey, '1');                         // claim early to avoid double-fire
      try {
        let dl = null;
        for (let i = 0; i < 30 && !(dl && dl.title && dl.models.length); i++) {
          dl = fromDataLayer(itemid);
          if (dl && dl.title && dl.models.length) break;
          await sleep(500);                                       // up to ~15s for dataLayer to fill
        }
        if (!(dl && dl.title && dl.models.length)) {
          // dataLayer never filled within the window. In a background tab this is
          // just throttling — bail and let a later focus retry.
          if (document.visibilityState !== 'visible') { sessionStorage.removeItem(dkey); return; }
          // Visible but still empty. Could be a SLOW page (the priced impression
          // event just hasn't fired yet) or a genuinely dead/delisted source.
          // Don't declare it dead on the first miss — release the dedup key so
          // maybeAuto re-fires and polls again. Only after a few full attempts do
          // we post the ADVISORY marker (work.html shows "verify & Delete").
          const tkey = 'sw_tries_' + itemid;
          const tries = (+sessionStorage.getItem(tkey) || 0) + 1;
          sessionStorage.setItem(tkey, String(tries));
          if (tries < 3) { sessionStorage.removeItem(dkey); return; } // retry on next tick
          sessionStorage.removeItem(tkey);
          await post({ url: cur, unloaded: true });
          note('⚠ no data — verify in work', 1, 1);
          return;
        }
        sessionStorage.removeItem('sw_tries_' + itemid);          // clear retry counter on success
        const p = await post(dl);
        note('✓ $' + Math.max(p.price_max, p.price_min, 0, ...p.models.map(x => x.price)).toFixed(2), 0, 1, false);
      } catch (e) {
        sessionStorage.removeItem(dkey);                         // let a later pass retry
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

  // Not a product page — prompt the user to navigate to one
  note('Go to a Shopee product page first', true);
})();
