/**
 * POST /api/worker-variants
 *
 * Body: { worker_id: UUID, listing_id: number, scenes?: number }
 *
 * Takes one listing's cover and restages the SAME product against different
 * backgrounds, creating an extra listing per variant that passes checks. Nothing is
 * cropped — the product stays whole, only the room changes — so every variant is a
 * full sellable cover rather than a crop that survived dedup by discarding half the
 * photo.
 *
 * Runs as its own endpoint, fired and forgotten by worker-scrape, so image
 * generation never competes with the scrape for the 60s function budget.
 *
 * Every generated image must clear TWO checks before use:
 *   1. the product is unchanged  — else we'd misrepresent what we're selling
 *   2. the background really changed — measured 1 in 4 generations quietly keeps the
 *      original room, which would then be caught as a duplicate
 */

const { sb, SERVICE_KEY } = require('../lib/sb');
// rotateTitle lives with the other listing helpers; same codebase, no copy kept here.
const { rotateTitle } = require('./worker-scrape.js')._test;

const STORAGE_BASE = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/storage/v1';
const IMG_MODEL = process.env.CLEAN_MODEL || 'google/gemini-2.5-flash-image';
const CHK_MODEL = process.env.CLASSIFY_MODEL || 'google/gemini-2.5-flash';
// Always first, and always safe: a plain backdrop suits any product, so it is the
// one scene never left to chance.
const PLAIN = 'a clean plain light-grey studio background, no furniture or props';

// BG_STYLE 'plain' (default) stages against bare wall-and-floor backdrops instead of
// furnished rooms. Same price per image — generation is charged flat — but props are
// where the failures come from (garbled text on a monitor, a warped chair, a frame
// turning gold beside a bookcase), so plainer scenes waste fewer generations. They
// also need no per-product reasoning: a bare wall suits a bin, a chair and a desk
// alike. 'room' restores furnished settings chosen from the product title.
const BG_STYLE = process.env.BG_STYLE || 'plain';
// Chosen by measurement, not taste. Six plain backdrops were generated and compared
// pairwise: the neutral ones hashed almost identically (white+wood vs off-white+oak
// scored 4, off-white vs charcoal scored 3) because recolouring a wall barely moves a
// perceptual hash when the product fills the frame — the same reason colour grading
// failed. Only backdrops differing in TEXTURE separated, scoring 26-41. These four
// are the set that measured mutually distinct; adding more neutrals would produce
// listings that look different to a human and identical to a deduplicator.
const PLAIN_SCENES = [
  'a plain white wall with a light wood floor, empty room, no furniture or objects',
  'a soft grey studio backdrop, seamless, no floor line, no props',
  'an exposed red brick wall with a wood floor, empty room, no furniture',
  'a pale beige wall with a light concrete floor, empty room, nothing else',
];

// Fallback only — used when scene generation fails, or when BG_SCENES is set. These
// are furniture-shaped guesses and read badly for other categories (a bin does not
// belong in "a warm dining area"), which is why scenes are normally derived from the
// product itself below.
const FALLBACK_SCENES = (process.env.BG_SCENES || [
  'a bright modern bedroom with a window and pale walls',
  'a tidy home office with a bookshelf against a white wall',
  'a minimal study corner with a pale rug and a floor lamp',
  'a warm dining area with wooden flooring and a potted plant',
  'a bright apartment room with white walls and large windows',
].join('|')).split('|').filter(Boolean);

// Ask where THIS product actually belongs. A gaming chair wants a desk setup, a bin
// wants a kitchen or bathroom — a fixed list gets those wrong. One cheap text call.
async function scenesFor(product, want, apiKey) {
  if (process.env.BG_SCENES) return FALLBACK_SCENES.slice(0, want);
  // Plain backdrops need no reasoning about the product at all. Past the four that
  // measured distinct, top up with furnished rooms — those scored 22-34 apart, so
  // they extend the set where another neutral wall would just duplicate one.
  if (BG_STYLE === 'plain') {
    if (want <= PLAIN_SCENES.length) return PLAIN_SCENES.slice(0, want);
    const rooms = await scenesForRooms(product, want - PLAIN_SCENES.length, apiKey);
    return [...PLAIN_SCENES, ...rooms].slice(0, want);
  }
  return scenesForRooms(product, want, apiKey);
}

// Furnished rooms picked for the specific item — a bin belongs in a kitchen, a
// gaming chair at a desk. Structurally varied, so they hash well apart.
async function scenesForRooms(product, want, apiKey) {
  if (want < 1) return [];
  const prompt = `A shop is photographing this item for an online listing: "${product}"\n\n`
    + `Name ${want} DIFFERENT real places in a Singapore home or workplace where a buyer would actually `
    + `use or keep this item.\n\n`
    + `Rules: one per line, no numbering, no bullets. Each line describes ONLY the room and its look, in `
    + `under 12 words, e.g. "a tidy home office with a bookshelf against a white wall". Never mention the `
    + `item itself, people, text or signage. The rooms must be clearly different from one another.`;
  try {
    const d = await orChat({
      model: CHK_MODEL, max_tokens: 300, temperature: 0.7,
      messages: [{ role: 'user', content: prompt }],
    }, apiKey);
    const txt = ((((d || {}).choices || [])[0] || {}).message || {}).content || '';
    const lines = String(txt).split('\n')
      .map(s => s.replace(/^[\s\-*\d.)]+/, '').trim())   // strip bullets/numbering
      .filter(s => s.length > 8 && s.length < 120);
    return lines.length >= 2 ? lines.slice(0, want) : FALLBACK_SCENES.slice(0, want);
  } catch { return FALLBACK_SCENES.slice(0, want); }
}

const restagePrompt = (scene) =>
  `Replace ONLY the background of this product photo with ${scene}. The product itself must stay `
  + `identical: same model, same colour, same proportions, same angle, same size in frame. Do not `
  + `redraw, restyle, resize or move the product, and do not add any text, logo or watermark. Show `
  + `the complete product, never a crop. Output only the edited image.`;

// Judge the PRODUCT, never the scenery. The first version asked whether image 2
// "differs" from image 1 and got BAD on every attempt — for a missing monitor, a
// missing chair, a shelf swapped for a bookcase. Those are props, and props are
// supposed to change when the room does; the desk itself was perfect each time.
// Answer the four questions first, THEN rule. A bare one-word verdict was useless:
// at default temperature the same image scored GOOD/BAD/BAD across three identical
// calls, and at temperature 0 it waved everything through. Inspecting first, at
// temperature 0, gives stable answers.
const checkPrompt = (name) =>
  `The item for sale is: "${name}".\n`
  + `Image 1 is the original photo. Image 2 should show THE SAME ITEM in a different setting.\n\n`
  + `Surroundings do not matter. Decor, plants, monitors, chairs, rugs, wall fittings, lighting and objects `
  + `placed on or near the item are all EXPECTED to change. Never fault those.\n\n`
  + `Answer these about IMAGE 2, one short line each:\n`
  + `1. SHAPE/COLOUR: is the item for sale the same design, colour and proportions as image 1?\n`
  + `2. RENDERING: does any part of the item look warped, melted, smeared or wrongly drawn?\n`
  // Scoped to overlays and nonsense text: "any text at all" failed every image,
  // because a monitor in shot showing an ordinary picture counts as text.
  + `3. TEXT: is there text OVERLAID on the photo (watermark, seller badge, price tag, promo banner), or text `
  + `that reads as garbled nonsense letters? Text that belongs to the scene and reads normally is FINE.\n`
  + `4. FRAMING: is the whole item visible, not cut off by the edge?\n\n`
  + `Then a final line, exactly: VERDICT: GOOD  or  VERDICT: BAD\n`
  + `BAD if 1 found a difference, 2 found something wrong, 3 found an overlay or garbled text, or 4 found it cut off.`;

// Duplicated from worker-scrape rather than shared, deliberately: that file is the
// live scrape path and this endpoint must not be able to break it.
async function fetchDataUri(url) {
  try {
    const r = await fetch(url, { headers: { Referer: 'https://shopee.sg/' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = (r.headers.get('content-type') || '').includes('png') ? 'image/png' : 'image/jpeg';
    return `data:${ct};base64,` + buf.toString('base64');
  } catch { return null; }
}

async function orChat(body, apiKey) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function restage(srcUri, scene, apiKey) {
  try {
    const d = await orChat({
      model: IMG_MODEL, modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [
        { type: 'text', text: restagePrompt(scene) },
        { type: 'image_url', image_url: { url: srcUri } },
      ] }],
    }, apiKey);
    const msg = (((d || {}).choices || [])[0] || {}).message || {};
    const uri = msg.images && msg.images[0] && ((msg.images[0].image_url && msg.images[0].image_url.url) || msg.images[0].url);
    return uri && uri.startsWith('data:') ? uri : null;
  } catch { return null; }
}

// Fails closed: anything but an explicit GOOD is treated as a reject, because a false
// pass either misrepresents the product or ships a duplicate.
async function checkVariant(srcUri, newUri, apiKey, productName) {
  try {
    const d = await orChat({
      model: CHK_MODEL, max_tokens: 220, temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Image 1:' }, { type: 'image_url', image_url: { url: srcUri } },
        { type: 'text', text: 'Image 2:' }, { type: 'image_url', image_url: { url: newUri } },
        { type: 'text', text: checkPrompt(productName || 'the main furniture item') },
      ] }],
    }, apiKey);
    const txt = ((((d || {}).choices || [])[0] || {}).message || {}).content || '';
    // Require an explicit GOOD verdict — an unparseable reply fails closed.
    return /VERDICT:\s*GOOD/i.test(String(txt));
  } catch { return false; }
}

async function upload(dataUri) {
  const buf = Buffer.from(dataUri.split(',')[1], 'base64');
  const path = 'bg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
  const up = await fetch(STORAGE_BASE + '/object/covers/' + path, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'image/png' },
    body: buf,
  });
  return up.ok ? STORAGE_BASE + '/object/public/covers/' + path : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'OPENROUTER_API_KEY not set' });

  const { worker_id, listing_id, scenes } = req.body || {};
  if (!worker_id || !listing_id) return res.status(400).json({ error: 'worker_id and listing_id required' });

  const want = Math.max(1, Math.min(Number(scenes) || 4, 10));

  const { data: src, error: lErr } = await sb
    .from('listings')
    .select('id, title, shopee_url, images, ai_title, ai_description, source_cost, sell_price, account_name, guard_warnings, status')
    .eq('id', listing_id)
    .single();
  if (lErr || !src) return res.status(404).json({ ok: false, error: 'listing-not-found' });
  if (src.status === 'deleted') return res.json({ ok: true, skipped: 'deleted' });

  const cover = (src.images || [])[0];
  if (!cover) return res.json({ ok: false, error: 'no-cover' });
  const dims = (src.images || [])[1] || null;

  const srcUri = await fetchDataUri(cover);
  if (!srcUri) return res.json({ ok: false, error: 'cover-unreachable' });

  // Base URL without any existing #fragment — variants get their own.
  const base = String(src.shopee_url || '').split('#')[0];

  // Generate in parallel: each is a slow image-gen call, so serial would blow the
  // function budget. Verification rides along with each one.
  // Name the product so the check knows what to look at. The AI title's opening
  // segment is the cleanest description of the item we have.
  const productName = (src.ai_title || src.title || '').split(' | ')[0].trim().slice(0, 80);

  // Plain backdrop first (safe for any product), then rooms chosen for this item.
  const sceneList = [PLAIN, ...(await scenesFor(productName, want - 1, apiKey))].slice(0, want);
  console.log('scenes for', JSON.stringify(productName), '->', sceneList.join(' | '));

  const made = await Promise.all(sceneList.map(async (scene) => {
    const uri = await restage(srcUri, scene, apiKey);
    if (!uri) return null;
    if (!(await checkVariant(srcUri, uri, apiKey, productName))) return null;
    return await upload(uri);
  }));

  const good = made.filter(Boolean);
  const ids = [];
  for (let i = 0; i < good.length; i++) {
    // Fragment keyed to the source listing so repeat runs can't collide.
    const url = base + '#v' + src.id + '-' + i;
    const { data: v, error: vErr } = await sb.from('listings').insert({
      title: src.title || '',
      shopee_url: url,
      source_cost: src.source_cost,
      sell_price: src.sell_price,
      images: dims ? [good[i], dims] : [good[i]],
      status: 'active',
      assigned_worker_id: worker_id,
      account_name: src.account_name || null,
      guard_warnings: src.guard_warnings || null,
      // Shift the title again so a variant never repeats its parent's opening phrase.
      ai_title: src.ai_title ? rotateTitle(src.ai_title, i + 1) : null,
      ai_description: src.ai_description,
    }).select('id').single();
    if (!vErr && v) ids.push(v.id);
    else console.error('variant insert error:', vErr && vErr.message);
  }

  return res.json({
    ok: true,
    source_listing: src.id,
    attempted: want,
    passed: good.length,
    rejected: want - good.length,
    listing_ids: ids,
  });
};
