// ==UserScript==
// @name         Shopee → Work
// @namespace    steadymart
// @version      1.3
// @description  Floating button on Shopee pages that sends the current product to work.html. Loads the hosted sc.js so all scraping logic stays in one place and auto-updates.
// @match        https://shopee.sg/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://workers-v1.vercel.app/shopee-work.user.js
// @updateURL    https://workers-v1.vercel.app/shopee-work.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.__swInjected) return;
  window.__swInjected = true;

  const SC = 'https://workers-v1.vercel.app/sc.js?';
  const loadSC = (auto) => {
    window.__swAuto = auto ? 1 : 0;
    return fetch(SC + Date.now())
      .then(r => r.text())
      .then(t => { (0, eval)(t); })
      .finally(() => { setTimeout(() => { window.__swAuto = 0; }, 100); });
  };

  function addBtn() {
    if (!document.body || document.getElementById('sw-fab')) return;
    const wrap = document.createElement('div');
    wrap.id = 'sw-fab';
    wrap.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
      'display:flex;flex-direction:column;gap:6px;align-items:flex-end';

    // Auto toggle chip — flips the sw_auto localStorage flag (read by maybeAuto + sc.js)
    const auto = document.createElement('button');
    const paint = () => {
      const on = localStorage.getItem('sw_auto') === '1';
      auto.textContent = on ? 'AUTO ●' : 'auto ○';
      auto.style.background = on ? '#16a34a' : '#374151';
    };
    auto.style.cssText =
      'border:0;border-radius:16px;padding:6px 12px;font:700 11px system-ui;' +
      'color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    auto.onclick = () => {
      localStorage.setItem('sw_auto', localStorage.getItem('sw_auto') === '1' ? '0' : '1');
      paint();
    };
    paint();

    const b = document.createElement('button');
    b.textContent = '→ Work';
    b.style.cssText =
      'background:#16a34a;color:#fff;border:0;border-radius:24px;padding:12px 18px;' +
      'font:700 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer';
    b.onclick = () => {
      b.disabled = true;
      b.textContent = '…';
      // Cache-bust so each click runs the latest sc.js (manual = fetch fallback allowed)
      loadSC(false)
        .catch(e => alert('load ' + e))
        .finally(() => { setTimeout(() => { b.disabled = false; b.textContent = '→ Work'; }, 1500); });
    };

    wrap.appendChild(auto);
    wrap.appendChild(b);
    document.body.appendChild(wrap);
  }

  // AUTO harvest: when the toggle is on, load sc.js (dataLayer-only) for each
  // product. Dedup is owned by sc.js via sessionStorage 'sw_sent_<itemid>' —
  // set on a successful scrape OR an advisory, cleared on a hidden-tab bail. So
  // a dead tab that bailed while backgrounded RE-fires once you focus it, which
  // is exactly when it can post the "couldn't load" advisory. (The old lastAuto
  // latch blocked that re-fire.) __swRunning stops two loads overlapping.
  function maybeAuto() {
    if (localStorage.getItem('sw_auto') !== '1' || window.__swRunning) return;
    const u = location.href.split('?')[0];
    const m = u.match(/i\.\d+\.(\d+)/) || u.match(/\/product\/\d+\/(\d+)/);
    if (!m || sessionStorage.getItem('sw_sent_' + m[1])) return;
    window.__swRunning = true;
    loadSC(true).catch(() => {}).finally(() => { setTimeout(() => { window.__swRunning = false; }, 300); });
  }

  addBtn();
  // Shopee is a single-page app — re-add the button + check for auto navigation
  setInterval(() => { addBtn(); maybeAuto(); }, 1500);
})();
