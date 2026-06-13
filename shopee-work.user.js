// ==UserScript==
// @name         Shopee → Work
// @namespace    steadymart
// @version      1.5
// @description  Floating button on Shopee pages that sends the current product to work.html. Loads the hosted sc.js so all scraping logic stays in one place and auto-updates. Shows the live scrape result on the button and an AUTO session counter.
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

  // Products auto-scraped this browsing session (sc.js sets sw_sent_<itemid>).
  const sentCount = () => Object.keys(sessionStorage).filter(k => k.indexOf('sw_sent_') === 0).length;

  const IDLE = '↓ Grab';
  // Shared pill look; each state just swaps background + glow.
  const PILL = 'color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:22px;' +
    'padding:11px 20px;font:700 14px system-ui;letter-spacing:.2px;cursor:pointer;' +
    'transition:background .15s ease, box-shadow .15s ease';
  const GLOW = {
    idle: 'background:#16a34a;box-shadow:0 6px 20px rgba(22,163,74,.4)',
    busy: 'background:#374151;box-shadow:0 6px 18px rgba(0,0,0,.35)',
    ok:   'background:#15803d;box-shadow:0 6px 22px rgba(21,128,61,.5)',
    bad:  'background:#dc2626;box-shadow:0 6px 22px rgba(220,38,38,.5)',
  };

  let autoChip, workBtn, awaiting = false, revertTimer;

  function setState(state, text) {
    workBtn.style.cssText = PILL + ';' + GLOW[state];
    workBtn.textContent = text;
  }

  function paintAuto() {
    if (!autoChip) return;
    const on = localStorage.getItem('sw_auto') === '1';
    const n = sentCount();
    autoChip.textContent = (on ? 'AUTO ●' : 'auto ○') + (n ? ' · ' + n : '');
    autoChip.style.background = on ? '#16a34a' : '#374151';
  }

  function idleBtn() {
    awaiting = false;
    workBtn.disabled = false;
    setState('idle', IDLE);
  }

  // Flash success (✓ $price) or failure (✗ retry) on the button, then revert.
  function flashBtn(ok, label) {
    clearTimeout(revertTimer);
    workBtn.disabled = false;
    setState(ok ? 'ok' : 'bad', ok ? ('✓ ' + (label || 'sent')) : '✗ retry');
    revertTimer = setTimeout(idleBtn, 1800);
  }

  // sc.js dispatches sw:result on every toast. Reflect a manual scrape on the
  // button, and repaint the AUTO counter for both manual and auto scrapes.
  window.addEventListener('sw:result', (e) => {
    const ok = !!(e.detail && e.detail.ok);
    const msg = (e.detail && e.detail.msg) || '';
    if (awaiting) {
      awaiting = false;
      const price = (msg.match(/\$[\d.]+/) || [''])[0];   // pull "$x.xx" from the toast text
      flashBtn(ok, price || 'sent');
    }
    paintAuto();
  });

  function addBtn() {
    if (!document.body || document.getElementById('sw-fab')) return;
    const wrap = document.createElement('div');
    wrap.id = 'sw-fab';
    wrap.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
      'display:flex;flex-direction:column;gap:8px;align-items:flex-end';

    // AUTO toggle chip — flips the sw_auto localStorage flag (read by maybeAuto + sc.js)
    autoChip = document.createElement('button');
    autoChip.style.cssText =
      'border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:6px 12px;' +
      'font:700 11px system-ui;letter-spacing:.2px;color:#fff;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    autoChip.onclick = () => {
      localStorage.setItem('sw_auto', localStorage.getItem('sw_auto') === '1' ? '0' : '1');
      paintAuto();
    };

    workBtn = document.createElement('button');
    setState('idle', IDLE);
    workBtn.onclick = () => {
      clearTimeout(revertTimer);
      awaiting = true;
      workBtn.disabled = true;
      setState('busy', '↓ …');
      // Cache-bust so each click runs the latest sc.js (manual = fetch fallback allowed).
      // Fallback revert in case no sw:result arrives (e.g. an older sc.js without the event).
      revertTimer = setTimeout(idleBtn, 8000);
      loadSC(false).catch((err) => { console.warn('sc load', err); flashBtn(false); });
    };

    wrap.appendChild(autoChip);
    wrap.appendChild(workBtn);
    document.body.appendChild(wrap);
    paintAuto();
  }

  // AUTO harvest: when the toggle is on, load sc.js (dataLayer-only) for each
  // product. Dedup is owned by sc.js via sessionStorage 'sw_sent_<itemid>'.
  function maybeAuto() {
    if (localStorage.getItem('sw_auto') !== '1' || window.__swRunning) return;
    const u = location.href.split('?')[0];
    const m = u.match(/i\.\d+\.(\d+)/) || u.match(/\/product\/\d+\/(\d+)/);
    if (!m || sessionStorage.getItem('sw_sent_' + m[1])) return;
    window.__swRunning = true;
    loadSC(true).catch(() => {}).finally(() => { setTimeout(() => { window.__swRunning = false; }, 300); });
  }

  addBtn();
  // Shopee is a single-page app — re-add the button + check for auto navigation,
  // and keep the AUTO counter fresh as scrapes land.
  setInterval(() => { addBtn(); maybeAuto(); paintAuto(); }, 1500);
})();
