-- Setup metadata is not application access. OAuth/grant/collector gates are unchanged.
create table private.integration_setup_policies (
  purpose text primary key references private.integration_resources(purpose),
  enabled boolean not null default false
);
insert into private.integration_setup_policies(purpose) select purpose from private.integration_resources;
create table private.integration_setup_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  purpose text not null references private.integration_resources(purpose),
  client_kind text not null check (client_kind in ('MT5_WINDOWS','CODEX','CLAUDE_CODE','GEMINI_CLI')),
  account_id uuid references public.trading_accounts(id),
  resource text not null,
  callback_uri text not null,
  client_id uuid unique references auth.oauth_clients(id),
  status text not null default 'REGISTERING' check (status in ('REGISTERING','READY')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(owner_id,operation_id),
  check ((purpose='MT5' and client_kind='MT5_WINDOWS' and account_id is not null)
    or (purpose='MCP' and client_kind<>'MT5_WINDOWS' and account_id is null)),
  check ((status='READY')=(client_id is not null)),
  check (callback_uri='http://127.0.0.1:' || case client_kind
    when 'MT5_WINDOWS' then '9876' when 'CODEX' then '9878'
    when 'CLAUDE_CODE' then '9880' when 'GEMINI_CLI' then '9882' end || '/callback')
);
create index integration_setup_profiles_account on private.integration_setup_profiles(account_id);
create index integration_setup_profiles_purpose on private.integration_setup_profiles(purpose);
create table private.integration_setup_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references private.integration_setup_profiles(id),
  actor_user_id uuid not null references auth.users(id),
  operation_id uuid not null,
  event_type text not null check(event_type in ('RESERVED','PUBLIC_CLIENT_REGISTERED')),
  version bigint not null,
  created_at timestamptz not null default clock_timestamp()
);
create index integration_setup_events_profile on private.integration_setup_events(profile_id,created_at,id);
create index integration_setup_events_actor on private.integration_setup_events(actor_user_id);
alter table private.integration_setup_policies enable row level security;
alter table private.integration_setup_profiles enable row level security;
alter table private.integration_setup_events enable row level security;
revoke all on private.integration_setup_policies,private.integration_setup_profiles,private.integration_setup_events from public,anon,authenticated;
create trigger integration_setup_events_immutable before update or delete on private.integration_setup_events
  for each row execute function private.reject_integration_audit_mutation();

create function private.integration_setup_view(p private.integration_setup_profiles) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',p.id,'purpose',p.purpose,'clientKind',p.client_kind,
    'accountId',p.account_id,'resource',p.resource,'callbackUri',p.callback_uri,
    'clientId',p.client_id,'status',p.status,'version',p.version::text,
    'createdAt',p.created_at,'updatedAt',p.updated_at);
$$;
revoke all on function private.integration_setup_view(private.integration_setup_profiles) from public,anon,authenticated;

create function private.reserve_integration_setup(p_operation_id uuid,p_client_kind text,p_account_id uuid,p_resource text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  profile private.integration_setup_profiles;
  purpose_value text;
  callback_value text;
  hash_value text;
begin
  perform private.require_direct_browser_session();
  if p_operation_id is null or p_client_kind not in ('MT5_WINDOWS','CODEX','CLAUDE_CODE','GEMINI_CLI') or p_client_kind is null then
    raise exception 'Invalid setup request.' using errcode='22023';
  end if;
  purpose_value:=case when p_client_kind='MT5_WINDOWS' then 'MT5' else 'MCP' end;
  callback_value:='http://127.0.0.1:' || case p_client_kind when 'MT5_WINDOWS' then '9876'
    when 'CODEX' then '9878' when 'CLAUDE_CODE' then '9880' when 'GEMINI_CLI' then '9882' end || '/callback';
  if not exists(select 1 from private.integration_resources r join private.integration_setup_policies s using(purpose)
    where r.purpose=purpose_value and r.resource=p_resource and r.enabled and s.enabled) then
    raise exception 'Integration setup is disabled.' using errcode='42501';
  end if;
  if (purpose_value='MT5' and not exists(select 1 from public.trading_accounts a where a.id=p_account_id and a.user_id=auth.uid()))
    or (purpose_value='MCP' and p_account_id is not null) then
    raise exception 'Invalid setup account.' using errcode='42501';
  end if;
  hash_value:=encode(sha256(convert_to(jsonb_build_object('clientKind',p_client_kind,'accountId',p_account_id,'resource',p_resource)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('integration-setup:' || auth.uid()::text,0));
  select * into profile from private.integration_setup_profiles where owner_id=auth.uid() and operation_id=p_operation_id for update;
  if found then
    if profile.request_hash<>hash_value then raise exception 'Setup operation conflict.' using errcode='PT409'; end if;
    return private.integration_setup_view(profile) || jsonb_build_object('createAllowed',false);
  end if;
  if (select count(*) from private.integration_setup_profiles where owner_id=auth.uid())>=20 then
    raise exception 'Setup profile limit reached.' using errcode='54000';
  end if;
  insert into private.integration_setup_profiles(owner_id,operation_id,request_hash,purpose,client_kind,account_id,resource,callback_uri)
    values(auth.uid(),p_operation_id,hash_value,purpose_value,p_client_kind,p_account_id,p_resource,callback_value) returning * into profile;
  insert into private.integration_setup_events(profile_id,actor_user_id,operation_id,event_type,version)
    values(profile.id,auth.uid(),p_operation_id,'RESERVED',profile.version);
  return private.integration_setup_view(profile) || jsonb_build_object('createAllowed',true);
end;
$$;

-- Recovery never creates a provider client, approves a grant or selects an account.
-- Exactly one independently verified provider record must match the reserved name.
create function private.reconcile_integration_setup(p_profile_id uuid,p_expected_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile private.integration_setup_profiles; provider auth.oauth_clients; candidates bigint;
begin
  perform private.require_direct_browser_session();
  select * into profile from private.integration_setup_profiles where id=p_profile_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Setup profile unavailable.' using errcode='42501'; end if;
  if profile.version::text is distinct from p_expected_version then raise exception 'Setup version conflict.' using errcode='PT409'; end if;
  if not exists(select 1 from private.integration_resources r join private.integration_setup_policies s using(purpose)
    where r.purpose=profile.purpose and r.resource=profile.resource and r.enabled and s.enabled) then
    raise exception 'Integration setup is disabled.' using errcode='42501';
  end if;
  if profile.purpose='MT5' and not exists(select 1 from public.trading_accounts a where a.id=profile.account_id and a.user_id=auth.uid()) then
    raise exception 'Invalid setup account.' using errcode='42501';
  end if;
  select count(*) into candidates from auth.oauth_clients where deleted_at is null
    and client_name='Trade OS ' || profile.client_kind || ' setup ' || profile.id::text;
  if candidates=0 then
    if profile.status='READY' then raise exception 'Provider registration unavailable.' using errcode='42501'; end if;
    return private.integration_setup_view(profile);
  end if;
  if candidates<>1 then raise exception 'Ambiguous provider registration.' using errcode='42501'; end if;
  select * into provider from auth.oauth_clients where deleted_at is null
    and client_name='Trade OS ' || profile.client_kind || ' setup ' || profile.id::text;
  if provider.client_type::text<>'public' or provider.registration_type::text<>'manual' or provider.token_endpoint_auth_method is distinct from 'none'
    or provider.redirect_uris is distinct from profile.callback_uri
    or cardinality(string_to_array(provider.grant_types,','))<>2
    or not string_to_array(provider.grant_types,',') @> array['authorization_code','refresh_token'] then
    raise exception 'Provider registration mismatch.' using errcode='42501';
  end if;
  if profile.status='READY' then
    if profile.client_id<>provider.id then raise exception 'Provider registration mismatch.' using errcode='42501'; end if;
    return private.integration_setup_view(profile);
  end if;
  update private.integration_setup_profiles set client_id=provider.id,status='READY',version=version+1,updated_at=clock_timestamp()
    where id=profile.id returning * into profile;
  insert into private.integration_setup_events(profile_id,actor_user_id,operation_id,event_type,version)
    values(profile.id,auth.uid(),profile.operation_id,'PUBLIC_CLIENT_REGISTERED',profile.version);
  return private.integration_setup_view(profile);
end;
$$;

create function private.list_integration_setups() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_direct_browser_session();
  return jsonb_build_object('profiles',coalesce((select jsonb_agg(private.integration_setup_view(p) order by p.created_at,p.id)
    from private.integration_setup_profiles p where p.owner_id=auth.uid()),'[]'::jsonb),
    'databaseEnabled',jsonb_build_object('MT5',exists(select 1 from private.integration_setup_policies s
      join private.integration_resources r using(purpose) where s.purpose='MT5' and s.enabled and r.enabled),
      'MCP',exists(select 1 from private.integration_setup_policies s
      join private.integration_resources r using(purpose) where s.purpose='MCP' and s.enabled and r.enabled)));
end;
$$;
create function public.reserve_integration_setup(p_operation_id uuid,p_client_kind text,p_account_id uuid,p_resource text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.reserve_integration_setup(p_operation_id,p_client_kind,p_account_id,p_resource);
$$;
create function public.reconcile_integration_setup(p_profile_id uuid,p_expected_version text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.reconcile_integration_setup(p_profile_id,p_expected_version);
$$;
create function public.list_integration_setups() returns jsonb
language sql security invoker set search_path='' as $$ select private.list_integration_setups(); $$;
revoke all on function private.reserve_integration_setup(uuid,text,uuid,text),private.reconcile_integration_setup(uuid,text),
  private.list_integration_setups(),public.reserve_integration_setup(uuid,text,uuid,text),public.reconcile_integration_setup(uuid,text),
  public.list_integration_setups() from public,anon;
grant execute on function private.reserve_integration_setup(uuid,text,uuid,text),private.reconcile_integration_setup(uuid,text),
  private.list_integration_setups(),public.reserve_integration_setup(uuid,text,uuid,text),public.reconcile_integration_setup(uuid,text),
  public.list_integration_setups() to authenticated;

-- Self-service public clients are owner/profile bound, unlike legacy shared clients.
create function private.enforce_setup_grant_binding() returns trigger
language plpgsql set search_path='' as $$
declare profile private.integration_setup_profiles;
begin
  begin
    select p.* into strict profile from private.integration_setup_profiles p where p.client_id=new.client_id
      or exists(select 1 from auth.oauth_clients c where c.id=new.client_id
        and c.client_name='Trade OS ' || p.client_kind || ' setup ' || p.id::text);
  exception
    when no_data_found then return new; -- legacy shared clients
    when too_many_rows then raise exception 'Setup grant binding mismatch.' using errcode='42501';
  end;
  if (profile.status<>'READY' or profile.owner_id<>new.owner_id or profile.purpose<>new.purpose
    or profile.resource<>new.resource or profile.account_id is distinct from new.account_id) then
    raise exception 'Setup grant binding mismatch.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_setup_grant_binding() from public,anon,authenticated;
create trigger integration_setup_grant_binding before insert or update on private.integration_grants
  for each row execute function private.enforce_setup_grant_binding();

-- These three legacy integration RPCs also cross PostgREST. Domain version
-- conflicts are HTTP 409, not serialization failures (40001 can retry forever).
-- Preserve their complete definitions, ownership, ACLs and checks; replace only
-- the one deliberate conflict code in each fixed, reviewed function.
do $$
declare target regprocedure; definition text;
begin
  foreach target in array array['private.revoke_integration_grant(uuid,text)'::regprocedure,
    'private.activate_integration_grant(text,text)'::regprocedure,
    'private.application_mt5_set_connection_state_impl(uuid,text,uuid,text,text)'::regprocedure] loop
    definition:=pg_get_functiondef(target);
    if (select count(*) from regexp_matches(definition,'errcode\s*=\s*''40001''','g'))<>1 then
      raise exception 'Unexpected integration RPC conflict definition.';
    end if;
    execute regexp_replace(definition,'errcode\s*=\s*''40001''','errcode=''PT409''','g');
  end loop;
end;
$$;
