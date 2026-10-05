-- Trusted application services calculate broker finance from durable source facts.
-- These invoker functions are PRIVATE and cannot be called by browser/collector
-- database roles. The server supplies only claims it has cryptographically verified.
alter table public.trades
  alter column actual_entry type numeric,
  alter column actual_exit type numeric,
  alter column actual_lot_size type numeric;

create table private.mt5_execution_versions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.mt5_connections(id),
  trade_id uuid not null references public.trades(id),
  execution_version bigint not null check (execution_version > 0),
  operation_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  snapshot_token text not null check (snapshot_token ~ '^[a-f0-9]{64}$'),
  execution jsonb not null check (jsonb_typeof(execution) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(trade_id,execution_version), unique(id,connection_id)
);
create table private.mt5_execution_sources (
  execution_id uuid not null,
  connection_id uuid not null,
  revision_id bigint not null,
  kind text not null check (kind = 'DEAL'),
  source_id text not null,
  primary key(execution_id,revision_id),
  foreign key(execution_id,connection_id) references private.mt5_execution_versions(id,connection_id),
  foreign key(revision_id,connection_id,kind,source_id) references private.mt5_source_revisions(id,connection_id,kind,source_id)
);
create index mt5_execution_versions_connection_idx on private.mt5_execution_versions(connection_id);
create index mt5_execution_versions_actor_idx on private.mt5_execution_versions(actor_user_id);
create index mt5_execution_sources_revision_idx on private.mt5_execution_sources(revision_id,connection_id,kind,source_id);
create table private.mt5_publication_approvals (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.mt5_connections(id),
  actor_user_id uuid not null references auth.users(id),
  operation_id uuid not null,
  opening_baseline numeric not null check (opening_baseline > 0 and opening_baseline not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(connection_id,operation_id)
);
create index mt5_publication_approvals_actor_idx on private.mt5_publication_approvals(actor_user_id);
alter table private.mt5_execution_versions enable row level security;
alter table private.mt5_execution_sources enable row level security;
alter table private.mt5_publication_approvals enable row level security;
revoke all on private.mt5_execution_versions,private.mt5_execution_sources,private.mt5_publication_approvals from public,anon,authenticated;
create trigger mt5_execution_versions_immutable before update or delete on private.mt5_execution_versions
  for each row execute function private.reject_integration_audit_mutation();
create trigger mt5_execution_sources_immutable before update or delete on private.mt5_execution_sources
  for each row execute function private.reject_integration_audit_mutation();
create trigger mt5_publication_approvals_immutable before update or delete on private.mt5_publication_approvals
  for each row execute function private.reject_integration_audit_mutation();

create function private.mt5_account_ledger_token(p_account_id uuid) returns text
language sql stable security invoker set search_path='' as $$
  select encode(extensions.digest(a::text
    ||coalesce((select string_agg(t::text,',' order by t.id) from public.trades t where t.account_id=a.id),'')
    ||coalesce((select string_agg(j::text,',' order by j.id) from public.account_adjustments j where j.account_id=a.id),''),'sha256'),'hex')
  from public.trading_accounts a where a.id=p_account_id;
$$;

create function private.mt5_browser_publication_actor(p_connection_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c private.mt5_connections; g private.integration_grants; claims jsonb := auth.jwt();
begin
  if current_user not in ('postgres','service_role') then
    raise exception 'Trusted publication service required.' using errcode='42501';
  end if;
  perform private.require_direct_browser_session();
  if claims->>'role' is distinct from 'authenticated' or coalesce((claims->>'exp')::numeric,0)<=extract(epoch from clock_timestamp()) then
    raise exception 'Active browser session required.' using errcode='42501';
  end if;
  perform 1 from auth.sessions s where s.id::text=claims->>'session_id' and s.user_id=auth.uid()
    and s.oauth_client_id is null and (s.not_after is null or s.not_after>clock_timestamp()) for share;
  if not found then raise exception 'Active browser session required.' using errcode='42501'; end if;
  select * into c from private.mt5_connections where id=p_connection_id and owner_id=auth.uid();
  if not found or c.identity->>'accountKind'<>'DEMO' then raise exception 'Connection access denied.' using errcode='42501'; end if;
  -- Same grant -> operation -> connection ordering as capture and browser controls.
  select * into g from private.integration_grants where id=c.grant_id and owner_id=auth.uid()
    and account_id=c.account_id and purpose='MT5' and status='ACTIVE' and revoked_at is null for share;
  if not found or not exists(select 1 from private.integration_resources where purpose='MT5' and resource=g.resource and enabled) then
    raise exception 'Active MT5 grant required.' using errcode='42501';
  end if;
  return jsonb_build_object('user_id',g.owner_id,'client_id',g.client_id,'grant_id',g.id,'account_id',g.account_id,'purpose',g.purpose,'resource',g.resource);
end;
$$;

create function private.mt5_browser_publication_result(p_request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb;
begin
  actor := private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid);
  return private.integration_operation_result(actor,(p_request->>'operationId')::uuid,'MT5_PUBLICATION',p_request);
end;
$$;

create function private.mt5_publish_browser(p_request jsonb,p_proposal jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb; c private.mt5_connections; a public.trading_accounts; result jsonb;
  item jsonb; source jsonb; existing public.trades; trade_id uuid; execution_id uuid; batch_id uuid:=gen_random_uuid();
  trade_ids jsonb:='[]'; changes jsonb:='[]'; instrument public.instruments; count_selected integer;
begin
  actor := private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid);
  result := private.integration_operation_result(actor,(p_request->>'operationId')::uuid,'MT5_PUBLICATION',p_request);
  if result is not null then return result; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_proposal->'episodes') is distinct from 'array'
    or jsonb_typeof(p_request->'episodeIdentities') is distinct from 'array'
    or length(btrim(coalesce(p_request->>'reason',''))) not between 8 and 1000
    or jsonb_typeof(p_request->'openingBaseline') is distinct from 'string' then
    raise exception 'Invalid publication approval.' using errcode='22023';
  end if;
  count_selected := jsonb_array_length(p_proposal->'episodes');
  if count_selected not between 1 and 1000 or count_selected<>jsonb_array_length(p_request->'episodeIdentities')
    or (select count(distinct value->>'canonicalIdentity') from jsonb_array_elements(p_proposal->'episodes'))<>count_selected
    or (select count(distinct v) from jsonb_array_elements_text(p_request->'episodeIdentities') v)<>count_selected then
    raise exception 'Invalid episode selection.' using errcode='22023';
  end if;
  select * into c from private.mt5_connections where id=(p_request->>'connectionId')::uuid and owner_id=auth.uid()
    and grant_id=(actor->>'grant_id')::uuid and account_id=(actor->>'account_id')::uuid for update;
  if not found then raise exception 'Connection access denied.' using errcode='42501'; end if;
  if c.status not in ('ONBOARDING','ACTIVE','PAUSED') or c.version::text is distinct from p_request->>'version'
    or c.capture_checkpoint is null or private.mt5_source_snapshot_token(c.id) is distinct from p_request->>'snapshotToken'
    or exists(select 1 from private.mt5_capture_progress p where p.connection_id=c.id and p.received_batch_count<p.expected_batch_count) then
    raise exception 'Source preview changed or capture incomplete.' using errcode='40001';
  end if;
  -- Account FOR UPDATE blocks new FK-linked trades/adjustments while checking the
  -- ledger; existing rows are locked deterministically against concurrent edits.
  select * into a from public.trading_accounts where id=c.account_id and user_id=auth.uid() for update;
  if not found or a.currency_code is distinct from c.identity->>'currencyCode'
    or a.currency_precision is distinct from (c.identity->>'currencyPrecision')::smallint
    or a.starting_balance<=0 or a.starting_balance<>round((p_request->>'openingBaseline')::numeric,a.currency_precision) then
    raise exception 'Preserved positive baseline and account currency required.' using errcode='23514';
  end if;
  perform 1 from public.trades where account_id=a.id order by id for update;
  perform 1 from public.account_adjustments where account_id=a.id order by id for update;
  if private.mt5_account_ledger_token(a.id) is distinct from p_request->>'ledgerToken' then
    raise exception 'Account ledger changed.' using errcode='40001';
  end if;
  insert into public.import_batches(id,user_id,account_id,source_type,status,row_count,imported_count,completed_at)
    values(batch_id,auth.uid(),a.id,'MT5','COMPLETED',count_selected,count_selected,clock_timestamp());
  insert into private.mt5_publication_approvals(connection_id,actor_user_id,operation_id,opening_baseline,request)
    values(c.id,auth.uid(),(p_request->>'operationId')::uuid,a.starting_balance,p_request);
  for item in select value from jsonb_array_elements(p_proposal->'episodes') order by value->>'canonicalIdentity' loop
    if not (p_request->'episodeIdentities' ? (item->>'canonicalIdentity'))
      or item->>'canonicalIdentity' is distinct from c.id::text||':'||(item->>'positionId')||':'||(item->>'openingDealTicket')||':'||(item->>'direction')
      or item->>'status' not in ('OPEN','CLOSED') or jsonb_typeof(item->'sourceRevisions') is distinct from 'array'
      or jsonb_array_length(item->'sourceRevisions')=0 then
      raise exception 'Invalid canonical execution evidence.' using errcode='23514';
    end if;
    select * into instrument from public.instruments where id=(item->>'instrumentId')::uuid
      and (user_id is null or user_id=auth.uid()) and symbol=item->>'symbol' for share;
    if not found then raise exception 'Instrument mapping changed.' using errcode='40001'; end if;
    for source in select value from jsonb_array_elements(item->'sourceRevisions') loop
      if not exists(select 1 from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id
        where f.connection_id=c.id and f.kind='DEAL' and f.source_id=source->>'sourceId'
          and f.current_revision_id::text=source->>'revisionId' and not f.requires_review
          and r.payload->>'positionId'=item->>'positionId' and r.payload->>'symbol'=item->>'symbol') then
        raise exception 'Source execution requires review.' using errcode='40001';
      end if;
    end loop;
    -- Even a trusted proposal cannot silently overwrite a plausible manual match.
    if exists(select 1 from public.trades t where t.account_id=a.id and t.instrument_id=instrument.id
      and t.direction::text=item->>'direction' and t.mt5_connection_id is distinct from c.id
      and t.opened_at is not null and t.opened_at<=coalesce((item->>'closedAt')::timestamptz,'infinity'::timestamptz)
      and coalesce(t.closed_at,'infinity'::timestamptz)>=(item->>'openedAt')::timestamptz) then
      raise exception 'Existing trade match requires explicit review.' using errcode='23514';
    end if;
    select * into existing from public.trades where mt5_connection_id=c.id and external_trade_id=item->>'canonicalIdentity';
    trade_id := coalesce(existing.id,gen_random_uuid());
    if existing.id is not null and exists(select 1 from private.mt5_execution_versions v
      where v.trade_id=existing.id and v.execution_version=existing.mt5_execution_version and v.execution=item) then
      trade_ids := trade_ids||jsonb_build_array(trade_id);
      continue; -- New polling/approval operation, but unchanged facts are not a new execution revision.
    end if;
    perform set_config('trade_os.mt5_publication_trade',trade_id::text,true);
    if existing.id is null then
      insert into public.trades(id,user_id,account_id,instrument_id,source_type,status,direction,import_batch_id,
        external_trade_id,external_position_id,mt5_connection_id,mt5_opening_deal_ticket,mt5_execution_version,
        mt5_used_partial_exits,opened_at,closed_at,actual_entry,actual_exit,actual_lot_size,
        gross_pnl,commission,swap,other_fees,trading_credits,net_pnl,outcome,external_raw_data)
      values(trade_id,auth.uid(),a.id,instrument.id,'MT5',(item->>'status')::public.trade_status,(item->>'direction')::public.trade_direction,batch_id,
        item->>'canonicalIdentity',item->>'positionId',c.id,item->>'openingDealTicket',1,(item->>'usedPartialExits')::boolean,
        (item->>'openedAt')::timestamptz,(item->>'closedAt')::timestamptz,(item->>'entryPrice')::numeric,(item->>'exitPrice')::numeric,
        (item->>'openedVolume')::numeric,(item->>'grossPnl')::numeric,(item->>'commission')::numeric,(item->>'swap')::numeric,
        (item->>'otherFees')::numeric,(item->>'tradingCredits')::numeric,(item->>'finalNetPnl')::numeric,(item->>'outcome')::public.trade_outcome,
        jsonb_build_object('connectionId',c.id,'remainingVolume',item->'remainingVolume','recognizedCash',item->'recognizedCash'));
    else
      -- Plans, strategies, reviews and user-authored context are intentionally not updated.
      update public.trades set status=(item->>'status')::public.trade_status,mt5_execution_version=mt5_execution_version+1,
        mt5_used_partial_exits=(item->>'usedPartialExits')::boolean,closed_at=(item->>'closedAt')::timestamptz,
        actual_entry=(item->>'entryPrice')::numeric,actual_exit=(item->>'exitPrice')::numeric,actual_lot_size=(item->>'openedVolume')::numeric,
        gross_pnl=(item->>'grossPnl')::numeric,commission=(item->>'commission')::numeric,swap=(item->>'swap')::numeric,
        other_fees=(item->>'otherFees')::numeric,trading_credits=(item->>'tradingCredits')::numeric,
        net_pnl=(item->>'finalNetPnl')::numeric,outcome=(item->>'outcome')::public.trade_outcome,
        external_raw_data=jsonb_build_object('connectionId',c.id,'remainingVolume',item->'remainingVolume','recognizedCash',item->'recognizedCash')
        where id=trade_id;
    end if;
    perform set_config('trade_os.mt5_publication_trade','',true);
    insert into private.mt5_execution_versions(connection_id,trade_id,execution_version,operation_id,actor_user_id,snapshot_token,execution)
      select c.id,trade_id,t.mt5_execution_version,(p_request->>'operationId')::uuid,auth.uid(),p_request->>'snapshotToken',item
        from public.trades t where t.id=trade_id returning id into execution_id;
    insert into private.mt5_execution_sources(execution_id,connection_id,revision_id,kind,source_id)
      select execution_id,c.id,(value->>'revisionId')::bigint,'DEAL',value->>'sourceId' from jsonb_array_elements(item->'sourceRevisions');
    trade_ids := trade_ids||jsonb_build_array(trade_id);
    changes := changes||jsonb_build_array(jsonb_build_object('tradeId',trade_id,'previousStatus',existing.status,
      'previousNetPnl',existing.net_pnl::text,'status',item->>'status','netPnl',item->'finalNetPnl','executionId',execution_id));
  end loop;
  update public.import_batches set imported_count=jsonb_array_length(changes) where id=batch_id;
  update private.mt5_connections set version=version+1 where id=c.id returning * into c;
  -- Selection approval does NOT authorize unattended publication or assert reconciliation.
  result := jsonb_build_object('connectionId',c.id,'version',c.version::text,'tradeIds',trade_ids,
    'importBatchId',batch_id,'reconciliationState','NOT_APPROVED');
  perform private.record_integration_operation(actor,(p_request->>'operationId')::uuid,'MT5_PUBLICATION',p_request,result,
    trade_ids||jsonb_build_array(c.id,batch_id),jsonb_build_object('actorType','BROWSER','reason',p_request->>'reason',
      'baseline',a.starting_balance::text,'executions',changes,'unresolvedProblemCount',p_proposal->'unresolvedProblemCount'));
  return result;
end;
$$;
revoke all on function private.mt5_account_ledger_token(uuid),private.mt5_browser_publication_actor(uuid),
  private.mt5_browser_publication_result(jsonb),private.mt5_publish_browser(jsonb,jsonb) from public,anon,authenticated;
