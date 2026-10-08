alter table public.trading_accounts add column record_version bigint not null default 1 check(record_version>0);
create function private.account_record_version() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.record_version:=1; else new.record_version:=old.record_version+1; end if;
  return new;
end;
$$;
create trigger account_record_version before insert or update on public.trading_accounts
  for each row execute function private.account_record_version();
create index trading_accounts_owner_cursor_idx on public.trading_accounts(user_id,id);

-- SIX ISO 4217 List One 2026-09-17. No inferred currency precision. Reserved
-- testing/no-currency entries are excluded. Historical account codes are kept.
create table private.account_currency_codes(code text primary key check(code ~ '^[A-Z]{3}$'));
alter table private.account_currency_codes enable row level security;
revoke all on private.account_currency_codes from public,anon,authenticated,service_role;
insert into private.account_currency_codes select unnest(string_to_array(
  'AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAD XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XUA YER ZAR ZMW ZWG',' '));

-- Shared receipt/audit foundation, used by every subsequent application family.
-- Caller-supplied actors are never accepted, even by these private helpers.
create function private.application_operation_result(request jsonb,kind text) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); operation uuid:=(request->>'operationId')::uuid;
  receipt private.application_operations;
begin
  if operation is null then raise exception 'Operation ID required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor->>'user_id' || ':' || (actor->>'actorKey') || ':' || operation::text,0));
  select * into receipt from private.application_operations where owner_id=(actor->>'user_id')::uuid
    and actor_key=actor->>'actorKey' and operation_id=operation;
  if found then
    if receipt.grant_id::text is distinct from actor->>'grant_id' or receipt.resource is distinct from actor->>'resource' then
      raise exception 'Operation scope denied.' using errcode='42501'; end if;
    if receipt.operation_kind<>kind or receipt.request_hash<>encode(extensions.digest(request::text,'sha256'),'hex') then
      raise exception 'Operation payload conflict.' using errcode='23505'; end if;
    return receipt.result;
  end if;
  return null;
end;
$$;
create function private.application_record_operation(request jsonb,kind text,result jsonb,affected jsonb,changes jsonb) returns void
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); receipt_id uuid;
begin
  insert into private.application_operations(owner_id,actor_key,operation_id,grant_id,resource,operation_kind,request_hash,result)
    values((actor->>'user_id')::uuid,actor->>'actorKey',(request->>'operationId')::uuid,(actor->>'grant_id')::uuid,actor->>'resource',kind,
      encode(extensions.digest(request::text,'sha256'),'hex'),result) returning id into receipt_id;
  insert into private.application_mutation_audits(operation_receipt_id,actor_user_id,actor_type,client_id,affected_records,changes)
    values(receipt_id,(actor->>'user_id')::uuid,actor->>'actorType',(actor->>'client_id')::uuid,affected,changes);
end;
$$;

-- Extract, rather than duplicate, the existing verified configuration writer.
do $shared_receipts$
declare definition text; original_body text; body text;
begin
  select pg_get_functiondef(oid),prosrc into definition,original_body from pg_proc where oid='private.configuration_write(jsonb)'::regprocedure;
  body:=regexp_replace(original_body,$pattern$  operation:=\(request->>'operationId'\)::uuid;.*?    return receipt.result;\s*end if;$pattern$,
    $replacement$  response:=private.application_operation_result(request,'CONFIGURATION_' || action);
  if response is not null then return response; end if;$replacement$,'s');
  body:=regexp_replace(body,$pattern$  insert into private.application_operations.*?  return response;$pattern$,
    $replacement$  perform private.application_record_operation(request,'CONFIGURATION_' || action,response,
    jsonb_build_object('entity',entity,'id',target_id),jsonb_build_object('before',before_row,'after',after_row,'reason',request->>'reason'));
  return response;$replacement$,'s');
  if body=original_body or position('private.application_operation_result' in body)=0
    or position('private.application_record_operation' in body)=0 then raise exception 'Shared application extraction failed.'; end if;
  execute replace(definition,original_body,body);
end;
$shared_receipts$;

-- Exact PostgreSQL monetary boundary, matching central decimal ROUND_HALF_UP.
-- Current persisted baseline is numeric(24,8); reject unsupported precision or
-- overflow explicitly rather than allowing its typmod to truncate silently.
create function private.application_normalized_money(value text,p_precision integer) returns numeric
language plpgsql immutable set search_path='' as $$
declare normalized numeric;
begin
  if p_precision not between 0 and 20 or value is null or value !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,20})?$' then
    raise exception 'Invalid monetary value.' using errcode='22023'; end if;
  normalized:=round(value::numeric,p_precision);
  if normalized<>normalized::numeric(24,8) then raise exception 'Unsupported persisted monetary precision.' using errcode='22003'; end if;
  return normalized;
end;
$$;

create function private.application_account_record_wire(account public.trading_accounts) returns jsonb
language sql immutable set search_path='' as $$
  select to_jsonb(account)||jsonb_build_object('record_version',account.record_version::text,
    'starting_balance',account.starting_balance::text,'leverage',account.leverage::text);
$$;
create function private.application_account_wire(account public.trading_accounts) returns jsonb
language sql stable set search_path='' as $$
  select private.application_account_record_wire(account)||jsonb_build_object('closed_trade_net_pnl',coalesce((select sum(net_pnl) from public.trades
      where account_id=account.id and user_id=account.user_id and status='CLOSED'),0)::text,
    'account_adjustments_total',coalesce((select sum(amount) from public.account_adjustments where account_id=account.id and user_id=account.user_id),0)::text,
    'closed_trade_count',(select count(*)::text from public.trades where account_id=account.id and user_id=account.user_id and status='CLOSED'),
    'unclassified_other_count',(select count(*)::text from public.account_adjustments where account_id=account.id and user_id=account.user_id
      and type='OTHER' and is_performance_neutral is null));
$$;
create function private.application_account_read(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); account public.trading_accounts; records jsonb; page_size integer; cursor_id uuid; next_cursor uuid;
begin
  if jsonb_typeof(request) is distinct from 'object' or request - array['id','limit','afterId']<>'{}'::jsonb then
    raise exception 'Invalid account query.' using errcode='22023'; end if;
  if request ? 'id' then
    if request - array['id']<>'{}'::jsonb or jsonb_typeof(request->'id') is distinct from 'string' then
      raise exception 'Invalid account query.' using errcode='22023'; end if;
    select * into account from public.trading_accounts where id=(request->>'id')::uuid and user_id=(actor->>'user_id')::uuid;
    if not found then raise exception 'Account not found.' using errcode='P0002'; end if;
    return private.application_account_wire(account);
  end if;
  if jsonb_typeof(request->'limit') is distinct from 'number' or request->>'limit' !~ '^[0-9]+$' then
    raise exception 'Invalid account query.' using errcode='22023'; end if;
  page_size:=(request->>'limit')::integer; cursor_id:=(request->>'afterId')::uuid;
  if page_size not between 1 and 100 then raise exception 'Invalid account query.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(private.application_account_wire(a::public.trading_accounts) order by id),'[]'::jsonb) into records
    from (select t.* from public.trading_accounts t where user_id=(actor->>'user_id')::uuid
      and (cursor_id is null or id>cursor_id) order by id limit page_size+1) a;
  if jsonb_array_length(records)>page_size then next_cursor:=(records->(page_size-1)->>'id')::uuid; records:=records-page_size; end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;
$$;
create function private.application_account_write(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); action text:=request->>'action'; response jsonb; before_row jsonb;
  current_account public.trading_accounts; saved public.trading_accounts; merged jsonb; values_json jsonb:=request->'values';
  fields text[]:=array['name','account_type','broker_name','platform','currency_code','currency_precision','starting_balance','leverage','started_at','notes'];
  field text; currency_changed boolean; baseline_changed boolean; normalized numeric;
begin
  if jsonb_typeof(request) is distinct from 'object' or action is null or action not in ('CREATE','PATCH')
    or jsonb_typeof(request->'operationId') is distinct from 'string'
    or request - array['action','operationId','id','expectedVersion','reason','values']<>'{}'::jsonb then
    raise exception 'Invalid account command.' using errcode='22023'; end if;
  response:=private.application_operation_result(request,'ACCOUNT_' || action);
  if response is not null then return response; end if;
  if jsonb_typeof(values_json) is distinct from 'object' or values_json='{}'::jsonb then
    raise exception 'Invalid account values.' using errcode='22023'; end if;
  if action='CREATE' then
    if request ?| array['id','expectedVersion','reason'] or values_json - (fields || array['status'])<>'{}'::jsonb
      or not values_json ?& (fields || array['status']) then raise exception 'Invalid account command.' using errcode='22023'; end if;
    merged:=values_json;
  else
    if jsonb_typeof(request->'id') is distinct from 'string' or jsonb_typeof(request->'expectedVersion') is distinct from 'string'
      or request->>'expectedVersion' !~ '^[1-9][0-9]{0,18}$' or values_json - fields<>'{}'::jsonb then
      raise exception 'Invalid account command.' using errcode='22023'; end if;
    select * into current_account from public.trading_accounts where id=(request->>'id')::uuid
      and user_id=(actor->>'user_id')::uuid for update;
    if not found then raise exception 'Account not found.' using errcode='P0002'; end if;
    if current_account.record_version<>(request->>'expectedVersion')::bigint then raise exception 'Account version conflict.' using errcode='40001'; end if;
    before_row:=private.application_account_record_wire(current_account);
    merged:=before_row||values_json;
  end if;
  if jsonb_typeof(merged->'name') is distinct from 'string' or length(btrim(merged->>'name')) not between 2 and 80
    or jsonb_typeof(merged->'account_type') is distinct from 'string' or merged->>'account_type' not in ('DEMO','PROP_CHALLENGE','FUNDED','PERSONAL_LIVE')
    or jsonb_typeof(merged->'platform') is distinct from 'string' or merged->>'platform' not in ('MT4','MT5','TRADINGVIEW','WEB','OTHER')
    or jsonb_typeof(merged->'currency_code') is distinct from 'string' or merged->>'currency_code' !~ '^[A-Z]{3}$'
    or jsonb_typeof(merged->'currency_precision') is distinct from 'number' or merged->>'currency_precision' !~ '^(0|[1-9]|1[0-9]|20)$'
    or jsonb_typeof(merged->'starting_balance') is distinct from 'string' or jsonb_typeof(merged->'started_at') is distinct from 'string'
    or merged->>'started_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid account values.' using errcode='22023'; end if;
  foreach field in array array['broker_name','notes'] loop
    if merged->field<>'null'::jsonb and (jsonb_typeof(merged->field)<>'string' or length(merged->>field)>4000) then
      raise exception 'Invalid account values.' using errcode='22023'; end if;
  end loop;
  if merged->'leverage'<>'null'::jsonb and (jsonb_typeof(merged->'leverage')<>'string'
    or merged->>'leverage' !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,20})?$' or (merged->>'leverage')::numeric<=0) then
    raise exception 'Invalid leverage.' using errcode='22023'; end if;
  if merged->'leverage'<>'null'::jsonb and (merged->>'leverage')::numeric<>(merged->>'leverage')::numeric(12,4) then
    raise exception 'Unsupported leverage precision.' using errcode='22003'; end if;
  normalized:=private.application_normalized_money(merged->>'starting_balance',(merged->>'currency_precision')::integer);
  if normalized<=0 then raise exception 'Positive normalized baseline required.' using errcode='23514'; end if;
  merged:=merged||jsonb_build_object('name',btrim(merged->>'name'),'starting_balance',normalized::text,'user_id',actor->>'user_id');
  if action='CREATE' then
    if not exists(select 1 from private.account_currency_codes where code=merged->>'currency_code') then
      raise exception 'Registered account currency required.' using errcode='23514'; end if;
    if jsonb_typeof(merged->'status') is distinct from 'string' or merged->>'status' not in ('ACTIVE','PAUSED','PASSED','CLOSED')
      or (merged->>'status'='PASSED' and merged->>'account_type'<>'PROP_CHALLENGE') then
      raise exception 'Invalid initial account status.' using errcode='23514'; end if;
    insert into public.trading_accounts(user_id,name,account_type,broker_name,platform,currency_code,currency_precision,starting_balance,leverage,started_at,status,notes)
      select user_id,name,account_type,broker_name,platform,currency_code,currency_precision,starting_balance,leverage,started_at,status,notes
      from jsonb_populate_record(null::public.trading_accounts,merged) returning * into saved;
  else
    currency_changed:=merged->>'currency_code'<>current_account.currency_code or (merged->>'currency_precision')::integer<>current_account.currency_precision;
    if currency_changed and not exists(select 1 from private.account_currency_codes where code=merged->>'currency_code') then
      raise exception 'Registered account currency required.' using errcode='23514'; end if;
    baseline_changed:=normalized<>current_account.starting_balance or (merged->>'started_at')::date<>current_account.started_at;
    if baseline_changed and (jsonb_typeof(request->'reason') is distinct from 'string' or length(btrim(request->>'reason')) not between 5 and 1000) then
      raise exception 'Baseline/date correction requires a reason.' using errcode='23514'; end if;
    if (currency_changed or baseline_changed or merged->>'account_type'<>current_account.account_type::text) and exists(
      select 1 from private.mt5_connections where account_id=current_account.id) then
      raise exception 'Mapped account requires integration reconciliation.' using errcode='23514'; end if;
    if currency_changed and (exists(select 1 from public.trades where account_id=current_account.id)
      or exists(select 1 from public.account_adjustments where account_id=current_account.id)
      or exists(select 1 from public.account_snapshots where account_id=current_account.id)
      or exists(select 1 from public.account_goals where account_id=current_account.id)
      or exists(select 1 from public.prop_firm_configs where account_id=current_account.id)) then
      raise exception 'Currency history cannot be reinterpreted.' using errcode='23514'; end if;
    if merged->>'account_type'<>current_account.account_type::text and ((current_account.status='PASSED' and merged->>'account_type'<>'PROP_CHALLENGE')
      or exists(select 1 from public.trading_accounts where previous_account_id=current_account.id)) then
      raise exception 'Historical account lifecycle type must be preserved.' using errcode='23514'; end if;
    if merged->>'account_type' not in ('PROP_CHALLENGE','FUNDED') and exists(select 1 from public.prop_firm_configs where account_id=current_account.id) then
      raise exception 'Prop configuration account type must be preserved.' using errcode='23514'; end if;
    update public.trading_accounts t set (name,account_type,broker_name,platform,currency_code,currency_precision,starting_balance,leverage,started_at,notes)=
      (select name,account_type,broker_name,platform,currency_code,currency_precision,starting_balance,leverage,started_at,notes
       from jsonb_populate_record(null::public.trading_accounts,merged)) where t.id=current_account.id returning t.* into saved;
  end if;
  response:=jsonb_build_object('action',action,'record',private.application_account_wire(saved));
  perform private.application_record_operation(request,'ACCOUNT_' || action,response,jsonb_build_object('accountId',saved.id),
    jsonb_build_object('before',before_row,'after',private.application_account_record_wire(saved),'reason',request->>'reason'));
  return response;
end;
$$;
revoke all on function private.account_record_version(),private.application_operation_result(jsonb,text),
  private.application_record_operation(jsonb,text,jsonb,jsonb,jsonb),private.application_normalized_money(text,integer),
  private.application_account_record_wire(public.trading_accounts),private.application_account_wire(public.trading_accounts),private.application_account_read(jsonb),private.application_account_write(jsonb)
  from public,anon,authenticated,service_role;
