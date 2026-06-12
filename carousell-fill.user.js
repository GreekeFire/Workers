// ==UserScript==
// @name         Carousell Auto-fill
// @namespace    steadymart
// @version      1.2
// @description  After you click "Fill Carousell" in work.html, opening the listing (even a carousell.app.link) auto-jumps to its edit page and fills title/description/price. You review and click Save — nothing is auto-submitted.
// @match        https://www.carousell.sg/sell/*
// @match        https://www.carousell.sg/p/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://workers-v1.vercel.app/carousell-fill.user.js
// @updateURL    https://workers-v1.vercel.app/carousell-fill.user.js
// ==/UserScript==

(function () {
  'use strict';
  const K = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';
  const OUT = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/fill_outbox';

  const onEdit = /^\/sell\/\d+/.test(location.pathname);
  const onListing = /^\/p\//.test(location.pathname);
  if (!onEdit && !onListing) return;

  // Carousell id = last long digit-run in the path (slugs hold short numbers).
  const cid = (u) => {
    const m = String(u || '').split('?')[0].match(/\d{6,}/g);
    return m ? m[m.length - 1] : '';
  };

  const note = (msg, bad) => {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:' +
      (bad ? '#dc2626' : '#16a34a') + ';color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  };

  // Read the single "_current" slot work.html published (the listing you clicked
  // Fill on). consumed=false means there's a pending fill to apply.
  const getPending = async () => {
    try {
      const r = await fetch(OUT + '?caro_id=eq._current&consumed=eq.false&select=payload&limit=1', {
        headers: { apikey: K, Authorization: 'Bearer ' + K },
      });
      const rows = await r.json();
      return Array.isArray(rows) && rows.length ? (rows[0].payload || {}) : null;
    } catch (e) { return null; }
  };

  const markConsumed = () => {
    fetch(OUT + '?caro_id=eq._current', {
      method: 'PATCH',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ consumed: true }),
    }).catch(() => {});
  };

  // React-controlled inputs ignore el.value = x. Use the native setter + real
  // input/change events so React commits the new value (and Save isn't stale).
  const setNative = (el, val) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const fill = (p) => {
    const t = document.querySelector('input[name="field_title"]');
    const d = document.querySelector('textarea[name="field_description"]');
    const pr = document.querySelector('input[name="field_price"]');
    let n = 0;
    if (t && p.title) { setNative(t, p.title); n++; }
    if (d && p.desc) { setNative(d, p.desc); n++; }
    if (pr && p.price != null) { setNative(pr, String(p.price)); n++; }
    return n;
  };

  (async () => {
    const p = await getPending();
    if (!p) return; // no pending fill → don't disturb normal browsing

    // On the listing page: jump to its edit page (the app.link has now resolved
    // to a /p/<slug>-<id> URL, so the id is available here).
    if (onListing) {
      const id = cid(location.href);
      if (id) { note('↗ Opening edit page…'); location.href = 'https://www.carousell.sg/sell/' + id + '/'; }
      return;
    }

    // On the edit page: the form mounts client-side — wait for the title field.
    let tries = 0;
    const iv = setInterval(() => {
      const ready = document.querySelector('input[name="field_title"]');
      if (ready || tries++ > 25) {
        clearInterval(iv);
        const n = fill(p);
        if (n) { note('✓ Filled ' + n + ' field' + (n > 1 ? 's' : '') + ' — review & Save'); markConsumed(); }
        else if (tries > 25) note('✗ Edit form not found', 1);
      }
    }, 300);
  })();
})();
