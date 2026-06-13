# Steadymart — Plan to $2k (June 2026)

The execution plan for hitting **$2,000 net profit in June 2026**. Business model, pricing, and the operating playbook live in [BUSINESS.md](BUSINESS.md); this doc is the time-bound "how we get there."

> Strategy is decided here. **Implementation happens in Claude Code (plan mode) against the real `work.html` / `/api/shopee` / Supabase — not against this doc.** Treat the live code as the source of truth.

---

## 0. Reality check (read first)

1. **work.html is built and largely working** — the day-to-day is fixing/extending the loop and adding the revenue levers below, not building from scratch.
2. **Your sales history is trapped in Carousell with no clean export.** This is the real constraint: you can't tune the funnel without data, but scraping your own logged-in seller session is the **highest-suspension-risk action available**, and a suspended account is a total loss. So the plan routes around it — **capture data going forward via the app; do not scrape it out retroactively** (§1a).

---

## 1. The target, as a funnel

> Working figures — **assumptions, not measurements.** Overwrite each the moment real data exists.

- Net profit/sale: **$25** · Chat→sale: **15%** · Days: **~24** · Hours/day: **~5**

**Backwards from $2,000:** $2,000 ÷ $25 = **80 sales** ÷ 24 days = **~3.3 sales/day** ÷ 15% = **~22 qualified chats/day**.

**Operating principle:** 3 sales/day is small. The win condition is **conversion + demand quality, not raw listing count.** Fewer, better-targeted listings beat volume. The old 50–100 listings/day target is **retired** in favour of **20–30 demand-validated listings/day** (comfortable in a 5-hr day).

**Honest note:** at ~5 hrs/day the workload is realistic; the remaining risk is *conversion*, not time. The three numbers above are guesses — the first job of the data loop is to confirm whether 15% / $25 hold. If real conversion is 8%, the math demands ~44 chats/day — the signal to change the **sourcing band**, not just grind more volume. Validate within ~10 days, then adjust.

### 1a. The data problem — how to actually get numbers
- **Capture forward, not backward.** Every sale from today is logged in work.html at the moment it happens. Within ~7–10 days you have real `category / sourceCost / sellPrice / titleStyle / chat→sale` data.
- **One-time manual backfill (optional).** Hand-enter your last ~20–30 sales into the attribution table — tedious but zero risk, and 30 rows is enough to spot which categories convert.
- **Carousell demand research is separate and OK** — read-only scraping of *public* search pages, run **off-account, never from the seller session** (§3). Reconnaissance on the market, not extraction of your own account.

---

## 2. Sourcing strategy — demand-pull (with rationale)

Source from **proven Carousell demand**, not from cheap Shopee items.

1. **Confirm the band:** read-only research on what's selling — categories, price bands, sold signals. Don't assume furniture/home is best; verify.
2. **Source only inside proven bands.**

**Why demand-pull (the analysis that retired the volume plan):**
- ~30 fixed listings already generate ~20 chats/day. If listings were the binding constraint, fixing the other ~1,270 would imply ~847 chats/day — obviously false. Carousell search has category saturation and diminishing returns; more listings help, but **not linearly.**
- You convert ~10% of chats; the norm for motivated marketplace buyers is **15–25%.** There's meaningful money at the **conversion** stage, not just the volume stage.
- Therefore: an hour spent creating a *demand-validated* listing is worth more than an hour fixing a random one. **Hybrid, ~60/40 toward demand-pull:** 60% source proven categories; 40% cull below the $15 floor + fix listings in proven categories only (stop touching dead categories).

**Stress-test to $2,025 (achievable):**
- Days 1–5: follow-up system live → some unconfirmed chats convert → ~$67/day
- Days 6–15: demand-pull adds ~20 targeted listings → chats ~25 → ~$81/day
- Days 16–25: compounding (follow-ups on more volume, repeat buyers) → ~$85–90/day
- Cumulative: (5×$67) + (10×$81) + (10×$88) = **~$2,025.** Hits target — but only if follow-ups land in week 1 and sourcing in week 2. Volume-only (no conversion fix) likely stalls near ~$1,350.

---

## 3. Build backlog (ranked by impact on $2k)

0. **Fix what's broken first.** A buggy attribution feature logs garbage, which is worse than no data. Stabilise the post→chat→sale→fulfil loop before adding features.
1. **Sales attribution** — tag every sale by `category`, `sourceCost`, `sellPrice`, `titleStyle` + a "what's selling" view. *Highest leverage, cheapest. Also the data-capture mechanism (§1a). Build first.*
2. **Follow-up / light CRM (FOLLOW tab)** — log non-payers; surface "follow up these 3" at +1/+2/+3 days; "copy follow-up message" template; mark Paid → upsell prompt. Sent manually. *Recovers the ~25–33% of profit follow-ups are estimated to drive — the fastest path to more revenue.*
3. **Carousell demand research (RESEARCH tab)** — log observations (category, keyword, price band, sold-signal count, notes) from manual browsing; surface patterns. **Read-only, off-account, never the seller session.** Fallback: eyeball 5–10 search pages by hand.
4. **Shopee scraper** — hit Shopee's internal product JSON (`/api/v4/item/get?itemid=…&shopid=…`), not rendered HTML; retry + cache by item ID. Fallback: paste the checkout price by hand at order time (you do this anyway — §2). *Largely shipped: live scraper reads `window.dataLayer` first, then the v4 API; results land on the Supabase `scrape_inbox` belt (see [SCRAPERS.md](SCRAPERS.md)).*
5. **Shopee discovery** — `/api/shopee-search` (keyword/category + price ceiling) → auto-filter through `calcSell()`. *After #3.* Fallback: manual Shopee browsing.
6. **Listing assist (not automation)** — copy title/description to clipboard, open the sell page (you click Post) on laptop; share-sheet/deep-link to the Carousell app (you tap Post) on phone.
7. **Upsell prompts** — after a sale, suggest complementary done-listings.

> **Best-effort note (#3–#5):** these depend on Shopee/Carousell anti-bot defences that change unpredictably. "Working today" ≠ "working unattended next week." Each has a manual fallback so a broken scraper never blocks a sale or lets a stale price wipe margin. **Treat scraped prices as convenience, not truth** — the §2 rule "re-check checkout price at order time, every time" always holds.

> **Never:** automate Carousell posting (no public API → highest suspension risk), or scrape your own logged-in seller session. Assist only.

---

## 4. Daily loop

Each evening: log which listings got chats and which converted → tag by category/price/title-style → next morning, source more of what converted, cull what didn't. This is the engine that compounds everything else.

**Tracked daily:** new listings, sales, revenue, chats logged, follow-ups due.

- **Morning (5 min):** clear overnight chats; note which listings drove them; log overnight sales.
- **During day:** list/fix demand-pull (confirm Shopee price before creating); fulfil paid orders.
- **Evening (10 min):** follow up on 24–48h-old non-converters; log today's sales with category + cost + price.
- **Weekly (15 min):** which categories drove the most chats/sales/profit? Which done-listings have 0 chats ever (cull/reprice)? On pace for ~$80/day?

---

## Win condition

- $2,000 net profit in June 2026 — target held; **assumptions validated by real data within ~10 days.**
- ~3.3 sales/day, sourced demand-first, ~5 hrs/day operating budget.
- Attribution + follow-up live in work.html; demand research feeding sourcing.
- **One account, intact.**
