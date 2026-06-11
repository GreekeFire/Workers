# Client-side scrapers — bookmarklets + phone shortcut

Everything here runs in **your own browser** (or phone), rides your real
session/IP, and drops results into the Supabase `scrape_inbox` table.
work.html pulls them in with the **⬇ Pull scraped** button (NEW and FIX tabs).

One-time prerequisite: run `supabase/scrape_inbox.sql` in the Supabase SQL
editor (Dashboard → SQL Editor → paste → Run). *(Done 2026-06-11.)*

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

## 1. Shopee product grab (`Shopee → Work`) — v2, batch + variant prices

Use on: **any** `shopee.sg` page (product page, homepage, search — doesn't
matter; the API call is same-origin from anywhere on the site).

Click it → a box appears on the page (prefilled with the current product's
link if you're on one) → paste one or many Shopee links, one per line →
**Send**. Each product is fetched via the v4 API with your session and pushed
to the inbox, spaced ~1s apart.

Gets per product: title, description, **price (incl. every variant's exact
price)**, full-res images, sold, stock.

```
javascript:(()=>{const K='sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';const cur=location.href.match(/i\.\d+\.\d+/)?location.href.split('?')[0]:'';const w=document.createElement('div');w.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;background:#111827;color:#fff;padding:16px;border-radius:12px;font:13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.5);width:min(480px,90vw)';w.innerHTML='<b>Send to work.html</b><br><textarea id=whx rows=5 style="width:100%;margin:8px 0;background:#1f2937;color:#fff;border:1px solid #374151;border-radius:8px;padding:8px;font:12px monospace;box-sizing:border-box" placeholder="One Shopee link per line"></textarea><div style="display:flex;gap:8px;justify-content:flex-end"><button id=whc style="padding:6px 14px;border-radius:8px;border:1px solid #374151;background:none;color:#9ca3af;cursor:pointer">Cancel</button><button id=whg style="padding:6px 14px;border-radius:8px;border:0;background:#16a34a;color:#fff;font-weight:700;cursor:pointer">Send</button></div><div id=whs style="margin-top:8px;color:#9ca3af"></div>';document.body.appendChild(w);const ta=w.querySelector('#whx');ta.value=cur;w.querySelector('#whc').onclick=()=>w.remove();w.querySelector('#whg').onclick=async()=>{const st=w.querySelector('#whs');const links=ta.value.split(/\s+/).filter(Boolean);if(!links.length){st.textContent='No links';return}let ok=0,fail=0;for(let i=0;i<links.length;i++){const m=links[i].match(/i\.(\d+)\.(\d+)/)||links[i].match(/\/product\/(\d+)\/(\d+)/);st.textContent='Fetching '+(i+1)+'/'+links.length+'…';if(!m){fail++;continue}try{const r=await fetch('https://shopee.sg/api/v4/item/get?itemid='+m[2]+'&shopid='+m[1],{credentials:'include',headers:{'x-api-source':'pc','x-requested-with':'XMLHttpRequest'}});const d=await r.json();const it=d.item||(d.data&&(d.data.item||d.data));if(!it||!it.name)throw 0;const p={title:it.name,description:it.description||'',price_min:(it.price_min||it.price||0)/1e5,price_max:(it.price_max||it.price||0)/1e5,models:(it.models||[]).map(x=>({name:x.name,price:(x.price||0)/1e5})).filter(x=>x.price>0),images:(it.images||[]).map(h=>'https://down-sg.img.susercontent.com/file/'+h),sold:it.historical_sold||it.sold||0,stock:it.stock||0,url:links[i].split('?')[0]};const s=await fetch('https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox',{method:'POST',headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({kind:'shopee',payload:p})});if(!s.ok)throw 0;ok++}catch(e){fail++}if(i<links.length-1)await new Promise(r=>setTimeout(r,900+Math.random()*600))}st.innerHTML='<b style=color:#4ade80>✓ '+ok+' sent</b>'+(fail?' · <span style=color:#f87171>'+fail+' failed — solve the bot check on any product page, then retry those links</span>':'');setTimeout(()=>w.remove(),fail?6000:2500)};})();
```

Workflow: click bookmark anywhere on Shopee → paste links → Send → open
work.html NEW tab — it auto-pulls. One link fills the form (with a variant
price picker when prices differ); several links flow into the batch generator.

Note: paste full `shopee.sg` links (short `sg.shp.ee` links can't be resolved
from inside the browser — open them first, then copy the full URL).

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

## 4. Phone — Shopee share-sheet shortcut (Android, HTTP Shortcuts app)

Install **HTTP Shortcuts** (free, Play Store: `ch.rmy.android.http_shortcuts`).

Create a shortcut:

1. **+ → Regular shortcut**, name `Shopee → Work`.
2. **Method:** GET — but we need scripting, so instead set the shortcut type
   to *Scripting shortcut* and paste:

```js
const url = getClipboardContent() || '';
const m = url.match(/i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
if (!m) { showToast('No Shopee link in clipboard'); abort(); }
const r = sendHttpRequest('https://shopee.sg/api/v4/item/get?itemid=' + m[2] + '&shopid=' + m[1], {
  method: 'GET',
  headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/124 Mobile Safari/537.36',
             'x-api-source': 'pc', 'referer': 'https://shopee.sg/' }
});
const d = JSON.parse(r.body); const it = d.item || (d.data && (d.data.item || d.data));
if (!it || !it.name) { showToast('Shopee blocked or empty'); abort(); }
const K = 'sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';
sendHttpRequest('https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox', {
  method: 'POST',
  headers: { 'apikey': K, 'Authorization': 'Bearer ' + K, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
  body: JSON.stringify({ kind: 'shopee', payload: {
    title: it.name, description: it.description || '',
    price_min: (it.price_min || it.price || 0) / 100000,
    price_max: (it.price_max || it.price || 0) / 100000,
    images: (it.images || []).map(h => 'https://down-sg.img.susercontent.com/file/' + h),
    sold: it.historical_sold || it.sold || 0, stock: it.stock || 0, url: url
  }})
});
showToast('✓ Sent to work.html — $' + ((it.price_min || it.price || 0) / 100000).toFixed(2));
```

3. In the shortcut's **Trigger & Usage** settings, enable
   **"Allow Share…"** (Direct Share / share-sheet target) — text shares.

Workflow: Shopee app → Share → `Shopee → Work` (or Copy Link then tap the
shortcut) → open work.html → **⬇ Pull scraped**.

> Validate first: open `https://shopee.sg/api/v4/item/get?itemid=…&shopid=…`
> in your phone browser on mobile data. If you see JSON, the shortcut will
> work; if you see a challenge page, the phone path needs cookies and we
> rethink (the laptop bookmarklet is unaffected either way).

iOS equivalent: Shortcuts.app → "Get Contents of URL" twice (Shopee GET, then
Supabase POST) with the same headers/body; accept share-sheet input of type URL.
