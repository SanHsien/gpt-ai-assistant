begin;

drop index if exists events_owner_provider_event_idx;
alter table events drop constraint if exists events_sync_status_valid;
alter table events drop column if exists sync_error_code;
alter table events drop column if exists synced_at;
alter table events drop column if exists sync_status;
alter table events drop column if exists provider_event_id;
drop table if exists oauth_states;
drop table if exists calendar_accounts;

commit;
