// Regression tests for the positional-index fixes in work.html.
// Runs the app's inline <script> in a Node vm with a stubbed DOM, localStorage
// and Supabase client, then drives the fixed code paths directly.
//
//   node test-fixes.mjs
//
// P1: FIX-tab "Edit links" saves to Supabase by stable id (no urlOverrides)
// P2: SALES search resolves done entries by id, never by stored position
// P3: NEW-tab save inserts a row into the listings table

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
  };
}
const documentStub = {
  hidden: false,
  activeElement: null,
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

const sbCalls = [];
let nextInsertId = 501;
function from(table) {
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
      else if (call.op === 'select') result = { data: call.single ? null : [], error: null };
      else result = { data: null, error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return b;
}
const sbStub = {
  from,
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

  // Seed state: two active listings (ids 101, 102)
  LISTINGS = [
    ['Wireless Keyboard', 'https://shopee/A', 'https://caro/A', '29.4', '54.9'],
    ['Foldable Chair',    'https://shopee/B', 'https://caro/B', '17.8', '44.9'],
  ];
  LISTING_IDS = [101, 102];
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
    LISTINGS[0][1] === 'https://shopee/UPDATED' && LISTINGS[0][2] === 'https://caro/UPDATED',
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
})()
`;

// ── Run ──────────────────────────────────────────────────────────────────────
const sandbox = {
  console, setTimeout, clearTimeout,
  requestAnimationFrame: () => {},
  document: documentStub,
  localStorage: localStorageStub,
  navigator: { onLine: true, clipboard: { writeText: async () => {} } },
  window: { addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {} },
  supabase: { createClient: () => sbStub },
  __report, __sbCalls: sbCalls,
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
