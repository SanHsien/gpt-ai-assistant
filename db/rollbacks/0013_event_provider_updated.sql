-- 回滾 events.provider_updated_at 欄位。

begin;

alter table events
  drop column if exists provider_updated_at;

commit;
