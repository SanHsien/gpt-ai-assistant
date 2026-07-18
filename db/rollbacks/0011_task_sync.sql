-- 回滾任務同步映射欄位。

begin;

drop index if exists tasks_sync_pending_idx;
alter table tasks
  drop column if exists provider_task_id,
  drop column if exists sync_status,
  drop column if exists synced_at;

commit;
