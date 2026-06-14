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

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tzwzmzabjmsocnxdtxqx.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CATEGORY_ALLOWLIST = [
  'Furniture',
  'Home & Living',
  'Bedding',
  'Towels',
  'Storage',
  'Organisation',
  'Organization',
  'Home Appliances',
  'Tools',
  'Home Improvement',
  'Safes',
  'Security',
  'Garden',
  'Outdoors',
];

const PRICE_BAND_MIN = 15;
const PRICE_BAND_MAX = 150;

// ── AI prompts (mirrors work.html) ────────────────────────────────────────────

const TITLE_SYSTEM = `You are a Carousell Singapore listing title writer. Buyers find the listing by typing words into search, so the title must be packed with the DISTINCT, RELEVANT terms a real buyer would type for THIS specific item.

TASK: Write one Carousell title for the product below. Output the title text only — no JSON, no quotes, no explanation.

RULES:
- 180–225 characters (count carefully — this is critical)
- Start with the item's most identifiable noun phrase (e.g. "Queen Size Bed Frame", "3-Door Wardrobe", "Standing Fan")
- Follow with: key specs → brand/series if prominent → materials → colour/finish → standout features → secondary uses
- Separate segments with " | " or " - " (your choice, stay consistent)
- Include synonyms buyers actually type: both "wardrobe" and "cabinet" if relevant, both "sofa" and "couch", etc.
- No promotional filler: no "Great deal", "Must buy", "Cheap", "Best seller"
- No emojis, no ALL CAPS words
- Silently count characters. If under 180 or over 225, fix by adding or removing a DISTINCT angle — never by repeating a segment. Output only the final title.`;

const DESC_SYSTEM = `You are a Carousell Singapore listing copywriter. Output ONLY a JSON object: {"description":"..."}. Plain text inside — no markdown, no **bold**, no #headers.

STEP 1 — Silently detect the category from the product text: FURNITURE/BULKY, ELECTRONICS/GADGET, or HOMEWARE/KITCHEN. This sets the depth and which details lead.

STEP 2 — Write the description (plain text, newlines allowed, no markdown):

For FURNITURE/BULKY:
- Open with 1–2 sentences on the key selling point (what makes this worth buying)
- Dimensions / size specs (if present in product info)
- Materials & finish
- Assembly: yes/no, time estimate if inferrable
- Delivery note: "Bulky item — delivery charges apply. Contact us for a quote."
- Close: "Message us to check availability."

For HOMEWARE/KITCHEN:
- Open with primary use + one reason to buy
- Key specs (capacity, dimensions, material, colour)
- Compatibility / what it works with
- Close: "Message us to check availability."

For ELECTRONICS/GADGET:
- Open with model + headline spec
- Key specs list (plain text, one per line OK)
- Compatibility
- Warranty / condition note if inferrable
- Close: "Message us to check availability."

HARD RULES (all categories):
- 120–300 words
- No prices, no dollar amounts
- No shipping promises you can't keep
- No emojis
- No invented specs — only what the product text supports`;

// ── helpers ───────────────────────────────────────────────────────────────────

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

function calcSellPrice(cost) {
  const raw = Math.max(cost * 1.5, cost + 24);
  return Math.ceil(raw / 5) * 5;
}

// Returns true (allowed), false (warn), or null (unknown — skip guard)
function categoryAllowed(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return null;
  const topCat = categories[0] || '';
  return CATEGORY_ALLOWLIST.some(a => topCat.toLowerCase().includes(a.toLowerCase()));
}

async function callClaudeInternal(system, userContent, maxTokens, temperature = 0.3) {
  const base = process.env.VERCEL_URL
    ? 'https://' + process.env.VERCEL_URL
    : 'https://workers-v1.vercel.app';
  const resp = await fetch(`${base}/api/claude`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ system, userContent, maxTokens, temperature }),
  });
  if (!resp.ok) throw new Error('claude ' + resp.status);
  const data = await resp.json();
  return data.text || '';
}

async function generateAI(productText) {
  const productContent = `Product info:\n\n${productText}`;
  const [rawTitle, rawDesc] = await Promise.all([
    callClaudeInternal(TITLE_SYSTEM, productContent, 512, 0.3),
    callClaudeInternal(DESC_SYSTEM, productContent, 1536, 0.5),
  ]);
  const title = rawTitle.trim().split('\n')[0].trim();
  let description = '';
  try {
    description = JSON.parse(rawDesc.trim()).description || '';
  } catch {
    description = rawDesc.trim();
  }
  return { title, description };
}

// ── main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { worker_id, inbox_id } = req.body || {};
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' });

  // 1. Validate worker
  const { data: worker, error: wErr } = await sb
    .from('workers').select('id, name, active').eq('id', worker_id).single();
  if (wErr || !worker) return res.status(404).json({ ok: false, error: 'worker-not-found' });
  if (!worker.active)  return res.status(403).json({ ok: false, error: 'worker-inactive' });

  // 2. Fetch oldest pending inbox row for this worker
  let q = sb
    .from('scrape_inbox')
    .select('id, payload, categories, shop_location, rating_star, consumed')
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
  const p   = row.payload || {};

  // Unloaded sentinel — AUTO mode couldn't get data
  if (p.unloaded) {
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    return res.json({ ok: false, error: 'unloaded', skipped: true });
  }

  const shopeeUrl    = normalizeShopeeUrl(p.url);
  const categories   = row.categories   || p.categories   || null;
  const shopLocation = row.shop_location || p.shop_location || null;
  const ratingStar   = row.rating_star   != null ? row.rating_star : (p.rating_star != null ? p.rating_star : null);
  const cost = Math.max(
    p.price_max || 0,
    p.price_min || 0,
    ...(p.models || []).map(m => m.price || 0)
  );

  if (!shopeeUrl) {
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    return res.json({ ok: false, error: 'no-url' });
  }

  // 3. Duplicate check — hard block
  const { data: existing } = await sb
    .from('listings').select('id').eq('shopee_url', shopeeUrl).limit(1);
  if (existing && existing.length > 0) {
    await sb.from('scrape_inbox').update({ consumed: true }).eq('id', row.id);
    return res.json({ ok: false, error: 'duplicate', listing_id: existing[0].id });
  }

  // 3b. Fuzzy near-match check — log silently, never block
  try {
    if (p.title && cost > 0) {
      const { data: fuzzyMatches } = await sb.rpc('find_fuzzy_duplicate', {
        p_title: p.title,
        p_cost: cost,
        p_threshold: 0.6,
      });
      if (fuzzyMatches && fuzzyMatches.length > 0) {
        sb.from('duplicate_log').insert({
          listing_id:     fuzzyMatches[0].listing_id,
          incoming_title: p.title,
          incoming_url:   shopeeUrl,
          incoming_cost:  cost,
          worker_id:      worker_id,
        }).then(({ error }) => {
          if (error) console.error('duplicate_log insert failed:', error.message);
        });
      }
    }
  } catch (fuzzyErr) {
    console.error('fuzzy dupe check failed:', fuzzyErr.message);
  }

  // 4. Soft guards
  const warnings = [];
  const catOk = categoryAllowed(categories);
  if (catOk === false) warnings.push('category');
  if (shopLocation !== null && shopLocation !== undefined) {
    if (String(shopLocation).toLowerCase() !== 'singapore') warnings.push('non-sg-seller');
  }
  if (ratingStar !== null && ratingStar !== undefined) {
    if (Number(ratingStar) < 4.0) warnings.push('low-rating');
  }
  if (cost > 0 && cost < PRICE_BAND_MIN) warnings.push('price-too-low');
  if (cost > 0 && cost > PRICE_BAND_MAX) warnings.push('price-too-high');

  // 5. Sell price
  const sellPrice = cost > 0 ? calcSellPrice(cost) : null;

  // 6. AI generation (non-fatal)
  let aiTitle = null;
  let aiDescription = null;
  try {
    const productText = [p.title, p.description].filter(Boolean).join('\n\n');
    if (productText.trim()) {
      const ai = await generateAI(productText);
      aiTitle       = ai.title       || null;
      aiDescription = ai.description || null;
    }
  } catch (aiErr) {
    console.error('AI gen failed:', aiErr.message);
  }

  // 7. Create listing
  const { data: listing, error: lErr } = await sb
    .from('listings')
    .insert({
      title:              p.title || '',
      shopee_url:         shopeeUrl,
      source_cost:        cost || null,
      sell_price:         sellPrice,
      images:             p.images && p.images.length ? p.images : null,
      status:             'active',
      assigned_worker_id: worker_id,
      guard_warnings:     warnings.length ? warnings : null,
      ai_title:           aiTitle,
      ai_description:     aiDescription,
    })
    .select('id')
    .single();

  if (lErr) {
    console.error('listing insert error:', lErr);
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
