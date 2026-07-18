begin;

alter table calendar_accounts
  drop column if exists tasks_inbound_claimed_at;

commit;
