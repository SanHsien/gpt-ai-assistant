-- 0006_schedule_workflows.sql - durable clarification and optimistic event editing.

begin;

alter table confirmations
  add column if not exists operation text not null default 'create',
  add column if not exists target_event_id uuid references events(id) on delete cascade,
  add column if not exists expected_version integer,
  add column if not exists missing_fields text[] not null default '{}'::text[];

alter table confirmations drop constraint if exists confirmations_operation_valid;
alter table confirmations add constraint confirmations_operation_valid
  check (operation in ('create', 'update'));

alter table confirmations drop constraint if exists confirmations_target_valid;
alter table confirmations add constraint confirmations_target_valid
  check (
    (operation = 'create' and target_event_id is null and expected_version is null)
    or
    (operation = 'update' and target_event_id is not null and expected_version is not null)
  );

create index if not exists confirmations_owner_workflow_idx
  on confirmations (owner_id, state, expires_at, created_at desc);

commit;
