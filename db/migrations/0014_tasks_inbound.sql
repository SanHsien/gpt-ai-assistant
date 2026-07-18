-- 0014_tasks_inbound.sql — Phase 2 inbound：Google Tasks → 本地反向同步。
-- Google Tasks API 無 sync token，改用 updatedMin 增量輪詢；tasks_last_pulled_at 記上次輪詢時刻
-- （下次以它當 updatedMin），與 Calendar 的 last_pulled_at 分開，兩者節流互不影響。

begin;

alter table calendar_accounts
  add column if not exists tasks_last_pulled_at timestamptz;

commit;
