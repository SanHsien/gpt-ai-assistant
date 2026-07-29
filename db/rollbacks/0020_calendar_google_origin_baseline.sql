-- Roll back the Calendar inbound v3 cursor contract to v2.

begin;

update calendar_accounts
set sync_query_version = 2
where sync_query_version = 3;

alter table calendar_accounts
  alter column sync_query_version set default 2;

alter table calendar_accounts
  drop column if exists inbound_page_token,
  drop column if exists inbound_baseline_time_min,
  drop column if exists inbound_baseline_generation,
  drop column if exists inbound_claimed_at,
  drop column if exists inbound_claim_token;

-- v2 cannot maintain Google-origin rows. Cancel their pending LINE reminders
-- before deleting the rows, otherwise the downgraded runtime could still send them.
update jobs
set status = 'done', lease_until = null, lease_token = null, updated_at = now()
where status = 'pending'
  and exists (
    select 1
    from events
    where inbound_origin = true
      and jobs.idempotency_key like 'line-reminder:' || events.id::text || ':%'
  );

delete from events
where inbound_origin = true;

drop index if exists events_owner_inbound_baseline_idx;

alter table events
  drop column if exists inbound_baseline_generation,
  drop column if exists inbound_origin;

commit;
