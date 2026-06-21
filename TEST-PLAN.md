# 🧪 Workers App — Test Plan

> Rewritten 2026-06-20 for the current (simplified) app. The old plan covered
> removed features (FIX tab, NEW tab, Carousell autofill, listing assignment,
> iOS Shortcut, app_state sync) — all gone. This covers only what ships today.
>
> **App = three things:** `work.html` (owner), `va.html` (VA worker), and the
> `/api/*` serverless functions. Report failures by test number.

Legend: 🤖 = can be checked automatically (curl/console) · 🙋 = needs a manual run
(real Shopee / VA session / two devices).

---

## Part 1 — Owner app: SALES (`work.html`)

- **1.1** 🙋 Search a listing by a title word → dropdown finds it (matches `ai_title` too) → tap → name/price/cost auto-fill.
- **1.2** 🙋 Pick a category → **Log Sale** → Revenue Today increments; the sale appears in the list under "Today".
- **1.3** 🙋 In Supabase → `sales_log` → new row with correct `name`, `price`, `listing_id`, `ts`. (There is no `app_state` anymore — `sales_log` is the only store.)
- **1.4** 🙋 Delete a sale with ✕ → press **UNDO** within 6s → the sale returns (and a fresh `sales_log` row is re-inserted).
- **1.5** 🙋 Revenue rolls over at **Singapore midnight**, not 8am — a sale logged at 1am SGT counts as today.

## Part 2 — Owner app: LISTINGS

- **2.1** 🤖 On load (logged in), the app opens straight to the **LISTINGS** tab — not a blank screen.
- **2.2** 🙋 Search a word that's in a listing's **AI title** but not its original Shopee title → it still appears.
- **2.3** 🙋 Tap a listing → inline editor → edit title + cost → **Save** → `listings.title` **and** `ai_title` update; `sell_price` = `calcSell(cost)`; any ⚠ warning flag is cleared.
- **2.4** 🙋 **Mark Listed** → `status='done'`. **Delete** → row removed.
- **2.5** 🙋 **⚠ Scan links** → flags done listings with bad/missing Shopee or Carousell links (active listings not flagged for missing Carousell).
- **2.6** 🙋 **⬇ Backup** → downloads a JSON of all listings + sales. (Do this for real — it's your only backup.)
- **2.7** 🙋 Filters **All / Assigned / Unassigned** narrow the results.

## Part 3 — Owner app: WORKERS

- **3.1** 🙋 WORKERS tab lists workers; each shows name, **account name**, done/target today, sold, pending. Buttons: Copy VA link, Rotate link, Deactivate. (No "Assign listings" / "Auto-assign" — removed.)
- **3.2** 🙋 **+ Add worker** (name + Carousell account + target) → appears immediately; `workers` row has `account_name`, `active=true`.
- **3.3** 🙋 **Copy VA link** → `…/va?w=<UUID>`.
- **3.4** 🙋 **Rotate link** → old link shows "deactivated", new link works; new `workers` row keeps the **same `account_name`**; old row `active=false`.
- **3.5** 🙋 **Deactivate** → their unposted (`active`) listings are **deleted** and their unconsumed `scrape_inbox` rows cleared; the VA link shows "This link has been deactivated."
- **3.6** 🙋 Sold count: log a sale with a listing picked from the dropdown → refresh WORKERS → the assigned worker's **Sold** increments.

## Part 4 — VA flow (`va.html` + bookmarklet)

- **4.1** 🙋 Open a VA link → worker name + progress bar; empty queue shows the bookmarklet.
- **4.2** 🙋 Run the bookmarklet on a fresh Shopee product → green toast → within ~10s a card appears in the VA queue with title, sell price, images. `listings` row has `assigned_worker_id` + `account_name` set, `ai_title` populated.
- **4.3** 🙋 Guards: scrape a non-SG / wrong-category / low-rating / out-of-price-band product → warning chips appear; **Done** is disabled until each is "Add anyway"-acked.
- **4.4** 🙋 If `ai_title` is null/empty → red "contact your manager" notice; Done blocked regardless of warnings.
- **4.5** 🙋 **Copy** buttons copy the title and description text.
- **4.6** 🙋 Carousell URL required before Done. A **profile/homepage** link (e.g. `carousell.sg/u/name`) keeps the border grey and Done disabled; only a real listing link (`/p/`, `/sell/`, or `app.link`) turns it green. (Client now matches the server check — no more "enabled then rejected".)
- **4.7** 🙋 **Done** → `listings.status='done'`, `carousell_url` saved, `worker_done` row written (SGT date), count increments.
- **4.8** 🙋 **Skip** → card hidden, count unchanged, listing still `active` in DB.
- **4.9** 🙋 Scrape a product already listed (same Shopee URL) → it does **not** create a duplicate (app check + DB unique index).

## Part 5 — Backend & security (🤖 mostly automatable)

- **5.1** 🤖 `POST /api/claude` with **no** `x-internal-secret` → `403 forbidden`.
- **5.2** 🤖 `GET /api/worker-profile?w=<bogus-uuid>` → `404 worker-not-found` (proves the service key is valid).
- **5.3** 🤖 `GET /rest/v1/scrape_inbox` with the public anon key → `[]` (no worker_id leak).
- **5.4** 🤖 `GET /rest/v1/workers` / `sales_log` / `worker_done` with the public anon key → `[]` (owner-only RLS).
- **5.5** 🤖 `/api/image` and `/api/shopee` reject non-Shopee URLs (`400`).
- **5.6** 🙋 Owner can still read/write everything (login → SALES/LISTINGS/WORKERS load and save) — RLS doesn't lock out the owner.

---

## Known edge cases (accepted, not bugs)

- **VA bookmarklet blocked in Brave** — Brave blocks `javascript:` bookmarklets; VAs must use Chrome.
- **AI title null on very old scrapes** — listings scraped before the VA system won't have `ai_title`; regenerate or they can't be marked done.
- **dataLayer scrapes can miss guards** — if Shopee's v4 API path is blocked, category/SG-seller/rating fields are null and those guards are silently skipped; the listing still creates.
- **Not offline-capable** — the app needs a connection; with none it won't load (by design).
- **Historical date seam** — sales logged 00:00–08:00 SGT *before* 2026-06-20 are filed under the previous (UTC) day; only new sales use SGT.

---

## Scorecard

| # | Test | Result |
|---|------|--------|
| 1.1–1.5 | SALES: search, log, sales_log row, undo, SGT rollover | ⏳ |
| 2.1 | Opens to LISTINGS, not blank | ⏳ |
| 2.2–2.7 | LISTINGS: search, edit/save, mark/delete, scan, backup, filters | ⏳ |
| 3.1–3.6 | WORKERS: list, add, copy, rotate, deactivate, sold count | ⏳ |
| 4.1–4.9 | VA flow: load, scrape, guards, AI, copy, caro-URL, done, skip, dedupe | ⏳ |
| 5.1 | /api/claude no-secret → 403 | ✅ 2026-06-20 |
| 5.2 | /api/worker-profile bogus → 404 (service key ok) | ✅ 2026-06-20 |
| 5.3 | anon read scrape_inbox → [] | ✅ 2026-06-20 |
| 5.4 | anon read workers/sales_log/worker_done → [] | ✅ 2026-06-20 (listings too) |
| 5.5 | image/shopee proxies reject non-Shopee | ✅ 2026-06-20 |
| 5.6 | owner reads/writes fine under RLS | ⏳ manual (you, logged in) |
