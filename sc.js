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
      // get_pc is intermittent (bot check / slow) — retry once with a longer
      // timeout so swatch images + EDT don't silently drop on a single miss.
      let d;
      for (let attempt = 0; attempt < 2 && !(d && d.item); attempt++) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 9000);
        try {
          const r = await fetch('https://shopee.sg/api/v4/pdp/get_pc?item_id=' + m[2] + '&shop_id=' + m[1], {
            credentials: 'include',
            headers: { accept: 'application/json' },
            signal: ctrl.signal,
          });
          d = (await r.json()).data;
        } catch (e) { /* timeout/abort → retry */ } finally { clearTimeout(to); }
      }
      if (!d || !d.item) return p;

      // Drop variants the source can no longer supply (only when explicitly flagged)
      const oos = new Set((d.item.models || []).filter(x => x && x.has_stock === false).map(x => x.name));
      if (oos.size && Array.isArray(p.models)) p.models = p.models.filter(x => !oos.has(x.name));

      // Per-variant swatch image. Shopee keeps swatches in tier_variations[].images
      // (aligned to .options), not on the model — each model maps in via
      // extinfo.tier_index. get_pc has this, so fill p.models[].image by name.
      // Best-effort: any shape mismatch leaves images null (falls back to gallery).
      try {
        const tvs = d.tier_variations || d.item.tier_variations || [];
        const ti  = tvs.findIndex(t => Array.isArray(t.images) && t.images.some(Boolean));
        if (ti >= 0 && Array.isArray(p.models)) {
          const imgs = tvs[ti].images || [];
          const byName = {};
          for (const m of (d.item.models || [])) {
            const idx = ((m.extinfo && m.extinfo.tier_index) || m.tier_index || [])[ti];
            if (idx != null && imgs[idx]) byName[m.name] = CDN + imgs[idx];
          }
          for (const pm of p.models) if (!pm.image && byName[pm.name]) pm.image = byName[pm.name];
        }
      } catch (e) { /* swatch mapping optional */ }

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
  // Shopee ships the description either as a plain string or as a structured
  // rich-text OBJECT (paragraph / extended-description blocks) whose exact schema
  // varies by product. Rather than guess the schema, walk it generically and pull
  // both the text runs and any image hashes it carries — rich-text products keep
  // their description images HERE, so this is also a desc-image source that needs
  // no DOM anchor. A non-string description previously threw "(intermediate
  // value).split is not a function" in harvestDescImages.
  const richText = (v) => {
    if (typeof v === 'string') return { text: v, images: [] };
    const text = [], images = [], seen = new Set();
    const walk = (o, d) => {
      if (!o || typeof o !== 'object' || d > 8 || seen.has(o)) return;
      seen.add(o);
      if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
      let ks; try { ks = Object.keys(o); } catch (e) { return; }
      for (const k of ks) {
        let val; try { val = o[k]; } catch (e) { continue; }
        if (typeof val === 'string') {
          if (/^(text|content|paragraph|description)$/i.test(k)) text.push(val);
          // Long hash-like values under an image key — real hashes are ~30+ chars,
          // so the length floor keeps ids/flags out.
          else if (/image|img|photo/i.test(k) && (/^https?:\/\//.test(val) || /^[a-z0-9_-]{16,}$/i.test(val))) images.push(val);
        } else if (val && typeof val === 'object') walk(val, d + 1);
      }
    };
    walk(v, 0);
    return { text: text.join('\n'), images };
  };

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
      .map(m => ({ name: m.name, price: m.price / 1e5, image: m.image ? mapImg(m.image) : null }));
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

    // Whichever field actually carries text wins; images from both are kept.
    const d1 = richText(withDesc.description), d2 = richText(withDesc.rich_text_description);
    const dsc = { text: d1.text || d2.text, images: [...d1.images, ...d2.images] };

    return {
      title: priced.name || priced.title || withDesc.name || '',
      description: dsc.text,
      price_min: priced.price_min != null ? priced.price_min / 1e5 : Math.min(...prices),
      price_max: priced.price_max != null ? priced.price_max / 1e5 : Math.max(...prices),
      models,
      images: (withImgs.images || []).map(mapImg),
      rich_images: dsc.images.map(mapImg),   // merged into desc_images by the caller
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

    // v4 keeps rich-text products' body in description_info (extended blocks with
    // their own image hashes); plain products keep it in description.
    const i1 = richText(it.description), i2 = richText(it.description_info);
    const itd = { text: i1.text || i2.text, images: [...i1.images, ...i2.images] };

    const shop_location = it.shop_location || null;
    const rating_star = (it.item_rating && it.item_rating.rating_star != null)
      ? it.item_rating.rating_star : null;

    return {
      title: it.name,
      description: itd.text,
      rich_images: itd.images.map(mapImg),
      price_min: (it.price_min || it.price || 0) / 1e5,
      price_max: (it.price_max || it.price || 0) / 1e5,
      models: (it.models || []).map(x => ({ name: x.name, price: (x.price || 0) / 1e5, image: x.image ? mapImg(x.image) : null })).filter(x => x.price > 0),
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

  // Description images lazy-load as you scroll and aren't in the item API — so
  // scroll the page to force them in, then collect the LARGE product images
  // (icons/logos are tiny; gallery is excluded). Promo banners may slip through;
  // the downstream classifier decides dims/cover/skip. Best-effort, page path only.
  const harvestDescImages = async (galleryUrls, descText) => {
    // Normalize to a bare hash so webp/jpg + @resize variants collapse to one.
    const hashOf = (u) => (String(u).split('/file/')[1] || '').split('?')[0].split('@')[0].replace(/\.(webp|jpe?g|png)$/i, '');
    const gal = new Set((galleryUrls || []).map(hashOf));
    const y0 = window.scrollY;
    try {
      const H = document.body.scrollHeight;
      for (let y = 0, n = 0; y < H && n < 40; y += 600, n++) { window.scrollTo(0, y); await sleep(120); }
      window.scrollTo(0, y0);
      await sleep(400);
    } catch (e) { /* scroll is best-effort */ }

    // Scope to the description block, or every <picture> on the page (related
    // products, recommendations, shop banners) floods in. Anchor on a distinctive
    // line of the scraped description text, then climb to the container holding it.
    let scope = null;
    const line = (descText || '').split('\n').map(s => s.trim()).filter(s => s.length > 15).sort((a, b) => b.length - a.length)[0];
    if (line) {
      // Pick the SMALLEST element containing the line (the actual <p>, not an outer
      // wrapper), then climb just to the container that also holds the images.
      const el = [...document.querySelectorAll('p,div,span')].filter(e => e.textContent.includes(line))
        .sort((a, b) => a.textContent.length - b.textContent.length)[0];
      let c = el;
      for (let i = 0; i < 5 && c; i++) { if (c.querySelectorAll('picture,img').length >= 1) { scope = c; break; } c = c.parentElement; }
    }
    if (!scope) {
      // Fallback: anchor on the section heading. Works when the description text is
      // empty or rich-text (nothing to match on), and is stable across sellers.
      const hd = [...document.querySelectorAll('div,span,h1,h2,h3,section,label')]
        .filter(e => /^product description$/i.test((e.textContent || '').trim()))
        .sort((a, b) => a.textContent.length - b.textContent.length)[0];
      let c = hd && hd.parentElement;
      for (let i = 0; i < 5 && c; i++) { if (c.querySelectorAll('picture,img').length >= 1) { scope = c; break; } c = c.parentElement; }
    }
    if (!scope) return [];  // no anchor → skip rather than flood with page chrome

    const out = [], seen = new Set();
    const add = (raw) => {
      const s = (raw || '').split('?')[0];
      if (!/susercontent\.com\/file\//.test(s)) return;
      const h = hashOf(s);
      if (!h || gal.has(h) || seen.has(h)) return;
      seen.add(h);
      out.push('https://down-sg.img.susercontent.com/file/' + h);  // bare full-res URL
    };
    const firstUrl = (srcset) => (srcset || '').split(',')[0].trim().split(/\s+/)[0];
    // <picture> (lazy inner <img> reports naturalWidth 0; URL is in <source srcset>)
    for (const pic of scope.querySelectorAll('picture')) {
      for (const src of pic.querySelectorAll('source')) add(firstUrl(src.getAttribute('srcset')));
      const im = pic.querySelector('img');
      if (im) add(im.currentSrc || im.src || firstUrl(im.getAttribute('srcset')));
    }
    // plain <img> and CSS background fallbacks (other sellers' layouts)
    for (const im of scope.querySelectorAll('img')) if (!im.closest('picture') && im.naturalWidth >= 300) add(im.currentSrc || im.src);
    for (const el of scope.querySelectorAll('div,a,figure')) {
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg !== 'none' && bg.match(/url\(["']?(https?:\/\/[^"')]+)/);
      if (m) add(m[1]);
    }
    return out;
  };

  // Buyer-uploaded review photos — real, unique, un-watermarked cover candidates
  // (and colour-diverse: buyers photograph the variant they bought). Pure API
  // (item/get_ratings, media-only) so no DOM/lazy-load. Capped to keep it bounded.
  // Returns { images, status } — an empty list alone is a lie. 2026-08-06: the same
  // product scraped minutes apart gave 0 images in Chrome and 60 in Firefox. Chrome's
  // third-party cookie blocking kills the credentials:'include' call and Shopee answers
  // error 90309999 / is_login false, but the payload recorded review_images: 0 both
  // times, so we concluded the product had no review photos. status says which it was.
  const harvestReviewImages = async (url) => {
    const m = (url || '').match(/i\.(\d+)\.(\d+)/) || (url || '').match(/\/product\/(\d+)\/(\d+)/);
    if (!m) return { images: [], status: 'error' };   // no ids to page with — not the same as "no photos"
    const shopid = m[1], itemid = m[2];
    const CAP = 60;
    const out = [], seen = new Set();
    let status = 'empty';                             // only survives if page ONE came back with no ratings
    try {
      // filter=3 = reviews WITH MEDIA (photos/video); filter=1 was "with comment"
      // (mostly text). limit=50 max per page. A couple of pages fills the cap.
      for (let offset = 0; offset < 300 && out.length < CAP; offset += 50) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 6000);
        let body;
        try {
          const r = await fetch('https://shopee.sg/api/v4/item/get_ratings?filter=3&type=0&itemid=' + itemid + '&shopid=' + shopid + '&limit=50&offset=' + offset, {
            credentials: 'include', headers: { accept: 'application/json' }, signal: ctrl.signal,
          });
          body = await r.json();
        } finally { clearTimeout(to); }
        if (body && body.error === 90309999) { status = 'blocked'; break; }   // anti-bot / not logged in, verified live
        const d = body && body.data;
        const ratings = (d && d.ratings) || [];
        if (!ratings.length) break;
        for (const rt of ratings) {
          for (const h of (rt.images || [])) {
            if (!h || seen.has(h)) continue;
            seen.add(h);
            out.push(mapImg(h));
            if (out.length >= CAP) break;
          }
          for (const v of (rt.videos || [])) {       // video reviews carry a poster frame in .cover
            const c = v && v.cover;
            if (!c || seen.has(c)) continue;
            seen.add(c);
            out.push(c.split('?')[0]);
            if (out.length >= CAP) break;
          }
          if (out.length >= CAP) break;
        }
      }
    } catch (e) {                                     // reviews stay optional — never break the scrape
      status = e && e.name === 'AbortError' ? 'timeout' : 'error';
    }
    // Anything collected means the call worked, including when a later page ends
    // pagination normally; only a run that got nothing reports why it got nothing.
    return { images: out, status: out.length ? 'ok' : status };
  };

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
      if (dl && dl.title && dl.models.length) {
        // Rich-text products carry their desc images in the payload itself; plain
        // ones need the DOM harvest. Union both — either can come back empty.
        const dom = await harvestDescImages(dl.images, dl.description);       // page path only — needs the DOM
        dl.desc_images = [...new Set([...(dl.rich_images || []), ...dom])];
        delete dl.rich_images;
        const { images: revImgs, status: revStatus } = await harvestReviewImages(dl.url);  // pure API — works on both paths
        dl.review_images = revImgs;
        dl.review_status = revStatus;                                         // 'empty' is the only one that means "genuinely none"
        p = await post(dl); via = 'page';
      }
      else { p = await send(cur); via = 'api'; }
      note('✓ $' + Math.max(p.price_max, p.price_min, 0, ...p.models.map(x => x.price)).toFixed(2) + ' · ' + p.images.length + ' imgs'
        + (p.desc_images ? ' +' + p.desc_images.length + ' desc' : '') + (p.review_images ? ' +' + p.review_images.length + ' rev' : ''), false, false, via === 'api');
    } catch (e) {
      note('✗ ' + e.message, 1);
    }
    return;
  }

  note('Go to a Shopee product page first', true);
})();
