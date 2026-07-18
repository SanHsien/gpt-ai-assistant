-- 0008_task_metadata.sql — Phase 2：任務優先度與標籤。

begin;

alter table tasks
  add column if not exists priority text not null default 'normal'
    check (priority in ('high', 'normal', 'low')),
  add column if not exists tags text[] not null default '{}'::text[];

-- 列表以 status + priority + due_at 排序，補一條複合索引。
create index if not exists tasks_owner_priority_idx on tasks (owner_id, status, priority, due_at);

commit;
