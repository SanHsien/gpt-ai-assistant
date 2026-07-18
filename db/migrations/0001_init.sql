-- 0001_init.sql — Phase 0 核心 schema：users / processed_events / jobs / runs
-- 時間一律以 UTC (timestamptz) 儲存；使用者原始 IANA timezone 另存於 users.timezone。
-- 需要 Postgres 內建 gen_random_uuid()（Supabase / Postgres 13+ 皆內建）。

begin;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  channel_user_key text not null unique,
  timezone text,
  locale text,
  quiet_hours jsonb,
  consent jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- webhook 事件冪等：webhookEventId 唯一，取代目前的 process-memory 去重。
create table if not exists processed_events (
  webhook_event_id text primary key,
  received_at timestamptz not null default now()
);

-- durable queue 基底：以 jobs 表 + SELECT ... FOR UPDATE SKIP LOCKED 作 at-least-once 佇列，
-- 不強制依賴 pgmq 擴充；lease / attempts / status 支援 retry 與 dead-letter。
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  status text not null default 'pending',
  idempotency_key text unique,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_attempts_nonnegative check (attempts >= 0),
  constraint jobs_max_attempts_positive check (max_attempts >= 1),
  constraint jobs_status_valid check (status in ('pending', 'processing', 'done', 'dead')),
  constraint jobs_lease_consistent check (
    (status = 'processing' and lease_until is not null and lease_token is not null)
    or (status <> 'processing' and lease_until is null and lease_token is null)
  )
);

create index if not exists jobs_pending_idx on jobs (run_at) where status = 'pending';
create index if not exists jobs_expired_lease_idx on jobs (lease_until) where status = 'processing';

-- run trace：每次能力執行的成本 / 模型 / 狀態；預設不保存完整對話內容或憑證。
create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id text,
  capability text,
  model text,
  duration_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric(12, 6),
  status text not null default 'started' check (status in ('started', 'done', 'error')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists runs_event_idx on runs (webhook_event_id);

commit;
