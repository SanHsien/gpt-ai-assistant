-- 0016_tasks_inbound_claim.sql - Google Tasks inbound success watermark and claim lease.
-- tasks_last_pulled_at advances only after a successful pull. The separate claim timestamp
-- prevents concurrent polls and expires naturally after TASKS_INBOUND_INTERVAL if a worker dies.

begin;

alter table calendar_accounts
  add column if not exists tasks_inbound_claimed_at timestamptz;

commit;
