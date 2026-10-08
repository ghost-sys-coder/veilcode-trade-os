-- Configuration commands use the same private transaction for verified browser
-- and MCP actors. No OAuth table policy or existing public RPC is broadened.
alter table public.strategies add column record_version bigint not null default 1 check(record_version > 0),
  add column archived_at timestamptz;
alter table public.setups add column record_version bigint not null default 1 check(record_version > 0),
  add column archived_at timestamptz;
alter table public.trading_rules add column record_version bigint not null default 1 check(record_version > 0),
  add column archived_at timestamptz;

create function private.configuration_record_version() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.record_version:=1;
  else new.record_version:=old.record_version+1; end if;
  if new.archived_at is not null then new.active:=false; end if;
  return new;
end;
$$;
create trigger configuration_record_version before insert or update on public.strategies
  for each row execute function private.configuration_record_version();
create trigger configuration_record_version before insert or update on public.setups
  for each row execute function private.configuration_record_version();
create trigger configuration_record_version before insert or update on public.trading_rules
  for each row execute function private.configuration_record_version();

create table private.application_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  actor_key text not null,
  operation_id uuid not null,
  grant_id uuid references private.integration_grants(id),
  resource text,
  operation_kind text not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(owner_id,actor_key,operation_id)
);
create table private.application_mutation_audits (
  id uuid primary key default gen_random_uuid(),
  operation_receipt_id uuid not null unique references private.application_operations(id),
  actor_user_id uuid not null references auth.users(id),
  actor_type text not null check(actor_type in ('BROWSER','MCP')),
  client_id uuid references auth.oauth_clients(id),
  affected_records jsonb not null,
  changes jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.application_operations enable row level security;
alter table private.application_mutation_audits enable row level security;
revoke all on private.application_operations,private.application_mutation_audits from public,anon,authenticated,service_role;
create trigger application_operations_immutable before update or delete on private.application_operations
  for each row execute function private.reject_integration_audit_mutation();
create trigger application_mutation_audits_immutable before update or delete on private.application_mutation_audits
  for each row execute function private.reject_integration_audit_mutation();

-- Invoker-only, server DB credentials only. Claims have already been verified
-- cryptographically by the runtime-branded TypeScript context. Recheck live
-- session/grant here, inside the transaction, rather than trusting actor IDs.
create function private.application_actor() returns jsonb
language plpgsql set search_path='' as $$
declare claims jsonb:=auth.jwt(); actor jsonb;
begin
  if current_user not in ('postgres','supabase_admin') or session_user not in ('postgres','supabase_admin') then
    raise exception 'Application access denied.' using errcode='42501'; end if;
  if claims->>'client_id' is not null then
    actor:=private.authorize_integration(claims->>'trade_os_resource','MCP');
    return actor || jsonb_build_object('actorType','MCP','actorKey','MCP:' || (actor->>'client_id'));
  end if;
  if claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'exp')::numeric,0)<=extract(epoch from clock_timestamp())
    or not exists(select 1 from auth.sessions where id::text=claims->>'session_id'
      and user_id=auth.uid() and oauth_client_id is null and (not_after is null or not_after>clock_timestamp())) then
    raise exception 'Application access denied.' using errcode='42501'; end if;
  return jsonb_build_object('user_id',auth.uid(),'actorType','BROWSER','actorKey','BROWSER');
end;
$$;

create function private.configuration_table(entity text) returns text
language plpgsql immutable set search_path='' as $$
begin
  case entity when 'STRATEGY' then return 'strategies'; when 'SETUP' then return 'setups';
    when 'RULE' then return 'trading_rules';
    else raise exception 'Invalid configuration entity.' using errcode='22023'; end case;
end;
$$;
create function private.configuration_wire_record(entity text, row_value jsonb) returns jsonb
language sql immutable set search_path='' as $$
  select row_value || jsonb_build_object('record_version',row_value->>'record_version')
    || case when entity='RULE' then jsonb_build_object('numeric_limit',row_value->>'numeric_limit') else '{}'::jsonb end;
$$;

create function private.configuration_read(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); entity text:=request->>'entity'; table_name text:=private.configuration_table(entity);
  row_value jsonb; records jsonb; page_size integer; cursor_id uuid; next_cursor uuid; include_archived boolean;
begin
  if jsonb_typeof(request)<>'object' or request - array['entity','id','afterId','limit','includeArchived'] <> '{}'::jsonb then
    raise exception 'Invalid configuration query.' using errcode='22023'; end if;
  if request ? 'id' then
    if request - array['entity','id'] <> '{}'::jsonb then raise exception 'Invalid configuration query.' using errcode='22023'; end if;
    execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2',table_name)
      into row_value using (request->>'id')::uuid,(actor->>'user_id')::uuid;
    if row_value is null then raise exception 'Configuration not found.' using errcode='P0002'; end if;
    return private.configuration_wire_record(entity,row_value);
  end if;
  if jsonb_typeof(request->'limit') is distinct from 'number' or request->>'limit' !~ '^[0-9]+$'
    or jsonb_typeof(request->'includeArchived') is distinct from 'boolean' then
    raise exception 'Invalid configuration query.' using errcode='22023'; end if;
  page_size:=(request->>'limit')::integer; cursor_id:=(request->>'afterId')::uuid;
  include_archived:=(request->>'includeArchived')::boolean;
  if page_size not between 1 and 100 then raise exception 'Invalid configuration query.' using errcode='22023'; end if;
  execute format('select coalesce(jsonb_agg(private.configuration_wire_record($1,to_jsonb(t)) order by id),''[]''::jsonb)
    from (select * from public.%I where user_id=$2 and ($3::uuid is null or id>$3)
      and ($4 or archived_at is null) order by id limit $5) t',table_name)
    into records using entity,(actor->>'user_id')::uuid,cursor_id,include_archived,page_size+1;
  if jsonb_array_length(records)>page_size then
    next_cursor:=(records->(page_size-1)->>'id')::uuid; records:=records - page_size;
  end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;
$$;

create function private.configuration_write(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); entity text:=request->>'entity'; table_name text:=private.configuration_table(entity);
  action text:=request->>'action'; operation uuid; receipt private.application_operations; values_json jsonb:=request->'values';
  before_row jsonb; after_row jsonb; merged jsonb; target_id uuid; receipt_id uuid; response jsonb;
  fields text[]; field text; numeric_value text;
begin
  if jsonb_typeof(request) is distinct from 'object' or action not in ('CREATE','PATCH','ARCHIVE')
    or jsonb_typeof(request->'operationId') is distinct from 'string'
    or request - array['entity','action','operationId','id','expectedVersion','values','reason'] <> '{}'::jsonb then
    raise exception 'Invalid configuration command.' using errcode='22023'; end if;
  operation:=(request->>'operationId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(actor->>'user_id' || ':' || (actor->>'actorKey') || ':' || operation::text,0));
  select * into receipt from private.application_operations where owner_id=(actor->>'user_id')::uuid
    and actor_key=actor->>'actorKey' and operation_id=operation;
  if found then
    if receipt.grant_id::text is distinct from actor->>'grant_id' or receipt.resource is distinct from actor->>'resource' then
      raise exception 'Operation scope denied.' using errcode='42501'; end if;
    if receipt.operation_kind <> 'CONFIGURATION_' || action
      or receipt.request_hash <> encode(extensions.digest(request::text,'sha256'),'hex') then
      raise exception 'Operation payload conflict.' using errcode='23505'; end if;
    return receipt.result;
  end if;
  if action='CREATE' then
    if request ?| array['id','expectedVersion','reason'] then raise exception 'Invalid configuration command.' using errcode='22023'; end if;
    target_id:=gen_random_uuid();
  else
    if jsonb_typeof(request->'id') is distinct from 'string' or jsonb_typeof(request->'expectedVersion') is distinct from 'string'
      or request->>'expectedVersion' !~ '^[1-9][0-9]{0,18}$' then
      raise exception 'Invalid configuration command.' using errcode='22023'; end if;
    target_id:=(request->>'id')::uuid;
    execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2 for update',table_name)
      into before_row using target_id,(actor->>'user_id')::uuid;
    if before_row is null then raise exception 'Configuration not found.' using errcode='P0002'; end if;
    if (before_row->>'record_version')::bigint<>(request->>'expectedVersion')::bigint then
      raise exception 'Configuration version conflict.' using errcode='40001'; end if;
    if before_row->>'archived_at' is not null then raise exception 'Configuration is archived.' using errcode='23514'; end if;
  end if;
  if action='ARCHIVE' then
    if request ? 'values' or jsonb_typeof(request->'reason') is distinct from 'string'
      or length(btrim(request->>'reason')) not between 5 and 1000 then
      raise exception 'Meaningful archive reason required.' using errcode='22023'; end if;
    execute format('update public.%I set active=false,archived_at=clock_timestamp() where id=$1 returning to_jsonb(%I)',table_name,table_name)
      into after_row using target_id;
  else
    if request ? 'reason' or jsonb_typeof(values_json) is distinct from 'object' or values_json='{}'::jsonb then
      raise exception 'Invalid configuration values.' using errcode='22023'; end if;
    fields:=case entity when 'STRATEGY' then array['name','description','active']
      when 'SETUP' then array['name','description','active','strategy_id']
      else array['name','description','active','account_id','rule_type','numeric_limit'] end;
    if values_json - fields <> '{}'::jsonb or (action='CREATE' and not values_json ?& fields) then
      raise exception 'Invalid configuration values.' using errcode='22023'; end if;
    merged:=coalesce(private.configuration_wire_record(entity,before_row),'{}'::jsonb) || values_json;
    if jsonb_typeof(merged->'name') is distinct from 'string' or length(btrim(merged->>'name')) not between 2 and (case when entity='RULE' then 120 else 100 end)
      or jsonb_typeof(merged->'active') is distinct from 'boolean'
      or (merged->'description'<>'null'::jsonb and (jsonb_typeof(merged->'description')<>'string' or length(merged->>'description')>4000)) then
      raise exception 'Invalid configuration values.' using errcode='22023'; end if;
    merged:=merged || jsonb_build_object('name',btrim(merged->>'name'));
    if entity='SETUP' then
      if jsonb_typeof(merged->'strategy_id') is distinct from 'string' or not exists(select 1 from public.strategies
        where id=(merged->>'strategy_id')::uuid and user_id=(actor->>'user_id')::uuid and archived_at is null) then
        raise exception 'Invalid parent strategy.' using errcode='23514'; end if;
    elsif entity='RULE' then
      numeric_value:=merged->>'numeric_limit';
      if jsonb_typeof(merged->'description') is distinct from 'string' or length(btrim(merged->>'description')) not between 5 and 1000
        or merged->>'rule_type' not in ('DESCRIPTIVE','MAX_RISK_PERCENT','MIN_RR','MAX_TRADES_PER_DAY','BEHAVIOR')
        or jsonb_typeof(merged->'rule_type') is distinct from 'string'
        or (merged->'numeric_limit'<>'null'::jsonb and (jsonb_typeof(merged->'numeric_limit')<>'string'
          or numeric_value !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,8})?$'))
        or (merged->'account_id'<>'null'::jsonb and (jsonb_typeof(merged->'account_id')<>'string' or not exists(select 1 from public.trading_accounts
          where id=(merged->>'account_id')::uuid and user_id=(actor->>'user_id')::uuid))) then
        raise exception 'Invalid configuration values.' using errcode='23514'; end if;
    end if;
    -- Identifiers come ONLY from the fixed entity map and validated field list.
    -- jsonb_populate_record supplies table types without accepting extra fields.
    merged:=merged || jsonb_build_object('id',target_id,'user_id',actor->>'user_id');
    if entity in ('STRATEGY','RULE') then
      fields:=fields || array['is_example']; merged:=merged || jsonb_build_object('is_example',false);
    end if;
    if action='CREATE' then
      fields:=array['id','user_id'] || fields;
      execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',
        table_name,(select string_agg(format('%I',f),',') from unnest(fields) f),
        (select string_agg(format('%I',f),',') from unnest(fields) f),table_name,table_name) into after_row using merged;
    else
      execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1)) where id=$2 returning to_jsonb(%I)',
        table_name,(select string_agg(format('%I',f),',') from unnest(fields) f),
        (select string_agg(format('%I',f),',') from unnest(fields) f),table_name,table_name) into after_row using merged,target_id;
    end if;
  end if;
  response:=jsonb_build_object('entity',entity,'action',action,'record',private.configuration_wire_record(entity,after_row));
  insert into private.application_operations(owner_id,actor_key,operation_id,grant_id,resource,operation_kind,request_hash,result)
    values((actor->>'user_id')::uuid,actor->>'actorKey',operation,(actor->>'grant_id')::uuid,actor->>'resource','CONFIGURATION_' || action,
      encode(extensions.digest(request::text,'sha256'),'hex'),response) returning id into receipt_id;
  insert into private.application_mutation_audits(operation_receipt_id,actor_user_id,actor_type,client_id,affected_records,changes)
    values(receipt_id,(actor->>'user_id')::uuid,actor->>'actorType',(actor->>'client_id')::uuid,
      jsonb_build_object('entity',entity,'id',target_id),jsonb_build_object('before',before_row,'after',after_row,'reason',request->>'reason'));
  return response;
end;
$$;

-- No public wrappers: only fixed, verified application services may invoke these.
revoke all on function private.application_actor(),private.configuration_table(text),
  private.configuration_wire_record(text,jsonb),private.configuration_read(jsonb),private.configuration_write(jsonb),
  private.configuration_record_version() from public,anon,authenticated,service_role;

-- MCP operation lookup includes shared application receipts without weakening
-- the existing MT5 grant/account binding or exposing browser receipts.
create or replace function private.get_integration_operation(p_resource text,p_purpose text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor jsonb; receipt private.integration_operations; application_receipt private.application_operations;
begin
  actor:=private.authorize_integration(p_resource,p_purpose);
  if p_operation_id is null then raise exception 'Operation ID required.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor->>'user_id' || ':' || (actor->>'client_id') || ':' || p_operation_id::text,0));
  select * into receipt from private.integration_operations where owner_id=(actor->>'user_id')::uuid
    and client_id=(actor->>'client_id')::uuid and operation_id=p_operation_id;
  if found then
    if receipt.grant_id::text is distinct from actor->>'grant_id' or receipt.account_id::text is distinct from actor->>'account_id'
      or receipt.purpose is distinct from actor->>'purpose' or receipt.resource is distinct from actor->>'resource' then
      raise exception 'Operation scope denied.' using errcode='42501'; end if;
    return jsonb_build_object('operationId',p_operation_id,'status','COMMITTED','kind',receipt.operation_kind,'result',receipt.result,'createdAt',receipt.created_at);
  end if;
  if p_purpose='MCP' then
    select * into application_receipt from private.application_operations where owner_id=(actor->>'user_id')::uuid
      and actor_key='MCP:' || (actor->>'client_id') and operation_id=p_operation_id;
    if found then
      if application_receipt.grant_id::text is distinct from actor->>'grant_id' or application_receipt.resource is distinct from actor->>'resource' then
        raise exception 'Operation scope denied.' using errcode='42501'; end if;
      return jsonb_build_object('operationId',p_operation_id,'status','COMMITTED','kind',application_receipt.operation_kind,
        'result',application_receipt.result,'createdAt',application_receipt.created_at);
    end if;
  end if;
  return jsonb_build_object('operationId',p_operation_id,'status','UNKNOWN');
end;
$$;
