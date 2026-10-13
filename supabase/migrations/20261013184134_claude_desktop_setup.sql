-- Default-off Desktop onboarding. Existing grants, resources and pilot controls are untouched.
-- Filename aligned to the provider-assigned hosted migration ID after the approved rollout.
alter table private.integration_setup_policies add column claude_desktop_enabled boolean not null default false;
alter table private.integration_setup_policies add constraint desktop_policy_mcp_only
  check (not claude_desktop_enabled or purpose='MCP');

-- Replace only the original single-column client/callback checks, retaining all other constraints.
do $$
declare column_name text; attribute smallint; targets text[]; target text;
begin
  foreach column_name in array array['client_kind','callback_uri'] loop
    select attnum into strict attribute from pg_attribute where attrelid='private.integration_setup_profiles'::regclass and attname=column_name;
    select array_agg(conname::text) into targets from pg_constraint
      where conrelid='private.integration_setup_profiles'::regclass and contype='c'
        and conkey @> array[attribute] and (column_name='callback_uri' or cardinality(conkey)=1);
    if cardinality(targets) is distinct from 1 then raise exception 'Unexpected setup constraints.'; end if;
    foreach target in array targets loop execute format('alter table private.integration_setup_profiles drop constraint %I',target); end loop;
  end loop;
end;
$$;
alter table private.integration_setup_profiles add constraint integration_setup_client_kind
  check (client_kind in ('MT5_WINDOWS','CODEX','CLAUDE_CODE','GEMINI_CLI','CLAUDE_DESKTOP'));
alter table private.integration_setup_profiles add constraint integration_setup_callback_binding
  check (callback_uri='http://127.0.0.1:' || case client_kind
    when 'MT5_WINDOWS' then '9876' when 'CODEX' then '9878' when 'CLAUDE_CODE' then '9880'
    when 'GEMINI_CLI' then '9882' when 'CLAUDE_DESKTOP' then '9884' end || '/callback');

create or replace function private.reserve_integration_setup(p_operation_id uuid,p_client_kind text,p_account_id uuid,p_resource text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile private.integration_setup_profiles; purpose_value text; callback_value text; hash_value text;
begin
  perform private.require_direct_browser_session();
  if p_operation_id is null or p_client_kind is null
    or p_client_kind not in ('MT5_WINDOWS','CODEX','CLAUDE_CODE','GEMINI_CLI','CLAUDE_DESKTOP') then
    raise exception 'Invalid setup request.' using errcode='22023';
  end if;
  purpose_value:=case when p_client_kind='MT5_WINDOWS' then 'MT5' else 'MCP' end;
  callback_value:='http://127.0.0.1:' || case p_client_kind when 'MT5_WINDOWS' then '9876'
    when 'CODEX' then '9878' when 'CLAUDE_CODE' then '9880' when 'GEMINI_CLI' then '9882'
    when 'CLAUDE_DESKTOP' then '9884' end || '/callback';
  if not exists(select 1 from private.integration_resources r join private.integration_setup_policies s using(purpose)
    where r.purpose=purpose_value and r.resource=p_resource and r.enabled and s.enabled
      and (p_client_kind<>'CLAUDE_DESKTOP' or s.claude_desktop_enabled)) then
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

create function private.list_integration_setups_v2() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_direct_browser_session();
  return jsonb_build_object('profiles',coalesce((select jsonb_agg(private.integration_setup_view(p) order by p.created_at,p.id)
    from private.integration_setup_profiles p where p.owner_id=auth.uid()),'[]'::jsonb),
    'databaseEnabled',jsonb_build_object('MT5',exists(select 1 from private.integration_setup_policies s
      join private.integration_resources r using(purpose) where s.purpose='MT5' and s.enabled and r.enabled),
      'MCP',exists(select 1 from private.integration_setup_policies s
      join private.integration_resources r using(purpose) where s.purpose='MCP' and s.enabled and r.enabled)),
    'desktopEnabled',exists(select 1 from private.integration_setup_policies s
      join private.integration_resources r using(purpose) where s.purpose='MCP' and s.enabled and r.enabled and s.claude_desktop_enabled));
end;
$$;
-- Old deployments must never receive an enum they cannot parse.
create or replace function private.list_integration_setups() returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb;
begin
  perform private.require_direct_browser_session();
  state:=private.list_integration_setups_v2();
  return (state-'desktopEnabled') || jsonb_build_object('profiles',coalesce((select jsonb_agg(p order by ordinal)
    from jsonb_array_elements(state->'profiles') with ordinality as entry(p,ordinal)
    where p->>'clientKind' in ('MT5_WINDOWS','CODEX','CLAUDE_CODE','GEMINI_CLI')),'[]'::jsonb));
end;
$$;
create function public.list_integration_setups_v2() returns jsonb
language sql security invoker set search_path='' as $$ select private.list_integration_setups_v2(); $$;
revoke all on function private.list_integration_setups_v2(),public.list_integration_setups_v2() from public,anon;
grant execute on function private.list_integration_setups_v2(),public.list_integration_setups_v2() to authenticated;
