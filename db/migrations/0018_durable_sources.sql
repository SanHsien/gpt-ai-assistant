-- 0018_durable_sources.sql — 6.0 durable-only bot activation state.
-- Raw LINE user/group ids and display names are intentionally not stored.

begin;

create table if not exists bot_sources (
  source_key text primary key,
  source_type text not null,
  is_activated boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_sources_type_valid check (source_type in ('user', 'group'))
);

create index if not exists bot_sources_type_idx on bot_sources (source_type);

-- The app uses a server-side Postgres connection. Keep PostgREST anon/authenticated
-- access closed even when Supabase public-schema default grants are present.
alter table bot_sources enable row level security;

commit;
