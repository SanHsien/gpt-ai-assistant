-- 0010_weather_subscriptions.sql — Phase 6：每日天氣推播訂閱。
-- next_run_at 為下次推送的 UTC 時刻；cron 每分鐘挑到期的訂閱入列 weather job，重用既有 queue／delivery。

begin;

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  kind text not null default 'weather' check (kind in ('weather')),
  location_label text not null,
  latitude double precision not null,
  longitude double precision not null,
  timezone text,
  hour integer not null default 7 check (hour >= 0 and hour <= 23),
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 同一使用者同一地點只有一筆訂閱。
  unique (owner_id, kind, latitude, longitude)
);

-- 挑「已啟用且到期」的訂閱用。
create index if not exists subscriptions_due_idx
  on subscriptions (next_run_at) where enabled;

commit;
