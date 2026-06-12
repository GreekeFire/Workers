-- fill_outbox: relay table for pushing finished listing copy back OUT to Carousell.
-- Mirror of scrape_inbox but reversed: work.html publishes {title,desc,price} keyed
-- by the Carousell listing id; the carousell-fill userscript reads it on the edit
-- page and fills the form. Run once in Supabase SQL editor.
--
-- NOTE: policies deliberately do NOT use `to anon` — the sb_publishable_ key does
-- not map to the anon role on this project (same fix applied to scrape_inbox live).
-- caro_id is unique so work.html can upsert the latest copy per listing.

create table if not exists fill_outbox (
  id          bigint generated always as identity primary key,
  caro_id     text not null unique,
  payload     jsonb not null,
  consumed    boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table fill_outbox enable row level security;

create policy "fill_outbox insert" on fill_outbox
  for insert with check (true);

create policy "fill_outbox select" on fill_outbox
  for select using (true);

create policy "fill_outbox update" on fill_outbox
  for update using (true) with check (true);

-- housekeeping: clear rows older than 7 days (run manually if it grows)
-- delete from fill_outbox where created_at < now() - interval '7 days';
