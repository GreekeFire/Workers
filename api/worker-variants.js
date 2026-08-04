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
// Distinct rooms, so variants differ from each other and not just from the source.
const SCENES = (process.env.BG_SCENES || [
  'a clean plain light-grey studio background',
  'a bright modern bedroom with a window and pale walls',
  'a tidy home office with a bookshelf against a white wall',
  'a minimal study corner with a pale rug and a floor lamp',
  'a warm dining area with wooden flooring and a potted plant',
  'a bright apartment room with white walls and large windows',
].join('|')).split('|').filter(Boolean);

const restagePrompt = (scene) =>
  `Replace ONLY the background of this product photo with ${scene}. The product itself must stay `
  + `identical: same model, same colour, same proportions, same angle, same size in frame. Do not `
  + `redraw, restyle, resize or move the product, and do not add any text, logo or watermark. Show `
  + `the complete product, never a crop. Output only the edited image.`;

// Judge the PRODUCT, never the scenery. The first version asked whether image 2
// "differs" from image 1 and got BAD on every attempt — for a missing monitor, a
// missing chair, a shelf swapped for a bookcase. Those are props, and props are
// supposed to change when the room does; the desk itself was perfect each time.
const checkPrompt = (name) =>
  `The item for sale is: "${name}".\n\n`
  + `Image 1 is the original photo. Image 2 should show THE SAME ITEM FOR SALE in a different setting.\n\n`
  + `Ignore the surroundings entirely. Furniture, decor, plants, monitors, chairs, rugs, objects placed on or `
  + `near the item, wall fittings and lighting are all EXPECTED to change with the new setting. None of that is a fault.\n\n`
  + `Answer "BAD" if ANY of these is true:\n`
  + `- THE ITEM FOR SALE differs from image 1 in shape, colour, material, proportions or design.\n`
  + `- THE ITEM FOR SALE looks artificial, warped or AI-generated, or any part of it looks wrong.\n`
  + `- THE ITEM FOR SALE is cut off by the frame, or only partly visible.\n`
  + `- Image 2 carries any text, logo, watermark or badge.\n`
  + `- The setting in image 2 is essentially the same room as image 1 (the background barely changed).\n\n`
  + `Otherwise answer "GOOD".\n\nAnswer with exactly one word: GOOD or BAD.`;

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
      model: CHK_MODEL, max_tokens: 8,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Image 1:' }, { type: 'image_url', image_url: { url: srcUri } },
        { type: 'text', text: 'Image 2:' }, { type: 'image_url', image_url: { url: newUri } },
        { type: 'text', text: checkPrompt(productName || 'the main furniture item') },
      ] }],
    }, apiKey);
    const txt = ((((d || {}).choices || [])[0] || {}).message || {}).content || '';
    return /^\W*GOOD\b/i.test(String(txt).trim());
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

  const want = Math.min(Number(scenes) || SCENES.length, SCENES.length);

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

  const made = await Promise.all(SCENES.slice(0, want).map(async (scene) => {
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
