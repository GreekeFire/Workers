# Steadymart — Business Plan (June 2026)

Carousell → Shopee dropshipping, Singapore. Source on Shopee SG, list on Carousell at a markup, collect via PayNow, fulfil by ordering from Shopee to the customer's address. No inventory, no handling.

**Goal:** $2,000 net profit in June 2026 (~25 days). Solo, ~2 hrs/day during NS.

---

## 1. The target, as a funnel

> Working figures — replace with live numbers as they come in.

- Net profit/sale: **$25** · Chat→sale: **15%** · Days: **25** · Hours/day: **~2**

**Backwards from $2,000:**
- $2,000 ÷ $25 = **80 sales**
- ÷ 25 days = **~3.2 sales/day**
- ÷ 15% = **~21 qualified chats/day**

**The operating principle this sets:** 3 sales/day is small. The win condition is **conversion + demand quality, not raw listing count.** Plan accordingly — fewer, better-targeted listings beat volume.

---

## 2. Sourcing model — demand-pull

Source from proven Carousell demand, not from cheap Shopee items.

1. **Days 1–3:** research what's selling on Carousell — categories, price bands, sold signals. Confirm (don't assume) whether furniture/home is the best band.
2. **Day 4+:** source only inside proven bands.

**Listing target:** **20–30 demand-validated listings/day** (fits 2 hrs). The old 50–100/day target is retired.

### Sourcing rules
- **Shopee SG only.**
- **Minimum source cost: $15.** Below this rarely clears the margin floor.
- **Blacklist:** anything that can't clear the margin floor; cheap sub-$10 accessories.
- **Re-check the Shopee checkout price at order time, every time** (remove vouchers/coins). Strikethrough prices are not reliable; vouchers/prices shift and can wipe margin.

---

## 3. Pricing

**Margin rule — whichever is higher:**
- Flat minimum **$24 profit/sale**, or
- **1.5× the Shopee checkout price**

**Formula (in app):**
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

---

## 4. Listings

- **Format:** keyword-stuffed, pipe-separated `[Feature] + [Item Name] | …`, 200–225 chars.
- **Cover image:** clean, minimal branding, no watermarks.
- **Vary listings** so mass near-identical posts don't read as "duplicate listings" (a suspension trigger — see Risk).
- **Posting:** manual, with app assist (see §7). Never automated.

---

## 5. Fulfilment

1. Customer chats on Carousell.
2. Customer pays via **PayNow**.
3. **Re-check Shopee price**, then order to the **customer's address**.
4. Send thank-you + delivery expectation (2–3 working days).
5. Notify on dispatch.

---

## 6. Customer communication

- **Tone:** direct, not desperate. Answer, then move to PayNow.
- **Follow-ups (now in scope):** chat → +1 / +2 / +3 days for non-payers. Targeted at recovering the ~25–33% of profit this is estimated to drive (~$500–660 of the goal). Tracked in-app, sent manually.
- **Upsells:** after a sale, offer 1–2 complementary items.
- **Traffic:** 100% organic Carousell search.

---

## 7. The app (work.html)

Single operational tool — mobile-first PWA, FIX/NEW/SALES/DONE tabs, localStorage + Supabase, `/api/claude`, `/api/shopee`, `/api/image`.

### Build backlog (ranked by impact on $2k)

1. **Sales attribution** — tag every sale by `category`, `sourceCost`, `sellPrice`, `titleStyle` + a "what's selling" view. *Highest leverage, cheapest. Build first.*
2. **Follow-up / light CRM** — new CHATS tab; log non-payers; surface "follow up these 3" at +1/+2/+3 days. Messages sent manually.
3. **Carousell demand research** — read-only scrape of search pages (price + sold signals) to drive sourcing. *Run off-account, never from the logged-in seller session.*
4. **Shopee scraper fix** — hit Shopee's internal product JSON endpoint (not rendered HTML); retry + cache by item ID; or use a managed scraper API. Don't build a proxy/headless stack.
5. **Shopee discovery** — `/api/shopee-search` (keyword/category + price ceiling) → auto-filter through the margin formula. Build *after* #3.
6. **Listing assist (not automation)** — laptop: copy title to clipboard, queue description, open the sell page (you click Post). Phone: share-sheet/deep-link to the Carousell app (you tap Post).
7. **Upsell prompts** — after a sale, suggest complementary done-listings.

### What's hard / what to avoid
- Shopee scraping is **fragile** (anti-bot) — improve the endpoint + caching, don't fight an arms race.
- Carousell has **no public listing API**; full posting automation = highest-probability account suspension. **Assist only.**

---

## 8. Daily loop

Each evening: log which listings got chats and which converted → tag by category/price/title-style → next morning, source more of what converted, cull what didn't. This is the engine that compounds everything else.

**Tracked daily:** new listings, sales, revenue, chats logged, follow-ups due.

---

## 9. Risk & money

- **Single account = single point of failure.** Suspension triggers include duplicate listings and repeated rule violations. Vary listings; never automate posting; keep research off the seller session.
- **Float buffer ≥$150** for refunds and Shopee orders that fail after you've been paid.
- **Re-check price at order time** to protect margin against voucher/price shifts.
- **Chargebacks / non-delivery:** you own the customer experience even when Shopee mis-delivers.

---

## 10. Execution

- **Plan + build in Claude Code (plan mode), in the repo** — against the real `work.html` / `/api/shopee` / Supabase schema, not stale docs.
- **One-day reality:** the full backlog isn't a one-day job. Finishing **#1 (attribution)** and **#2 (CRM)** is a strong day — they're the two items that most move the $2k.

### Win condition
- $2,000 net profit in June 2026
- ~3 sales/day, sourced demand-first
- Attribution + follow-up live in work.html
- One account, intact.
