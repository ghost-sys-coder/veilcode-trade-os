create table private.mt5_symbol_mappings (
  connection_id uuid not null references private.mt5_connections(id),
  broker_symbol text not null check (length(broker_symbol) between 1 and 128 and broker_symbol=btrim(broker_symbol)),
  instrument_id uuid not null references public.instruments(id),
  version bigint not null check (version>0),
  reason text not null check (length(btrim(reason)) between 8 and 1000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,broker_symbol)
);
create index mt5_symbol_mappings_instrument_idx on private.mt5_symbol_mappings(instrument_id);
create table private.mt5_symbol_mapping_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  broker_symbol text not null,
  mapping_version bigint not null check (mapping_version>0),
  previous_instrument_id uuid references public.instruments(id),
  new_instrument_id uuid not null references public.instruments(id),
  actor_user_id uuid not null references auth.users(id),
  operation_id uuid not null,
  reason text not null check (length(btrim(reason)) between 8 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(connection_id,broker_symbol) references private.mt5_symbol_mappings(connection_id,broker_symbol),
  unique(connection_id,broker_symbol,mapping_version)
);
create index mt5_symbol_mapping_events_previous_idx on private.mt5_symbol_mapping_events(previous_instrument_id);
create index mt5_symbol_mapping_events_new_idx on private.mt5_symbol_mapping_events(new_instrument_id);
create index mt5_symbol_mapping_events_actor_idx on private.mt5_symbol_mapping_events(actor_user_id);
alter table private.mt5_symbol_mappings enable row level security;
alter table private.mt5_symbol_mapping_events enable row level security;
revoke all on private.mt5_symbol_mappings,private.mt5_symbol_mapping_events from public,anon,authenticated;
create trigger mt5_symbol_mapping_events_immutable before update or delete on private.mt5_symbol_mapping_events
  for each row execute function private.reject_integration_audit_mutation();

create function private.protect_mt5_symbol_mapping() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' or current_user not in ('postgres','service_role')
    or current_setting('trade_os.mt5_symbol_mapping',true) is distinct from new.connection_id::text||':'||new.broker_symbol then
    raise exception 'Approved symbol mapping required.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_mt5_symbol_mapping() from public,anon,authenticated;
create trigger mt5_symbol_mapping_guard before insert or update or delete on private.mt5_symbol_mappings
  for each row execute function private.protect_mt5_symbol_mapping();

create function private.mt5_save_symbol_mapping(p_request jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor jsonb; c private.mt5_connections; instrument public.instruments; previous private.mt5_symbol_mappings;
  result jsonb; v_broker_symbol text:=p_request->>'brokerSymbol'; new_version bigint;
begin
  actor:=private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid);
  result:=private.integration_operation_result(actor,(p_request->>'operationId')::uuid,'MT5_SYMBOL_MAPPING',p_request);
  if result is not null then return result; end if;
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-array['connectionId','operationId','version','snapshotToken','brokerSymbol','instrumentId','reason']<>'{}'::jsonb
    or not (p_request ?& array['connectionId','operationId','version','snapshotToken','brokerSymbol','instrumentId','reason'])
    or jsonb_typeof(p_request->'version') is distinct from 'string' or (p_request->>'version') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_request->'snapshotToken') is distinct from 'string' or (p_request->>'snapshotToken') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_request->'reason') is distinct from 'string'
    or jsonb_typeof(p_request->'instrumentId') is distinct from 'string'
    or jsonb_typeof(p_request->'operationId') is distinct from 'string'
    or jsonb_typeof(p_request->'brokerSymbol') is distinct from 'string' or length(v_broker_symbol) not between 1 and 128
    or v_broker_symbol is distinct from btrim(v_broker_symbol) or length(btrim(coalesce(p_request->>'reason',''))) not between 8 and 1000 then
    raise exception 'Invalid symbol mapping decision.' using errcode='22023';
  end if;
  select * into c from private.mt5_connections where id=(p_request->>'connectionId')::uuid and owner_id=auth.uid()
    and grant_id=(actor->>'grant_id')::uuid and account_id=(actor->>'account_id')::uuid for update;
  if not found then raise exception 'Connection access denied.' using errcode='42501'; end if;
  if c.status not in ('ONBOARDING','ACTIVE','PAUSED') or c.version::text is distinct from p_request->>'version'
    or private.mt5_source_snapshot_token(c.id) is distinct from p_request->>'snapshotToken' then
    raise exception 'Symbol mapping preview changed.' using errcode='40001';
  end if;
  if not exists(select 1 from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id
    where f.connection_id=c.id and r.kind in ('DEAL','ORDER','POSITION') and r.payload->>'symbol'=v_broker_symbol) then
    raise exception 'A captured broker symbol is required.' using errcode='23514';
  end if;
  select * into instrument from public.instruments where id=(p_request->>'instrumentId')::uuid
    and (user_id is null or user_id=auth.uid()) for share;
  if not found then raise exception 'Instrument access denied.' using errcode='42501'; end if;
  if exists(select 1 from private.mt5_execution_versions v join public.trades t on t.id=v.trade_id
    where v.connection_id=c.id and v.execution->>'symbol'=v_broker_symbol and t.instrument_id<>instrument.id) then
    raise exception 'Published broker symbols cannot be reassigned.' using errcode='23514';
  end if;
  select * into previous from private.mt5_symbol_mappings where connection_id=c.id and broker_symbol=v_broker_symbol;
  new_version:=coalesce(previous.version,0)+1;
  perform set_config('trade_os.mt5_symbol_mapping',c.id::text||':'||v_broker_symbol,true);
  insert into private.mt5_symbol_mappings(connection_id,broker_symbol,instrument_id,version,reason)
    values(c.id,v_broker_symbol,instrument.id,new_version,btrim(p_request->>'reason'))
    on conflict(connection_id,broker_symbol) do update set instrument_id=excluded.instrument_id,version=excluded.version,
      reason=excluded.reason,updated_at=clock_timestamp();
  perform set_config('trade_os.mt5_symbol_mapping','',true);
  insert into private.mt5_symbol_mapping_events(connection_id,broker_symbol,mapping_version,previous_instrument_id,
    new_instrument_id,actor_user_id,operation_id,reason)
    values(c.id,v_broker_symbol,new_version,previous.instrument_id,instrument.id,auth.uid(),(p_request->>'operationId')::uuid,btrim(p_request->>'reason'));
  update private.mt5_connections set version=version+1 where id=c.id returning * into c;
  result:=jsonb_build_object('connectionId',c.id,'version',c.version::text,'brokerSymbol',v_broker_symbol,
    'instrumentId',instrument.id,'mappingVersion',new_version::text);
  perform private.record_integration_operation(actor,(p_request->>'operationId')::uuid,'MT5_SYMBOL_MAPPING',p_request,result,
    jsonb_build_array(c.id,instrument.id),jsonb_build_object('actorType','BROWSER','brokerSymbol',v_broker_symbol,
      'previousInstrumentId',previous.instrument_id,'instrumentId',instrument.id,'mappingVersion',new_version::text,'reason',btrim(p_request->>'reason')));
  return result;
end;
$$;
revoke all on function private.mt5_save_symbol_mapping(jsonb) from public,anon,authenticated;

-- Existing owner-only source reads retain pagination and add current typed maps.
create function private.mt5_browser_source_page_with_mappings(p_connection_id uuid,p_offset integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; mappings jsonb;
begin
  perform private.require_direct_browser_session();
  result:=private.mt5_browser_source_page(p_connection_id,p_offset,p_limit);
  select coalesce(jsonb_agg(jsonb_build_object('brokerSymbol',m.broker_symbol,'instrumentId',m.instrument_id,
    'version',m.version::text,'reason',m.reason,'updatedAt',m.updated_at) order by m.broker_symbol),'[]'::jsonb)
    into mappings from (select * from private.mt5_symbol_mappings where connection_id=p_connection_id
      order by broker_symbol limit p_limit offset p_offset) m;
  return result||jsonb_build_object('symbolMappings',mappings,'symbolMappingCount',
    (select count(*) from private.mt5_symbol_mappings where connection_id=p_connection_id));
end;
$$;
create or replace function public.mt5_browser_source_page(p_connection_id uuid,p_offset integer default 0,p_limit integer default 1000)
returns jsonb language sql security invoker set search_path='' as $$ select private.mt5_browser_source_page_with_mappings(p_connection_id,p_offset,p_limit); $$;
revoke all on function private.mt5_browser_source_page_with_mappings(uuid,integer,integer) from public,anon;
grant execute on function private.mt5_browser_source_page_with_mappings(uuid,integer,integer) to authenticated;

-- Preserve every publication check; only explicit mapping resolution changes.
create or replace function private.mt5_publish_browser(p_request jsonb,p_proposal jsonb) returns jsonb
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
      and (user_id is null or user_id=auth.uid())
      and (exists(select 1 from private.mt5_symbol_mappings m where m.connection_id=c.id
             and m.broker_symbol=item->>'symbol' and m.instrument_id=public.instruments.id)
        or (symbol=item->>'symbol'
          and not exists(select 1 from private.mt5_symbol_mappings m where m.connection_id=c.id and m.broker_symbol=item->>'symbol')
          and (select count(*) from public.instruments exact where exact.symbol=item->>'symbol'
            and (exact.user_id is null or exact.user_id=auth.uid()))=1)) for share;
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
    if exists(select 1 from public.trades t where t.account_id=a.id and exists(select 1 from public.instruments matched where matched.id=t.instrument_id and matched.symbol=instrument.symbol)
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
