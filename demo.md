# Demo — Listing Generator (client-facing)

Spec agreed 2026-06-10. Not built yet. The client wants **only the listing
creation flow** (NEW-tab style generate) — **no saving for now**.

## What it is

A single new page, `demo.html`, in this same Vercel project, served at an
unguessable path (e.g. `/demo-x7k2p9`). It is the NEW tab extracted: paste
product info → AI generates a Carousell title + description → copy out.

- **No Supabase at all** — no login, no listings table, no doneData, no sync.
  Zero persistence means the demo cannot touch real data even in principle.
- Reuses the existing serverless functions as-is: `/api/claude` (generation)
  and `/api/shopee` (URL fetch fallback).
- Reuses from work.html: `TITLE_SYSTEM` / `DESC_SYSTEM` prompts, `callClaude`,
  `runAIGenerate`, `normalizeDesc`, char counter (225), copy buttons, toast.
- Drops: FIX queue, SALES, LISTINGS tabs, done-tracking, extension bridge,
  service worker.
- Estimated size: ~300–400 lines, roughly half a day of work.

## Decisions (locked in)

| Decision | Choice |
|---|---|
| Access | **Passcode-locked** + unguessable URL |
| AI cost | **My server key by default** (Haiku-only, token-capped) so the client needs zero setup; optional "use your own API key" field as the long-term BYOK path that shifts cost to them |
| Input | **Paste product text first**, Shopee URL fetch secondary — clients don't have the Chrome extension (`ext/`), so they only get the weaker og-tag `/api/shopee` fallback, which can fail mid-demo |
| Branding | **Same dark look** as work.html |
| Upsell | **Disabled "Save to catalog — available in full version" button** as a teaser for the full product |

## Prerequisites before the URL is shared

1. **T1 — lock `/api/claude`** (mandatory). Today the endpoint is public,
   CORS `*`, and the request body can override `model` — anyone with the URL
   can run any model on my Anthropic credits. Fix server-side in
   `api/claude.js` (~15 lines):
   - allowlist `model` to Haiku only
   - cap `maxTokens`
   - require the demo passcode header (and/or check `Origin` against my domain)
2. **R1 — dedupe FIX/NEW generate flow** (optional). The demo is a third copy
   of the generate code; extracting one shared core first means prompt
   improvements land everywhere at once. Skip if the demo is short-lived.

## Later, if the client wants saving

Use a separate sandbox table (e.g. `demo_listings`) with its own open-ish
policies — never the real `listings` / `app_state` tables, which are locked
owner-only via RLS (auth required; see Supabase dashboard).

## Build order

T1 → (optionally R1) → `demo.html` → share passcode + URL with client.
