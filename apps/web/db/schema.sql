-- Every table RailScore uses, in its final form. `npm run db:migrate` runs this file; each
-- statement is safe to run again. It creates missing tables but does not change existing ones:
-- a change to a table needs its own `alter table` here, run once on every database.
--
-- Tables from the first HSP version (hsp_runs, hsp_service_lists, hsp_rate_limit, hsp_list_slots,
-- hsp_daily_calls, hsp_calculation_lock) are no longer created or read. A database migrated
-- before may still hold them; they can be dropped by hand.

-- Darwin ------------------------------------------------------------------------------------

-- One row per Darwin run (RID), merged from the Push Port feed, for the last week. `calls` holds
-- the public calls as compact text (see server/call-text.ts), so a run costs one row rather than
-- one per call. late_reason and cancel_reason are Darwin's reason codes ("" when none).
create table if not exists darwin_runs (
  rid text primary key,
  service_date date not null,
  uid text not null default '',
  toc text not null default '',
  calls text not null,
  updated_at timestamptz not null default now(),
  late_reason text not null default '',
  cancel_reason text not null default ''
);

create index if not exists darwin_runs_service_date on darwin_runs (service_date);

-- A search reads one day's runs between two stations, then the earlier runs of those trains
-- by schedule UID. A station index over every run would cost about a third of the stored size.
create index if not exists darwin_runs_uid on darwin_runs (uid, service_date);

-- Finished days, packed: one row per schedule UID and calendar month (see server/darwin/month.ts).
-- A day moves here from darwin_runs once it is a week old, so a search finds the latest day of
-- any day type still in darwin_runs. Postgres compresses the repeated calling patterns, so a
-- day costs about a tenth of its darwin_runs rows. first_day is the earliest day in the row.
-- Postgres tries to compress only rows over about 2 KB unless told otherwise. A month row
-- reaches that after about a week, so the threshold is lowered for rows earlier in the month.
create table if not exists darwin_months (
  uid text not null,
  month date not null,
  first_day date not null,
  runs text not null,
  primary key (uid, month)
) with (toast_tuple_target = 128);

-- Where the Darwin import got to. Kafka keeps about an hour of messages. When it dropped some
-- before an import read them, gap_from..gap_to is the time they covered, and later imports
-- fill it from the hourly snapshot files, moving gap_from on as each hour is read.
-- The lease keeps two imports from running at once. timetable_date is the UTC date whose
-- 05:00 snapshot was read for the day's timetable: Darwin loads the day's schedules between
-- 02:00 and 04:00, so that snapshot holds about nine in ten of them.
create table if not exists darwin_import_state (
  id smallint primary key,
  last_message_at timestamptz,
  last_finished_at timestamptz,
  gap_from timestamptz,
  gap_to timestamptz,
  leased_until timestamptz not null default 'epoch',
  timetable_date date
);

insert into darwin_import_state (id) values (1) on conflict (id) do nothing;

-- Darwin outages, for the TRUST backup (server/trust/). last_actual_at is the newest Darwin
-- message carrying an actual time. An outage holds from outage_from (the last actual time before
-- it) until outage_closed_at; outage_ok_since is the first import that found actual times back.
-- trust_read_to is how far the backup has read TRUST; trust_canary_date the London date of the
-- last daily check of TRUST against Darwin.
alter table darwin_import_state add column if not exists last_actual_at timestamptz;
alter table darwin_import_state add column if not exists outage_from timestamptz;
alter table darwin_import_state add column if not exists outage_closed_at timestamptz;
alter table darwin_import_state add column if not exists outage_ok_since timestamptz;
alter table darwin_import_state add column if not exists trust_read_to timestamptz;
alter table darwin_import_state add column if not exists trust_canary_date date;

-- TRUST (Network Rail Train Movements) read during a Darwin outage: one row per import, `data`
-- the activations and public movements read, as gzipped JSON (server/trust/backup.ts). Deleted
-- once the outage is filled, or after 14 days, before its days are packed into months.
create table if not exists trust_captures (
  id bigint generated always as identity primary key,
  outage_from timestamptz not null,
  read_from timestamptz not null,
  read_to timestamptz not null,
  movements integer not null,
  data bytea not null,
  captured_at timestamptz not null default now()
);

-- Every run a TRUST fill changed, with its calls before and after, so the fill can be undone
-- (npm run db:trust-fill -- --revert). Kept 14 days.
create table if not exists trust_fills (
  rid text not null,
  filled_at timestamptz not null,
  old_calls text not null,
  new_calls text not null,
  primary key (rid, filled_at)
);

-- HSP, for the days before Darwin -----------------------------------------------------------

-- HSP (Historic Service Performance) for the days before Darwin's first whole day, 2026-11-04.
-- Once Darwin covers the whole search period HSP is no longer asked, and these rows age out.
-- List answers by key: route, day type, quarter-hour and dates. `services` is null while a
-- search holds the claim to ask HSP for it.
create table if not exists hsp_metrics (
  key text primary key,
  services jsonb,
  claimed_until timestamptz not null default 'epoch',
  fetched_at timestamptz
);

-- Runs from HSP serviceDetails for the earlier days (the table keeps its first name), with calls in the darwin_runs text form (server/call-text.ts).
-- `reasons` is HSP's late or cancellation reason code at each call, joined by `;` in call
-- order, "" when the run has none. HSP does not say which kind a code is.
create table if not exists hsp_backlog_runs (
  rid text primary key,
  service_date date not null,
  toc text not null default '',
  calls text not null,
  reasons text not null default ''
);

-- At busy times HSP refuses a second call beside a list call, so every server shares one slot:
-- one HSP call at a time. A database migrated before may hold a second row; it is never used.
create table if not exists hsp_slots (
  slot smallint primary key,
  owner text,
  leased_until timestamptz not null default 'epoch'
);

insert into hsp_slots (slot) values (1) on conflict (slot) do nothing;

-- HSP calls per London day, added once per search.
create table if not exists hsp_usage (
  day date primary key,
  calls integer not null default 0
);
