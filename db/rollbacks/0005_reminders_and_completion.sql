begin;

update events set status = 'cancelled' where status = 'completed';
drop index if exists events_reminder_job_idx;
alter table events drop constraint if exists events_status_valid;
alter table events add constraint events_status_check
  check (status in ('confirmed', 'cancelled'));
alter table events drop column if exists completed_at;
alter table events drop column if exists reminder_job_id;
alter table users drop column if exists channel_target;

commit;
