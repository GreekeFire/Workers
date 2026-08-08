"""
End-to-end test of the DEPLOYED /api/worker-queue endpoint over HTTP.

This is the layer nothing else covers: request parsing, worker validation, the
sort, the response shape, and the 409 path. Everything before this tested the
SQL underneath it.

Seeds synthetic rows (source='__endpoint_test__', times_listed high enough that
claim_work reaches them first), drives them through the real endpoint, asserts
your 577 were never touched, then deletes everything it made.

  python test-endpoint-live.py
"""
import json, os, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
APP  = 'https://workers-v1.vercel.app'
REST = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/'
TAG  = '__endpoint_test__'

KEY = None
for line in open(os.path.join(HERE, '.env.local'), encoding='utf-8'):
    if line.startswith('SUPABASE_SERVICE_ROLE_KEY='):
        KEY = line.split('=', 1)[1].strip()
if not KEY:
    sys.exit('SUPABASE_SERVICE_ROLE_KEY not in .env.local')
H = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'}


def db(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer: h['Prefer'] = prefer
    req = urllib.request.Request(REST + path, headers=h, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    raw = urllib.request.urlopen(req, timeout=60).read()
    return json.loads(raw) if raw else None


def api(method, path, body=None):
    """Hit the deployed endpoint. Returns (status, parsed_json)."""
    req = urllib.request.Request(
        APP + path, method=method,
        headers={'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        r = urllib.request.urlopen(req, timeout=60)
        return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


checks = []
def check(name, ok, detail=''):
    checks.append((name, ok))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (f'   {detail}' if detail else ''))


WID = db('GET', 'workers?select=id,name&limit=1')[0]
print(f"worker: {WID['name']}   endpoint: {APP}/api/worker-queue\n")
wid = WID['id']

ids = []
try:
    seeded = db('POST', 'work_queue', [
        {'source': TAG, 'carousell_url': f'https://www.carousell.sg/p/{TAG}-http-{i}',
         'title': f'HTTP TEST {i}', 'price_sgd': 20 + i,
         'images': ['https://example.test/a.jpg'], 'times_listed': 99990 + i}
        for i in range(3)], prefer='return=representation')
    ids = [r['id'] for r in seeded]
    # times_listed ascends with i, so the endpoint's sort must put i=2 first.
    print(f'seeded {ids} (times_listed 99990..99992)\n')

    # ── claim ────────────────────────────────────────────────────────────────
    st, d = api('GET', f'/api/worker-queue?w={wid}&n=3')
    check('GET claims a batch', st == 200 and d.get('ok') and len(d.get('items', [])) == 3,
          f'HTTP {st}, {len(d.get("items", []))} items')
    items = d.get('items', [])
    check('only test rows were claimed', all(i['title'].startswith('HTTP TEST') for i in items),
          str([i['title'] for i in items]))
    check('sorted highest prominence first',
          [i['times_listed'] for i in items] == sorted((i['times_listed'] for i in items), reverse=True),
          str([i['times_listed'] for i in items]))
    check('item shape is what va.html maps',
          all(k in items[0] for k in ('queue_id', 'title', 'price_sgd', 'images', 'times_listed', 'reference_url')),
          str(sorted(items[0].keys())))
    check('no source_cost leaked to the VA', 'source_cost' not in json.dumps(d))
    check('returns progress + pool depth',
          'count_today' in d and 'daily_target' in d and isinstance(d.get('pending'), int),
          f"count_today={d.get('count_today')} target={d.get('daily_target')} pending={d.get('pending')}")

    # ── done ─────────────────────────────────────────────────────────────────
    q0 = items[0]['queue_id']
    st, d = api('POST', '/api/worker-queue',
                {'worker_id': wid, 'queue_id': q0, 'action': 'done',
                 'carousell_url': 'https://www.carousell.sg/p/9998887'})
    check('POST done succeeds', st == 200 and d.get('ok'), f'HTTP {st} {d}')
    check('count_today came back', isinstance(d.get('count_today'), int), str(d.get('count_today')))
    row = db('GET', f'work_queue?select=state,done_url&id=eq.{q0}')[0]
    check('row marked done with our URL', row['state'] == 'done' and row['done_url'].endswith('9998887'))
    check('worker_done row written',
          len(db('GET', f'worker_done?select=id&queue_id=eq.{q0}')) == 1)

    st, d = api('POST', '/api/worker-queue',
                {'worker_id': wid, 'queue_id': q0, 'action': 'done'})
    check('completing it twice is refused (409)', st == 409, f'HTTP {st} {d}')

    st, d = api('POST', '/api/worker-queue', {'action': 'done', 'queue_id': q0})
    check('missing worker_id refused (400)', st == 400, f'HTTP {st}')

    # ── reject ───────────────────────────────────────────────────────────────
    q1 = items[1]['queue_id']
    st, d = api('POST', '/api/worker-queue',
                {'worker_id': wid, 'queue_id': q1, 'action': 'reject', 'reason': 'va-skip'})
    row = db('GET', f'work_queue?select=state,reject_reason&id=eq.{q1}')[0]
    check('POST reject parks it', st == 200 and row['state'] == 'rejected'
                                  and row['reject_reason'] == 'va-skip', f'HTTP {st}')

    # ── release (what the pagehide beacon sends) ──────────────────────────────
    st, d = api('POST', '/api/worker-queue', {'worker_id': wid, 'action': 'release'})
    q2 = items[2]['queue_id']
    row = db('GET', f'work_queue?select=state,claimed_by&id=eq.{q2}')[0]
    check('POST release returns the rest', st == 200 and row['state'] == 'pending'
                                           and row['claimed_by'] is None, f"released {d.get('released')}")

    # ── the 577 ──────────────────────────────────────────────────────────────
    touched = db('GET', 'work_queue?select=id&source=eq.closingdownsale&state=neq.pending&limit=1')
    check('no real product was touched', touched == [], str(touched))

finally:
    for qid in ids:
        db('DELETE', f'worker_done?queue_id=eq.{qid}')
    if ids:
        db('DELETE', f'work_queue?source=eq.{TAG}')
    left = db('GET', f'work_queue?select=id&source=eq.{TAG}')
    print(f"\ncleanup: {'removed all test rows' if left == [] else 'LEFTOVERS ' + str(left)}")

print()
bad = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(bad)}/{len(checks)} passed')
sys.exit(1 if bad else 0)
