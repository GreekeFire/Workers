-- scrape_inbox: relay table for client-side scrapers (bookmarklets + phone shortcut).
-- Run once in Supabase SQL editor (https://supabase.com/dashboard → SQL Editor).
--
-- Anon key may INSERT and SELECT (needed: bookmarklets insert, work.html reads),
-- and UPDATE only the consumed flag. No deletes from anon.

create table if not exists scrape_inbox (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('shopee','carousell','chats')),
  payload     jsonb not null,
  consumed    boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table scrape_inbox enable row level security;

create policy "anon can insert scrapes"
  on scrape_inbox for insert
  to anon
  with check (true);

create policy "anon can read scrapes"
  on scrape_inbox for select
  to anon
  using (true);

create policy "anon can mark consumed"
  on scrape_inbox for update
  to anon
  using (true)
  with check (true);

-- housekeeping helper: clear consumed rows older than 7 days (run manually if it grows)
-- delete from scrape_inbox where consumed and created_at < now() - interval '7 days';
