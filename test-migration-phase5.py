"""
Runs supabase/migrations-phase5.sql against a throwaway Postgres and exercises
every function in it. Proves the migration actually applies and behaves before
you paste it into the Supabase SQL editor.

  pip install pgserver pg8000
  python test-migration-phase5.py

Spins up its own local Postgres in a temp dir and deletes it on the way out.
Your Supabase is never contacted.
"""
import os, sys, shutil, tempfile, uuid

try:
    import pg8000.dbapi as driver
    import pgserver
except ImportError:
    sys.exit('pip install pgserver pg8000')

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATION = os.path.join(HERE, 'supabase', 'migrations-phase5.sql')


def split_sql(text):
    """Split on semicolons that are outside $$-quoted bodies, strings and comments."""
    out, buf, i, dollar, quote, line_comment = [], [], 0, False, None, False
    while i < len(text):
        c, nxt = text[i], text[i:i + 2]
        if line_comment:
            if c == '\n': line_comment = False
            buf.append(c); i += 1; continue
        if not dollar and not quote and nxt == '--':
            line_comment = True; buf.append(c); i += 1; continue
        if not quote and nxt == '$$':
            dollar = not dollar; buf.append(nxt); i += 2; continue
        if not dollar and c in ("'", '"'):
            quote = None if quote == c else (quote or c)
        if c == ';' and not dollar and not quote:
            s = ''.join(buf).strip()
            if s: out.append(s)
            buf = []; i += 1; continue
        buf.append(c); i += 1
    s = ''.join(buf).strip()
    if s: out.append(s)
    return out


PRE = """
CREATE TABLE listings (id SERIAL PRIMARY KEY, title TEXT, status TEXT DEFAULT 'active');
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL,
  daily_target INT DEFAULT 100, active BOOL DEFAULT true);
CREATE TABLE worker_done (
  id BIGSERIAL PRIMARY KEY, worker_id UUID REFERENCES workers(id),
  listing_id INT REFERENCES listings(id), listing_title TEXT,
  done_at TIMESTAMPTZ DEFAULT now(), date DATE DEFAULT CURRENT_DATE,
  warnings_overridden BOOL DEFAULT false);
"""

checks, tmp = [], tempfile.mkdtemp(prefix='phase5-')


def check(name, ok, detail=''):
    checks.append((name, ok))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (f'   {detail}' if detail else ''))


try:
    print(f'starting throwaway postgres in {tmp}')
    srv = pgserver.get_server(tmp)
    import urllib.parse
    u = urllib.parse.urlparse(srv.get_uri())
    conn = driver.connect(user=u.username or 'postgres', password=u.password or '',
                          host=u.hostname, port=u.port, database='postgres')
    conn.autocommit = True
    cur = conn.cursor()

    def run(sql, args=None):
        cur.execute(sql, args or ()); return cur

    def one(sql, args=None):
        return run(sql, args).fetchall()[0][0]

    for stmt in split_sql(PRE):
        run(stmt)
    print('created stub listings / workers / worker_done\n')

    # ── the actual migration ─────────────────────────────────────────────────
    stmts = split_sql(open(MIGRATION, encoding='utf-8').read())
    print(f'applying migrations-phase5.sql — {len(stmts)} statements')
    for n, stmt in enumerate(stmts, 1):
        try:
            run(stmt)
        except Exception as e:
            print(f'  FAILED at statement {n}:\n{stmt[:300]}\n  -> {e}')
            raise
    check('migration applies cleanly', True, f'{len(stmts)} statements')

    # idempotent? re-running should not error (CREATE ... IF NOT EXISTS / OR REPLACE)
    try:
        for stmt in stmts:
            run(stmt)
        check('migration is re-runnable', True)
    except Exception as e:
        check('migration is re-runnable', False, str(e)[:120])

    # ── seed ─────────────────────────────────────────────────────────────────
    wa = one("INSERT INTO workers (name) VALUES ('A') RETURNING id")
    wb = one("INSERT INTO workers (name) VALUES ('B') RETURNING id")
    run("""INSERT INTO work_queue (carousell_url, title, price_sgd, times_listed)
           SELECT 'https://carousell.sg/p/' || g, 'item ' || g, 50 + g, g
           FROM generate_series(1, 100) g""")

    # ── claim ────────────────────────────────────────────────────────────────
    got_a = [r[0] for r in run('SELECT times_listed FROM claim_work(%s, 10)', (wa,)).fetchall()]
    check('claim_work returns the top prominence items', sorted(got_a) == list(range(91, 101)),
          f'top={max(got_a)} low={min(got_a)}')

    got_b = [r[0] for r in run('SELECT id FROM claim_work(%s, 10)', (wb,)).fetchall()]
    a_ids = [r[0] for r in run("SELECT id FROM work_queue WHERE claimed_by=%s", (wa,)).fetchall()]
    check('a second worker gets disjoint rows', not (set(got_b) & set(a_ids)), f'{len(got_b)} rows')

    check('attempts increments on claim',
          one('SELECT min(attempts) FROM work_queue WHERE state=%s', ('claimed',)) == 1)

    # ── complete ─────────────────────────────────────────────────────────────
    qid = a_ids[0]
    ok = one('SELECT complete_work(%s, %s, %s)', (wa, qid, 'https://www.carousell.sg/p/999'))
    check('complete_work marks it done', ok is True and
          one('SELECT state FROM work_queue WHERE id=%s', (qid,)) == 'done')

    stolen = one('SELECT complete_work(%s, %s, NULL)', (wb, a_ids[1]))
    check("a worker cannot complete another's item", stolen is False)

    check('done_url is stored',
          one('SELECT done_url FROM work_queue WHERE id=%s', (qid,)) == 'https://www.carousell.sg/p/999')

    # ── reject ───────────────────────────────────────────────────────────────
    rej = one('SELECT reject_work(%s, %s, %s)', (wa, a_ids[2], 'china-only'))
    st, why = run('SELECT state, reject_reason FROM work_queue WHERE id=%s', (a_ids[2],)).fetchall()[0]
    check('reject_work parks it out of the pool', rej is True and st == 'rejected' and why == 'china-only')

    reclaimed = [r[0] for r in run('SELECT id FROM claim_work(%s, 100)', (wb,)).fetchall()]
    check('rejected items are never re-served', a_ids[2] not in reclaimed)

    # ── lease ────────────────────────────────────────────────────────────────
    held = one('SELECT count(*) FROM work_queue WHERE claimed_by=%s AND state=%s', (wa, 'claimed'))
    run("UPDATE work_queue SET claimed_at = now() - make_interval(mins => 31) WHERE claimed_by=%s", (wa,))
    back = one('SELECT count(*) FROM claim_work(%s, 100)', (wb,))
    check('expired leases return to the pool', back >= held, f'{held} held -> {back} reclaimed')

    # ── release ──────────────────────────────────────────────────────────────
    n_rel = one('SELECT release_work(%s)', (wb,))
    left = one('SELECT count(*) FROM work_queue WHERE claimed_by=%s AND state=%s', (wb, 'claimed'))
    check('release_work hands everything back', n_rel > 0 and left == 0, f'released {n_rel}')

    # ── stats view ───────────────────────────────────────────────────────────
    row = run('SELECT total, pending, done, rejected FROM work_queue_stats').fetchall()[0]
    check('work_queue_stats reports the queue', row[0] == 100 and row[2] == 1 and row[3] == 1,
          f'total={row[0]} pending={row[1]} done={row[2]} rejected={row[3]}')

    # ── worker_done linkage ──────────────────────────────────────────────────
    run('INSERT INTO worker_done (worker_id, queue_id, listing_title) VALUES (%s, %s, %s)',
        (wa, qid, 'item'))
    check('worker_done accepts queue_id', one('SELECT count(*) FROM worker_done WHERE queue_id=%s', (qid,)) == 1)

    check('RLS is enabled on work_queue',
          one("SELECT relrowsecurity FROM pg_class WHERE relname='work_queue'") is True)

    # ── the claim query uses the indexes ─────────────────────────────────────
    plan = '\n'.join(r[0] for r in run(
        """EXPLAIN SELECT id FROM work_queue
           WHERE state='pending' OR (state='claimed' AND claimed_at < now() - INTERVAL '30 minutes')
           ORDER BY times_listed DESC, id LIMIT 20""").fetchall())
    check('claim path hits an index, not a seq scan', 'Seq Scan' not in plan,
          plan.splitlines()[0].strip()[:70])

finally:
    try: conn.close()
    except Exception: pass
    try: srv.cleanup()
    except Exception: pass
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'\ncleaned up {tmp}')

print()
failed = [n for n, ok in checks if not ok]
print(f'{len(checks) - len(failed)}/{len(checks)} passed')
sys.exit(1 if failed else 0)
