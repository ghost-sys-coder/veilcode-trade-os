-- Integration grants are private. OAuth sessions retain zero direct table access.
create table private.integration_resources (
  purpose text primary key check (purpose in ('MT5', 'MCP')),
  resource text unique not null check (resource ~ '^https?://' and resource !~ '[?#@]'),
  enabled boolean not null default false
);
create table private.integration_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  client_id uuid not null references auth.oauth_clients(id),
  purpose text not null references private.integration_resources(purpose),
  account_id uuid references public.trading_accounts(id),
  resource text not null,
  version bigint not null default 1 check (version > 0),
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','REVOKED')),
  authorization_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_id, client_id),
  check ((purpose = 'MT5' and account_id is not null) or (purpose = 'MCP' and account_id is null))
);
create index integration_grants_account on private.integration_grants(account_id);
create table private.integration_grant_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references private.integration_grants(id),
  actor_user_id uuid not null references auth.users(id),
  event_type text not null check (event_type in ('APPROVED','ACTIVATED','REVOKED')),
  version bigint not null,
  account_id uuid,
  resource text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index integration_grant_events_grant on private.integration_grant_events(grant_id,created_at,id);
alter table private.integration_resources enable row level security;
alter table private.integration_grants enable row level security;
alter table private.integration_grant_events enable row level security;
revoke all on private.integration_resources, private.integration_grants, private.integration_grant_events from public, anon, authenticated;

create function private.reject_integration_audit_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Integration audit events are append-only.' using errcode = '42501';
end;
$$;
revoke all on function private.reject_integration_audit_mutation() from public, anon, authenticated;
create trigger integration_grant_events_immutable before update or delete on private.integration_grant_events
for each row execute function private.reject_integration_audit_mutation();

create function private.approve_integration_grant(p_authorization_id text, p_purpose text, p_account_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request auth.oauth_authorizations;
  configured private.integration_resources;
  previous private.integration_grants;
  current_grant private.integration_grants;
begin
  perform private.require_direct_browser_session();
  select * into request from auth.oauth_authorizations
    where authorization_id = p_authorization_id and user_id = auth.uid()
      and expires_at > clock_timestamp() and status::text in ('pending','approved') for update;
  if not found then raise exception 'Invalid authorization request.' using errcode = '42501'; end if;
  select * into configured from private.integration_resources where purpose = p_purpose and enabled;
  if not found or request.resource is distinct from configured.resource
    or lower(request.code_challenge_method::text) is distinct from 's256' then
    raise exception 'Resource-bound S256 authorization is required.' using errcode = '42501';
  end if;
  if (p_purpose = 'MT5' and not exists (select 1 from public.trading_accounts
      where id = p_account_id and user_id = auth.uid()))
    or (p_purpose = 'MCP' and p_account_id is not null) then
    raise exception 'Invalid account scope.' using errcode = '42501';
  end if;
  -- Serialize approvals for the same owner/client; retries do not change versions.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || request.client_id::text, 0));
  select * into previous from private.integration_grants
    where owner_id = auth.uid() and client_id = request.client_id for update;
  if found and previous.authorization_id = p_authorization_id then
    if previous.revoked_at is not null or previous.account_id is distinct from p_account_id
      or previous.purpose <> p_purpose then
      raise exception 'Authorization cannot be reused.' using errcode = '42501';
    end if;
    return jsonb_build_object('id',previous.id,'version',previous.version::text,'purpose',previous.purpose,
      'account_id',previous.account_id,'resource',previous.resource,'client_id',previous.client_id);
  end if;
  -- A revoked grant needs a new explicit pending authorization, never auto-consent.
  if request.status::text <> 'pending' then
    raise exception 'A new explicit consent is required.' using errcode = '42501';
  end if;
  insert into private.integration_grants(owner_id,client_id,purpose,account_id,resource,authorization_id)
    values(auth.uid(),request.client_id,p_purpose,p_account_id,configured.resource,p_authorization_id)
    on conflict(owner_id,client_id) do update set purpose = excluded.purpose,
      account_id = excluded.account_id, resource = excluded.resource, authorization_id = excluded.authorization_id,
      version = private.integration_grants.version + 1, status = 'PENDING', revoked_at = null, updated_at = clock_timestamp()
    returning * into current_grant;
  insert into private.integration_grant_events(grant_id,actor_user_id,event_type,version,account_id,resource)
    values(current_grant.id,auth.uid(),'APPROVED',current_grant.version,current_grant.account_id,current_grant.resource);
  return jsonb_build_object('id',current_grant.id,'version',current_grant.version::text,'purpose',current_grant.purpose,
    'account_id',current_grant.account_id,'resource',current_grant.resource,'client_id',current_grant.client_id);
end;
$$;

create function private.revoke_integration_grant(p_grant_id uuid, p_expected_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g private.integration_grants;
begin
  perform private.require_direct_browser_session();
  select * into g from private.integration_grants where id = p_grant_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Grant unavailable.' using errcode = '42501'; end if;
  if g.version::text <> p_expected_version then raise exception 'Grant version conflict.' using errcode = '40001'; end if;
  if g.revoked_at is null then
    update private.integration_grants set status = 'REVOKED', revoked_at = clock_timestamp(), updated_at = clock_timestamp() where id = g.id;
    insert into private.integration_grant_events(grant_id,actor_user_id,event_type,version,account_id,resource)
      values(g.id,auth.uid(),'REVOKED',g.version,g.account_id,g.resource);
  end if;
  return jsonb_build_object('id',g.id,'revoked',true,'client_id',g.client_id);
end;
$$;

create function private.list_integration_grants() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_direct_browser_session();
  return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'client_id',g.client_id,
    'purpose',g.purpose,'account_id',g.account_id,'resource',g.resource,'version',g.version::text,
    'status',g.status,'created_at',g.created_at,'revoked_at',g.revoked_at) order by g.created_at,g.id)
    from private.integration_grants g where g.owner_id = auth.uid()),'[]'::jsonb);
end;
$$;

-- Called on every request AND inside every future mutation transaction.
create function private.authorize_integration(p_resource text, p_purpose text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g private.integration_grants; claims jsonb := auth.jwt();
begin
  select * into g from private.integration_grants
    where owner_id = auth.uid() and id::text = claims->>'trade_os_grant_id'
      and client_id::text = claims->>'client_id' and version::text = claims->>'trade_os_grant_version'
      and purpose = p_purpose and resource = p_resource and status = 'ACTIVE' and revoked_at is null for share;
  if not found or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'exp')::numeric,0) <= extract(epoch from clock_timestamp())
    or not exists(select 1 from private.integration_resources
      where purpose = g.purpose and resource = g.resource and enabled)
    or claims->>'trade_os_resource' is distinct from p_resource
    or not (claims->'aud' = to_jsonb(p_resource) or claims->'aud' @> jsonb_build_array(p_resource))
    or not exists(select 1 from auth.sessions s where s.id::text = claims->>'session_id'
      and s.user_id = auth.uid() and s.oauth_client_id = g.client_id
      and s.created_at >= g.updated_at
      and (s.not_after is null or s.not_after > clock_timestamp()))
    or not exists(select 1 from auth.oauth_consents c where c.user_id = auth.uid()
      and c.client_id = g.client_id and c.revoked_at is null) then
    raise exception 'Integration access denied.' using errcode = '42501';
  end if;
  return jsonb_build_object('user_id',g.owner_id,'client_id',g.client_id,'grant_id',g.id,
    'grant_version',g.version::text,'purpose',g.purpose,'account_id',g.account_id,'resource',g.resource);
end;
$$;

-- Token hook binds signed claims to the approved grant, including during refresh.
-- Direct browser tokens are unchanged; user_metadata is never authority.
create function private.integration_access_token_hook(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare claims jsonb := event->'claims'; g private.integration_grants;
begin
  if claims->>'client_id' is null then return event; end if;
  select * into g from private.integration_grants where owner_id::text = event->>'user_id'
    and client_id::text = claims->>'client_id' and status = 'ACTIVE' and revoked_at is null;
  if not found or not exists(select 1 from private.integration_resources
    where purpose = g.purpose and resource = g.resource and enabled) then
    raise exception 'An active integration grant is required.' using errcode = '42501';
  end if;
  -- Reapproval never revives a refresh credential from an older grant version.
  if not exists(select 1 from auth.sessions s where s.id::text = claims->>'session_id'
    and s.user_id = g.owner_id and s.oauth_client_id = g.client_id and s.created_at >= g.updated_at
    and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'A new integration session is required.' using errcode = '42501';
  end if;
  claims := claims || jsonb_build_object('aud',jsonb_build_array('authenticated',g.resource),
    'trade_os_grant_id',g.id,'trade_os_grant_version',g.version::text,'trade_os_resource',g.resource);
  return jsonb_set(event,'{claims}',claims);
end;
$$;
revoke all on function private.integration_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.integration_access_token_hook(jsonb) to supabase_auth_admin;

-- Public wrappers are invokers; privileged implementations stay unexposed.
create function public.approve_integration_grant(p_authorization_id text, p_purpose text, p_account_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.approve_integration_grant(p_authorization_id,p_purpose,p_account_id);
$$;
create function public.revoke_integration_grant(p_grant_id uuid, p_expected_version text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.revoke_integration_grant(p_grant_id,p_expected_version);
$$;
create function public.list_integration_grants() returns jsonb
language sql security invoker set search_path = '' as $$ select private.list_integration_grants(); $$;
create function public.authorize_integration(p_resource text, p_purpose text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.authorize_integration(p_resource,p_purpose); $$;

revoke all on function private.approve_integration_grant(text,text,uuid), private.revoke_integration_grant(uuid,text),
  private.list_integration_grants(), private.authorize_integration(text,text),
  public.approve_integration_grant(text,text,uuid), public.revoke_integration_grant(uuid,text),
  public.list_integration_grants(), public.authorize_integration(text,text) from public, anon;
grant execute on function private.approve_integration_grant(text,text,uuid), private.revoke_integration_grant(uuid,text),
  private.list_integration_grants(), private.authorize_integration(text,text),
  public.approve_integration_grant(text,text,uuid), public.revoke_integration_grant(uuid,text),
  public.list_integration_grants(), public.authorize_integration(text,text) to authenticated;
