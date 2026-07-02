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

const PRICE_BAND_MIN = 15;
const PRICE_BAND_MAX = 150;

// ── AI prompts — kept in sync with work.html ────────────────────────────────

const TITLE_SYSTEM = `You are a Carousell Singapore listing title writer. Buyers find the listing by typing words into search, so the title must be packed with the DISTINCT, RELEVANT terms a real buyer would type for THIS specific item.

TASK: Write one Carousell title for the product below. Output the title text only — no JSON, no quotes, no explanation.

STEP 1 — Silently identify the category from the product text:
- FURNITURE / BULKY HOME (sofa, chair, table, shelf, bed, mattress, safe, cabinet, rack): buyers search by item type, size/dimensions, material, load/weight capacity, room, style.
- ELECTRONICS / GADGET (keyboard, charger, speaker, lamp, fan, small appliance): item type, key spec, connectivity, compatibility, standout feature.
- HOMEWARE / KITCHEN (plates, cookware, storage, organiser): item type, set/piece count, material, capacity/size, use.
- If unclear, lead with item type + strongest concrete attributes.

STEP 2 — Write the title:
1. Length: 180–225 characters. Count every character. This is the strictest rule.
2. Format: pipe-separated ( | ) Title Case segments, each 3–6 words, each a complete phrase a buyer could actually type into search.
3. Front-load the single strongest search phrase in the first 40 characters — the feed truncates the visible title there.
4. COVER DIFFERENT SEARCH ANGLES — never repeat the same phrase. Each segment adds a NEW angle: item-type synonyms, a real attribute (size, material, capacity, colour), a feature, a use case. You may reuse the core item word with a DIFFERENT modifier each time, but near-duplicate segments read as keyword stuffing and get listings hidden.
5. Use ONLY attributes that appear in the product text. NEVER invent dimensions, weights, materials, capacities or compatibility.
6. Correct spelling. Do not copy source typos.
7. NEVER include: brand names, model numbers/SKUs, platform names (Shopee, Carousell, Lazada, Amazon), seller phrases ("Local Seller", "SG Seller", "Fast Delivery"), prices, the words "Brand New / Free Shipping / nice / cheap / best", emojis, or the symbols ! @ # $ % * &.

GOOD (distinct angles, not repetition):
Plastic Stool | Modern Stackable Stool | Bathroom Stool | Dining Stool | Dressing Table Stool | Compact Side Stool | Space Saving Stool | Minimalist Home Furniture

BAD (same phrase repeated — gets hidden):
Gaming Keyboard | RGB Gaming Keyboard | Best Gaming Keyboard | Gaming Keyboard SG | Gaming Keyboard Cheap

Silently count characters. If under 180 or over 225, fix by adding or removing a DISTINCT angle — never by repeating a segment. Output only the final title.`;

const DESC_SYSTEM = `You are a Carousell Singapore listing copywriter. Output ONLY a JSON object: {"description":"..."}. Plain text inside — no markdown, no **bold**, no #headers.

STEP 1 — Silently detect the category from the product text: FURNITURE/BULKY, ELECTRONICS/GADGET, or HOMEWARE/KITCHEN. This sets the depth and which details lead.

STEP 2 — Choose depth:
- HIGH-TICKET BULKY FURNITURE (sofa, table, bed, mattress, large cabinet, shelf): fuller — 6 to 8 bullets, lead with what reassures a considered buyer.
- CHEAP / SIMPLE items (small homeware, gadgets, organisers): leaner — 3 to 5 bullets. Do not pad; an over-bulleted block on a cheap item reads as spam.

STEP 3 — Write in exactly this structure:

LINE 1 (must start with 🚚): a short, punchy delivery line. MUST always include the word "Free" and "Delivery". e.g. "🚚 Free Doorstep Delivery | 1-3 Working Days". You may vary the wording naturally (e.g. "Free Delivery", "Free Doorstep Delivery", "Free Shipping") but "Free" and "Delivery" must always appear. Keep it to one tight line — do NOT cram the value-sell here.

(blank line)

ONE hook sentence: what it is + 2–3 standout features + who/what it's for.

(blank line)

Bullets, each: ✅ [Feature] — [what it means for the buyer]. ORDER BY WHAT THIS BUYER DECIDES ON:
- FURNITURE/BULKY: dimensions FIRST (will it fit), then material/build, weight or load capacity, assembly, colour/finish, room/use.
- ELECTRONICS/GADGET: key specs first, then compatibility, connectivity, features, what's in the box.
- HOMEWARE/KITCHEN: set/piece count first, then material, dimensions/capacity, microwave/dishwasher/oven safe, care.
For BULKY items, include one value bullet worded to the item, e.g. "✅ Delivered To Your Door — no lorry to rent, no carrying it up yourself". For small/light items, skip this bullet (a delivery hard-sell looks overblown).
Always include: "✅ Brand New — unused" (sealed/flat-packed as appropriate).

If the source lists colour/size variants, add ONE line BEFORE the payment line: "📦 Sizes available: ..." or "📦 Finishes available: ...". Summarise many variants into a readable range (e.g. "45×30, 55×35, 65×42cm footprints · 1 to 5 layers") — do not dump every row. Omit this line entirely if there are no variants. Then add: "💬 Message us to order or check stock".

LAST LINE (exact, verbatim, nothing after it):
💳 PayNow / PayLah / Bank Transfer / Credit & Debit Card / Carousell Buy Button accepted 🙂

RULES:
- State ONLY facts in the product text. NEVER invent dimensions, weight, material, capacity or compatibility. If a key spec is missing, write a genuine benefit bullet instead — do not guess. Wrong specs cause returns.
- No brand names, no platform names (Shopee/Lazada/Amazon).
- No vague filler on its own ("high quality", "amazing", "best", "premium") — pair a concrete feature with a concrete benefit.
- Vary phrasing between listings so descriptions never read as mass-produced duplicates.
- Keep it scannable.`;

// ── helpers ───────────────────────────────────────────────────────────────────

// Mirrors work.html normalizeDesc — ensures delivery line is first and payment
// line is last, exactly matching what the owner's FIX tab produces. Without this,
// VA-generated descriptions could have the 🚚 line buried mid-text or missing.
function normalizeDesc(text) {
  if (!text) return text;
  const DELIVERY = '🚚 Free Doorstep Delivery | 1-3 Working Days';
  const PAYMENT  = '💳 PayNow / PayLah / Bank Transfer / Credit & Debit Card / Carousell Buy Button accepted 🙂';
  let lines = text.split('\n');

  // Delivery line must be first
  if (!lines[0].trim().startsWith('🚚')) {
    const idx = lines.findIndex(l => l.includes('🚚') || l.includes('FREE Local Delivery'));
    if (idx > 0) {
      const [found] = lines.splice(idx, 1);
      while (lines.length && !lines[0].trim()) lines.shift();
      lines = [found.trim(), '', ...lines];
    } else if (idx === -1) {
      lines = [DELIVERY, '', ...lines];
    }
  }

  // Payment line must be last
  const lastNonEmptyIdx = [...lines].map((l, i) => l.trim() ? i : -1).filter(i => i !== -1).pop();
  const hasPaymentAtEnd = lastNonEmptyIdx !== undefined && lines[lastNonEmptyIdx].trim() === PAYMENT;
  if (!hasPaymentAtEnd) {
    const idx = lines.findIndex(l => l.includes('💳') || l.includes('PayNow'));
    if (idx !== -1) lines.splice(idx, 1);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', PAYMENT);
  }

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

function calcSellPrice(cost) {
  const raw = Math.max(cost * 1.5, cost + 24);
  return Math.ceil(raw / 5) * 5;
}

// Call Anthropic directly — worker-scrape is server-side so it can use the key
// directly rather than routing through /api/claude (which adds a fragile internal
// HTTP hop that was the root cause of silent AI generation failures).
async function callClaudeDirect(system, userContent, maxTokens, temperature = 0.3) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'anthropic ' + resp.status);
  }
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || '';
}

async function generateAI(productText) {
  const productContent = `Product info:\n\n${productText}`;
  const [rawTitle, rawDesc] = await Promise.all([
    callClaudeDirect(TITLE_SYSTEM, productContent, 512, 0.3),
    callClaudeDirect(DESC_SYSTEM, productContent, 1536, 0.5),
  ]);
  let title = rawTitle.trim().split('\n')[0].trim();
  // Retry once if title is too short (mirrors work.html behaviour)
  if (title.length < 180) {
    try {
      const retry = await callClaudeDirect(
        TITLE_SYSTEM,
        productContent + '\n\nIMPORTANT: Previous attempt was too short. Reach at least 180 characters by ADDING A NEW DISTINCT ANGLE (a different feature, attribute, or use case). Do NOT repeat or pad existing segments.',
        512, 0.3
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
  let description = '';
  try {
    // Strip markdown code fences if present before parsing
    const cleaned = rawDesc.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    description = normalizeDesc(JSON.parse(cleaned).description || '');
  } catch {
    // Claude returned malformed JSON — strip wrapper and use raw text
    const raw = rawDesc.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      .replace(/^\s*\{[^"]*"description"\s*:\s*"/, '')
      .replace(/"\s*\}\s*$/, '');
    description = normalizeDesc(raw || rawDesc.trim());
  }
  return { title, description };
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
  const isRefresh = existingListing && existingListing.status === 'active';

  if (existingListing && !isRefresh) {
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
  }

  // 5. Sell price
  const sellPrice = cost > 0 ? calcSellPrice(cost) : null;

  // 6. AI generation (non-fatal)
  let aiTitle = null;
  let aiDescription = null;
  try {
    const productText = [p.title, p.description].filter(Boolean).join('\n\n');
    if (productText.trim()) {
      const ai = await generateAI(productText);
      aiTitle       = ai.title       ?? null;
      aiDescription = ai.description ?? null;
    }
  } catch (aiErr) {
    console.error('AI gen failed:', aiErr.message);
  }

  // 7a. Refresh existing active listing — update AI, images, price, and assignment
  if (isRefresh) {
    const { error: updateErr } = await sb.from('listings').update({
      assigned_worker_id: worker_id,
      account_name:       worker.account_name || null,
      ai_title:           aiTitle,
      ai_description:     aiDescription,
      images:             p.images && p.images.length ? p.images : null,
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

  // 7b. Create new listing
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
