# Carousell Dropshipping — Operations Plan
> June 2026 · ~25 days remaining · $2,000 net profit target

---

## Assumptions & Inputs

| Input | Value | Source |
|---|---|---|
| Chats per day | ~20 | You |
| Sales per day | 1–2 | You |
| Chat → sale conversion | 10% | You (consistent: 20 × 10% = 2) |
| Avg profit per sale | ~$27 | **Assumed** (formula on ~$20 cost item at 1.5×) |
| Hours available per day | 3–4+ | You |
| Time per listing | Unknown | You (wants to automate) |
| Fixed listings | ~30 | You |
| Deleted listings | ~50 | You |
| Total queue | ~1,300 | You |
| Follow-up system in use | No | You |
| Hitting 50–100 listings/day | No | You |

---

# PART 1 — Business Plan

## Unit Economics Model

**Target:** $2,000 net profit / 25 days = **$80/day**

**Current funnel:**

| Metric | Current | Required | Gap |
|---|---|---|---|
| Chats/day | ~20 | ~30 | +10 |
| Conversion rate | 10% | 10–15% | — |
| Sales/day | ~2 | **~3.0** | +1 |
| Avg profit/sale | ~$27 (assumed) | $27 | — |
| Daily profit | ~$54 | $81 | **+$27/day** |

You need to go from ~2 to ~3 sales/day. That is a **50% increase** — not a moonshot. The question is which lever moves it fastest.

**Stress-test scenario (achievable):**

- Days 1–5: follow-up system live, no other changes → some unconfirmed chats convert → +0.5 sales/day → $67/day
- Days 6–15: demand-pull sourcing adds 20 targeted new listings → chats rise to ~25 → +0.5 sales/day → $81/day
- Days 16–25: compounding (follow-ups on more chat volume, repeat buyers) → $85–90/day

Cumulative: (5 × $67) + (10 × $81) + (10 × $88) = $335 + $810 + $880 = **$2,025**

This hits the target, but only if you act on follow-ups in week 1 and sourcing in week 2. Doing only listings volume (supply-push) without fixing conversion probably leaves you at ~$1,350.

---

## Supply-Push vs Demand-Pull

The plan says "constraint is listings volume, not demand." The data does not clearly support this.

**The supply-push math:**
You have ~30 fixed listings generating 20+ chats. If listings were the binding constraint, fixing the remaining 1,270 would give you 20 × (1,270/30) = 847 chats/day → 85 sales/day. Obviously not what happens — Carousell search has category saturation, algorithm weighting, and diminishing returns. More listings help but not linearly.

**The actual constraint is more likely a mix of:**
1. Listing quality and discoverability (titles/categories that actually surface in search)
2. Chat volume from those listings
3. Conversion rate at the chat stage

You are converting 10% of chats. The norm for cold marketplace chat is 15–25% for motivated buyers. There is meaningful money being left at the conversion stage, not just the volume stage.

**Demand-pull case for 25 days:**
Instead of fixing random listings from 1,300, identify 10–20 specific items that are provably moving on Carousell (sold badges, active listings with few units left, high-competition search terms) and source those on Shopee. Every hour spent creating a targeted listing is worth more than an hour fixing a random one.

**Recommendation: Hybrid, weighted 60/40 toward demand-pull.**

- **Demand-pull (60%):** Use Carousell search to find proven categories and price points → source those items → create new listings. Furniture and home is the right instinct — cross-reference it with what actually shows sold signals.
- **Supply-push (40%):** Do not abandon the existing queue entirely. Cull anything below the $15 floor, fix listings in proven categories only. Stop touching listings in dead categories.

The 50–100 listings/day target is wrong for 25 days. **10–20 demand-led listings/day beats 50 random ones.** Quality of listing creation time matters more than volume when your runway is short.

---

## Re-ranking Known Gaps

The plan calls follow-ups "not blocking." This is wrong given the math.

| Priority | Gap | Impact on $2k goal | Act now or later |
|---|---|---|---|
| 1 | **No follow-up system** | Potentially +0.5–1 sale/day at zero cost. If it drives 25–33% of profit that is $500–660 of your $2k target. | **Act now. Today. No app needed.** |
| 2 | **No demand research tool** | Determines whether your listing time converts to chats. Wrong category = wasted hours. | **Act now — manually first, then build.** |
| 3 | **Shopee scraper reliability** | Blocks listing creation workflow entirely when it fails. | Act now (app rebuild). |
| 4 | **No upsells** | Single-item dropship limits revenue per order. Real but secondary to getting the sale. | Later (week 3+). |
| 5 | **No dynamic pricing on slow movers** | Recovers some dead listings but takes time to evaluate. | Later. |
| 6 | **Inconsistent shipping updates** | Trust issue, not a revenue issue at current scale. | Later. |

**Immediate action that requires no app:** Message every chat from the last 3 days that did not convert. Template: "Hi, is [item] still of interest? Happy to answer any questions." Track manually in a notes app for now. Build the app feature after.

---

## Cash Flow & Float

Good news: the model is structurally sound on float. Customer pays PayNow → you order on Shopee → Shopee delivers. You never carry inventory and are never out of pocket unless:

- Shopee item goes out of stock after payment (you need to refund or find alternative)
- Shopee price rises between when you listed and when you order (margin compression or loss)
- Customer disputes after delivery (rare with PayNow — it is a push payment, hard to reverse, but possible via Carousell buyer protection)

**Operating rules to add:**
1. Always press Shopee checkout at point of sale (not just at listing time) to confirm current price before confirming to the buyer.
2. Keep a $200 float to cover refunds or source substitutions without delay.
3. If a Shopee item goes OOS after payment: source a near-identical item and ship it, or refund immediately. Never ghost.

---

## Operational & Platform Risk

You run one Carousell account and one Shopee account. This is existential risk.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Carousell account suspension | Medium (ToS grey area for dropshipping) | Total revenue loss | Do not automate listings, keep all comms on-platform, do not use third-party tools that touch Carousell directly |
| Shopee voucher/coin removal changes price | High (common) | Margin wipeout on specific orders | Check checkout price at point of every sale, not at listing time |
| Shopee item goes OOS | Medium | Refund or scramble to re-source | Build OOS protocol into chat script |
| Carousell buyer dispute | Low-medium | Chargeback-equivalent via Carousell protection | Keep all comms on platform, ship to confirmed address only |
| Carousell algorithm change | Medium | Listing visibility drops | Do not depend on a single traffic source indefinitely |
| Personal bandwidth (NS) | High | Missed chats, no follow-ups | Automate only what reduces friction, not what creates ToS exposure |

**Single-account risk is the top platform risk.** Every decision about automation must be evaluated against: "does this increase my suspension probability?" If yes, do not do it regardless of convenience.

---

## Daily Measurement Loop

Currently tracking: listings done/deleted. Not tracking what actually moves the revenue needle.

**Morning (5 min):**
- Check chats from overnight, reply to all
- Note which listings generated chats (listing title / category)
- Log any overnight sales

**During day:**
- List/fix using demand-pull (confirm Shopee price before creating listing)
- Fulfill any paid orders (place on Shopee with customer address)

**Evening (10 min):**
- Follow up on chats from 24–48 hours ago that did not convert
- Log today's sales: which listing, which category, sale price, source cost
- Note which category/price point the day's chats came from

**Weekly (15 min):**
- Which categories generated the most chats? Most sales? Highest profit?
- Which listings in the done list have 0 chats ever? Consider culling or repricing.
- Are you on pace for $80/day average?

---

## Build Backlog (Prioritized by $2k Impact)

| Priority | Capability | Justification |
|---|---|---|
| 1 | **Customer / follow-up tracker** | Recovers 25–33% of missed profit. A simple tab logging chat name, item, date, follow-up status. Zero integration needed to start. |
| 2 | **Carousell demand research tool** | Feeds the demand-pull model. Without this you are sourcing blind. A structured logging screen where you record what you observe selling. |
| 3 | **Shopee scraper (reliable rebuild)** | Core workflow blocker when it fails. Everything downstream (title gen, price calc) depends on a working fetch. |
| 4 | **Carousell listing clipboard assistant** | Reduce friction in the copy-paste workflow. Not automation — sequences your clipboard so switching to Carousell is fast. |
| 5 | **Sales → listing analytics** | Links which categories/price points generated sales. Feeds the daily measurement loop and sourcing decisions. |
| 6 | **Shopee product discovery** | Browse trending/category items for new sourcing leads. Useful but downstream of knowing what Carousell actually wants. |
| 7 | **Upsell prompt system** | Post-purchase message template. Low friction to add to the customer tracker as a second message type. |

---

# PART 2 — App Build Spec

## Current App State (Confirmed from reading actual code)

The app is at `pages/work.html` in the Workers repo, deployed on Vercel + local.

**What is actually working:**
- FIX tab: works through `LISTINGS` array from `data/listings-data.js` (static file baked into repo)
- NEW tab: create listing from Shopee URL → AI generates title + description → save to DONE
- SALES tab: log sales, search done listings, revenue display
- DONE tab: browse, edit, delete processed listings
- Supabase: syncs `work_progress`, `done_data`, `sales` on every action
- Claude AI: routes through `/api/claude` server-side (key never in browser), falls back to direct browser call if key not configured
- Keyboard shortcuts on desktop: D = Done, X/Delete = Delete
- Swipe gestures on mobile: right = Done, left = Delete

**What is broken / unreliable:**
- `/api/shopee` fails intermittently (see scraper section below)
- `data/listings-data.js` requires manual file edits + redeploy to change the queue

---

## Listing Queue — Retire the Static File

**Problem:** FIX tab reads from `data/listings-data.js` — a hardcoded JS array. Adding or removing listings requires editing the file and redeploying.

**Fix:** Drop the static file dependency. Let the FIX queue show `doneData` entries that have no Carousell URL yet — listings created in the NEW tab but not yet posted on Carousell. The queue becomes dynamic automatically, no file to maintain, no Supabase schema change.

This means the workflow becomes:
1. NEW tab: paste Shopee URL → generate → save to DONE (now in the queue)
2. FIX tab: shows items from DONE with no Carousell URL → add URL → mark done

The `listings-data.js` file gets retired. Any remaining entries in it that you want to keep can be migrated into `doneData` via a one-time script.

---

## Supabase Sync — Recommendation

**Current behaviour:** Merge on load (take max counts, merge done lists by index). Complex but not broken.

**Options:**

| Option | What it means | Recommended? |
|---|---|---|
| Keep current | Leave the merge logic as-is | Yes — it works for solo use |
| Last-write-wins | Whoever pushed last wins per key. Simpler, small risk of losing minutes of work if both devices active simultaneously | Acceptable alternative |
| Sales-only sync | Queue progress stays local, only sales log syncs | Too simple — DONE tab won't be consistent across devices |

**Recommendation: keep the current sync.** It works. The conflicts I raised earlier are theoretical edge cases for solo use. Do not spend time here.

---

## Revised Tab Structure

| Tab | Purpose | Status |
|---|---|---|
| FIX | Work through listings with no Carousell URL yet | Keep, refactor queue source |
| NEW | Create new listing from Shopee URL | Keep as-is |
| SALES | Log sales | Keep as-is |
| DONE | Browse all processed listings | Keep as-is |
| **FOLLOW** | Customer / follow-up tracker | **New — Priority 1** |
| **RESEARCH** | Carousell demand logging | **New — Priority 2** |

---

## Capability Specs

### 1. Shopee Scraper Upgrade

**Why it fails intermittently:**
The current `/api/shopee` fetches the Shopee page HTML and extracts `og:` meta tags, with a JSON-LD fallback. It runs as a Vercel Edge Function from Singapore (`sin1`). This is a reasonable approach — those tags are server-rendered by Shopee for SEO.

The failure mode: Shopee sometimes serves a Cloudflare bot-challenge page instead of actual HTML. When that happens, og: tags are absent, JSON-LD is absent, and the scraper returns nothing. It is not a code bug — it is Cloudflare detecting the Edge Function's IP and blocking it. Adding more headers or retrying does not fix this.

**What actually improves it:**
Shopee's internal API (`shopee.sg/api/v4/item/get?itemid=ITEM_ID&shopid=SHOP_ID`) returns structured JSON directly — no HTML parsing required. Item ID and shop ID are in every Shopee URL path as `i.SHOPID.ITEMID`. This bypasses HTML scraping entirely and is less likely to hit bot-challenges because it mimics the actual app's API calls.

**Upgrade plan for `/api/shopee`:**
1. Parse `SHOP_ID` and `ITEM_ID` from the URL (regex on `.SHOPID.ITEMID` suffix)
2. Call `https://shopee.sg/api/v4/item/get?itemid=ITEM_ID&shopid=SHOP_ID` with appropriate headers (`User-Agent`, `Referer: https://shopee.sg`)
3. Return structured data: title, description, images array, price
4. Keep current og: tag approach as fallback if internal API fails

**Feasibility:** Medium. More reliable than current but still fragile — Shopee can change or auth-gate this endpoint. Expect to maintain it every 1–2 months.

**Suspension risk:** Low. You are reading public product data as any customer would.

**Desktop vs mobile:** No difference — same Vercel API endpoint.

---

### 2. Shopee Product Discovery

**Feasibility:** Medium-hard, fragile. Defer this entirely.

The discovery workflow is: you know the category (furniture/home) → you search Shopee manually → you paste the URL into the existing scraper. A "Discovery" feature that browses Shopee categories inside the app is a week of build time for marginal workflow improvement.

The bottleneck is knowing *what Carousell wants*, not finding things on Shopee. Build Carousell demand research first (below) — it tells you what to search for on Shopee. Then manual Shopee search is good enough for 25 days.

**Decision: defer.**

---

### 3. Carousell Demand Research — RESEARCH Tab

**This is the most strategically important new tool and the one the app has no home for today.**

**What "demand signal" means in practice:**
- Items that show "Sold" on Carousell listings
- Categories with many active listings at similar price points (competition = demand)
- Price bands where listings cluster (tells you what buyers will pay)
- Search terms that autocomplete on Carousell (reflects real search volume)

**Do not scrape Carousell.** It is your operating platform. Getting flagged as a bot and having your account investigated is not worth the convenience.

**What to build instead — a structured research logging tab:**

You browse Carousell manually on your phone/browser. You log observations in the app. The app surfaces patterns over time.

**RESEARCH tab UI:**
- Add observation: Category, Keyword, Price min/max, Sold signals seen (count), Notes
- List of past observations, searchable
- "Source this" button: marks observation as actioned, links to NEW tab

**Data model (localStorage + Supabase):**
```js
carobiz_research: [{
  id,
  date,
  category,
  keyword,
  price_min,
  price_max,
  sold_signals,  // number of sold listings observed
  notes,
  sourced        // bool — have you sourced something from this research?
}]
```

**Feasibility:** Easy. Pure CRUD, no API needed.

**Suspension risk:** None. You are browsing Carousell manually.

**Build time:** ~2 hours.

---

### 4. Carousell Listing Automation

**The hard truth:** Carousell has no public listing API. Any solution that submits the form programmatically touches undocumented internals and is against ToS. You have one account. Do not do it.

**Real options ranked by suspension risk:**

| Approach | What it does | Suspension risk | Verdict |
|---|---|---|---|
| Browser automation (Playwright/Puppeteer) | Fills and submits Carousell listing form automatically | **High.** Bot detection. Account ban. | Do not do it. |
| Clipboard sequencer (desktop + mobile) | App sequences your clipboard — you still click everything in Carousell | **None.** You do all the clicking. | Build this. |
| Mobile share-sheet | Share image/link to Carousell | None, but does not work for listing creation | Does not work. |

**Build: Clipboard sequencer.**

Add three buttons to FIX and NEW tabs after content is generated:

```
[ Copy Title ]   [ Copy Description ]   [ Copy Price ]
```

Each button copies its field and shows a ✓ checkmark. You alt-tab (desktop) or switch app (mobile) to Carousell, paste, return, press next. A checklist tracks which fields you have pasted so you do not lose your place.

Optional desktop enhancement: keyboard shortcuts `1`, `2`, `3` to cycle through copy fields without reaching for the mouse.

**Feasibility:** Easy. 2–3 hours. No new APIs.

**Suspension risk:** None.

---

### 5. Customer / Follow-Up Tracker — FOLLOW Tab

**This is Priority 1 in the backlog and the fastest path to more revenue. Do the manual version today; build the app version this week.**

**Manual version (no app needed):** Message every chat from the last 3 days that did not convert. Use Notes app to track name + item + date. Do this now.

**App version — FOLLOW tab:**

**Add a contact:**
- Carousell username
- Item they inquired about (search your DONE listings — same search as SALES tab)
- Date of first chat
- Status: Interested / No Response / Paid / Dead

**Follow-up queue:**
- Shows contacts where status = Interested or No Response, last contact 1+ days ago
- "Copy follow-up message" button — template: "Hi [name], checking in on the [item] — still available if you're keen!"
- Mark followed up → sets next follow-up date (+1 day, then +2 days)
- Mark as Paid → triggers upsell prompt

**Upsell prompt:**
- Pops up when you mark a contact as Paid
- Pre-written message to copy: "Thanks for your order! We also have [related category] items — happy to share if you're interested."
- You paste it into Carousell chat manually

**Data model:**
```js
carobiz_customers: [{
  id,
  name,
  item_id,
  item_title,
  first_contact_date,
  status,               // 'interested' | 'no_response' | 'paid' | 'dead'
  last_followup_date,
  followup_count,
  notes,
  sale_id               // links to salesLog entry if converted
}]
```

Synced to Supabase. Works on phone (morning chat review) and laptop (evening follow-up session).

**Feasibility:** Easy. CRUD + date logic.

**Build time:** ~3 hours.

---

### 6. Sales → Listing Analytics

**Current gap:** SALES tab logs sales. DONE tab has listings. They are not joined in any way.

**What to add:**
- `category` field on listings (dropdown: Furniture / Home / Electronics / Other) — added in NEW and FIX tabs
- `category` carried into sales log when a sale is logged (pulled from linked listing)
- Weekly summary row in SALES tab: sales by category, avg profit by category

**Data model change:**
- Add `category` to `doneData` entries
- Add `category` to `salesLog` entries

**Feasibility:** Easy. Additive to existing data model.

**Build time:** ~1.5 hours.

---

## Build Order

**Week 1 (Days 1–7): Fix the foundation**
1. Retire `listings-data.js` — make FIX queue dynamic (items with no Carousell URL)
2. Upgrade `/api/shopee` to Shopee internal API with og: fallback
3. Clipboard sequencer in FIX and NEW tabs

**Week 2 (Days 8–14): Revenue levers**
4. FOLLOW tab (customer tracker + follow-up queue + upsell prompt)
5. RESEARCH tab (Carousell demand logging)
6. Category tagging on listings + sales

**Week 3+ (Days 15–25): Analytics and polish**
7. Sales → category analytics view
8. Shopee discovery browsing (if time allows — low priority)

---

## Known Conflicts with Current Structure

| Conflict | Detail | Resolution |
|---|---|---|
| `data/listings-data.js` static queue | Requires manual file edits + redeploy to manage. Creates the "don't want to sort manually" friction. | Retire the file. Make FIX queue dynamic from doneData (no Carousell URL = unfixed). |
| Supabase sync merge logic | Complex merge on load. Fine for solo use, theoretical edge cases only. | Leave it. Not worth touching. |
| Vercel function timeout | Free tier: 10s timeout. Puppeteer/headless browser won't fit. | Shopee internal API approach is fast enough (simple JSON fetch). |
| `nav.js` absolute path | Loaded from `/shared/nav.js` — correct for Vercel deployment, will break if served from a subfolder. | Leave unless you change deployment structure. |

---

## Pricing Formula (Reference)

```js
function calcSell(cost) {
  return Math.ceil(Math.max(cost * 1.5, cost + 24) / 5) * 5 - 0.1;
}
```

| Cost | Sell |
|---|---|
| $15 | $39.90 |
| $20 | $44.90 |
| $30 | $54.90 |
| $50 | $79.90 |

Always press Shopee checkout at point of sale — not at listing time — to confirm current price.
