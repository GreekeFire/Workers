"""
Loads the competitor catalogue into work_queue.

  python load-work-queue.py --dry-run          # show what would go in, touch nothing
  python load-work-queue.py --top 577          # just the ranked rotation set
  python load-work-queue.py                    # the whole 12,626

Reads SUPABASE_SERVICE_ROLE_KEY from .env.local. Inserts with
Prefer: resolution=ignore-duplicates against the carousell_url unique index, so
re-running never duplicates and can safely resume after a failure.

Run supabase/migrations-phase5.sql first — this writes to work_queue.
"""
import csv, json, os, sys, urllib.request, urllib.error, argparse

HERE    = os.path.dirname(os.path.abspath(__file__))
VAULT   = r'C:\The Vault\Workers\1st Affiliate\research'
CATALOG = os.path.join(VAULT, 'catalog-full.csv')
RANKED  = os.path.join(VAULT, 'va-queue.csv')   # 577 rows carrying times_listed
PROJECT = 'tzwzmzabjmsocnxdtxqx'
BATCH   = 500

ap = argparse.ArgumentParser()
ap.add_argument('--catalog', default=CATALOG)
ap.add_argument('--ranked',  default=RANKED)
ap.add_argument('--top',     type=int, help='only the N highest-prominence rows')
ap.add_argument('--ranked-only', action='store_true',
                help='load just the 577 vetted rotation products (recommended '
                     'first load) instead of all 12,626 individual listings')
ap.add_argument('--source', default='closingdownsale',
                help="which competitor catalogue this CSV is (tags work_queue.source)")
ap.add_argument('--account', default='steadymart',
                help='which Carousell account this pass is for (phase 8). Must match '
                     'workers.account_name exactly or its VA sees an empty queue')
ap.add_argument('--dry-run', action='store_true')
args = ap.parse_args()


def service_key():
    path = os.path.join(HERE, '.env.local')
    if not os.path.exists(path):
        sys.exit('.env.local not found — need SUPABASE_SERVICE_ROLE_KEY')
    for line in open(path, encoding='utf-8'):
        if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
            return line.split('=', 1)[1].strip()
    sys.exit('SUPABASE_SERVICE_ROLE_KEY not in .env.local')


# ── build the rows ───────────────────────────────────────────────────────────
# times_listed lives only in the ranked file (577 rows). Every one of those URLs
# is present in the full catalogue, so joining on URL is exact — no title
# matching. Everything not in the ranked set is a one-off: prominence 1.
ranked = {}
if os.path.exists(args.ranked):
    for r in csv.DictReader(open(args.ranked, encoding='utf-8')):
        ranked[r['carousell_url']] = int(r['times_listed'])
print(f'ranked set: {len(ranked)} products carrying a times_listed')

rows, skipped = [], 0
for r in csv.DictReader(open(args.catalog, encoding='utf-8')):
    url = (r.get('carousell_url') or '').strip()
    title = (r.get('title') or '').strip()
    if not url or not title:
        skipped += 1
        continue

    images = [r.get('cover_image'), r.get('image_2'), r.get('image_3')]
    extra = (r.get('extra_images') or '').strip()
    if extra:
        images += [u for u in extra.replace(' ', '').split(',') if u]
    images = [u.strip() for u in images if u and u.strip()]

    try:
        price = round(float(r['price_sgd']), 2)
    except (TypeError, ValueError, KeyError):
        price = None

    rows.append({
        'source':        args.source,
        'account':       args.account,
        'carousell_url': url,
        'title':         title,
        'price_sgd':     price,
        'images':        images,
        'times_listed':  ranked.get(url, 1),
    })

# The full catalogue is one row per LISTING — he recycles title templates across
# 12,626 of them, so the same study table appears ~193 times at ~193 prices, and
# each row's price_sgd is that ONE listing's price, not the product's typical
# one. Collapsing them by exact title barely helps (12,254 titles are unique).
# The ranked file already did that work properly: 577 distinct products, each
# priced at the median across its group. So --ranked-only reads from there
# rather than trying to re-derive it.
if args.ranked_only:
    rows = [r for r in rows if r['carousell_url'] in ranked]
    by_url = {r['carousell_url']: r for r in
              csv.DictReader(open(args.ranked, encoding='utf-8'))}
    for r in rows:
        src = by_url[r['carousell_url']]
        try:
            r['price_sgd'] = round(float(src['price_sgd']), 2)   # group median
        except (TypeError, ValueError):
            pass
    print(f'--ranked-only: {len(rows)} vetted products (median-priced)')

# Best first, so a partial load still front-loads the proven products.
rows.sort(key=lambda x: -x['times_listed'])
if args.top:
    rows = rows[:args.top]

print(f'built {len(rows)} rows' + (f' ({skipped} skipped: no url/title)' if skipped else ''))
if rows:
    covered = sum(1 for x in rows if x['times_listed'] > 1)
    print(f'  {covered} carry real prominence, {len(rows) - covered} are one-offs (times_listed=1)')
    print(f'  no images on {sum(1 for x in rows if not x["images"])} rows')
    print('\n  first three:')
    for x in rows[:3]:
        line = f'    x{x["times_listed"]:<4} ${x["price_sgd"]:<8} {len(x["images"])} imgs  {x["title"][:58]}'
        # Titles carry CJK and emoji; a cp1252 console raises here and kills the
        # run before a single row is inserted.
        print(line.encode('ascii', 'replace').decode())

if args.dry_run:
    print('\n--dry-run: nothing written.')
    sys.exit(0)

# ── insert ───────────────────────────────────────────────────────────────────
KEY = service_key()
# on_conflict names the constraint to resolve against. Without it PostgREST only
# considers the primary key, so an existing row raises 23505 instead of being
# skipped — which breaks both reruns and resuming a partial load.
# Phase 8 replaced the unique on carousell_url with (carousell_url, account), so
# this must name both or PostgREST 42P10s: there is no single-column index to
# resolve against any more.
URL = (f'https://{PROJECT}.supabase.co/rest/v1/work_queue'
       '?on_conflict=carousell_url,account')
inserted = 0

for i in range(0, len(rows), BATCH):
    chunk = rows[i:i + BATCH]
    req = urllib.request.Request(
        URL,
        data=json.dumps(chunk).encode('utf-8'),
        headers={
            'apikey':        KEY,
            'Authorization': 'Bearer ' + KEY,
            'Content-Type':  'application/json',
            # Existing carousell_url -> skipped, not an error. Makes reruns safe.
            'Prefer':        'resolution=ignore-duplicates,return=minimal',
        },
        method='POST')
    try:
        urllib.request.urlopen(req, timeout=120).read()
        inserted += len(chunk)
        print(f'  {inserted}/{len(rows)}', end='\r', flush=True)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:400]
        sys.exit(f'\nHTTP {e.code} on rows {i}-{i + len(chunk)}: {body}')

print(f'\nloaded {inserted} rows into work_queue')
print('check: SELECT * FROM work_queue_stats;')
