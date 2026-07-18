-- 0013_event_provider_updated.sql — Phase 5A inbound：記錄本地事件最後一次「已吸收」的
-- Google 版本時間戳（events.updated / RFC3339），用來擋自身 outbound echo 與重複輪詢，
-- 並偵測真正的外部修改。

begin;

alter table events
  add column if not exists provider_updated_at timestamptz;

commit;
