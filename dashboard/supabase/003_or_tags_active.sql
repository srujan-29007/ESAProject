-- Instruments can be retired (kept for history, hidden from the tray and inventory).
alter table or_tags add column if not exists active boolean not null default true;

-- Scalpel Handle is not in use for now.
update or_tags set active = false where rfid_uid = '95F99D04';
