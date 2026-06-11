# Carousell Dropshipping — Business Context

## What This Is

Carousell dropshipping in Singapore. Source products from Shopee SG, list them on Carousell at a markup, collect payment via PayNow, then order from Shopee with the customer's address as the delivery destination. No inventory, no handling.

## Goal

**$2,000 profit in June 2026.** (~25 days remaining as of writing.)

This is an acceleration of the original 60-day target. The constraint is listings volume and quality, not demand.

---

## Products

**Current focus:** Everything, but shifting toward **furniture and home items** — these have the highest perceived value and the widest margins.

**Sourcing platform:** Shopee SG only.

**Blacklist rule:** Do not list items where the Shopee checkout price is too high to clear the margin floor. Cheap accessories (stickers, laptop cleaners, sub-$10 items) are out.

**Minimum source cost:** $15. Items below this are almost never profitable after the margin formula.

---

## Pricing Formula

**Margin rule:** Whichever is higher of:
- Flat minimum: **$24 profit per sale**
- Multiple: **1.5× the Shopee checkout price**

Always press checkout on Shopee and remove vouchers/coins to get the real price. The strikethrough price is not reliable.

**Target:** High perceived value items sourced under $20 that can list for $40–50+. Furniture and home items are the best hunting ground for this.

---

## Listings

**Target volume:** 50–100 new/fixed listings per day.

**Current state:** 1 Carousell account, ~1,300 listings. Most need fixing. Actively culling products that don't meet the $15 source cost floor.

**Workflow:** Live (not pre-prepared). Listings are created and fixed on the fly.

**Title formula:** Keyword-stuffed titles using the template in work.html. Current hook: "1–3 Days Delivery" — effective but looking to improve. Format: `[Feature] + [Item Name] | [Feature] + [Item Name] | ...`

**Cover image rule:** Clean, minimal branding, no watermarks. Use cleanup.pictures if needed.

---

## Fulfillment Flow

1. Customer chats on Carousell
2. Customer pays via **PayNow**
3. Order placed on Shopee with **customer's address** as delivery destination
4. Send customer a thank-you message and tell them to wait
5. Shopee delivers directly to customer (2–3 working days)

No inventory, no packing, no drop-off.

---

## Customer Communication

**Chatting style:** Direct and straightforward. Not desperate. Answer questions, then push toward PayNow payment.

**Follow-ups:** Not currently doing the 3-day follow-up system — acknowledged as a missed opportunity. Blueprint says this drives 25–33% of profits.

**Upsells:** Not currently doing post-purchase upsells. Another acknowledged gap.

**Traffic:** 100% organic Carousell search. No ads, no bumping. Strategy is listings volume.

---

## The App (work.html)

The single operational tool. Connected to Supabase. Everything else (finance, dashboard, gym, health tabs) has been cut.

**Current features:**
- Shopee scraper (needs improvement)
- Title & description generator (using keyword templates)
- Price calculator (codifies the margin formula)

**Planned improvements:**
- Better Shopee product scraper — faster, more reliable data extraction
- Carousell automation — reduce friction in the listing creation process
- Improved title templates and hooks beyond "1–3 Days Delivery"

**What's tracked daily:** Listings fixed and new listings created.

---

## What "Winning" Looks Like

- $2,000 net profit in June 2026
- 50–100 listings created or fixed per day
- Furniture and home items as primary product category
- work.html as the sole operational interface

---

## Known Gaps (Not Blocking, But Real)

| Gap | Impact | Blueprint Says |
|-----|--------|----------------|
| No follow-up system | ~25–33% of potential profit missed | Follow up 3× over 3 days |
| No upsells | Lost revenue per order | Offer second item after purchase |
| Inconsistent shipping updates to customers | Trust/experience issue | Notify on dispatch |
| No dynamic pricing on slow movers | Dead stock stays dead | Revisit periodically |
