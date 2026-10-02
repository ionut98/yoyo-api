-- Admin-gated provider claim requests + Google Calendar FreeBusy connections.
-- Apply on the YOYO Supabase DB before deploying matching yoyo-api routes.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_roles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

create table if not exists public.provider_claim_requests (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  requester_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])),
  message text,
  contact_phone text,
  contact_email text,
  proof_url text,
  admin_note text,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_claim_requests_status_idx
  on public.provider_claim_requests (status, created_at desc);

create index if not exists provider_claim_requests_provider_idx
  on public.provider_claim_requests (provider_id);

create unique index if not exists provider_claim_requests_pending_unique
  on public.provider_claim_requests (provider_id, requester_user_id)
  where status = 'pending';

alter table public.provider_claim_requests enable row level security;

drop policy if exists "Claim requesters select own" on public.provider_claim_requests;
create policy "Claim requesters select own"
  on public.provider_claim_requests
  for select
  to authenticated
  using (
    requester_user_id = (select auth.uid())
    or public.is_admin()
  );

drop policy if exists "Claim requesters insert own" on public.provider_claim_requests;
create policy "Claim requesters insert own"
  on public.provider_claim_requests
  for insert
  to authenticated
  with check (requester_user_id = (select auth.uid()));

drop policy if exists "Claim requesters update own pending" on public.provider_claim_requests;
create policy "Claim requesters update own pending"
  on public.provider_claim_requests
  for update
  to authenticated
  using (
    (
      requester_user_id = (select auth.uid())
      and status = 'pending'
    )
    or public.is_admin()
  )
  with check (
    (
      requester_user_id = (select auth.uid())
      and status in ('pending', 'cancelled')
    )
    or public.is_admin()
  );

create table if not exists public.provider_google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null unique references public.providers (id) on delete cascade,
  google_account_email text,
  refresh_token_encrypted text not null,
  calendar_ids text[] not null default '{}'::text[],
  connected_by uuid references auth.users (id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_google_calendar_connections_provider_idx
  on public.provider_google_calendar_connections (provider_id);

alter table public.provider_google_calendar_connections enable row level security;

drop policy if exists "Members select google calendar connections" on public.provider_google_calendar_connections;
create policy "Members select google calendar connections"
  on public.provider_google_calendar_connections
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.provider_memberships pm
      where pm.provider_id = provider_google_calendar_connections.provider_id
        and pm.user_id = (select auth.uid())
    )
    or public.is_admin()
  );

drop policy if exists "Members manage google calendar connections" on public.provider_google_calendar_connections;
create policy "Members manage google calendar connections"
  on public.provider_google_calendar_connections
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.provider_memberships pm
      where pm.provider_id = provider_google_calendar_connections.provider_id
        and pm.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.provider_memberships pm
      where pm.provider_id = provider_google_calendar_connections.provider_id
        and pm.user_id = (select auth.uid())
    )
  );

comment on table public.provider_claim_requests is
  'Admin-gated requests to claim scraped providers as owner.';

comment on table public.provider_google_calendar_connections is
  'One-way Google Calendar FreeBusy connection per provider (encrypted refresh token).';

create or replace function public.provider_ids_with_owner()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct provider_id
  from public.provider_memberships
  where role = 'owner';
$$;

revoke all on function public.provider_ids_with_owner() from public;
grant execute on function public.provider_ids_with_owner() to authenticated, service_role;

create or replace function public.cleanup_unclaimed_provider_availability()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.provider_availability pa
  where not exists (
    select 1
    from public.provider_memberships pm
    where pm.provider_id = pa.provider_id
      and pm.role = 'owner'
  );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_unclaimed_provider_availability() from public;
grant execute on function public.cleanup_unclaimed_provider_availability() to service_role;
