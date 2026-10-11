-- Manual corrections during a surgery are stored as scans marked source = 'manual'.
alter table or_scans add column if not exists source text not null default 'reader';

-- Procedures (and their recommended instrument plans) are editable from the dashboard.
create table if not exists or_procedures (
  id            text primary key,
  name          text not null,
  summary       text not null default '',
  est_minutes   int  not null default 20,
  alert_minutes int  not null default 10,  -- warn when an instrument is out longer than this
  steps         jsonb not null default '[]',
  sort          int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table or_procedures enable row level security;

insert into or_procedures (id, name, summary, est_minutes, alert_minutes, steps, sort) values
  ('lesion-excision', 'Skin Lesion Excision', 'Elliptical excision of a small skin lesion with primary closure.', 25, 10, '[{"tool":"clamp","purpose":"Secure sterile drapes around the field"},{"tool":"forceps","purpose":"Lift the skin edge and hold the specimen"},{"tool":"scissors","purpose":"Free the specimen from subcutaneous tissue"},{"tool":"forceps","purpose":"Evert wound edges while suturing"},{"tool":"scissors","purpose":"Cut sutures"}]'::jsonb, 0),
  ('laceration-repair', 'Laceration Repair', 'Clean, debride and suture a simple skin laceration.', 20, 10, '[{"tool":"clamp","purpose":"Secure sterile drapes around the wound"},{"tool":"forceps","purpose":"Explore the wound and remove debris"},{"tool":"scissors","purpose":"Trim devitalised wound edges"},{"tool":"forceps","purpose":"Evert wound edges while suturing"},{"tool":"scissors","purpose":"Cut sutures"}]'::jsonb, 1),
  ('abscess-drainage', 'Abscess Incision & Drainage', 'Open and drain a superficial skin abscess and pack the cavity.', 15, 10, '[{"tool":"clamp","purpose":"Secure sterile drapes around the abscess"},{"tool":"forceps","purpose":"Explore the cavity and break up loculations"},{"tool":"scissors","purpose":"Trim wound edges / cut packing gauze"},{"tool":"forceps","purpose":"Insert packing into the cavity"}]'::jsonb, 2),
  ('cyst-removal', 'Sebaceous Cyst Removal', 'Excise an epidermoid (sebaceous) cyst intact, then close.', 30, 10, '[{"tool":"clamp","purpose":"Secure sterile drapes around the field"},{"tool":"forceps","purpose":"Grasp and retract the skin edge"},{"tool":"scissors","purpose":"Dissect around the cyst wall"},{"tool":"forceps","purpose":"Deliver the cyst intact"},{"tool":"scissors","purpose":"Cut sutures"}]'::jsonb, 3)
on conflict (id) do nothing;

-- Each surgery keeps a snapshot of the plan it was started with, so editing a
-- procedure later never changes old reports.
alter table or_surgeries add column if not exists procedure_name text;
alter table or_surgeries add column if not exists plan jsonb;
alter table or_surgeries add column if not exists est_minutes int;
alter table or_surgeries add column if not exists alert_minutes int;
update or_surgeries s
   set procedure_name = p.name, plan = p.steps, est_minutes = p.est_minutes, alert_minutes = p.alert_minutes
  from or_procedures p
 where s.procedure_id = p.id and s.plan is null;

select id, procedure_name, jsonb_array_length(plan) as steps from or_surgeries order by id;
