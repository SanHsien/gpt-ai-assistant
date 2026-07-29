-- 0020_calendar_google_origin_baseline.sql
-- Calendar inbound v3 imports the safe Google-origin reminder baseline.
-- Existing v2 rows intentionally keep version 2 so the new runtime clears their
-- cursor once; newly linked accounts start directly at version 3.

begin;

alter table events
  add column if not exists inbound_origin boolean not null default false,
  add column if not exists inbound_baseline_generation uuid;

create index if not exists events_owner_inbound_baseline_idx
  on events (owner_id, inbound_baseline_generation)
  where inbound_origin = true;

alter table calendar_accounts
  add column if not exists inbound_claim_token uuid,
  add column if not exists inbound_claimed_at timestamptz,
  add column if not exists inbound_baseline_generation uuid,
  add column if not exists inbound_baseline_time_min timestamptz,
  add column if not exists inbound_page_token text;

alter table calendar_accounts
  alter column sync_query_version set default 3;

commit;
