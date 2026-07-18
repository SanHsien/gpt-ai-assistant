-- 0004_google_calendar.sql — Google Calendar OAuth、加密憑證與事件同步映射。

begin;

create table if not exists calendar_accounts (
  owner_id uuid primary key references users(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  credentials jsonb not null,
  scopes text[] not null default '{}'::text[],
  calendar_id text not null default 'primary',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 只保存 state 的 SHA-256，不把可用的 OAuth state 明文落地；DELETE ... RETURNING
-- 讓 callback 只能消費一次。
create table if not exists oauth_states (
  state_hash char(64) primary key,
  owner_id uuid not null references users(id) on delete cascade,
  code_verifier jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_states_expiry_idx on oauth_states (expires_at);

alter table events add column if not exists provider_event_id text;
alter table events add column if not exists sync_status text not null default 'pending';
alter table events add column if not exists synced_at timestamptz;
alter table events add column if not exists sync_error_code text;

alter table events drop constraint if exists events_sync_status_valid;
alter table events add constraint events_sync_status_valid
  check (sync_status in ('pending', 'synced', 'error'));

create unique index if not exists events_owner_provider_event_idx
  on events (owner_id, provider_event_id)
  where provider_event_id is not null;

commit;
