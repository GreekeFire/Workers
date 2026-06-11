# Steadymart — Master Plan (June 2026)

Carousell → Shopee dropshipping, Singapore. Source on Shopee SG, list on Carousell at a markup, collect via PayNow, fulfil by ordering Shopee → customer address. No inventory, no handling. Solo, ~5 hrs/day during NS.

**Goal:** $2,000 net profit in June 2026.
**Window as of 6 June:** ~24 days left.

> This doc merges the strategy layer (the "why/what") with the build/execution layer (the "how"). Strategy decisions are made here; implementation happens in Claude Code, plan mode, against the real `work.html` / `/api/shopee` / Supabase — not against this doc.

---

## 0. Reality check (read first)

Two facts shape everything below:

1. **work.html is built but buggy/partial.** Today is *fix the core loop, then add attribution + CRM* — not build-from-scratch.
2. **Your sales data is trapped in Carousell with no clean export.** This is the real constraint. You cannot tune the funnel (§1) without it, but scraping your own logged-in seller session is the **highest-suspension-risk action available** — and a suspended account is a total loss (§9). So the plan routes around it: **capture data going forward via the app, do not scrape it out retroactively.** More in §1a.

---

## 1. The target, as a funnel

> Working figures — **assumptions, not measurements.** Overwrite each one the moment real data exists.

- Net profit/sale: **$25 (assumed)** · Chat→sale: **15% (assumed)** · Days: **~24** · Hours/day: **~5**

**Backwards from $2,000:**
- $2,000 ÷ $25 = **80 sales**
- ÷ 24 days = **~3.3 sales/day**
- ÷ 15% = **~22 qualified chats/day**

**Operating principle:** 3 sales/day is small. The win condition is **conversion + demand quality, not raw listing count.** Fewer, better-targeted listings beat volume. The old 50–100 listings/day target is retired in favour of **20–30 demand-validated listings/day.**

**Honest note on $2k:** with ~5 hrs/day the workload is now realistic — 22 chats/day and 20–30 listings/day fit comfortably in that budget, and the target stops being heroic. The remaining risk is *conversion*, not time: the three numbers above are still guesses. The first job of the data loop is to confirm whether 15% / $25 hold. If real conversion is 8%, the math demands ~44 chats/day — still hard even at 5 hrs, and the signal to change the sourcing band rather than just grind more volume. Validate within ~10 days, then adjust.

### 1a. The data problem — how to actually get numbers

Don't scrape Carousell. Instead:

- **Capture forward, not backward.** Every sale from today gets logged in work.html at the moment it happens (§7 #1). Within ~7–10 days you have real `category / sourceCost / sellPrice / titleStyle / chat→sale` data — enough to start tuning.
- **One-time manual backfill (optional).** If you want historical baseline, hand-enter your last ~20–30 sales into the attribution table over one sitting. Tedious but zero risk, and 30 rows is enough to spot which categories convert.
- **Carousell demand research is separate and OK** — read-only scraping of *public* search pages (price + sold signals) to drive sourcing, run **off-account, never from the logged-in seller session** (§7 #3). This is reconnaissance on the market, not extraction of your own account.

---

## 2. Sourcing model — demand-pull

Source from proven Carousell demand, not from cheap Shopee items.

1. **Confirm the band:** read-only research on what's selling — categories, price bands, sold signals. Don't assume furniture/home is best; verify.
2. **Source only inside proven bands.**

**Listing target:** 20–30 demand-validated listings/day (comfortable in a 5-hr day).

### Sourcing rules
- **Shopee SG only.**
- **Minimum source cost: $15.** Below this rarely clears the margin floor.
- **Blacklist:** anything that can't clear the margin floor; cheap sub-$10 accessories.
- **Re-check Shopee checkout price at order time, every time** (remove vouchers/coins). Strikethrough prices lie; vouchers shift and wipe margin.

---

## 3. Pricing

**Margin rule — whichever is higher:** flat minimum **$24 profit/sale**, or **1.5× Shopee checkout price.**

```js
function calcSell(cost) {
  return Math.ceil(Math.max(cost * 1.5, cost + 24) / 5) * 5 - 0.1;
}
```
Always resolves to `$X.90`.

| Cost | Sell |
|---|---|
| $15 | $39.90 |
| $20 | $44.90 |
| $30 | $54.90 |
| $50 | $79.90 |

**Sweet spot:** high-perceived-value items under $20 that list for $40–50+.

**Formula notes:**
- On high-cost items ($80+), formula may price you above competitors. Check manually and override if needed to stay within $10-15 of the market price.
- On low-cost items ($15-20), formula is conservative — check if competitors are pricing significantly higher. If demand is strong, push to their level.
- `.90` endings stay. Psychological anchor — buyers file $44.90 as "forty-something", not $45.

### Psychological pricing tricks
- **Anchor high** — mention "worth $X" or "retails at $X" in description to make your price feel like a deal
- **Odd specificity** — $47.90 feels more calculated than $45.90, implies precision
- **Stay below round thresholds** — $79.90 files as "seventy-something" in buyer's head
- **Scarcity** — "last 2 available" or "limited stock" creates urgency
- **Social proof** — "popular pick" or "bestseller on Shopee" signals validation
- **Problem-solution framing** — lead with the pain, not the product ("Tired of tangled cables?" beats "Wireless keyboard")

---

## 4. Listings

- **Format:** keyword-stuffed, pipe-separated `[Feature] + [Item Name] | …`, 200–225 chars.
- **Cover image:** clean, minimal branding, no watermarks.
- **Vary listings** — mass near-identical posts read as "duplicate listings," a suspension trigger (§9).
- **Posting:** manual, with app assist (§7). Never automated.

---

## 5. Fulfilment

1. Customer chats on Carousell.
2. Customer pays via **PayNow**.
3. **Re-check Shopee price**, then order to the customer's address.
4. Thank-you + delivery expectation (2–3 working days).
5. Notify on dispatch.

---

## 6. Customer communication

- **Tone:** direct, not desperate. Answer, then move to PayNow.
- **Follow-ups (in scope):** chat → +1 / +2 / +3 days for non-payers. Estimated to recover ~25–33% of profit (~$500–660 of the goal). Tracked in-app, sent manually.
- **Upsells:** after a sale, offer 1–2 complementary items.
- **Traffic:** 100% organic Carousell search.

### Chat psychology
- **Assume the sale** — "What's your address for delivery?" skips the hesitation step vs "Are you interested?"
- **Anchor before discounting** — if they ask for a discount, pause before responding. Immediate acceptance signals you had room all along
- **Bundle offer** — after initial interest, "I also have X, both for $Z" increases average order value
- **First message speed** — reply within minutes. Carousell buyers are browsing multiple sellers simultaneously; first to respond often wins

---

## 7. The app (work.html)

Single operational tool — mobile-first PWA, FIX/NEW/SALES/DONE tabs, localStorage + Supabase, `/api/claude`, `/api/shopee`, `/api/image`.

### Build backlog (ranked by impact on $2k)

0. **Fix what's broken first.** It's "built but buggy/partial" — stabilise the core post→chat→sale→fulfil loop before adding features. A buggy attribution feature logs garbage data, which is worse than no data.
1. **Sales attribution** — tag every sale by `category`, `sourceCost`, `sellPrice`, `titleStyle` + a "what's selling" view. *Highest leverage, cheapest. This is also your data-capture mechanism (§1a).*
2. **Follow-up / light CRM** — CHATS tab; log non-payers; surface "follow up these 3" at +1/+2/+3 days. Sent manually.
3. **Carousell demand research** — read-only scrape of *public* search pages. **Off-account, never the seller session.** *Reliability: best-effort (see note).* Fallback: manually eyeball 5–10 search pages for sold signals.
4. **Shopee scraper fix** — hit Shopee's internal product JSON endpoint (not rendered HTML); retry + cache by item ID; or a managed scraper API. Don't build a proxy/headless stack. *Reliability: best-effort (see note).* Fallback: paste the Shopee checkout price in by hand at order time (you do this anyway — §2).
5. **Shopee discovery** — `/api/shopee-search` (keyword/category + price ceiling) → auto-filter through the margin formula. *After #3. Reliability: best-effort (see note).* Fallback: manual keyword browsing on Shopee.
6. **Listing assist (not automation)** — laptop: copy title, queue description, open sell page (you click Post). Phone: share-sheet/deep-link to Carousell app (you tap Post).
7. **Upsell prompts** — after a sale, suggest complementary done-listings.

> **Best-effort note (#3–#5):** these will be *built* in the sprint and working by end of day 2. But they depend on Shopee/Carousell anti-bot defences that change on their side, unpredictably — so "working today" does not mean "working unattended next week." Each has a manual fallback above so a broken scraper never blocks a sale or, worse, lets a stale price wipe margin. Treat scraped prices as a convenience, not a source of truth: the §2 rule "re-check checkout price at order time, every time" still holds even when the scraper says otherwise.

### What to avoid
- Shopee scraping is **fragile** (anti-bot) — improve endpoint + caching, don't fight an arms race.
- Carousell has **no public listing API** — full posting automation = highest-probability suspension. **Assist only.**
- **Never scrape your own logged-in Carousell seller session.**

---

## 8. Daily loop

Each evening: log which listings got chats and which converted → tag by category/price/title-style → next morning, source more of what converted, cull what didn't. This compounds everything else.

**Tracked daily:** new listings, sales, revenue, chats logged, follow-ups due.

---

## 9. Risk & money

- **Single account = single point of failure.** Suspension triggers: duplicate listings, repeated rule violations, automation, scraping the seller session. Vary listings; never automate posting; keep research off-account.
- **Float buffer ≥$150** for refunds and Shopee orders that fail after you've been paid.
- **Re-check price at order time** to protect margin.
- **Chargebacks / non-delivery:** you own the customer experience even when Shopee mis-delivers.

---

## 10. The 2-day build sprint — finish the app

**Definition of done:** every backlog item built and smoke-tested. #0–#2, #6, #7 are *committed* (fully in your control). #3–#5 are *built but best-effort* on reliability (§7 note) — code lands, longevity isn't guaranteed, manual fallbacks in place.

Work in **Claude Code, plan mode, in the repo** — against real `work.html` / `/api/shopee` / Supabase, not this doc. Let Claude Code confirm the live schema before any data-model change.

**Sequencing principle:** ship the in-control, revenue-critical items first so that even if the scraper work overruns, you end day 2 with a complete working business. Scrapers come last precisely because they're the items that can eat unbounded time.

### Day 1 — the core loop + data capture (all committed)

**Block A — Fix (backlog #0)**
1. List every bug in the post→chat→sale→fulfil loop; triage blockers vs cosmetics.
2. Fix blockers only. Confirm end-to-end: create listing → mark sold → record sale → trigger fulfilment, no breakage.

**Block B — Attribution (backlog #1)**
3. Add `category`, `sourceCost`, `sellPrice`, `titleStyle` to the sale record (schema + SALES form).
4. Build the "what's selling" view — table grouped by category with count + total profit.
5. Smoke-test: one fake sale end-to-end, all four tags land.

**Block C — CRM (backlog #2)**
6. CHATS tab: log a chat (date, item, status: awaiting-payment / paid / dead).
7. Surface "follow up these 3" at +1/+2/+3 days. Manual send.
8. Smoke-test the full loop again.

**End of Day 1:** a complete, usable business. You can operate Steadymart on this alone. Start logging real sales tonight (and optionally hand-backfill ~20–30 past sales, §1a).

### Day 2 — assists + scrapers

**Block D — Listing assist + upsell (backlog #6, #7, committed)**
9. Listing assist: copy title to clipboard, queue description, open sell page (laptop) / deep-link to Carousell app (phone). You always tap Post.
10. Upsell prompts: after a sale, suggest complementary done-listings.

**Block E — Scraper trio (backlog #3, #4, #5, best-effort)**
11. #4 first — Shopee internal JSON endpoint, retry + cache by item ID. Get one product's live price returning reliably, then move on. **Time-box it.**
12. #3 — public Carousell search read (off-account) for price + sold signals.
13. #5 — `/api/shopee-search` piping results through `calcSell()`.
14. Wire each fallback (§7 note) so a dead scraper degrades to manual, never blocks.

> **Time-box rule for Block E:** if any scraper item burns more than ~90 min fighting anti-bot, stop, switch on its manual fallback, and move on. The fallbacks are all things you already do by hand. Do not let the fragile 20% of the backlog consume day 2 — a working manual fallback beats a clever scraper that breaks Thursday.

**Realistic outcome:** Day 1 gives you the whole revenue engine. Day 2 adds convenience (assists) and the best-effort scrapers. If Block E overruns, you still shipped a complete app — the scrapers just stay manual until you revisit them.

### Win condition
- $2,000 net profit in June 2026 (target held; assumptions validated by real data within ~10 days)
- ~3.3 sales/day, sourced demand-first, ~5 hrs/day operating budget
- Full app shipped: core loop stable, attribution + CRM + assist + upsell live; scrapers built with manual fallbacks
- One account, intact.
