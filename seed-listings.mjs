/**
 * seed-listings.mjs
 * Run: node seed-listings.mjs
 *
 * Reads "Complete - Sheet1.csv" and seeds the Supabase listings table.
 * - cost >= $15 → status 'active', sell price recalculated
 * - cost <  $15 → status 'to_delete', original sell price kept
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function calcSell(cost) {
  return Math.ceil(Math.max(cost * 1.5, cost + 24) / 5) * 5 - 0.1;
}

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw  = readFileSync(join(__dirname, 'Complete - Sheet1.csv'), 'utf8');
const rows = parseCSV(raw);

const records = [];
let skipped = 0;

for (let i = 1; i < rows.length; i++) {
  const [title, shopeeUrl, carousellUrl, sourceCostRaw] = rows[i];
  if (!title?.trim()) { skipped++; continue; }
  const cost = parseFloat((sourceCostRaw || '').replace(/[$,]/g, '').trim());
  if (isNaN(cost)) { skipped++; continue; }

  records.push({
    title:         title.trim(),
    shopee_url:    (shopeeUrl    || '').trim(),
    carousell_url: (carousellUrl || '').trim(),
    source_cost:   cost,
    sell_price:    cost >= 15 ? calcSell(cost) : parseFloat((rows[i][4] || '0').replace(/[$,]/g, '')),
    status:        cost >= 15 ? 'active' : 'to_delete',
  });
}

console.log(`Parsed: ${records.length} records (${skipped} skipped)`);
console.log(`  Active:    ${records.filter(r => r.status === 'active').length}`);
console.log(`  To delete: ${records.filter(r => r.status === 'to_delete').length}`);
console.log('Uploading in batches...');

// Upload in batches of 100
const BATCH = 100;
let uploaded = 0;
for (let i = 0; i < records.length; i += BATCH) {
  const batch = records.slice(i, i + BATCH);
  const { error } = await sb.from('listings').insert(batch);
  if (error) {
    console.error(`Batch ${i}-${i+BATCH} error:`, error.message);
    process.exit(1);
  }
  uploaded += batch.length;
  process.stdout.write(`\r  Uploaded ${uploaded}/${records.length}`);
}

console.log('\nDone.');
