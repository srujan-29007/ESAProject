-- Surgery sessions. A surgery's instrument events are simply the scans whose
-- time falls between started_at and ended_at (or now, while it's running).
create table if not exists or_surgeries (
  id           bigserial primary key,
  procedure_id text not null,
  surgeon      text not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists or_surgeries_started_idx on or_surgeries (started_at desc);

-- Only one surgery can be in progress at a time (there is one reader).
create unique index if not exists or_surgeries_one_active on or_surgeries ((ended_at is null)) where ended_at is null;

alter table or_surgeries enable row level security;
