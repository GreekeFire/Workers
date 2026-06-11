# Client-side scrapers — bookmarklets + phone shortcut

Everything here runs in **your own browser** (or phone), rides your real
session/IP, and drops results into the Supabase `scrape_inbox` table.
work.html pulls them in with the **⬇ Pull scraped** button (NEW and FIX tabs).

One-time prerequisite: run `supabase/scrape_inbox.sql` in the Supabase SQL
editor (Dashboard → SQL Editor → paste → Run). *(Done 2026-06-11.)*

---

## How it all fits together (read this first)

```
  Shopee product page (your logged-in browser)
        │  click the Shopee → Work bookmark
        ▼
  sc.js (hosted loader target)
        │  reads window.dataLayer  ──► ·page  (no request, NO bot puzzle)
        │  └ if not ready, falls back to v4 fetch ──► ·api (puzzle possible)
        ▼
  Supabase  scrape_inbox  (kind:'shopee', payload:{title,description,
        │                   price_min/max, models[], images[], sold, stock, url})
        ▼
  work.html
    NEW tab  → auto-pulls on open; 1 item fills the form, several → batch cards
    FIX tab  → pull matches the inbox row to the CURRENT listing by Shopee URL,
               refreshes cost from the live price, auto-pulls on open + after Done
```

**Two data sources, picked automatically (see `sc.js`):**

- **dataLayer read (`·page`, preferred).** On a product page, Shopee has already
  fetched the full item with its own *signed* request and stashed it in
  `window.dataLayer` (its Google-Analytics array). We just read that variable —
  no request of ours, so nothing for Shopee's bot check to challenge. Gives the
  complete item: title, description, all variant prices, full-res images.
- **v4 API fetch (`·api`, fallback).** `fetch(shopee.sg/api/v4/item/get…)` with
  your session cookies. Used when dataLayer isn't populated yet, and **always**
  for paste-box links (those products aren't loaded in your page, so they're not
  in dataLayer). This is the path that occasionally triggers the bot puzzle.

**Practical upshot:** batching by **opening each product in a tab and clicking
the bookmark** is fully puzzle-free (every click reads dataLayer). The paste-box
(paste a list of links at once) uses the API and can still hit a puzzle.

Prices are the variant **`price` after the seller's product discount** — the
guaranteed price every buyer pays. Stackable platform/shop *vouchers* (min-spend,
limited claims) are deliberately NOT included; costing off the higher pre-voucher
price keeps your margin safe.

### What changed (2026-06-11 rework)

| Piece | Change |
|---|---|
| `sc.js` (new) | Hosted scraper body; **dataLayer-first**, v4 fallback. One file, all devices. |
| Loader bookmarklet | Tiny `fetch(sc.js)+eval` bookmark — paste-safe, auto-updates from `sc.js`. |
| `supabase/scrape_inbox.sql` (new) | Relay table; RLS allows anon insert/select/update (no `to anon` — publishable key). |
| `api/shopee.js` | Added v4 retry before og-scrape; `?resolve=1` expands `sg.shp.ee` short links. |
| `api/ingest.js` (new) | Accepts raw v4 JSON a phone fetched (with cookies) → reshapes → inserts inbox row. |
| `work.html` NEW | ⬇ Pull + auto-pull on tab open; 1→form, many→batch cards (each a full mini-form). |
| `work.html` FIX | ⬇ Pull **matches inbox row to the current listing by Shopee URL**; refreshes cost + warns on change; auto-pulls on open and after each Done/Delete. |
| Cost logic | Defaults to the **highest** variant price (margin-safe); no variant picker. |

## Roadmap: removing the bookmark press entirely

The bookmark click exists because browsers won't run your code on Shopee's
pages without something you installed triggering it. Three upgrade paths,
status as of 2026-06-11 — **not built yet**, planned:

| Device | Path | Setup (once) | Result |
|---|---|---|---|
| Laptop (Zen/Firefox/Chrome) | **Userscript with floating button** via Violentmonkey/Tampermonkey | Install extension → New script → paste → save | Every Shopee product page gets a "→ Work" button injected in the corner. One click sends the item (no bookmarks bar). Long-term replacement for the bookmarklet. |
| iPhone, from the Shopee app | **iOS Shortcuts share-sheet target** (section 4-equivalent for iOS) | Shortcuts.app: "Get Contents of URL" ×2 (Shopee v4 GET → Supabase POST), accept URLs from share sheet | Share → tap shortcut → sent. Fewest taps possible from the app. |
| iPhone, browsing in Safari | **Userscripts app** (free, App Store) running the same floating-button script | Install app → enable in Safari Settings → Extensions → paste script | Same floating button as laptop, in Safari. |

Interim zero-install trick (works today in Zen): edit the bookmark and give it
a **keyword** like `ss` — then on any Shopee page: Ctrl+L, type `ss`, Enter.

Deliberately NOT doing: fully-automatic scraping of every product page you
visit (no button at all). It works, but fills the inbox with everything you
browse and auto-pull would burn AI generations on items you never meant to
list.

## How to install a bookmarklet (laptop, any browser)

1. Show the bookmarks bar (Ctrl+Shift+B in Chrome/Edge).
2. Right-click the bar → *Add page…* (Chrome) / *Add bookmark*.
3. Name it (e.g. `Shopee → Work`), and paste the entire one-line
   `javascript:…` snippet below as the **URL**.
4. Done. Click it while on the matching page.

> If clicking does nothing, the browser may have stripped the `javascript:`
> prefix when pasting — retype `javascript:` manually at the front.

---

## 1. Shopee product grab (`Shopee → Work`) — loader (recommended)

**Use this on every device** (laptop Zen/Chrome/Firefox, iPhone Safari, Android
Firefox). It's a tiny bookmark that loads the real scraper from `sc.js` on the
Vercel app, so:

- it's short enough to paste into an iOS bookmark without corruption, and
- when the scraper is fixed/improved, edit `sc.js` once and **every device picks
  it up on next click** — never re-paste the bookmark again.

On a product page it reads `window.dataLayer` first (puzzle-free, toast shows
`·page`); if that isn't ready it falls back to the v4 fetch using your session
cookies (toast shows `·api`). Either way no cookie copying. If it ever fails
because you're logged out, just log back into shopee.sg in that browser — no
laptop/DevTools needed.

Bookmark URL (paste as the whole URL; must keep the `javascript:` prefix):

```
javascript:fetch('https://workers-v1.vercel.app/sc.js').then(r=>r.text()).then(t=>(0,eval)(t)).catch(e=>alert('load '+e))
```

iPhone: browse Shopee **in Safari** (logged in), or in the Shopee app use
**Share → Open in Safari** to reach a product, then run the bookmark from the
Bookmarks list. The app's own login does not carry into Safari, so log into
shopee.sg in Safari once.

> One risk specific to the loader: if Shopee ever adds a Content-Security-Policy
> that blocks externally-loaded code, the loader stops working. Hasn't happened;
> fallback is the Userscripts app (iOS) / Violentmonkey (Android Firefox)
> running the same `sc.js` body, which isn't subject to that block.

The behaviour (`sc.js`) is identical to the inline snippet below: instant send on
a product page, paste-box anywhere else on Shopee, highest-variant price, short
`sg.shp.ee` link support.

---

## 1b. Inline snippet (fallback, no hosting dependency) — v2, batch + variant prices

Use this only if the loader is blocked or you want a self-contained bookmark
with no dependency on `sc.js`. Downside: it's 2KB, so iOS bookmarks may corrupt
it on paste, and fixes require re-pasting on every device.

Use on: **any** `shopee.sg` page.

- **On a product page:** one click sends that product immediately — no box,
  just the green toast. Click your way through several tabs to queue a batch.
- **Anywhere else on Shopee** (homepage, search): a box appears — paste one
  or many links, one per line → **Send**. Fetched ~1s apart.

Gets per product: title, description, **price (incl. every variant's exact
price)**, full-res images, sold, stock.

```
javascript:(async()=>{const K='sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';const send=async L=>{if(/shp\.ee/.test(L)){try{const rr=await fetch('https://workers-v1.vercel.app/api/shopee?url='+encodeURIComponent(L)+'&resolve=1');L=(await rr.json()).url||L}catch(e){}}const m=L.match(/i\.(\d+)\.(\d+)/)||L.match(/\/product\/(\d+)\/(\d+)/);if(!m)throw new Error('not a product link');const r=await fetch('https://shopee.sg/api/v4/item/get?itemid='+m[2]+'&shopid='+m[1],{credentials:'include',headers:{'x-api-source':'pc','x-requested-with':'XMLHttpRequest'}});const d=await r.json();const it=d.item||(d.data&&(d.data.item||d.data));if(!it||!it.name)throw new Error('Shopee returned no item — solve the bot check, retry');const p={title:it.name,description:it.description||'',price_min:(it.price_min||it.price||0)/1e5,price_max:(it.price_max||it.price||0)/1e5,models:(it.models||[]).map(x=>({name:x.name,price:(x.price||0)/1e5})).filter(x=>x.price>0),images:(it.images||[]).map(h=>'https://down-sg.img.susercontent.com/file/'+h),sold:it.historical_sold||it.sold||0,stock:it.stock||0,url:L.split('?')[0]};const s=await fetch('https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox',{method:'POST',headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({kind:'shopee',payload:p})});if(!s.ok)throw new Error('Supabase '+s.status);return p};const note=(msg,bad)=>{const t=document.createElement('div');t.textContent=msg;t.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999999;background:'+(bad?'#dc2626':'#16a34a')+';color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';document.body.appendChild(t);setTimeout(()=>t.remove(),3500)};const cur=location.href.match(/i\.\d+\.\d+/)?location.href.split('?')[0]:'';if(cur){try{const p=await send(cur);note('✓ Sent — $'+Math.max(p.price_max,p.price_min,0,...p.models.map(x=>x.price)).toFixed(2)+' · '+p.images.length+' imgs')}catch(e){note('✗ '+e.message,1)}return}const w=document.createElement('div');w.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;background:#111827;color:#fff;padding:16px;border-radius:12px;font:13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.5);width:min(480px,90vw)';w.innerHTML='<b>Send to work.html</b><br><textarea id=whx rows=5 style="width:100%;margin:8px 0;background:#1f2937;color:#fff;border:1px solid #374151;border-radius:8px;padding:8px;font:12px monospace;box-sizing:border-box" placeholder="One Shopee link per line"></textarea><div style="display:flex;gap:8px;justify-content:flex-end"><button id=whc style="padding:6px 14px;border-radius:8px;border:1px solid #374151;background:none;color:#9ca3af;cursor:pointer">Cancel</button><button id=whg style="padding:6px 14px;border-radius:8px;border:0;background:#16a34a;color:#fff;font-weight:700;cursor:pointer">Send</button></div><div id=whs style="margin-top:8px;color:#9ca3af"></div>';document.body.appendChild(w);const ta=w.querySelector('#whx');w.querySelector('#whc').onclick=()=>w.remove();w.querySelector('#whg').onclick=async()=>{const st=w.querySelector('#whs');const links=ta.value.split(/\s+/).filter(Boolean);if(!links.length){st.textContent='No links';return}let ok=0,fail=0;for(let i=0;i<links.length;i++){st.textContent='Fetching '+(i+1)+'/'+links.length+'…';try{await send(links[i]);ok++}catch(e){fail++}if(i<links.length-1)await new Promise(r=>setTimeout(r,900+Math.random()*600))}st.innerHTML='<b style=color:#4ade80>✓ '+ok+' sent</b>'+(fail?' · <span style=color:#f87171>'+fail+' failed — solve the bot check on any product page, then retry those links</span>':'');setTimeout(()=>w.remove(),fail?6000:2500)};})();
```

Workflow: click bookmark anywhere on Shopee → paste links → Send → open
work.html NEW tab — it auto-pulls. One link fills the form (with a variant
price picker when prices differ); several links flow into the batch generator.

Short `sg.shp.ee` links are supported: the bookmarklet expands them through
`/api/shopee?resolve=1` on the Vercel app first. (Works once the resolve
endpoint is live on production — until the merge, paste full links.)

---

## 2. Carousell competitor check (`Caro → Compete`)

Use on: a **Carousell search results page** (search for the item you're about
to list). Read-only — touches nothing in your account.

Shows an overlay with competitor count, min / median price, and a suggested
undercut price. It asks for your **cost** first so it can warn when the
undercut would break the margin floor (`max(cost×1.5, cost+24)`, rounded up to
the next $5 − 10¢ — same as work.html's calculator). Also snapshots the
results to `scrape_inbox` (`kind:'carousell'`).

```
javascript:(async()=>{const K='sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';const out=[];const seen=new Set();const walk=o=>{if(!o||typeof o!=='object')return;if(o.title&&(o.price||o.priceFormatted||o.price_formatted)){const raw=String(o.price||o.priceFormatted||o.price_formatted);const pm=raw.match(/[\d,.]+/);if(pm){const price=parseFloat(pm[0].replace(/,/g,''));const key=o.title+'|'+price;if(price>0&&!seen.has(key)){seen.add(key);out.push({title:String(o.title).slice(0,90),price})}}}for(const k in o)walk(o[k])};const nd=document.getElementById('__NEXT_DATA__');if(nd){try{walk(JSON.parse(nd.textContent))}catch(e){}}if(!out.length){document.querySelectorAll('a[href*="/p/"]').forEach(a=>{const txt=a.innerText||'';const pm=txt.match(/S?\$\s?([\d,.]+)/);const title=(txt.split('\n').find(l=>l.length>10)||'').slice(0,90);if(pm&&title){const price=parseFloat(pm[1].replace(/,/g,''));const key=title+'|'+price;if(price>0&&!seen.has(key)){seen.add(key);out.push({title,price})}}})}if(!out.length){alert('No listings found on this page — are you on a Carousell search results page?');return}const prices=out.map(x=>x.price).sort((a,b)=>a-b);const min=prices[0];const med=prices[Math.floor(prices.length/2)];const cost=parseFloat(prompt('Your cost (SGD)? — leave blank to skip margin check')||'0')||0;const floor=cost?Math.ceil(Math.max(cost*1.5,cost+24)/5)*5-0.1:0;let suggest=Math.max(min-1,0);let warn='';if(cost&&suggest<floor){warn='⚠ Undercut $'+suggest.toFixed(2)+' breaks your floor — use $'+floor.toFixed(2);suggest=floor}try{await fetch('https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox',{method:'POST',headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({kind:'carousell',payload:{query:location.href,count:out.length,min,median:med,suggest,cost,listings:out.slice(0,30)}})})}catch(e){}const d=document.createElement('div');d.style.cssText='position:fixed;top:16px;right:16px;z-index:99999;background:#111827;color:#fff;padding:16px 20px;border-radius:12px;font:13px/1.6 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.45);max-width:300px';d.innerHTML='<b style=font-size:15px>'+out.length+' competitors</b><br>Min $'+min.toFixed(2)+' · Median $'+med.toFixed(2)+'<br><b style=color:#4ade80;font-size:16px>Suggested: $'+suggest.toFixed(2)+'</b>'+(warn?'<br><span style=color:#fbbf24>'+warn+'</span>':'')+'<br><span style=color:#9ca3af;font-size:11px>click to close · snapshot saved</span>';d.onclick=()=>d.remove();document.body.appendChild(d)})();
```

> Carousell changes its page internals occasionally. This reads
> `__NEXT_DATA__` first and falls back to visible listing cards; if it ever
> reports "No listings found" on a real results page, tell Claude and we
> re-point the extractor.

---

## 3. Carousell chat capture (`Caro → Chats`) — read-only

Use on: your **Carousell inbox** page (the chat list). Strictly read-only: it
reads the conversation list off the page, sends nothing, clicks nothing.
Feeds the follow-up workflow.

```
javascript:(async()=>{const K='sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';const rows=[];document.querySelectorAll('a[href*="/inbox/"], [class*="inbox"] a, [data-testid*="chat"]').forEach(a=>{const t=(a.innerText||'').trim();if(!t||t.length<3)return;const lines=t.split('\n').map(s=>s.trim()).filter(Boolean);if(lines.length<2)return;rows.push({user:lines[0].slice(0,60),snippet:lines.slice(1,4).join(' · ').slice(0,160),href:a.href})});const uniq=[];const seen=new Set();for(const r of rows){if(seen.has(r.href))continue;seen.add(r.href);uniq.push(r)}if(!uniq.length){alert('No chats found — are you on the Carousell inbox page?');return}try{const s=await fetch('https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox',{method:'POST',headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({kind:'chats',payload:{captured_at:new Date().toISOString(),chats:uniq.slice(0,50)}})});if(!s.ok)throw new Error('Supabase '+s.status);const t=document.createElement('div');t.textContent='✓ '+uniq.length+' chats captured (read-only)';t.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';document.body.appendChild(t);setTimeout(()=>t.remove(),3000)}catch(e){alert('Capture failed: '+e.message)}})();
```

Risk note: this reads your logged-in seller session. Keep it manual and
occasional (e.g. once or twice a day) — never automate it.

---

## 4. Phone — in-app share-sheet shortcut (iOS + Android)

Lets you stay in the **Shopee app**: Share → the shortcut → done. The catch:
Shopee blocks logged-out API calls (`is_login:false`, `error:90309999`), so the
shortcut must send your **session cookies**. Cookies expire every few weeks —
when scrapes start failing, redo Part 1.

The shortcut only has to GET the raw v4 JSON (this must happen on the phone, on
your residential IP) and POST it to **`/api/ingest`**, which reshapes it and
inserts the inbox row. No JSON wrangling inside the shortcut.

### Part 1 — Copy your Shopee cookies (laptop, redo when expired)

1. Laptop browser → log into **shopee.sg**.
2. **F12 → Network** tab → reload → filter `item/get` (or click any
   `shopee.sg` request).
3. Click it → **Headers → Request Headers** → find `Cookie:`.
4. Copy the **whole** value after `Cookie: ` (long; starts `SPC_F=…; SPC_EC=…`).
5. Send it to your phone (AirDrop / message) to paste in Part 2.

### Part 2a — iOS (Shortcuts.app)

New shortcut, add actions in order:

1. **Text** → paste the full cookie string. *(This is the only thing you edit on
   cookie refresh.)*
2. **Match Text** — Input **Shortcut Input**, Regex `i\.\d+\.\d+`.
3. **Get Item from List** — **First Item** (of *Matches*) → e.g. `i.123.456`.
4. **Split Text** — Input the item above, Separator **Custom** `.`.
5. **Text** →
   `https://shopee.sg/api/v4/item/get?shopid=⟨Split Text → Item at Index 2⟩&itemid=⟨Split Text → Item at Index 3⟩`
   (insert the two list items via the variable picker).
6. **Get Contents of URL** — URL = the Text above, Method **GET**, Headers:
   - `Cookie` = the **Text** from step 1
   - `x-api-source` = `pc`
   - `x-requested-with` = `XMLHttpRequest`
   - `User-Agent` = `Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1`
7. **Get Contents of URL** — URL
   `https://workers-v1.vercel.app/api/ingest?url=⟨Shortcut Input⟩`,
   Method **POST**, Request Body **File** = *Contents of URL* (step 6),
   Header `Content-Type` = `application/json`.
8. **Show Notification** = *Contents of URL* (step 7) — shows `{"ok":true,…}` or
   the error.

In the shortcut settings (ⓘ): enable **Show in Share Sheet**, accept **URLs**.

### Part 2b — Android (HTTP Shortcuts app)

Install **HTTP Shortcuts** (`ch.rmy.android.http_shortcuts`). New **Scripting
shortcut**, paste — replacing `PASTE_COOKIE_HERE`:

```js
const url = getClipboardContent() || '';
const m = url.match(/i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
if (!m) { showToast('No Shopee link in clipboard'); abort(); }
const r = sendHttpRequest('https://shopee.sg/api/v4/item/get?itemid=' + m[2] + '&shopid=' + m[1], {
  method: 'GET',
  headers: { 'cookie': 'PASTE_COOKIE_HERE',
             'x-api-source': 'pc', 'x-requested-with': 'XMLHttpRequest',
             'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/124 Mobile Safari/537.36' }
});
const g = sendHttpRequest('https://workers-v1.vercel.app/api/ingest?url=' + encodeURIComponent(url), {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: r.body
});
const o = JSON.parse(g.body);
showToast(o.ok ? ('✓ Sent — $' + o.price.toFixed(2)) : ('✗ ' + (o.error || 'failed')));
```

Enable **Allow Share** (Trigger & Usage) so it accepts shared text.

Workflow (both): Shopee app → **Share → Shopee → Work** → green/notification
confirms → open work.html, it pulls. If it says cookies expired, redo Part 1.

> Why `/api/ingest` and not Supabase directly: the endpoint does the price
> math, image-hash mapping, and payload shaping in JS so the shortcut stays a
> two-request stub. It never calls Shopee itself (the phone already did, with
> your cookies), so it isn't Cloudflare-blocked like the old server scraper.
