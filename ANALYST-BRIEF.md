# Steadymart — Business & Workflow Brief (for external review)

Prepared for an outside analyst to review the operating model and suggest workflow
improvements. This doc stands alone — no other repo access needed.

---

## 1. Executive summary

**What it is:** A dropshipping business on Carousell Singapore. Products are sourced
from Shopee SG, listed on Carousell at a markup, and fulfilled by ordering from
Shopee once a buyer pays. No inventory, no warehouse — pure margin on the price gap.

**Where it stands (June 2026):** Revenue to date is ~$30, well behind the original
$2,000 June target. The software (scraping, AI-generated listings, upload workflow)
is built and functional. The bottleneck is listing *volume* — one person doing all
the sourcing and uploading manually can't produce enough listings per day to hit
meaningful revenue. The current initiative is hiring virtual assistants (VAs) to take
over sourcing and uploading, with the owner shifting into a management/oversight role.

**What we want from the analyst:** A fresh look at the business model, unit
economics, and the owner/VA workflow below — specifically whether the model can
reach profitability at this throughput, and where the workflow (guards, pricing,
sourcing rules, VA incentives) could be tightened or simplified.

---

## 2. Business model

| | |
|---|---|
| **Source** | Shopee SG — any seller, any category within scope (see §5) |
| **Sell** | Carousell SG listings |
| **Fulfil** | Order from Shopee after a buyer pays on Carousell, ship directly to the buyer |
| **Inventory** | None — items are only bought after they sell |

**Pricing formula:** `max(cost × 1.5, cost + $24)`, rounded up to the next $5.
- $20 cost → sell at $65
- $50 cost → sell at $80
- Minimum $24 gross margin on every item, no exceptions

**Target categories:** Furniture, beds/mattresses, safes, home storage, home
appliances, tools/home improvement, garden & outdoors. Deliberately excludes fashion,
jewellery, beauty, and general lifestyle goods — the bet is that bulky/home-category
items have less price-comparison shopping and more margin room than fashion.

**Unit economics (targets — not yet validated by real sales data):**
- ~$25 net profit per sale
- ~15% chat-to-sale conversion rate (Carousell inquiries → completed sale)
- ~3–4 sales/day needed to hit meaningful revenue

These targets have not been tested against real data yet — only ~$30 in revenue has
come in so far, so the conversion rate and per-sale profit assumptions are unproven.

---

## 3. Current status (June 2026)

- **Revenue to date:** ~$30 (target was $2,000 for the month)
- **What's working:** The listing pipeline is fully built — scraping products off
  Shopee, auto-generating titles/descriptions via AI, and pushing them through an
  upload queue all work end to end.
- **What's blocking growth:** Throughput. With the owner doing all sourcing and
  uploading solo, the number of listings produced per day is too low to generate
  meaningful sales volume, even before accounting for conversion rate.
- **Current bet:** Hire VAs to take over sourcing (finding products on Shopee) and
  uploading (posting to Carousell), each targeting 100–150 listings/day, while the
  owner moves to managing/monitoring and handling sales.
- **Next milestone:** First VA live and sustaining 100 listings/day.

---

## 4. System overview (context, not the focus of this review)

A single-file web app (`work.html`) hosted on Vercel, backed by a Supabase Postgres
database. The owner logs in with email/password; VAs use a personal link with no
login. AI (Claude) generates listing titles and descriptions automatically at scrape
time. A browser bookmarklet scrapes Shopee product pages into the app.

The owner's app has four views: a daily upload queue (FIX), a new-listing intake
from scrapes (NEW), a sales log (SALES), and a full listing catalog (LISTINGS). A
new WORKERS view is being added for the owner to create VAs, assign listings, and
monitor progress/warnings.

*(Full technical spec is in VA-PLAN.md in the repo if needed — omitted here since
it's not the subject of this review.)*

---

## 5. The workflow — owner and VA roles

| Action | Owner | VA |
|---|---|---|
| Source products (browse Shopee, decide what to list) | Optional | Primary job |
| Create listing records | Yes | Never (automatic) |
| Generate title + description | Automatic | Never (auto-generated for them) |
| Upload to Carousell (copy-paste + post) | Optional | Primary job |
| Mark listing done | Yes | Yes |
| See source cost / margin | Yes | Never |
| Log sales / revenue | Yes | Never |
| Delete listings | Yes | Never |
| Respond to Carousell buyer messages | Yes | Never (SOP) |

**VA daily loop (target: 150 listings/day per the current SOP, 100/day in the
original spec — see note below):**

1. Browse shopee.sg, find a product matching the sourcing rules (§6)
2. Click a personal bookmarklet on the product page
3. ~10 seconds later, the product appears on the VA's work page with an
   AI-generated title, description, and calculated sell price already filled in
4. VA copies the title and description into a new Carousell listing
5. VA downloads the product images, **removes watermarks/logos at
   cleanup.pictures**, uploads the cleaned images to Carousell
6. VA publishes the Carousell listing, pastes the live listing link back into the
   app, and taps Done — daily counter increments, next item loads
7. Repeat

**Note — target inconsistency:** VA-PLAN.md (the system spec) states a target of
**100 listings/day**; VA-SOP.md (the doc actually handed to VAs) states **150/day**.
Worth flagging to the analyst as something to reconcile.

---

## 6. Sourcing rules given to VAs

VAs are told to pick products matching **all** of the following. Only the price
band is actually enforced by the software (as a soft warning); category, seller
location, and rating are manual judgment calls the VA is trusted to apply — the app
gives no warning if they're wrong.

| Rule | Requirement | Enforced by app? |
|---|---|---|
| Category | Furniture, home & living, storage, appliances, tools, garden/outdoors only | No — manual |
| Price (Shopee cost) | S$15–150, sweet spot $20–80 | **Yes** — soft warning outside range |
| Seller location | Singapore only | No — manual |
| Rating | 4.0★ or higher | No — manual |
| Duplicate | Same Shopee URL not already listed | **Yes** — hard block |

Excluded categories: branded/designer items (counterfeit risk), fragile items,
food/perishables/supplements/skincare, oversized/heavy items, electronics with
warranty concerns, anything restricted on Carousell (weapons, vapes, medical,
adult, copyrighted).

Note the design choice: category, seller-location, and rating checks were
originally going to be automated (the app spec still describes them as automatic
"soft warnings"), but the live SOP handed to VAs says the app does **not** check
these — only price is checked — and VAs must self-police the rest. This is worth
the analyst's attention: it puts real listing-quality control entirely on VA
judgment and manager spot-checks, with no system-level backstop or logging of how
often VAs get it wrong.

---

## 7. Known issues / open risks (flagged internally, not yet resolved)

1. **Carousell multi-IP risk.** The owner ran 200 listings/day solo with no
   account issues, but multiple VAs logging into one shared Carousell account from
   different devices/IPs is untested and could trigger Carousell's account-sharing
   fraud detection (rolled out Jan 2026). Plan is to onboard one VA at moderate
   pace first and watch for CAPTCHAs/warnings/listing removals before scaling.
2. **Sales attribution gap.** Sales are currently logged by listing title, not by a
   listing ID, so there's no way to trace a sale back to the specific listing (and
   therefore the VA) that sourced it. Without this, the dashboard can reward VAs
   who hit volume targets with low-converting/junk listings and miss VAs who post
   fewer but better-converting items.
3. **Price-band false positives.** A miscategorized cheap item (e.g., a $15 plastic
   organizer tagged as "Storage & Organisation") can pass the category check and
   still get marked up like furniture — a soft cost-based guard ($15 floor / $150
   ceiling) is planned but not yet tuned against real sales data.
4. **No fuzzy duplicate detection.** Only exact Shopee URL matches are blocked.
   Sellers who relist the same physical item under a new listing ID (common
   practice to reset review counts) aren't caught.
5. **No override logging.** When a VA proceeds past a soft warning, the system
   doesn't yet record whether they overrode it or skipped the item — so there's no
   data yet on whether the warnings are well-calibrated or just noise VAs ignore.
6. **Manual quality control has no logging.** As noted in §6, category/seller/
   rating checks are entirely manual and unverified — no system record exists of
   how often VAs source outside the guidelines.

---

## 8. Questions for the analyst

- Does the unit economics model ($24+ minimum margin, 15% conversion assumption,
  3–4 sales/day target) hold up, or are the assumptions (especially conversion
  rate) unrealistic for this category/price point given only $30 in actual revenue
  so far?
- Is hiring VAs to scale listing volume the right lever, or is the real constraint
  conversion rate / demand rather than supply of listings?
- Any restructuring of the sourcing rules, pricing formula, or VA incentive/target
  structure that would reduce risk (Carousell account bans, wasted VA effort on
  non-converting listings) or improve throughput?
- Should the 100 vs. 150 listings/day target discrepancy be resolved, and if so,
  which number is realistic given quality-over-speed goals?
