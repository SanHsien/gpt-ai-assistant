-- 0011_task_sync.sql — Phase 2：任務單向同步到 Google Tasks 的映射欄位。
-- provider_task_id = Google Tasks 端的 id；sync_status 記同步狀態；不落地 OAuth token。

begin;

alter table tasks
  add column if not exists provider_task_id text,
  add column if not exists sync_status text not null default 'none'
    check (sync_status in ('none', 'pending', 'synced', 'error')),
  add column if not exists synced_at timestamptz;

-- 回填未同步任務用。
create index if not exists tasks_sync_pending_idx
  on tasks (owner_id, sync_status) where sync_status <> 'synced';

commit;
