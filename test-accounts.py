"""
Verifies phase 8: the queue runs one independent pass per Carousell account.

Seeds two throwaway accounts with the SAME three products, plus a worker on each,
and drives them through claim / done / reject / lease-recovery / clone. Every seed
lives under a fake account name, so claim_work — now account-scoped — cannot reach
a real product even if a seed assumption slips.

  python test-accounts.py
"""
import json, os, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REST = 'https://tzwzmzabjmsocnxdtxqx.supabase.co/rest/v1/'
TAG  = '__acct_test__'
A, B, C = 'ACCT_A_test', 'ACCT_B_test', 'ACCT_C_test'

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
    line = ('  PASS  ' if ok else '  FAIL  ') + name + (f'   {detail}' if detail else '')
    print(line.encode('ascii', 'replace').decode())   # catalogue titles carry CJK


def row(account, label, times_listed):
    return {'source': TAG, 'account': account, 'title': f'ACCT {label}',
            'carousell_url': f'https://www.carousell.sg/p/{TAG}-{label}',
            'price_sgd': 20, 'images': ['https://example.test/a.jpg'],
            'times_listed': times_listed}


wa = wb = None
try:
    wa = db('POST', 'workers', [{'name': TAG + '-A', 'daily_target': 5,
                                 'active': True, 'account_name': A}],
            prefer='return=representation')[0]['id']
    wb = db('POST', 'workers', [{'name': TAG + '-B', 'daily_target': 5,
                                 'active': True, 'account_name': B}],
            prefer='return=representation')[0]['id']

    # Same three products on both accounts — allowed only because the unique rule
    # is now (carousell_url, account).
    seeded = db('POST', 'work_queue',
                [row(A, 'P1', 99999), row(A, 'P2', 99998), row(A, 'P3', 99997),
                 row(B, 'P1', 99999), row(B, 'P2', 99998), row(B, 'P3', 99997)],
                prefer='return=representation')
    check('same product can exist on two accounts', len(seeded) == 6, f'{len(seeded)} rows')
    ids = {(r['account'], r['title']): r['id'] for r in seeded}

    # ── isolation ─────────────────────────────────────────────────────────────
    got_a = db('POST', 'rpc/claim_work', {'w': wa, 'n': 3}) or []
    check("account A's worker gets only account A rows",
          got_a and all(r['account'] == A for r in got_a),
          str(sorted({r['account'] for r in got_a})))
    check('no real product reachable from a test account',
          all(r['source'] == TAG for r in got_a))

    got_b = db('POST', 'rpc/claim_work', {'w': wb, 'n': 2}) or []
    check("account B's worker gets only account B rows",
          got_b and all(r['account'] == B for r in got_b),
          str(sorted({r['account'] for r in got_b})))
    check('the same product is served independently on both',
          'ACCT P1' in [r['title'] for r in got_a] and 'ACCT P1' in [r['title'] for r in got_b])

    # ── done on one account leaves the other alone ────────────────────────────
    db('POST', 'rpc/complete_work', {'w': wa, 'qid': ids[(A, 'ACCT P1')],
                                     'url': 'https://www.carousell.sg/p/9998887'})
    a1 = db('GET', f"work_queue?select=state&id=eq.{ids[(A,'ACCT P1')]}")[0]
    b1 = db('GET', f"work_queue?select=state,claimed_by&id=eq.{ids[(B,'ACCT P1')]}")[0]
    check("posting on A does not retire B's copy",
          a1['state'] == 'done' and b1['state'] == 'claimed' and b1['claimed_by'] == wb,
          f"A={a1['state']} B={b1['state']}")

    # ── a reject is a product fact: it should kill untouched copies elsewhere ──
    db('POST', 'rpc/reject_work', {'w': wa, 'qid': ids[(A, 'ACCT P3')], 'why': 'china-only'})
    a3 = db('GET', f"work_queue?select=state&id=eq.{ids[(A,'ACCT P3')]}")[0]
    b3 = db('GET', f"work_queue?select=state,reject_reason&id=eq.{ids[(B,'ACCT P3')]}")[0]
    check('rejecting a dud on A also rejects the untouched copy on B',
          a3['state'] == 'rejected' and b3['state'] == 'rejected',
          f"A={a3['state']} B={b3['state']}")
    b2 = db('GET', f"work_queue?select=state&id=eq.{ids[(B,'ACCT P2')]}")[0]
    check("a reject does not disturb B's in-progress row", b2['state'] == 'claimed', b2['state'])

    # ── lease recovery must not cross accounts ────────────────────────────────
    stale = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
    db('PATCH', f"work_queue?id=eq.{ids[(A,'ACCT P2')]}", {'claimed_at': stale})
    poached = db('POST', 'rpc/claim_work', {'w': wb, 'n': 3}) or []
    a2 = db('GET', f"work_queue?select=claimed_by&id=eq.{ids[(A,'ACCT P2')]}")[0]
    check("B cannot recover A's expired lease", a2['claimed_by'] == wa,
          f"{len(poached)} rows poached")

    # ── clone_catalogue ───────────────────────────────────────────────────────
    # A now holds P1 done, P2 claimed, P3 rejected. Rejected must not clone.
    n = db('POST', 'rpc/clone_catalogue', {'new_account': C, 'from_account': A})
    cloned = db('GET', f'work_queue?select=title,state&account=eq.{C}')
    check('clone copies the pass but skips rejects', n == 2 and len(cloned) == 2, f'n={n} {cloned}')
    check('cloned rows start pending', all(r['state'] == 'pending' for r in cloned))
    check('rejected product not cloned', 'ACCT P3' not in [r['title'] for r in cloned])
    check('re-running clone adds nothing',
          db('POST', 'rpc/clone_catalogue', {'new_account': C, 'from_account': A}) == 0)

finally:
    for w in (wa, wb):
        if w:
            db('PATCH', f'work_queue?claimed_by=eq.{w}',
               {'state': 'pending', 'claimed_by': None, 'claimed_at': None})
    for w in (wa, wb):
        if w:
            held = db('GET', f'worker_done?select=id&worker_id=eq.{w}')
            if held: db('DELETE', f'worker_done?worker_id=eq.{w}')
            db('DELETE', f'workers?id=eq.{w}')
    db('DELETE', f'work_queue?source=eq.{TAG}')
    left = db('GET', f'work_queue?select=id&source=eq.{TAG}')
    print(f"\ncleanup: {'removed test rows + workers' if left == [] else 'LEFTOVERS ' + str(left)}")

print()
bad = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(bad)}/{len(checks)} passed')
sys.exit(1 if bad else 0)
