-- 0015_event_reminders.sql — Phase 3：多重（lead）提醒。
-- 既有到點提醒仍存 events.reminder_job_id；本表額外記「提前 N 分鐘」的 lead 提醒 job。
-- 事件刪除時 rows 一併移除（提醒本體由 sendLineReminder 對非 confirmed／不存在事件 no-op）。

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
