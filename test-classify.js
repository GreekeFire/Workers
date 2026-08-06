// One-off: run classifyGallery on a real image pool. node test-classify.js
const fs = require('fs');
// load ANTHROPIC_API_KEY from .env.local
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^(OPENROUTER_API_KEY|CLASSIFY_MODEL)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
// stub the Vercel-only supabase dep so worker-scrape imports locally
const Module = require('module');
const _load = Module._load;
Module._load = (req, ...a) => req === '@supabase/supabase-js' ? { createClient: () => ({}) } : _load(req, ...a);

const { classifyGallery } = require('./api/worker-scrape.js')._test;
const pool = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

(async () => {
  console.log('classifying', pool.length, 'images…');
  const res = await classifyGallery(pool);
  if (!res) { console.log('NULL (call failed)'); return; }
  const boundaries = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')).length;
  const src = (i) => i < 8 ? 'gallery' : i < 17 ? 'desc' : 'review';
  const covers = res.filter(r => r.role === 'cover').map(r => r.i);
  for (const r of res) {
    console.log(`  [${String(r.i).padStart(2)}] ${src(r.i).padEnd(7)} ${String(r.role).padEnd(9)} clean=${!r.needs_clean}`);
  }
  console.log(`\n  covers (${covers.length}): [${covers.join(', ')}]   dims: [${res.filter(r=>r.role==='dimension').map(r=>r.i).join(', ')}]   returned ${res.length}/${boundaries}`);
})();
