# work.html — App Reference

## Overview

A mobile-first PWA for managing Carousell dropshipping operations. Four tabs: **FIX**, **NEW**, **SALES**, **DONE**. State persists in localStorage and syncs to Supabase.

---

## Session Bar (always visible)

Three counters at the top, reset at midnight:
- **Done** — listings marked done today
- **Deleted** — listings culled today
- **Revenue** — total sale value logged today

---

## Tabs

### FIX

Works through a queue of existing listings loaded from `data/listings-data.js`. Each listing shows one at a time.

**What you see per listing:**
- Title (editable textarea, 200–225 char counter)
- Description (shown after AI generates it)
- Shopee + Carousell links (editable via Edit button)
- Price calculator: enter Cost → shows Sell price (formula: `max(cost × 1.5, cost + $24)`, rounded to nearest $X.90)
- AI section: paste/fetch Shopee content → generate title + description

**Actions:**
- **Done** — saves listing to the Done list, advances to next
- **Delete** — culls the listing, advances to next (4s undo window)
- Swipe right = Done, swipe left = Delete (mobile)
- Keyboard: `D` = Done, `X` / `Delete` = Delete (desktop)

**Shopee fetch (FIX tab):**
- Paste a Shopee URL → hits `/api/shopee` → returns title, description, images
- Images shown as a scrollable thumbnail grid with individual download buttons
- After fetch, AI auto-generates title + description

**AI generation:**
- Calls `/api/claude` (server-side, key never exposed to browser)
- Falls back to direct Anthropic API call if server key not configured (uses locally saved key)
- Title: 200–225 chars, pipe-separated keyword segments, auto-retries if too short
- Description: structured format — delivery line first, bullet features, payment line last
- Can regenerate title only, description only, or both

**LISTINGS data format** (`data/listings-data.js`):
```
LISTINGS[i] = [title, shopeeUrl, carousellUrl, sourceCost, sellPrice]
```

---

### NEW

Create a brand-new listing not in the existing queue.

**Flow:**
1. Paste Shopee URL → Fetch → auto-generates title + description
2. Edit title/description manually if needed
3. Enter cost → sell price calculated live
4. Add Carousell URL (optional)
5. Save to Done → listing appears in DONE tab

Draft is auto-saved to localStorage and survives page refresh.

---

### SALES

Log individual sales for revenue tracking.

**Flow:**
1. Search listing by name → dropdown shows matching done listings with prices pre-filled
2. Confirm price → Log Sale
3. Sales list shows all sales grouped by date

Revenue today = sum of all sales logged today. Sales sync to Supabase.

**Search behaviour:** Searches done listings (AI-rewritten titles) first, then falls back to unprocessed LISTINGS by original title.

---

### DONE

Full list of all processed listings (both from FIX queue and NEW tab).

- Search by title
- Tap any entry to edit: title, cost (sell price recalculates), links
- Delete individual entries (removes from done count if done today)
- Shopee + Carousell links shown inline

---

## Pricing Formula

```js
function calcSell(cost) {
  return Math.ceil(Math.max(cost * 1.5, cost + 24) / 5) * 5 - 0.1;
}
```

Result is always `$X.90` rounded to nearest $5 bracket.

**Examples:**
| Cost | Sell |
|------|------|
| $15  | $39.90 |
| $20  | $44.90 |
| $30  | $54.90 |
| $50  | $79.90 |

---

## AI Prompts

### Title System Prompt
- 200–225 characters, strictly enforced
- Pipe-separated segments: `[Feature(s)] + [Item Name]`
- No brand names, platform names, seller phrases, or special characters
- Keyword-stuffed for Carousell search algorithm
- Auto-retries once if output is under 200 chars
- Trims trailing segments if over 225 chars

### Description System Prompt
- Returns JSON: `{"description": "..."}`
- Fixed structure:
  1. `🚚 FREE Local Delivery | 1-3 Working Days` (must be first line)
  2. One hook sentence
  3. 8–12 `✅ Feature — Buyer benefit` bullets
  4. `💳 PayNow / PayLah / Bank Transfer / Credit & Debit Card / Carousell Buy Button accepted 🙂` (must be last line)
- `normalizeDesc()` enforces the first/last line rules even if AI misorders them

---

## Data & Sync

**localStorage keys:**
- `carobiz_work` — queue progress (currentIndex, doneSet, deletedSet, counts, date)
- `carobiz_sales` — sales log array
- `carobiz_url_overrides` — per-listing URL edits keyed by index
- `carobiz_new_draft` — in-progress NEW tab draft
- `alfred_claude_key` — Claude API key (fallback only)

**Supabase keys (table: `app_state`):**
- `carobiz_work_progress` — queue progress
- `carobiz_done_data` — full done listings array
- `carobiz_sales` — sales log

Sync strategy: merge on load (local + remote, take max counts), push on every action. Sync indicator shown top-right.

---

## APIs

| Endpoint | What it does |
|----------|-------------|
| `/api/claude` | Proxies Anthropic API calls (keeps key server-side) |
| `/api/shopee` | Scrapes Shopee product page: title, description, images |
| `/api/image` | Proxies Shopee image downloads (bypasses CORS) |

---

## Known Issues / Planned Improvements

- Shopee scraper reliability is inconsistent — needs improvement
- Title hook "1-3 Days Delivery" is good but untested against alternatives
- No Carousell automation (manual copy-paste workflow)
- `nav.js` still loaded via absolute path (`/shared/nav.js`) — needs fixing to `../shared/nav.js`
