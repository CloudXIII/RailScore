-- One row per HSP run (RID). The payload is the serviceDetails response as received.
create table if not exists hsp_runs (
  rid text primary key,
  service_date date not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

-- One row per serviceMetrics block (stations, window, day type, Monday-to-Sunday week),
-- so a repeat or overlapping search on any server instance skips HSP.
create table if not exists hsp_service_lists (
  slice_key text primary key,
  services jsonb not null,
  fetched_at timestamptz not null default now()
);

-- Last date a stored block covers. Rows from before blocks have none and are not read.
alter table hsp_service_lists add column if not exists covered_to date;

-- A single token bucket shared by every server instance, so concurrent users
-- together stay under one HSP request rate.
create table if not exists hsp_rate_limit (
  id smallint primary key,
  tokens double precision not null,
  updated_at timestamptz not null default clock_timestamp()
);

insert into hsp_rate_limit (id, tokens) values (1, 0) on conflict (id) do nothing;

-- serviceMetrics calls in flight, one row per slot, shared by every server instance.
-- The app uses the first HSP_LIST_SLOT_COUNT rows (default 2). The insert covers the
-- highest list-worker count, 12, so two searches share that many calls in flight.
create table if not exists hsp_list_slots (
  slot smallint primary key,
  owner text,
  started_at timestamptz not null default 'epoch',
  leased_until timestamptz not null default 'epoch'
);

insert into hsp_list_slots (slot)
select generate_series(1, 12)
on conflict (slot) do nothing;

-- HSP calls counted for one London calendar day. The row stops growing at the daily limit.
create table if not exists hsp_daily_calls (
  day date primary key,
  calls integer not null
);

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

-- One in-flight calculation per service. A second request reads stored runs
-- instead of calling HSP. The lease expires if the holder stops.
create table if not exists hsp_calculation_lock (
  service_key text primary key,
  owner text not null,
  leased_until timestamptz not null
);
