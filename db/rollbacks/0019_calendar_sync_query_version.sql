begin;

alter table calendar_accounts
  drop column if exists sync_query_version;

commit;
