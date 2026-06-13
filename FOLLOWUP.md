# 📝 Follow-up notes

> Captured 2026-06-13 after the full TEST-PLAN run. Items 1–2 actioned; item 3 is a recording guide.

---

## 1. Does the iOS userscript need to be changed? — YES, now recommended

During testing the existing iOS script scraped correctly (full title, 2,223-char description, 9 images, 3 variants, and it handled a multi-variant product whose `price_max` came back as Shopee's `-1` sentinel — `highestCost()` derived the right cost, $38.10). So it *works*.

**But** it's "pretty long," which means it's likely the **old monolithic version** (scraping logic baked in) rather than the **thin loader**. The monolithic version will **not** auto-update when `sc.js` changes — and it won't have the new button feedback (see §2).

**Action:** replace the iOS script's entire contents with the current **`shopee-work.user.js`** (v1.4, thin loader + new UI). Easiest path that avoids Chrome/Safari's "can't add from this website" block:
- **Tampermonkey Dashboard → Utilities → Install from URL** → `https://workers-v1.vercel.app/shopee-work.user.js` → Install.
- (Or it auto-updates via the script's `@updateURL` once deployed.)
- **Not** the bare one-line bookmarklet — that has no `// ==UserScript==` header, so the manager won't run it.

> Requires deploying the updated files to production first (merge to `main`).

---

## 2. Userscript UI improvements — DONE (v1.4 / v1.6)

Shipped:
- **`sc.js`** — emits a `sw:result` CustomEvent from the toast so the host userscript can reflect the real outcome.
- **`shopee-work.user.js` (v1.4):**
  - `→ Work` button now shows the **live result**: `✓ $38.10` on success, `✗ retry` on failure (with an 8s fallback revert if an older `sc.js` is in play).
  - **AUTO chip shows a live session counter** — `AUTO ● · 3` — so you can see how many products auto-scraped this session at a glance.
- **`carousell-fill.user.js` (v1.6):** a **`⏳ filling…` chip** appears on the edit page while waiting for the form to mount, so a slow Carousell load no longer looks like nothing's happening.

Not done (deferred polish): per-product "already sent" hint on the button (manual scrapes don't track per-item state, so it'd only reflect AUTO — skipped to avoid confusion).

---

## 3. How to record the "scrape 3–4 products → shows in NEW" demo

> Goal: a short, clean clip for the client showing products being scraped and landing as cards in NEW. Pick **laptop** (cleanest) or **iPhone** (most "real"), or record both for a stronger story.

### 🔑 Before you record (both devices)
- Have **3–4 fresh product URLs** ready (never listed — a done product correctly says "already did this" and makes no card, which looks broken on camera).
- **Pre-paste your Claude API key** in NEW so AI copy generates during the demo instead of erroring.
- Prefer the **AUTO / `→ Work` scrape** (dataLayer, puzzle-free) over URL-paste — URL-paste can return cost $0 if Shopee blocks the server fetch.

---

### 💻 Laptop recording (Windows) — cleanest
**Recorder:** press **`Win + Alt + R`** to start/stop (Xbox Game Bar). Saves an MP4 to `Videos\Captures`, no install. (For a GIF: ScreenToGif. For zoom/polish: OBS Studio.)

**Steps:**
1. Open Shopee; make sure the chip reads **`AUTO ●`** (green). Open `work.html` in a second tab on the **NEW** tab.
2. **`Win + Alt + R`** to start recording.
3. Open product #1 in a new tab → click into it → small green toast fires on its own. Repeat for #2, #3, (#4) — **click into each tab to focus it** (background tabs don't scrape until focused, by design). The `AUTO ● · N` counter ticks up.
4. Switch to the **work.html / NEW** tab → click **⬇ Pull scraped**.
5. The 3–4 cards shimmer in and fill with title / description / cost → sell.
6. (Payoff) swipe or click **Save to Done →** on one → "Saved ✓", card disappears.
7. **`Win + Alt + R`** to stop. Clip is in `Videos\Captures`.

---

### 📱 iPhone recording — most "real"
**Recorder:** Settings → Control Center → add **Screen Recording**. Then swipe into Control Center and tap the **⏺ record** button (3-2-1 countdown). Stop via the red status bar → tap → Stop.

**Steps:**
1. Add the screen recorder to Control Center (one-time).
2. Open Shopee in Safari; turn **`AUTO ●`** on (or use the `→ Work` button per product).
3. Start the screen recording (Control Center → ⏺).
4. Open product #1 → green toast. Repeat #2, #3, (#4).
5. Open your **work.html** (tab or home-screen PWA) → **NEW** → **⬇ Pull scraped** → cards appear with **visible Save/Clear buttons**.
6. (Payoff) **swipe a card left** to Save → "Saved ✓".
7. Stop the recording (tap the red clock → Stop). Clip saves to Photos.
- ⚠️ **Close & reopen** the PWA before recording so you're on the latest `work.html` (iOS caches hard).
- ⚠️ Swipe from the **middle** of a card (edge = Safari back gesture).

---

### 🎬 For the strongest client demo: record both, cut together
1. **Laptop clip** — show the bulk workflow: AUTO on, several tabs self-scraping, Pull → a wall of finished cards. "This is how we process volume."
2. **iPhone clip** — show it works on the phone too: scrape on the go, pull, swipe-to-save. "And the team can do it anywhere."
3. Stitch in any editor (even the Photos app or Clipchamp on Windows). Keep total ~45–60s.

**Tips for a clean take**
- Generation is ~10s/card sequentially — either let the shimmer→fill play (reads as "it's working") or pre-scrape and demo just the **Pull → cards** moment for a snappier cut.
- Do a dry run once so you know the tab order; products that 404 or are out of stock can scrape thin.

---

### Status
- [x] Decide iOS userscript → **swap to thin loader v1.4** (needed for the new UI anyway)
- [x] Userscript UI polish → button result + AUTO counter + Carousell fill chip
- [ ] Deploy updated `sc.js` / userscripts to production (merge to `main`)
- [ ] Reinstall `shopee-work.user.js` v1.4 on iPhone (Install from URL)
- [ ] Record the demo (laptop and/or iPhone)
