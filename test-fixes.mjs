// Regression tests for work.html fixes.
// Runs the app's inline <script> in a Node vm with a stubbed DOM, localStorage
// and Supabase client, then drives the fixed code paths directly.
//
//   node test-fixes.mjs
//
// P1: FIX-tab "Edit links" saves to Supabase by stable id (no urlOverrides)
// P2: SALES search resolves done entries by id, never by stored position
// P3: NEW-tab card Save (saveBatchItem) inserts a row into the listings table
// S1: null source_cost can't slip through markDone as the string 'null'
// S2: FIX pull refreshes cost from the highest live variant price + change note
// T4: double-tap Save can't insert duplicate rows (saveBatchItem r._saving guard)
// T5: entering the LISTINGS tab clears the stale search cache
// Q2: resolving a NEW card consumes its belt scrape (refresh-safe queue)
// Q1: export backup reads all listings and downloads

import fs from 'node:fs';
import vm from 'node:vm';

// ── Stubs ────────────────────────────────────────────────────────────────────
const els = new Map();
function makeEl(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', className: '',
    style: {}, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    focus() {}, prepend() {}, appendChild() {}, insertBefore() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, setSelectionRange() {},
    click() {}, remove() {}, scrollIntoView() {},
  };
}
const documentStub = {
  hidden: false,
  activeElement: null,
  body: makeEl('body'),
  __created: [],
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement(tag) { const el = makeEl('created-' + tag); this.__created.push(el); return el; },
  addEventListener() {},
};

const lsStore = new Map();
const localStorageStub = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
};

// Window doubles as a message bus so the extension bridge (SM_PING/SM_SCRAPE)
// can be exercised: PING is answered with PONG, SCRAPE with __product.
const msgHandlers = new Set();
const windowStub = {
  __product: null,
  addEventListener(type, fn) { if (type === 'message') msgHandlers.add(fn); },
  removeEventListener(type, fn) { msgHandlers.delete(fn); },
  postMessage(msg) {
    const dispatch = data => setTimeout(() => { for (const fn of [...msgHandlers]) fn({ data }); }, 0);
    dispatch(msg); // pages receive their own postMessage
    if (msg?.type === 'SM_PING') dispatch({ type: 'SM_PONG' });
    if (msg?.type === 'SM_SCRAPE') dispatch({ type: 'SM_RESULT', reqId: msg.reqId, ok: true, product: windowStub.__product });
  },
  open() {},
};

const sbCalls = [];
let nextInsertId = 501;
const sbStub = {
  __nextSelectData: null,
  __appState: {},   // key → data, served to .eq('key', …).single() selects
  from(table) {
    const call = { table, op: null, payload: null, filters: [], single: false };
    const b = {
      select(cols) { if (!call.op) call.op = 'select'; call.selected = cols; return b; },
      insert(p) { call.op = 'insert'; call.payload = p; return b; },
      update(p) { call.op = 'update'; call.payload = p; return b; },
      upsert(p) { call.op = 'upsert'; call.payload = p; return b; },
      delete() { call.op = 'delete'; return b; },
      eq(col, val) { call.filters.push([col, val]); return b; },
      in(col, vals) { call.filters.push([col, vals]); return b; },
      order() { return b; }, limit() { return b; },
      ilike(col, pat) { (call.ilikes ||= []).push(pat); return b; },
      single() { call.single = true; return b; },
      then(resolve, reject) {
        sbCalls.push(call);
        let result;
        if (call.op === 'insert' && call.single) result = { data: { id: nextInsertId++ }, error: null };
        else if (call.op === 'select' && call.single) {
          const key = call.filters.find(f => f[0] === 'key')?.[1];
          const val = key != null ? sbStub.__appState[key] : null;
          result = { data: val == null ? null : { data: val }, error: null };
        }
        else if (call.op === 'select') result = { data: sbStub.__nextSelectData || [], error: null };
        else result = { data: null, error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return b;
  },
  auth: { getSession: async () => ({ data: { session: null } }) },
};

const report = [];
function __report(name, ok, detail) { report.push({ name, ok, detail }); }

// ── Extract app code ─────────────────────────────────────────────────────────
const html = fs.readFileSync(new URL('./work.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (blocks.length < 2) { console.error('Could not extract scripts'); process.exit(1); }
const appCode = blocks.join('\n;\n');

// ── Test driver (runs inside the vm, same scope as the app code) ─────────────
const testCode = `
;(async () => {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const tick = ms => new Promise(r => setTimeout(r, ms));
  const toastText = () => document.getElementById('toast').textContent;

  // Seed state: two active listings (ids 101, 102)
  LISTINGS = [
    { id: 101, title: 'Wireless Keyboard', shopee: 'https://shopee/A', caro: 'https://caro/A', cost: '29.4', sell: '54.9' },
    { id: 102, title: 'Foldable Chair',    shopee: 'https://shopee/B', caro: 'https://caro/B', cost: '17.8', sell: '44.9' },
  ];
  currentIndex = 0;
  doneSet = new Set(); deletedSet = new Set(); salesLog = [];
  doneData = [
    // Completed long ago; stored position 0 is STALE (now occupied by Wireless Keyboard)
    { index: 0, id: 999, title: 'Capybara Plush Pillow',
      shopeeUrl: 'https://shopee/done', carousellUrl: 'https://caro/done',
      sourceCost: 30, sellPrice: 54.9, doneAt: '2026-06-01T00:00:00Z' },
    // Legacy pre-fix entry with no id; stored position 1 is STALE (now Foldable Chair)
    { index: 1, title: 'Legacy Rug No Id',
      shopeeUrl: 'https://shopee/legacy', carousellUrl: 'https://caro/legacy',
      sourceCost: 156, sellPrice: 234.9, doneAt: '2026-05-01T00:00:00Z' },
  ];

  // ── P1: Edit links saves to Supabase by id ──
  __sbCalls.length = 0;
  document.getElementById('link-shopee-input').value = 'https://shopee/UPDATED';
  document.getElementById('link-caro-input').value   = 'https://caro/UPDATED';
  linkEditing = true;
  await saveLinkEdits();
  const upd = __sbCalls.find(c => c.op === 'update' && c.table === 'listings');
  __report('P1: updates listings row by stable id (101)',
    !!upd && eq(upd.filters, [['id', 101]]),
    JSON.stringify(upd && upd.filters));
  __report('P1: sends both URL columns',
    !!upd && upd.payload.shopee_url === 'https://shopee/UPDATED'
          && upd.payload.carousell_url === 'https://caro/UPDATED',
    JSON.stringify(upd && upd.payload));
  __report('P1: in-memory listing updated',
    LISTINGS[0].shopee === 'https://shopee/UPDATED' && LISTINGS[0].caro === 'https://caro/UPDATED',
    JSON.stringify(LISTINGS[0]));
  __report('P1: no positional urlOverrides written to localStorage',
    localStorage.getItem('carobiz_url_overrides') === null,
    String(localStorage.getItem('carobiz_url_overrides')));
  __report('P1: edit mode closed', linkEditing === false, String(linkEditing));

  // ── P2: search resolves done entries by id, not stored position ──
  const dropdown = document.getElementById('search-dropdown');

  searchListings('capybara');
  __report('P2: done entry (id not active) gets listingIdx null, not stale position 0',
    _searchMatches.length === 1 && _searchMatches[0].listingIdx === null,
    JSON.stringify(_searchMatches.map(m => m.listingIdx)));
  __report('P2: done entry uses its own stored URLs (no LISTINGS[stale] fallback)',
    _searchMatches[0].shopee === 'https://shopee/done' && _searchMatches[0].caro === 'https://caro/done',
    JSON.stringify([_searchMatches[0].shopee, _searchMatches[0].caro]));
  __report('P2: no "Go to Fix" rendered for a completed listing',
    !dropdown.innerHTML.includes('Go to Fix'), dropdown.innerHTML.slice(0, 120));

  searchListings('legacy');
  __report('P2: legacy entry without id also resolves to null (was stale 1 = wrong listing)',
    _searchMatches.length === 1 && _searchMatches[0].listingIdx === null,
    JSON.stringify(_searchMatches.map(m => m.listingIdx)));

  searchListings('foldable');
  __report('P2: active listing still matches with its real position',
    _searchMatches.length === 1 && _searchMatches[0].listingIdx === 1,
    JSON.stringify(_searchMatches.map(m => m.listingIdx)));
  __report('P2: active listing still offers "Go to Fix"',
    dropdown.innerHTML.includes('Go to Fix'), dropdown.innerHTML.slice(0, 120));

  // Failed status-write case: done entry whose id IS still active resolves to its CURRENT position
  doneData.push({ index: 0, id: 102, title: 'Failed Write Chair',
    shopeeUrl: 's', carousellUrl: 'c', sourceCost: 17.8, sellPrice: 44.9,
    doneAt: '2026-06-09T00:00:00Z' });
  searchListings('failed write');
  __report('P2: entry with still-active id resolves to current position 1 (stored stale 0 ignored)',
    _searchMatches.length === 1 && _searchMatches[0].listingIdx === 1,
    JSON.stringify(_searchMatches.map(m => m.listingIdx)));
  doneData.pop();

  // Cost autofill comes from the done entry itself
  searchListings('capybara');
  selectMatch(0);
  __report('P2: selecting a done match autofills its own cost (30), not a wrong listing\\'s',
    String(document.getElementById('sale-cost').value) === '30',
    String(document.getElementById('sale-cost').value));
  __report('P2: selecting a done match fills name',
    document.getElementById('sale-listing').value === 'Capybara Plush Pillow',
    document.getElementById('sale-listing').value);

  // ── P3: NEW-tab card Save inserts a listings row ──
  // The single NEW form was unified into card-based newBatchResults[]; saving a
  // card is saveBatchItem(i). Carousell url lives on the done-history entry, not
  // the listings row insert.
  __sbCalls.length = 0;
  newBatchResults.length = 0;
  newBatchResults.push({
    url: 'https://shopee/new', status: 'done',
    title: 'Brand New Lamp', desc: 'A lamp.', price: 15,
    caroUrl: 'https://caro/new', images: [], sourceText: '', inboxId: 'inbox-new',
  });
  const doneCountBefore = doneData.length;
  await saveBatchItem(0);
  const ins = __sbCalls.find(c => c.op === 'insert' && c.table === 'listings');
  __report('P3: inserts a row into the listings table',
    !!ins, JSON.stringify(ins && ins.payload));
  __report('P3: row is complete (title/shopee_url/cost/sell/status done)',
    !!ins && ins.payload.title === 'Brand New Lamp'
          && ins.payload.shopee_url === 'https://shopee/new'
          && ins.payload.source_cost === 15
          && ins.payload.sell_price === 40
          && ins.payload.status === 'done',
    JSON.stringify(ins && ins.payload));
  const added = doneData[doneData.length - 1];
  __report('P3: doneData entry stamped with the returned row id and Carousell url',
    doneData.length === doneCountBefore + 1 && added.id === 501
      && added.title === 'Brand New Lamp' && added.carousellUrl === 'https://caro/new',
    JSON.stringify({ id: added.id, title: added.title, caro: added.carousellUrl }));
  __report('P3: card removed from batch after save and its belt scrape consumed',
    newBatchResults.length === 0
      && __sbCalls.some(c => c.op === 'update' && c.table === 'scrape_inbox'
            && c.payload.consumed === true && eq(c.filters, [['id', 'inbox-new']])),
    JSON.stringify({ remaining: newBatchResults.length }));

  // ── S1: null cost can't slip through markDone ──
  __sb.__nextSelectData = [
    { id: 7, title: 'Null Cost Item', shopee_url: 's7', carousell_url: 'c7', source_cost: null, sell_price: null },
  ];
  await loadListingsFromSupabase();
  __sb.__nextSelectData = null;
  __report('S1: null source_cost maps to empty string, not "null"',
    LISTINGS.length === 1 && LISTINGS[0].id === 7 && LISTINGS[0].cost === '' && LISTINGS[0].sell === '',
    JSON.stringify(LISTINGS[0]));

  currentIndex = 0; editedCost = null;
  doneSet = new Set(); deletedSet = new Set();
  const dlen = doneData.length;
  markDone();
  __report('S1: markDone blocked when cost is empty',
    doneData.length === dlen && toastText() === 'Enter a cost before marking Done', toastText());

  LISTINGS[0].cost = 'null';   // legacy bad shape from the old String() coercion
  markDone();
  __report('S1: markDone blocked on legacy "null" string cost',
    doneData.length === dlen, String(doneData.length));

  __sbCalls.length = 0;
  editedCost = 12;
  aiTitle = 'Rewritten Fancy Title | Better Keywords';
  markDone();
  const sUpd = __sbCalls.find(c => c.op === 'update' && c.table === 'listings');
  __report('S1: valid cost still marks done and updates status by id',
    doneData.length === dlen + 1 && !!sUpd && eq(sUpd.filters, [['id', 7]]) && sUpd.payload.status === 'done',
    JSON.stringify({ len: doneData.length, upd: sUpd && sUpd.filters }));
  __report('markDone writes the final title/cost/sell back to the listings row',
    !!sUpd && sUpd.payload.title === 'Rewritten Fancy Title | Better Keywords'
           && sUpd.payload.source_cost === 12 && sUpd.payload.sell_price === 40,
    JSON.stringify(sUpd && sUpd.payload));

  // Undo Done reverses everything: queue, history, the row, and the AI work
  __sbCalls.length = 0;
  _undoFn();
  const uUpd = __sbCalls.find(c => c.op === 'update' && c.table === 'listings');
  __report('Undo Done: restores queue position, history, and the original row',
    doneData.length === dlen && !doneSet.has(0) && currentIndex === 0
      && !!uUpd && uUpd.payload.status === 'active' && uUpd.payload.title === 'Null Cost Item'
      && aiTitle === 'Rewritten Fancy Title | Better Keywords',
    JSON.stringify({ len: doneData.length, cur: currentIndex, upd: uUpd && uUpd.payload, aiTitle }));
  aiTitle = ''; editedCost = null;

  // ── S2: FIX pull refreshes cost from the live scrape ──
  // The old extension postMessage price bridge (window.__product.price_min_sgd
  // → fetchShopeeDataFix) was removed; cost now refreshes when you pull the
  // matching belt scrape in FIX, taking the highest variant price and surfacing
  // any change as an inline note. The matched row is keyed by Shopee SHOPID.ITEMID.
  const scrape = url => [{ id: 'sx', payload: {
    url, title: 'Foo Product', description: 'Nice thing', images: [],
    price_max: 25, price_min: 18, models: [{ name: 'A', price: 25 }],
  }}];
  LISTINGS = [{ id: 301, title: 'No Cost Item', shopee: 'https://shopee.sg/x-i.111.222', caro: '', cost: '', sell: '' }];
  currentIndex = 0;
  doneSet = new Set(); deletedSet = new Set();
  editedCost = null; shopeeInput = ''; fixCostNote = '';
  __sb.__nextSelectData = scrape('https://shopee.sg/x-i.111.222');
  await pullScraped('fix', true);
  __sb.__nextSelectData = null;
  __report('S2: FIX pull autofills cost from the highest variant price when listing has none',
    editedCost === '25', String(editedCost));
  __report('S2: the cost change is surfaced as an inline note',
    /\\$25\\.00/.test(fixCostNote), JSON.stringify(fixCostNote));

  // A matching (unchanged) price leaves the cost alone and sets no change note
  editedCost = null; shopeeInput = ''; fixCostNote = '';
  LISTINGS[0].cost = '25';
  __sb.__nextSelectData = scrape('https://shopee.sg/x-i.111.222');
  await pullScraped('fix', true);
  __sb.__nextSelectData = null;
  __report('S2: an unchanged price does not overwrite editedCost or set a change note',
    editedCost === null && fixCostNote === '', JSON.stringify({ editedCost, fixCostNote }));

  // ── T4: double-tap Save inserts exactly one row (guarded by r._saving) ──
  // saveBatchItem awaits the insert before splicing the card; without the guard
  // a second synchronous call reads the same card object and inserts a duplicate.
  __sbCalls.length = 0;
  const beforeLen = doneData.length;
  newBatchResults.length = 0;
  newBatchResults.push({
    url: '', status: 'done', title: 'Dup Test Item', desc: '', price: 10,
    caroUrl: '', images: [], sourceText: '',
  });
  const q1 = saveBatchItem(0); const q2 = saveBatchItem(0);
  await q1; await q2;
  const inserts = __sbCalls.filter(c => c.op === 'insert' && c.table === 'listings');
  __report('T4: double-tap Save inserts exactly one row',
    inserts.length === 1 && doneData.length === beforeLen + 1,
    JSON.stringify({ inserts: inserts.length, doneAdded: doneData.length - beforeLen }));

  // ── T5: entering LISTINGS tab clears the stale search cache ──
  _listingsCache = [{ id: 1 }]; _listingsEditingId = 9;
  switchTab('done');
  __report('T5: entering LISTINGS tab clears the stale search cache',
    _listingsCache.length === 0 && _listingsEditingId === null,
    JSON.stringify([_listingsCache.length, _listingsEditingId]));

  // ── Q2: resolving a NEW card consumes its belt scrape (refresh-safe) ──
  // The old localStorage draft was replaced by the cloud "belt": scraped cards
  // stay in scrape_inbox until Saved or Cleared, so a refresh re-pulls only
  // unresolved work and never resurfaces a card you already rejected.
  __sbCalls.length = 0;
  newBatchResults.length = 0;
  newBatchResults.push({ url: 'https://shopee/belt', status: 'done', title: 'Belt Item',
    desc: '', price: 20, caroUrl: '', images: [], sourceText: '', inboxId: 'inbox-9' });
  clearBatchItem(0);
  __report('Q2: clearing a card drops it and consumes its belt scrape by inboxId',
    newBatchResults.length === 0
      && __sbCalls.some(c => c.op === 'update' && c.table === 'scrape_inbox'
            && c.payload.consumed === true && eq(c.filters, [['id', 'inbox-9']])),
    JSON.stringify(__sbCalls.filter(c => c.table === 'scrape_inbox').map(c => c.filters)));

  // ── Q1: export backup ──
  __sbCalls.length = 0;
  __sb.__nextSelectData = [{ id: 1, title: 'Row One' }];
  await exportBackup();
  __sb.__nextSelectData = null;
  const sel = __sbCalls.find(c => c.op === 'select' && c.table === 'listings');
  __report('Q1: export reads all listings and reports success',
    !!sel && toastText() === 'Backup downloaded ✓', toastText());

  // ── S3: sale-undo reinserts by timestamp, not stale index ──
  salesLog = [
    { name: 'S-new', price: 1, sourceCost: 0, category: '', ts: '2026-06-10T12:00:00.000Z', date: '2026-06-10' },
    { name: 'S-mid', price: 2, sourceCost: 0, category: '', ts: '2026-06-09T12:00:00.000Z', date: '2026-06-09' },
    { name: 'S-old', price: 3, sourceCost: 0, category: '', ts: '2026-06-08T12:00:00.000Z', date: '2026-06-08' },
  ];
  deleteSale(1);   // remove S-mid; undo closure captures index 1
  // List shifts before the undo fires — a new sale gets logged
  salesLog.unshift({ name: 'S-newest', price: 4, sourceCost: 0, category: '', ts: '2026-06-10T13:00:00.000Z', date: '2026-06-10' });
  _undoFn();
  __report('S3: undo restores the sale at its chronological position after the list shifted',
    eq(salesLog.map(s => s.name), ['S-newest', 'S-new', 'S-mid', 'S-old']),
    JSON.stringify(salesLog.map(s => s.name)));

  // ── T2: sales sync merges instead of replacing ──
  salesLog = [
    { name: 'Unsynced New Sale', price: 50, ts: '2026-06-10T10:00:00.000Z', date: '2026-06-10' },
    { name: 'Synced Sale',       price: 20, ts: '2026-06-01T00:00:00.000Z', date: '2026-06-01' },
    { name: 'Deleted Elsewhere', price: 10, ts: '2026-05-20T00:00:00.000Z', date: '2026-05-20' },
  ];
  __sb.__appState = { carobiz_sales: [
    { name: 'Cloud Newest', price: 30, ts: '2026-06-09T00:00:00.000Z', date: '2026-06-09' },
    { name: 'Synced Sale',  price: 20, ts: '2026-06-01T00:00:00.000Z', date: '2026-06-01' },
  ]};
  __sbCalls.length = 0;
  await syncFromSupabase();
  __sb.__appState = {};
  __report('T2: local sale newer than cloud survives the sync (was silently dropped)',
    salesLog.some(s => s.name === 'Unsynced New Sale'), JSON.stringify(salesLog.map(s => s.name)));
  __report('T2: older local-only entry is treated as deleted elsewhere, not resurrected',
    !salesLog.some(s => s.name === 'Deleted Elsewhere'), JSON.stringify(salesLog.map(s => s.name)));
  __report('T2: merged log is ordered newest-first with no duplicates',
    eq(salesLog.map(s => s.name), ['Unsynced New Sale', 'Cloud Newest', 'Synced Sale']),
    JSON.stringify(salesLog.map(s => s.name)));
  __report('T2: recovered sales are pushed back to the cloud',
    __sbCalls.some(c => c.op === 'upsert' && c.payload?.key === 'carobiz_sales'),
    JSON.stringify(__sbCalls.map(c => c.op)));

  // ── Word-based search (SALES + LISTINGS) ──
  doneSet = new Set(); deletedSet = new Set();
  LISTINGS = [{ id: 401, title: 'Foldable Deck Chair Recliner', shopee: '', caro: '', cost: '20', sell: '50' }];
  doneData = [{ index: 0, id: 999, title: 'Capybara Plush Long Pillow', shopeeUrl: 's', carousellUrl: 'c',
    sourceCost: 30, sellPrice: 54.9, doneAt: '2026-06-01T00:00:00Z' }];

  searchListings('Capybara\\u00A0Plush | Long\\nPillow');
  __report('Search: pasted title with NBSP/pipes/newline matches in SALES',
    _searchMatches.length === 1 && _searchMatches[0].name === 'Capybara Plush Long Pillow',
    JSON.stringify(_searchMatches.map(m => m.name)));

  searchListings('pillow capybara');
  __report('Search: words out of order still match',
    _searchMatches.length === 1, JSON.stringify(_searchMatches.map(m => m.name)));

  searchListings('capybara sofa');
  __report('Search: a word not in the title gives no match',
    _searchMatches.length === 0, JSON.stringify(_searchMatches.map(m => m.name)));

  searchListings('deck\\u00A0chair');
  __report('Search: active LISTINGS matching is word-based too',
    _searchMatches.length === 1 && _searchMatches[0].listingIdx === 0,
    JSON.stringify(_searchMatches.map(m => m.name)));

  __sbCalls.length = 0;
  __sb.__nextSelectData = [{ id: 7, title: 'Drain Buster Air Power Plunger', shopee_url: '',
    carousell_url: '', source_cost: 9.8, sell_price: 35, status: 'done' }];
  await _searchAllListings('Drain\\u00A0Buster | Plunger');
  __sb.__nextSelectData = null;
  const sq = __sbCalls.find(c => c.table === 'listings' && c.op === 'select');
  __report('Search: LISTINGS query sends one ilike filter per word',
    !!sq && eq(sq.ilikes, ['%Drain%', '%Buster%', '%Plunger%']),
    JSON.stringify(sq && sq.ilikes));
  __report('Search: LISTINGS results render from the word-based query',
    document.getElementById('done-list').innerHTML.includes('Drain Buster'),
    document.getElementById('done-list').innerHTML.slice(0, 100));

  // ── S/C shortcuts open the current FIX listing's links ──
  LISTINGS = [{ id: 601, title: 'Shortcut Item', shopee: 'https://shopee/sc', caro: 'https://caro/sc', cost: '10', sell: '35' }];
  currentIndex = 0;
  openListingLink('shopee');
  const aS = document.__created[document.__created.length - 1];
  __report('Shortcut S: opens the Shopee link via new-tab anchor',
    aS.href === 'https://shopee/sc' && aS.target === '_blank' && aS.rel === 'noopener',
    JSON.stringify([aS.href, aS.target, aS.rel]));
  openListingLink('caro');
  const aC = document.__created[document.__created.length - 1];
  __report('Shortcut C: opens the Carousell link via new-tab anchor',
    aC.href === 'https://caro/sc' && aC.target === '_blank',
    JSON.stringify([aC.href, aC.target]));
  LISTINGS[0].caro = '';
  const createdBefore = document.__created.length;
  openListingLink('caro');
  __report('Shortcut: missing link shows a toast and opens nothing',
    toastText() === 'No Carousell link' && document.__created.length === createdBefore,
    toastText());

  // ── Queue navigation skips processed listings and wraps ──
  LISTINGS = [
    { id: 701, title: 'Nav A', shopee: '', caro: '', cost: '10', sell: '30' },
    { id: 702, title: 'Nav B', shopee: '', caro: '', cost: '10', sell: '30' },
    { id: 703, title: 'Nav C', shopee: '', caro: '', cost: '10', sell: '30' },
  ];
  doneSet = new Set([1]); deletedSet = new Set();
  currentIndex = 0;
  navQueue(1);
  __report('Nav: → skips processed listings', currentIndex === 2, String(currentIndex));
  navQueue(1);
  __report('Nav: → wraps to the start', currentIndex === 0, String(currentIndex));
  navQueue(-1);
  __report('Nav: ← goes backwards with wrap', currentIndex === 2, String(currentIndex));

  // ── Refresh re-pulls from cloud and flushes pending deletes ──
  __sbCalls.length = 0;
  undoStack = [{ idx: 0, sbId: 909 }];
  deletedSet = new Set([0]);
  __sb.__nextSelectData = [{ id: 801, title: 'Fresh Row', shopee_url: '', carousell_url: '', source_cost: 10, sell_price: 35 }];
  await refreshFromCloud();
  __sb.__nextSelectData = null;
  __report('Refresh: flushes pending deletes and reloads from cloud',
    __sbCalls.some(c => c.op === 'delete' && eq(c.filters, [['id', 909]]))
      && LISTINGS.length === 1 && LISTINGS[0].id === 801
      && deletedSet.size === 0 && undoStack.length === 0
      && toastText() === 'Refreshed ✓',
    JSON.stringify({ n: LISTINGS.length, ds: deletedSet.size, toast: toastText() }));

  // ── Download-all images ──
  fixShopeeImages = ['https://down-sg.img.susercontent.com/file/abc', 'https://down-sg.img.susercontent.com/file/def'];
  const cBefore2 = document.__created.length;
  downloadAllImages('fix');
  __report('Download all: toast announces the batch', toastText() === 'Downloading 2 images', toastText());
  await tick(500);
  const dlAnchors = document.__created.slice(cBefore2).filter(a => (a.href || '').startsWith('/api/image?url='));
  __report('Download all: one proxied download per image', dlAnchors.length === 2,
    JSON.stringify(dlAnchors.map(a => a.href)));
  fixShopeeImages = [];

  // ── Backup nudge ──
  localStorage.removeItem('carobiz_last_backup');
  localStorage.removeItem('carobiz_backup_nudge_day');
  maybeBackupNudge();
  __report('Nudge: warns when no backup exists',
    toastText() === 'No backup yet — ⬇ Backup in LISTINGS', toastText());
  toast('sentinel');
  maybeBackupNudge();
  __report('Nudge: fires at most once per day', toastText() === 'sentinel', toastText());
  localStorage.removeItem('carobiz_backup_nudge_day');
  localStorage.setItem('carobiz_last_backup', new Date().toISOString());
  maybeBackupNudge();
  __report('Nudge: silent when the backup is fresh', toastText() === 'sentinel', toastText());

  // ── SALES dropdown keyboard ──
  doneSet = new Set(); deletedSet = new Set(); LISTINGS = [];
  doneData = [{ index: 0, id: 999, title: 'Capybara Plush Long Pillow', shopeeUrl: 's', carousellUrl: 'c',
    sourceCost: 30, sellPrice: 54.9, doneAt: '2026-06-01T00:00:00Z' }];
  searchListings('capybara');
  const kev = k => ({ key: k, preventDefault() {} });
  salesSearchKey(kev('ArrowDown'));
  salesSearchKey(kev('Enter'));
  __report('Sales search: ArrowDown + Enter picks the highlighted match',
    document.getElementById('sale-listing').value === 'Capybara Plush Long Pillow',
    document.getElementById('sale-listing').value);
  searchListings('capybara');
  salesSearchKey(kev('Escape'));
  __report('Sales search: Esc closes the dropdown',
    document.getElementById('search-dropdown').style.display === 'none',
    document.getElementById('search-dropdown').style.display);

  // ── Send back to FIX fully reverses a Done ──
  LISTINGS = [{ id: 7, title: 'Accidental Done Item', shopee: '', caro: '', cost: '12', sell: '40' }];
  doneSet = new Set([0]); deletedSet = new Set();
  doneData = [{ index: 0, id: 7, title: 'Accidental Done Item', shopeeUrl: '', carousellUrl: '',
    sourceCost: 12, sellPrice: 40, doneAt: new Date().toISOString() }];
  doneTodayCount = 1;
  _listingsCache = [{ id: 7, title: 'Accidental Done Item', status: 'done' }];
  __sbCalls.length = 0;
  await listingsSendToFix(7);
  const backUpd = __sbCalls.find(c => c.op === 'update' && c.table === 'listings');
  __report('Send back to FIX: row set active and done-history entry removed',
    !!backUpd && backUpd.payload.status === 'active' && eq(backUpd.filters, [['id', 7]])
      && doneData.length === 0 && !doneSet.has(0) && doneTodayCount === 0,
    JSON.stringify({ dd: doneData.length, ds: [...doneSet], cnt: doneTodayCount }));
  __report('Send back to FIX: cleaned history is pushed to the cloud',
    __sbCalls.some(c => c.op === 'upsert' && c.payload?.key === 'carobiz_done_data'),
    JSON.stringify(__sbCalls.map(c => c.op)));
  // The poison scenario: a sync right after must NOT re-mark it done
  __sb.__appState = { carobiz_done_data: doneData.slice() };
  await syncFromSupabase();
  __sb.__appState = {};
  __report('Send back to FIX: next sync no longer re-marks it done',
    !doneSet.has(0), JSON.stringify([...doneSet]));
})()
`;

// ── Run ──────────────────────────────────────────────────────────────────────
const sandbox = {
  console, setTimeout, clearTimeout,
  requestAnimationFrame: () => {},
  document: documentStub,
  localStorage: localStorageStub,
  navigator: { onLine: true, clipboard: { writeText: async () => {} } },
  window: windowStub,
  supabase: { createClient: () => sbStub },
  // Fast-failing network: callClaude sees a non-529 error and throws immediately
  fetch: async () => ({ ok: false, status: 418, json: async () => ({ error: 'test-no-network' }) }),
  Blob: class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  __report, __sbCalls: sbCalls, __sb: sbStub,
};

try {
  await vm.runInNewContext(appCode + '\n' + testCode, sandbox, { filename: 'work.html<inline>' });
} catch (e) {
  console.error('Harness crashed:', e);
  process.exit(1);
}

let failed = 0;
for (const r of report) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n      got: ' + r.detail}`);
  if (!r.ok) failed++;
}
console.log(`\n${report.length - failed}/${report.length} passed`);
process.exit(failed ? 1 : 0);
