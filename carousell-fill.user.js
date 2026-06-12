// ==UserScript==
// @name         Carousell Auto-fill
// @namespace    steadymart
// @version      1.1
// @description  On a Carousell listing EDIT page (/sell/<id>/), fills title, description and price from work.html's fill_outbox. You review and click Save — nothing is auto-submitted.
// @match        https://www.carousell.sg/sell/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://workers-v1.vercel.app/carousell-fill.user.js
// @updateURL    https://workers-v1.vercel.app/carousell-fill.user.js
// ==/UserScript==

(function () {
  'use strict';
  const K = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';
  const OUT = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/fill_outbox';

  const id = (location.pathname.match(/\/sell\/(\d+)/) || [])[1];
  if (!id) return;

  const note = (msg, bad) => {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:' +
      (bad ? '#dc2626' : '#16a34a') + ';color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  };

  // React-controlled inputs ignore a plain el.value = x. Use the native setter
  // then dispatch real input/change events so React updates its state (and the
  // edit looks like genuine typing). Returns true if it set anything.
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

  const markConsumed = () => {
    fetch(OUT + '?caro_id=eq._current', {
      method: 'PATCH',
      headers: { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ consumed: true }),
    }).catch(() => {});
  };

  (async () => {
    let payload;
    try {
      // Read the single "_current" slot work.html just published (the listing you
      // clicked Fill on). consumed=false guard stops a stale slot re-filling an
      // unrelated edit page you happen to open later.
      const r = await fetch(OUT + '?caro_id=eq._current&consumed=eq.false&select=payload&limit=1', {
        headers: { apikey: K, Authorization: 'Bearer ' + K },
      });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return; // nothing queued
      payload = rows[0].payload || {};
    } catch (e) { note('outbox ' + e.message, 1); return; }

    // The form mounts client-side — wait for the title field, then fill once.
    let tries = 0;
    const iv = setInterval(() => {
      const ready = document.querySelector('input[name="field_title"]');
      if (ready || tries++ > 25) {
        clearInterval(iv);
        const n = fill(payload);
        if (n) { note('✓ Filled ' + n + ' field' + (n > 1 ? 's' : '') + ' — review & Save'); markConsumed(); }
        else if (tries > 25) note('✗ Edit form not found — open the listing’s Edit page', 1);
      }
    }, 300);
  })();
})();
