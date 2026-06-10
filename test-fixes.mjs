// Regression tests for work.html fixes.
// Runs the app's inline <script> in a Node vm with a stubbed DOM, localStorage
// and Supabase client, then drives the fixed code paths directly.
//
//   node test-fixes.mjs
//
// P1: FIX-tab "Edit links" saves to Supabase by stable id (no urlOverrides)
// P2: SALES search resolves done entries by id, never by stored position
// P3: NEW-tab save inserts a row into the listings table
// S1: null source_cost can't slip through markDone as the string 'null'
// S2: extension price autofill sets editedCost (was a dead DOM write)
// T4: double-tap Save can't insert duplicate rows
// T5: entering the LISTINGS tab clears the stale search cache
// Q2: NEW-tab draft persists and restores the cost field
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
    click() {}, remove() {},
  };
}
const documentStub = {
  hidden: false,
  activeElement: null,
  body: makeEl('body'),
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  querySelector() { return null; },
  createElement(tag) { return makeEl('created-' + tag); },
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
      order() { return b; }, ilike() { return b; }, limit() { return b; },
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

  // ── P3: NEW-tab save inserts a listings row ──
  __sbCalls.length = 0;
  document.getElementById('new-title-ta').value        = 'Brand New Lamp';
  document.getElementById('new-desc-ta').value         = 'A lamp.';
  document.getElementById('new-cost-input').value      = '15';
  document.getElementById('new-shopee-fetch-url').value = 'https://shopee/new';
  document.getElementById('new-caro-url').value        = 'https://caro/new';
  const doneCountBefore = doneData.length;
  await saveNewListing();
  const ins = __sbCalls.find(c => c.op === 'insert' && c.table === 'listings');
  __report('P3: inserts a row into the listings table',
    !!ins, JSON.stringify(ins && ins.payload));
  __report('P3: row is complete (title/urls/cost/sell/status done)',
    !!ins && ins.payload.title === 'Brand New Lamp'
          && ins.payload.shopee_url === 'https://shopee/new'
          && ins.payload.carousell_url === 'https://caro/new'
          && ins.payload.source_cost === 15
          && ins.payload.sell_price === 40
          && ins.payload.status === 'done',
    JSON.stringify(ins && ins.payload));
  const added = doneData[doneData.length - 1];
  __report('P3: doneData entry stamped with the returned row id',
    doneData.length === doneCountBefore + 1 && added.id === 501 && added.title === 'Brand New Lamp',
    JSON.stringify({ id: added.id, title: added.title }));
  __report('P3: NEW tab reset after save', newTitle === '' && newDesc === '' && newCost === '',
    JSON.stringify({ newTitle, newDesc, newCost }));

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
  markDone();
  const sUpd = __sbCalls.find(c => c.op === 'update' && c.table === 'listings');
  __report('S1: valid cost still marks done and updates status by id',
    doneData.length === dlen + 1 && !!sUpd && eq(sUpd.filters, [['id', 7]]) && sUpd.payload.status === 'done',
    JSON.stringify({ len: doneData.length, upd: sUpd && sUpd.filters }));

  // ── S2: extension price autofill sets editedCost ──
  LISTINGS = [{ id: 301, title: 'No Cost Item', shopee: 'https://shopee/X', caro: '', cost: '', sell: '' }];
  currentIndex = 0;
  doneSet = new Set(); deletedSet = new Set();
  editedCost = null; shopeeInput = '';
  window.__product = { name: 'Foo Product', description: 'Nice thing', images: [], price_min_sgd: 25 };
  document.getElementById('fix-shopee-fetch-url').value = 'https://shopee.sg/foo';
  await fetchShopeeDataFix();
  await tick(20);
  __report('S2: extension price autofills editedCost when listing has no cost',
    editedCost === 25, String(editedCost));
  __report('S2: autofill survives the re-render (cost input shows 25)',
    document.getElementById('listing-wrap').innerHTML.includes('value="25"'),
    'editedCost=' + editedCost);

  editedCost = null; shopeeInput = '';
  LISTINGS[0].cost = '29.4';
  await fetchShopeeDataFix();
  await tick(20);
  __report('S2: an existing valid cost is not overwritten by the fetch',
    editedCost === null, String(editedCost));

  // ── T4: double-tap Save inserts exactly one row ──
  __sbCalls.length = 0;
  const beforeLen = doneData.length;
  document.getElementById('new-title-ta').value        = 'Dup Test Item';
  document.getElementById('new-desc-ta').value         = '';
  document.getElementById('new-cost-input').value      = '10';
  document.getElementById('new-shopee-fetch-url').value = '';
  document.getElementById('new-caro-url').value        = '';
  const q1 = saveNewListing(); const q2 = saveNewListing();
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

  // ── Q2: NEW-tab draft persists the cost ──
  newTitle = 'Draft Item'; newDesc = ''; newShopeeInput = '';
  newShopeeUrl = ''; newCaroUrl = ''; newCost = '33';
  saveDraft();
  const draft = JSON.parse(localStorage.getItem('carobiz_new_draft'));
  __report('Q2: draft includes the cost field', draft.cost === '33', JSON.stringify(draft));
  newCost = ''; newTitle = '';
  loadLocal();
  __report('Q2: loadLocal restores the cost from the draft',
    newCost === '33' && newTitle === 'Draft Item', JSON.stringify({ newCost, newTitle }));
  localStorage.removeItem('carobiz_new_draft');

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
