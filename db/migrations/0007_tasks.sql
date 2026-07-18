-- 0007_tasks.sql — Phase 2：任務（tasks）表。與行程（events）分開建模，不用零時長行程替代。
-- 無期限任務 due_at 為 null；完成以 status + completed_at 記錄。所有查詢／變更以 owner 界定範圍。

begin;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  title text not null,
  notes text,
  due_at timestamptz,
  timezone text,
  status text not null default 'open' check (status in ('open', 'done')),
  completed_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- status 與 completed_at 必須一致：done 一定有完成時間，open 一定沒有。
  constraint tasks_done_consistent check (
    (status = 'done' and completed_at is not null)
    or (status = 'open' and completed_at is null)
  )
);

create index if not exists tasks_owner_status_idx on tasks (owner_id, status, due_at);

commit;
