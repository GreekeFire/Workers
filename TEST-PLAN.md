# 🧪 WORKERS APP — FULL TEST DAY PLAN

> Created 2026-06-13. Covers everything shipped in the big fix/polish session:
> dataLayer scrape fix, unified card-based NEW tab, refresh-safe batch,
> dedup against Done, swipe gestures, demo polish, cross-device sync fixes.
>
> Report failures by **test number** + what you saw instead.

---

## 🎒 Before you start (10 min)

1. **Hard-refresh everything.**
   - Laptop: open `workers-v1.vercel.app/work.html`, press **Ctrl+Shift+R**.
   - iPhone: close the Safari tab completely, reopen it. (If it's a home-screen PWA, swipe it away and reopen.)
2. **Log in on both devices.**
3. **Prepare 6 fresh Shopee products** you have NEVER listed. Write the links in a note.
4. **Pick 1 product you already finished** (in your Done pile). Note its link too.

> ⚠️ **Trip-up #1:** If you test with already-done products, NEW will correctly say
> "You already did this ✓" and make no card — and you'll think it's broken. It's not.
> **Fresh products only** for the main tests.

> ⚠️ **Trip-up #2:** iPhone PWAs cache hard. If something looks old on the phone, it
> probably IS the old version — close and reopen before assuming a bug.

---

## PART 1 — The Scraper (laptop) 🟢

### Test 1.1 — Green toast
1. Open fresh product #1 on Shopee.
2. Click **→ Work**.
3. ✅ A **green** toast with a price + image count.

> ⚠️ If the toast is **amber**, the scrape still worked — it just used the slower API
> path. Amber once in a while = fine. Amber every time = problem.
> ⚠️ Clicking → Work the *instant* the page loads may give amber. Let the page settle a second.

### Test 1.2 — Non-product page
1. Go to the Shopee **homepage**, click → Work.
2. ✅ Red toast: **"Go to a Shopee product page first."** Nothing else happens.

### Test 1.3 — AUTO mode
1. Turn the **auto ○** chip to **AUTO ●**.
2. From work.html FIX tab, hit **↗ Open next 10** (or open 2–3 product tabs manually).
3. Click into each tab and wait a beat.
4. ✅ Each tab shows a small green toast on its own — no clicking.

> ⚠️ Background tabs don't scrape until you **focus** them (browser throttling — intentional).
> ⚠️ A burst of 10 tabs may get popup-blocked. Allow popups, press the button again —
> it opens only the missed ones, never duplicates.

---

## PART 2 — NEW tab (laptop) ✨ *the most-changed area*

### Test 2.1 — Empty state
1. Go to **NEW** with nothing pending.
2. ✅ ONE "Add listings" bar (textarea + **✨ Generate from URLs** + **⬇ Pull scraped** + **+ Blank**).
   The old big single form is gone.

### Test 2.2 — Pull scraped → cards
1. Scrape fresh products #1–#3 (green toasts).
2. NEW → **⬇ Pull scraped**.
3. ✅ 3 cards appear. Shimmer → text fades in. Each has title, description, cost→sell, images.

> ⚠️ Generation is ~10s per card, sequential. 3 cards ≈ 30s. The shimmer = loading, not frozen.

### Test 2.3 — THE BIG ONE: refresh recovery
1. With those 3 cards showing and **unsaved**, press **F5**.
2. Go back to NEW (it may auto-pull on its own).
3. ✅ The 3 cards come back (regenerated — wording may differ slightly; normal).

### Test 2.4 — Save resolves
1. **Save to Done →** on card 1.
2. ✅ "Saved ✓", card gone, Done counter +1.
3. Refresh → NEW → ✅ that card does NOT return. The other 2 do.

### Test 2.5 — Clear resolves
1. **Clear** on card 2.
2. ✅ Card gone. Refresh → ✅ stays gone. (Card 3 remains.)

### Test 2.6 — Swipe
1. On card 3: drag it **left** past the green "Done ✓" reveal, release.
2. ✅ It saves, same as the button.

> ⚠️ Start the swipe on the card's **background**, not inside a textarea (drag in a
> text box selects text). Laptop needs a touchscreen — otherwise test swipe on the phone (Part 5).
> ⚠️ Swipe must be mostly **horizontal**. Diagonal drags cancel (so scrolling doesn't trigger it).

### Test 2.7 — Already-done message
1. Scrape the product you saved in 2.4 again.
2. NEW → ⬇ Pull scraped.
3. ✅ Toast: **"You already did this one ✓"** — no card.
4. Pull again → ✅ "Nothing scraped yet — use the bookmarklet first." (the already-done re-scrape was consumed off the belt by step 2/3, so the inbox is now empty)

### Test 2.8 — Generate from URLs
1. Paste 2 fresh links (products #4, #5), one per line → **✨ Generate from URLs**.
2. ✅ Textarea clears, 2 cards appear and generate.

> ⚠️ This path fetches through the server, which Shopee sometimes blocks → a card can
> error or come back with **cost $0**. Not a bug — type the cost manually, or scrape
> that product with the bookmarklet instead.
> ⚠️ URL-pasted and Blank cards do **NOT** survive a refresh (only scraped ones are on
> the cloud queue). Save them before refreshing.

### Test 2.9 — + Blank
1. Click **+ Blank** → ✅ empty card.
2. Type any title, cost 10 → ✅ Sell shows **$35** (calculator rounds up to the next $5, with a +$24 minimum margin: max(10×1.5, 10+24)=34 → 35).
3. Save → ✅ saved. Check LISTINGS tab — it's there.

### Test 2.10 — Append, not wipe
1. With 1 unsaved card showing, paste 1 more URL → Generate.
2. ✅ New card **adds below**; the existing card survives.

---

## PART 3 — FIX tab (laptop) 🛠️

### Test 3.1 — The loop
1. Go to FIX. ✅ Progress bar + "N left".
2. The card auto-pulls its scrape if you opened that product with AUTO on; otherwise **⬇ Pull**.
3. ✅ Cost updates from the live price (note appears if changed), AI copy generates.

### Test 3.2 — Advancing
1. Press **D** (Done) or swipe.
2. ✅ Next card **slides in**; progress bar grows.
3. ✅ Watch for **⚡ next ready** — when shown, the next card's copy appears instantly.

### Test 3.3 — Undo
1. Mark one Done, hit **UNDO** on the toast within ~6 seconds.
2. ✅ The card comes back with your edits intact.

### Test 3.4 — Keyboard
- ✅ ←/→ skip, **D** done, **X** delete, **G** generate, **F** fill+done.

> ⚠️ Keys don't fire while the cursor is inside a text box. Click empty space first.
> ⚠️ **F** refuses politely without generated AI copy; Done refuses without a cost.
> Those toasts are guards, not errors.

---

## PART 4 — Carousell fill (laptop) 🎯

1. On a FIX card with a Carousell link + generated copy, press **F** (or **→ Fill Carousell**).
2. ✅ Carousell listing opens in a new tab; chip says **⌨ Ctrl+Enter to open editor**.
3. **Ctrl+Enter** → ✅ clicks Edit, form fills itself, toast "✓ Filled 3 fields".
4. **Ctrl+Enter** again → clicks Save/Update. (Skip the real save if you don't want to
   change a live listing — just close the tab.)

> ⚠️ The fill is only valid **2 minutes** after pressing F (stale-slot guard). Timed
> out? Press F again.
> ⚠️ Never type the `/sell/` edit URL directly — Carousell 404s that. Always listing
> page → Ctrl+Enter.

---

## PART 5 — iPhone 📱

### Test 5.1 — Scraper
Open a fresh product in Safari, run the userscript → ✅ green toast.

### Test 5.2 — NEW on mobile
1. work.html → NEW → ⬇ Pull scraped.
2. ✅ Cards appear. ✅ **Save/Clear buttons visible** (was broken before — hidden by CSS).
3. **Swipe left** → ✅ saves. **Swipe right** on another → ✅ clears.

> ⚠️ Swiping from the very screen edge triggers Safari's back gesture. Start from the
> middle of the card.

### Test 5.3 — FIX on mobile
✅ Swipe works; ✅ Done/Delete **buttons hidden on purpose** (swipe replaces them — FIX only).

---

## PART 6 — SALES + LISTINGS 💰

### Test 6.1 — Log a sale
1. SALES → search a listing by a title word → ✅ dropdown finds it, tap → price/cost auto-fill.
2. Pick category, **Log Sale** → ✅ Revenue counter updates.
3. Delete with ✕, press UNDO → ✅ it returns.
4. In Supabase → `sales_log` → ✅ new row with correct `name`, `price`, `listing_id`, `ts`.
5. In Supabase → `app_state` → row with `key = 'carobiz_sales'` → ✅ `data` array also updated (legacy sync still runs).

### Test 6.2 — LISTINGS
1. Search → ✅ results. Tap one → ✅ inline editor (title/cost/links).
2. Edit title → Save → In Supabase → `listings` → ✅ `title` column updated.
3. **⚠ Scan links** → ✅ reports broken links (or none).
4. **⬇ Backup** → ✅ downloads JSON. **Do this for real — it's your only backup.**

---

## PART 7 — Cross-device grand finale 🌐

1. **Laptop:** scrape fresh product #6, NEW → pull → card appears. **Don't** resolve it.
2. **iPhone:** open NEW → ✅ same product appears as a card.
3. **iPhone:** swipe left to Save.
4. **Laptop:** refresh → NEW → ✅ card gone. LISTINGS shows it. ✅ Done counters match.

> ⚠️ **The one real landmine:** do NOT save the **same card on both devices at once** —
> that creates a duplicate listing. Finish on one device, then switch. (Known edge case,
> deliberately not engineered away.)

---

## PART 8 — VA System 👷

> Requires: one worker row in Supabase (`workers` table), and a fresh Shopee product not already in listings.

### Test 8.1 — WORKERS tab loads
1. Open `workers-v1.vercel.app/work.html` → click **WORKERS** tab.
2. ✅ Worker list shows. Each worker shows name, done/target today, pending count.
3. ✅ **Copy VA link**, **+ Assign listings**, **Rotate link**, **Deactivate** buttons visible.

### Test 8.2 — Create a worker
1. Click **+ Add worker** → enter a name, leave target at 100 → **Create worker**.
2. ✅ Worker appears in the list immediately.
3. Click **Copy VA link** → paste it somewhere → ✅ URL format is `workers-v1.vercel.app/va?w=UUID`.
4. In Supabase → `workers` → ✅ new row with correct `name`, `active = true`, `daily_target = 100`.

### Test 8.3 — VA page loads
1. Open the VA link in a browser.
2. ✅ Worker name shown at top, progress bar 0/100.
3. ✅ If queue is empty: "Queue empty" card + bookmarklet shown below.
4. ✅ If queue has listings: first listing card shown.

### Test 8.4 — Bookmarklet sends to VA queue
1. Copy the bookmarklet from the VA page.
2. On a Shopee product page, paste and run it in the browser console (`javascript:` prefix optional in console).
3. ✅ Green toast on Shopee page.
4. Wait 10s on the VA page → ✅ listing card appears with sell price, title, images.
5. In Supabase → `scrape_inbox` → ✅ row with correct `worker_id`, `consumed = false` (before Done), then `consumed = true` after Done.
6. In Supabase → `listings` → ✅ new row with `assigned_worker_id` matching this worker, `ai_title` populated.

### Test 8.5 — Guards show correctly
1. Scrape a product that is: non-SG seller, wrong category, or price < $15.
2. ✅ Warning chips appear above the card (Category / Non-SG seller / Price low).
3. ✅ Done button is **disabled** (greyed out) until all warnings are acknowledged.
4. Click **Add anyway** on each chip → ✅ chips turn green with ✓.
5. ✅ Done button becomes **bright green** and enabled.
6. In Supabase → `listings` → ✅ `guard_warnings` column is a JSON array with the warning keys (e.g. `["category","non-sg-seller"]`).

### Test 8.6 — AI title missing / failed handling
1. If `ai_title` is **null** in DB (AI never ran): ✅ Red notice: "AI title not generated — contact your manager before marking this done."
2. If `ai_title` is **empty string ""** (AI ran but returned nothing): ✅ Red notice: "AI title generation failed — contact your manager to regenerate before marking this done."
3. ✅ Done button is disabled in both cases regardless of warnings.

### Test 8.7 — Copy buttons work
1. On a listing card, tap **Copy** next to Title.
2. ✅ Clipboard contains the title text (paste to verify).
3. Tap **Copy** next to Description → ✅ clipboard has description.

### Test 8.8 — Done flow
1. Acknowledge any warnings → tap **Done ✓**.
2. ✅ Count increments (e.g. 0/100 → 1/100), progress bar moves.
3. ✅ Next listing in queue loads automatically.
4. In Supabase → `listings` table → ✅ that listing's `status` = `done`.
5. In Supabase → `worker_done` table → ✅ new row with correct `worker_id`, `listing_id`, `date`.

### Test 8.9 — Skip flow
1. On a listing, tap **Skip →**.
2. ✅ Listing is hidden, next one loads.
3. ✅ Count does NOT increment.
4. ✅ Listing still shows as `active` in Supabase (skip doesn't delete it).

### Test 8.10 — Deactivate worker
1. In WORKERS tab, click **Deactivate** on a worker.
2. ✅ Worker card dims in the list.
3. Open that worker's VA link → ✅ shows "This link has been deactivated. Contact your manager."

### Test 8.11 — WORKERS tab count updates
1. Have a VA tap Done on a listing.
2. In owner's WORKERS tab, click the refresh button (↻).
3. ✅ Done count for that worker increments.

### Test 8.12 — Assign listings
1. In WORKERS tab, click **+ Assign listings** on a worker → enter a number (e.g. 5).
2. ✅ Toast confirms assignment.
3. Open that worker's VA link → ✅ assigned listings appear in their queue.
4. In Supabase → `listings` → filter `assigned_worker_id = <worker UUID>` → ✅ correct number of rows updated.

### Test 8.13 — Rotate VA link
1. In WORKERS tab, click **Rotate link** on an active worker → confirm the dialog.
2. ✅ Toast: "New VA link copied ✓".
3. ✅ Old VA link (`?w=<old-UUID>`) now shows "This link has been deactivated."
4. ✅ New VA link (`?w=<new-UUID>`) loads the worker page normally.
5. In Supabase `workers` table → ✅ old row has `active = false`, new row has `active = true`.

### Test 8.14 — Batch distribute listings
1. Have at least 2 active workers and some unassigned listings.
2. In WORKERS tab, click **Distribute all unassigned** → confirm the dialog.
3. ✅ Toast: "Distributed N listings ✓".
4. ✅ Each worker's pending count increases in the WORKERS view.
5. ✅ LISTINGS tab → **Assigned** filter → listings now show "👤 VA" badge.

### Test 8.15 — LISTINGS tab filters
1. Open LISTINGS tab → ✅ Three filter buttons: **All**, **Assigned**, **Unassigned**.
2. Click **Assigned** → ✅ only listings with a worker assigned show ("👤 VA" badge on each).
3. Click **Unassigned** → ✅ only listings with no assigned worker show.
4. Click **All** → ✅ all listings show again.
5. Search with a keyword while **Assigned** is active → ✅ results are still filtered.

### Test 8.16 — Sold count in WORKERS tab
1. Log a sale in the SALES tab where you selected a listing via the dropdown (so `listing_id` is set).
2. In WORKERS tab → click refresh (↻).
3. ✅ The worker assigned to that listing shows **Sold: 1** (or incremented if already had sales).
4. In Supabase `sales_log` table → ✅ new row exists with correct `listing_id`, `price`, `ts`.

### Test 8.18 — Carousell URL required before Done
1. On a listing card with all warnings acked and AI title present, tap **Done ✓** without pasting a URL.
2. ✅ Toast: "Paste your Carousell listing link first" — Done does not proceed.
3. Paste a non-Carousell URL (e.g. `https://shopee.sg/...`) → ✅ input border stays grey, Done still blocked.
4. Paste a valid Carousell listing URL (e.g. `https://www.carousell.sg/p/...`) → ✅ input border turns green.
5. Tap **Done ✓** → ✅ count increments, listing removed from queue.
6. In Supabase → `listings` → ✅ `carousell_url` column now contains the pasted URL.
7. In owner's LISTINGS tab → tap the listing → ✅ "Carousell ↗" link is present and opens the correct URL.

### Test 8.17 — Fuzzy duplicate log
1. Scrape a product whose title and cost are very similar (≥60% title match, cost within 10%) to an existing listing.
2. ✅ The listing is NOT blocked — it still creates normally with no warning shown to VA.
3. In Supabase `duplicate_log` table → ✅ new row logged with `incoming_title`, `incoming_url`, `worker_id`.

---

## 🕐 Manual Testing Queue (run 2026-06-16)

Automated tests were run on 2026-06-15. The following could not be automated — they require Shopee access, a real VA session, an iPhone, or two devices. Run these tomorrow in order.

### Needs laptop + Shopee bookmarklet (Parts 1–4)
- **1.1** Scraper green toast on a fresh product
- **1.2** Scraper red guard on Shopee homepage
- **1.3** Scraper AUTO mode
- **2.1–2.10** Full NEW tab flow (pull, refresh, save, clear, swipe, already-done, generate from URLs, blank, append)
- **3.1–3.4** FIX tab loop, advance, undo, keyboard shortcuts
- **4** Carousell fill via Ctrl+Enter

### Needs real VA session (open VA link + scrape a product first)
- **8.4** Bookmarklet sends product to VA queue → listing card appears
- **8.5** Guards show for non-SG / wrong category / price out of range
- **8.6** AI title null vs empty string shows different red messages; Done blocked in both cases
- **8.7** Copy title + description buttons copy correct text
- **8.8** Done flow: paste Carousell URL → tap Done → count increments, `listings.status = done`, `carousell_url` saved, `worker_done` row written
- **8.9** Skip flow: listing hidden, count unchanged, still `active` in DB
- **8.11** Owner's WORKERS tab count refreshes after VA taps Done
- **8.17** Fuzzy dupe: near-match product doesn't block VA, `duplicate_log` row written
- **8.18** Carousell URL required: blocked without URL, grey → green on valid URL, saved to DB on Done

### Needs clean manual test
- **6.1 UNDO** — log a sale, tap ✕ to delete, press UNDO within 6 seconds, confirm sale returns

### Needs iPhone (Part 5)
- **5.1** Scraper green toast on Safari
- **5.2** NEW tab cards + swipe on mobile (Save/Clear visible)
- **5.3** FIX swipe on mobile, Done/Delete buttons hidden

### Needs two devices (Part 7)
- **7** Cross-device handoff: scrape on laptop → resolve on iPhone → laptop confirms gone

---

## 📋 Scorecard

| #   | Test                                                                | Pass? |
|-----|---------------------------------------------------------------------|-------|
| 1.1 | Scraper: green toast                                                | ⏳ manual |
| 1.2 | Scraper: non-product red guard                                      | ⏳ manual |
| 1.3 | Scraper: AUTO mode                                                  | ⏳ manual |
| 2.1 | NEW: empty state = add bar only                                     | ⏳ manual |
| 2.2 | NEW: pull scraped → cards                                           | ⏳ manual |
| 2.3 | NEW: refresh recovery                                               | ⏳ manual |
| 2.4 | NEW: save resolves                                                  | ⏳ manual |
| 2.5 | NEW: clear resolves                                                 | ⏳ manual |
| 2.6 | NEW: swipe                                                          | ⏳ manual |
| 2.7 | NEW: already-done message                                           | ⏳ manual |
| 2.8 | NEW: generate from URLs                                             | ⏳ manual |
| 2.9 | NEW: + Blank                                                        | ⏳ manual |
| 2.10| NEW: append, not wipe                                               | ⏳ manual |
| 3.1 | FIX: loop + auto-pull + cost update                                 | ⏳ manual |
| 3.2 | FIX: slide-in + progress + ⚡ chip                                  | ⏳ manual |
| 3.3 | FIX: undo                                                           | ⏳ manual |
| 3.4 | FIX: keyboard shortcuts                                             | ⏳ manual |
| 4   | Carousell fill via Ctrl+Enter                                       | ⏳ manual |
| 5.1 | iPhone: scraper green                                               | ⏳ manual |
| 5.2 | iPhone: NEW buttons + swipe                                         | ⏳ manual |
| 5.3 | iPhone: FIX swipe, buttons hidden                                   | ⏳ manual |
| 6.1 | Sales: log, autofill, undo                                          | ✅ log+DB / ⏳ undo manual |
| 6.2 | Listings: editor, scan links, backup                                | ⏳ manual |
| 7   | Cross-device handoff                                                | ⏳ manual |
| 8.1 | WORKERS tab loads with worker list                                  | ✅ |
| 8.2 | Create worker → appears in list + VA link correct                   | ✅ |
| 8.3 | VA page loads with name + progress bar                              | ✅ |
| 8.4 | Bookmarklet sends product to VA queue                               | ⏳ manual |
| 8.5 | Guards show + Done blocked until acknowledged                       | ⏳ manual |
| 8.6 | AI title missing → red notice + Done blocked                        | ⏳ manual |
| 8.7 | Copy title + description buttons work                               | ⏳ manual |
| 8.8 | Done → count increments, listing marked done in DB                  | ⏳ manual |
| 8.9 | Skip → listing hidden, count unchanged, still active in DB          | ⏳ manual |
| 8.10| Deactivate worker → VA link shows deactivated message               | ✅ |
| 8.11| WORKERS tab count updates after VA taps Done                        | ⏳ manual |
| 8.12| Assign listings → appears in VA queue                               | ✅ |
| 8.13| Rotate link → old dead, new works                                   | ✅ |
| 8.14| Batch distribute → listings split across workers                    | ✅ |
| 8.15| LISTINGS filters: All / Assigned / Unassigned                       | ✅ |
| 8.16| Sold count in WORKERS tab after logging a linked sale               | ✅ |
| 8.17| Fuzzy dupe → listing created, duplicate_log row written             | ⏳ manual |
| 8.18| Carousell URL required: blocked without, green on valid, saved to DB | ⏳ manual |

---

## Known edge cases (accepted, not bugs)

- **Simultaneous save on two devices** → duplicate listing. Avoid by finishing on one device first.
- **Blank / URL-pasted cards don't survive refresh** — only belt-backed (scraped) cards do. Save before refreshing.
- **No dup-check when saving a Blank/pasted card** for a product already in Done — the
  pull path is guarded, the manual paths aren't.
- **URL-paste path can return cost $0** when Shopee blocks the server fetch — enter cost manually.
- **VA bookmarklet blocked in Brave** — Brave blocks `javascript:` bookmarklets from the bookmarks bar. VAs must use Chrome.
- **AI title null on old scrapes** — listings scraped before the VA system was built won't have ai_title. Owner must regenerate or the VA cannot mark them done.
- **dataLayer scrapes miss guards** — VERIFIED 2026-06-14: Shopee product page dataLayer has no product metadata (only generic impression events). Category/SG seller/rating guards only fire when sc.js uses the v4 API path. If the v4 API is blocked, guard fields are null and those guards are silently skipped — listing still creates, VA still sees it.
- **Shopee URL normalisation**: both slug (`/ShieldMonster-...-i.31165845.8302982366`) and product-ID (`/product/31165845/8302982366`) formats are now normalised to `shopee.sg/product/{shopid}/{itemid}` before the dupe check. Listings created before this fix (e.g. row 1431 vs 1432) may still be duplicates — clean them up manually in Supabase.
- **Skip doesn't remove from queue permanently** — skipped listings stay active and will reappear on next page load. This is intentional (VA may want to come back to them).
