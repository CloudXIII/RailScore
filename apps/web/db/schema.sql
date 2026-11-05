-- Tables from the first HSP version (hsp_runs, hsp_service_lists, hsp_rate_limit, hsp_list_slots,
-- hsp_daily_calls, hsp_calculation_lock) are no longer created or read. A database migrated
-- before may still hold them; they can be dropped by hand.

-- One row per Darwin run (RID), merged from the Push Port feed. `calls` holds the public calls
-- as compact text (see server/darwin/run.ts), so a run costs one row rather than one per call.
create table if not exists darwin_runs (
  rid text primary key,
  service_date date not null,
  uid text not null default '',
  toc text not null default '',
  calls text not null,
  updated_at timestamptz not null default now()
);

create index if not exists darwin_runs_service_date on darwin_runs (service_date);

-- Where the Darwin import got to. Kafka keeps about an hour of messages. When it dropped some
-- before an import read them, gap_from..gap_to is the time they covered, and later imports
-- fill it from the hourly snapshot files, moving gap_from on as each hour is read.
-- The lease keeps two imports from running at once.
create table if not exists darwin_import_state (
  id smallint primary key,
  last_message_at timestamptz,
  last_finished_at timestamptz,
  gap_from timestamptz,
  gap_to timestamptz,
  leased_until timestamptz not null default 'epoch'
);

insert into darwin_import_state (id) values (1) on conflict (id) do nothing;

-- A search reads one day's runs between two stations, then the earlier runs of those trains
-- by schedule UID. A station index over every run would cost about a third of the stored size.
create index if not exists darwin_runs_uid on darwin_runs (uid, service_date);

-- UTC date whose 05:00 snapshot was read for the day's timetable. Darwin loads the day's
-- schedules between 02:00 and 04:00, so that snapshot holds about nine in ten of them.
alter table darwin_import_state add column if not exists timetable_date date;

-- Darwin's reason codes for running late and for a cancellation, as text ("" when none).
alter table darwin_runs add column if not exists late_reason text not null default '';
alter table darwin_runs add column if not exists cancel_reason text not null default '';

-- Finished days, packed: one row per schedule UID and calendar month (see server/darwin/month.ts).
-- A day moves here from darwin_runs once it is a week old, so a search finds the latest day of
-- any day type still in darwin_runs. Postgres compresses the repeated calling patterns, so a
-- day costs about a tenth of its darwin_runs rows. first_day is the earliest day in the row.
create table if not exists darwin_months (
  uid text not null,
  month date not null,
  first_day date not null,
  runs text not null,
  primary key (uid, month)
);

-- Postgres tries to compress only rows over about 2 KB unless told otherwise. A month row
-- reaches that after about a week, so the threshold is lowered for rows earlier in the month.
alter table darwin_months set (toast_tuple_target = 128);

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

-- Runs from HSP serviceDetails, with calls in the darwin_runs text form (server/darwin/run.ts).
create table if not exists hsp_backlog_runs (
  rid text primary key,
  service_date date not null,
  toc text not null default '',
  calls text not null
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

-- HSP's late or cancellation reason code at each call of a stored run, joined by `;` in call
-- order, "" when the run has none. HSP does not say which kind a code is.
alter table hsp_backlog_runs add column if not exists reasons text not null default '';
