# Code notes — review findings & cost analysis

Working notes from a read-through of the repo. Nothing here is a code change; it is
a record of things spotted so they don't get lost.

---

## Part 1 — Discrepancies found

### Stale docs

- **README pricing formula is wrong.** README says `max(cost × 1.5, cost + $24)` rounded
  up to the next $5, with the example "$20 cost → sell at $65". The code
  (`calcSellPrice`, `api/worker-scrape.js:167`) is `ceil(max(cost×1.5, cost+25)/10)*10 - 1`
  — $x9 endings. A $20 cost sells at **$49**, not $65. The README example does not even
  match the README's own formula (which would give $45).
- **README doc links are broken.** It links `VA-PLAN.md`, `SCRAPERS.md`, `TEST-PLAN.md`
  at repo root; all three live in `docs/`.
- **`carousell-fill.user.js`** is documented in the README but is not in the repo. Only
  `shopee-work.user.js` is present. README does note it is "shelved".
- **`vercel.json`** rewrites `/demo-7k2m9x` → `/demo-7k2m9x.html`, which does not exist.

### Dead code / unfinished wiring

- **`duplicate_log` is never written.** The table and its indexes exist in
  `supabase/migrations-phase2.sql`, and the `find_fuzzy_duplicate` RPC does run, but
  `api/worker-scrape.js:859` only `console.log`s the match. The "reviewed by owner
  weekly" workflow the migration describes has no data behind it.
- **`ANTHROPIC_API_KEY` is effectively unused.** Only `findDimsImage` reads it, and that
  only runs under `IMAGE_PICK`, which is off. Everything live goes through OpenRouter —
  a deliberate move after the Anthropic account ran out of credit and every title
  silently came back null.

### Security / access

- **`scrape_inbox` RLS is wide open to anon** (`supabase/scrape_inbox.sql`): insert,
  select *all rows*, and update *all rows*. Any holder of the publishable key can read
  every worker's scrape payloads and flip `consumed` on anyone's queue. This may be an
  accepted trade for the bookmarklet architecture — bookmarklets have to write with the
  anon key — but it is not recorded as a decision anywhere.
- **VA auth is the URL.** `?w=<uuid>` is the entire credential. Documented as intentional
  in `docs/VA-PLAN.md`; `work.html` has a link-rotation control for when one leaks.

### Duplicated logic to keep in sync

`calcSellPrice` exists in three places with "MUST match" comments:
`api/worker-scrape.js:167`, `work.html:614` (`calcSell`), `analyze-jiji.js:20`.

---

## Part 2 — Where the money actually goes

Measured from the code paths, not from a bill. **Only image generation costs real
money. Text is noise.**

### Per product, at current defaults

| Step | Calls | Cost |
|---|---|---|
| Title copy (`callCopyModel`, DESC_MODE=fixed → no desc call) | 1 text | ~$0.002 |
| Swatch classification (`variantCovers` → `classifyGallery`) | 1 vision | ~$0.003–0.01 |
| **Cover cleaning** (`cleanCover`, per flagged colour) | N image-gen + N verify | **~$0.04 each** |
| Background restaging (`worker-variants`) | BG_COVERS × BG_VARIANTS | **~$0.04 each**, off by default |

`$0.04/image` is the repo's own figure (`api/worker-scrape.js:541`) and matches
`gemini-2.5-flash-image` list pricing.

### The shape of the bill

Total cost ≈ **$0.04 × (number of images generated)**. Everything else rounds to zero.

Image generation happens in exactly three places:

1. `variantCovers` → `cleanCover` — the **only one currently live**
2. cover-split → `cleanCover` — gated by `COVER_SPLIT`, **off** since 2026-08-06
3. `worker-variants` → `restage` — gated by `BG_VARIANTS`, **off** (defaults to 0)

So today's entire image bill is variant swatch cleaning: one generation per colour
flagged `needs_clean`, typically 3–6 per product. Call it **$0.12–$0.24 a product**,
which across the 1,651-row `va-queue.csv` is **$200–$400**.

### Two things that make it worse than it looks

- **Rejected generations are paid for and binned.** `cleanCover` fails closed — if
  `verifyClean` does not return an explicit `VERDICT: GOOD`, the image is discarded and
  the 4c is spent anyway. Same in `worker-variants`, where the comment records ~1 in 4
  generations quietly keeping the original room and being rejected.
- **Nothing is cached.** Re-scrape the same product, or repost it under
  `ALLOW_DUPLICATES`, and every cover is regenerated at full price — even though the
  previous result is still sitting in the `covers` bucket. Since duplicate-listing is
  an explicit business strategy, this is a recurring charge.

---

## Part 3 — Cost reduction, cheapest first

### Free, no output loss

1. **`CLEAN_COVERS=false`.** With cover-split and BG variants already off, this takes
   the image bill to **zero** — the whole queue then costs ~$3 in text calls. Swatches
   ship as the seller made them. The code's own fallback comment already treats this as
   acceptable: *"Better a branded swatch than 23 listings with no colour at all."*
2. **Stop paying Apify.** 1,651 URLs are already queued — weeks of VA work at 100/day.
   And `shop.js` pages an entire shop catalogue client-side for $0, which is what Apify
   is being paid to do.
3. **Confirm `BG_VARIANTS=0` in the Vercel env.** At BG_COVERS=5 × 4 scenes that is 20
   generations (~$0.80) per product, a quarter of them binned by the check.

### Small code change, near-zero output loss

4. **Cache cleaned covers by source URL** — a `cover_cache(src_url PK, clean_url)` table.
   Makes reposts and re-scrapes free. ~15 lines.
5. **Downscale before classifying.** Full-resolution Shopee images are base64'd into
   vision calls today; the CDN serves smaller variants via suffix. Cuts the vision bill
   and the function's wall-time, changes nothing about the output.
6. **`CLEAN_MAX` 8 → 2.** Caps the tail on products with many colours.

### Trade-offs worth considering

7. **Crop instead of generate.** Overlays sit at edges and corners. A border crop with
   `sharp` costs $0 and runs in-process. It loses some framing — but today's failure
   path drops the cover *entirely*, which loses more.
8. **Add a hard spend cap.** Nothing currently stops a runaway. The 2026-08-06 incident
   (three overlapping runs → 57 listings from 47 covers) is exactly how a bug becomes a
   bill. A `spend_log` row per generation plus a daily ceiling would have capped it.

### The strategic question

The competitor analysis already in the code comments (12,626 listings, 8 distinct
descriptions) concluded the **title** does the work, not the description — and that is
why `DESC_MODE=fixed` is the default. There is no equivalent evidence that the **cover**
needs to be *generated* rather than *selected*. Until there is, generation is the one
line item paying for an unproven hypothesis.
