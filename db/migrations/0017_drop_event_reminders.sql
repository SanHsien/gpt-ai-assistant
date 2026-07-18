-- 0017_drop_event_reminders.sql - Remove redundant reminder tracking state.
-- Reminder jobs are cancelled by their durable idempotency-key prefix, which also covers
-- recurring occurrences. Keeping a second event_reminders index creates avoidable drift.

begin;

drop table if exists event_reminders;

commit;
