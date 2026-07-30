// Run: node test-variant-images.js  — checks variant image capture end-to-end.
const assert = require('assert');
// worker-scrape's module-top require pulls in @supabase (a Vercel-only dep).
// Stub it so the pure variant logic is testable locally.
const Module = require('module');
const _load = Module._load;
Module._load = (req, ...a) => req === '@supabase/supabase-js'
  ? { createClient: () => ({}) } : _load(req, ...a);
const { variantGroups } = require('./api/worker-scrape.js')._test;

// variantGroups carries the first swatch image per distinct price.
const groups = variantGroups([
  { name: 'Type A (30x40cm)', price: 20, image: 'https://cdn/a.jpg' },
  { name: 'Type A White',     price: 20, image: 'https://cdn/a2.jpg' }, // same price → same group, first image wins
  { name: 'Type B (50x60cm)', price: 35, image: 'https://cdn/b.jpg' },
  { name: 'Type C',           price: 50, image: null },                 // missing image → null
]);
assert.strictEqual(groups.length, 3, '3 distinct prices');
assert.strictEqual(groups.find(g => g.price === 20).image, 'https://cdn/a.jpg', 'first swatch of the price group');
assert.strictEqual(groups.find(g => g.price === 50).image, null, 'missing swatch stays null');

// Cover dedup: swatch first, gallery after, no duplicate when swatch is already gallery[0].
const gallery = ['https://cdn/a.jpg', 'https://cdn/dims.jpg'];
const cover = (g) => g.image ? [g.image, ...gallery.filter(u => u !== g.image)] : gallery;
assert.deepStrictEqual(cover(groups.find(g => g.price === 20)), ['https://cdn/a.jpg', 'https://cdn/dims.jpg'], 'no dupe');
assert.deepStrictEqual(cover(groups.find(g => g.price === 35)), ['https://cdn/b.jpg', 'https://cdn/a.jpg', 'https://cdn/dims.jpg'], 'swatch prepended');
assert.deepStrictEqual(cover(groups.find(g => g.price === 50)), gallery, 'null swatch → gallery unchanged');

console.log('ok');
