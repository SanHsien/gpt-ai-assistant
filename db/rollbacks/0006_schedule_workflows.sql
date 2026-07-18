begin;

drop index if exists confirmations_owner_workflow_idx;
alter table confirmations drop constraint if exists confirmations_target_valid;
alter table confirmations drop constraint if exists confirmations_operation_valid;
alter table confirmations
  drop column if exists missing_fields,
  drop column if exists expected_version,
  drop column if exists target_event_id,
  drop column if exists operation;

commit;
