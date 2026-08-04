// Which model should write the listing copy now that Anthropic is out of credit?
// Runs the REAL prompts on a REAL scraped product through several OpenRouter models
// and prints what each produced, so quality is judged on output rather than price.
//   node test-copy-models.js
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^(OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY)=(.+)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const Module = require('module');
const _load = Module._load;
Module._load = (req, ...a) => req === '@supabase/supabase-js' ? { createClient: () => ({}) } : _load(req, ...a);
const { TITLE_SYSTEM, DESC_SYSTEM } = require('./api/worker-scrape.js')._test;

const OR = process.env.OPENROUTER_API_KEY;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MODELS = [
  'deepseek/deepseek-v4-flash',
];

async function ask(model, system, user, maxTokens) {
  const t = Date.now();
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + OR, 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: maxTokens,
      // DeepSeek V4 is a reasoning model: left on, it spends the entire budget
      // thinking and returns empty content. Excluded, the same title costs 51
      // output tokens instead of 707. Harmless for models without reasoning.
      reasoning: { exclude: true },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  const j = await r.json();
  if (!r.ok || j.error) return { err: JSON.stringify(j.error || j).slice(0, 120), ms: Date.now() - t };
  const c = (((j.choices || [])[0] || {}).message || {}).content || '';
  return { text: String(c).trim(), ms: Date.now() - t, usage: j.usage };
}

(async () => {
  // The product the pipeline just failed to write copy for.
  const rows = await (await fetch(
    'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox?select=payload&order=id.desc&limit=1',
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json();
  const p = (rows[0] || {}).payload || {};
  const variants = (p.models || []).map(m => m && m.name).filter(Boolean);
  const productText = [p.title, p.description, variants.length ? 'Variants (in stock): ' + variants.join(', ') : '']
    .filter(Boolean).join('\n\n');
  console.log('PRODUCT:', (p.title || '').slice(0, 70));
  console.log('input:', productText.length, 'chars,', variants.length, 'variants\n');

  for (const model of MODELS) {
    console.log('='.repeat(72));
    console.log(model);
    console.log('='.repeat(72));
    const t = await ask(model, TITLE_SYSTEM, 'Product info:\n\n' + productText, 512);
    if (t.err) { console.log('  TITLE FAILED:', t.err, '\n'); continue; }
    const title = t.text.split('\n')[0].trim();
    console.log('TITLE  (' + title.length + ' chars, ' + title.split('|').length + ' segments, ' + t.ms + 'ms)');
    console.log('  ' + title.replace(/ \| /g, '\n  | '));

    const d = await ask(model, DESC_SYSTEM, 'Product info:\n\n' + productText, 1536);
    if (d.err) { console.log('  DESC FAILED:', d.err, '\n'); continue; }
    console.log('\nDESCRIPTION (' + d.ms + 'ms)');
    console.log(d.text.split('\n').map(l => '  ' + l).join('\n'));
    const u = d.usage || {};
    console.log('\ntokens: in', u.prompt_tokens, 'out', u.completion_tokens, '\n');
  }
})();
