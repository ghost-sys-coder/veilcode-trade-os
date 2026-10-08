-- Shared, verified browser/MCP workflows. No exposed RPC or OAuth table access.
alter table public.tags add column record_version bigint not null default 1 check(record_version>0),add column archived_at timestamptz;
alter table public.instruments add column record_version bigint not null default 1 check(record_version>0),add column archived_at timestamptz;
create index tags_owner_page_idx on public.tags(user_id,id);
create index instruments_owner_page_idx on public.instruments(user_id,id);
create trigger reference_version before insert or update on public.tags for each row execute function private.account_record_version();
create trigger reference_version before insert or update on public.instruments for each row execute function private.account_record_version();
create trigger application_trade_version after insert or update or delete on public.trade_tags
  for each row execute function private.application_bump_trade_version();

create function private.application_instrument_referenced(target uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.trades where instrument_id=target)
    or exists(select 1 from private.mt5_symbol_mappings where instrument_id=target)
    or exists(select 1 from private.mt5_symbol_mapping_events where previous_instrument_id=target or new_instrument_id=target);
$$;
-- Enforce historical specification protection even for direct browser updates.
create function private.application_reference_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.user_id is distinct from old.user_id then raise exception 'Reference ownership is immutable.' using errcode='42501';end if;
    if old.archived_at is not null and new is distinct from old then raise exception 'Reference is archived.' using errcode='23514';end if;
    if tg_table_name='instruments' then
      if (new.symbol,new.asset_class,new.base_currency,new.quote_currency,new.pip_size,new.price_precision)
        is distinct from (old.symbol,old.asset_class,old.base_currency,old.quote_currency,old.pip_size,old.price_precision)
        and private.application_instrument_referenced(old.id) then
        raise exception 'Referenced instrument specifications are immutable.' using errcode='23514';
      end if;
    end if;
  end if;
  if tg_table_name='instruments' and new.archived_at is not null then new.active:=false;end if;
  return new;
end;
$$;
create trigger reference_guard before insert or update on public.tags for each row execute function private.application_reference_guard();
create trigger reference_guard before insert or update on public.instruments for each row execute function private.application_reference_guard();
create function private.application_trade_tag_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Locks serialize assignment with concurrent archival, including direct writes.
  perform 1 from public.tags where id=new.tag_id and user_id=new.user_id and archived_at is null for share;
  if not found then raise exception 'Tag is unavailable for assignment.' using errcode='23514';end if;
  return new;
end;
$$;
create trigger trade_tag_guard before insert or update on public.trade_tags for each row execute function private.application_trade_tag_guard();

create function private.application_reference_table(entity text) returns text
language plpgsql immutable set search_path='' as $$
begin
  case entity when 'TAG' then return 'tags';when 'INSTRUMENT' then return 'instruments';
    else raise exception 'Invalid reference entity.' using errcode='22023';end case;
end;
$$;
create function private.application_reference_read(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); entity text:=request->>'entity'; table_name text:=private.application_reference_table(entity);
  row_value jsonb; records jsonb; page_size integer; cursor_id uuid; next_cursor uuid; include_archived boolean; trade_id uuid;
begin
  if jsonb_typeof(request) is distinct from 'object' or request-array['entity','id','afterId','limit','includeArchived','tradeId']<>'{}'::jsonb then
    raise exception 'Invalid reference query.' using errcode='22023';end if;
  if request ? 'id' then
    if request-array['entity','id']<>'{}'::jsonb or jsonb_typeof(request->'id') is distinct from 'string' then
      raise exception 'Invalid reference query.' using errcode='22023';end if;
    execute format('select private.application_wire_record($1,to_jsonb(t)) from public.%I t where id=$2 and (user_id=$3 or ($4 and user_id is null))',table_name)
      into row_value using ('public.'||table_name)::regclass,(request->>'id')::uuid,auth.uid(),entity='INSTRUMENT';
    if row_value is null then raise exception 'Reference not found.' using errcode='P0002';end if;
    return row_value;
  end if;
  if jsonb_typeof(request->'limit') is distinct from 'number' or request->>'limit' !~ '^[0-9]+$'
    or jsonb_typeof(request->'includeArchived') is distinct from 'boolean'
    or (request ? 'afterId' and jsonb_typeof(request->'afterId') is distinct from 'string') then
    raise exception 'Invalid reference query.' using errcode='22023';end if;
  page_size:=(request->>'limit')::integer;cursor_id:=(request->>'afterId')::uuid;include_archived:=(request->>'includeArchived')::boolean;
  if page_size not between 1 and 100 then raise exception 'Invalid reference query.' using errcode='22023';end if;
  if request ? 'tradeId' then
    if entity<>'TAG' or jsonb_typeof(request->'tradeId') is distinct from 'string' then raise exception 'Invalid reference query.' using errcode='22023';end if;
    trade_id:=(request->>'tradeId')::uuid;
    if not exists(select 1 from public.trades where id=trade_id and user_id=auth.uid()) then raise exception 'Trade not found.' using errcode='P0002';end if;
  end if;
  execute format('select coalesce(jsonb_agg(private.application_wire_record($1,to_jsonb(t)) order by id),''[]''::jsonb)
    from (select * from public.%I r where (user_id=$2 or ($3 and user_id is null)) and ($4::uuid is null or id>$4)
      and ($5 or archived_at is null) and ($6::uuid is null or exists(select 1 from public.trade_tags tt where tt.trade_id=$6 and tt.tag_id=r.id and tt.user_id=$2))
      order by id limit $7) t',table_name)
    into records using ('public.'||table_name)::regclass,auth.uid(),entity='INSTRUMENT',cursor_id,include_archived,trade_id,page_size+1;
  if jsonb_array_length(records)>page_size then next_cursor:=(records->(page_size-1)->>'id')::uuid;records:=records-page_size;end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;
$$;

create function private.application_reference_write(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); entity text:=request->>'entity'; table_name text:=private.application_reference_table(entity);
  action text:=request->>'action'; kind text; receipt jsonb; target_id uuid; before_row jsonb; after_row jsonb; values_json jsonb:=request->'values';
  merged jsonb; fields text[]; response jsonb; pip text;
begin
  if jsonb_typeof(request) is distinct from 'object' or action is null or action not in ('CREATE','PATCH','ARCHIVE')
    or jsonb_typeof(request->'operationId') is distinct from 'string'
    or request-array['entity','action','operationId','id','expectedVersion','values','reason']<>'{}'::jsonb then
    raise exception 'Invalid reference command.' using errcode='22023';end if;
  kind:='REFERENCE_'||entity||'_'||action;receipt:=private.application_operation_result(request,kind);
  if receipt is not null then return receipt;end if;
  if action='CREATE' then
    if request ?| array['id','expectedVersion','reason'] then raise exception 'Invalid reference command.' using errcode='22023';end if;
    target_id:=gen_random_uuid();
  else
    if jsonb_typeof(request->'id') is distinct from 'string' or jsonb_typeof(request->'expectedVersion') is distinct from 'string'
      or request->>'expectedVersion' !~ '^[1-9][0-9]{0,18}$' then raise exception 'Invalid reference command.' using errcode='22023';end if;
    target_id:=(request->>'id')::uuid;
    execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2 for update',table_name) into before_row using target_id,auth.uid();
    if before_row is null then raise exception 'Reference not found.' using errcode='P0002';end if;
    if before_row->>'record_version' is distinct from request->>'expectedVersion' then raise exception 'Reference version conflict.' using errcode='40001';end if;
    if before_row->>'archived_at' is not null then raise exception 'Reference is archived.' using errcode='23514';end if;
  end if;
  if action='ARCHIVE' then
    if request ? 'values' or jsonb_typeof(request->'reason') is distinct from 'string' or length(btrim(request->>'reason')) not between 5 and 1000 then
      raise exception 'Meaningful archive reason required.' using errcode='22023';end if;
    execute format('update public.%I set archived_at=clock_timestamp() where id=$1 returning to_jsonb(%I)',table_name,table_name) into after_row using target_id;
  else
    fields:=case entity when 'TAG' then array['name','color'] else array['symbol','display_name','asset_class','base_currency','quote_currency','pip_size','price_precision','active'] end;
    if request ? 'reason' or jsonb_typeof(values_json) is distinct from 'object' or values_json='{}'::jsonb
      or values_json-fields<>'{}'::jsonb or (action='CREATE' and not values_json ?& fields) then raise exception 'Invalid reference values.' using errcode='22023';end if;
    merged:=coalesce(private.application_wire_record(('public.'||table_name)::regclass,before_row),'{}'::jsonb)||values_json;
    if entity='TAG' then
      if jsonb_typeof(merged->'name') is distinct from 'string' or length(btrim(merged->>'name')) not between 1 and 40
        or (merged->'color'<>'null'::jsonb and (jsonb_typeof(merged->'color')<>'string' or merged->>'color' !~ '^#[0-9a-fA-F]{6}$')) then
        raise exception 'Invalid reference values.' using errcode='22023';end if;
      merged:=merged||jsonb_build_object('name',btrim(merged->>'name'));
    else
      pip:=merged->>'pip_size';
      if jsonb_typeof(merged->'symbol') is distinct from 'string' or btrim(merged->>'symbol') !~ '^[A-Za-z0-9][A-Za-z0-9._/#-]{0,39}$'
        or jsonb_typeof(merged->'display_name') is distinct from 'string' or length(btrim(merged->>'display_name')) not between 1 and 120
        or jsonb_typeof(merged->'asset_class') is distinct from 'string' or merged->>'asset_class' not in ('FOREX','METAL','INDEX','CRYPTO','COMMODITY','EQUITY','OTHER')
        or jsonb_typeof(merged->'active') is distinct from 'boolean'
        or jsonb_typeof(merged->'price_precision') is distinct from 'number' or merged->>'price_precision' !~ '^[0-9]+$'
        or (merged->>'price_precision')::integer not between 0 and 20
        or (merged->'base_currency'<>'null'::jsonb and (jsonb_typeof(merged->'base_currency')<>'string' or merged->>'base_currency' !~ '^[A-Z]{3}$'))
        or (merged->'quote_currency'<>'null'::jsonb and (jsonb_typeof(merged->'quote_currency')<>'string' or merged->>'quote_currency' !~ '^[A-Z]{3}$'))
        or (merged->'pip_size'<>'null'::jsonb and (jsonb_typeof(merged->'pip_size')<>'string' or pip !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,10})?$' or pip::numeric<=0)) then
        raise exception 'Invalid reference values.' using errcode='22023';end if;
      merged:=merged||jsonb_build_object('symbol',btrim(merged->>'symbol'),'display_name',btrim(merged->>'display_name'));
    end if;
    merged:=merged||jsonb_build_object('id',target_id,'user_id',auth.uid());
    if action='CREATE' then
      fields:=array['id','user_id']||fields;
      execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',table_name,
        (select string_agg(format('%I',f),',') from unnest(fields) f),(select string_agg(format('%I',f),',') from unnest(fields) f),table_name,table_name) into after_row using merged;
    else
      execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1)) where id=$2 returning to_jsonb(%I)',table_name,
        (select string_agg(format('%I',f),',') from unnest(fields) f),(select string_agg(format('%I',f),',') from unnest(fields) f),table_name,table_name) into after_row using merged,target_id;
    end if;
  end if;
  response:=jsonb_build_object('entity',entity,'action',action,'record',private.application_wire_record(('public.'||table_name)::regclass,after_row));
  perform private.application_record_operation(request,kind,response,jsonb_build_object('entity',entity,'id',target_id),
    jsonb_build_object('before',before_row,'after',after_row,'reason',request->>'reason'));
  return response;
end;
$$;

create function private.application_trade_tag_write(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); action text:=request->>'action'; kind text; receipt jsonb; trade public.trades; tag public.tags;
  before_row jsonb; after_row jsonb; response jsonb; version text;
begin
  if jsonb_typeof(request) is distinct from 'object' or action is null or action not in ('ASSIGN','REMOVE')
    or request-array['action','operationId','tradeId','tagId','expectedVersion','expectedTagVersion']<>'{}'::jsonb
    or not request ?& array['action','operationId','tradeId','tagId','expectedVersion','expectedTagVersion']
    or exists(select 1 from jsonb_each(request) where jsonb_typeof(value)<>'string') then raise exception 'Invalid trade tag command.' using errcode='22023';end if;
  kind:='TRADE_TAG_'||action;receipt:=private.application_operation_result(request,kind);if receipt is not null then return receipt;end if;
  select * into trade from public.trades where id=(request->>'tradeId')::uuid and user_id=auth.uid() for update;
  if not found then raise exception 'Trade not found.' using errcode='P0002';end if;
  select * into tag from public.tags where id=(request->>'tagId')::uuid and user_id=auth.uid() for share;
  if not found then raise exception 'Reference not found.' using errcode='P0002';end if;
  select record_version::text into version from private.application_trade_versions where trade_id=trade.id;
  if version is distinct from request->>'expectedVersion' or tag.record_version::text is distinct from request->>'expectedTagVersion' then
    raise exception 'Reference version conflict.' using errcode='40001';end if;
  if action='ASSIGN' and tag.archived_at is not null then raise exception 'Tag is unavailable for assignment.' using errcode='23514';end if;
  select to_jsonb(t) into before_row from public.trade_tags t where trade_id=trade.id and tag_id=tag.id;
  if action='ASSIGN' then
    if before_row is null then insert into public.trade_tags(user_id,trade_id,tag_id) values(auth.uid(),trade.id,tag.id);end if;
    select to_jsonb(t) into after_row from public.trade_tags t where trade_id=trade.id and tag_id=tag.id;
  else delete from public.trade_tags where trade_id=trade.id and tag_id=tag.id and user_id=auth.uid();end if;
  select record_version::text into version from private.application_trade_versions where trade_id=trade.id;
  response:=jsonb_build_object('action',action,'tradeId',trade.id,'tagId',tag.id,'assigned',action='ASSIGN','tradeVersion',version);
  perform private.application_record_operation(request,kind,response,jsonb_build_object('entity','TRADE_TAG','tradeId',trade.id,'tagId',tag.id),
    jsonb_build_object('before',before_row,'after',after_row));
  return response;
end;
$$;
revoke all on function private.application_instrument_referenced(uuid),private.application_reference_guard(),private.application_trade_tag_guard(),
  private.application_reference_table(text),private.application_reference_read(jsonb),private.application_reference_write(jsonb),
  private.application_trade_tag_write(jsonb) from public,anon,authenticated,service_role;
