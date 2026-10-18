-- Draft only. Apply after reviewing the live schema; no source facility/plan writes.
create table if not exists public.spcc_read_api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  key_prefix text not null,
  scope text not null default 'spcc:read' check (scope = 'spcc:read'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index if not exists spcc_read_keys_account_idx on public.spcc_read_api_keys(account_id, created_by);
alter table public.spcc_read_api_keys enable row level security;
revoke all on public.spcc_read_api_keys from public, anon, authenticated;
grant select, insert, update on public.spcc_read_api_keys to service_role;
-- Deliberately no browser policies: only the authenticated, account-authorized
-- key-management edge endpoint can create/revoke keys or return safe metadata.
