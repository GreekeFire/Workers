"""
Repoint the first 577 work_queue rows at their own listing's price.

They were loaded with --ranked-only, which takes price_sgd from va-queue.csv --
the MEDIAN across every listing sharing that title template. The other 12,049
rows carry each listing's own price. Two meanings in one column, and the median
is the wrong one: work_queue.images are one specific listing's photos, so the
price has to be that same listing's price or the pair is mismatched.

  python fix-577-prices.py --dry-run
  python fix-577-prices.py
"""
import csv, json, os, sys, urllib.request, urllib.parse, argparse

HERE    = os.path.dirname(os.path.abspath(__file__))
CATALOG = r'D:\The Vault\Workers\1st Affiliate\research\catalog-full.csv'
RANKED  = r'D:\The Vault\Workers\1st Affiliate\research\va-queue.csv'
REST    = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/'

ap = argparse.ArgumentParser()
ap.add_argument('--dry-run', action='store_true')
args = ap.parse_args()

KEY = None
for line in open(os.path.join(HERE, '.env.local'), encoding='utf-8'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}


def req(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer: h['Prefer'] = prefer
    r = urllib.request.Request(REST + path, headers=h, method=method,
                               data=json.dumps(body).encode() if body is not None else None)
    raw = urllib.request.urlopen(r, timeout=60).read()
    return json.loads(raw) if raw else None


true_price = {r['carousell_url']: r['price_sgd']
              for r in csv.DictReader(open(CATALOG, encoding='utf-8'))}
ranked = [r['carousell_url'] for r in csv.DictReader(open(RANKED, encoding='utf-8'))]
print(f'{len(ranked)} median-priced rows to check\n')

fixes = []
for url in ranked:
    want = true_price.get(url)
    if want is None:
        continue
    rows = req('GET', f'work_queue?select=id,price_sgd,title&carousell_url=eq.{urllib.parse.quote(url, safe="")}')
    if not rows:
        continue
    have = float(rows[0]['price_sgd'])
    if abs(have - float(want)) >= 0.01:
        fixes.append((rows[0]['id'], have, float(want), rows[0]['title'][:44]))

print(f'{len(fixes)} rows priced differently from their own listing')
for i, (_, have, want, t) in enumerate(sorted(fixes, key=lambda x: -abs(x[2] - x[1]))[:6]):
    print(f'   ${have:<8g} -> ${want:<8g}  {t}')

if args.dry_run:
    print('\n--dry-run: nothing written.')
    sys.exit(0)

for n, (qid, _, want, _) in enumerate(fixes, 1):
    req('PATCH', f'work_queue?id=eq.{qid}', {'price_sgd': want}, prefer='return=minimal')
    if n % 50 == 0:
        print(f'  {n}/{len(fixes)}', end='\r', flush=True)

print(f'\nrepriced {len(fixes)} rows')
