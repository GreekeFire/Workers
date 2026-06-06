/**
 * bridge.js — injected into workers-v1.vercel.app
 * Bridges postMessage calls from work.html to the extension background.
 *
 * work.html sends:  window.postMessage({ type: 'SM_SCRAPE', url: '...' }, '*')
 * bridge replies:   window.postMessage({ type: 'SM_RESULT', ok, product, error }, '*')
 *
 * work.html can also check if extension is present:
 *   window.postMessage({ type: 'SM_PING' }, '*')
 *   → window.postMessage({ type: 'SM_PONG' }, '*')
 */

window.addEventListener('message', async (e) => {
  if (e.source !== window) return;

  // Presence check
  if (e.data?.type === 'SM_PING') {
    window.postMessage({ type: 'SM_PONG' }, '*');
    return;
  }

  // Scrape a Shopee URL
  if (e.data?.type === 'SM_SCRAPE') {
    const { url, reqId } = e.data;
    if (!url) {
      window.postMessage({ type: 'SM_RESULT', reqId, ok: false, error: 'No URL provided' }, '*');
      return;
    }

    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_BY_URL', url });
      window.postMessage({ type: 'SM_RESULT', reqId, ...resp }, '*');
    } catch (err) {
      window.postMessage({ type: 'SM_RESULT', reqId, ok: false, error: err.message }, '*');
    }
  }
});

console.log('[SM Bridge] ready on', location.href);
