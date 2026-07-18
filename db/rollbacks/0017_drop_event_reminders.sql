begin;

create table if not exists event_reminders (
  event_id uuid not null references events(id) on delete cascade,
  offset_minutes integer not null check (offset_minutes > 0),
  job_id uuid references jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, offset_minutes)
);

create index if not exists event_reminders_job_idx
  on event_reminders (job_id) where job_id is not null;

commit;
