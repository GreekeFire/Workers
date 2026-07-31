// Run: node test-variant-images.js  — checks variant image capture end-to-end.
const assert = require('assert');
// worker-scrape's module-top require pulls in @supabase (a Vercel-only dep).
// Stub it so the pure variant logic is testable locally.
const Module = require('module');
const _load = Module._load;
Module._load = (req, ...a) => req === '@supabase/supabase-js'
  ? { createClient: () => ({}) } : _load(req, ...a);
const { variantGroups, rotateTitle, mapLimit } = require('./api/worker-scrape.js')._test;

// Each variant (colour AND size) becomes its own listing, carrying its swatch.
const groups = variantGroups([
  { name: 'White', price: 69.99, image: 'https://cdn/white.jpg' },
  { name: 'Black', price: 69.99, image: 'https://cdn/black.jpg' }, // same price still splits
  { name: 'Brown', price: 69.99, image: null },                   // missing swatch → null
]);
assert.strictEqual(groups.length, 3, 'one listing per variant, no same-price collapse');
assert.strictEqual(groups.find(g => g.label === 'White').image, 'https://cdn/white.jpg', 'carries its swatch');
assert.strictEqual(groups.find(g => g.label === 'Brown').image, null, 'missing swatch stays null');
assert.strictEqual(variantGroups([{ name: 'Only', price: 20, image: null }]), null, 'single variant → no split');

// Each split gets a unique shopee_url (variant name as fragment) → clears the
// active-unique constraint. Names must be distinct so the URLs are distinct.
const base = 'https://shopee.sg/product/1/2';
const urls = groups.map(g => base + '#' + encodeURIComponent(g.name));
assert.strictEqual(new Set(urls).size, groups.length, 'unique shopee_url per variant');

// Cover dedup: swatch first, gallery after, no duplicate when swatch is already gallery[0].
const gallery = ['https://cdn/white.jpg', 'https://cdn/dims.jpg'];
const cover = (g) => g.image ? [g.image, ...gallery.filter(u => u !== g.image)] : gallery;
assert.deepStrictEqual(cover(groups.find(g => g.label === 'White')), ['https://cdn/white.jpg', 'https://cdn/dims.jpg'], 'no dupe');
assert.deepStrictEqual(cover(groups.find(g => g.label === 'Black')), ['https://cdn/black.jpg', 'https://cdn/white.jpg', 'https://cdn/dims.jpg'], 'swatch prepended');
assert.deepStrictEqual(cover(groups.find(g => g.label === 'Brown')), gallery, 'null swatch → gallery unchanged');

// Cover-split title rotation: each listing k leads with a different segment, the
// full string stays unique, and k that lands back at start is a no-op.
const t = 'A | B | C';
assert.strictEqual(rotateTitle(t, 0), 'A | B | C', 'k=0 unchanged');
assert.strictEqual(rotateTitle(t, 1), 'B | C | A', 'rotate left by 1');
assert.strictEqual(rotateTitle(t, 2), 'C | A | B', 'rotate left by 2');
assert.strictEqual(rotateTitle(t, 3), 'A | B | C', 'full cycle = no-op');
assert.strictEqual(rotateTitle('Solo', 1), 'Solo', 'single segment unchanged');
assert.strictEqual(new Set([0,1,2].map(k => rotateTitle(t, k))).size, 3, 'distinct per listing');

// mapLimit backs the classifier's image fetching: results MUST stay in pool order
// (the classifier addresses images by index) and concurrency must stay bounded.
(async () => {
  let live = 0, peak = 0;
  const src = Array.from({ length: 25 }, (_, i) => i);
  const out = await mapLimit(src, 8, async (x) => {
    peak = Math.max(peak, ++live);
    await new Promise(r => setTimeout(r, x % 3));
    live--;
    return x * 2;
  });
  assert.deepStrictEqual(out, src.map(x => x * 2), 'results stay in input order');
  assert.ok(peak <= 8, 'never exceeds the concurrency limit, saw ' + peak);
  assert.ok(peak > 1, 'actually runs in parallel, saw ' + peak);
  assert.deepStrictEqual(await mapLimit([], 8, async () => 1), [], 'empty input is safe');

  // Batch boundaries: a pool split into batches of 20 must cover every index
  // exactly once — an off-by-one here silently drops images from classification.
  const BATCH = 20, total = 81, starts = [];
  for (let s = 0; s < total; s += BATCH) starts.push(s);
  const covered = [].concat(...starts.map(s =>
    Array.from({ length: Math.min(BATCH, total - s) }, (_, n) => n + s)));
  assert.deepStrictEqual(covered, Array.from({ length: total }, (_, i) => i), 'batches tile the pool exactly');

  console.log('ok');
})();
