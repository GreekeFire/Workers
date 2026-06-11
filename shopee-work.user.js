// ==UserScript==
// @name         Shopee → Work
// @namespace    steadymart
// @version      1.0
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

  function addBtn() {
    if (!document.body || document.getElementById('sw-fab')) return;
    const b = document.createElement('button');
    b.id = 'sw-fab';
    b.textContent = '→ Work';
    b.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#16a34a;color:#fff;' +
      'border:0;border-radius:24px;padding:12px 18px;font:700 14px system-ui;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer';
    b.onclick = () => {
      b.disabled = true;
      b.textContent = '…';
      // Cache-bust so each click runs the latest sc.js
      fetch('https://workers-v1.vercel.app/sc.js?' + Date.now())
        .then(r => r.text())
        .then(t => { (0, eval)(t); })
        .catch(e => alert('load ' + e))
        .finally(() => { setTimeout(() => { b.disabled = false; b.textContent = '→ Work'; }, 1500); });
    };
    document.body.appendChild(b);
  }

  addBtn();
  // Shopee is a single-page app — re-add the button after client-side navigation
  setInterval(addBtn, 2000);
})();
