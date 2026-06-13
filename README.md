# Steadymart

Dropshipping business on Carousell Singapore. Source products from Shopee SG, list them on Carousell at a markup, fulfil by ordering from Shopee when a buyer pays.

No inventory. No warehouse. Pure margin on the price gap.

---

## Business model

**Source:** Shopee SG (any seller, any category within scope)
**Sell:** Carousell SG listings
**Fulfil:** Order from Shopee, ship directly to buyer

**Pricing formula:** `max(cost × 1.5, cost + $24)` rounded up to the next $5
- Example: $20 cost → sell at $65. $50 cost → sell at $80.
- Minimum $24 gross margin on every item, no exceptions.

**Target categories:** Furniture, beds, mattresses, safes, home storage, appliances, tools. No fashion, jewellery, or random lifestyle items.

**Unit economics (targets, not yet validated by data):**
- ~$25 net profit per sale
- ~15% chat-to-sale conversion
- ~3–4 sales/day to hit meaningful revenue

---

## Current status — June 2026

**Revenue to date:** ~$30. Well behind the original $2k June target.

**What's working:** The app is built and functional. Scraping, AI title/description generation, and the FIX/NEW workflows are all live.

**What's blocking growth:** Listing volume. At current pace (owner doing everything alone), the throughput is too low. The fix is hiring VAs to take over sourcing and uploading — that system is being built now.

**Next milestone:** First VA live and completing 100 listings/day.

---

## The app — what it does

`work.html` is a mobile-first PWA hosted on Vercel. Data lives in Supabase. Owner logs in with email + password.

### FIX tab
The main daily queue. Shows one listing at a time — all active listings that need to be uploaded to Carousell. Owner generates an AI title and description for each, then uploads to Carousell using the fill userscript (laptop only). Keyboard shortcuts for speed. Swipe to done/delete on mobile.

### NEW tab
Creates new listings from Shopee scrapes. Scrape a product → it appears here with AI-generated title, description, and calculated sell price. One listing fills the form directly; multiple scrapes create a batch of cards. Save pushes to the FIX queue.

### SALES tab
Log a sale by searching the listing title — source cost and sell price auto-fill. Tracks daily revenue and category breakdown.

### LISTINGS tab
Full searchable catalog of all listings (active + done). Edit title, cost, links inline. Scan for bad Shopee/Carousell links. Download a full JSON backup.

### Shopee scraper
- **Laptop bookmarklet** — click on any Shopee product page → sends to the NEW tab
- **AUTO mode** — opens multiple product tabs, each self-scrapes in the background
- **iOS shortcut** — share from Shopee app → sends to NEW tab
- Reads `window.dataLayer` first (puzzle-free), falls back to Shopee v4 API

### Carousell autofill (laptop only, owner only)
`carousell-fill.user.js` — Tampermonkey userscript. Press F on a FIX card → Carousell listing opens → Ctrl+Enter fills title/description/price → Ctrl+Enter saves. Currently shelved for fixes.

---

## What's being built — VA system

Full spec: [VA-PLAN.md](VA-PLAN.md)

VAs source products on Shopee and upload them to Carousell independently. Owner manages and monitors from a new WORKERS tab.

**VA workflow:**
1. VA opens their personal link (`/va?w=UUID`) — no login needed
2. They browse Shopee with their own account, click their personalised bookmarklet on any product
3. The product appears on their page (~10s) with AI title, description, and sell price already generated
4. VA opens Carousell, copy-pastes title + description, enters price, uploads images, posts
5. Tap Done — counter increments, next listing loads
6. Target: 100 listings/day per VA

**Guards:** Wrong category = soft warn. Non-SG seller = soft warn. Under 4 stars = soft warn. Duplicate URL = hard block.

**Owner side:** WORKERS tab shows each VA's count vs target today, warning flags, and controls to create VAs / assign listing batches.

**Starting with:** 2–3 VAs. Scaling up once the system is proven.

**Build order:** DB migrations → scrape pipeline → API endpoints → va.html → WORKERS tab. See VA-PLAN.md for full detail.

---

## Tech stack

| Piece | What |
|---|---|
| Frontend | Single-file `work.html` — vanilla JS, no framework |
| Hosting | Vercel (auto-deploy from `main`) |
| Database | Supabase (Postgres + RLS) |
| AI | Claude API (Sonnet) — title + description generation |
| Scraper | `sc.js` hosted on Vercel, loaded by bookmarklet |
| Userscripts | Tampermonkey (laptop) / Userscripts app (iOS Safari) |

---

## Reference docs

| Doc | What it covers |
|---|---|
| [VA-PLAN.md](VA-PLAN.md) | Full VA system spec — auth, DB schema, API endpoints, build order |
| [SCRAPERS.md](SCRAPERS.md) | How to install and use all scrapers (bookmarklets, iOS shortcut, AUTO mode) |
| [TEST-PLAN.md](TEST-PLAN.md) | Regression test checklist — run after major changes |
