/**
 * background.js — Wormhole Scraper service worker
 *
 * Pipeline per search job:
 *   1. Open minimized Shopee popup window
 *   2. Wait for page load + content-script ready
 *   3. Send SEARCH  → get top-N basic items (one short round-trip)
 *   4. For each item: send GET_PRODUCT → get full detail (one short round-trip)
 *   5. POST each product to /save-product immediately
 *   6. Broadcast PRODUCT / KW_STATE events to popup
 *   7. Close window
 *
 * No single message takes longer than ~3 s → avoids Chrome's message-channel timeout.
 *
 * Messages from popup.js:
 *   { action:'SEARCH_SCRAPE', keyword, slug_prefix, limit }
 *   { action:'BATCH', jobs:[{keyword, slug_prefix, limit}] }
 *   { action:'STATUS' }
 *   { action:'CANCEL' }
 *   { action:'SCREENSHOT', tabId }
 */

const SERVER       = 'http://localhost:7771';
const SHOPEE_HOME  = 'https://shopee.sg/';
const LOAD_TIMEOUT = 30_000;   // 30 s page-load timeout
const MSG_RETRIES  = 6;        // retries for content-script PING
const MSG_GAP_MS   = 2_000;    // gap between PING retries

// ── State ─────────────────────────────────────────────────────────────────────
let queue   = [];
let running = false;
let curJob  = null;
let cancel  = false;
const lines = [];

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  lines.unshift(line);
  if (lines.length > 400) lines.pop();
  console.log('[WH]', msg);
  broadcast({ type: 'LOG', msg: line });
}

function broadcast(data) {
  chrome.runtime.sendMessage(data).catch(() => {});
}

// ── Open isolated minimised Shopee window ─────────────────────────────────────
async function openShopeeTab() {
  const win = await chrome.windows.create({
    url: SHOPEE_HOME,
    type: 'popup',
    width: 1280, height: 900,
    focused: false,
  });
  const tabId = win.tabs[0].id;
  await waitForLoad(tabId);       // wait for status=complete
  await sleep(2000);              // extra buffer for Shopee SPA boot

  // Wait until content script is actually ready (registered its listener)
  for (let i = 1; i <= MSG_RETRIES; i++) {
    try {
      await pingTab(tabId);
      log(`  content script ready (attempt ${i})`);
      return { tabId, winId: win.id };
    } catch (_) {
      if (i < MSG_RETRIES) {
        log(`  waiting for content script… (${i}/${MSG_RETRIES})`);
        await sleep(MSG_GAP_MS);
      }
    }
  }
  throw new Error('Content script never became ready — Shopee may have shown a CAPTCHA or blocked the request');
}

// ── Main scrape job ───────────────────────────────────────────────────────────
async function runJob(job) {
  const { keyword, slug_prefix, limit = 8 } = job;
  log(`→ Searching: "${keyword}" (top ${limit})`);
  broadcast({ type: 'KW_STATE', keyword, state: 'running' });
  broadcast({ type: 'STATUS',   current: keyword, queue: queue.length });

  const { tabId, winId } = await openShopeeTab();

  try {
    // 1. Search — one short round-trip
    const searchResp = await msgTab(tabId, { action: 'SEARCH', keyword, limit });
    if (!searchResp?.ok) throw new Error(searchResp?.error || 'Search returned no data');

    const basics = searchResp.items || [];
    if (basics.length === 0) {
      log(`  ✗ No listings found for "${keyword}"`);
      broadcast({ type: 'KW_STATE', keyword, state: 'err' });
      return { keyword, ok: false, error: 'no results' };
    }
    log(`  ${basics.length} listings found`);

    const saved = [];

    // 2. For each listing: one short GET_PRODUCT round-trip → save
    for (let i = 0; i < basics.length && !cancel; i++) {
      const b = basics[i];
      const slug = slug_prefix
        ? `${slug_prefix}-${String(i + 1).padStart(2, '0')}`
        : `${makeSlug(b.name || 'product', 35)}-${String(i + 1).padStart(2, '0')}`;

      let product = null;
      try {
        const dr = await msgTab(tabId, { action: 'GET_PRODUCT', itemid: b.itemid, shopid: b.shopid });
        product = dr?.ok ? dr.product : null;
      } catch (_) {}

      // Fall back to basic data if detail fetch failed
      if (!product) {
        product = parseBasic(b);
      }

      product.slug    = slug;
      product.keyword = keyword;

      // POST to server
      try {
        const r = await fetch(`${SERVER}/save-product`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product),
        });
        const body = await r.json();
        if (r.ok) {
          log(`  ✓ ${slug} — "${(product.name || '').slice(0, 40)}" SGD ${product.price_min_sgd} · ${product.images?.length || 0} imgs`);
          broadcast({ type: 'PRODUCT', product });
          saved.push({ slug, ok: true });
        } else {
          log(`  ✗ ${slug} server: ${body.error || r.status}`);
          saved.push({ slug, ok: false });
        }
      } catch (e) {
        log(`  ✗ ${slug} save error: ${e.message}`);
        saved.push({ slug, ok: false });
      }

      await sleep(500 + Math.random() * 700); // polite gap between products
    }

    const n = saved.filter(s => s.ok).length;
    log(`  Done "${keyword}" — ${n}/${saved.length} saved`);
    broadcast({ type: 'KW_STATE', keyword, state: n > 0 ? 'ok' : 'err' });
    return { keyword, ok: true, saved };

  } catch (e) {
    log(`  ✗ "${keyword}" failed: ${e.message}`);
    broadcast({ type: 'KW_STATE', keyword, state: 'err' });
    return { keyword, ok: false, error: e.message };
  } finally {
    try { await chrome.windows.remove(winId); } catch (_) {}
  }
}

// ── Parse basic search result into product shape (no description/attributes) ──
function parseBasic(b) {
  const price    = b.price    || b.price_min || 0;
  const priceMax = b.price_max || price;
  return {
    itemid: b.itemid, shopid: b.shopid,
    name: b.name || '',
    description: '',
    price_min_sgd: (price    / 100000).toFixed(2),
    price_max_sgd: (priceMax / 100000).toFixed(2),
    currency: 'SGD',
    images: (b.images || []).filter(h => h?.length > 5),
    sold: b.sold || b.historical_sold || 0,
    stock: b.stock || 0,
    rating: b.item_rating?.rating_star || b.rating_star || 0,
    rating_count: b.item_rating?.rating_count?.[0] || 0,
    liked_count: b.liked_count || 0,
    shop_name: b.shop_name || '',
    attributes: [],
    categories: (b.categories || []).map(c => c.display_name || c.name).filter(Boolean),
    url: `https://shopee.sg/product/${b.shopid}/${b.itemid}`,
    scraped_at: new Date().toISOString(),
  };
}

function makeSlug(name, max) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
}

// ── Queue runner ──────────────────────────────────────────────────────────────
async function runQueue() {
  if (running) return;
  running = true;
  cancel  = false;
  const results = [];

  while (queue.length > 0 && !cancel) {
    curJob = queue.shift();
    try {
      results.push(await runJob(curJob));
    } catch (e) {
      log(`✗ "${curJob.keyword}" crashed: ${e.message}`);
      broadcast({ type: 'KW_STATE', keyword: curJob.keyword, state: 'err' });
      results.push({ keyword: curJob.keyword, ok: false, error: e.message });
    }
    curJob = null;
    if (queue.length > 0 && !cancel) await sleep(2500 + Math.random() * 2000);
  }

  running = false;
  const ok = results.filter(r => r.ok).length;
  log(`✅ Queue done — ${ok}/${results.length} searches ok`);
  broadcast({ type: 'DONE', results, log: lines.slice(0, 80) });
}

// ── CDP screenshot ────────────────────────────────────────────────────────────
async function screenshot(tabId) {
  await new Promise((res, rej) =>
    chrome.debugger.attach({ tabId }, '1.3', () =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()));
  try {
    const { data } = await cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    return data;
  } finally {
    await new Promise(res => chrome.debugger.detach({ tabId }, res));
  }
}

// Like screenshot() but assumes debugger is already attached (for multi-step sessions)
async function screenshotRaw(tabId) {
  // Lower quality + smaller viewport keeps payload manageable for vision model
  const { data } = await cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 55 });
  return data;
}

// Attach debugger, run fn(cdp), detach — manages the session lifecycle
async function withDebugger(tabId, fn) {
  await new Promise((res, rej) =>
    chrome.debugger.attach({ tabId }, '1.3', () =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()));
  try {
    return await fn();
  } finally {
    await new Promise(res => chrome.debugger.detach({ tabId }, res));
  }
}

function cdp(tabId, method, params = {}) {
  return new Promise((res, rej) =>
    chrome.debugger.sendCommand({ tabId }, method, params, r =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r)));
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); resolve(); };

    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      chrome.tabs.onUpdated.removeListener(fn);
      reject(new Error(`Tab ${tabId} load timeout`));
    }, LOAD_TIMEOUT);

    function fn(id, info) { if (id === tabId && info.status === 'complete') done(); }
    chrome.tabs.onUpdated.addListener(fn);

    // Check if already complete (handles the TOCTOU race)
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === 'complete') done();
    });
  });
}

// Promise-based tab message with a per-call timeout
function msgTab(tabId, msg, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('msgTab timeout')), timeoutMs);
    chrome.tabs.sendMessage(tabId, msg, resp => {
      clearTimeout(t);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

function pingTab(tabId) {
  return msgTab(tabId, { action: 'PING' }, 3000);
}

// ── GET_BY_URL — scrape a single Shopee product URL, no localhost needed ───────
// Used by bridge.js (work.html integration). Opens minimised tab, calls
// GET_PRODUCT via content script, returns clean product object directly.
async function getByUrl(url) {
  // Extract shopid + itemid from URL
  const m1 = url.match(/\.i\.(\d+)\.(\d+)/);       // /name-i.SHOPID.ITEMID
  const m2 = url.match(/\/product\/(\d+)\/(\d+)/);  // /product/SHOPID/ITEMID
  const ids = m1 || m2;
  if (!ids) throw new Error('Could not parse shopid/itemid from URL');
  const shopid = parseInt(ids[1]);
  const itemid = parseInt(ids[2]);

  const { tabId, winId } = await openShopeeTab();
  try {
    const dr = await msgTab(tabId, { action: 'GET_PRODUCT', itemid, shopid }, 15000);
    if (!dr?.ok || !dr.product) throw new Error(dr?.error || 'No product data returned');
    return { ok: true, product: dr.product };
  } finally {
    try { await chrome.windows.remove(winId); } catch (_) {}
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {

  if (msg.action === 'GET_BY_URL') {
    getByUrl(msg.url)
      .then(result => reply(result))
      .catch(e    => reply({ ok: false, error: e.message }));
    return true;
  }


  if (msg.action === 'SEARCH_SCRAPE') {
    const { keyword, slug_prefix = '', limit = 8 } = msg;
    if (!keyword) { reply({ ok: false, error: 'keyword required' }); return; }
    queue.push({ keyword, slug_prefix, limit });
    log(`Queued: "${keyword}"`);
    if (!running) runQueue();
    reply({ ok: true, queued: queue.length });
    return true;
  }

  if (msg.action === 'BATCH') {
    const jobs = (msg.jobs || []).filter(j => j?.keyword); // Bug #7 fix: validate keyword
    if (!jobs.length) { reply({ ok: false, error: 'no valid jobs (each needs a keyword)' }); return; }
    queue.push(...jobs);
    log(`Batch queued: ${jobs.length} searches`);
    if (!running) runQueue();
    reply({ ok: true, queued: queue.length });
    return true;
  }

  if (msg.action === 'STATUS') {
    reply({ running, queued: queue.length, current: curJob?.keyword || null, log: lines.slice(0, 80) });
    return true;
  }

  if (msg.action === 'CANCEL') {
    cancel = true; queue = [];
    log('Cancelled.');
    reply({ ok: true });
    return true;
  }

  // Manual poll trigger from popup Research tab
  if (msg.action === 'POLL_RESEARCH') {
    (async () => {
      try {
        const r = await fetch(`${SERVER}/api/batch-pending`);
        if (!r.ok) { reply({ found: false }); return; }
        const jobs = await r.json();
        if (!Array.isArray(jobs) || !jobs.length) { reply({ found: false }); return; }
        const valid = jobs.filter(j => j?.keyword);
        if (!valid.length) { reply({ found: false }); return; }
        queue.push(...valid);
        log(`📡 Research batch: ${valid.length} keywords picked up manually`);
        valid.forEach(j => broadcast({ type: 'KW_STATE', keyword: j.keyword, state: 'pending' }));
        broadcast({ type: 'RESEARCH_BATCH', jobs: valid });
        if (!running) runQueue();
        reply({ found: true, jobs: valid });
      } catch (e) {
        reply({ found: false, error: e.message });
      }
    })();
    return true;
  }

  // Fetch Shopee SG trending via content script in a real Shopee tab
  if (msg.action === 'FETCH_SHOPEE_TRENDING') {
    (async () => {
      const { tabId, winId } = await openShopeeTab().catch(e => { throw e; });
      try {
        const resp = await msgTab(tabId, { action: 'GET_TRENDING' });
        reply(resp || { ok: false, error: 'no response' });
      } finally {
        try { await chrome.windows.remove(winId); } catch (_) {}
      }
    })().catch(e => reply({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'SCREENSHOT') {
    screenshot(msg.tabId)
      .then(data => reply({ ok: true, data }))
      .catch(e  => reply({ ok: false, error: e.message }));
    return true;
  }

  // Scrape a single product URL (from popup URL tab or enhance.html)
  if (msg.action === 'SCRAPE_URL') {
    (async () => {
      const url = msg.url;
      if (!url) { reply({ ok: false, error: 'url required' }); return; }
      log(`🔗 SCRAPE_URL: ${url.slice(0, 70)}`);
      let winId = null;
      try {
        const win = await chrome.windows.create({ url, type: 'popup', width: 1280, height: 900, focused: false });
        const tabId = win.tabs[0].id;
        winId = win.id;
        await waitForLoad(tabId);
        await sleep(3500); // let Shopee SPA finish rendering

        // One debugger session for all CDP work: scroll screenshots + thumbnail clicks
        let frames = [], imageUrls = [];
        await withDebugger(tabId, async () => {
          // Reset scroll to top
          await cdp(tabId, 'Runtime.evaluate', { expression: 'window.scrollTo(0,0)', returnByValue: true });
          await sleep(400);

          // Scroll through full page capturing frames (max 3 to keep payload manageable)
          for (let i = 0; i < 3; i++) {
            try { frames.push(await screenshotRaw(tabId)); } catch(_) { break; }
            const ev = await cdp(tabId, 'Runtime.evaluate', {
              expression: '(window.innerHeight + window.scrollY) >= document.body.scrollHeight - 200',
              returnByValue: true,
            });
            if (ev?.result?.value) break;
            await cdp(tabId, 'Runtime.evaluate', { expression: 'window.scrollBy(0, 750)', returnByValue: true });
            await sleep(700);
          }
          log(`  captured ${frames.length} frames`);

          // Hover/scroll the gallery so lazy thumbnails render, then back to top
          await cdp(tabId, 'Runtime.evaluate', { expression: 'window.scrollTo(0,0)', returnByValue: true });
          await sleep(400);
          // Light thumbnail-click pass (best-effort) to coax any lazy gallery images in
          await cdp(tabId, 'Runtime.evaluate', {
            expression: `(async function(){
              const thumbs = [...document.querySelectorAll('img')].filter(i=>{
                const s=i.currentSrc||i.src||''; return (s.includes('susercontent.com/file/')||s.includes('cf.shopee.sg/file/')) && (i.naturalWidth||999)<200;
              }).slice(0,12);
              for (const t of thumbs){ try{ t.scrollIntoView({block:'nearest'}); t.click(); await new Promise(r=>setTimeout(r,250)); }catch(_){} }
              return thumbs.length;
            })()`,
            returnByValue: true, awaitPromise: true,
          }).catch(()=>{});

          // Selector-INDEPENDENT extraction: every Shopee CDN image on the page,
          // deduped by its file hash, rebuilt as a clean full-res URL.
          const imgEv = await cdp(tabId, 'Runtime.evaluate', {
            expression: `(function(){
              const byHash = new Map();
              const isSC = s => s && (s.includes('susercontent.com/file/') || s.includes('cf.shopee.sg/file/'));
              const hashOf = s => { const m = s.match(/\\/file\\/([a-z0-9_-]+)/i); return m ? m[1].split(/[@.]/)[0] : null; };
              const collect = s => {
                if (!isSC(s)) return;
                const h = hashOf(s); if (!h) return;
                if (!byHash.has(h)) byHash.set(h, 'https://down-sg.img.susercontent.com/file/' + h);
              };
              // <img> src + srcset
              document.querySelectorAll('img').forEach(img => {
                collect(img.currentSrc || img.src || '');
                (img.getAttribute('srcset')||'').split(',').forEach(p => collect(p.trim().split(' ')[0]));
              });
              // inline background-image styles (gallery sometimes uses divs)
              document.querySelectorAll('[style*="susercontent"]').forEach(el => {
                const m = (el.getAttribute('style')||'').match(/url\\(["']?([^"')]+)["']?\\)/);
                if (m) collect(m[1]);
              });
              return [...byHash.values()].slice(0, 16);
            })()`,
            returnByValue: true,
          });
          imageUrls = imgEv?.result?.value || [];
          log(`  extracted ${imageUrls.length} unique product images (hash-based)`);
        });

        // Send all frames to vision model
        if (!frames.length) {
          reply({ ok: false, error: 'Could not screenshot the page' });
          return;
        }
        log(`  sending ${frames.length} frames to vision model`);
        const vr = await fetch(`${SERVER}/vision-extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: frames }),
        });
        const vd = await vr.json();
        if (!vd.ok || !vd.name) {
          reply({ ok: false, error: 'Vision could not read product: ' + (vd.error || 'no name found') });
          return;
        }

        const slug = makeSlug(vd.name, 40);
        const product = {
          name: vd.name,
          description: vd.description || '',
          price_min_sgd: vd.price_min || 0,
          price_max_sgd: vd.price_max || vd.price_min || 0,
          sold: vd.sold || 0,
          rating: vd.rating || 0,
          images: [],
          slug, keyword: '',
        };

        // Save product metadata
        await fetch(`${SERVER}/save-product`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product),
        });

        // Download images server-side and WAIT, so vision has the files ready
        // by the time the user opens Enhance and hits Generate.
        let imgsDownloaded = 0;
        if (imageUrls.length) {
          try {
            const dr = await fetch(`${SERVER}/download-image-urls`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ slug, urls: imageUrls, wait: true }),
            });
            imgsDownloaded = (await dr.json()).downloaded || 0;
            log(`  downloaded ${imgsDownloaded}/${imageUrls.length} images for ${slug}`);
          } catch (e) { log(`  image download error: ${e.message}`); }
        }

        log(`  ✓ vision scraped: "${vd.name.slice(0,40)}" SGD${vd.price_min} · ${imgsDownloaded} imgs · ${(vd.variants||[]).length} variant groups`);
        reply({
          ok: true, product,
          variants: vd.variants || [],
          model_prices: [],
          image_count: imgsDownloaded,
        });
      } catch (e) {
        log(`  ✗ SCRAPE_URL: ${e.message}`);
        reply({ ok: false, error: e.message });
      } finally {
        if (winId) { try { await chrome.windows.remove(winId); } catch (_) {} }
      }
    })();
    return true;
  }
});

// ── Poll server for research-approved batch (set by research.html) ────────────
async function pollPendingBatch() {
  try {
    const r = await fetch(`${SERVER}/api/batch-pending`);
    if (!r.ok) return;
    const jobs = await r.json();
    if (!Array.isArray(jobs) || jobs.length === 0) return;
    const valid = jobs.filter(j => j?.keyword);
    if (!valid.length) return;
    queue.push(...valid);
    log(`📡 Research batch received: ${valid.length} keywords from approval UI`);
    valid.forEach(j => broadcast({ type: 'KW_STATE', keyword: j.keyword, state: 'pending' }));
    broadcast({ type: 'RESEARCH_BATCH', jobs: valid });
    if (!running) runQueue();
  } catch (_) {}
}

// Poll every 15 s while extension is alive
setInterval(pollPendingBatch, 15_000);
// Also check immediately on service-worker start
pollPendingBatch();

// ── Scan queue (for enhance.html URL scanning) ────────────────────────────────
const _activeScanJobs = new Set();

async function pollScanQueue() {
  try {
    const r = await fetch(`${SERVER}/scan-queue`);
    if (!r.ok) return;
    const jobs = await r.json();
    for (const job of (jobs || [])) {
      if (job?.job_id && !_activeScanJobs.has(job.job_id)) {
        _activeScanJobs.add(job.job_id);
        handleScanJob(job).finally(() => _activeScanJobs.delete(job.job_id));
      }
    }
  } catch (_) {}
}

async function handleScanJob({ job_id, url, variant }) {
  log(`📸 Scan ${job_id}: ${url.slice(0, 60)}`);
  let winId = null;
  try {
    // Open URL in popup
    const win = await chrome.windows.create({ url, type: 'popup', width: 1280, height: 900, focused: false });
    const tabId = win.tabs[0].id;
    winId = win.id;
    await waitForLoad(tabId);
    await sleep(3000);

    // If a variant was requested, click it via CDP JS injection
    if (variant?.value) {
      try {
        await cdp(tabId, 'Runtime.evaluate', {
          expression: `(() => {
            const sel = '[class*="product-variation"] button, [class*="variation"] button, [class*="sku"] button, [class*="tier"] button';
            const btns = [...document.querySelectorAll(sel)];
            const target = btns.find(b => b.textContent.trim().toLowerCase() === '${variant.value.toLowerCase().replace(/'/g,"\\'")}');
            if (target) { target.click(); return 'clicked'; }
            // fallback: partial match
            const fallback = btns.find(b => b.textContent.trim().toLowerCase().includes('${variant.value.toLowerCase().replace(/'/g,"\\'")}'));
            if (fallback) { fallback.click(); return 'clicked-partial'; }
            return 'not-found';
          })()`,
          returnByValue: true,
        });
        await sleep(2500); // wait for page update after click
      } catch (e) {
        log(`  variant click failed: ${e.message}`);
      }
    }

    // Get final URL (may have redirected)
    const tab = await chrome.tabs.get(tabId);
    const finalUrl = tab.url || url;

    // Try structured API call from content script
    let product = null;
    let variants = [];
    const m1 = finalUrl.match(/\.i\.(\d+)\.(\d+)/);
    const m2 = finalUrl.match(/\/product\/(\d+)\/(\d+)/);
    const ids = m1 || m2;

    if (ids) {
      const shopid = parseInt(ids[1]);
      const itemid = parseInt(ids[2]);
      // Wait for content script
      for (let i = 0; i < 4; i++) {
        try { await pingTab(tabId); break; } catch (_) { await sleep(1500); }
      }
      try {
        const dr = await msgTab(tabId, { action: 'GET_PRODUCT', itemid, shopid }, 12000);
        if (dr?.ok && dr.product) {
          const p = dr.product;
          const slug = makeSlug(p.name || 'shopee-product', 40);
          const imgCount = (p.images || []).length;
          product = {
            found: true,
            slug,
            data: {
              name: p.name || '',
              description: p.description || '',
              price_min_sgd: p.price_min_sgd,
              price_max_sgd: p.price_max_sgd,
              sold: p.sold || 0,
              rating: p.rating || 0,
              itemid, shopid,
              images: p.images || [],
            },
            images: Array.from({ length: Math.min(imgCount, 8) }, (_, i) =>
              `/products/${slug}/img/${String(i + 1).padStart(2, '0')}.jpg`
            ),
            live_fetch: true,
          };
          // Extract tier_variations for variant picker
          if (Array.isArray(p.tier_variations)) {
            variants = p.tier_variations
              .filter(tv => tv?.options?.length)
              .map(tv => ({
                name: tv.name || 'Option',
                options: tv.options.map((opt, i) => ({
                  label: typeof opt === 'string' ? opt : opt?.option || String(opt),
                  image: tv.images?.[i] || null,
                })),
              }));
          }
          // Save to server
          try {
            await fetch(`${SERVER}/save-product`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...product.data, slug }),
            });
          } catch (_) {}
          log(`  ✓ got product: "${(p.name || '').slice(0, 40)}" (${variants.length} variant groups)`);
        }
      } catch (e) {
        log(`  GET_PRODUCT failed: ${e.message}`);
      }
    }

    // Screenshot
    let screenshot_b64 = null;
    try { screenshot_b64 = await screenshot(tabId); } catch (e) { log(`  screenshot failed: ${e.message}`); }

    // Post result
    await fetch(`${SERVER}/scan-result/${job_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(product || { found: false, error: 'Could not extract product data from page' }),
        variants,
        has_screenshot: !!screenshot_b64,
      }),
    });
    log(`📸 Scan ${job_id} done`);

  } catch (e) {
    log(`📸 Scan ${job_id} error: ${e.message}`);
    try {
      await fetch(`${SERVER}/scan-result/${job_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ found: false, error: e.message }),
      });
    } catch (_) {}
  } finally {
    if (winId) { try { await chrome.windows.remove(winId); } catch (_) {} }
  }
}

setInterval(pollScanQueue, 3000);
pollScanQueue();

log('Wormhole Scraper ready.');
