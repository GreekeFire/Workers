# VA System Plan

VAs source products on Shopee and upload listings to Carousell. Owner manages and monitors via a new WORKERS tab. All decisions locked below — items marked **TEST LATER** need a live Shopee page to verify.

---

## Role split

| Action | Owner | VA |
|---|---|---|
| Source products (Shopee scrape) | Optional | Primary job |
| Create listing records (NEW tab) | Yes | Never |
| Generate AI title + description | Auto on scrape | Never (auto-generated for them) |
| Upload to Carousell (copy-paste + post) | Optional | Primary job |
| Mark listing Done | As before | Yes |
| See source cost / margin | Yes | Never |
| Log sales / revenue | Yes | Never |
| Delete listings | Yes | Never |
| Respond to Carousell DMs | Yes | SOP: never |
| Carousell autofill userscript | Owner only (shelved) | Never |

---

## Auth model

- **Owner** — existing Supabase email + password. Unchanged.
- **VA** — UUID-based personal link. No login screen, no Supabase account.
  - URL: `workers-v1.vercel.app/va?w={UUID}`
  - UUID is generated when owner creates a worker. Non-guessable (128-bit).
  - Deactivate instantly: owner sets `active = false` → link stops working.
  - Rotate link: owner regenerates UUID → old link dead, new link sent to VA.
  - All VA writes go through `/api/` server endpoints using the service role key — never exposed to the browser.

---

## VA daily workflow

1. Open personal link (`/va?w=UUID`) — bookmarked on phone/laptop
2. See name, progress bar (0/100), current listing card
3. If queue has listings → work through them (see below)
4. If queue is empty → go to Shopee, browse, find a good product, click personal Shopee bookmarklet
5. Product appears on va.html automatically (~10s, auto-poll every 10s)
6. Warnings shown if any (category, seller location, rating) — VA acknowledges and proceeds or skips
7. AI title + description + sell price already filled (generated automatically at scrape time)
8. VA manually opens Carousell sell page
9. Tap **Copy title** → paste into Carousell
10. Tap **Copy description** → paste into Carousell
11. Type sell price (shown large on va.html)
12. Download images (one tap) → upload to Carousell manually
13. Post listing on Carousell
14. Tap **Done ✓** in va.html → count increments → next listing loads
15. Repeat to 100

---

## Shopee bookmarklet (personalised per VA)

Each VA gets a bookmarklet with their UUID hardcoded. Works on any device — UUID is in the URL, not localStorage, so laptop + phone + any browser all work with the same bookmark.

**Format:**
```
javascript:window.__swWorker='WORKER-UUID-HERE';fetch('https://workers-v1.vercel.app/sc.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load '+e))
```

- va.html displays the VA's personalised bookmarklet for them to copy
- sc.js reads `window.__swWorker` and includes `worker_id` in the scrape_inbox payload
- `worker_id = null` → owner scrape (existing behaviour, zero regression)
- VA installs once per device, never needs to reinstall

**No Carousell autofill for VAs.** The Carousell fill userscript is owner-only and shelved for fixes. VAs copy-paste manually using the Copy buttons on va.html.

---

## Scrape → listing pipeline

```
VA clicks bookmarklet on Shopee product page
        │
        ▼
sc.js sends to scrape_inbox
  payload: { title, description, price_min/max, models, images, sold, stock, url,
             worker_id, categories, shop_location, rating_star }
        │
        ▼
/api/worker-scrape (server-side)
  1. Validate worker_id is real + active
  2. Duplicate check: Shopee URL already in listings? → reject
  3. Category guard: top-level category in allowlist?
  4. SG seller guard: shop_location = "Singapore"?
  5. Rating guard: rating_star >= 4.0?
  6. Create listings row (assigned_worker_id = worker UUID, status = 'active')
  7. Store guard_warnings on the row
  8. Call /api/claude → auto-generate ai_title + ai_description → save to row
        │
        ▼
va.html polls every 10s → new listing appears with warnings + AI content ready
```

---

## Product guards

| Guard | Type | Logic | Data source |
|---|---|---|---|
| Duplicate | **HARD BLOCK** | Shopee URL already in listings table | listings lookup |
| Category | Soft warn | Top-level category not in allowlist | v4 API ✅ · dataLayer **TEST LATER** |
| SG seller | Soft warn | shop_location ≠ "Singapore" | v4 API ✅ · dataLayer **TEST LATER** |
| Star rating | Soft warn | rating_star < 4.0 | v4 API ✅ · dataLayer **TEST LATER** |

**Category allowlist (allowed):** Furniture, Home & Living, Bedding & Towels, Storage & Organisation, Home Appliances, Tools & Home Improvement, Safes & Security, Garden & Outdoors.

**Category warn on:** Women's Apparel, Men's Apparel, Jewellery & Accessories, Shoes, Bags & Wallets, Beauty & Personal Care, Food & Beverages, Toys/Kids/Babies — and anything else not in the allowlist.

**TEST LATER:** Whether the dataLayer path (puzzle-free) exposes categories, shop_location, and rating_star. The v4 API path definitely has all three. Until dataLayer is verified, dataLayer scrapes that miss these fields skip the guards and create the listing normally (no false blocks).

---

## Database changes

### New table: `workers`
```sql
CREATE TABLE workers (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT         NOT NULL,
  daily_target  INT          DEFAULT 100,
  active        BOOL         DEFAULT true,
  created_at    TIMESTAMPTZ  DEFAULT now()
);
```

### New table: `worker_done`
```sql
CREATE TABLE worker_done (
  id             BIGSERIAL    PRIMARY KEY,
  worker_id      UUID         REFERENCES workers(id),
  listing_id     INT          REFERENCES listings(id),  -- nullable if listing deleted
  listing_title  TEXT,                                   -- snapshot at Done time
  done_at        TIMESTAMPTZ  DEFAULT now(),
  date           DATE         DEFAULT CURRENT_DATE
);
```

### Add columns to `listings`
```sql
ALTER TABLE listings ADD COLUMN assigned_worker_id  UUID  REFERENCES workers(id) DEFAULT NULL;
ALTER TABLE listings ADD COLUMN ai_title            TEXT;
ALTER TABLE listings ADD COLUMN ai_description      TEXT;
ALTER TABLE listings ADD COLUMN guard_warnings      JSONB;  -- e.g. ["non-sg-seller","low-rating"]
```

### Add columns to `scrape_inbox`
```sql
ALTER TABLE scrape_inbox ADD COLUMN worker_id      UUID;    -- NULL = owner scrape
ALTER TABLE scrape_inbox ADD COLUMN categories     TEXT[];  -- from v4 API (dataLayer TEST LATER)
ALTER TABLE scrape_inbox ADD COLUMN shop_location  TEXT;    -- from v4 API (dataLayer TEST LATER)
ALTER TABLE scrape_inbox ADD COLUMN rating_star    FLOAT;   -- from v4 API (dataLayer TEST LATER)
```

---

## New API endpoints

| Endpoint | Called by | Does |
|---|---|---|
| `/api/worker-profile` | va.html on load | GET ?w=UUID → {name, daily_target, count_today}. Validates active=true. |
| `/api/worker-listings` | va.html poll (10s) | GET ?w=UUID → assigned active listings. Never returns source_cost. |
| `/api/worker-scrape` | sc.js via scrape_inbox | Receives scrape → runs guards → creates listing → auto AI gen → returns {ok, warnings[]} |
| `/api/worker-done` | va.html | POST {worker_id, listing_id} → status='done', inserts worker_done row, returns {ok, count_today} |
| `/api/worker-skip` | va.html | POST {worker_id, listing_id} → advances queue. No DB change. |

All endpoints use `SUPABASE_SERVICE_ROLE_KEY` (env var). Validate UUID is real + active before any write.

---

## va.html

**URL:** `/va?w={UUID}` — bookmarkable, permanent.

**Header:** VA name · today's count / target as progress bar. Nothing else.

**Listing card states:**

1. **Ready** — AI title (read-only), description (collapsed, tap to expand), sell price (large green), image thumbnails, Copy title button, Copy description button, Download images button, Done ✓ button, Skip → button.
2. **Warnings present** — warning chips above card content. Each soft warn has "Add anyway" tap. Duplicate has no "Add anyway" — just Skip. VA must acknowledge before Done is enabled.
3. **Queue empty** — "Go source more products on Shopee." Shows count for the day. Page auto-polls every 10s in case owner assigns listings or a scrape lands.

**VA never sees:** source cost, Shopee URL, sales data, revenue, other VAs, delete button, AI generate button, owner's FIX/NEW/SALES/LISTINGS tabs.

**One-time VA setup (instructions to send them):**
1. Open your personal link — bookmark it
2. Copy your personal Shopee bookmarklet from the page → add to browser bookmarks on laptop + phone
3. Log into Carousell (shared credentials)
4. Log into Shopee with your own personal Shopee account

---

## Owner changes to work.html

### New WORKERS tab
- Worker list: name · today count/target · total all-time · warning count today · Copy link button · Active toggle
- Warning badges expand to show which listings triggered them (category/location/rating)
- **Add worker:** name + daily target → generates UUID → shows va.html link + personalised bookmarklet
- **Assign next N:** input N → assigns next N unassigned active listings to that VA
- **Rotate link:** regenerates UUID → old link stops working immediately

### FIX tab (minor)
- `markDone()` saves `ai_title` + `ai_description` to the listing row (same write as title/cost/sell — no UI change)
- Listing cards show "Assigned to [name]" chip if assigned — owner won't double-work it

### LISTINGS tab (minor)
- Assigned badge per row
- Filter: Unassigned / Assigned to [VA name]
- Batch assign: select multiple → assign to VA dropdown

---

## sc.js changes needed

1. Add `window.__swWorker` reading: `const wid = window.__swWorker || null`
2. Include `worker_id: wid` in every payload sent to scrape_inbox
3. In `fetchItem` (v4 path): capture and return `categories`, `shop_location`, `rating_star` from the raw API response
4. In `fromDataLayer`: attempt same fields — **TEST LATER** to confirm availability
5. Pass all three fields through to the scrape_inbox payload

---

## Carousell account

All VAs log into the owner's Carousell account (shared credentials).

**SOP for VAs:** only create listings. Never respond to DMs, never delete listings, never change prices on existing listings.

**If VA leaves:** change Carousell password immediately + set worker.active = false in WORKERS tab.

---

## Warnings (in-app only)

Owner sees warnings in the WORKERS tab — no push/email for now.

| Warning | Trigger |
|---|---|
| Category warning | VA scraped item outside the allowlist |
| Non-SG seller | shop_location ≠ Singapore |
| Low rating | rating_star < 4.0 |
| Missed target | VA significantly below daily_target by end of day |

---

## Build order

| # | Step | Unlocks |
|---|---|---|
| 1 | DB migrations (workers, worker_done, new columns on listings + scrape_inbox) | Everything |
| 2 | sc.js: add `__swWorker` + capture categories/location/rating from v4 | Tagged scrapes + guard data |
| 3 | `/api/worker-scrape`: guards + listing creation + auto AI gen | Full VA sourcing pipeline |
| 4 | `/api/worker-profile` + `/api/worker-listings` | va.html can load |
| 5 | `/api/worker-done` + `/api/worker-skip` | VA can complete listings |
| 6 | va.html | VA has a working app — MVP done |
| 7 | WORKERS tab in work.html | Owner creates VAs, assigns, monitors |
| 8 | Save ai_title/ai_description in owner's `markDone()` | Owner-sourced listings carry AI content for VAs |
| 9 | FIX + LISTINGS tab badge additions | Owner won't double-work assigned items |
| 10 | Test dataLayer for category/location/rating on live Shopee page | Guards work on puzzle-free path too |

**Steps 1–7 = first VA can work.**
Steps 8–9 are owner workflow polish. Step 10 is a test task, not a build task.

---

## Known issues & additional work

Issues identified before build. Ranked by urgency.

---

### 1. Carousell multi-IP risk — investigate before onboarding VAs

**Priority: Do first.**

Owner ran 200 listings/day solo with no issues — volume alone is not the trigger. The new risk with VAs is multiple people logging into one Carousell account from different IPs/devices simultaneously. Carousell rolled out new security in Jan 2026 specifically to detect accounts accessed by third parties (targeting scammers who "buy" verified accounts). Multiple VA IPs on one account could pattern-match this detection.

**What to do:**
- Start with one VA posting from their device/IP at moderate pace (20–30/day) for 2–3 days
- Watch for: CAPTCHA challenges, account warnings, listing removals, login blocks
- If no issues → scale up normally
- If issues appear → consider separate Carousell accounts per VA (changes WORKERS tab — needs per-VA credentials field)

**Research findings:**
- Volume alone is not a documented trigger (owner confirmed 200/day was fine)
- Carousell blocks IPs flagged as "malicious or suspected of engaging in malicious activities"
- Duplicate listings (same product twice) is explicitly against ToS — covered by existing URL dedup guard
- No published listing rate limit found
- Sources: [Listing rules](https://support.carousell.com/hc/en-us/articles/360000689008-Listing-rules) · [Account Enforcement Policy](https://support.carousell.com/hc/en-us/articles/50027952874137-Account-Enforcement-Policy) · [IP blocking](https://support.carousell.com/hc/en-us/articles/900005366606-How-to-check-if-my-IP-address-is-blocked-by-Carousell)

---

### 2. Sales attribution — add listing_id to sale records before building

**Priority: Schema decision now — unrecoverable gap if missed.**

Currently `salesLog` entries store `listing` as a title string, not a `listing_id`. No way to join a sale back to a listing row, so no way to know which VA's listings are actually converting vs. just hitting count targets.

Example: VA-A posts 100/day, hits target, looks great. VA-B posts 60/day, misses target, looks weak. But if VA-B's listings convert and VA-A's don't, the dashboard tells you the wrong story and you optimise toward the wrong VA.

**Fix:** Add `listing_id` to the sales log schema before the VA system goes live. `listings` rows already carry `assigned_worker_id` — one join gives "revenue attributable to VA X." One column now vs. unrecoverable gap once listings are pooled.

**Future:** WORKERS tab should show a conversion metric alongside raw count so VAs can't game the system by sourcing fast-to-scrape junk that never sells.

---

### 3. Price band guard — add cost floor/ceiling to scrape pipeline

**Priority: Cheap — fold into build step 3.**

Category guard checks Shopee's taxonomy but sellers miscategorise constantly. A $15 plastic desk organiser can pass "Storage & Organisation" and get priced at $39 — wrong fit for a furniture-focused feed and a suspicious markup ratio.

**Fix:** Soft warn (not block) in `/api/worker-scrape` if:
- `cost < $15` — likely a small item, not furniture/home
- `cost > $150` — slow-moving inventory, flag for review

Adjust thresholds once real sales data shows actual distribution.

---

### 4. Fuzzy duplicate detection — defer to phase 2, log near-matches now

**Priority: Low for MVP — add logging only.**

URL-based hard block catches exact duplicates. Doesn't catch: same physical product relisted by seller with a new `itemid` (common for Shopee furniture/storage sellers resetting review counts).

**MVP:** Log near-matches (similar title + price within ±10%) to a review log. Check weekly to gauge how big the problem is before building a guard.

**Phase 2:** If near-dupes are common, add soft warn: "Possible duplicate of listing #X — review before posting."

---

### 5. Override logging — add to worker_done before launch

**Priority: Cheap — fold into build step 5.**

When VA taps "Add anyway" on a soft-warned listing, `guard_warnings` records the warning fired but not whether VA overrode or skipped. Can't tell if guards are well-calibrated or just friction VAs ignore.

**Fix:** Add `warnings_overridden BOOL` to `worker_done`. Set `true` when VA proceeds past a soft warn. After one week reveals whether guards are catching real problems or generating false positives needing threshold adjustment.
