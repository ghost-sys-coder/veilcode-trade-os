-- Explicit per-account automatic publication, immutable source/manual decisions,
-- and one shared execution writer. No broker execution or public SQL surface.
alter table private.mt5_connections add column automatic_publication_baseline numeric;
create table private.mt5_review_events (
  id bigint generated always as identity primary key,
  connection_id uuid not null references private.mt5_connections(id),
  actor_user_id uuid not null references auth.users(id), operation_id uuid not null,
  review_kind text not null check(review_kind in ('SOURCE','DISTINCT','LINK','REOPEN','CASH','POLICY')),
  request jsonb not null, previous_value jsonb, created_at timestamptz not null default clock_timestamp(),
  unique(connection_id,operation_id)
);
create index mt5_review_events_actor_idx on private.mt5_review_events(actor_user_id);
create index mt5_review_events_connection_idx on private.mt5_review_events(connection_id,id);
alter table private.mt5_review_events enable row level security;
revoke all on private.mt5_review_events from public,anon,authenticated;
create trigger mt5_review_events_immutable before update or delete on private.mt5_review_events
  for each row execute function private.reject_integration_audit_mutation();

-- Original classification is immutable. Reconciliation appends an effective
-- source revision plus an explicit ledger delta; never a duplicate cash movement.
create view private.mt5_current_cash_decisions with(security_invoker=true) as
select d.connection_id,d.source_ticket,coalesce((e.request->>'sourceRevisionId')::bigint,d.source_revision_id) source_revision_id,
  d.source_kind,case when e.id is not null then 'RECONCILED' else d.disposition end disposition,coalesce((e.previous_value->>'currentAmount')::numeric,d.amount) amount,
  d.adjustment_id,d.actor_user_id,d.operation_id,coalesce(e.request->>'reason',d.reason) reason,coalesce(e.created_at,d.created_at) created_at
from private.mt5_cash_decisions d left join lateral(select * from private.mt5_review_events r
  where r.connection_id=d.connection_id and r.review_kind='CASH' and r.request->>'sourceId'=d.source_ticket order by id desc limit 1) e on true;
revoke all on private.mt5_current_cash_decisions from public,anon,authenticated;
do $cash_reads$
declare definition text; function_name text;
begin
  foreach function_name in array array['private.mt5_browser_source_page_with_cash(uuid,integer,integer)','private.mt5_approve_onboarding(jsonb,jsonb)'] loop
    select pg_get_functiondef(function_name::regprocedure) into definition;
    definition:=replace(definition,'private.mt5_cash_decisions','private.mt5_current_cash_decisions');
    execute definition;
  end loop;
end;
$cash_reads$;

create function private.mt5_distinct_match(p_connection uuid,p_identity text,p_trade public.trades) returns boolean
language sql stable security invoker set search_path='' as $$
  select coalesce((select e.review_kind='DISTINCT' and e.request->>'tradeToken'=encode(extensions.digest(p_trade::text,'sha256'),'hex')
    from private.mt5_review_events e where e.connection_id=p_connection and e.review_kind in ('DISTINCT','LINK','REOPEN')
      and e.request->>'canonicalIdentity'=p_identity and e.request->>'tradeId'=p_trade.id::text order by e.id desc limit 1),false);
$$;

-- Include the full revision chain: an out-of-order revision must invalidate an
-- outstanding review even if the current revision and its review flag did not change.
create or replace function private.mt5_source_snapshot_token(p_connection_id uuid) returns text
language sql stable security invoker set search_path='' as $$
  select encode(extensions.digest(
    coalesce((select string_agg(f.kind||':'||f.source_id||':'||f.current_revision_id::text||':'||f.requires_review::text,',' order by f.kind,f.source_id)
      from private.mt5_source_facts f where f.connection_id=p_connection_id),'EMPTY')
    ||coalesce((select string_agg(r.id::text||':'||r.payload_hash,',' order by r.id) from private.mt5_source_revisions r where r.connection_id=p_connection_id),'')
    ||coalesce((select string_agg(e.id::text,',' order by e.id) from private.mt5_review_events e where e.connection_id=p_connection_id and e.review_kind<>'POLICY'),''),'sha256'),'hex');
$$;

create function private.mt5_publication_actor(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb; c private.mt5_connections; a public.trading_accounts;
begin
  if current_user not in ('postgres','service_role') then raise exception 'Trusted application required.' using errcode='42501'; end if;
  if auth.jwt()->>'client_id' is null then return private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid); end if;
  actor:=private.authorize_integration(auth.jwt()->>'trade_os_resource','MT5');
  select * into c from private.mt5_connections where id=(p_request->>'connectionId')::uuid
    and owner_id=auth.uid() and account_id=(actor->>'account_id')::uuid and grant_id=(actor->>'grant_id')::uuid;
  if not found or c.identity->>'accountKind'<>'DEMO' then raise exception 'Connection access denied.' using errcode='42501'; end if;
  select * into a from public.trading_accounts where id=c.account_id and user_id=auth.uid();
  if c.status<>'ACTIVE' or c.automatic_publication_baseline is null or c.automatic_publication_baseline<>a.starting_balance
    or c.onboarding_approved_at is null or c.worker_id::text is distinct from p_request->>'workerId'
    or c.fencing_token::text is distinct from p_request->>'fencingToken' or c.lease_expires_at<=clock_timestamp()
    or jsonb_typeof(p_request->'operationRequest') is distinct from 'object' then
    raise exception 'Automatic publication not authorized.' using errcode='55000';
  end if;
  return actor;
end;
$$;

-- Extract the already-verified writer, rather than maintaining two financial writers.
alter function private.mt5_publish_browser(jsonb,jsonb) rename to mt5_publish_execution;
do $extract$
declare definition text; original text;
begin
  select pg_get_functiondef('private.mt5_publish_execution(jsonb,jsonb)'::regprocedure) into definition;
  original:=definition;
  definition:=replace(definition,
    'actor := private.mt5_browser_publication_actor((p_request->>''connectionId'')::uuid);',
    'actor := private.mt5_publication_actor(p_request);');
  definition:=replace(definition,'''MT5_PUBLICATION'',p_request',
    'case when auth.jwt()->>''client_id'' is null then ''MT5_PUBLICATION'' else ''MT5_AUTOPUBLICATION'' end,coalesce(p_request->''operationRequest'',p_request)');
  definition:=replace(definition,'''actorType'',''BROWSER''',
    '''actorType'',case when auth.jwt()->>''client_id'' is null then ''BROWSER'' else ''MT5_WORKER'' end');
  definition:=replace(definition,'and v.execution=item)', 'and v.execution=(item-''linkTradeId''))');
  definition:=replace(definition,'p_request->>''snapshotToken'',item', 'p_request->>''snapshotToken'',item-''linkTradeId''');
  definition:=replace(definition,
    'and t.direction::text=item->>''direction'' and t.mt5_connection_id is distinct from c.id',
    'and t.direction::text=item->>''direction'' and t.mt5_connection_id is distinct from c.id
      and t.id::text is distinct from item->>''linkTradeId''
      and not private.mt5_distinct_match(c.id,item->>''canonicalIdentity'',t)');
  definition:=replace(definition,
    'select * into existing from public.trades where mt5_connection_id=c.id and external_trade_id=item->>''canonicalIdentity'';',
    'if item->>''linkTradeId'' is not null then
      if auth.jwt()->>''client_id'' is not null or p_request->>''reviewKind'' is distinct from ''LINK''
        or p_request->>''tradeId'' is distinct from item->>''linkTradeId'' then
        raise exception ''Explicit manual-link review required.'' using errcode=''42501'';
      end if;
      select * into existing from public.trades where id=(item->>''linkTradeId'')::uuid
        and user_id=auth.uid() and account_id=a.id and source_type=''MANUAL'' and mt5_connection_id is null
        and status in (''OPEN'',''CLOSED'') and direction::text=item->>''direction''
        and instrument_id=instrument.id;
      if not found or (existing.status=''CLOSED'' and item->>''status''<>''CLOSED'') then
        raise exception ''Manual link changed or would reopen a closed trade.'' using errcode=''23514'';
      end if;
    else
      select * into existing from public.trades where mt5_connection_id=c.id and external_trade_id=item->>''canonicalIdentity'';
    end if;');
  definition:=replace(definition,
    'update public.trades set status=(item->>''status'')::public.trade_status,mt5_execution_version=mt5_execution_version+1,',
    'update public.trades set status=(item->>''status'')::public.trade_status,mt5_execution_version=mt5_execution_version+1,
        source_type=''MT5'',mt5_connection_id=c.id,external_trade_id=item->>''canonicalIdentity'',
        external_position_id=item->>''positionId'',mt5_opening_deal_ticket=item->>''openingDealTicket'',
        import_batch_id=case when existing.mt5_connection_id is null then batch_id else import_batch_id end,
        opened_at=case when existing.mt5_connection_id is null then (item->>''openedAt'')::timestamptz else opened_at end,');
  if definition=original or position('private.mt5_publication_actor(p_request)' in definition)=0
    or position('MT5_AUTOPUBLICATION' in definition)=0 or position('Explicit manual-link review required.' in definition)=0
    or position('private.mt5_distinct_match' in definition)=0 then raise exception 'Shared writer extraction failed'; end if;
  execute definition;
end;
$extract$;
create function private.mt5_publish_browser(p_request jsonb,p_proposal jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid);
  if p_request ? 'operationRequest' or p_request ? 'reviewKind' then raise exception 'Normal publication only.' using errcode='22023'; end if;
  return private.mt5_publish_execution(p_request,p_proposal);
end;
$$;

create function private.mt5_review_request(p_request jsonb,p_proposal jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb; result jsonb; c private.mt5_connections; t public.trades; reviewed_fact private.mt5_source_facts;
  a public.trading_accounts; previous jsonb; publication_request jsonb; v_kind text:=p_request->>'reviewKind';
  cash record; cash_source private.mt5_source_revisions; cash_amount numeric; delta numeric; adjustment_id uuid;
begin
  actor:=private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid);
  result:=private.integration_operation_result(actor,(p_request->>'operationId')::uuid,'MT5_REVIEW',p_request);
  if result is not null or p_proposal is null then return result; end if;
  if v_kind not in ('SOURCE','DISTINCT','LINK','REOPEN','CASH','POLICY') or v_kind is null
    or length(btrim(coalesce(p_request->>'reason',''))) not between 8 and 1000 then
    raise exception 'Meaningful review reason required.' using errcode='22023'; end if;
  select * into c from private.mt5_connections where id=(p_request->>'connectionId')::uuid and owner_id=auth.uid() for update;
  select * into a from public.trading_accounts where id=c.account_id and user_id=auth.uid() for update;
  perform 1 from public.trades where account_id=a.id order by id for update;
  perform 1 from public.account_adjustments where account_id=a.id order by id for update;
  if c.version::text is distinct from p_request->>'version'
    or private.mt5_source_snapshot_token(c.id) is distinct from p_request->>'snapshotToken'
    or private.mt5_account_ledger_token(a.id) is distinct from p_request->>'ledgerToken' then
    raise exception 'Review evidence changed.' using errcode='40001'; end if;
  if v_kind='POLICY' then
    if jsonb_typeof(p_request->'enabled') is distinct from 'boolean' then raise exception 'Explicit policy required.' using errcode='22023'; end if;
    if p_request->'enabled'='true'::jsonb and not exists(select 1 from private.mt5_onboarding_approvals o
      where o.connection_id=c.id and o.source_token=p_request->>'snapshotToken' and o.ledger_token=p_request->>'ledgerToken'
      and o.capture_checkpoint=c.capture_checkpoint) then raise exception 'Current onboarding approval required.' using errcode='23514'; end if;
    previous:=jsonb_build_object('automaticBaseline',c.automatic_publication_baseline);
    update private.mt5_connections set automatic_publication_baseline=case when p_request->'enabled'='true'::jsonb then a.starting_balance else null end where id=c.id;
  elsif v_kind='CASH' then
    select * into cash from private.mt5_current_cash_decisions where connection_id=c.id and source_ticket=p_request->>'sourceId';
    if not found then raise exception 'Existing cash classification required.' using errcode='23514'; end if;
    select r.* into cash_source from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id
      where f.connection_id=c.id and f.kind='DEAL' and f.source_id=cash.source_ticket and not f.requires_review
        and r.id::text=p_request->>'sourceRevisionId' and r.id<>cash.source_revision_id;
    if not found or cash_source.payload->>'positionId' is not null or cash_source.payload->>'type' not in
      ('BALANCE','CHARGE','CORRECTION','BONUS','COMMISSION','COMMISSION_DAILY','COMMISSION_MONTHLY','COMMISSION_AGENT_DAILY','COMMISSION_AGENT_MONTHLY','INTEREST','DIVIDEND','DIVIDEND_FRANKED','TAX')
      or jsonb_typeof(p_request->'isPerformanceNeutral') is distinct from 'boolean' then
      raise exception 'Reviewed supported cash revision required.' using errcode='23514'; end if;
    cash_amount:=round((cash_source.payload->>'profit')::numeric+(cash_source.payload->>'commission')::numeric
      +(cash_source.payload->>'swap')::numeric+(cash_source.payload->>'fee')::numeric,a.currency_precision);
    if cash_amount is null or cash_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or jsonb_typeof(p_proposal->'amount') is distinct from 'string' or cash_amount<>(p_proposal->>'amount')::numeric then
      raise exception 'Reconciliation amount contradicts source.' using errcode='23514'; end if;
    delta:=cash_amount-cash.amount;
    if delta<>0 then
      insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at,notes,is_performance_neutral,classification_reason)
      values(auth.uid(),a.id,'OTHER',delta,(cash_source.payload->>'occurredAt')::timestamptz,btrim(p_request->>'reason'),
        (p_request->>'isPerformanceNeutral')::boolean,btrim(p_request->>'reason')) returning id into adjustment_id;
    end if;
    previous:=jsonb_build_object('previousAmount',cash.amount::text,'currentAmount',cash_amount::text,'delta',delta::text,
      'previousSourceRevisionId',cash.source_revision_id::text,'adjustmentId',adjustment_id,'classification',cash.disposition);
  elsif v_kind='SOURCE' then
    select * into reviewed_fact from private.mt5_source_facts where connection_id=c.id and kind=p_request->>'sourceKind'
      and source_id=p_request->>'sourceId' and current_revision_id::text=p_request->>'sourceRevisionId' for update;
    if not found or not reviewed_fact.requires_review then raise exception 'Changed source review required.' using errcode='40001'; end if;
    select jsonb_agg(jsonb_build_object('id',r.id::text,'payload',r.payload,'observedAt',r.observed_at) order by r.id)
      into previous from private.mt5_source_revisions r where r.connection_id=c.id and r.kind=reviewed_fact.kind and r.source_id=reviewed_fact.source_id;
    update private.mt5_source_facts set requires_review=false where connection_id=c.id and kind=reviewed_fact.kind and source_id=reviewed_fact.source_id;
  else
    select * into t from public.trades where id=(p_request->>'tradeId')::uuid and user_id=auth.uid() and account_id=a.id;
    if not found or t.mt5_connection_id is not null or encode(extensions.digest(t::text,'sha256'),'hex') is distinct from p_request->>'tradeToken'
      or not exists(select 1 from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id
        where f.connection_id=c.id and f.kind='DEAL' and r.payload->>'positionId' is not null
        and p_request->>'canonicalIdentity' like c.id::text||':'||(r.payload->>'positionId')||':%') then
      raise exception 'Manual trade review changed.' using errcode='40001'; end if;
    previous:=to_jsonb(t);
    if jsonb_array_length(p_proposal->'episodes') is distinct from 1
      or p_proposal->'episodes'->0->>'canonicalIdentity' is distinct from p_request->>'canonicalIdentity' then
      raise exception 'Exact reviewed episode required.' using errcode='23514'; end if;
    if v_kind='LINK' then
      if p_proposal is null then return null; end if;
      if jsonb_array_length(p_proposal->'episodes')<>1 or p_proposal->'episodes'->0->>'linkTradeId' is distinct from t.id::text
        or p_proposal->'episodes'->0->>'canonicalIdentity' is distinct from p_request->>'canonicalIdentity' then
        raise exception 'Exact manual link required.' using errcode='23514'; end if;
      publication_request:=p_request||jsonb_build_object('operationId',gen_random_uuid(),'openingBaseline',a.starting_balance::text,
        'episodeIdentities',jsonb_build_array(p_request->>'canonicalIdentity'));
      perform private.mt5_publish_execution(publication_request,p_proposal);
    end if;
  end if;
  insert into private.mt5_review_events(connection_id,actor_user_id,operation_id,review_kind,request,previous_value)
    values(c.id,auth.uid(),(p_request->>'operationId')::uuid,v_kind,p_request,previous);
  update private.mt5_connections set version=version+1 where id=c.id returning * into c;
  result:=jsonb_build_object('connectionId',c.id,'version',c.version::text,'reviewKind',v_kind);
  perform private.record_integration_operation(actor,(p_request->>'operationId')::uuid,'MT5_REVIEW',p_request,result,jsonb_build_array(c.id),
    jsonb_build_object('actorType','BROWSER','reviewKind',v_kind,'reason',p_request->>'reason','previous',previous));
  return result;
end;
$$;

-- Add review metadata to existing owner-only paginated reads. No OAuth discovery.
create function private.mt5_browser_review_page(p_connection_id uuid,p_offset integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; events jsonb; trades jsonb; decisions jsonb;
begin
  perform private.require_direct_browser_session();
  result:=private.mt5_browser_source_page_with_cash(p_connection_id,p_offset,p_limit);
  select coalesce(jsonb_agg(value||jsonb_build_object('previousPayload',(select r.payload from private.mt5_source_revisions r
    where r.connection_id=p_connection_id and r.kind=value->>'kind' and r.source_id=value->>'sourceId'
      and r.id<(value->>'revisionId')::bigint order by r.id desc limit 1))),'[]'::jsonb)
    into events from jsonb_array_elements(result->'events');
  select coalesce(jsonb_agg(value||jsonb_build_object('reviewToken',encode(extensions.digest(t::text,'sha256'),'hex'))),'[]'::jsonb)
    into trades from jsonb_array_elements(result->'trades') join public.trades t on t.id=(value->>'id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('canonicalIdentity',e.request->>'canonicalIdentity','tradeId',e.request->>'tradeId',
    'tradeToken',e.request->>'tradeToken','decision',e.review_kind,'reason',e.request->>'reason','createdAt',e.created_at) order by e.id),'[]'::jsonb)
    into decisions from (select * from private.mt5_review_events where connection_id=p_connection_id and review_kind in ('DISTINCT','LINK','REOPEN')
      order by id limit p_limit offset p_offset) e;
  return result||jsonb_build_object('events',events,'trades',trades,'manualDecisions',decisions,'manualDecisionCount',
    (select count(*) from private.mt5_review_events where connection_id=p_connection_id and review_kind in ('DISTINCT','LINK','REOPEN')),
    'automaticPublicationEnabled',(select automatic_publication_baseline is not null from private.mt5_connections where id=p_connection_id));
end;
$$;
create or replace function public.mt5_browser_source_page(p_connection_id uuid,p_offset integer default 0,p_limit integer default 1000)
returns jsonb language sql security invoker set search_path='' as $$ select private.mt5_browser_review_page(p_connection_id,p_offset,p_limit); $$;

-- This unexposed invoker is exclusively for the signature-verified server service.
create function private.mt5_automatic_snapshot(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb; c private.mt5_connections; a public.trading_accounts; sources jsonb; trades jsonb;
begin
  if current_user not in ('postgres','service_role') then raise exception 'Trusted service required.' using errcode='42501'; end if;
  actor:=private.authorize_integration(auth.jwt()->>'trade_os_resource','MT5');
  select * into c from private.mt5_connections where id=(p_request->>'connectionId')::uuid and owner_id=auth.uid()
    and grant_id=(actor->>'grant_id')::uuid and account_id=(actor->>'account_id')::uuid for update;
  if not found or c.status<>'ACTIVE' or c.automatic_publication_baseline is null then return null; end if;
  perform private.mt5_publication_actor(p_request||jsonb_build_object('operationRequest',p_request));
  select * into a from public.trading_accounts where id=c.account_id and user_id=auth.uid() for update;
  if (select count(*) from private.mt5_source_facts where connection_id=c.id)>100000
    or (select count(*) from public.trades where account_id=a.id)>100000 then raise exception 'Snapshot exceeds supported bound.' using errcode='55000'; end if;
  if exists(select 1 from private.mt5_capture_progress where connection_id=c.id and received_batch_count<expected_batch_count) then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',f.kind,'sourceId',f.source_id,'revisionId',r.id::text,'observedAt',r.observed_at,
    'requiresReview',f.requires_review,'payload',r.payload) order by f.kind,f.source_id),'[]'::jsonb) into sources
    from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id where f.connection_id=c.id;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'symbol',i.symbol,'direction',t.direction,'openedAt',t.opened_at,'closedAt',t.closed_at,
    'canonicalIdentity',case when t.mt5_connection_id=c.id then t.external_trade_id else null end,
    'closedNetPnl',case when t.status='CLOSED' then t.net_pnl::text else null end,'reviewToken',encode(extensions.digest(t::text,'sha256'),'hex'))),'[]'::jsonb)
    into trades from public.trades t join public.instruments i on i.id=t.instrument_id where t.account_id=a.id;
  return jsonb_build_object('connection',jsonb_build_object('id',c.id,'accountId',c.account_id,'grantId',c.grant_id,'identity',c.identity,
    'status',c.status,'version',c.version::text,'attentionCode',c.attention_code,'onboardingApprovedAt',c.onboarding_approved_at,
    'lastHeartbeatAt',c.last_heartbeat_at,'lastSyncAt',c.last_sync_at,'captureCheckpoint',c.capture_checkpoint,'healthObservedAt',clock_timestamp(),
    'heartbeatStale',false,'sourceFactCount',jsonb_array_length(sources),'reviewCount',0,'incompleteCollections',0,'missingServerBatches',0,
    'publishedTradeCount',(select count(*) from public.trades where mt5_connection_id=c.id),'automaticPublicationEnabled',true),
    'sources',sources,'existingTrades',trades,'startingBalance',a.starting_balance::text,
    'ledgerBalance',(a.starting_balance+coalesce((select sum(net_pnl) from public.trades where account_id=a.id and status='CLOSED'),0)
      +coalesce((select sum(amount) from public.account_adjustments where account_id=a.id),0))::text,
    'snapshotToken',private.mt5_source_snapshot_token(c.id),'ledgerToken',private.mt5_account_ledger_token(a.id),
    'instruments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'symbol',symbol)) from public.instruments where user_id is null or user_id=auth.uid()),'[]'::jsonb),
    'symbolMappings',coalesce((select jsonb_agg(jsonb_build_object('brokerSymbol',broker_symbol,'instrumentId',instrument_id,'version',version::text,
      'reason',reason,'updatedAt',updated_at)) from private.mt5_symbol_mappings where connection_id=c.id),'[]'::jsonb),
    'cashDecisions','[]'::jsonb,
    'manualDecisions',coalesce((select jsonb_agg(jsonb_build_object('canonicalIdentity',request->>'canonicalIdentity','tradeId',request->>'tradeId',
      'tradeToken',request->>'tradeToken','decision',review_kind,'reason',request->>'reason','createdAt',created_at) order by id) from private.mt5_review_events
      where connection_id=c.id and review_kind in ('DISTINCT','LINK','REOPEN')),'[]'::jsonb),
    'publishedExecutions',coalesce((select jsonb_agg(jsonb_build_object('identity',t.external_trade_id,'execution',v.execution)) from public.trades t
      join private.mt5_execution_versions v on v.trade_id=t.id and v.execution_version=t.mt5_execution_version where t.mt5_connection_id=c.id),'[]'::jsonb));
end;
$$;
revoke all on function private.mt5_distinct_match(uuid,text,public.trades),private.mt5_publication_actor(jsonb),
  private.mt5_publish_execution(jsonb,jsonb),private.mt5_publish_browser(jsonb,jsonb),private.mt5_review_request(jsonb,jsonb),
  private.mt5_automatic_snapshot(jsonb) from public,anon,authenticated;
revoke all on function private.mt5_browser_review_page(uuid,integer,integer) from public,anon;
grant execute on function private.mt5_browser_review_page(uuid,integer,integer) to authenticated;
