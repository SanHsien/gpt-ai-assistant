-- 0012_calendar_sync_token.sql — Phase 5A：Google Calendar inbound sync（sync token 輪詢）。
-- sync_token = Google events.list 增量同步 token；last_pulled_at 用來節流輪詢。

begin;

alter table calendar_accounts
  add column if not exists sync_token text,
  add column if not exists last_pulled_at timestamptz;

commit;
