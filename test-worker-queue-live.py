"""
Exercises every RPC api/worker-queue.js makes, against the real Supabase, using
the exact calls supabase-js emits (POST /rest/v1/rpc/<fn> with named params).

Operates on synthetic rows tagged source='__endpoint_test__' with a very high
times_listed so claim_work reaches them first — the 577 real products are never
claimed, completed or rejected. Everything it creates is deleted at the end.

  python test-worker-queue-live.py
"""
import json, sys, urllib.request, urllib.error, os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/'
TAG  = '__endpoint_test__'

KEY = None
for line in open(os.path.join(HERE, '.env.local'), encoding='utf-8'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
if not KEY:
    sys.exit('SUPABASE_SERVICE_ROLE_KEY not in .env.local')

H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}


def call(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(BASE + path, headers=h, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        raw = urllib.request.urlopen(req, timeout=60).read()
        return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return {'__http_error__': e.code, 'body': e.read().decode('utf-8', 'replace')[:300]}


# supabase-js .rpc(name, params) is exactly this.
def rpc(name, params):
    return call('POST', 'rpc/' + name, params)


checks = []
def check(name, ok, detail=''):
    checks.append((name, ok))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (f'   {detail}' if detail else ''))


worker = call('GET', 'workers?select=id,name&limit=1')
if not worker or isinstance(worker, dict):
    sys.exit(f'could not read workers: {worker}')
WID = worker[0]['id']
OTHER = '00000000-0000-0000-0000-0000000000ff'
print(f"using worker {worker[0]['name']} ({WID[:8]}…)\n")

test_ids = []
try:
    # ── seed synthetic rows, ranked above everything real ─────────────────────
    seeded = call('POST', 'work_queue', [
        {'source': TAG, 'carousell_url': f'https://www.carousell.sg/p/{TAG}-{i}',
         'title': f'ENDPOINT TEST {i}', 'price_sgd': 10 + i,
         'images': ['https://example.test/x.jpg'], 'times_listed': 99999 - i}
        for i in range(3)
    ], prefer='return=representation')
    if isinstance(seeded, dict):
        sys.exit(f'seed failed: {seeded}')
    test_ids = [r['id'] for r in seeded]
    check('seeded 3 synthetic rows', len(test_ids) == 3, str(test_ids))

    # ── GET /api/worker-queue -> claim_work ───────────────────────────────────
    claimed = rpc('claim_work', {'w': WID, 'n': 3})
    if isinstance(claimed, dict):
        check('claim_work callable over PostgREST', False, str(claimed)[:200]); raise SystemExit
    got = sorted(r['id'] for r in claimed)
    check('claim_work returns the batch', got == sorted(test_ids), f'{len(claimed)} rows')
    check('claim_work only touched test rows', all(r['source'] == TAG for r in claimed))
    check('rows come back claimed by this worker',
          all(r['state'] == 'claimed' and r['claimed_by'] == WID for r in claimed))
    check('attempts incremented', all(r['attempts'] == 1 for r in claimed))
    check('the endpoint has the fields it maps',
          all(k in claimed[0] for k in ('id', 'title', 'price_sgd', 'images', 'times_listed', 'carousell_url')))

    # ── POST action=done -> complete_work + worker_done insert ────────────────
    done_id = test_ids[0]
    ok = rpc('complete_work', {'w': WID, 'qid': done_id, 'url': 'https://www.carousell.sg/p/1234567'})
    check('complete_work returns true', ok is True, repr(ok))

    row = call('GET', f'work_queue?select=state,done_url,done_at&id=eq.{done_id}')
    check('row is done with our URL',
          row[0]['state'] == 'done' and row[0]['done_url'].endswith('1234567') and row[0]['done_at'])

    wd = call('POST', 'worker_done',
              {'worker_id': WID, 'queue_id': done_id, 'listing_title': 'ENDPOINT TEST 0'},
              prefer='return=representation')
    check('worker_done accepts queue_id', isinstance(wd, list) and wd[0]['queue_id'] == done_id)

    stolen = rpc('complete_work', {'w': OTHER, 'qid': test_ids[1], 'url': None})
    check("another worker cannot complete it (endpoint 409s on this)", stolen is False, repr(stolen))

    # ── POST action=reject -> reject_work ─────────────────────────────────────
    rej = rpc('reject_work', {'w': WID, 'qid': test_ids[1], 'why': 'va-skip'})
    row = call('GET', f'work_queue?select=state,reject_reason&id=eq.{test_ids[1]}')
    check('reject_work parks it', rej is True and row[0]['state'] == 'rejected'
                                  and row[0]['reject_reason'] == 'va-skip')

    # ── POST action=release -> release_work ───────────────────────────────────
    n = rpc('release_work', {'w': WID})
    row = call('GET', f'work_queue?select=state,claimed_by&id=eq.{test_ids[2]}')
    check('release_work hands the rest back',
          isinstance(n, int) and n >= 1 and row[0]['state'] == 'pending' and row[0]['claimed_by'] is None,
          f'released {n}')

    # ── the stats view the endpoint reads for `pending` ───────────────────────
    st = call('GET', 'work_queue_stats?select=*')
    check('work_queue_stats readable', isinstance(st, list) and 'pending' in st[0],
          f"pending={st[0]['pending']}")

    # ── the 577 must be exactly as we found them ──────────────────────────────
    real = call('GET', 'work_queue?select=state&source=eq.closingdownsale&state=neq.pending&limit=1')
    check('no real product was touched', real == [], f'{real}')

finally:
    for qid in test_ids:
        call('DELETE', f'worker_done?queue_id=eq.{qid}')
    if test_ids:
        call('DELETE', f'work_queue?source=eq.{TAG}')
    left = call('GET', f'work_queue?select=id&source=eq.{TAG}')
    print(f"\ncleanup: {'removed all test rows' if left == [] else 'LEFTOVERS ' + str(left)}")

print()
failed = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(failed)}/{len(checks)} passed')
sys.exit(1 if failed else 0)
