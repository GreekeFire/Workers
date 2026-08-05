// Turn an Apify shopee-scraper export into a paste-ready sourcing queue.
//   node filter-apify.js <dataset.json|csv>
//
// Apify returns everything the keyword matched; this keeps only what clears the
// sourcing bar, drops what we already listed, and writes va-queue.csv — one URL per
// row, which is all the VA needs since the bookmarklet fetches the rest.
const fs = require('fs');
const path = require('path');

// The bar. sold/reviews are proof it sells; the price band is set by our own markup —
// max(cost x 1.5, cost + 25) means anything under ~$25 gets a 3-5x markup a buyer can
// see through, and over ~$110 the sell price leaves the range that moves on Carousell.
const MIN_SOLD = 1000;
const MIN_REVIEWS = 200;
const MIN_RATING = 4.5;
const MIN_PRICE = 25;
const MAX_PRICE = 110;

// historicalSoldEstimated arrives as a bracket string: "1k+", "10k+", "500+".
function soldToNumber(v) {
  if (typeof v === 'number') return v;
  const m = String(v || '').replace(/,/g, '').match(/([\d.]+)\s*([km]?)/i);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (m[2].toLowerCase() === 'k' ? 1e3 : m[2].toLowerCase() === 'm' ? 1e6 : 1));
}

const sell = (cost) => Math.ceil(Math.max(cost * 1.5, cost + 25) / 10) * 10 - 1;

const file = process.argv[2];
if (!file) { console.error('usage: node filter-apify.js <dataset.json>'); process.exit(1); }

let items = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(items)) items = items.items || [];
console.log('input rows:', items.length);

const seen = new Set();
const kept = [], reasons = {};
const drop = (r) => { reasons[r] = (reasons[r] || 0) + 1; };

for (const it of items) {
  const url = String(it.url || '').split('?')[0];
  if (!url) { drop('no url'); continue; }
  // Same product can arrive from several keywords and price slices.
  const id = (url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/) || []).slice(1).join('.') || url;
  if (seen.has(id)) { drop('duplicate'); continue; }

  const sold = soldToNumber(it.historicalSoldEstimated);
  const reviews = Number(it.reviewCount) || 0;
  const rating = Number(it.rating) || 0;
  const price = Number(it.price) || 0;

  if (sold < MIN_SOLD) { drop('sold < ' + MIN_SOLD); continue; }
  if (reviews < MIN_REVIEWS) { drop('reviews < ' + MIN_REVIEWS); continue; }
  if (rating < MIN_RATING) { drop('rating < ' + MIN_RATING); continue; }
  if (price < MIN_PRICE) { drop('price < $' + MIN_PRICE); continue; }
  if (price > MAX_PRICE) { drop('price > $' + MAX_PRICE); continue; }

  seen.add(id);
  kept.push({ url, name: it.name || '', price, sell: sell(price), sold, reviews, rating,
    images: Array.isArray(it.images) ? it.images.length : 0, shop: it.shopName || '' });
}

// Best first: proven demand, and photo-rich products yield more listings per scrape
// because every usable cover becomes its own listing.
kept.sort((a, b) => (b.images - a.images) || (b.sold - a.sold));

const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
const out = ['url,name,cost_sgd,sell_sgd,sold,reviews,rating,images,shop']
  .concat(kept.map(k => [k.url, esc(k.name), k.price, k.sell, k.sold, k.reviews, k.rating, k.images, esc(k.shop)].join(',')));
fs.writeFileSync('va-queue.csv', out.join('\n'));

console.log('\nDROPPED');
Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log('  ' + String(n).padStart(5) + '  ' + r));
console.log('\nKEPT:', kept.length, 'products -> va-queue.csv');
if (kept.length) {
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log('median cost $' + med(kept.map(k => k.price)).toFixed(2) + ' -> sells at $' + med(kept.map(k => k.sell)));
  console.log('\nTOP 10 (most images first — more covers, more listings)');
  kept.slice(0, 10).forEach(k => console.log('  ' + String(k.sold).padStart(6) + ' sold  $' + String(k.price).padStart(6)
    + ' -> $' + String(k.sell).padStart(3) + '  ' + k.images + ' imgs  ' + k.name.slice(0, 48)));
}
