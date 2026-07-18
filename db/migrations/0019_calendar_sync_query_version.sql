-- 0019_calendar_sync_query_version.sql - migrate Calendar inbound away from
-- expanded recurring instances. Existing cursors are rebuilt once by v2 code.

begin;

alter table calendar_accounts
  add column if not exists sync_query_version smallint;

update calendar_accounts
set sync_query_version = 1
where sync_query_version is null;

alter table calendar_accounts
  alter column sync_query_version set default 2,
  alter column sync_query_version set not null;

commit;
