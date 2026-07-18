-- 0005_reminders_and_completion.sql - encrypted LINE target, reminder job mapping,
-- and a durable completed state for calendar events.

begin;

alter table users add column if not exists channel_target jsonb;

alter table events add column if not exists reminder_job_id uuid references jobs(id) on delete set null;
alter table events add column if not exists completed_at timestamptz;

alter table events drop constraint if exists events_status_check;
alter table events drop constraint if exists events_status_valid;
alter table events add constraint events_status_valid
  check (status in ('confirmed', 'cancelled', 'completed'));

create index if not exists events_reminder_job_idx
  on events (reminder_job_id)
  where reminder_job_id is not null;

commit;
