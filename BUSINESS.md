# Steadymart — Business Playbook

Carousell → Shopee dropshipping, Singapore. Source on Shopee SG, list on Carousell at a
markup, collect via PayNow, fulfil by ordering Shopee → the customer's address. No
inventory, no handling. Solo, during NS.

**Goal:** $2,000 net profit in June 2026. *The time-bound execution plan lives in [PLAN.md](PLAN.md); this doc is the stable "how the business works" reference.*

---

## The loop

1. Customer chats on Carousell.
2. Customer pays via **PayNow**.
3. **Re-check the Shopee checkout price**, then order to the **customer's address**.
4. Send thank-you + delivery expectation (2–3 working days).
5. Notify on dispatch.

Float buffer **≥$150–200** to cover refunds and Shopee orders that fail after you've been paid. If a Shopee item goes OOS after payment: source a near-identical item and ship it, or refund immediately — never ghost.

---

## Products & sourcing rules

- **Shopee SG only.**
- Lean toward **furniture / home items** — highest perceived value, widest margins — but **validate against real Carousell demand, don't assume** (see PLAN.md, demand-pull).
- **Minimum source cost: $15.** Below this rarely clears the margin floor.
- **Blacklist:** anything that can't clear the margin floor; cheap sub-$10 accessories (stickers, cleaners, etc.).
- **Re-check the Shopee checkout price at order time, every time** (remove vouchers/coins). The strikethrough price is not reliable; vouchers shift and can wipe margin.

---

## Pricing

**Margin rule — whichever is higher:** a flat **$24 profit/sale**, or **1.5× the Shopee checkout price**.

```js
function calcSell(cost) {
  return Math.ceil(Math.max(cost * 1.5, cost + 24) / 5) * 5 - 0.1;
}
```
Always resolves to a **`$X.90`** ending — the psychological anchor (buyers file $44.90 as "forty-something", not $45).

| Cost | Sell |
|---|---|
| $15 | $39.90 |
| $20 | $44.90 |
| $30 | $54.90 |
| $50 | $79.90 |

> ⚠️ **Doc vs. live code:** the live `work.html` `calcSell` currently **omits the `- 0.1`**, so it rounds to whole $5 ($15 → $40, not $39.90). If you want the `.90` anchor back, restore the `- 0.1` in the deployed function. (Flagged 2026-06-13.)

**Sweet spot:** high-perceived-value items under $20 that list for $40–50+.

**Overrides:**
- On high-cost items ($80+) the formula may price you above competitors — check manually, stay within ~$10–15 of the market price.
- On low-cost items ($15–20) the formula is conservative — if demand is strong, push toward competitor levels.

### Psychological pricing tricks
- **Anchor high** — "worth $X" / "retails at $X" in the description makes your price feel like a deal.
- **Odd specificity** — $47.90 reads as more calculated than $45.90.
- **Stay below round thresholds** — $79.90 files as "seventy-something".
- **Scarcity** — "last 2 available" / "limited stock".
- **Social proof** — "popular pick" / "bestseller on Shopee".
- **Problem-solution framing** — lead with the pain ("Tired of tangled cables?") not the product.

---

## Listings

- **Title format:** keyword-stuffed, pipe-separated `[Feature] + [Item Name] | …`, 200–225 chars.
- **Cover image:** clean, minimal branding, no watermarks (use cleanup.pictures if needed).
- **Vary listings** — mass near-identical posts read as "duplicate listings," a suspension trigger (see Risk).
- **Posting is manual, with app assist — never automated** (Carousell has no public listing API; automation is the highest-probability suspension cause).

---

## Customer communication

- **Tone:** direct, not desperate. Answer the question, then move to PayNow.
- **Follow-ups:** chat → +1 / +2 / +3 days for non-payers. Estimated to recover ~25–33% of profit (~$500–660 of the goal). Tracked in-app, sent manually.
- **Upsells:** after a sale, offer 1–2 complementary items.
- **Traffic:** 100% organic Carousell search (no ads, no bumping).

### Chat psychology
- **Assume the sale** — "What's your address for delivery?" skips the hesitation step.
- **Anchor before discounting** — if asked for a discount, pause; instant acceptance signals you had room all along.
- **Bundle** — after interest, "I also have X, both for $Z" lifts average order value.
- **Speed** — reply within minutes; Carousell buyers shop multiple sellers, first to respond often wins.

---

## Risk & money

- **Single account = single point of failure.** Suspension triggers: duplicate listings, repeated rule violations, automation, scraping your own logged-in seller session. Vary listings; never automate posting; keep any market research **off the seller session**.
- **Voucher/price shifts** (high frequency) — re-check checkout price at order time to protect margin.
- **Item OOS after payment** — refund or re-source; build it into the chat script.
- **Buyer disputes** — keep all comms on-platform, ship only to confirmed addresses. You own the customer experience even when Shopee mis-delivers.
