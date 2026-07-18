-- 回滾 Calendar inbound sync token 欄位。

begin;

alter table calendar_accounts
  drop column if exists sync_token,
  drop column if exists last_pulled_at;

commit;
