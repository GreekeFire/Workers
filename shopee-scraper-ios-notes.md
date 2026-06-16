# iOS Shopee Scraping — Notes

## Context
~600 listings in the FIX queue to process before onboarding VAs.
Hardware: 4GB RAM Chromebook (slow, struggles with many tabs) + iPhone.
Carousell autofill userscript only works on Chromebook.

## Target workflow (Option 2)
Split the work across devices:
1. **iPhone** — open Shopee product pages, scrape via userscript → `scrape_inbox`
2. **iPhone** — work.html FIX tab, swipe through cards, AI generates copy, review
3. **Chromebook** — Fill + Done only (2 tabs max: work.html + one Carousell listing)

Chromebook never opens a Shopee tab. AI generation is NOT wasted — it only runs
when you're actively on the FIX card, not upfront for all 600.

---

## Problem: Shopee links open the app, not Safari
Tapping "Shopee ↗" on the FIX card opens the Shopee app via iOS universal links.
Userscript only runs in Safari, so the scrape never fires.

## Why "Fetch ↓" doesn't replace the userscript
The Fetch button calls `/api/shopee` (server-side, no user session):
- v4 API path gets blocked by Cloudflare (no cookies)
- Falls back to og: meta tag scraping
- og: tags give title + description + images — **no prices**
- Without prices, cost field is blank → you'd manually enter cost for all 600

## Why "Open next 10" doesn't work on iPhone
Safari blocks `window.open()` in a loop. Only the first tab opens; the rest
are treated as popups and blocked.

---

## Solution to test tomorrow: 1-action Shortcut

Build a Shortcut that opens the Shopee link in Safari (bypassing universal links).
Shortcuts' "Open URLs" action forces the browser, not the app.

### Setup (once)
1. Shortcuts app → New Shortcut
2. Tap the Shortcut name → **Add to Share Sheet** → set input type to **URLs**
3. Add one action: **Open URLs** (pass Shortcut Input)
4. Name it "Scrape to Work" or similar

### Per-listing flow (3 taps)
1. View product in Shopee app → **Share** → tap **Scrape to Work**
2. Safari opens the product page (short `sg.shp.ee` link redirects automatically)
3. Userscript injects the button → tap it → scrape sent to `scrape_inbox`
4. Switch to work.html → auto-pulls → AI generates

### Why the short link is fine
`api/shopee.js` already resolves `sg.shp.ee` → full `shopee.sg` URL before
any fetch, so the userscript fires correctly on the redirected product page.

---

## Full Shortcut approach (more setup, not needed if above works)
`api/ingest.js` (already built) accepts raw Shopee v4 JSON POSTed from a device
with the user's session cookies. This is the "proper" iOS path but requires:
- Extracting `SPC_EC` / `SPC_F` cookies from Safari's Shopee session
- Hardcoding them in the Shortcut (they expire and need refreshing)
- Two "Get Contents of URL" actions: GET v4 API → POST to `/api/ingest`

Not worth the hassle if the 1-action Shortcut above works.

---

## Repo
https://github.com/GreekeFire/Workers.git  
Key files: `work.html` (FIX tab), `sc.js` (scraper), `api/ingest.js`, `api/shopee.js`, `SCRAPERS.md`
