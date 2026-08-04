// Pull a Shopee shop's catalogue sorted by sales and report what it says about
// price points — the question is whether our markup survives in that range.
//   node analyze-jiji.js [username] [maxPages]
const fs = require('fs');
const USER = process.argv[2] || 'jiji.sg';
const MAXP = Number(process.argv[3] || 12);
const H = {
  'User-Agent': 'Mozilla/5.0', Referer: 'https://shopee.sg/',
  'x-api-source': 'pc', 'x-requested-with': 'XMLHttpRequest', Accept: 'application/json',
};

// MUST match calcSellPrice in api/worker-scrape.js
const sell = (cost) => Math.ceil(Math.max(cost * 1.5, cost + 25) / 10) * 10 - 1;

(async () => {
  const shop = await (await fetch(`https://shopee.sg/api/v4/shop/get_shop_detail?username=${USER}`, { headers: H })).json();
  const d = shop.data || {};
  const shopid = d.shopid;
  console.log(`${USER} — shopid ${shopid} | ${d.item_count} items | ${d.follower_count} followers`);
  console.log(`ratings: ${d.rating_good} good / ${d.rating_normal} normal / ${d.rating_bad} bad\n`);

  const items = [];
  for (let page = 0; page < MAXP; page++) {
    const u = `https://shopee.sg/api/v4/search/search_items?by=sales&limit=100&match_id=${shopid}&newest=${page * 100}&order=desc&page_type=shop&version=2`;
    const j = await (await fetch(u, { headers: H })).json().catch(() => null);
    const batch = (j && j.items) || [];
    if (!batch.length) break;
    for (const it of batch) {
      const b = it.item_basic || it;
      items.push({
        name: b.name,
        price: (b.price || 0) / 1e5,
        sold: b.historical_sold || b.sold || 0,
        rating: (b.item_rating && b.item_rating.rating_star) || 0,
        cnt: (b.item_rating && (b.item_rating.rating_count || [])[0]) || 0,
        stock: b.stock || 0,
      });
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log('pulled', items.length, 'items\n');
  fs.writeFileSync('jiji-catalog.json', JSON.stringify(items));

  // Which of their items would clear our own sourcing bar?
  const winners = items.filter(x => x.sold >= 1000 && x.cnt >= 200);
  const band = x => x.price < 15 ? '<$15' : x.price < 25 ? '$15-25' : x.price < 50 ? '$25-50'
    : x.price < 100 ? '$50-100' : x.price < 200 ? '$100-200' : x.price < 300 ? '$200-300' : '>$300';
  const tally = {};
  for (const x of items) tally[band(x)] = (tally[band(x)] || 0) + 1;
  const order = ['<$15', '$15-25', '$25-50', '$50-100', '$100-200', '$200-300', '>$300'];

  console.log('PRICE SPREAD (whole catalogue)');
  for (const k of order) {
    const n = tally[k] || 0;
    console.log('  ' + k.padEnd(10) + String(n).padStart(4) + '  ' + '#'.repeat(Math.round(n / items.length * 50)));
  }

  const wt = {};
  for (const x of winners) wt[band(x)] = (wt[band(x)] || 0) + 1;
  console.log(`\nWINNERS ONLY (1k+ sold, 200+ reviews) — ${winners.length} items`);
  for (const k of order) if (wt[k]) console.log('  ' + k.padEnd(10) + String(wt[k]).padStart(4));

  const med = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
  console.log('\nmedian price  all:', '$' + med(items.map(x => x.price)).toFixed(2),
    '| winners: $' + med(winners.map(x => x.price)).toFixed(2));
  console.log('under $15:', Math.round(items.filter(x => x.price < 15).length / items.length * 100) + '% of catalogue,',
    Math.round(winners.filter(x => x.price < 15).length / (winners.length || 1) * 100) + '% of winners');

  console.log('\nTOP 15 BY UNITS SOLD  (cost -> our price)');
  for (const x of winners.sort((a, b) => b.sold - a.sold).slice(0, 15)) {
    console.log(`  ${String(x.sold).padStart(6)} sold  $${x.price.toFixed(2).padStart(7)} -> $${String(sell(x.price)).padStart(3)}  ${x.name.slice(0, 52)}`);
  }
})();
