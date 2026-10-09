-- Remaining MCP adapters share existing MT5 workflows, not copies of their logic.
create function private.application_mt5_workflow_actor(grant_id uuid,connection_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb; g private.integration_grants;
begin
  if connection_id is not null then return private.application_mt5_mutation_actor(connection_id); end if;
  actor:=private.application_actor();
  if actor->>'actorType' is distinct from 'MCP' then raise exception 'MCP workflow grant required.' using errcode='42501'; end if;
  select * into g from private.integration_grants where id=grant_id and owner_id=auth.uid() and purpose='MT5'
    and status='ACTIVE' and revoked_at is null for share;
  if not found or not exists(select 1 from private.integration_resources where purpose='MT5' and resource=g.resource and enabled) then
    raise exception 'Active MT5 grant required.' using errcode='42501'; end if;
  return actor||jsonb_build_object('mt5AccountId',g.account_id,'mt5GrantId',g.id);
end;$$;
create function private.application_mt5_adapter_actor(connection_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$begin
  if auth.jwt()->>'client_id' is null then return private.mt5_browser_publication_actor(connection_id); end if;
  return private.application_mt5_mutation_actor(connection_id);
end;$$;

do $extract$
declare target record; original text; body text; shared text; core text;
  actor_expression text:='jsonb_build_object(''user_id'',g.owner_id,''client_id'',g.client_id,''grant_id'',g.id,''account_id'',g.account_id,''purpose'',g.purpose,''resource'',g.resource)';
begin
  for target in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
    and p.proname in ('mt5_register_connection','mt5_set_connection_state','mt5_save_symbol_mapping','mt5_classify_cash','mt5_approve_onboarding') loop
    original:=pg_get_functiondef(target.oid);body:=target.prosrc;core:='application_'||target.proname||'_impl';
    shared:=replace(original,'FUNCTION private.'||target.proname||'(','FUNCTION private.'||core||'(');
    shared:=replace(shared,'SECURITY DEFINER','SECURITY INVOKER');
    if target.proname in ('mt5_register_connection','mt5_set_connection_state') then
      if position(actor_expression in shared)=0 then raise exception 'MT5 adapter actor extraction failed.'; end if;
      shared:=replace(shared,'perform private.require_direct_browser_session();',
        'if auth.jwt()->>''client_id'' is null then perform private.require_direct_browser_session(); else perform private.application_actor(); end if;');
      shared:=replace(shared,actor_expression,'case when auth.jwt()->>''client_id'' is null then '||actor_expression||' else private.application_mt5_workflow_actor(g.id,null) end');
    else
      if position('actor:=private.mt5_browser_publication_actor' in shared)=0 then raise exception 'MT5 adapter gate extraction failed.'; end if;
      shared:=replace(shared,'actor:=private.mt5_browser_publication_actor','actor:=private.application_mt5_adapter_actor');
      shared:=replace(shared,'and grant_id=(actor->>''grant_id'')::uuid and account_id=(actor->>''account_id'')::uuid for update;',
        'and grant_id=coalesce((actor->>''mt5GrantId'')::uuid,(actor->>''grant_id'')::uuid) and account_id=coalesce((actor->>''mt5AccountId'')::uuid,(actor->>''account_id'')::uuid) for update;');
    end if;
    shared:=replace(shared,'''actorType'',''BROWSER''','''actorType'',case when actor->>''purpose''=''MCP'' then ''MCP'' else ''BROWSER'' end');
    if target.proname='mt5_register_connection' then
      shared:=replace(shared,'jsonb_build_object(''status'',connection.status)',
        'jsonb_build_object(''actorType'',case when actor->>''purpose''=''MCP'' then ''MCP'' else ''BROWSER'' end,''status'',connection.status)');
    end if;
    execute shared;
    execute format('alter function private.%I(%s) security invoker',core,pg_get_function_identity_arguments(target.oid));
    execute format('revoke all on function private.%I(%s) from public,anon,authenticated,service_role',core,pg_get_function_identity_arguments(target.oid));
    execute replace(original,body,E'begin\n perform private.require_direct_browser_session();\n return private.'||core||'('||array_to_string(target.proargnames,',')||E');\nend;\n');
  end loop;
end;$extract$;

-- Permit explicit selected publication, never a forged collector/automatic request.
do $publication_gate$
declare definition text; old text:='if p_request->>''reviewKind'' is distinct from ''LINK'' then raise exception ''Explicit MCP manual-link review required.'' using errcode=''42501''; end if;';
begin
  definition:=pg_get_functiondef('private.mt5_publication_actor(jsonb)'::regprocedure);
  if position(old in definition)=0 then raise exception 'Expected MCP publication gate missing.'; end if;
  execute replace(definition,old,'if p_request ? ''operationRequest'' or (p_request->>''reviewKind'' is not null and p_request->>''reviewKind''<>''LINK'')
    or (p_request->>''reviewKind'' is null and jsonb_typeof(p_request->''episodeIdentities'') is distinct from ''array'') then
    raise exception ''Explicit selected MCP publication required.'' using errcode=''42501''; end if;');
end;$publication_gate$;

create function private.application_mt5_workflow_validate(request jsonb) returns text
language plpgsql security invoker set search_path='' as $$
declare kind text:=request->>'kind'; command jsonb:=request->'command'; fields text[];
begin
  if jsonb_typeof(request) is distinct from 'object' or request-array['kind','command']<>'{}'::jsonb
    or jsonb_typeof(command) is distinct from 'object' then raise exception 'Invalid MT5 workflow envelope.' using errcode='22023'; end if;
  fields:=case kind
    when 'REGISTER' then array['grantId','operationId','identity']
    when 'CONTROL' then array['connectionId','operationId','version','action','reason']
    when 'SYMBOL_MAPPING' then array['connectionId','operationId','version','snapshotToken','brokerSymbol','instrumentId','reason']
    when 'CASH' then array['connectionId','operationId','version','snapshotToken','ledgerToken','sourceTicket','sourceRevisionId','disposition','adjustmentType','isPerformanceNeutral','existingAdjustmentId','reason']
    when 'ONBOARDING' then array['connectionId','operationId','version','snapshotToken','ledgerToken','reason','openingBaseline','availableHistoryConfirmed']
    when 'PUBLICATION' then array['connectionId','operationId','version','snapshotToken','ledgerToken','openingBaseline','reason','episodeIdentities']
    when 'POLICY' then array['connectionId','operationId','version','snapshotToken','ledgerToken','reason','enabled'] end;
  if fields is null or not(command ?& fields) or command-fields<>'{}'::jsonb or jsonb_typeof(command->'operationId') is distinct from 'string' then
    raise exception 'Invalid MT5 workflow command.' using errcode='22023'; end if;
  perform (command->>'operationId')::uuid;
  if kind<>'REGISTER' and (jsonb_typeof(command->'version') is distinct from 'string' or command->>'version' !~ '^[1-9][0-9]*$'
    or jsonb_typeof(command->'reason') is distinct from 'string' or length(btrim(command->>'reason')) not between 8 and 1000) then
    raise exception 'Valid version and reason required.' using errcode='22023'; end if;
  if kind not in ('REGISTER','CONTROL') and (jsonb_typeof(command->'snapshotToken') is distinct from 'string' or command->>'snapshotToken' !~ '^[a-f0-9]{64}$') then
    raise exception 'Valid source token required.' using errcode='22023'; end if;
  if kind in ('CASH','ONBOARDING','PUBLICATION','POLICY') and (jsonb_typeof(command->'ledgerToken') is distinct from 'string' or command->>'ledgerToken' !~ '^[a-f0-9]{64}$') then
    raise exception 'Valid ledger token required.' using errcode='22023'; end if;
  if kind='POLICY' and jsonb_typeof(command->'enabled') is distinct from 'boolean' then raise exception 'Explicit policy required.' using errcode='22023'; end if;
  return kind;
end;$$;

create function private.application_mt5_workflow_prepare(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare kind text:=private.application_mt5_workflow_validate(request); command jsonb:=request->'command'; actor jsonb; receipt jsonb; operation text; hashed jsonb;
begin
  actor:=private.application_mt5_workflow_actor((command->>'grantId')::uuid,(command->>'connectionId')::uuid);
  operation:=case kind when 'REGISTER' then 'MT5_REGISTER' when 'CONTROL' then 'MT5_CONTROL' when 'SYMBOL_MAPPING' then 'MT5_SYMBOL_MAPPING'
    when 'CASH' then 'MT5_CASH_CLASSIFICATION' when 'ONBOARDING' then 'MT5_ONBOARDING_APPROVAL' when 'PUBLICATION' then 'MT5_PUBLICATION' when 'POLICY' then 'MT5_REVIEW' end;
  hashed:=case when kind in ('REGISTER','CONTROL') then command-'operationId' when kind='POLICY' then command||'{"reviewKind":"POLICY"}'::jsonb else command end;
  receipt:=private.integration_operation_result(actor,(command->>'operationId')::uuid,operation,hashed);
  if receipt is not null then return jsonb_build_object('receipt',receipt); end if;
  if kind='REGISTER' then return '{}'; end if;
  perform 1 from private.mt5_connections where id=(command->>'connectionId')::uuid and owner_id=auth.uid() for update;
  if not exists(select 1 from private.mt5_connections c where c.id=(command->>'connectionId')::uuid and c.version::text=command->>'version'
    and (kind='CONTROL' or private.mt5_source_snapshot_token(c.id)=command->>'snapshotToken')
    and (kind in ('CONTROL','SYMBOL_MAPPING') or private.mt5_account_ledger_token(c.account_id)=command->>'ledgerToken')) then
    raise exception 'MT5 workflow evidence changed.' using errcode='40001'; end if;
  if kind in ('CONTROL','SYMBOL_MAPPING','POLICY') then return '{}'; end if;
  return private.application_integration_read(jsonb_build_object('action','MT5_SNAPSHOT','connectionId',command->>'connectionId'));
end;$$;

create function private.application_mt5_workflow_write(request jsonb,proposal jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare kind text:=private.application_mt5_workflow_validate(request); command jsonb:=request->'command';
begin
  perform private.application_mt5_workflow_actor((command->>'grantId')::uuid,(command->>'connectionId')::uuid);
  case kind
    when 'REGISTER' then return private.application_mt5_register_connection_impl((command->>'grantId')::uuid,(command->>'operationId')::uuid,command->'identity');
    when 'CONTROL' then return private.application_mt5_set_connection_state_impl((command->>'connectionId')::uuid,command->>'version',(command->>'operationId')::uuid,command->>'action',command->>'reason');
    when 'SYMBOL_MAPPING' then return private.application_mt5_save_symbol_mapping_impl(command);
    when 'CASH' then return private.application_mt5_classify_cash_impl(command,proposal);
    when 'ONBOARDING' then return private.application_mt5_approve_onboarding_impl(command,proposal);
    when 'PUBLICATION' then return private.mt5_publish_execution(command,proposal);
    when 'POLICY' then return private.application_mt5_review_impl(command||'{"reviewKind":"POLICY"}'::jsonb,proposal);
  end case;
end;$$;

create function private.application_mt5_grants(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); records jsonb; page_size integer:=coalesce((request->>'limit')::integer,50); cursor text;
begin
  if jsonb_typeof(request) is distinct from 'object' or request-array['accountId','afterId','limit']<>'{}'::jsonb or page_size not between 1 and 100 then
    raise exception 'Invalid grant query.' using errcode='22023'; end if;
  if request?'accountId' and not exists(select 1 from public.trading_accounts where id=(request->>'accountId')::uuid and user_id=auth.uid()) then
    raise exception 'Account not found.' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'accountId',g.account_id,'accountName',a.name,'clientId',g.client_id,
    'resource',g.resource,'version',g.version::text,'status',g.status) order by g.id),'[]'::jsonb) into records from
    (select * from private.integration_grants where owner_id=auth.uid() and purpose='MT5' and status='ACTIVE' and revoked_at is null
      and (request->>'accountId' is null or account_id=(request->>'accountId')::uuid) and (request->>'afterId' is null or id>(request->>'afterId')::uuid)
      order by id limit page_size+1) g join public.trading_accounts a on a.id=g.account_id;
  if jsonb_array_length(records)>page_size then cursor:=records->(page_size-1)->>'id';records:=records-page_size; end if;
  return jsonb_build_object('records',records,'nextCursor',cursor);
end;$$;
revoke all on function private.application_mt5_workflow_actor(uuid,uuid),private.application_mt5_adapter_actor(uuid),
  private.application_mt5_workflow_validate(jsonb),private.application_mt5_workflow_prepare(jsonb),private.application_mt5_workflow_write(jsonb,jsonb),
  private.application_mt5_grants(jsonb) from public,anon,authenticated,service_role;
