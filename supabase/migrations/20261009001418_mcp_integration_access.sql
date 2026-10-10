-- Extract the existing read implementations once. Browser RPCs keep their
-- direct-browser gate; only verified application services call the private cores.
create function private.application_mt5_read_boundary() returns void
language plpgsql security invoker set search_path='' as $$begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'Trusted integration reader required.' using errcode='42501'; end if;
end;$$;
do $extract_reads$
declare target record; original text; body text; shared text; names text[]:=array[
  'mt5_list_connections','mt5_browser_source_page','mt5_browser_source_page_with_mappings',
  'mt5_browser_source_page_with_cash','mt5_browser_review_page']; name text;
begin
  for target in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(names) loop
    original:=pg_get_functiondef(target.oid); body:=target.prosrc;
    if position('perform private.require_direct_browser_session();' in body)=0 then raise exception 'Expected MT5 browser read gate missing.'; end if;
    shared:=replace(original,'FUNCTION private.'||target.proname||'(','FUNCTION private.application_'||target.proname||'_impl(');
    shared:=replace(shared,'SECURITY DEFINER','SECURITY INVOKER');
    shared:=replace(shared,'perform private.require_direct_browser_session();','perform private.application_mt5_read_boundary();');
    foreach name in array names loop shared:=replace(shared,'private.'||name||'(','private.application_'||name||'_impl('); end loop;
    execute shared;
    execute format('alter function private.%I(%s) security invoker','application_'||target.proname||'_impl',pg_get_function_identity_arguments(target.oid));
    execute format('revoke all on function private.%I(%s) from public,anon,authenticated,service_role','application_'||target.proname||'_impl',pg_get_function_identity_arguments(target.oid));
    execute replace(original,body,E'begin\n perform private.require_direct_browser_session();\n return private.application_'||target.proname||'_impl('||coalesce(array_to_string(target.proargnames,','),'')||E');\nend;\n');
  end loop;
end;$extract_reads$;

create function private.application_integration_read(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); action text:=request->>'action'; records jsonb; connection jsonb; result jsonb; page jsonb;
  page_size integer:=coalesce((request->>'limit')::integer,50); next_cursor text; c private.mt5_connections; batch public.import_batches;
  offset_value integer:=0; total integer; field text; combined jsonb:='{}'; items jsonb;
begin
  if jsonb_typeof(request) is distinct from 'object' or request-array['action','connectionId','accountId','batchId','afterId','limit','kind','sourceId','afterRevisionId']<>'{}'::jsonb
    or action is null or action not in ('MT5_LIST','MT5_GET','MT5_SNAPSHOT','MT5_SOURCES','IMPORT_LIST','IMPORT_GET','IMPORT_ROWS')
    or page_size not between 1 and 100 or (request?'limit' and jsonb_typeof(request->'limit') is distinct from 'number') then
    raise exception 'Invalid integration query.' using errcode='22023'; end if;
  if request?'accountId' and not exists(select 1 from public.trading_accounts where id=(request->>'accountId')::uuid and user_id=auth.uid()) then
    raise exception 'Account not found.' using errcode='P0002'; end if;
  if action like 'MT5_%' then
    if action='MT5_LIST' then
      select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into records from (
        select value from jsonb_array_elements(private.application_mt5_list_connections_impl()) where
          (request->>'accountId' is null or value->>'accountId'=request->>'accountId')
          and (request->>'afterId' is null or (value->>'id')::uuid>(request->>'afterId')::uuid)
        order by value->>'id' limit page_size+1) p;
    else
      select * into c from private.mt5_connections where id=(request->>'connectionId')::uuid and owner_id=auth.uid();
      if not found then raise exception 'Connection not found.' using errcode='P0002'; end if;
      select value into connection from jsonb_array_elements(private.application_mt5_list_connections_impl()) where value->>'id'=c.id::text;
      if action='MT5_GET' then return connection; end if;
      if action='MT5_SNAPSHOT' then
        -- Read all independent datasets in this caller's repeatable-read transaction.
        -- Never treat a PostgREST page or an unresolved collection as complete history.
        loop
          page:=private.application_mt5_browser_review_page_impl(c.id,offset_value,1000);
          if result is null then result:=page; end if;
          foreach field in array array['events','trades','symbolMappings','cashDecisions','adjustments','manualDecisions'] loop
            combined:=jsonb_set(combined,array[field],coalesce(combined->field,'[]'::jsonb)||coalesce(page->field,'[]'::jsonb));
          end loop;
          total:=greatest((page->>'sourceFactCount')::integer,(page->>'tradeCount')::integer,(page->>'symbolMappingCount')::integer,
            (page->>'cashDecisionCount')::integer,(page->>'adjustmentCount')::integer,(page->>'manualDecisionCount')::integer);
          if total>100000 then raise exception 'Integration snapshot exceeds supported history.' using errcode='22023'; end if;
          offset_value:=offset_value+1000; exit when offset_value>=total;
        end loop;
        select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'symbol',i.symbol,'display_name',i.display_name,'user_id',i.user_id) order by i.id),'[]'::jsonb)
          into items from public.instruments i where i.user_id is null or i.user_id=auth.uid();
        return jsonb_build_object('connection',connection,'page',result||combined,'instruments',items);
      end if;
      if request?'kind' and request->>'kind' not in ('DEAL','ORDER','POSITION','ACCOUNT') then raise exception 'Invalid source kind.' using errcode='22023'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.id::text,'kind',r.kind,'sourceId',r.source_id,'observedAt',r.observed_at,
        'payload',r.payload,'isCurrent',r.id=f.current_revision_id,'requiresReview',f.requires_review) order by r.id),'[]'::jsonb) into records from
        (select * from private.mt5_source_revisions where connection_id=c.id and (request->>'kind' is null or kind=request->>'kind')
          and (request->>'sourceId' is null or source_id=request->>'sourceId')
          and (request->>'afterRevisionId' is null or id>(request->>'afterRevisionId')::bigint) order by id limit page_size+1) r
        join private.mt5_source_facts f on f.connection_id=r.connection_id and f.kind=r.kind and f.source_id=r.source_id;
      if jsonb_array_length(records)>page_size then next_cursor:=records->(page_size-1)->>'revisionId';records:=records-page_size; end if;
      return jsonb_build_object('records',records,'nextCursor',next_cursor);
    end if;
  else
    if action='IMPORT_LIST' then
      select coalesce(jsonb_agg(private.application_wire_record('public.import_batches'::regclass,to_jsonb(b)) order by b.id),'[]'::jsonb) into records from
        (select * from public.import_batches where user_id=auth.uid() and (request->>'accountId' is null or account_id=(request->>'accountId')::uuid)
          and (request->>'afterId' is null or id>(request->>'afterId')::uuid) order by id limit page_size+1) b;
    else
      select * into batch from public.import_batches where id=(request->>'batchId')::uuid and user_id=auth.uid();
      if not found then raise exception 'Import not found.' using errcode='P0002'; end if;
      if action='IMPORT_GET' then return private.application_wire_record('public.import_batches'::regclass,to_jsonb(batch)); end if;
      select coalesce(jsonb_agg(private.application_wire_record('public.import_batch_rows'::regclass,to_jsonb(r)) order by r.id),'[]'::jsonb) into records from
        (select * from public.import_batch_rows where user_id=auth.uid() and batch_id=batch.id and (request->>'afterId' is null or id>(request->>'afterId')::uuid)
          order by id limit page_size+1) r;
    end if;
  end if;
  if jsonb_array_length(records)>page_size then next_cursor:=records->(page_size-1)->>'id';records:=records-page_size; end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;$$;

-- A full MCP grant is separate from the account-bound collector grant. Neither
-- can impersonate the other, and both are checked live before a review mutation.
create function private.application_mt5_mutation_actor(connection_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); c private.mt5_connections; g private.integration_grants;
begin
  if actor->>'actorType' is distinct from 'MCP' then raise exception 'MCP review grant required.' using errcode='42501'; end if;
  select * into c from private.mt5_connections where id=connection_id and owner_id=auth.uid();
  if not found or c.identity->>'accountKind' is distinct from 'DEMO' then raise exception 'Connection access denied.' using errcode='42501'; end if;
  select * into g from private.integration_grants where id=c.grant_id and owner_id=auth.uid() and account_id=c.account_id
    and purpose='MT5' and status='ACTIVE' and revoked_at is null for share;
  if not found or not exists(select 1 from private.integration_resources where purpose='MT5' and resource=g.resource and enabled) then
    raise exception 'Active MT5 grant required.' using errcode='42501'; end if;
  -- MCP is application-wide: retain its null account scope in durable receipts.
  -- The separate collector identity is only for the existing financial writer.
  return actor||jsonb_build_object('mt5AccountId',c.account_id,'mt5GrantId',g.id);
end;$$;

-- One review body serves both adapters. The legacy name remains browser-only.
do $extract_review$
declare definition text; body text; shared text;
begin
  definition:=pg_get_functiondef('private.mt5_review_request(jsonb,jsonb)'::regprocedure);
  select prosrc into body from pg_proc where oid='private.mt5_review_request(jsonb,jsonb)'::regprocedure;
  shared:=replace(definition,'FUNCTION private.mt5_review_request(','FUNCTION private.application_mt5_review_impl(');
  shared:=replace(shared,'actor:=private.mt5_browser_publication_actor((p_request->>''connectionId'')::uuid);',
    'actor:=case when auth.jwt()->>''client_id'' is null then private.mt5_browser_publication_actor((p_request->>''connectionId'')::uuid) else private.application_mt5_mutation_actor((p_request->>''connectionId'')::uuid) end;');
  shared:=replace(shared,'''actorType'',''BROWSER''','''actorType'',case when actor->>''purpose''=''MCP'' then ''MCP'' else ''BROWSER'' end');
  if position('private.application_mt5_mutation_actor' in shared)=0 then raise exception 'MT5 review extraction failed.'; end if;
  execute shared;
  execute replace(definition,body,E'begin\n perform private.mt5_browser_publication_actor((p_request->>''connectionId'')::uuid);\n return private.application_mt5_review_impl(p_request,p_proposal);\nend;\n');
end;$extract_review$;

-- Explicit manual linking reuses the sole, already-verified financial writer.
-- Ordinary MCP callers cannot enter its automatic collector-publication path.
do $link_actor$
declare definition text; original text;
begin
  definition:=pg_get_functiondef('private.mt5_publication_actor(jsonb)'::regprocedure);original:=definition;
  definition:=replace(definition,'actor:=private.authorize_integration(auth.jwt()->>''trade_os_resource'',''MT5'');',
    'if exists(select 1 from private.integration_grants where id::text=auth.jwt()->>''trade_os_grant_id'' and purpose=''MCP'') then
      if p_request->>''reviewKind'' is distinct from ''LINK'' then raise exception ''Explicit MCP manual-link review required.'' using errcode=''42501''; end if;
      return private.application_mt5_mutation_actor((p_request->>''connectionId'')::uuid);
    end if;
    actor:=private.authorize_integration(auth.jwt()->>''trade_os_resource'',''MT5'');');
  if definition=original then raise exception 'MT5 link actor extraction failed.'; end if;execute definition;
  definition:=pg_get_functiondef('private.mt5_publish_execution(jsonb,jsonb)'::regprocedure);original:=definition;
  definition:=replace(definition,'and grant_id=(actor->>''grant_id'')::uuid and account_id=(actor->>''account_id'')::uuid for update;',
    'and grant_id=coalesce((actor->>''mt5GrantId'')::uuid,(actor->>''grant_id'')::uuid)
      and account_id=coalesce((actor->>''mt5AccountId'')::uuid,(actor->>''account_id'')::uuid) for update;');
  definition:=replace(definition,'case when auth.jwt()->>''client_id'' is null then ''MT5_PUBLICATION'' else ''MT5_AUTOPUBLICATION'' end',
    'case when actor->>''purpose''=''MCP'' or auth.jwt()->>''client_id'' is null then ''MT5_PUBLICATION'' else ''MT5_AUTOPUBLICATION'' end');
  definition:=replace(definition,'if auth.jwt()->>''client_id'' is not null or p_request->>''reviewKind'' is distinct from ''LINK''',
    'if (auth.jwt()->>''client_id'' is not null and actor->>''purpose''<>''MCP'') or p_request->>''reviewKind'' is distinct from ''LINK''');
  definition:=replace(definition,'case when auth.jwt()->>''client_id'' is null then ''BROWSER'' else ''MT5_WORKER'' end',
    'case when actor->>''purpose''=''MCP'' then ''MCP'' when auth.jwt()->>''client_id'' is null then ''BROWSER'' else ''MT5_WORKER'' end');
  if definition=original then raise exception 'MT5 link writer extraction failed.'; end if;execute definition;
end;$link_actor$;

create function private.application_mt5_review_prepare(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_mt5_mutation_actor((request->>'connectionId')::uuid); receipt jsonb;
begin
  if jsonb_typeof(request) is distinct from 'object' or request-array['connectionId','operationId','version','snapshotToken','ledgerToken','reason',
    'reviewKind','sourceKind','sourceId','sourceRevisionId','canonicalIdentity','tradeId','tradeToken','isPerformanceNeutral']<>'{}'::jsonb
    or request->>'reviewKind' not in ('SOURCE','DISTINCT','LINK','REOPEN','CASH') or request->>'reviewKind' is null
    or length(btrim(coalesce(request->>'reason',''))) not between 8 and 1000 then raise exception 'Invalid MT5 review command.' using errcode='22023'; end if;
  receipt:=private.integration_operation_result(actor,(request->>'operationId')::uuid,'MT5_REVIEW',request);
  if receipt is not null then return jsonb_build_object('receipt',receipt); end if;
  perform 1 from private.mt5_connections where id=(request->>'connectionId')::uuid and owner_id=auth.uid() for update;
  if not exists(select 1 from private.mt5_connections c where c.id=(request->>'connectionId')::uuid
    and c.version::text=request->>'version' and private.mt5_source_snapshot_token(c.id)=request->>'snapshotToken'
    and private.mt5_account_ledger_token(c.account_id)=request->>'ledgerToken') then
    raise exception 'Review evidence changed.' using errcode='40001'; end if;
  return private.application_integration_read(jsonb_build_object('action','MT5_SNAPSHOT','connectionId',request->>'connectionId'));
end;$$;
create function private.application_mt5_review_write(request jsonb,proposal jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$begin
  perform private.application_mt5_mutation_actor((request->>'connectionId')::uuid);
  -- Reuse the preparation validator and replay gate, never accept POLICY here.
  if request->>'reviewKind' not in ('SOURCE','DISTINCT','LINK','REOPEN','CASH') or request->>'reviewKind' is null then
    raise exception 'Invalid MT5 review command.' using errcode='22023'; end if;
  return private.application_mt5_review_impl(request,proposal);
end;$$;
revoke all on function private.application_mt5_read_boundary(),private.application_integration_read(jsonb),
  private.application_mt5_mutation_actor(uuid),private.application_mt5_review_impl(jsonb,jsonb),
  private.application_mt5_review_prepare(jsonb),private.application_mt5_review_write(jsonb,jsonb) from public,anon,authenticated,service_role;
