// ==UserScript==
// @name         Carousell Auto-fill
// @namespace    steadymart
// @version      1.6
// @description  After "Fill Carousell" in work.html: on the listing, Ctrl+Enter clicks Edit; the form auto-fills; Ctrl+Enter again Saves. Clicks the real Edit button (supported in-app nav) — no hard-loading the edit URL, which is what Carousell 404s.
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

  if (!/^\/sell\/\d+|^\/p\//.test(location.pathname)) return;
  const onListing = /^\/p\//.test(location.pathname);

  const note = (msg, bad) => {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:' +
      (bad ? '#dc2626' : '#16a34a') + ';color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  };

  // Read the "_current" slot work.html published. consumed=false AND fresh
  // (published in the last 2 min) means there's a pending fill to apply — the
  // freshness guard stops a leftover slot hijacking a listing you open later.
  const getPending = async () => {
    try {
      const r = await fetch(OUT + '?caro_id=eq._current&consumed=eq.false&select=payload&limit=1', {
        headers: { apikey: K, Authorization: 'Bearer ' + K },
      });
      const rows = await r.json();
      if (!Array.isArray(rows) || !rows.length) return null;
      const p = rows[0].payload || {};
      if (!p.ts || Date.now() - p.ts > 120000) return null; // stale → ignore
      return p;
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

  // The form's submit button (Carousell's "Update"). Obfuscated classes change
  // per build, so match the stable type="submit" + Update/Save/List text.
  const clickSave = () => {
    const btn = Array.from(document.querySelectorAll('button[type="submit"]'))
      .find(b => /update|save|list/i.test(b.innerText || '') && !b.disabled);
    if (btn) { btn.click(); return true; }
    return false;
  };

  // Click THIS listing's Edit control. It links to /sell/<id> (in-app SPA nav,
  // the supported path) — match the id so we never hit the generic "Sell" nav.
  const cid = (u) => { const m = String(u || '').split('?')[0].match(/\d{6,}/g); return m ? m[m.length - 1] : ''; };
  const clickEdit = () => {
    const id = cid(location.href);
    let el = id && document.querySelector('a[href*="/sell/' + id + '"]');
    if (!el) el = Array.from(document.querySelectorAll('button, a'))
      .find(b => /^\s*edit\b/i.test(b.innerText || '') && (b.innerText || '').trim().length < 20);
    if (el) { el.click(); return true; }
    return false;
  };

  // Generic one-shot Ctrl/Cmd+Enter chip + handler (used for Edit and for Save).
  const armHotkey = (label, run) => {
    const chip = document.createElement('div');
    chip.textContent = '⌨ ' + label;
    chip.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#111827;color:#fff;padding:8px 14px;border-radius:20px;font:600 12px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.35)';
    document.body.appendChild(chip);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        window.removeEventListener('keydown', onKey, true);
        const msg = run();
        chip.textContent = msg;
        setTimeout(() => chip.remove(), 2500);
      }
    };
    window.addEventListener('keydown', onKey, true);
  };

  (async () => {
    const p = await getPending();
    if (!p) return; // no fresh pending fill → don't disturb normal browsing

    if (onListing) armHotkey('Ctrl+Enter to Edit', () => clickEdit() ? '↗ Opening editor…' : '✗ Edit button not found');

    // A small progress chip so a slow Carousell editor load doesn't look like
    // nothing is happening. Only shown once we're on the /sell/ edit page and
    // still waiting for the form to mount; cleared on fill or timeout.
    let waitChip = null;
    const showWait = () => {
      if (waitChip) return;
      waitChip = document.createElement('div');
      waitChip.textContent = '⏳ filling…';
      waitChip.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;background:#111827;color:#fff;padding:8px 14px;border-radius:20px;font:600 12px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.35)';
      document.body.appendChild(waitChip);
    };
    const hideWait = () => { if (waitChip) { waitChip.remove(); waitChip = null; } };

    // Fill once the edit form appears — whether you reached it by clicking Edit
    // (SPA navigation, the supported path) or the page loaded on /sell/ directly.
    // NO scripted navigation: the hard-load of /sell/ is what Carousell 404s.
    let tries = 0;
    const iv = setInterval(() => {
      const onEdit = /^\/sell\/\d+/.test(location.pathname);
      const ready = onEdit && document.querySelector('input[name="field_title"]');
      if (ready) {
        clearInterval(iv);
        hideWait();
        const n = fill(p);
        if (n) {
          note('✓ Filled ' + n + ' field' + (n > 1 ? 's' : '') + ' — Ctrl+Enter to Save');
          markConsumed();
          armHotkey('Ctrl+Enter to Save', () => clickSave() ? '✓ Saving…' : '✗ Save button not found');
        }
      } else {
        if (onEdit) showWait();       // on the edit page, form not yet mounted
        if (tries++ > 900) {          // ~6 min, then stop waiting
          clearInterval(iv);
          hideWait();
        }
      }
    }, 400);
  })();
})();
