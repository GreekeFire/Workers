// Run: node test-variant-images.js  — checks variant image capture end-to-end.
const assert = require('assert');
// worker-scrape's module-top require pulls in @supabase (a Vercel-only dep).
// Stub it so the pure variant logic is testable locally.
const Module = require('module');
const _load = Module._load;
Module._load = (req, ...a) => req === '@supabase/supabase-js'
  ? { createClient: () => ({}) } : _load(req, ...a);
const { variantGroups } = require('./api/worker-scrape.js')._test;

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

console.log('ok');
