-- 0003_job_checkpoints.sql — 把「AI 已完成」與「LINE 已送達」拆成兩個 durable checkpoint。
--
-- 沒有 checkpoint 時，重試一個失敗的 job 會連付費的 AI／生圖一起重跑，所以 LINE event
-- 只能設 max_attempts=1（at-most-once：worker 一被砍，訊息就靜默消失）。
--
-- result      = checkpoint A：AI 產出的回覆訊息（AES-256-GCM envelope，與 payload 同一把金鑰）。
--               有值代表付費工作已完成，重試不必也不得再跑一次。
-- delivered_at = checkpoint B：已成功送達 LINE。有值代表不必再送。
--
-- 兩者合起來的語意：**AI 至多執行一次，送達可重試多次**。
-- 送達之所以能安全重試，是因為 LINE 的 reply token 只能用一次——重送同一個 token
-- 不會產生重複訊息，LINE 會直接拒絕。

begin;

alter table jobs add column if not exists result jsonb;
alter table jobs add column if not exists delivered_at timestamptz;

commit;
