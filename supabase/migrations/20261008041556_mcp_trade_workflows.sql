-- Keep concurrency metadata private: adding a column to trades would invalidate
-- MT5 source-review fingerprints that intentionally cover the existing full row.
create table private.application_trade_versions (
  trade_id uuid primary key references public.trades(id) on delete cascade,
  record_version bigint not null default 1 check(record_version>0)
);
alter table private.application_trade_versions enable row level security;
revoke all on private.application_trade_versions from public,anon,authenticated,service_role;
insert into private.application_trade_versions(trade_id) select id from public.trades;
create function private.application_bump_trade_version() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
  if tg_table_name='trades' then target_id:=coalesce(new.id,old.id);
  elsif tg_table_name='trade_rule_review_items' then
    select trade_id into target_id from public.trade_rule_reviews where id=coalesce(new.review_id,old.review_id);
  else target_id:=coalesce(new.trade_id,old.trade_id); end if;
  if target_id is not null and exists(select 1 from public.trades where id=target_id) then
    insert into private.application_trade_versions(trade_id) values(target_id)
      on conflict(trade_id) do update set record_version=application_trade_versions.record_version+1;
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.application_bump_trade_version() from public,anon,authenticated,service_role;
do $$declare table_name text;begin
  foreach table_name in array array['trades','trade_targets','trade_management_events','trade_plan_corrections','trade_execution_reviews',
    'trade_psychology','trade_reviews','trade_rule_results','trade_rule_reviews','trade_rule_review_items'] loop
    execute format('create trigger application_trade_version after insert or update or delete on public.%I for each row execute function private.application_bump_trade_version()',table_name);
  end loop;
end;$$;

create function private.application_trade_wire(value public.trades) returns jsonb
language sql stable set search_path='' as $$
  select private.application_wire_record('public.trades',to_jsonb(value))||jsonb_build_object('record_version',v.record_version::text)
  from private.application_trade_versions v where v.trade_id=value.id;
$$;
create function private.application_trade_read(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); trade public.trades; records jsonb; parts jsonb; table_name text; key_name text;
  page_size integer:=coalesce((request->>'limit')::integer,50); next_cursor uuid;
begin
  if request ? 'id' then
    select t.* into trade from public.trades t where t.id=(request->>'id')::uuid and t.user_id=auth.uid();
    if not found then raise exception 'Trade not found.' using errcode='P0002'; end if;
    records:=jsonb_build_object('trade',private.application_trade_wire(trade));
    for table_name,key_name in select * from (values('trade_targets','targets'),('trade_management_events','managementEvents'),
      ('trade_plan_corrections','corrections'),('trade_execution_reviews','executionReview'),('trade_psychology','psychology'),
      ('trade_reviews','review'),('trade_rule_results','ruleResults'),('trade_rule_reviews','ruleReview'),('trade_screenshots','screenshots')) x loop
      execute format('select coalesce(jsonb_agg(private.application_wire_record($1,to_jsonb(t)) order by created_at,id),''[]''::jsonb) from public.%I t where trade_id=$2 and user_id=$3',table_name)
        into parts using ('public.'||table_name)::regclass,trade.id,auth.uid();
      if table_name='trade_plan_corrections' then
        select coalesce(jsonb_agg(case when value->>'value_type'='numeric' then value||jsonb_build_object(
          'previous_value',case when value->'previous_value'='null'::jsonb then 'null'::jsonb else to_jsonb(value->>'previous_value') end,
          'new_value',case when value->'new_value'='null'::jsonb then 'null'::jsonb else to_jsonb(value->>'new_value') end) else value end),'[]'::jsonb)
          into parts from jsonb_array_elements(parts);
      end if;
      records:=records||jsonb_build_object(key_name,case when table_name in ('trade_execution_reviews','trade_psychology','trade_reviews','trade_rule_reviews') then coalesce(parts->0,'null'::jsonb) else parts end);
    end loop;
    select coalesce(jsonb_agg(private.application_wire_record('public.trade_rule_review_items',to_jsonb(i)) order by display_order),'[]'::jsonb)
      into parts from public.trade_rule_review_items i join public.trade_rule_reviews r on r.id=i.review_id where r.trade_id=trade.id and r.user_id=auth.uid();
    return records||jsonb_build_object('ruleReviewItems',parts);
  end if;
  if page_size not between 1 and 100 then raise exception 'Invalid page.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(private.application_trade_wire(t) order by id),'[]'::jsonb) into records from (
    select * from public.trades where user_id=auth.uid() and (request->>'accountId' is null or account_id=(request->>'accountId')::uuid)
      and (request->>'status' is null or status=(request->>'status')::public.trade_status)
      and (request->>'afterId' is null or id>(request->>'afterId')::uuid) order by id limit page_size+1) t;
  if jsonb_array_length(records)>page_size then next_cursor:=(records->(page_size-1)->>'id')::uuid; records:=records-page_size; end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;
$$;

create function private.application_trade_prepare(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); receipt jsonb; trade public.trades; account public.trading_accounts; target_account uuid; targets jsonb;
begin
  receipt:=private.application_operation_result(request,'TRADE_'||(request->>'action'));
  if receipt is not null then return jsonb_build_object('receipt',receipt); end if;
  if request->>'action'<>'CREATE' then
    select t.* into trade from public.trades t where t.id=(request->>'id')::uuid and t.user_id=auth.uid() for update;
    if not found then raise exception 'Trade not found.' using errcode='P0002'; end if;
    if (select record_version::text from private.application_trade_versions where trade_id=trade.id) is distinct from request->>'expectedVersion' then
      raise exception 'Trade version conflict.' using errcode='40001'; end if;
  end if;
  target_account:=coalesce((request->'values'->>'account_id')::uuid,trade.account_id);
  select a.* into account from public.trading_accounts a where a.id=target_account and a.user_id=auth.uid() for update;
  if not found then raise exception 'Account not found.' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(private.application_wire_record('public.trade_targets',to_jsonb(t)) order by created_at,id),'[]'::jsonb)
    into targets from public.trade_targets t where t.trade_id=trade.id and t.user_id=auth.uid();
  return jsonb_build_object('trade',case when trade.id is null then null else private.application_trade_wire(trade) end,
    'account',private.application_account_read(jsonb_build_object('id',account.id)),'targets',targets,
    'related',case when trade.id is null then null else private.application_trade_read(jsonb_build_object('id',trade.id))-array['trade','screenshots','corrections','managementEvents'] end,
    'usedPartialExits',exists(select 1 from public.trade_management_events e where e.trade_id=trade.id and e.event_type='SCALE_OUT'));
end;
$$;

create function private.application_trade_references(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); records jsonb; page_size integer:=coalesce((request->>'limit')::integer,50); next_cursor uuid;
begin
  if page_size not between 1 and 100 then raise exception 'Invalid page.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(private.application_wire_record('public.instruments',to_jsonb(t)) order by id),'[]'::jsonb) into records from (
    select * from public.instruments where (user_id is null or user_id=auth.uid()) and active
      and (request->>'afterId' is null or id>(request->>'afterId')::uuid) order by id limit page_size+1) t;
  if jsonb_array_length(records)>page_size then next_cursor:=(records->(page_size-1)->>'id')::uuid; records:=records-page_size; end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;
$$;

create function private.application_trade_numeric_check(p_table regclass,p_values jsonb) returns void
language plpgsql set search_path='' as $$
declare key text; row_json jsonb;
begin
  perform private.application_actor();
  if p_table not in ('public.trade_targets'::regclass,'public.trade_management_events'::regclass) then raise exception 'Invalid numeric domain.' using errcode='22023'; end if;
  execute format('select to_jsonb(jsonb_populate_record(null::%s,$1))',p_table) into row_json using p_values;
  for key in select attname from pg_attribute where attrelid=p_table and atttypid='numeric'::regtype and attnum>0 and not attisdropped loop
    if p_values->>key is not null and (jsonb_typeof(p_values->key)<>'string' or (p_values->>key)::numeric<>(row_json->>key)::numeric) then raise exception 'Numeric storage precision conflict.' using errcode='22003'; end if;
  end loop;
end;
$$;

-- The dynamic identifiers here come exclusively from fixed table/field lists.
-- It is not a general SQL or arbitrary table-writing interface.
create function private.application_trade_review(p_trade uuid,p_kind text,p_review jsonb) returns void
language plpgsql set search_path='' as $$
declare table_name text; allowed text[]; values_json jsonb:=p_review->'values'; column_name text; columns_sql text; select_sql text; update_sql text;
begin
  perform private.application_actor();
  if p_kind='execution' then table_name:='trade_execution_reviews'; allowed:=array['entry_according_to_plan','stop_according_to_plan','target_according_to_plan','stop_action',
    'closed_early','entered_early','entered_late','chased_price','added_to_position','revenge_trade','over_risked','execution_rating','notes'];
  elsif p_kind='psychology' then table_name:='trade_psychology'; allowed:=array['confidence_before_entry','emotion_before','emotion_during','emotion_after','fear_influenced','greed_influenced','fomo_influenced','notes'];
  elsif p_kind='post' then table_name:='trade_reviews'; allowed:=array['what_went_well','what_went_wrong','would_take_again','improvement','lesson_learned','trade_quality_grade'];
  else raise exception 'Invalid review.' using errcode='22023'; end if;
  if jsonb_typeof(values_json) is distinct from 'object' or exists(select 1 from jsonb_object_keys(values_json) k where not k=any(allowed)) then raise exception 'Invalid review fields.' using errcode='22023'; end if;
  if not exists(select 1 from public.trades where id=p_trade and user_id=auth.uid()) then raise exception 'Trade not found.' using errcode='P0002'; end if;
  if p_review->'complete'='true'::jsonb and not exists(select 1 from public.trades where id=p_trade and user_id=auth.uid() and status='CLOSED') then
    raise exception 'Only closed trades can complete reviews.' using errcode='23514'; end if;
  values_json:=values_json||jsonb_build_object('user_id',auth.uid(),'trade_id',p_trade);
  if p_review->'complete'='true'::jsonb then values_json:=values_json||jsonb_build_object('reviewed_at',clock_timestamp()); end if;
  select string_agg(format('%I',k),','),string_agg(format('r.%I',k),','),string_agg(format('%I=excluded.%I',k,k),',') filter(where k not in ('trade_id','user_id'))
    into columns_sql,select_sql,update_sql from jsonb_object_keys(values_json) k;
  execute format('insert into public.%1$I(%2$s) select %3$s from jsonb_populate_record(null::public.%1$I,$1) r on conflict(trade_id) do update set %4$s',table_name,columns_sql,select_sql,coalesce(update_sql,'trade_id=excluded.trade_id')) using values_json;
end;
$$;

create function private.application_trade_write(request jsonb,proposal jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); snapshot jsonb; old_trade public.trades; candidate public.trades; saved public.trades; account public.trading_accounts;
  values_json jsonb:=proposal->'values'; action text:=request->>'action'; locked boolean; broker boolean; key text; item jsonb; targets jsonb; review_kind text;
  allowed text[]:=array['account_id','instrument_id','direction','status','order_type','session','strategy_id','setup_id','primary_analysis_timeframe','entry_timeframe',
    'higher_timeframe_bias','market_condition','thesis','entry_reason','confirmation_notes','planned_at','opened_at','closed_at','timezone_at_entry','account_balance_before',
    'planned_entry','planned_stop_loss','planned_take_profit','planned_lot_size','planned_risk_amount','planned_risk_percentage','planned_reward_amount','planned_risk_reward',
    'actual_entry','actual_stop_loss','actual_exit','actual_lot_size','commission','swap','other_fees','trading_credits','gross_pnl','pips_result','mfe_amount','mfe_pips','mfe_r','mae_amount','mae_pips','mae_r'];
  protected text[]:=array['planned_entry','planned_stop_loss','planned_take_profit','planned_lot_size','planned_risk_amount','planned_risk_percentage','planned_reward_amount','planned_risk_reward',
    'strategy_id','setup_id','thesis','entry_reason','confirmation_notes','account_balance_before','planned_at'];
  broker_fields text[]:=array['account_id','instrument_id','direction','status','opened_at','closed_at','actual_entry','actual_stop_loss','actual_exit','actual_lot_size',
    'commission','swap','other_fees','trading_credits','gross_pnl','pips_result','mfe_amount','mfe_pips','mfe_r','mae_amount','mae_pips','mae_r','net_pnl','outcome','actual_r','holding_duration_seconds'];
  columns_sql text; select_sql text; update_sql text; result jsonb; normalized numeric; used_partials boolean;
begin
  snapshot:=private.application_trade_prepare(request);
  if snapshot ? 'receipt' then return snapshot->'receipt'; end if;
  if action not in ('CREATE','PATCH','TARGETS','CORRECT','MANAGEMENT','REVIEW') or jsonb_typeof(values_json) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(coalesce(request->'values','{}')) k where not k=any(allowed))
    or exists(select 1 from jsonb_object_keys(values_json) k where not k=any(allowed||array['net_pnl','outcome','actual_r','holding_duration_seconds'])) then raise exception 'Invalid trade fields.' using errcode='22023'; end if;
  select a.* into account from public.trading_accounts a where a.id=(snapshot->'account'->>'id')::uuid and a.user_id=auth.uid();
  if action<>'CREATE' then select t.* into old_trade from public.trades t where t.id=(request->>'id')::uuid and t.user_id=auth.uid(); end if;
  locked:=coalesce(old_trade.status in ('OPEN','CLOSED'),false);
  broker:=coalesce(old_trade.mt5_connection_id is not null or old_trade.source_type in ('MT4','MT5','BROKER_API'),false);
  candidate:=jsonb_populate_record(old_trade,values_json);
  if locked and action='PATCH' and candidate.actual_stop_loss is distinct from old_trade.actual_stop_loss then raise exception 'Use explicit management history for stop movement.' using errcode='23514'; end if;
  if locked and action<>'CORRECT' then
    foreach key in array protected||array['account_id','instrument_id','direction'] loop
      if to_jsonb(candidate)->key is distinct from to_jsonb(old_trade)->key then raise exception 'Recorded plan is protected.' using errcode='23514'; end if;
    end loop;
  end if;
  if broker then
    foreach key in array broker_fields loop if to_jsonb(candidate)->key is distinct from to_jsonb(old_trade)->key then raise exception 'Broker execution is protected.' using errcode='23514'; end if; end loop;
    if request ? 'executedTargets' or action='MANAGEMENT' then raise exception 'Broker execution is protected.' using errcode='23514'; end if;
  end if;
  -- Reject numeric precision lost by PostgreSQL typmods rather than truncating.
  for key in select attname from pg_attribute where attrelid='public.trades'::regclass and atttypid='numeric'::regtype and attnum>0 and not attisdropped loop
    if values_json->>key is not null and (jsonb_typeof(values_json->key)<>'string' or (values_json->>key)::numeric<>(to_jsonb(candidate)->>key)::numeric) then raise exception 'Trade storage precision conflict.' using errcode='22003'; end if;
  end loop;
  if candidate.status in ('OPEN','CLOSED') and candidate.opened_at is null or candidate.status='CLOSED' and (candidate.closed_at is null or candidate.gross_pnl is null)
    or candidate.status<>'CLOSED' and candidate.closed_at is not null then raise exception 'Incomplete trade timestamps or finalization.' using errcode='23514'; end if;
  if candidate.strategy_id is not null and (old_trade.strategy_id is distinct from candidate.strategy_id or action='CREATE') and not exists(select 1 from public.strategies where id=candidate.strategy_id and user_id=auth.uid() and active and archived_at is null) then raise exception 'Strategy unavailable.' using errcode='23503'; end if;
  if candidate.setup_id is not null and (old_trade.setup_id is distinct from candidate.setup_id or action='CREATE') and not exists(select 1 from public.setups where id=candidate.setup_id and strategy_id=candidate.strategy_id and user_id=auth.uid() and active and archived_at is null) then raise exception 'Setup unavailable.' using errcode='23503'; end if;
  if not exists(select 1 from public.instruments where id=candidate.instrument_id and (user_id is null or user_id=auth.uid()) and (active or action<>'CREATE' and old_trade.instrument_id=candidate.instrument_id)) then raise exception 'Instrument unavailable.' using errcode='23503'; end if;
  if action='CREATE' then
    candidate.id:=gen_random_uuid(); candidate.user_id:=auth.uid(); candidate.source_type:='MANUAL';
    -- Initial row is pre-open so planned targets can be recorded before locking.
    insert into public.trades(id,user_id,account_id,instrument_id,direction,status) values(candidate.id,auth.uid(),candidate.account_id,candidate.instrument_id,candidate.direction,'DRAFT');
  else candidate.id:=old_trade.id; end if;
  if request ? 'plannedTargets' then
    if locked then raise exception 'Planned targets are protected.' using errcode='23514'; end if;
    for item in select value from jsonb_array_elements(coalesce(proposal->'plannedTargets',request->'plannedTargets')) loop perform private.application_trade_numeric_check('public.trade_targets',item); end loop;
    perform private.application_replace_trade_targets_impl(candidate.id,coalesce(proposal->'plannedTargets',request->'plannedTargets'));
    if (select coalesce(sum(actual_close_percentage),0)>100 from public.trade_targets where trade_id=candidate.id) then raise exception 'Actual target percentages exceed 100.' using errcode='23514'; end if;
  end if;
  if request ? 'executedTargets' then
    if not locked then raise exception 'Execution targets require an opened trade.' using errcode='23514'; end if;
    for item in select value from jsonb_array_elements(coalesce(proposal->'executedTargets',request->'executedTargets')) loop perform private.application_trade_numeric_check('public.trade_targets',item); end loop;
    perform private.application_update_trade_target_execution_impl(candidate.id,coalesce(proposal->'executedTargets',request->'executedTargets'));
    if (select coalesce(sum(actual_close_percentage),0)>100 from public.trade_targets where trade_id=candidate.id) then raise exception 'Actual target percentages exceed 100.' using errcode='23514'; end if;
  end if;
  if action='CORRECT' then
    item:=coalesce(proposal->'correctedValue','null'::jsonb);
    if request->>'fieldName' in ('planned_entry','planned_stop_loss','planned_take_profit','planned_lot_size','planned_risk_amount','planned_risk_percentage','planned_reward_amount','planned_risk_reward','target.planned_price','target.planned_close_percentage') and item<>'null'::jsonb then
      item:=to_jsonb((proposal->>'correctedValue')::numeric);
    end if;
    perform private.application_correct_trade_plan_value_impl(candidate.id,request->>'fieldName',item,request->>'reason',(request->>'tradeTargetId')::uuid);
    if jsonb_typeof(item)='number' then
      if request->>'fieldName' like 'target.%' then
        select to_jsonb(t)->>(substr(request->>'fieldName',8)) into key from public.trade_targets t where t.id=(request->>'tradeTargetId')::uuid and t.trade_id=candidate.id;
      else select to_jsonb(t)->>(request->>'fieldName') into key from public.trades t where t.id=candidate.id; end if;
      if key::numeric<>(item::text)::numeric then raise exception 'Correction storage precision conflict.' using errcode='22003'; end if;
    end if;
    select t.* into saved from public.trades t where t.id=candidate.id;
    candidate:=jsonb_populate_record(saved,values_json);
  elsif action='MANAGEMENT' then
    if old_trade.status not in ('OPEN','CLOSED') then raise exception 'Management requires an opened trade.' using errcode='23514'; end if;
    item:=request->'event';
    perform private.application_trade_numeric_check('public.trade_management_events',item);
    if item->>'event_type'<>'NOTE' and ((item->>'occurred_at')::timestamptz<old_trade.opened_at or old_trade.closed_at is not null and (item->>'occurred_at')::timestamptz>old_trade.closed_at) then raise exception 'Management timestamp is outside the trade episode.' using errcode='23514'; end if;
    insert into public.trade_management_events(user_id,trade_id,event_type,occurred_at,price,volume,notes)
      values(auth.uid(),candidate.id,(item->>'event_type')::public.management_event_type,(item->>'occurred_at')::timestamptz,(item->>'price')::numeric,(item->>'volume')::numeric,item->>'notes');
    if item->>'event_type'='STOP_MOVED' and old_trade.status='OPEN' then
      if item->>'price' is null then raise exception 'Stop movement requires price.' using errcode='23514'; end if;
      values_json:=values_json||jsonb_build_object('actual_stop_loss',item->'price'); candidate.actual_stop_loss:=(item->>'price')::numeric;
    end if;
  end if;
  if not broker then
    if candidate.status='CLOSED' then
      normalized:=round(candidate.gross_pnl-candidate.commission-candidate.swap-candidate.other_fees+candidate.trading_credits,account.currency_precision);
      select exists(select 1 from public.trade_targets t where t.trade_id=candidate.id and t.actual_close_percentage>0 and t.actual_close_percentage<100)
        or exists(select 1 from public.trade_management_events e where e.trade_id=candidate.id and e.event_type='SCALE_OUT') into used_partials;
      if candidate.net_pnl is distinct from normalized or candidate.outcome is distinct from (case when normalized=0 then 'BREAK_EVEN' when normalized>0 then case when used_partials then 'PARTIAL_WIN' else 'WIN' end else case when used_partials then 'PARTIAL_LOSS' else 'LOSS' end end)::public.trade_outcome then
        raise exception 'Finalization contradicts financial evidence.' using errcode='23514'; end if;
      if candidate.actual_r is distinct from (case when candidate.planned_risk_amount>0 then round(normalized/candidate.planned_risk_amount,8) else null end) then raise exception 'R contradicts planned risk.' using errcode='23514'; end if;
    elsif candidate.net_pnl is not null or candidate.outcome is not null or candidate.actual_r is not null then raise exception 'Open trades cannot realize profit.' using errcode='23514'; end if;
  end if;
  select string_agg(format('%I',k),','),string_agg(format('r.%I',k),',') into columns_sql,select_sql from jsonb_object_keys(values_json) k;
  if columns_sql is not null then execute format('update public.trades t set (%s)=(select %s from jsonb_populate_record(t,$1) r) where t.id=$2 and t.user_id=$3',columns_sql,select_sql)
    using values_json,candidate.id,auth.uid(); end if;
  if request ? 'reviews' then
    foreach review_kind in array array['execution','psychology','post'] loop
      if request->'reviews' ? review_kind then perform private.application_trade_review(candidate.id,review_kind,request->'reviews'->review_kind); end if;
    end loop;
    if request->'reviews' ? 'rules' then
      if (select count(distinct value->>'trading_rule_id') from jsonb_array_elements(request->'reviews'->'rules'->'results'))<>jsonb_array_length(request->'reviews'->'rules'->'results') then raise exception 'Duplicate rule IDs.' using errcode='22023'; end if;
      if exists(select 1 from public.trade_rule_reviews where trade_id=candidate.id and user_id=auth.uid()) then
        if request->'reviews'->'rules'->'complete'='true'::jsonb or jsonb_array_length(request->'reviews'->'rules'->'results')>0 then raise exception 'Rule review already complete.' using errcode='23514'; end if;
      else
        for item in select value from jsonb_array_elements(request->'reviews'->'rules'->'results') loop
          if not exists(select 1 from public.trading_rules where id=(item->>'trading_rule_id')::uuid and user_id=auth.uid() and active and archived_at is null and (account_id is null or account_id=account.id)) then raise exception 'Rule unavailable.' using errcode='23503'; end if;
          if item->'complied'='null'::jsonb then
            if request->'reviews'->'rules'->'complete'='true'::jsonb then raise exception 'Completed rule review requires explicit answers.' using errcode='23514'; end if;
            delete from public.trade_rule_results where trade_id=candidate.id and user_id=auth.uid() and trading_rule_id=(item->>'trading_rule_id')::uuid;
            continue;
          end if;
          insert into public.trade_rule_results(user_id,trade_id,trading_rule_id,complied,notes) values(auth.uid(),candidate.id,(item->>'trading_rule_id')::uuid,(item->>'complied')::boolean,item->>'notes')
            on conflict(trade_id,trading_rule_id) do update set complied=excluded.complied,notes=case when item ? 'notes' then excluded.notes else trade_rule_results.notes end;
        end loop;
        if request->'reviews'->'rules'->'complete'='true'::jsonb then
          select coalesce(jsonb_agg(jsonb_build_object('trading_rule_id',r.trading_rule_id,'complied',r.complied,'notes',r.notes)),'[]'::jsonb) into targets
            from public.trade_rule_results r where r.trade_id=candidate.id and r.user_id=auth.uid() and r.trading_rule_id in
              (select (value->>'trading_rule_id')::uuid from jsonb_array_elements(request->'reviews'->'rules'->'results'));
          perform private.application_complete_trade_rule_review_impl(candidate.id,targets);
        end if;
      end if;
    end if;
  end if;
  select t.* into saved from public.trades t where t.id=candidate.id and t.user_id=auth.uid();
  result:=jsonb_build_object('action',action,'record',private.application_trade_wire(saved));
  perform private.application_record_operation(request,'TRADE_'||action,result,jsonb_build_object('tradeId',saved.id,'accountId',saved.account_id),
    jsonb_build_object('before',snapshot->'trade','beforeRelated',snapshot->'related','after',private.application_trade_wire(saved),
      'afterRelated',private.application_trade_read(jsonb_build_object('id',saved.id))-array['trade','screenshots','corrections','managementEvents'],
      'reason',request->>'reason','targets',request->'plannedTargets','executionTargets',request->'executedTargets','reviews',request->'reviews','management',request->'event'));
  return result;
end;
$$;
revoke all on function private.application_trade_wire(public.trades),private.application_trade_read(jsonb),private.application_trade_prepare(jsonb),
  private.application_trade_review(uuid,text,jsonb),private.application_trade_write(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.application_trade_references(jsonb),private.application_trade_numeric_check(regclass,jsonb) from public,anon,authenticated,service_role;

-- Browser ledger shares the same exact boundary and does not inherit the Data
-- API's row cap. Equity remains an observation, not a balance replacement.
create function private.application_account_ledger(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); ledger_account_id uuid:=(request->>'id')::uuid; result jsonb;
begin
  result:=jsonb_build_object('account',private.application_account_read(jsonb_build_object('id',ledger_account_id)));
  return result||jsonb_build_object(
    'trades',(select coalesce(jsonb_agg(private.application_wire_record('public.trades',to_jsonb(t)) order by closed_at,id),'[]'::jsonb) from public.trades t where t.account_id=ledger_account_id and t.user_id=auth.uid() and status='CLOSED' and closed_at is not null),
    'adjustments',(select coalesce(jsonb_agg(private.application_wire_record('public.account_adjustments',to_jsonb(t)) order by occurred_at,id),'[]'::jsonb) from public.account_adjustments t where t.account_id=ledger_account_id and t.user_id=auth.uid()),
    'snapshots',(select coalesce(jsonb_agg(private.application_wire_record('public.account_snapshots',to_jsonb(t)) order by captured_at desc,id),'[]'::jsonb) from public.account_snapshots t where t.account_id=ledger_account_id and t.user_id=auth.uid()),
    'classifications',(select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id),'[]'::jsonb) from public.account_adjustment_classifications c join public.account_adjustments a on a.id=c.adjustment_id where a.account_id=ledger_account_id and a.user_id=auth.uid() and c.user_id=auth.uid()),
    'instruments',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'symbol',i.symbol)),'[]'::jsonb) from public.instruments i where i.user_id is null or i.user_id=auth.uid()));
end;
$$;
revoke all on function private.application_account_ledger(jsonb) from public,anon,authenticated,service_role;
