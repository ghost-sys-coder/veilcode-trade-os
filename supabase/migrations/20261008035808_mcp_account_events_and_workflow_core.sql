-- Legacy public/browser RPCs retain their exact OAuth denial. Their domain
-- bodies are shared with narrowly verified server workflows, not duplicated.
create function private.application_workflow_actor() returns void
language plpgsql set search_path='' as $$
begin
  if auth.jwt()->>'client_id' is null then perform private.require_direct_browser_session();
  else perform private.application_actor(); end if;
end;
$$;
revoke all on function private.application_workflow_actor() from public,anon,authenticated,service_role;

do $extract_domain$
declare target record; definition text; body text; shared_definition text; wrapper_definition text;
  shared_name text; bridge_name text; arguments text; identity_arguments text; call_statement text;
begin
  for target in select p.*,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.oid in ('private.correct_trade_plan_value(uuid,text,jsonb,text,uuid)'::regprocedure,
      'private.complete_trade_rule_review(uuid,jsonb)'::regprocedure,
      'private.transition_account_status(uuid,public.account_status,timestamptz,public.account_failure_reason,text)'::regprocedure,
      'public.replace_trade_targets(uuid,jsonb)'::regprocedure,
      'public.update_trade_target_execution(uuid,jsonb)'::regprocedure,
      'public.classify_account_adjustment(uuid,boolean,text)'::regprocedure)
  loop
    definition:=pg_get_functiondef(target.oid); body:=target.prosrc;
    if position('perform private.require_direct_browser_session();' in body)=0 then raise exception 'Expected browser boundary missing.'; end if;
    shared_name:='application_' || target.proname || '_impl';
    identity_arguments:=pg_get_function_identity_arguments(target.oid);
    arguments:=array_to_string(target.proargnames,',');
    shared_definition:=replace(definition,format('FUNCTION %I.%I(',target.nspname,target.proname),format('FUNCTION private.%I(',shared_name));
    shared_definition:=replace(shared_definition,body,replace(body,'perform private.require_direct_browser_session();','perform private.application_workflow_actor();'));
    shared_definition:=replace(shared_definition,'SECURITY DEFINER','SECURITY INVOKER');
    execute shared_definition;
    execute format('alter function private.%I(%s) security invoker',shared_name,identity_arguments);
    execute format('revoke all on function private.%I(%s) from public,anon,authenticated,service_role',shared_name,identity_arguments);
    call_statement:=case when target.prorettype='void'::regtype then format('perform private.%I(%s); return;',shared_name,arguments)
      else format('return private.%I(%s);',shared_name,arguments) end;
    wrapper_definition:=replace(definition,body,E'begin\n  perform private.require_direct_browser_session();\n  ' || call_statement || E'\nend;\n');
    if target.nspname='public' then
      bridge_name:='application_browser_' || target.proname;
      execute replace(wrapper_definition,format('FUNCTION public.%I(',target.proname),format('FUNCTION private.%I(',bridge_name));
      execute format('alter function private.%I(%s) security definer',bridge_name,identity_arguments);
      execute format('revoke all on function private.%I(%s) from public,anon,service_role',bridge_name,identity_arguments);
      execute format('grant execute on function private.%I(%s) to authenticated',bridge_name,identity_arguments);
      call_statement:=case when target.prorettype='void'::regtype then format('perform private.%I(%s); return;',bridge_name,arguments)
        else format('return private.%I(%s);',bridge_name,arguments) end;
      wrapper_definition:=replace(definition,body,E'begin\n  perform private.require_direct_browser_session();\n  ' || call_statement || E'\nend;\n');
    end if;
    execute wrapper_definition;
  end loop;
end;
$extract_domain$;

alter table public.account_adjustments add column record_version bigint not null default 1 check(record_version>0);
create trigger account_adjustment_record_version before insert or update on public.account_adjustments
  for each row execute function private.account_record_version();

create function private.application_signed_money(value text,p_precision integer) returns numeric
language plpgsql immutable set search_path='' as $$
begin
  if value is null or value !~ '^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,20})?$' then raise exception 'Invalid monetary string.' using errcode='22023'; end if;
  return private.application_normalized_money(abs(value::numeric)::text,p_precision)*case when value::numeric<0 then -1 else 1 end;
end;
$$;

-- Wire conversion derives numeric columns from the fixed server-side catalog.
-- PostgreSQL numeric/bigint are always strings; never serialize them to doubles.
create function private.application_wire_record(p_table regclass,p_row jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare column_name text; result jsonb:=p_row;
begin
  if p_row is null then return null; end if;
  for column_name in select attname from pg_attribute where attrelid=p_table and attnum>0 and not attisdropped
    and atttypid in ('numeric'::regtype,'int8'::regtype) loop
    result:=jsonb_set(result,array[column_name],coalesce(to_jsonb(p_row->>column_name),'null'::jsonb));
  end loop;
  return result;
end;
$$;

create function private.application_account_event_prepare(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); receipt jsonb; account public.trading_accounts; adjustment public.account_adjustments;
begin
  receipt:=private.application_operation_result(request,'ACCOUNT_EVENT_' || (request->>'action'));
  if receipt is not null then return jsonb_build_object('receipt',receipt); end if;
  if request->>'action'='CLASSIFY' then
    select * into adjustment from public.account_adjustments where id=(request->>'id')::uuid and user_id=auth.uid() for update;
    if not found then raise exception 'Adjustment not found.' using errcode='P0002'; end if;
    if adjustment.record_version::text is distinct from request->>'expectedVersion' then raise exception 'Adjustment version conflict.' using errcode='40001'; end if;
    select * into account from public.trading_accounts where id=adjustment.account_id and user_id=auth.uid() for update;
  else
    select * into account from public.trading_accounts where id=(request->>'accountId')::uuid and user_id=auth.uid() for update;
    if not found then raise exception 'Account not found.' using errcode='P0002'; end if;
    if request->>'action' in ('TRANSITION','LINK_FUNDED') and account.record_version::text is distinct from request->>'expectedVersion' then
      raise exception 'Account version conflict.' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('account',private.application_account_record_wire(account),'adjustment',private.application_wire_record('public.account_adjustments',to_jsonb(adjustment)));
end;
$$;

create function private.application_account_event_write(request jsonb,proposal jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); snapshot jsonb; account public.trading_accounts; adjustment public.account_adjustments;
  observation public.account_snapshots; status_event public.account_status_events; linked public.trading_accounts;
  result jsonb; action text:=request->>'action'; amount numeric; before_row jsonb; row_value jsonb;
begin
  snapshot:=private.application_account_event_prepare(request);
  if snapshot ? 'receipt' then return snapshot->'receipt'; end if;
  select * into account from public.trading_accounts where id=(snapshot->'account'->>'id')::uuid;
  if action='ADJUSTMENT' then
    if jsonb_typeof(request->'amount') is distinct from 'string' or request->>'type' not in ('DEPOSIT','WITHDRAWAL','BALANCE_CORRECTION','OTHER') then
      raise exception 'Invalid adjustment.' using errcode='22023'; end if;
    amount:=private.application_signed_money(request->>'amount',account.currency_precision);
    if request->>'type'='DEPOSIT' then amount:=abs(amount); elsif request->>'type'='WITHDRAWAL' then amount:=-abs(amount); end if;
    if jsonb_typeof(proposal->'amount') is distinct from 'string' or amount<>(proposal->>'amount')::numeric or amount=0 then
      raise exception 'Invalid normalized adjustment.' using errcode='23514'; end if;
    if request->>'type'='BALANCE_CORRECTION' and length(btrim(coalesce(request->>'notes','')))<5 then
      raise exception 'Balance correction reason required.' using errcode='23514'; end if;
    if request->>'type'<>'OTHER' and request->'isPerformanceNeutral'='false'::jsonb then raise exception 'Fixed adjustments must be neutral.' using errcode='23514'; end if;
    insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at,notes,is_performance_neutral,classification_reason)
      values(auth.uid(),account.id,(request->>'type')::public.adjustment_type,amount,(request->>'occurredAt')::timestamptz,
        request->>'notes',case when request->>'type'='OTHER' then (request->>'isPerformanceNeutral')::boolean else true end,request->>'classificationReason') returning * into adjustment;
    row_value:=private.application_wire_record('public.account_adjustments',to_jsonb(adjustment));
  elsif action='CLASSIFY' then
    before_row:=snapshot->'adjustment';
    select * into adjustment from private.application_classify_account_adjustment_impl((request->>'id')::uuid,(request->>'isPerformanceNeutral')::boolean,request->>'reason');
    perform set_config('trade_os.adjustment_classification_workflow','',true);
    row_value:=private.application_wire_record('public.account_adjustments',to_jsonb(adjustment));
  elsif action='SNAPSHOT' then
    if jsonb_typeof(proposal->'balance') is distinct from 'string' or jsonb_typeof(proposal->'equity') is distinct from 'string'
      or jsonb_typeof(proposal->'unrealizedPnl') is distinct from 'string'
      or (proposal->>'balance')::numeric<>private.application_signed_money(request->>'balance',account.currency_precision)
      or (proposal->>'equity')::numeric<>(proposal->>'balance')::numeric+(proposal->>'unrealizedPnl')::numeric then
      raise exception 'Invalid snapshot equation.' using errcode='23514'; end if;
    if request->>'equity' is not null and private.application_signed_money(request->>'equity',account.currency_precision)<>(proposal->>'equity')::numeric
      or request->>'unrealizedPnl' is not null and private.application_signed_money(request->>'unrealizedPnl',account.currency_precision)<>(proposal->>'unrealizedPnl')::numeric then
      raise exception 'Snapshot contradicts submitted evidence.' using errcode='23514'; end if;
    insert into public.account_snapshots(user_id,account_id,captured_at,balance,equity,unrealized_pnl,notes)
      values(auth.uid(),account.id,(request->>'capturedAt')::timestamptz,(proposal->>'balance')::numeric,
        (proposal->>'equity')::numeric,(proposal->>'unrealizedPnl')::numeric,request->>'notes') returning * into observation;
    if observation.balance<>private.application_signed_money(observation.balance::text,account.currency_precision)
      or observation.equity<>private.application_signed_money(proposal->>'equity',account.currency_precision)
      or observation.unrealized_pnl<>private.application_signed_money(proposal->>'unrealizedPnl',account.currency_precision) then
      raise exception 'Snapshot storage precision conflict.' using errcode='22003'; end if;
    row_value:=private.application_wire_record('public.account_snapshots',to_jsonb(observation));
  elsif action='TRANSITION' then
    if length(btrim(coalesce(request->>'reason','')))<5 then raise exception 'Lifecycle reason required.' using errcode='23514'; end if;
    before_row:=snapshot->'account';
    select * into status_event from private.application_transition_account_status_impl(account.id,(request->>'status')::public.account_status,
      (request->>'effectiveAt')::timestamptz,(request->>'failureReason')::public.account_failure_reason,request->>'reason');
    select t.* into account from public.trading_accounts t where t.id=(snapshot->'account'->>'id')::uuid and t.user_id=auth.uid();
    row_value:=private.application_account_record_wire(account)||jsonb_build_object('status_event',to_jsonb(status_event));
  elsif action='LINK_FUNDED' then
    if account.account_type<>'PROP_CHALLENGE' or account.status<>'PASSED' then raise exception 'Passed challenge required.' using errcode='23514'; end if;
    amount:=private.application_signed_money(request->>'startingBalance',account.currency_precision);
    if amount<=0 or amount<>(proposal->>'startingBalance')::numeric then raise exception 'Positive funded baseline required.' using errcode='23514'; end if;
    insert into public.trading_accounts(user_id,name,account_type,broker_name,platform,currency_code,currency_precision,starting_balance,leverage,started_at,status,previous_account_id,notes)
      values(auth.uid(),request->>'name','FUNDED',account.broker_name,(request->>'platform')::public.account_platform,account.currency_code,account.currency_precision,
        amount,account.leverage,(request->>'startedAt')::date,'ACTIVE',account.id,request->>'notes') returning * into linked;
    row_value:=private.application_account_record_wire(linked);
  else raise exception 'Invalid account event.' using errcode='22023'; end if;
  result:=jsonb_build_object('action',action,'record',row_value);
  perform private.application_record_operation(request,'ACCOUNT_EVENT_' || action,result,jsonb_build_object('accountId',account.id,'recordId',row_value->>'id'),
    jsonb_build_object('before',before_row,'after',row_value,'reason',coalesce(request->>'reason',request->>'classificationReason',request->>'notes')));
  return result;
end;
$$;

create function private.application_account_event_read(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); records jsonb; table_name text; page_size integer:=(request->>'limit')::integer;
  account_id uuid:=(request->>'accountId')::uuid; cursor_id uuid:=(request->>'afterId')::uuid; next_cursor uuid;
begin
  if not exists(select 1 from public.trading_accounts where id=account_id and user_id=auth.uid()) then raise exception 'Account not found.' using errcode='P0002'; end if;
  if page_size not between 1 and 100 then raise exception 'Invalid page.' using errcode='22023'; end if;
  table_name:=case request->>'kind' when 'ADJUSTMENTS' then 'account_adjustments' when 'SNAPSHOTS' then 'account_snapshots'
    when 'LIFECYCLE' then 'account_status_events' when 'CLASSIFICATIONS' then 'account_adjustment_classifications' end;
  if table_name is null then raise exception 'Invalid account event kind.' using errcode='22023'; end if;
  execute format('select coalesce(jsonb_agg(private.application_wire_record($1,to_jsonb(t)) order by id),''[]''::jsonb)
    from (select * from public.%I where user_id=$2 and %s and ($4::uuid is null or id>$4) order by id limit $5) t',table_name,
    case when request->>'kind'='CLASSIFICATIONS' then 'adjustment_id in (select id from public.account_adjustments where account_id=$3 and user_id=$2)' else 'account_id=$3' end)
    into records using ('public.'||table_name)::regclass,auth.uid(),account_id,cursor_id,page_size+1;
  if jsonb_array_length(records)>page_size then next_cursor:=(records->(page_size-1)->>'id')::uuid; records:=records-page_size; end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;
$$;
revoke all on function private.application_signed_money(text,integer),private.application_wire_record(regclass,jsonb),
  private.application_account_event_prepare(jsonb),private.application_account_event_write(jsonb,jsonb),private.application_account_event_read(jsonb)
  from public,anon,authenticated,service_role;
