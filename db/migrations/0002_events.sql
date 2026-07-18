-- 0002_events.sql — Phase 1：行程（events）表。時間以 UTC 儲存，原始 IANA timezone 另存。
-- owner_id 外鍵到 users，所有查詢／變更都以 owner 界定範圍。

begin;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  timezone text,
  all_day boolean not null default false,
  location text,
  notes text,
  recurrence jsonb,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_owner_start_idx on events (owner_id, start_at);

-- 確認狀態必須落在 DB；單純 process-memory state machine 無法擋住多 instance 併發。
create table if not exists confirmations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  token text not null,
  draft jsonb not null,
  state text not null default 'draft' check (state in ('draft', 'confirmed', 'cancelled')),
  result_event_id uuid references events(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, token)
);

create index if not exists confirmations_owner_state_idx
  on confirmations (owner_id, state, expires_at);

commit;
