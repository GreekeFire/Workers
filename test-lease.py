"""
Verifies the phase-7 lease: claim_work must NOT hand a second worker a row the
first worker is still holding within the lease window, and MUST reclaim one past
it. This is the two-VA collision in miniature.

Seeds rows tagged '__lease_test__' with times_listed above every real row, so
claim_work reaches them first and no real product is touched. Creates a throwaway
worker as the second VA. Deletes both when done.

  python test-lease.py
"""
import json, os, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REST = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/'
TAG  = '__lease_test__'

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


def ago(**kw):
    return (datetime.now(timezone.utc) - timedelta(**kw)).isoformat()


checks = []
def check(name, ok, detail=''):
    checks.append((name, ok))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (f'   {detail}' if detail else ''))


holder = db('GET', 'workers?select=id&limit=1')[0]['id']   # stands in for VA #1
second = None                                              # VA #2, created below

try:
    second = db('POST', 'workers', [{'name': TAG, 'daily_target': 5, 'active': True}],
                prefer='return=representation')[0]['id']

    def seed(label, times_listed, **extra):
        row = {'source': TAG, 'title': f'LEASE {label}',
               'carousell_url': f'https://www.carousell.sg/p/{TAG}-{label}',
               'price_sgd': 20, 'images': ['https://example.test/a.jpg'],
               'times_listed': times_listed, **extra}
        return db('POST', 'work_queue', [row], prefer='return=representation')[0]['id']

    # Highest times_listed wins the ORDER BY, so the stale rows are what claim_work
    # reaches for first. If the lease is still 30 minutes, it takes 'fresh-hold'.
    held_45m = seed('fresh-hold', 99999, state='claimed', claimed_by=holder, claimed_at=ago(minutes=45))
    held_5h  = seed('stale-hold', 99998, state='claimed', claimed_by=holder, claimed_at=ago(hours=5))
    free     = seed('pending',    99997)

    # n=3 so all three seeds are reachable — otherwise the two stale rows outrank
    # the pending one and 'still handed out' fails for the wrong reason.
    got = db('POST', 'rpc/claim_work', {'w': second, 'n': 3}) or []
    titles = sorted(r['title'] for r in got)

    check('a 45-min-old hold is NOT stolen (was: stolen at 30 min)',
          'LEASE fresh-hold' not in titles, str(titles))
    check('a 5-hour-old hold IS reclaimed', 'LEASE stale-hold' in titles, str(titles))
    check('an unheld row is still handed out', 'LEASE pending' in titles, str(titles))
    check('no real product was claimed',
          all(r['source'] == TAG for r in got), str([r['source'] for r in got]))

    still = db('GET', f'work_queue?select=claimed_by&id=eq.{held_45m}')[0]['claimed_by']
    check('VA #1 still owns their in-progress row', still == holder, str(still))

    stats = db('GET', 'work_queue_stats?select=lease_expired')[0]
    check('health view counts the 4-hour boundary, not 30 min',
          stats['lease_expired'] <= 1, f"lease_expired={stats['lease_expired']} (only the 5h seed)")

finally:
    db('DELETE', f'work_queue?source=eq.{TAG}')
    if second: db('DELETE', f'workers?id=eq.{second}')
    left = db('GET', f'work_queue?select=id&source=eq.{TAG}')
    print(f"\ncleanup: {'removed test rows + worker' if left == [] else 'LEFTOVERS ' + str(left)}")

print()
bad = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(bad)}/{len(checks)} passed')
sys.exit(1 if bad else 0)
