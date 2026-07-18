-- 回滾任務優先度與標籤。

begin;

drop index if exists tasks_owner_priority_idx;
alter table tasks
  drop column if exists priority,
  drop column if exists tags;

commit;
