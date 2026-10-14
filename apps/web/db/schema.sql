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

-- HSP calls counted for one London calendar day. The row stops growing at the daily limit.
create table if not exists hsp_daily_calls (
  day date primary key,
  calls integer not null
);

-- One in-flight calculation per service. A second request reads stored runs
-- instead of calling HSP. The lease expires if the holder stops.
create table if not exists hsp_calculation_lock (
  service_key text primary key,
  owner text not null,
  leased_until timestamptz not null
);
