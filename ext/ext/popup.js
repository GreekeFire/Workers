// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('panel-' + t.dataset.p).classList.add('active');
}));

// ── Elements ──────────────────────────────────────────────────────────────────
const dot        = document.getElementById('dot');
const dot2       = document.getElementById('dot2');
const statusText = document.getElementById('status-text');
const logbox     = document.getElementById('logbox');
const resultsBox = document.getElementById('results-box');
const queueList  = document.getElementById('queue-list');

let kwStates = {};  // keyword → state string ('pending'|'running'|'ok'|'err')

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setRunning(on, current, queued) {
  [dot, dot2].forEach(d => d.className = 'indicator' + (on ? ' on' : ''));
  if (on && current) {
    statusText.innerHTML = `<span class="cur">${escHtml(current)}</span>&nbsp;<span class="badge">${queued} left</span>`;
  } else if (on) {
    statusText.innerHTML = `<span class="badge">${queued} left</span>`;
  } else {
    statusText.textContent = 'Idle';
  }
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog(msg) {
  const el = document.createElement('div');
  el.className = 'l' +
    (msg.includes('✓') || msg.includes('✅') ? ' ok' :
     msg.includes('✗') || msg.includes('error') ? ' err' :
     (msg.includes('→') || msg.includes('Searching') || msg.includes('Queued') || msg.includes('Batch')) ? ' hi' : '');
  el.textContent = msg;
  logbox.prepend(el);
  while (logbox.children.length > 300) logbox.lastChild.remove();
}

// ── Result cards (Bug #4 fix: actually called from PRODUCT event) ─────────────
const IMG_CDN = 'https://down-sg.img.susercontent.com/file/';

function addResultCard(p) {
  // Clear empty-state placeholder
  resultsBox.querySelectorAll('.empty-state').forEach(el => el.remove());

  const thumb = p.images?.[0] ? `${IMG_CDN}${p.images[0]}` : '';
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head">
      ${thumb ? `<img class="card-thumb" src="${escHtml(thumb)}" onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        <div class="card-name">${escHtml((p.name || '—').slice(0, 75))}</div>
        <div class="card-meta">
          <span class="card-price">SGD ${escHtml(p.price_min_sgd || '?')}</span>
          &nbsp;·&nbsp;${escHtml(String(p.sold || 0))} sold
          &nbsp;·&nbsp;⭐ ${escHtml(String(Number(p.rating || 0).toFixed(1)))}
        </div>
        <div class="card-meta" style="margin-top:3px">
          <span class="card-slug">${escHtml(p.slug || '')}</span>
          &nbsp;·&nbsp;<span class="card-imgs">${p.images?.length || 0} imgs</span>
          ${p.shop_name ? `&nbsp;·&nbsp;${escHtml(p.shop_name)}` : ''}
        </div>
      </div>
    </div>`;
  resultsBox.prepend(card);
}

// ── Batch queue grid ──────────────────────────────────────────────────────────
function renderQueue(jobs) {
  queueList.innerHTML = '';
  jobs.forEach(j => {
    kwStates[j.keyword] = 'pending';
    const row = document.createElement('div');
    row.className = 'qrow';
    row.dataset.kw = j.keyword;
    row.innerHTML = `<span class="kw">${escHtml(j.keyword)}</span><span class="st st-pending">pending</span>`;
    queueList.appendChild(row);
  });
}

// Bug #5 & #6 fix: use structured KW_STATE event, not log-text parsing
function setKwState(keyword, state) {
  kwStates[keyword] = state;
  const row = queueList.querySelector(`.qrow[data-kw="${CSS.escape(keyword)}"]`);
  if (row) {
    const s = row.querySelector('.st');
    s.className = `st st-${state}`;
    s.textContent = state;
  }
}

// ── URL Scrape button ─────────────────────────────────────────────────────────
document.getElementById('btn-scrape-url').addEventListener('click', async () => {
  const url = document.getElementById('product-url').value.trim();
  if (!url) { alert('Paste a Shopee product URL first.'); return; }

  const statusEl = document.getElementById('url-status');
  const cardEl   = document.getElementById('url-result-card');
  const btn      = document.getElementById('btn-scrape-url');

  btn.disabled = true;
  btn.textContent = '⏳ Scraping…';
  statusEl.style.color = '#f97316';
  statusEl.textContent = 'Opening Shopee in background tab…';
  cardEl.style.display = 'none';

  const resp = await chrome.runtime.sendMessage({ action: 'SCRAPE_URL', url });

  btn.disabled = false;
  btn.textContent = '▶ Scrape This Product';

  if (!resp?.ok) {
    statusEl.style.color = '#f87171';
    statusEl.textContent = '✗ ' + (resp?.error || 'Unknown error');
    return;
  }

  const p = resp.product;
  statusEl.style.color = '#4ade80';
  statusEl.textContent = `✓ Saved as "${p?.slug || 'unknown'}"`;

  if (p) {
    const thumb = p.images?.[0] ? `${IMG_CDN}${p.images[0]}` : '';
    const slug = p.slug || '';
    const variants = resp.variants || [];
    const modelPrices = resp.model_prices || [];

    // Build variant picker HTML
    let variantHtml = '';
    if (variants.length) {
      variantHtml = variants.map((v, gi) => `
        <div style="margin-top:8px">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${escHtml(v.name)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${v.options.map((o, oi) => {
              // Find price for this option if only one tier
              let priceHint = '';
              if (variants.length === 1 && modelPrices[oi]) {
                priceHint = ` · $${modelPrices[oi].price.toFixed(2)}`;
              }
              return `<button onclick="pickVariant(this,${gi},${oi},'${escHtml(slug)}')" data-gi="${gi}" data-oi="${oi}"
                style="padding:4px 10px;background:#2d3748;border:1px solid #374151;border-radius:5px;color:#94a3b8;font-size:11px;cursor:pointer">
                ${escHtml(o.label)}${priceHint}
              </button>`;
            }).join('')}
          </div>
        </div>`).join('');
    }

    // Build card via DOM (no inline onclick — blocked by extension CSP)
    const card = document.createElement('div');
    card.className = 'card';
    card.style.margin = '6px 12px';
    card.innerHTML = `
      <div class="card-head">
        ${thumb ? `<img class="card-thumb" src="${escHtml(thumb)}" onerror="this.style.display='none'">` : ''}
        <div style="flex:1;min-width:0">
          <div class="card-name">${escHtml((p.name||'—').slice(0,75))}</div>
          <div class="card-meta">
            <span class="card-price">SGD ${escHtml(String(p.price_min_sgd||'?'))}</span>
            &nbsp;·&nbsp;${escHtml(String(p.sold||0))} sold
            &nbsp;·&nbsp;<span class="card-imgs">${resp.image_count||0} imgs downloading</span>
          </div>
        </div>
      </div>`;

    // Variant buttons
    window._lastVariants = variants;
    window._lastModelPrices = modelPrices;
    window._lastSlug = slug;
    window._selectedVariants = {};

    variants.forEach((v, gi) => {
      const groupDiv = document.createElement('div');
      groupDiv.style.marginTop = '8px';
      const label = document.createElement('div');
      label.style.cssText = 'font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px';
      label.textContent = v.name;
      groupDiv.appendChild(label);
      const optsDiv = document.createElement('div');
      optsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
      v.options.forEach((o, oi) => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding:4px 10px;background:#2d3748;border:1px solid #374151;border-radius:5px;color:#94a3b8;font-size:11px;cursor:pointer';
        let priceHint = '';
        if (variants.length === 1 && modelPrices[oi]) priceHint = ` · $${modelPrices[oi].price.toFixed(2)}`;
        btn.textContent = o.label + priceHint;
        btn.addEventListener('click', () => {
          optsDiv.querySelectorAll('button').forEach(b => { b.style.background='#2d3748'; b.style.borderColor='#374151'; b.style.color='#94a3b8'; });
          btn.style.background='#f97316'; btn.style.borderColor='#f97316'; btn.style.color='#fff';
          window._selectedVariants[v.name] = { value: o.label, optIdx: oi, groupIdx: gi };
          if (variants.length === 1 && modelPrices[oi]) {
            const priceEl = card.querySelector('.card-price');
            if (priceEl) priceEl.textContent = `SGD ${modelPrices[oi].price.toFixed(2)}`;
          }
        });
        optsDiv.appendChild(btn);
      });
      groupDiv.appendChild(optsDiv);
      card.appendChild(groupDiv);
    });

    // Open in Enhance button
    const enhanceBtn = document.createElement('button');
    enhanceBtn.style.cssText = 'width:100%;margin-top:8px;padding:7px;background:#f97316;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer';
    enhanceBtn.textContent = '✦ Open in Enhance →';
    enhanceBtn.addEventListener('click', () => openInEnhance(slug));
    card.appendChild(enhanceBtn);

    cardEl.innerHTML = '';
    cardEl.appendChild(card);
    cardEl.style.display = 'block';
  }
});

function openInEnhance(slug) {
  let url = `http://localhost:7771/enhance.html?slug=${encodeURIComponent(slug)}`;
  if (window._selectedVariants) {
    const entries = Object.entries(window._selectedVariants);
    if (entries.length) {
      const v = entries[0][1];
      url += `&variant=${encodeURIComponent(v.value)}`;
      // Pass price if known
      if (window._lastModelPrices?.[v.optIdx]) {
        url += `&price=${window._lastModelPrices[v.optIdx].price.toFixed(2)}`;
      }
    }
  }
  chrome.tabs.create({ url });
  window._selectedVariants = {};
}

// ── Search button ─────────────────────────────────────────────────────────────
document.getElementById('btn-search').addEventListener('click', async () => {
  const keyword     = document.getElementById('keyword').value.trim();
  const slug_prefix = document.getElementById('slug_prefix').value.trim();
  const limit       = parseInt(document.getElementById('limit').value) || 8;
  if (!keyword) { alert('Enter a search term.'); return; }

  const resp = await chrome.runtime.sendMessage({ action:'SEARCH_SCRAPE', keyword, slug_prefix, limit });
  if (resp?.ok) {
    addLog(`→ Queued: "${keyword}"`);
    document.querySelector('.tab[data-p="log"]').click();
  } else {
    addLog(`✗ ${resp?.error || 'unknown error'}`);
  }
});

// ── Batch button ──────────────────────────────────────────────────────────────
document.getElementById('btn-batch').addEventListener('click', async () => {
  const raw = document.getElementById('batch-json').value.trim();
  if (!raw) { alert('Paste JSON batch.'); return; }
  let jobs;
  try {
    jobs = JSON.parse(raw);
    if (!Array.isArray(jobs) || !jobs.every(j => j?.keyword))
      throw new Error('Each entry needs a "keyword" field');
  } catch (e) { alert('Invalid JSON: ' + e.message); return; }

  renderQueue(jobs);
  const resp = await chrome.runtime.sendMessage({ action:'BATCH', jobs });
  if (resp?.ok) addLog(`→ Batch started: ${jobs.length} searches`);
  else addLog(`✗ Batch error: ${resp?.error}`);
});

// ── Cancel buttons ────────────────────────────────────────────────────────────
['btn-cancel','btn-cancel2'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action:'CANCEL' });
    addLog('Stopped.'); setRunning(false);
  }));

// ── Background message handler ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'LOG') {
    addLog(msg.msg);
  }

  // Bug #4 fix: PRODUCT event populates results tab
  if (msg.type === 'PRODUCT') {
    addResultCard(msg.product);
  }

  // Bug #5 & #6 fix: structured KW_STATE event (no more log-text parsing)
  if (msg.type === 'KW_STATE') {
    setKwState(msg.keyword, msg.state);
  }

  if (msg.type === 'STATUS') {
    setRunning(true, msg.current, msg.queue);
  }

  if (msg.type === 'RESEARCH_BATCH') {
    showResearchBatch(msg.jobs);
    // Switch to Research tab so user sees it arrived
    document.querySelector('.tab[data-p="research"]').click();
  }

  if (msg.type === 'DONE') {
    setRunning(false);
    addLog('✅ All done.');
    // Switch to results if there are cards
    if (resultsBox.querySelector('.card')) {
      document.querySelector('.tab[data-p="results"]').click();
    }
  }
});

// ── Research tab ──────────────────────────────────────────────────────────────
const researchQueue = document.getElementById('research-queue');
const shopeeBox     = document.getElementById('shopee-trends');

document.getElementById('btn-open-research')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:7771/research.html' });
});

document.getElementById('btn-poll-now')?.addEventListener('click', async () => {
  const resp = await chrome.runtime.sendMessage({ action: 'POLL_RESEARCH' });
  if (resp?.found) {
    showResearchBatch(resp.jobs);
    addLog(`↻ Picked up ${resp.jobs.length} keywords from research UI`);
  } else {
    addLog('↻ No pending batch found');
  }
});

document.getElementById('btn-fetch-shopee')?.addEventListener('click', async () => {
  shopeeBox.innerHTML = '<span style="color:#64748b;font-size:11px">Fetching…</span>';
  const resp = await chrome.runtime.sendMessage({ action: 'FETCH_SHOPEE_TRENDING' });
  if (resp?.ok && resp.keywords?.length) {
    renderShopeeTrends(resp.keywords);
  } else {
    shopeeBox.innerHTML = `<span style="color:#f87171;font-size:11px">${resp?.error || 'No data — Shopee may require login'}</span>
      <button class="secondary btn-small" id="btn-fetch-shopee" style="margin-top:6px" onclick="this.getRootNode().getElementById('btn-fetch-shopee').click()">Retry</button>`;
  }
});

function showResearchBatch(jobs) {
  if (!jobs?.length) {
    researchQueue.innerHTML = '<div style="color:#374151;font-size:11px;padding:8px 4px">No pending batch</div>';
    return;
  }
  researchQueue.innerHTML = jobs.map(j =>
    `<div class="qrow"><span class="kw">${escHtml(j.keyword)}</span><span class="st st-pending">queued</span></div>`
  ).join('');
}

function renderShopeeTrends(keywords) {
  shopeeBox.innerHTML = keywords.slice(0, 15).map((kw, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #1e2433">
      <span style="color:#374151;font-size:10px;width:18px">${i + 1}</span>
      <span style="flex:1;color:#e2e8f0;font-size:12px">${escHtml(kw)}</span>
      <button onclick="queueTrend('${escHtml(kw)}')"
        style="background:#1e2433;border:1px solid #2d3748;color:#f97316;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px">
        + Queue
      </button>
    </div>`).join('');
}

window.queueTrend = async (kw) => {
  const resp = await chrome.runtime.sendMessage({ action:'SEARCH_SCRAPE', keyword: kw, slug_prefix:'', limit:8 });
  if (resp?.ok) { addLog(`→ Queued from Shopee trends: "${kw}"`); }
};

// Handle RESEARCH_BATCH event from background (auto-picked up)
// (already handled in the main onMessage listener below via KW_STATE events)

// ── On popup open: sync state from background ─────────────────────────────────
(async () => {
  const s = await chrome.runtime.sendMessage({ action:'STATUS' });
  setRunning(s.running, s.current, s.queued);
  if (s.log) [...s.log].reverse().forEach(l => addLog(l));
})();
