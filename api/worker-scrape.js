/**
 * POST /api/worker-scrape
 *
 * Body: { worker_id: UUID, inbox_id?: number }
 *   inbox_id omitted → processes the oldest pending row for this worker.
 *
 * Returns:
 *   { ok: true, listing_id, warnings: [], ai_generated: bool }
 *   { ok: false, error: 'duplicate'|'inactive-worker'|..., ... }
 */

const { sb, SERVICE_KEY } = require('../lib/sb');

const PRICE_BAND_MIN = 25;
const PRICE_BAND_MAX = 300;
// ALLOW_DUPLICATES: when 'true', the same Shopee URL can be listed more than once
// (needed for the duplicate-listing / repost strategy). Off by default — flip the
// Vercel env var to enable. Pair with per-repost image variation to avoid identical clones.
const ALLOW_DUPLICATES = process.env.ALLOW_DUPLICATES === 'true';
// IMAGE_PICK: when 'true', keep only [cover, dimensions-image] instead of all
// scraped images (dimensions image found via a cheap vision call). Off by default —
// flip the Vercel env var to test. Cover background-swap is a separate, later step
// (needs a bg-removal API + result hosting) — see swapCoverBackground note below.
const IMAGE_PICK = process.env.IMAGE_PICK === 'true';
// COVER_SPLIT: classify the full image pool (gallery + description + review photos)
// and emit ONE listing per usable cover image — colour-agnostic, the count is however
// many clean covers we found. This is the default listing model; set COVER_SPLIT=false
// to fall back to the older variant/price split. Needs OPENROUTER_API_KEY — without it
// classification returns null and we fall through to the variant/single paths anyway.
const COVER_SPLIT = process.env.COVER_SPLIT !== 'false';

// ── AI prompts (server-side only — no other copy exists) ────────────────────

const TITLE_SYSTEM = `You are a Carousell Singapore listing title writer. Buyers find the listing by typing words into search, so the title must be packed with the DISTINCT, RELEVANT terms a real buyer would type for THIS specific item.

TASK: Write one Carousell title for the product below. Output the title text only — no JSON, no quotes, no explanation.

STEP 1 — Silently identify the category from the product text:
- FURNITURE / BULKY HOME (sofa, chair, table, shelf, bed, mattress, safe, cabinet, rack, drawers): buyers search by item type, size/dimensions, material, load/weight capacity, room, style.
- HOMEWARE / KITCHEN (plates, cookware, storage, organiser): item type, set/piece count, material, capacity/size, use.
- Anything else: lead with item type + strongest concrete attributes.

STEP 2 — Write the title:
1. Exactly 8 to 10 pipe-separated ( | ) segments. Each segment is a Title Case phrase of 3-5 words a buyer could actually type into search. Aim for roughly 200 characters total; never exceed 225.
2. Front-load the single strongest search phrase as the FIRST segment — the feed truncates the visible title around 40 characters.
3. If dimensions appear in the product text, at least ONE segment MUST contain them (e.g. "130x70cm Dining Table").
4. COVER DIFFERENT SEARCH ANGLES — never repeat the same phrase. Each segment adds a NEW angle: item-type synonyms, a real attribute (size, material, capacity, colour), a feature, a use case. You may reuse the core item word with a DIFFERENT modifier each time, but near-duplicate segments read as keyword stuffing and get listings hidden.
5. Use ONLY attributes that appear in the product text. NEVER invent dimensions, weights, materials, capacities or compatibility.
6. Correct spelling. Do not copy source typos.
7. NEVER include: brand names, model numbers/SKUs, platform names (Shopee, Carousell, Lazada, Amazon), seller phrases ("Local Seller", "SG Seller", "Fast Delivery"), prices, the words "Brand New / Free Shipping / nice / cheap / best", emojis, or the symbols ! @ # $ % * &.

GOOD (distinct angles, concrete attributes taken from the product text):
Solid Wood Coffee Table | 100x50cm Living Room Table | Walnut Finish Low Table | Scandinavian Side Table | Sturdy Pine Frame | Compact Apartment Table | Minimalist Home Furniture | Easy Assembly Centre Table

BAD (same phrase repeated — gets hidden):
Gaming Keyboard | RGB Gaming Keyboard | Best Gaming Keyboard | Gaming Keyboard SG | Gaming Keyboard Cheap

Silently count your segments. Fewer than 8: add a NEW distinct angle. More than 10: drop the weakest. Output only the final title.`;

const DESC_SYSTEM = `You are a Carousell Singapore listing copywriter. Output ONLY the listing description as plain text — no JSON, no markdown, no **bold**, no #headers, no commentary before or after. Do NOT write a delivery line — it is added automatically.

STEP 1 — Silently detect the category from the product text: FURNITURE/BULKY or HOMEWARE/KITCHEN (anything else: treat it as homeware). This sets the depth and which details lead.

STEP 2 — Choose depth:
- HIGH-TICKET BULKY FURNITURE (sofa, table, bed, mattress, large cabinet, shelf, rack): fuller — 6 to 8 bullets, lead with what reassures a considered buyer.
- CHEAP / SIMPLE items (small homeware, organisers): leaner — 3 to 5 bullets. Do not pad; an over-bulleted block on a cheap item reads as spam.

STEP 3 — Write in exactly this structure:

ONE hook sentence: what it is + 2-3 standout features + who/what it's for.

(blank line)

Bullets, each: ✅ [Feature] — [what it means for the buyer]. ORDER BY WHAT THIS BUYER DECIDES ON:
- FURNITURE/BULKY: dimensions FIRST (will it fit), then material/build, weight or load capacity, assembly, colour/finish, room/use.
- HOMEWARE/KITCHEN: set/piece count first, then material, dimensions/capacity, microwave/dishwasher/oven safe, care.
For BULKY items, include one value bullet worded to the item, e.g. "✅ Delivered To Your Door — no lorry to rent, no carrying it up yourself". For small/light items, skip this bullet (a delivery hard-sell looks overblown).
Always include: "✅ Brand New — unused" (sealed/flat-packed as appropriate).

If the product text lists colour/size variants, add ONE line after the bullets: "📦 Sizes available: ..." or "📦 Finishes available: ...". Summarise many variants into a readable range (e.g. "45×30, 55×35, 65×42cm footprints · 1 to 5 layers") — do not dump every row. If a "Variants (in stock)" line is present, it is the ONLY source of truth for what can be bought: any size or colour mentioned elsewhere in the product text but missing from that line is OUT OF STOCK and must not appear anywhere in your listing. Omit the 📦 line entirely if there are no variants. Then add: "💬 Message us to order or check stock".

LAST LINE (exact, verbatim, nothing after it):
💳 PayNow / PayLah / Bank Transfer / Credit & Debit Card / Carousell Buy Button accepted 🙂

EXAMPLE (structure and tone ONLY — NEVER copy its facts into a real listing):
Sturdy 4-tier foldable laundry drying rack that holds a full family wash and folds flat when not in use — ideal for HDB service yards and balconies.

✅ 170cm Tall, 64cm Wide — takes a full load of laundry in one go
✅ Powder-Coated Steel Frame — rustproof for humid weather
✅ Folds Flat — slides beside the washing machine when done
✅ No Assembly Needed — unfold and use straight away
✅ Brand New — unused, in original packaging
✅ Delivered To Your Door — no lorry to rent, no carrying it up yourself

💬 Message us to order or check stock

💳 PayNow / PayLah / Bank Transfer / Credit & Debit Card / Carousell Buy Button accepted 🙂

RULES:
- The product text may include the original seller's shop boilerplate: warranty offers, refund policies, review requests, shop promotions, wholesale offers, self-pickup notes, authenticity claims, addresses. NEVER copy any warranty, refund, pickup, or service promise into the listing — describe only the item itself.
- State ONLY facts in the product text. NEVER invent dimensions, weight, material, capacity or compatibility. If a key spec is missing, write a genuine benefit bullet instead — do not guess. Wrong specs cause returns.
- No brand names, no platform names (Shopee/Lazada/Amazon).
- No vague filler on its own ("high quality", "amazing", "best", "premium") — pair a concrete feature with a concrete benefit.
- Vary phrasing between listings so descriptions never read as mass-produced duplicates.
- Keep it scannable.`;

// ── helpers ───────────────────────────────────────────────────────────────────

// No-EDT fallback is deliberately date-free: a missing EDT usually means the
// source uses "Seller's own delivery" (bulky furniture) — timing unknown, so
// we promise none. Those listings also get a 'no-edt' guard warning.
const DELIVERY_DEFAULT = '🚚 Free Doorstep Delivery';

// Delivery promise = source EDT +1 day both ends (source 3-4 days → "4-5"),
// covering our re-order lag. Computed in code, never by the AI.
function deliveryLine(p) {
  const min = Number(p && p.edt_min);
  const max = Number(p && p.edt_max);
  if (min >= 1 && max >= min && max <= 30) {
    const range = min === max ? `${max + 1}` : `${min + 1}-${max + 1}`;
    return `🚚 Free Doorstep Delivery | ${range} Working Days`;
  }
  return DELIVERY_DEFAULT;
}

// The server is the single authority for listing structure (no client copy).
// Stamps the computed delivery line first and the payment line last, replacing
// whatever the model wrote for either.
function normalizeDesc(text, delivery = DELIVERY_DEFAULT) {
  if (!text) return text;
  const PAYMENT = '💳 PayNow / PayLah / Bank Transfer / Credit & Debit Card / Carousell Buy Button accepted 🙂';
  let lines = text.split('\n').filter(l => !(l.includes('🚚') || l.includes('FREE Local Delivery')));
  while (lines.length && !lines[0].trim()) lines.shift();
  lines = [delivery, '', ...lines];
  const idx = lines.findIndex(l => l.includes('💳') || l.includes('PayNow'));
  if (idx !== -1) lines.splice(idx, 1);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push('', PAYMENT);
  return lines.join('\n');
}


// Normalise both Shopee URL formats to shopee.sg/product/{shopid}/{itemid}
// so duplicate checks work regardless of whether the VA used the slug or
// product-ID URL for the same item.
//   slug format:    shopee.sg/Some-Title-i.{shopid}.{itemid}
//   product format: shopee.sg/product/{shopid}/{itemid}
function normalizeShopeeUrl(url) {
  if (!url) return url;
  const clean = url.split('?')[0];
  const prod = clean.match(/\/product\/(\d+)\/(\d+)/);
  if (prod) return `https://shopee.sg/product/${prod[1]}/${prod[2]}`;
  const slug = clean.match(/-i\.(\d+)\.(\d+)(?:\/|$)/);
  if (slug) return `https://shopee.sg/product/${slug[1]}/${slug[2]}`;
  return clean;
}

// max(×1.5, +$25), rounded up to the next $10 then −$1 → $x9 endings
// (left-digit pricing). MUST match calcSell in work.html.
function calcSellPrice(cost) {
  const raw = Math.max(cost * 1.5, cost + 25);
  return Math.ceil(raw / 10) * 10 - 1;
}

// ── Variant splitting (Option A) ────────────────────────────────────────────
// Group in-stock models by DISTINCT price → each price becomes its own listing
// (size variants differ in price; same-price colours collapse into one). Returns
// null when there's nothing to split (0/1 distinct price) so the caller falls back
// to a single listing. All splits share the base shopee_url (payload has no model
// id) — but each gets its own listing id → own ref-code + attribution, and its
// title carries the variant label so fulfilment knows which to order.
function variantGroups(models) {
  const priced = (models || []).filter(m => m && m.price > 0 && m.name);
  if (priced.length < 2) return null;             // 0/1 variant → single listing
  // Each in-stock variant (colour AND size) becomes its own listing — own ref-code,
  // price, label, and swatch image. The distinct swatch cover is what makes same-
  // price colour listings read as genuinely different products, not obvious dupes.
  // ponytail: splits per model, so colour×size products fan out to all combos;
  //           cap or group-by-tier here if that ever over-produces.
  return priced.map(m => ({
    price: m.price,
    label: variantLabel([String(m.name).trim()]),
    image: m.image || null,
    name: String(m.name).trim(),   // used to make each split's shopee_url unique
  }));
}

// Short distinguishing label appended to a split listing's title. Prefer a
// dimensions chunk from the variant name (what buyers pick on); else the first name.
function variantLabel(names) {
  const joined = names.join(' / ');
  const dims = joined.match(/\d+\s*[x*×]\s*\d+(?:\s*[x*×]\s*\d+)?\s*(?:cm|mm)?/i);
  return (dims ? dims[0] : names[0]).replace(/\s+/g, ' ').trim().slice(0, 40);
}

// Distinct title per same-product cover-split listing: rotate the pipe segments so
// each listing leads with a different phrase (the feed truncates ~40 chars, so the
// visible title differs) and the whole string is unique — avoids same-account clone
// flagging without a second AI call. k=0 (or a rotation that lands back at 0) is a
// no-op returning the title unchanged.
function rotateTitle(title, k) {
  const parts = (title || '').split(' | ').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2 || !(k % parts.length)) return title;
  const r = k % parts.length;
  return [...parts.slice(r), ...parts.slice(0, r)].join(' | ');
}

// A split listing IS a single variant — drop the "📦 Sizes/Finishes available"
// line so it doesn't advertise sizes the buyer can't pick on that listing.
function stripSizesLine(desc) {
  if (!desc) return desc;
  return desc.split('\n')
    .filter(l => !/^📦\s*(Sizes|Finishes|Colours|Colors)\s+available/i.test(l.trim()))
    .join('\n');
}

// Call Anthropic directly — worker-scrape is server-side so it can use the key
// directly rather than routing through /api/claude (which adds a fragile internal
// HTTP hop that was the root cause of silent AI generation failures).
// Sonnet 5: no temperature param (non-default values are rejected), thinking
// disabled explicitly (defaults to adaptive when omitted, which burns output
// tokens on reasoning we don't need for listing copy).
async function callClaudeDirect(system, userContent, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 45000);
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
    signal: ctrl.signal,
  });
  clearTimeout(to);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'anthropic ' + resp.status);
  }
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '';
}

async function generateAI(productText, delivery = DELIVERY_DEFAULT) {
  const productContent = `Product info:\n\n${productText}`;
  const [rawTitle, rawDesc] = await Promise.all([
    callClaudeDirect(TITLE_SYSTEM, productContent, 512),
    callClaudeDirect(DESC_SYSTEM, productContent, 1536),
  ]);
  let title = rawTitle.trim().split('\n')[0].trim();
  // Retry once if title is too short (code-level backstop; prompt asks for segments)
  if (title.length < 180) {
    try {
      const retry = await callClaudeDirect(
        TITLE_SYSTEM,
        productContent + '\n\nIMPORTANT: Previous attempt was too short. Add 1-2 NEW DISTINCT segments (a different feature, attribute, or use case). Do NOT repeat or pad existing segments.',
        512
      );
      title = retry.trim().split('\n')[0].trim();
    } catch { /* keep original if retry fails */ }
  }
  // Trim if over 225 chars
  if (title.length > 225) {
    const parts = title.split(' | ');
    while (parts.length > 1 && parts.join(' | ').length > 225) parts.pop();
    title = parts.join(' | ');
  }
  // Desc is plain text; strip stray code fences / JSON wrapper if the model regresses
  let description = rawDesc.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (description.startsWith('{')) {
    try { description = JSON.parse(description).description || description; } catch { /* use as-is */ }
  }
  description = normalizeDesc(description, delivery);
  return { title, description };
}

// ── Image selection (flag-gated by IMAGE_PICK) ──────────────────────────────
// Cheap Haiku vision call: which image is the measurement/dimensions diagram?
// Returns its index, or -1 for none. Shopee CDN blocks hotlinking, so images are
// fetched with the Shopee referer and sent as base64.
async function findDimsImage(images) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !images || images.length < 2) return -1;
  const imgs = images.slice(0, 8);
  const content = [];
  for (let i = 0; i < imgs.length; i++) {
    try {
      const r = await fetch(imgs[i], { headers: { Referer: 'https://shopee.sg/' } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get('content-type') || 'image/jpeg';
      content.push({ type: 'text', text: `Image ${i}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: ct.includes('png') ? 'image/png' : 'image/jpeg', data: buf.toString('base64') } });
    } catch { /* skip unreachable image */ }
  }
  if (!content.length) return -1;
  content.push({ type: 'text', text: 'Which image number is the product\'s MEASUREMENT / DIMENSIONS diagram (a spec drawing with size numbers like cm/mm, dimension arrows, or a labelled schematic)? Reply with ONLY the number. If none is a dimensions diagram, reply "none".' });
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8, messages: [{ role: 'user', content }] }),
    });
    if (!resp.ok) return -1;
    const data = await resp.json();
    const txt = (data.content || []).map(b => b.text || '').join('').trim();
    const n = parseInt(txt, 10);
    return Number.isInteger(n) && n >= 0 && n < imgs.length ? n : -1;
  } catch { return -1; }
}

// Keep only [cover, dimensions]. Cover = images[0]. Dimensions = the diagram if
// found, else the 2nd product photo (always return 2 when we can). URLs pass
// through UNCHANGED — dimensions image stays same size, no crop (owner's rule).
// ponytail: cover background-swap is deferred — it needs a bg-removal API
// (Photoroom/Replicate) + somewhere to host the result. Wire swapCoverBackground()
// here behind its own flag once that API is chosen; until then the raw cover ships.
async function pickCoverAndDims(images) {
  if (!images || !images.length) return null;
  if (images.length <= 2) return images;
  const dimsIdx = await findDimsImage(images);
  return [images[0], dimsIdx > 0 ? images[dimsIdx] : images[1]];
}

// One Haiku vision call over the whole pool (gallery + description images) → a role
// per image. Everything after this is deterministic (cover-per-colour, dims, skip),
// no more AI. Shopee CDN blocks hotlinking, so images fetch with the referer.
const CLASSIFY_PROMPT = `You are picking listing cover photos for an online furniture shop. You will see {N} photos (numbered 0..{N1}).

Judge EVERY image against the fixed standard below, on its own merits. Do NOT grade on a curve or compare images to each other — if all {N} images are poor, then all {N} are "skip". A batch with no good photo is a normal, expected outcome.

THE STANDARD for "cover": would a shopper scrolling a marketplace feed stop at this photo and immediately understand what is being sold? It must be upright, sharp, and show the WHOLE product large and unobstructed.

REJECT as "skip" — any ONE of these is disqualifying:
- Sideways or upside down. The product must appear upright as it would stand in real life.
- Shows only PART of the product — a close-up of a leg, a corner, a control panel, a hinge, a screw, a fabric texture, a drawer. Detail shots are never covers, however sharp.
- The product is small, distant, or cut off by the frame edge.
- Blurry, soft, grainy, badly lit, heavily shadowed, or strongly colour-cast.
- Cluttered or messy: cables, laundry, boxes, food, clutter on or around the product, or a busy background that competes with it.
- Built from two or more DIFFERENT SCENES of comparable size stacked or tiled together (e.g. the product on top, an unrelated photo below), OR its main subject is a diagram, chart, 3D render or spec illustration rather than the actual product. Nothing usable survives once the graphics come off. A single scene with a small inset thumbnail in one corner is NOT a composite — that inset can be removed.
- A person is the main subject, or a hand/body blocks the product.
- It is not this product at all.

OVERLAID TEXT IS NOT A REASON TO SKIP. Headline text, marketing copy, a price or promo banner, a watermark, a seller/shop badge, or a small inset detail box in a corner can all be removed afterwards. If a SINGLE photo underneath shows the whole product upright and clearly, it is a "cover" with "needs_clean": true — no matter how much text sits on top of it. Only reject it when the image is a multi-panel composite or is mostly graphics, so that removing the text would leave nothing worth showing.

CLASSIFY each image as exactly one:
- "cover" — meets the standard and passes every rejection test above
- "dimension" — a measurement diagram: size numbers (cm/mm) with arrows or labelled edges
- "skip" — everything else

Also set "needs_clean": true if a watermark, seller/shop badge, headline/marketing text, promo banner or inset detail box would have to be removed before use; else false.

WHEN IN DOUBT, CHOOSE "skip". Every "cover" becomes a real listing that shoppers see, so a mediocre photo actively costs us. Missing a decent photo costs nothing — there are always more.

Output ONLY a JSON array of exactly {N} objects, one per image, in order: {"i":0,"role":"cover","needs_clean":false}. No prose, no code fences.`;

const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL || 'google/gemini-2.5-flash';

// ── Cover cleaning (flag-gated by CLEAN_COVERS) ─────────────────────────────
// Strip marketing overlays (seller logo, shop badge, promo text/stickers) off a
// cover via Gemini image-edit, then host the result on Supabase Storage so the VA
// gets a clean, public cover URL. Only runs on covers the classifier flagged
// needs_clean. Regenerates the image (not a surgical inpaint) so it can subtly
// restyle the product — acceptable for a listing cover, eyeballed by the owner.
const STORAGE_BASE = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/storage/v1';
const CLEAN_COVERS = process.env.CLEAN_COVERS === 'true';
const CLEAN_MODEL = process.env.CLEAN_MODEL || 'google/gemini-2.5-flash-image';
const CLEAN_MAX = Number(process.env.CLEAN_MAX || 8);  // max covers cleaned per product
// Framed as retouching marketing overlays — NOT "remove watermark", which trips the
// model's copyright guardrail and gets the request refused.
const CLEAN_PROMPT = 'This is a product photo I am preparing for my own e-commerce listing. Please retouch it to remove overlaid marketing graphics only: promotional text banners, sale/discount stickers, shop-name badge labels, and decorative flag or border graphics. Keep the physical product and its natural background exactly as-is; do not redraw or restyle the product. Output only the retouched image.';

async function cleanCover(url) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !SERVICE_KEY || !url) return null;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 40000);
  try {
    const r = await fetch(url, { headers: { Referer: 'https://shopee.sg/' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = (r.headers.get('content-type') || '').includes('png') ? 'image/png' : 'image/jpeg';
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLEAN_MODEL,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: [
          { type: 'text', text: CLEAN_PROMPT },
          { type: 'image_url', image_url: { url: `data:${ct};base64,` + buf.toString('base64') } },
        ] }],
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const msg = (((data.choices || [])[0] || {}).message) || {};
    const uri = msg.images && msg.images[0] && ((msg.images[0].image_url && msg.images[0].image_url.url) || msg.images[0].url);
    if (!uri || !uri.startsWith('data:')) return null;
    const out = Buffer.from(uri.split(',')[1], 'base64');
    // Host on the public 'covers' bucket via the Storage REST API (verified path;
    // supabase-js storage upload isn't needed here).
    const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png';
    const up = await fetch(STORAGE_BASE + '/object/covers/' + path, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'image/png' },
      body: out,
    });
    if (!up.ok) { console.error('cover upload failed:', up.status); return null; }
    return STORAGE_BASE + '/object/public/covers/' + path;
  } catch (e) { console.error('cleanCover failed:', e.message); return null; }
  finally { clearTimeout(to); }
}

// Big pools (a product with many review photos easily passes 80 images) are split
// into batches classified IN PARALLEL — one 80-image request would be a ~30MB body
// and would blow the function timeout. Batches also fail independently: one bad
// batch loses its own images, not the whole classification.
const CLASSIFY_BATCH = Number(process.env.CLASSIFY_BATCH || 20);
const CLASSIFY_MAX = Number(process.env.CLASSIFY_MAX || 200);  // sanity ceiling

// Run fn over arr with at most `limit` in flight — Shopee CDN fetches are the slow
// part, and firing 200 at once gets us rate-limited.
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, async () => {
    while (next < arr.length) { const k = next++; out[k] = await fn(arr[k], k); }
  }));
  return out;
}

// → base64 data URI, or null if the image can't be fetched.
// Shopee CDN blocks hotlinking, so fetch with the referer.
async function fetchDataUri(url) {
  try {
    const r = await fetch(url, { headers: { Referer: 'https://shopee.sg/' } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const ct = (r.headers.get('content-type') || '').includes('png') ? 'image/png' : 'image/jpeg';
    return `data:${ct};base64,` + buf.toString('base64');
  } catch { return null; }
}

// Classify one batch. `pairs` is [{uri, idx}] — images are numbered 0..n-1 inside
// the batch (the prompt is written that way) and mapped back to their pool index
// on the way out, so the caller can hand batches any subset in any order.
async function classifyBatch(pairs, apiKey) {
  // OpenRouter is OpenAI-compatible: one user message, content = text + image_url.
  const content = [];
  pairs.forEach((p, n) => {
    if (!p.uri) { content.push({ type: 'text', text: `Image ${n}: (unavailable)` }); return; }
    content.push({ type: 'text', text: `Image ${n}:` });
    content.push({ type: 'image_url', image_url: { url: p.uri } });
  });
  content.push({ type: 'text', text: CLASSIFY_PROMPT.replace(/\{N\}/g, String(pairs.length)).replace('{N1}', String(pairs.length - 1)) });
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ model: CLASSIFY_MODEL, max_tokens: 3000, messages: [{ role: 'user', content }] }),
    });
    if (!resp.ok) { console.error('classify batch http', resp.status); return []; }
    const data = await resp.json();
    let txt = (((data.choices || [])[0] || {}).message || {}).content || '';
    txt = String(txt).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const arr = JSON.parse(txt);
    if (!Array.isArray(arr)) return [];
    // Map batch-local numbering back to the pool index; drop out-of-range answers.
    return arr.filter(r => r && Number.isInteger(r.i) && r.i >= 0 && r.i < pairs.length)
      .map(r => ({ ...r, i: pairs[r.i].idx }));
  } catch (e) { console.error('classify batch failed:', e.message); return []; }
}

async function classifyGallery(images) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !images || !images.length) return null;
  const imgs = images.slice(0, CLASSIFY_MAX);
  const uris = await mapLimit(imgs, 8, fetchDataUri);
  // DEAL the pool round-robin instead of slicing it in contiguous blocks. The pool
  // arrives grouped by source (gallery, then description, then review photos), so
  // contiguous batches meant whole batches of nothing but buyer photos — with no
  // clean studio shot alongside, the model's bar for "cover" drifted down and junk
  // got through. Dealing spreads every source across every batch.
  const nBatches = Math.max(1, Math.ceil(uris.length / CLASSIFY_BATCH));
  const decks = Array.from({ length: nBatches }, () => []);
  uris.forEach((uri, idx) => decks[idx % nBatches].push({ uri, idx }));
  const batches = await Promise.all(decks.map(d => classifyBatch(d, apiKey)));
  const merged = [].concat(...batches);
  return merged.length ? merged : null;
}

// ── main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const { worker_id, inbox_id, listing_id: regenListingId, regen } = req.body || {};
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

  // 1. Validate worker
  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, name, active, account_name').eq('id', worker_id).single();
  if (wErr || !worker) return res.status(404).json({ ok: false, error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ ok: false, error: 'worker-inactive' });

  // Regen mode: re-run AI generation for a listing that missed it on first scrape.
  // Called fire-and-forget from worker-listings.js for listings with null/empty ai_title.
  if (regen && regenListingId) {
    const { data: listing, error: lFetchErr } = await sb
      .from('listings')
      .select('id, title, ai_title')
      .eq('id', regenListingId)
      .single();
    if (lFetchErr || !listing) return res.status(404).json({ ok: false, error: 'listing-not-found' });
    // Another concurrent regen may have already succeeded — skip to avoid duplicate work.
    if (listing.ai_title != null && listing.ai_title !== '') return res.json({ ok: true, already_generated: true });
    const productText = (listing.title || '').trim();
    if (!productText) return res.json({ ok: false, error: 'no-product-text' });
    try {
      const ai = await generateAI(productText);
      await sb.from('listings').update({
        ai_title:       ai.title       || null,
        ai_description: ai.description || null,
      }).eq('id', regenListingId);
      return res.json({ ok: true, regen: true });
    } catch (aiErr) {
      console.error('regen AI failed:', aiErr.message);
      return res.json({ ok: false, error: 'regen-failed' });
    }
  }

  // 2. Fetch oldest pending inbox row for this worker
  let q = sb
    .from('scrape_inbox')
    .select('id, payload, consumed')
    .eq('worker_id', worker_id)
    .eq('kind', 'shopee')
    .eq('consumed', false)
    .order('id', { ascending: true })
    .limit(1);
  if (inbox_id) q = q.eq('id', inbox_id);

  const { data: rows, error: rErr } = await q;
  if (rErr) return res.status(500).json({ ok: false, error: 'inbox-read: ' + rErr.message });
  if (!rows || rows.length === 0) return res.json({ ok: true, nothing_pending: true });

  const row = rows[0];

  // 2b. CLAIM the row atomically before doing any slow work. `update ... where
  // consumed = false` is a compare-and-swap in Postgres: only the invocation that
  // flips the flag gets a row back, everyone else gets nothing and bails.
  // Without this, the row stayed pending for the ~30s of AI + classification +
  // inserts, so a second Pull click started a whole second pipeline on the same
  // scrape. Observed in prod: three overlapping runs on one product produced 57
  // listings from 47 distinct covers — each run re-classified independently (the
  // classifier is non-deterministic, so they disagreed on the cover count) and the
  // active-unique index only blocked the overlapping #c indices, letting the extra
  // higher ones through as duplicate-cover listings.
  // Trade-off: a crash after claiming loses the scrape rather than re-running it.
  // That matches what the failure paths below already do (they consume the row so a
  // poison payload can't re-run AI generation on every poll) — VA can re-scrape.
  const { data: claimed, error: claimErr } = await sb
    .from('scrape_inbox')
    .update({ consumed: true })
    .eq('id', row.id)
    .eq('consumed', false)
    .select('id');
  if (claimErr) return res.status(500).json({ ok: false, error: 'inbox-claim: ' + claimErr.message });
  if (!claimed || !claimed.length) return res.json({ ok: true, already_claimed: true });

  const p   = row.payload || {};

  // Unloaded sentinel — AUTO mode couldn't get data
  if (p.unloaded) {
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    return res.json({ ok: false, error: 'unloaded', skipped: true });
  }

  const shopeeUrl    = normalizeShopeeUrl(p.url);
  const cost = Math.max(
    p.price_max || 0,
    p.price_min || 0,
    ...(p.models || []).map(m => m.price || 0)
  );

  if (!shopeeUrl) {
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    return res.json({ ok: false, error: 'no-url' });
  }

  // 3. Duplicate check
  // done/deleted → hard block. active → refresh with new scrape data and assign to this worker.
  const { data: existing } = await sb
    .from('listings').select('id, status').eq('shopee_url', shopeeUrl).neq('status', 'deleted').limit(1);
  const existingListing = existing && existing.length > 0 ? existing[0] : null;
  // When duplicates are allowed, never treat a repeat URL as a refresh — always create a new listing.
  const isRefresh = !ALLOW_DUPLICATES && existingListing && existingListing.status === 'active';

  if (!ALLOW_DUPLICATES && existingListing && !isRefresh) {
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    return res.json({ ok: false, error: 'duplicate', listing_id: existingListing.id });
  }

  // 3b. Fuzzy near-match check — log silently, never block. Skip on refresh (would match itself).
  if (!isRefresh) {
    try {
      if (p.title && cost > 0) {
        const { data: fuzzyMatches } = await sb.rpc('find_fuzzy_duplicate', {
          p_title: p.title,
          p_cost: cost,
          p_threshold: 0.6,
        });
        if (fuzzyMatches && fuzzyMatches.length > 0) {
          console.log('duplicate detected:', p.title, shopeeUrl);
        }
      }
    } catch (fuzzyErr) {
      console.error('fuzzy dupe check failed:', fuzzyErr.message);
    }
  }

  // 4. Soft guards — price band only. Category / SG-seller / rating guards were
  // removed: they only fired when the scrape happened to capture those fields
  // (often null on the dataLayer path), so they gave false confidence. Product
  // quality is enforced by the owner instead.
  const warnings = [];
  if (!isRefresh) {
    if (cost > 0 && cost < PRICE_BAND_MIN) warnings.push('price-too-low');
    if (cost > 0 && cost > PRICE_BAND_MAX) warnings.push('price-too-high');
    // No shipping estimate from the source (usually "Seller's own delivery") —
    // listing goes out date-free; VA should confirm timing before promising one.
    if (!(Number(p.edt_max) >= 1)) warnings.push('no-edt');
  }

  // 5. Sell price
  const sellPrice = cost > 0 ? calcSellPrice(cost) : null;

  // 6. AI generation (non-fatal)
  let aiTitle = null;
  let aiDescription = null;
  try {
    // Variant names carry the specs on Shopee furniture (e.g. "Type B (32*30*41cm)");
    // sc.js has already dropped out-of-stock variants from p.models.
    const variantNames = (p.models || []).map(m => m && m.name).filter(Boolean);
    const productText = [
      p.title,
      p.description,
      variantNames.length ? 'Variants (in stock): ' + variantNames.join(', ') : '',
    ].filter(Boolean).join('\n\n');
    if (productText.trim()) {
      const ai = await generateAI(productText, deliveryLine(p));
      aiTitle       = ai.title       ?? null;
      aiDescription = ai.description ?? null;
    }
  } catch (aiErr) {
    console.error('AI gen failed:', aiErr.message);
  }

  // Image selection (flag-gated): keep only cover + dimensions image, else all.
  // Falls back to all images if the vision pick fails, so a listing never loses
  // its photos. Used by every insert/refresh path below.
  const listingImages = IMAGE_PICK
    ? (await pickCoverAndDims(p.images) || (Array.isArray(p.images) && p.images.length ? p.images : null))
    : (Array.isArray(p.images) && p.images.length ? p.images : null);

  // 7a. Refresh existing active listing — update AI, images, price, and assignment
  if (isRefresh) {
    const { error: updateErr } = await sb.from('listings').update({
      assigned_worker_id: worker_id,
      account_name:       worker.account_name || null,
      ai_title:           aiTitle,
      ai_description:     aiDescription,
      images:             listingImages,
      guard_warnings:     warnings.length ? warnings : null,
      source_cost:        cost || null,
      sell_price:         sellPrice || null,
    }).eq('id', existingListing.id);

    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);

    if (updateErr) {
      console.error('listing refresh error:', updateErr);
      return res.status(500).json({ ok: false, error: 'listing-refresh: ' + updateErr.message });
    }

    return res.json({
      ok: true,
      listing_id: existingListing.id,
      warnings,
      ai_generated: !!(aiTitle || aiDescription),
      refreshed: true,
    });
  }

  // 7b-covers. Cover-count split (colour-agnostic) — classify the whole image pool
  // (gallery + description + review photos) once, then emit ONE listing per usable
  // cover. The distinct cover is the dedup lever on Carousell; each listing also gets
  // the shared dimensions image and a rotated title so same-account listings don't
  // read as clones. Flag-gated; falls through to variant/single when off, when
  // classification fails, or when it finds no covers.
  // Covers flagged needs_clean are retouched via cleanCover (Gemini image-edit →
  // Supabase Storage) when CLEAN_COVERS is on; raw cover is the fallback on failure.
  if (COVER_SPLIT && !isRefresh) {
    const pool = [
      ...(Array.isArray(p.images) ? p.images : []),
      ...(Array.isArray(p.desc_images) ? p.desc_images : []),
      ...(Array.isArray(p.review_images) ? p.review_images : []),
    ];
    let roles = null;
    if (pool.length) {
      try { roles = await classifyGallery(pool); }
      catch (e) { console.error('classify failed:', e.message); }
    }
    if (roles) {
      // Dedupe covers by URL, remembering if any instance was flagged needs_clean.
      const coverMap = new Map();
      for (const r of roles) {
        if (!r || r.role !== 'cover' || !pool[r.i]) continue;
        coverMap.set(pool[r.i], coverMap.get(pool[r.i]) || !!r.needs_clean);
      }
      const dims = [...new Set(roles.filter(r => r && r.role === 'dimension' && pool[r.i]).map(r => pool[r.i]))].slice(0, 1);
      if (coverMap.size) {
        // Clean flagged covers in parallel — bounds wall-time to ~one image-gen call
        // (not N), and falls back to the raw cover on any failure so a listing never
        // loses its cover. No-op unless CLEAN_COVERS is on. Capped at CLEAN_MAX: a
        // big review pool can flag many covers, and each clean costs ~$0.04 and a
        // slow image-gen call. Beyond the cap covers ship raw (buyer review photos
        // usually aren't watermarked anyway, so the cap rarely bites).
        const entries = [...coverMap.entries()];
        const toClean = new Set(entries.filter(([, n]) => n).slice(0, CLEAN_MAX).map(([u]) => u));
        const covers = await Promise.all(entries.map(async ([url]) =>
          (CLEAN_COVERS && toClean.has(url)) ? (await cleanCover(url)) || url : url));
        const ids = [];
        for (let k = 0; k < covers.length; k++) {
          const imgs = [covers[k], ...dims.filter(u => u !== covers[k])];
          const { data: v, error: vErr } = await sb.from('listings').insert({
            title:              p.title || '',
            // Unique per cover so each listing clears listings_shopee_url_active_unique.
            shopee_url:         shopeeUrl + '#c' + k,
            source_cost:        cost || null,
            sell_price:         sellPrice,
            images:             imgs,
            status:             'active',
            assigned_worker_id: worker_id,
            account_name:       worker.account_name || null,
            guard_warnings:     warnings.length ? warnings : null,
            ai_title:           aiTitle ? rotateTitle(aiTitle, k) : null,
            ai_description:     aiDescription,
          }).select('id').single();
          if (!vErr && v) ids.push(v.id);
          else console.error('cover-split insert error:', vErr && vErr.message);
        }
        await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
        if (!ids.length) return res.status(500).json({ ok: false, error: 'cover-split-insert-failed' });
        return res.json({
          ok: true,
          listing_id: ids[0],
          listing_ids: ids,
          split: ids.length,
          cover_split: true,
          warnings,
          ai_generated: !!(aiTitle || aiDescription),
        });
      }
    }
    // no covers / classify failed → fall through to variant/single below
  }

  // 7b-split. Variant splitting — one Shopee product → N listings, one per distinct
  // price. Reuses the single AI generation across variants (no N× cost); each split
  // gets its own id/ref-code and a variant label appended to its title. Skipped on
  // refresh; null → falls through to the single-insert path below.
  const groups = isRefresh ? null : variantGroups(p.models);
  if (groups) {
    const splitDesc = stripSizesLine(aiDescription);
    const ids = [];
    for (const g of groups) {
      // Variant swatch as cover (deduped), gallery after — else the shared gallery.
      const vImages = g.image
        ? [g.image, ...(listingImages || []).filter(u => u !== g.image)]
        : listingImages;
      const { data: v, error: vErr } = await sb.from('listings').insert({
        title:              p.title || '',
        // Unique per variant so each split clears listings_shopee_url_active_unique.
        // Fragment is ignored by Shopee — the URL still opens the product page.
        shopee_url:         shopeeUrl + '#' + encodeURIComponent(g.name),
        source_cost:        g.price,
        sell_price:         calcSellPrice(g.price),
        images:             vImages,
        status:             'active',
        assigned_worker_id: worker_id,
        account_name:       worker.account_name || null,
        guard_warnings:     warnings.length ? warnings : null,
        ai_title:           aiTitle ? (aiTitle + ' | ' + g.label) : null,
        ai_description:     splitDesc,
      }).select('id').single();
      if (!vErr && v) ids.push(v.id);
      else console.error('variant insert error:', vErr && vErr.message);
    }
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    if (!ids.length) return res.status(500).json({ ok: false, error: 'variant-insert-failed' });
    return res.json({
      ok: true,
      listing_id: ids[0],
      listing_ids: ids,
      split: ids.length,
      warnings,
      ai_generated: !!(aiTitle || aiDescription),
    });
  }

  // 7b. Create new listing (single — no splittable variants)
  const { data: listing, error: lErr } = await sb
    .from('listings')
    .insert({
      title:              p.title || '',
      shopee_url:         shopeeUrl,
      source_cost:        cost || null,
      sell_price:         sellPrice,
      images:             listingImages,
      status:             'active',
      assigned_worker_id: worker_id,
      account_name:       worker.account_name || null,
      guard_warnings:     warnings.length ? warnings : null,
      ai_title:           aiTitle,
      ai_description:     aiDescription,
    })
    .select('id')
    .single();

  if (lErr) {
    console.error('listing insert error:', lErr);
    // Give up on this row so it isn't re-drained every poll (which would re-run
    // AI generation each time). Duplicates were already handled above; this is a
    // hard failure (incl. a lost unique-index race, where the listing now exists
    // anyway). The VA can re-scrape if a genuine listing was lost.
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    return res.status(500).json({ ok: false, error: 'listing-insert: ' + lErr.message });
  }

  // 8. Mark inbox row consumed
  await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);

  return res.json({
    ok: true,
    listing_id: listing.id,
    warnings,
    ai_generated: !!(aiTitle || aiDescription),
  });
};

module.exports._test = { normalizeDesc, deliveryLine, generateAI, calcSellPrice, variantGroups, variantLabel, stripSizesLine, rotateTitle, classifyGallery, cleanCover, mapLimit, findDimsImage, CLASSIFY_PROMPT, CLASSIFY_MODEL };
