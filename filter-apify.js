// Turn an Apify shopee-scraper export into a paste-ready sourcing queue.
// Takes the JSON export only (Apify: Storage -> Dataset -> Export -> JSON).
//   node filter-apify.js <dataset.json>
//
// Apify returns everything the keyword matched; this keeps only what clears the
// sourcing bar, drops what we already listed, and writes va-queue.csv — one URL per
// row, which is all the VA needs since the bookmarklet fetches the rest.
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const m = process.argv.find(a => a.startsWith('--' + k + '='));
  return m ? Number(m.split('=')[1]) : d;
};

// The bar. sold/reviews are proof it sells; the price band comes from our markup —
// max(cost x 1.5, cost + 25) means anything under ~$25 gets a 3-5x markup a buyer can
// see through, and over ~$110 the sell price leaves the range that moves on Carousell.
//
// Every threshold is a flag, because filtering happens AFTER the scrape: re-running
// with different numbers costs nothing and needs no new credits. The sensitivity
// table at the end shows what each one is turning away before you decide.
//   node filter-apify.js data.json --sold=500 --reviews=100 --rating=4.3 --min=15
// Defaults are the settings chosen after reading the first real export
// (2026-08-05). Rating sits at 3.8 because cheap SG furniture sellers simply do not
// rate above 4.5 — OSUM has 19 products and not one clears it — so a 4.5 bar
// excluded the category rather than the bad listings within it.
// 500 sold / 100 reviews rather than 1000 / 200: the sold field is a coarse bracket
// where "500+" spans 500-999 actual sales, so demanding 1000 excluded that whole
// range on no evidence, and demanding 200 reviews on top compounded it — a 4.91*
// study table with 167 reviews and 500+ sales was being turned away. Loosening
// either alone changed nothing; the two gates were hiding each other.
const MIN_SOLD = arg('sold', 100);
const MIN_REVIEWS = arg('reviews', 50);
const MIN_RATING = arg('rating', 3.8);

// Volume expectations have to scale with price, or the bar silently becomes a
// category filter. Measured on the first export: 50% of items under $20 clear
// 100 sold + 50 reviews, against 5% of items over $200. An $8 shoe rack selling 80
// units is nothing; a $600 mattress selling 80 units is a hit. A flat threshold
// encodes the economics of cheap goods and would reject nearly all furniture.
//
// Thresholds below are relative to MIN_SOLD/MIN_REVIEWS so the flags still work.
// --flat-bar turns the scaling off.
// The sold field cannot express anything between "<100" and "100+", so scaling that
// threshold down is meaningless — a product is either in the unusable bucket or at
// 100+. For dear items the gate has to come OFF, with reviews carrying the volume
// evidence instead: 20 reviews means at least 20 people bought it, which the bracket
// cannot show. 92 of 97 items over $200 sit in that bucket, and 20 of them have 15+
// reviews at 4.5*+.
//
// The rating bar rises as the sold gate falls, so less volume evidence is traded for
// more satisfaction evidence rather than for nothing.
const SCALE_BY_PRICE = !process.argv.includes('--flat-bar');
function barFor(price) {
  if (!SCALE_BY_PRICE) return { sold: MIN_SOLD, reviews: MIN_REVIEWS, rating: MIN_RATING };
  if (price >= 200) return { sold: 0, reviews: 20, rating: 4.5 };   // couches, mattresses
  if (price >= 100) return { sold: 0, reviews: 30, rating: 4.5 };   // electric desks
  return { sold: MIN_SOLD, reviews: MIN_REVIEWS, rating: MIN_RATING };
}
// --sg  keep only Singapore-located sellers. Measured on the first export: SG
// sellers were proven winners 19% of the time against 5% for everyone else, and
// they ship locally instead of the 20-25 day wait, which is what our delivery
// promise depends on.
const SG_ONLY = !process.argv.includes('--any-country');
// --trusted  also accept a product that misses the bar IF its shop has another
// product that cleared it. Turns "no evidence" into "no evidence yet, from a seller
// with evidence" — 90 such products in the first export, 18 of them with 500+
// reviews and 2k+ sales held back only by a 4.2-4.4 rating.
// On by default, and with no review floor: a duplicate listing from a proven shop
// is usually the SAME product with a DIFFERENT photo set — and since a listing is
// built per usable cover, a fresh gallery is fresh inventory, not a redundant row.
// --no-trusted turns it off.
const TRUST_SHOPS = !process.argv.includes('--no-trusted');
const TRUSTED_MIN_REVIEWS = arg('trusted-reviews', 0);
// Price band off by default (owner's call 2026-08-05): on the first real export it
// was rejecting 75 of 121 proven sellers — more than every other filter combined —
// while sold/reviews/rating were doing the real work. Restore with --min=25 --max=110.
const MIN_PRICE = arg('min', 0);
const MAX_PRICE = arg('max', 1e9);

// historicalSoldEstimated arrives as a bracket string: "1k+", "10k+", "500+", "<100".
function soldToNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/,/g, '');
  // "<100" means FEWER than 100 — the digits alone read as 100 and would let the
  // deadest listings through the moment the threshold dropped to 100.
  if (s.trim().startsWith('<')) return 0;
  const m = s.match(/([\d.]+)\s*([km]?)/i);
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

// Shops with at least one product that clears the full bar on its own merits.
// Reject only sellers Shopee says are ABROAD. The location field is empty on a third
// of rows, and treating "unknown" as "overseas" threw away 332 products — including
// the Xpanse desk already listed on Carousell, whose title literally reads
// "【SG Stock】". Where the field is blank, the title usually declares it.
// Malaysia ships to Singapore by road in days, so it is treated as usable; China and
// the rest are the 20-25 day wait the delivery promise cannot survive.
// --no-malaysia to exclude it too.
const OVERSEAS = process.argv.includes('--no-malaysia')
  ? /china|mainland|malay|malás|indon|tailand|thai|vietnam|viet/i
  : /china|mainland|indon|tailand|thai|vietnam|viet/i;
// hdb and bto are Singapore-only words — a listing selling an "hdb bto shoe rack"
// is local whatever the location field says (or doesn't).
const SG_TITLE = /\bsg\b|singapore|local stock|ready stock|sg stock|\bhdb\b|\bbto\b/i;
// Close enough to ship in days rather than weeks. Stated outright, so these need no
// SG claim in the title — a Malaysian seller will never write one.
const NEAR = process.argv.includes('--no-malaysia')
  ? /^sg$|singapore/i
  : /^sg$|singapore|malay|malás/i;
const explicitlyAbroad = (r) => OVERSEAS.test(String(r.location || '').trim());
const explicitlyNear = (r) => NEAR.test(String(r.location || '').trim());
// Sellers advertise Singapore in three places, not one: the location field, the
// product title, and — easily missed — the SHOP NAME. "SAURON.SG", "Simple .SG"
// and "JIJI.SG Official Store" were all being treated as unknown origin.
const SG_SHOP = /\.sg\b|\bsg\b|singapore/i;
const claimsSG = (r) => explicitlyNear(r)
  || SG_TITLE.test(String(r.name || ''))
  || SG_SHOP.test(String(r.shopName || ''));
// A shop that says SG on one listing is SG on the others too. SEXY MAMA has one
// listing reading "in sg stock" and another "In stock hdb bto" — same seller, and
// the location field is blank on both.
const sgShops = new Set(items.filter(r => !r._mock && !explicitlyAbroad(r) && claimsSG(r)).map(r => r.shopId));
const isSG = (r) => !explicitlyAbroad(r) && (claimsSG(r) || sgShops.has(r.shopId));
const clears = (r) => soldToNumber(r.historicalSoldEstimated) >= MIN_SOLD
  && (Number(r.reviewCount) || 0) >= MIN_REVIEWS && (Number(r.rating) || 0) >= MIN_RATING;
const provenShops = new Set(items.filter(r => !r._mock && clears(r)).map(r => r.shopId));

// Hand-rejected products, kept in blocklist.txt. Pre-order status and real delivery
// time are invisible in the Apify data — they are found by opening the listing or
// messaging the seller — so those findings have to live somewhere the filter reads,
// or they are lost every time the queue is regenerated.
const blocked = new Set();
try {
  for (const line of fs.readFileSync(path.join(__dirname, 'blocklist.txt'), 'utf8').split('\n')) {
    const id = line.trim().split(/[\s#]/)[0];
    if (/^\d+$/.test(id)) blocked.add(id);
  }
} catch { /* no blocklist yet */ }
if (blocked.size) console.log('blocklist:', blocked.size, 'hand-rejected products');

for (const it of items) {
  if (it._mock) { drop("mock row (free Apify plan returns no live data)"); continue; }
  if (blocked.has(String(it.itemId))) { drop('hand-rejected (see blocklist.txt)'); continue; }
  if (SG_ONLY && !isSG(it)) { drop('not shipped from SG'); continue; }
  const url = String(it.url || '').split('?')[0];
  if (!url) { drop('no url'); continue; }
  // Same product can arrive from several keywords and price slices.
  const id = (url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/) || []).slice(1).join('.') || url;
  if (seen.has(id)) { drop('duplicate'); continue; }

  const sold = soldToNumber(it.historicalSoldEstimated);
  const reviews = Number(it.reviewCount) || 0;
  const rating = Number(it.rating) || 0;
  const price = Number(it.price) || 0;

  // A product from a shop that already has a winner still has to show real traction
  // of its own — it just isn't held to the full bar on every axis at once.
  // Absolute floor, ahead of every other rule including the trusted-shop path: a
  // listing with no reviews at all has no evidence behind it, however good the shop.
  // Owner's rule.
  if (reviews < 1) { drop('zero reviews'); continue; }

  const vouched = TRUST_SHOPS && provenShops.has(it.shopId) && reviews >= TRUSTED_MIN_REVIEWS;
  if (!vouched) {
    // The bar moves with price: a $600 mattress is not held to a $8 shoe rack's
    // volume. See barFor().
    const bar = barFor(price);
    if (sold < bar.sold) { drop('sold < ' + bar.sold + ' (at $' + price.toFixed(0) + ')'); continue; }
    // Rating and review count are one judgement, not two gates. Reviews ARE the
    // rating — 69 reviews at 4.91 is stronger evidence than 80 at 4.19, and the old
    // pair of thresholds said the opposite. Shopee's own ratings API is closed to
    // servers, so the star average is the only summary of that text we can get, and
    // it is enough: a well-rated product needs fewer reviews to be believable.
    const needed = rating >= 4.8 ? Math.max(15, Math.round(bar.reviews * 0.8))
      : rating >= 4.5 ? bar.reviews
        : Math.round(bar.reviews * 1.5);
    if (reviews < needed) { drop('reviews < ' + needed + ' (at ' + rating.toFixed(1) + '*, $' + price.toFixed(0) + ')'); continue; }
    if (rating < bar.rating) { drop('rating < ' + bar.rating + ' (at $' + price.toFixed(0) + ')'); continue; }
  }

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

// Output path is a flag so a comparison run can't silently clobber the real queue —
// which it did: a loop testing --rating=4.5 left a 99-row file behind that then got
// archived and treated as the live queue.
//   node filter-apify.js data.json --rating=4.5 --out=/tmp/compare.csv
const OUT = (process.argv.find(a => a.startsWith('--out=')) || '--out=va-queue.csv').split('=')[1];
const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
const out = ['url,name,cost_sgd,sell_sgd,sold,reviews,rating,images,shop']
  .concat(kept.map(k => [k.url, esc(k.name), k.price, k.sell, k.sold, k.reviews, k.rating, k.images, esc(k.shop)].join(',')));
fs.writeFileSync(OUT, out.join('\n'));

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

// How much does each threshold actually cost? Re-run the whole filter at a range of
// settings so the trade-off is visible in one go, instead of guessing at a number
// and re-running by hand.
{
  const rows = items.filter(it => !it._mock && it.url);
  const uniq = new Map();
  for (const it of rows) {
    const u = String(it.url).split('?')[0];
    const id = (u.match(/-i\.(\d+)\.(\d+)/) || u.match(/\/product\/(\d+)\/(\d+)/) || []).slice(1).join('.') || u;
    if (!uniq.has(id)) uniq.set(id, {
      sold: soldToNumber(it.historicalSoldEstimated), reviews: Number(it.reviewCount) || 0,
      rating: Number(it.rating) || 0, price: Number(it.price) || 0,
    });
  }
  const all = [...uniq.values()];
  const count = (s, r, g, lo, hi) =>
    all.filter(x => x.sold >= s && x.reviews >= r && x.rating >= g && x.price >= lo && x.price <= hi).length;

  console.log('\nHOW MANY PRODUCTS AT EACH SETTING  (of ' + all.length + ' unique)');
  console.log('  preset      sold  reviews  rating   price      qualify');
  const presets = [
    ['strict', 1000, 200, 4.5, 25, 110],
    ['current', MIN_SOLD, MIN_REVIEWS, MIN_RATING, MIN_PRICE, MAX_PRICE],
    ['relaxed', 500, 100, 4.3, 20, 150],
    ['loose', 100, 50, 4.0, 15, 200],
    ['any price', MIN_SOLD, MIN_REVIEWS, MIN_RATING, 0, 1e9],
    ['no filter', 0, 0, 0, 0, 1e9],
  ];
  for (const [name, s, r, g, lo, hi] of presets) {
    const n = count(s, r, g, lo, hi);
    console.log('  ' + name.padEnd(11) + String(s).padStart(5) + String(r).padStart(9)
      + String(g).padStart(8) + ('  $' + lo + '-' + (hi >= 1e9 ? 'any' : hi)).padEnd(12)
      + String(n).padStart(6) + '  ' + '#'.repeat(Math.round(n / Math.max(all.length, 1) * 30)));
  }
  // Which single threshold is doing the most damage — relax that one first.
  console.log('\n  loosening ONE filter at a time, from current:');
  const base = count(MIN_SOLD, MIN_REVIEWS, MIN_RATING, MIN_PRICE, MAX_PRICE);
  const solo = [
    ['sold -> 500', count(500, MIN_REVIEWS, MIN_RATING, MIN_PRICE, MAX_PRICE)],
    ['reviews -> 100', count(MIN_SOLD, 100, MIN_RATING, MIN_PRICE, MAX_PRICE)],
    ['rating -> 4.3', count(MIN_SOLD, MIN_REVIEWS, 4.3, MIN_PRICE, MAX_PRICE)],
    ['price -> any', count(MIN_SOLD, MIN_REVIEWS, MIN_RATING, 0, 1e9)],
  ];
  for (const [label, n] of solo) {
    console.log('    ' + label.padEnd(16) + String(n).padStart(5) + '  (' + (n - base >= 0 ? '+' : '') + (n - base) + ')');
  }
}

console.log('\nDROPPED');
Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log('  ' + String(n).padStart(5) + '  ' + r));
console.log('\nKEPT:', kept.length, 'products ->', OUT);
if (kept.length) {
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  console.log('median cost $' + med(kept.map(k => k.price)).toFixed(2) + ' -> sells at $' + med(kept.map(k => k.sell)));
  console.log('\nTOP 10 BY SOLD VOLUME');
  kept.slice(0, 10).forEach(k => console.log('  ' + String(k.sold).padStart(6) + ' sold  $' + String(k.price).padStart(6)
    + ' -> $' + String(k.sell).padStart(3) + '  ' + String(k.reviews).padStart(5) + ' rev  ' + k.name.slice(0, 44)));
}
