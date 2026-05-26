
-- Extensions for scheduling
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Lock table ─────────────────────────────────────────────────────────────
create table if not exists public.catalog_job_locks (
  lock_name      text primary key,
  locked_at      timestamptz not null default now(),
  heartbeat_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  owner          text,
  metadata       jsonb not null default '{}'::jsonb
);

alter table public.catalog_job_locks enable row level security;

create policy "Admins can view catalog_job_locks"
  on public.catalog_job_locks
  for select
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

-- ── Run history table ──────────────────────────────────────────────────────
create table if not exists public.catalog_job_runs (
  id               uuid primary key default gen_random_uuid(),
  job_name         text not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  ok               boolean,
  processed        integer not null default 0,
  changed          integer not null default 0,
  dirty_enqueued   integer not null default 0,
  override_skips   integer not null default 0,
  failed           integer not null default 0,
  last_error       text,
  payload          jsonb not null default '{}'::jsonb
);

create index if not exists catalog_job_runs_job_started_idx
  on public.catalog_job_runs (job_name, started_at desc);

alter table public.catalog_job_runs enable row level security;

create policy "Admins can view catalog_job_runs"
  on public.catalog_job_runs
  for select
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));
