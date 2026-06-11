# Client-side scrapers — bookmarklets + phone shortcut

Everything here runs in **your own browser** (or phone), rides your real
session/IP, and drops results into the Supabase `scrape_inbox` table.
work.html pulls them in with the **⬇ Pull scraped** button (NEW and FIX tabs).

One-time prerequisite: run `supabase/scrape_inbox.sql` in the Supabase SQL
editor (Dashboard → SQL Editor → paste → Run).

## How to install a bookmarklet (laptop, any browser)

1. Show the bookmarks bar (Ctrl+Shift+B in Chrome/Edge).
2. Right-click the bar → *Add page…* (Chrome) / *Add bookmark*.
3. Name it (e.g. `Shopee → Work`), and paste the entire one-line
   `javascript:…` snippet below as the **URL**.
4. Done. Click it while on the matching page.

> If clicking does nothing, the browser may have stripped the `javascript:`
> prefix when pasting — retype `javascript:` manually at the front.

---

## 1. Shopee product grab (`Shopee → Work`)

Use on: any `shopee.sg` product page (logged in or not — your browser session
carries you through Cloudflare either way).

Gets: title, description, **price**, full-res images, sold, stock.

```
javascript:(async()=>{const K='sb_publishable_jvJXUrcqtFYroCF6tBNrsw_9hqAODjr';const m=location.href.match(/i\.(\d+)\.(\d+)/)||location.href.match(/\/product\/(\d+)\/(\d+)/);if(!m){alert('Not a Shopee product page');return}try{const r=await fetch('https://shopee.sg/api/v4/item/get?itemid='+m[2]+'&shopid='+m[1],{credentials:'include',headers:{'x-api-source':'pc','x-requested-with':'XMLHttpRequest'}});const d=await r.json();const it=d.item||(d.data&&(d.data.item||d.data));if(!it||!it.name)throw new Error('Shopee returned no item (try refreshing the page)');const p={title:it.name,description:it.description||'',price_min:(it.price_min||it.price||0)/1e5,price_max:(it.price_max||it.price||0)/1e5,images:(it.images||[]).map(h=>'https://down-sg.img.susercontent.com/file/'+h),sold:it.historical_sold||it.sold||0,stock:it.stock||0,url:location.href.split('?')[0]};const s=await fetch('https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/scrape_inbox',{method:'POST',headers:{apikey:K,Authorization:'Bearer '+K,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({kind:'shopee',payload:p})});if(!s.ok)throw new Error('Supabase '+s.status);const t=document.createElement('div');t.textContent='✓ Sent to work.html — $'+p.price_min.toFixed(2)+' · '+p.images.length+' imgs';t.style.cssText='position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;font:600 14px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';document.body.appendChild(t);setTimeout(()=>t.remove(),3000)}catch(e){alert('Scrape failed: '+e.message)}})();
```

Workflow: on product page → click bookmark → green "✓ Sent" toast → in
work.html NEW (or FIX) tab hit **⬇ Pull scraped**.

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
