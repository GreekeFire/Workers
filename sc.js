/* Steadymart Shopee scraper — hosted loader target.
 * Loaded by a tiny bookmarklet:
 *   javascript:fetch('https://workers-v1.vercel.app/sc.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load failed: '+e))
 * Runs in the logged-in Shopee tab, so the v4 fetch carries the session.
 * Same behaviour as the v3 bookmarklet: instant send on a product page,
 * paste-box anywhere else on Shopee. Kept readable since length no longer
 * matters — edit here and every device picks it up on next click.
 */
(async () => {
  const K = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';
  const INBOX = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox';

  const send = async (L) => {
    // Expand sg.shp.ee short links via our resolve endpoint (browser can't follow cross-origin)
    if (/shp\.ee/.test(L)) {
      try {
        const rr = await fetch('https://workers-v1.vercel.app/api/shopee?url=' + encodeURIComponent(L) + '&resolve=1');
        L = (await rr.json()).url || L;
      } catch (e) { /* fall through with original */ }
    }
    const m = L.match(/i\.(\d+)\.(\d+)/) || L.match(/\/product\/(\d+)\/(\d+)/);
    if (!m) throw new Error('not a product link');
    const r = await fetch('https://shopee.sg/api/v4/item/get?itemid=' + m[2] + '&shopid=' + m[1], {
      credentials: 'include',
      headers: { 'x-api-source': 'pc', 'x-requested-with': 'XMLHttpRequest' },
    });
    const d = await r.json();
    const it = d.item || (d.data && (d.data.item || d.data));
    if (!it || !it.name) throw new Error('Shopee returned no item — solve the bot check, retry');
    const p = {
      title: it.name,
      description: it.description || '',
      price_min: (it.price_min || it.price || 0) / 1e5,
      price_max: (it.price_max || it.price || 0) / 1e5,
      models: (it.models || []).map(x => ({ name: x.name, price: (x.price || 0) / 1e5 })).filter(x => x.price > 0),
      images: (it.images || []).map(h => 'https://down-sg.img.susercontent.com/file/' + h),
      sold: it.historical_sold || it.sold || 0,
      stock: it.stock || 0,
      url: L.split('?')[0],
    };
    const s = await fetch(INBOX, {
      method: 'POST',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ kind: 'shopee', payload: p }),
    });
    if (!s.ok) throw new Error('Supabase ' + s.status);
    return p;
  };

  const note = (msg, bad) => {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999999;background:' +
      (bad ? '#dc2626' : '#16a34a') + ';color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  };

  // On a product page → instant send
  const cur = location.href.match(/i\.\d+\.\d+/) ? location.href.split('?')[0] : '';
  if (cur) {
    try {
      const p = await send(cur);
      note('✓ Sent — $' + Math.max(p.price_max, p.price_min, 0, ...p.models.map(x => x.price)).toFixed(2) + ' · ' + p.images.length + ' imgs');
    } catch (e) {
      note('✗ ' + e.message, 1);
    }
    return;
  }

  // Anywhere else on Shopee → paste-box for one or many links
  const w = document.createElement('div');
  w.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;background:#111827;color:#fff;padding:16px;border-radius:12px;font:13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.5);width:min(480px,90vw)';
  w.innerHTML = '<b>Send to work.html</b><br><textarea id=whx rows=5 style="width:100%;margin:8px 0;background:#1f2937;color:#fff;border:1px solid #374151;border-radius:8px;padding:8px;font:12px monospace;box-sizing:border-box" placeholder="One Shopee link per line"></textarea><div style="display:flex;gap:8px;justify-content:flex-end"><button id=whc style="padding:6px 14px;border-radius:8px;border:1px solid #374151;background:none;color:#9ca3af;cursor:pointer">Cancel</button><button id=whg style="padding:6px 14px;border-radius:8px;border:0;background:#16a34a;color:#fff;font-weight:700;cursor:pointer">Send</button></div><div id=whs style="margin-top:8px;color:#9ca3af"></div>';
  document.body.appendChild(w);
  const ta = w.querySelector('#whx');
  w.querySelector('#whc').onclick = () => w.remove();
  w.querySelector('#whg').onclick = async () => {
    const st = w.querySelector('#whs');
    const links = ta.value.split(/\s+/).filter(Boolean);
    if (!links.length) { st.textContent = 'No links'; return; }
    let ok = 0, fail = 0;
    for (let i = 0; i < links.length; i++) {
      st.textContent = 'Fetching ' + (i + 1) + '/' + links.length + '…';
      try { await send(links[i]); ok++; } catch (e) { fail++; }
      if (i < links.length - 1) await new Promise(r => setTimeout(r, 900 + Math.random() * 600));
    }
    st.innerHTML = '<b style=color:#4ade80>✓ ' + ok + ' sent</b>' +
      (fail ? ' · <span style=color:#f87171>' + fail + ' failed — solve the bot check on any product page, then retry those links</span>' : '');
    setTimeout(() => w.remove(), fail ? 6000 : 2500);
  };
})();
