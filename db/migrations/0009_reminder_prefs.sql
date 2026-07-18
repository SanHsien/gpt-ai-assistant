-- 0009_reminder_prefs.sql — Phase 3：提醒偏好。安靜時段沿用既有 users.quiet_hours（jsonb），
-- 這裡只加「全域暫停」旗標。

begin;

alter table users add column if not exists reminders_paused boolean not null default false;

commit;
