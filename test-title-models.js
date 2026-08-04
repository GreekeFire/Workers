// Title bake-off. The title is how buyers find the listing, so pick it on evidence:
// every candidate writes titles for the same real products, then each output is
// scored against the rules TITLE_SYSTEM actually states.
//   node test-title-models.js
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^(OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const Module = require('module');
const _load = Module._load;
Module._load = (req, ...a) => req === '@supabase/supabase-js' ? { createClient: () => ({}) } : _load(req, ...a);
const { TITLE_SYSTEM } = require('./api/worker-scrape.js')._test;
const OR = process.env.OPENROUTER_API_KEY;

const MODELS = [
  ['google/gemini-2.5-flash', 0.30, 2.50],
  ['google/gemini-2.5-flash-lite', 0.10, 0.40],
  ['openai/gpt-5-mini', 0.25, 2.00],
  ['anthropic/claude-haiku-4.5', 1.00, 5.00],
  ['meta-llama/llama-4-maverick', 0.20, 0.80],
  ['deepseek/deepseek-v4-flash', 0.14, 0.28],
];

// Two products so a model can't win on one lucky sample.
const PRODUCTS = [
  { label: 'coat rack', text: '100% solid wood Wooden Clothes Hanger Rack Nordic Style Coat Stand.\n\nFreestanding coat rack 170cm tall. Solid beech wood pole or metal pole with marble base. 8+ hooks in two styles: tree-branch hooks for coats and hats, round disc hooks for scarves and bags. Heavy base prevents tipping. Simple screw-together assembly, no tools needed. For entryway, bedroom, living room.\n\nVariants (in stock): White Marble+Black, Gray Marble+White, Round- Walnut Color, Tripod- White' },
  { label: 'desk', text: 'OffiGo 120CM Computer Desk with Drawers Reversible Office Desk.\n\nComputer desk with 3 spacious fabric drawers. 120x48x74cm. Reversible design - drawer unit mounts on either side. Rustic brown woodgrain top with black powder-coated steel frame. Holds up to 100kg. Adjustable feet for uneven floors. Easy assembly with included tools. For home office, study, bedroom.\n\nVariants (in stock): White, Black, Brown' },
];

const BANNED = ['shopee', 'carousell', 'lazada', 'amazon', 'sg seller', 'local seller', 'free shipping', 'brand new', 'cheap', 'best '];

function score(t) {
  const segs = t.split('|').map(s => s.trim()).filter(Boolean);
  const low = t.toLowerCase();
  const dupes = segs.length - new Set(segs.map(s => s.toLowerCase())).size;
  const banned = BANNED.filter(b => low.includes(b));
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t);
  const sym = /[!@#$%*&]/.test(t);
  const hasDim = /\d+\s*(cm|mm|x\s*\d+)/i.test(t);
  const issues = [];
  if (segs.length < 8) issues.push('only ' + segs.length + ' segments');
  if (segs.length > 10) issues.push(segs.length + ' segments (max 10)');
  if (t.length > 225) issues.push(t.length + ' chars (max 225)');
  if (dupes) issues.push(dupes + ' repeated segment(s)');
  if (banned.length) issues.push('banned: ' + banned.join(','));
  if (emoji) issues.push('emoji');
  if (sym) issues.push('bad symbol');
  return { segs: segs.length, chars: t.length, hasDim, issues };
}

async function run(model, system, user, mt) {
  const t = Date.now();
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + OR, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: mt, reasoning: { exclude: true },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    const j = await r.json();
    if (!r.ok || j.error) return { err: String((j.error && j.error.message) || r.status).slice(0, 60), ms: Date.now() - t };
    const c = ((((j.choices || [])[0] || {}).message) || {}).content || '';
    return { text: String(c).trim().split('\n').filter(Boolean)[0] || '', ms: Date.now() - t, usage: j.usage || {} };
  } catch (e) { return { err: e.message.slice(0, 60), ms: Date.now() - t }; }
}

(async () => {
  for (const [model, pin, pout] of MODELS) {
    console.log('\n' + '='.repeat(74));
    console.log(model);
    let totMs = 0, totCost = 0, fails = 0, dims = 0;
    for (const p of PRODUCTS) {
      const r = await run(model, TITLE_SYSTEM, 'Product info:\n\n' + p.text, 2500);
      if (r.err || !r.text) { console.log('  [' + p.label + '] FAILED: ' + (r.err || 'empty') + '  (' + r.ms + 'ms)'); fails++; totMs += r.ms; continue; }
      const s = score(r.text);
      totMs += r.ms;
      totCost += ((r.usage.prompt_tokens || 0) * pin + (r.usage.completion_tokens || 0) * pout) / 1e6;
      if (s.hasDim) dims++;
      console.log('  [' + p.label + '] ' + r.ms + 'ms  ' + s.segs + ' segs  ' + s.chars + ' chars  ' + (s.hasDim ? 'has dims' : 'NO dims'));
      console.log('    ' + r.text.slice(0, 150));
      if (s.issues.length) console.log('    !! ' + s.issues.join('; '));
    }
    console.log('  --> avg ' + Math.round(totMs / PRODUCTS.length) + 'ms | $' + (totCost / PRODUCTS.length).toFixed(5)
      + '/title | $' + (totCost / PRODUCTS.length * 500).toFixed(2) + ' per 500 products'
      + (fails ? ' | ' + fails + ' FAILED' : '') + ' | dims in ' + dims + '/' + PRODUCTS.length);
  }
})();
