// Read a catalogue saved by shop.js and report whether our markup survives in that
// shop's price range.  node analyze-jiji.js [path-to-shop-*.json]
const fs = require('fs');
const os = require('os');
const path = require('path');

// Default to the newest shop-*.json in Downloads — that's where shop.js puts it.
function findFile() {
  if (process.argv[2]) return process.argv[2];
  const dl = path.join(os.homedir(), 'Downloads');
  const hits = fs.readdirSync(dl).filter(f => /^shop-.*\.json$/i.test(f))
    .map(f => ({ f: path.join(dl, f), t: fs.statSync(path.join(dl, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!hits.length) throw new Error('no shop-*.json in Downloads — run the shop.js bookmarklet first');
  return hits[0].f;
}

// MUST match calcSellPrice in api/worker-scrape.js
const sell = (cost) => Math.ceil(Math.max(cost * 1.5, cost + 25) / 10) * 10;
const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;

const file = findFile();
const { username, shopid, items } = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`${username || shopid} — ${items.length} items  (${path.basename(file)})\n`);

// The owner's stated sourcing bar: real proof it sells.
const winners = items.filter(x => x.sold >= 1000 && x.reviews >= 200);

const BANDS = [[0, 15, '<$15'], [15, 25, '$15-25'], [25, 50, '$25-50'], [50, 100, '$50-100'],
  [100, 200, '$100-200'], [200, 300, '$200-300'], [300, 1e9, '>$300']];
const band = p => (BANDS.find(b => p >= b[0] && p < b[1]) || BANDS[6])[2];

const bar = (n, tot) => '#'.repeat(Math.round(n / Math.max(tot, 1) * 44));
const tally = (arr) => { const t = {}; for (const x of arr) t[band(x.price)] = (t[band(x.price)] || 0) + 1; return t; };

const all = tally(items), win = tally(winners);
console.log('PRICE SPREAD — whole catalogue');
for (const [, , k] of BANDS) console.log('  ' + k.padEnd(9) + String(all[k] || 0).padStart(4) + '  ' + bar(all[k] || 0, items.length));
console.log(`\nPRICE SPREAD — winners only (1k+ sold, 200+ reviews): ${winners.length} items`);
for (const [, , k] of BANDS) console.log('  ' + k.padEnd(9) + String(win[k] || 0).padStart(4) + '  ' + bar(win[k] || 0, winners.length));

console.log('\nmedian price   all: $' + med(items.map(x => x.price)).toFixed(2)
  + '   winners: $' + med(winners.map(x => x.price)).toFixed(2));

// The crux: below ~$15 cost the +$25 floor dominates and the markup gets extreme.
const cheapAll = items.filter(x => x.price < 15).length;
const cheapWin = winners.filter(x => x.price < 15).length;
console.log('under $15 cost  catalogue: ' + Math.round(cheapAll / items.length * 100)
  + '%   winners: ' + Math.round(cheapWin / Math.max(winners.length, 1) * 100) + '%');

const mult = winners.map(x => sell(x.price) / Math.max(x.price, 0.01));
console.log('our markup on their winners  median ' + med(mult).toFixed(1) + 'x'
  + '   (>3x on ' + winners.filter(x => sell(x.price) / Math.max(x.price, .01) > 3).length + ' of ' + winners.length + ')');

console.log('\nTOP 20 BY UNITS SOLD          cost -> our price  (markup)');
for (const x of winners.slice().sort((a, b) => b.sold - a.sold).slice(0, 20)) {
  const s = sell(x.price);
  console.log('  ' + String(x.sold).padStart(6) + ' sold  $' + x.price.toFixed(2).padStart(7)
    + ' -> $' + String(s).padStart(3) + '  ' + (s / Math.max(x.price, .01)).toFixed(1).padStart(4) + 'x  '
    + x.name.slice(0, 46));
}

// Where the model actually works: dear enough that the markup stays believable.
const sweet = winners.filter(x => x.price >= 15 && x.price <= 300);
console.log('\nSWEET SPOT ($15-300 cost): ' + sweet.length + ' of ' + winners.length + ' winners');
for (const x of sweet.slice().sort((a, b) => b.sold - a.sold).slice(0, 12)) {
  console.log('  ' + String(x.sold).padStart(6) + ' sold  $' + x.price.toFixed(2).padStart(7)
    + ' -> $' + String(sell(x.price)).padStart(3) + '  ' + x.name.slice(0, 52));
}
