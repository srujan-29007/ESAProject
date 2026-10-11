-- Smart OR Tracking: tables live alongside another app in a shared Supabase
-- project, so everything is prefixed or_. Access is server-side only (service
-- key); RLS is on with no policies so the public key can't read or write.

create table if not exists or_tags (
  id         bigserial primary key,
  rfid_uid   text unique not null,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists or_scans (
  id         bigserial primary key,
  tag_id     bigint not null references or_tags(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists or_scans_created_at_idx on or_scans (created_at desc);

alter table or_tags  enable row level security;
alter table or_scans enable row level security;

-- Scan count per tag, optionally only since a given time.
create or replace function or_usage(since timestamptz default null)
returns table (rfid_uid text, name text, count bigint)
language sql stable as $$
  select t.rfid_uid, t.name, count(s.id)
  from or_tags t join or_scans s on s.tag_id = t.id
  where since is null or s.created_at >= since
  group by t.id
$$;
revoke execute on function or_usage(timestamptz) from public, anon, authenticated;

-- The four instruments already tagged, in registration order (sets chart colors).
insert into or_tags (rfid_uid, name) values ('E6A94106', 'Mayo Scissors') on conflict do nothing;
insert into or_tags (rfid_uid, name) values ('5B677B05', 'FORCEPS') on conflict do nothing;
insert into or_tags (rfid_uid, name) values ('95F99D04', 'Scalpel Handle') on conflict do nothing;
insert into or_tags (rfid_uid, name) values ('6A33C162', 'Towel Clamps') on conflict do nothing;
