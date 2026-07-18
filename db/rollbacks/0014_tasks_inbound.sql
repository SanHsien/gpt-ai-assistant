-- 回滾 Google Tasks inbound 輪詢水位欄位。

begin;

alter table calendar_accounts
  drop column if exists tasks_last_pulled_at;

commit;
