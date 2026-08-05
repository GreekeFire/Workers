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
// Price band is the one filter worth arguing about, so it's adjustable without
// editing the file:  node filter-apify.js data.json --min=0 --max=9999
// Whatever it's set to, the report below shows the price spread of everything that
// passed the quality bar — so the cost of the band is visible, not assumed.
const arg = (k, d) => {
  const m = process.argv.find(a => a.startsWith('--' + k + '='));
  return m ? Number(m.split('=')[1]) : d;
};
const MIN_PRICE = arg('min', 25);
const MAX_PRICE = arg('max', 110);

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
// Everything that cleared sold/reviews/rating, regardless of price — this is what
// the price band is actually costing us, and it's only visible if we keep it.
const qualityPassed = [];
const drop = (r) => { reasons[r] = (reasons[r] || 0) + 1; };

for (const it of items) {
  if (it._mock) { drop("mock row (free Apify plan returns no live data)"); continue; }
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

  seen.add(id);
  qualityPassed.push(price);
  if (price < MIN_PRICE) { drop('price < $' + MIN_PRICE); continue; }
  if (price > MAX_PRICE) { drop('price > $' + MAX_PRICE); continue; }

  kept.push({ url, name: it.name || '', price, sell: sell(price), sold, reviews, rating,
    images: Array.isArray(it.images) ? it.images.length : 0, shop: it.shopName || '' });
}

// Best first: proven demand, then social proof. NOT by image count — the actor
// returns at most 5 image URLs per product, so it cannot tell a 27-image listing
// from an 81-image one, which is the difference between 11 covers and 47. Photo
// richness only becomes visible once our own scraper opens the product page.
kept.sort((a, b) => (b.sold - a.sold) || (b.reviews - a.reviews));

const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
const out = ['url,name,cost_sgd,sell_sgd,sold,reviews,rating,images,shop']
  .concat(kept.map(k => [k.url, esc(k.name), k.price, k.sell, k.sold, k.reviews, k.rating, k.images, esc(k.shop)].join(',')));
fs.writeFileSync('va-queue.csv', out.join('\n'));

// What the price band costs. Everything here already sells well and is well rated —
// the only reason it isn't in the queue is its price.
if (qualityPassed.length) {
  const BANDS = [[0, 15], [15, 25], [25, 50], [50, 80], [80, 110], [110, 150], [150, 300], [300, 1e9]];
  const sellAt = c => Math.ceil(Math.max(c * 1.5, c + 25) / 10) * 10 - 1;
  console.log('\nPRICE SPREAD of the ' + qualityPassed.length + ' products that passed sold/reviews/rating');
  console.log('  cost band     count   would sell at   in queue?');
  for (const [lo, hi] of BANDS) {
    const n = qualityPassed.filter(p => p >= lo && p < hi).length;
    if (!n) continue;
    const inBand = lo >= MIN_PRICE && hi <= MAX_PRICE + 1;
    const label = hi >= 1e9 ? '$' + lo + '+' : '$' + lo + '-' + hi;
    console.log('  ' + label.padEnd(13) + String(n).padStart(5)
      + '   $' + String(sellAt(lo)).padStart(4) + '-' + String(sellAt(Math.min(hi, lo * 2 + 50))).padEnd(5)
      + '   ' + (inBand ? 'yes' : 'NO  <- widen --min/--max to include')
      + '   ' + '#'.repeat(Math.round(n / qualityPassed.length * 30)));
  }
  const excluded = qualityPassed.filter(p => p < MIN_PRICE || p > MAX_PRICE).length;
  console.log('  -> the $' + MIN_PRICE + '-' + MAX_PRICE + ' band excludes ' + excluded
    + ' of ' + qualityPassed.length + ' good products ('
    + Math.round(excluded / qualityPassed.length * 100) + '%)');
}

console.log('\nDROPPED');
Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log('  ' + String(n).padStart(5) + '  ' + r));
console.log('\nKEPT:', kept.length, 'products -> va-queue.csv');
if (kept.length) {
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log('median cost $' + med(kept.map(k => k.price)).toFixed(2) + ' -> sells at $' + med(kept.map(k => k.sell)));
  console.log('\nTOP 10 BY SOLD VOLUME');
  kept.slice(0, 10).forEach(k => console.log('  ' + String(k.sold).padStart(6) + ' sold  $' + String(k.price).padStart(6)
    + ' -> $' + String(k.sell).padStart(3) + '  ' + String(k.reviews).padStart(5) + ' rev  ' + k.name.slice(0, 44)));
}
