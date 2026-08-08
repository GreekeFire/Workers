"""
Proves the work_queue claim design before you build on it.

Creates a THROWAWAY table + function (work_queue_test / claim_work_test), hammers
them with concurrent workers, checks the invariants, then drops both. Touches
nothing else in your database.

  pip install pg8000
  set PGURL=postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
  python test-claim-queue.py

Connection string: Supabase Dashboard -> Settings -> Database -> Connection string (URI).
"""
import os, sys, threading, time, collections, urllib.parse

try:
    import pg8000.dbapi as driver
except ImportError:
    sys.exit('pip install pg8000')

PGURL = os.environ.get('PGURL')
_local = None
if PGURL:
    WHERE, USE_SSL = 'your Supabase database', True
else:
    # No credentials given -> run against a throwaway embedded Postgres. Same
    # engine, same locking semantics, nothing of yours touched.
    try:
        import pgserver
    except ImportError:
        sys.exit('Set PGURL, or `pip install pgserver` to test against a local Postgres.')
    _dir = os.path.join(os.path.expanduser('~'), '.claim-queue-test-pg')
    os.makedirs(_dir, exist_ok=True)
    _local = pgserver.get_server(_dir)
    PGURL = _local.get_uri()
    WHERE, USE_SSL = 'a local throwaway Postgres', False

u = urllib.parse.urlparse(PGURL)
CONN = dict(user=u.username or 'postgres', password=u.password or '',
            host=u.hostname, port=u.port or 5432,
            database=u.path.lstrip('/') or 'postgres')
if USE_SSL:
    CONN['ssl_context'] = True

ROWS       = int(os.environ.get('ROWS', 400))      # queue depth
WORKERS    = int(os.environ.get('WORKERS', 4))     # concurrent claimants
BATCH      = int(os.environ.get('BATCH', 20))      # rows per claim_work call
LEASE_MINS = 30

def connect():
    c = driver.connect(**CONN); c.autocommit = True; return c

def run(sql, args=None, fetch=False):
    c = connect()
    try:
        cur = c.cursor(); cur.execute(sql, args or ())
        return cur.fetchall() if fetch else None
    finally:
        c.close()

# ── setup ────────────────────────────────────────────────────────────────────
def setup():
    run('DROP TABLE IF EXISTS work_queue_test CASCADE')
    run('''CREATE TABLE work_queue_test (
             id BIGSERIAL PRIMARY KEY,
             title TEXT,
             times_listed INT,
             state TEXT DEFAULT 'pending',
             claimed_by UUID,
             claimed_at TIMESTAMPTZ,
             done_at TIMESTAMPTZ)''')
    run('''CREATE INDEX ON work_queue_test (state, times_listed DESC)
             WHERE state = 'pending' ''')
    run(f'''CREATE OR REPLACE FUNCTION claim_work_test(w UUID, n INT DEFAULT {BATCH})
            RETURNS SETOF work_queue_test AS $$
              UPDATE work_queue_test SET state='claimed', claimed_by=w, claimed_at=now()
              WHERE id IN (
                SELECT id FROM work_queue_test
                WHERE state='pending'
                   OR (state='claimed' AND claimed_at < now() - INTERVAL '{LEASE_MINS} minutes')
                ORDER BY times_listed DESC
                LIMIT n FOR UPDATE SKIP LOCKED
              ) RETURNING *;
            $$ LANGUAGE sql''')
    run('''INSERT INTO work_queue_test (title, times_listed)
           SELECT 'product ' || g, (1000 - g) FROM generate_series(1, %s) g''', (ROWS,))

def teardown():
    run('DROP FUNCTION IF EXISTS claim_work_test(UUID, INT)')
    run('DROP TABLE IF EXISTS work_queue_test CASCADE')

# ── test 1: concurrent claims never overlap ──────────────────────────────────
def test_no_overlap():
    got  = collections.defaultdict(list)
    errs = []
    barrier = threading.Barrier(WORKERS)

    def worker(i):
        wid = f'00000000-0000-0000-0000-00000000000{i}'
        c = connect()
        try:
            barrier.wait()          # all fire at the same instant
            while True:
                cur = c.cursor()
                cur.execute('SELECT id FROM claim_work_test(%s, %s)', (wid, BATCH))
                ids = [r[0] for r in cur.fetchall()]
                if not ids: break
                got[i].extend(ids)
                cur.execute("UPDATE work_queue_test SET state='done', done_at=now()"
                            ' WHERE id = ANY(%s)', (ids,))
        except Exception as e:
            errs.append(f'worker {i}: {e}')
        finally:
            c.close()

    ts = [threading.Thread(target=worker, args=(i,)) for i in range(WORKERS)]
    t0 = time.time()
    for t in ts: t.start()
    for t in ts: t.join()
    dt = time.time() - t0

    allids = [i for v in got.values() for i in v]
    dupes  = [k for k, n in collections.Counter(allids).items() if n > 1]
    ok = (not errs and not dupes
          and len(allids) == ROWS and sorted(allids) == list(range(1, ROWS + 1)))

    print(f'\n[1] concurrent claim — {WORKERS} workers, {ROWS} rows, batch {BATCH}')
    for i in sorted(got): print(f'      worker {i}: {len(got[i]):4d} rows')
    print(f'      claimed {len(allids)}/{ROWS} in {dt:.2f}s · '
          f'{len(dupes)} handed to more than one worker')
    for e in errs: print('      ERROR', e)
    return ok

# ── test 2: an abandoned claim comes back ────────────────────────────────────
def test_lease_expiry():
    run("TRUNCATE work_queue_test")
    run('''INSERT INTO work_queue_test (title, times_listed)
           SELECT 'p' || g, g FROM generate_series(1, 40) g''')
    wid = '00000000-0000-0000-0000-0000000000aa'

    taken = run('SELECT id FROM claim_work_test(%s, 20)', (wid,), fetch=True)
    still = run("SELECT count(*) FROM claim_work_test(%s, 20)",
                ('00000000-0000-0000-0000-0000000000bb',), fetch=True)[0][0]

    # worker walks away: backdate the lease past its expiry
    run('UPDATE work_queue_test SET claimed_at = now() - make_interval(mins => %s)'
        ' WHERE claimed_by = %s', (LEASE_MINS + 1, wid))
    back = run("SELECT count(*) FROM claim_work_test(%s, 20)",
               ('00000000-0000-0000-0000-0000000000cc',), fetch=True)[0][0]

    print(f'\n[2] lease expiry — {LEASE_MINS} min')
    print(f'      worker A claimed {len(taken)}, worker B got the other {still} (no overlap)')
    print(f'      A abandons them; after expiry another worker reclaimed {back}')
    return len(taken) == 20 and still == 20 and back == 20

# ── test 3: priority order ───────────────────────────────────────────────────
def test_priority():
    run("TRUNCATE work_queue_test")
    run('''INSERT INTO work_queue_test (title, times_listed)
           SELECT 'p' || g, g FROM generate_series(1, 100) g''')
    top = run('SELECT times_listed FROM claim_work_test(%s, 10)',
              ('00000000-0000-0000-0000-0000000000dd',), fetch=True)
    vals = [r[0] for r in top]
    # ORDER BY governs WHICH rows get claimed. It does not govern the order
    # RETURNING hands them back — that is unspecified in Postgres. So assert on
    # the set, and sort client-side if the VA should see the best one first.
    ok = sorted(vals) == list(range(91, 101))
    print('\n[3] priority — claims the highest times_listed')
    print(f'      claimed {sorted(vals, reverse=True)}  (expected 100..91)')
    print(f'      returned in this order: {vals}')
    print('      note: RETURNING order is not guaranteed — sort in the client')
    return ok

if __name__ == '__main__':
    print(f'testing against {WHERE} ({CONN["host"]}:{CONN["port"]})')
    setup()
    try:
        results = [('no double-handing', test_no_overlap()),
                   ('lease expiry',      test_lease_expiry()),
                   ('priority order',    test_priority())]
    finally:
        teardown()
        print('\ndropped work_queue_test + claim_work_test')

    print()
    for name, ok in results:
        print(('  PASS  ' if ok else '  FAIL  ') + name)
    sys.exit(0 if all(ok for _, ok in results) else 1)
