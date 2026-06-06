/**
 * build-listings.js
 * Run: node build-listings.js
 *
 * Reads "Complete - Sheet1.csv", splits into:
 *   - listings-data.js  (cost >= $15, sell price recalculated)
 *   - to-delete.csv     (cost < $15, Carousell URLs for manual deletion)
 */

const fs   = require('fs');
const path = require('path');

// Same formula as work.html
function calcSell(cost) {
  return Math.ceil(Math.max(cost * 1.5, cost + 24) / 5) * 5 - 0.1;
}

// Simple CSV parser — handles quoted fields with commas inside
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (c === ',' && !inQuote) {
        fields.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur);
    rows.push(fields);
  }
  return rows;
}

const csvPath = path.join(__dirname, 'Complete - Sheet1.csv');
const raw     = fs.readFileSync(csvPath, 'utf8');
const rows    = parseCSV(raw);

// Skip header row
const header = rows[0];
console.log('Columns:', header);

const keep   = [];
const remove = [];
let skipped  = 0;

for (let i = 1; i < rows.length; i++) {
  const [title, shopeeUrl, carousellUrl, sourceCostRaw, sellPriceRaw] = rows[i];
  if (!title?.trim()) { skipped++; continue; }

  const cost = parseFloat((sourceCostRaw || '').replace(/[$,]/g, '').trim());
  if (isNaN(cost)) { skipped++; continue; }

  if (cost < 15) {
    remove.push({ title: title.trim(), carousellUrl: (carousellUrl || '').trim(), cost });
  } else {
    const sell = calcSell(cost);
    keep.push([
      title.trim(),
      (shopeeUrl     || '').trim(),
      (carousellUrl  || '').trim(),
      cost.toFixed(2),
      sell.toFixed(2),
    ]);
  }
}

// Write listings-data.js
const jsLines = keep.map(row =>
  '[' + row.map(v => JSON.stringify(v)).join(',') + ']'
);
const jsOut = `const LISTINGS = [\n${jsLines.join(',\n')}\n];\n`;
fs.writeFileSync(path.join(__dirname, 'listings-data.js'), jsOut, 'utf8');

// Write to-delete.csv
const csvOut = ['Title,Carousell URL,Source Cost']
  .concat(remove.map(r => `"${r.title.replace(/"/g,'""')}","${r.carousellUrl}","$${r.cost.toFixed(2)}"`))
  .join('\n');
fs.writeFileSync(path.join(__dirname, 'to-delete.csv'), csvOut, 'utf8');

console.log(`\nDone.`);
console.log(`  Kept:    ${keep.length} listings → listings-data.js`);
console.log(`  Remove:  ${remove.length} listings → to-delete.csv`);
console.log(`  Skipped: ${skipped} empty/invalid rows`);
