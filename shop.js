/* Shop catalogue puller — hosted loader target (shop.js), sibling of sc.js.
 *
 * Bookmarklet:
 *   javascript:fetch('https://workers-v1.vercel.app/shop.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load '+e))
 *
 * Run it on any Shopee SHOP page (e.g. shopee.sg/jiji.sg). It pages through that
 * shop's items sorted by units sold and saves the lot as a JSON download.
 *
 * Why a bookmarklet and not a server call: Shopee's shop-listing endpoints answer
 * 90309999 / is_login:false to anything without a real logged-in session — server
 * side, and in a fresh browser too. Running same-origin in your own tab is the only
 * way in, same as sc.js.
 *
 * Read-only: it fetches listing data and writes a file. Nothing is posted anywhere.
 */
(async () => {
  const PAGE = 100;          // Shopee's max per request
  const MAX_PAGES = 40;      // 4000 items — well past any shop we care about

  const note = (msg, bad) => {
    let el = document.getElementById('__shopnote');
    if (!el) {
      el = document.createElement('div');
      el.id = '__shopnote';
      el.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:12px 16px;border-radius:10px;'
        + 'font:600 14px system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.3);max-width:340px';
      document.body.appendChild(el);
    }
    el.style.background = bad ? '#b3402f' : '#0e7c74';
    el.textContent = msg;
  };

  try {
    // shopid: prefer the one Shopee already put on the page, else resolve the
    // /username in the URL. Shop URLs have no numeric id in them.
    let shopid = null, username = null;
    const mUser = location.pathname.match(/^\/([^\/\?#]+)/);
    if (mUser && !/^(product|search|mall|daily-discover)$/.test(mUser[1])) username = mUser[1];

    const scan = (o, d) => {
      if (!o || typeof o !== 'object' || d > 6 || shopid) return;
      if (o.shopid && Number.isInteger(o.shopid)) { shopid = o.shopid; return; }
      for (const k of Object.keys(o)) { try { scan(o[k], d + 1); } catch (e) { /* skip */ } }
    };
    try { scan(window.dataLayer, 0); } catch (e) { /* ignore */ }

    if (!shopid && username) {
      note('resolving ' + username + '…');
      const r = await fetch('/api/v4/shop/get_shop_detail?username=' + encodeURIComponent(username), {
        credentials: 'include', headers: { accept: 'application/json' },
      });
      const j = await r.json();
      shopid = j && j.data && j.data.shopid;
    }
    if (!shopid) { note('✗ open a shop page first (shopee.sg/<shopname>)', 1); return; }

    const items = [];
    const seen = new Set();
    for (let page = 0; page < MAX_PAGES; page++) {
      note('pulling… ' + items.length + ' items');
      const url = '/api/v4/search/search_items?by=sales&limit=' + PAGE
        + '&match_id=' + shopid + '&newest=' + (page * PAGE)
        + '&order=desc&page_type=shop&version=2';
      let batch = [];
      try {
        const r = await fetch(url, {
          credentials: 'include',
          headers: { accept: 'application/json', 'x-api-source': 'pc', 'x-requested-with': 'XMLHttpRequest' },
        });
        const j = await r.json();
        if (j && j.error) { if (!items.length) { note('✗ Shopee said error ' + j.error + ' — are you logged in?', 1); return; } break; }
        batch = (j && j.items) || [];
      } catch (e) { break; }
      if (!batch.length) break;

      for (const it of batch) {
        const b = it.item_basic || it;
        if (!b || seen.has(b.itemid)) continue;
        seen.add(b.itemid);
        const rat = b.item_rating || {};
        items.push({
          itemid: b.itemid, shopid: b.shopid,
          name: b.name,
          price: (b.price || 0) / 1e5,
          price_min: (b.price_min || b.price || 0) / 1e5,
          price_max: (b.price_max || b.price || 0) / 1e5,
          sold: b.historical_sold || b.sold || 0,
          month_sold: b.sold || 0,
          rating: rat.rating_star || 0,
          reviews: (rat.rating_count || [])[0] || 0,
          stock: b.stock || 0,
          liked: b.liked_count || 0,
          image: b.image || null,
          cat: (b.catid != null ? b.catid : null),
        });
      }
      await new Promise(r => setTimeout(r, 350));   // be polite to the API
    }

    if (!items.length) { note('✗ got nothing back', 1); return; }

    const blob = new Blob([JSON.stringify({ shopid, username, pulled: new Date().toISOString(), items }, null, 1)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shop-' + (username || shopid) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    note('✓ saved ' + items.length + ' items to Downloads');
  } catch (e) {
    note('✗ ' + e.message, 1);
  }
})();
