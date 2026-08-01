// Re-run the classifier over images it ALREADY accepted as covers, using the
// current (strict) prompt. Every one of these was a "cover" before, so anything it
// now calls skip is a change of mind — that delta is the whole point of the test.
//   node test-strict-covers.js
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^(OPENROUTER_API_KEY|CLASSIFY_MODEL|SUPABASE_SERVICE_ROLE_KEY)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const Module = require('module');
const _load = Module._load;
Module._load = (req, ...a) => req === '@supabase/supabase-js' ? { createClient: () => ({}) } : _load(req, ...a);
const { classifyGallery } = require('./api/worker-scrape.js')._test;

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const B = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/';

(async () => {
  const rows = await (await fetch(B + 'listings?select=images,shopee_url&shopee_url=like.*24260871965*&order=id.asc',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json();
  const urls = [...new Set(rows.map(r => (r.images || [])[0]).filter(Boolean))];
  console.log('re-judging', urls.length, 'images that were all accepted as covers before\n');

  const res = await classifyGallery(urls);
  if (!res) { console.log('classification failed'); return; }

  const role = {};
  for (const r of res) role[r.i] = r.role;
  const keep = [], drop = [];
  urls.forEach((u, i) => (role[i] === 'cover' ? keep : drop).push(i));

  console.log('KEPT as cover :', keep.length, keep.map(i => 'c' + i).join(' '));
  console.log('NOW SKIPPED   :', drop.length, drop.map(i => 'c' + i).join(' '));
  console.log('answers returned:', res.length, '/', urls.length);
  fs.writeFileSync('strict-result.json', JSON.stringify({ urls, keep, drop }, null, 1));
})();
