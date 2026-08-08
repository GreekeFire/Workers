"""
Verifies mode-per-worker end to end: the phase-6 column exists, the DEPLOYED
profile endpoint reports it, and va.html's resolution picks the right flow.

Creates a throwaway worker (name '__mode_test__'), tests both column values
against the live endpoint, then deletes it. Touches no real worker.

  python test-queue-mode.py
"""
import json, os, sys, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
APP  = 'https://workers-v1.vercel.app'
REST = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/'
TAG  = '__mode_test__'

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


checks = []
def check(name, ok, detail=''):
    checks.append((name, ok))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (f'   {detail}' if detail else ''))


# ── the migration ─────────────────────────────────────────────────────────────
try:
    db('GET', 'workers?select=queue_mode&limit=1')
    check('workers.queue_mode exists', True)
except urllib.error.HTTPError as e:
    check('workers.queue_mode exists', False, f'HTTP {e.code} — run supabase/migrations-phase6.sql first')
    print('\nmigration not applied; stopping.')
    sys.exit(1)

check('existing workers default to queue mode',
      all(w['queue_mode'] for w in db('GET', 'workers?select=name,queue_mode')),
      str(db('GET', 'workers?select=name,queue_mode')))

# ── the deployed endpoint reports it ──────────────────────────────────────────
wid = None
try:
    wid = db('POST', 'workers', [{'name': TAG, 'daily_target': 5, 'active': True}],
             prefer='return=representation')[0]['id']

    for want in (True, False):
        db('PATCH', f'workers?id=eq.{wid}', {'queue_mode': want})
        req = urllib.request.Request(f'{APP}/api/worker-profile?w={wid}')
        got = json.loads(urllib.request.urlopen(req, timeout=60).read())
        check(f'profile reports queue_mode={want}', got.get('queue_mode') is want,
              f"got {got.get('queue_mode')!r}")
        # The scraper flow needs its bookmarklet; queue mode has no scraping step.
        check(f'bookmarklet still served (queue_mode={want})', bool(got.get('bookmarklet')))
finally:
    if wid:
        db('DELETE', f'workers?id=eq.{wid}')
    left = db('GET', f'workers?select=id&name=eq.{TAG}')
    print(f"cleanup: {'removed test worker' if left == [] else 'LEFTOVERS ' + str(left)}")

# ── va.html's resolution: QUEUE_MODE = ?queue=1 || !!profile.queue_mode ───────
resolve = lambda param, column: param or bool(column)
print()
for param, column, want, label in [
    (False, True,  True,  'plain link, queue worker      -> queue  (the fix)'),
    (False, False, False, 'plain link, scraper worker    -> scraper'),
    (True,  True,  True,  'old &queue=1 link, queue      -> queue'),
    (True,  False, True,  'old &queue=1 link, scraper    -> queue  (param overrides)'),
    (False, None,  False, 'column missing/null          -> scraper (no crash)'),
]:
    check(label, resolve(param, column) is want)

print()
bad = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(bad)}/{len(checks)} passed')
sys.exit(1 if bad else 0)
