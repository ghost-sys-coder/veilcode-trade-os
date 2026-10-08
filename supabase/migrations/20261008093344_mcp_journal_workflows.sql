-- Shared reflection storage only. No reconstructed balances or analytics writes.
alter table public.daily_logs add column record_version bigint not null default 1 check(record_version>0);
alter table public.weekly_reviews add column record_version bigint not null default 1 check(record_version>0);
alter table public.monthly_reviews add column record_version bigint not null default 1 check(record_version>0);
create trigger journal_record_version before insert or update on public.daily_logs for each row execute function private.account_record_version();
create trigger journal_record_version before insert or update on public.weekly_reviews for each row execute function private.account_record_version();
create trigger journal_record_version before insert or update on public.monthly_reviews for each row execute function private.account_record_version();
create index daily_logs_owner_cursor on public.daily_logs(user_id,account_id,id);
create index weekly_reviews_owner_cursor on public.weekly_reviews(user_id,account_id,id);
create index monthly_reviews_owner_cursor on public.monthly_reviews(user_id,account_id,id);

create function private.application_journal_kind(kind text) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
  case kind
    when 'DAILY' then return '{"table":"daily_logs","date":"trading_date","fields":["market_conditions","mental_state","followed_daily_plan","hit_daily_loss_threshold","stopped_when_required","daily_rating","lessons","notes"]}'::jsonb;
    when 'WEEKLY' then return '{"table":"weekly_reviews","date":"week_start","fields":["what_worked","what_did_not","change_next_week","behavior_to_stop","behavior_to_continue","notes"]}'::jsonb;
    when 'MONTHLY' then return '{"table":"monthly_reviews","date":"month","fields":["what_worked","what_did_not","lessons","focus_next_month","notes"]}'::jsonb;
    else raise exception 'Invalid journal kind.' using errcode='22023';
  end case;
end;$$;
create function private.application_journal_read(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); spec jsonb:=private.application_journal_kind(request->>'kind');
  account_id uuid:=(request->>'accountId')::uuid; records jsonb; row_value jsonb; page_size integer; next_cursor uuid;
begin
  if jsonb_typeof(request) is distinct from 'object' or request-array['kind','accountId','period','limit','afterId']<>'{}'::jsonb then
    raise exception 'Invalid journal query.' using errcode='22023'; end if;
  if not exists(select 1 from public.trading_accounts a where a.id=account_id and a.user_id=auth.uid()) then
    raise exception 'Account unavailable.' using errcode='P0002'; end if;
  if request ? 'period' then
    if request ?| array['limit','afterId'] or request->>'period' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid period.' using errcode='22023'; end if;
    if request->>'kind'='WEEKLY' and extract(isodow from (request->>'period')::date)<>1
      or request->>'kind'='MONTHLY' and extract(day from (request->>'period')::date)<>1 then raise exception 'Invalid period.' using errcode='22023'; end if;
    execute format('select private.application_wire_record($1,to_jsonb(t)) from public.%I t where t.user_id=$2 and t.account_id=$3 and t.%I=$4',spec->>'table',spec->>'date')
      into row_value using ('public.'||(spec->>'table'))::regclass,auth.uid(),account_id,(request->>'period')::date;
    return jsonb_build_object('kind',request->>'kind','record',row_value);
  end if;
  if jsonb_typeof(request->'limit') is distinct from 'number' or request->>'limit' !~ '^[0-9]+$' then raise exception 'Invalid page.' using errcode='22023'; end if;
  page_size:=(request->>'limit')::integer;
  if page_size not between 1 and 100 then raise exception 'Invalid page.' using errcode='22023'; end if;
  execute format('select coalesce(jsonb_agg(private.application_wire_record($1,to_jsonb(t)) order by id),''[]''::jsonb)
    from (select * from public.%I where user_id=$2 and account_id=$3 and ($4::uuid is null or id>$4) order by id limit $5) t',spec->>'table')
    into records using ('public.'||(spec->>'table'))::regclass,auth.uid(),account_id,(request->>'afterId')::uuid,page_size+1;
  if jsonb_array_length(records)>page_size then next_cursor:=(records->(page_size-1)->>'id')::uuid;records:=records-page_size;end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;$$;
create function private.application_journal_write(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); spec jsonb:=private.application_journal_kind(request->>'kind');
  account_id uuid:=(request->>'accountId')::uuid; receipt jsonb; before_row jsonb; after_row jsonb; merged jsonb;
  fields text[]; field text; period date; record_id uuid; result jsonb; values_json jsonb:=request->'values';
begin
  receipt:=private.application_operation_result(request,'JOURNAL_'||(request->>'kind'));if receipt is not null then return receipt;end if;
  if jsonb_typeof(request) is distinct from 'object' or request-array['kind','accountId','period','operationId','expectedVersion','values']<>'{}'::jsonb
    or not request ?& array['kind','accountId','period','operationId','expectedVersion','values']
    or jsonb_typeof(request->'expectedVersion') is distinct from 'string' or request->>'expectedVersion' !~ '^(0|[1-9][0-9]{0,18})$'
    or request->>'period' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(values_json) is distinct from 'object' or values_json='{}'::jsonb then raise exception 'Invalid journal command.' using errcode='22023';end if;
  -- Lock owned parent to serialize absent-record creation and avoid lost upserts.
  perform 1 from public.trading_accounts a where a.id=account_id and a.user_id=auth.uid() for update;
  if not found then raise exception 'Account unavailable.' using errcode='P0002';end if;
  period:=(request->>'period')::date;
  if request->>'kind'='WEEKLY' and extract(isodow from period)<>1 or request->>'kind'='MONTHLY' and extract(day from period)<>1 then raise exception 'Invalid period.' using errcode='22023';end if;
  select array_agg(value) into fields from jsonb_array_elements_text(spec->'fields');
  if values_json-fields<>'{}'::jsonb then raise exception 'Protected journal field.' using errcode='22023';end if;
  foreach field in array fields loop
    if not values_json ? field or values_json->field='null'::jsonb then continue;end if;
    if field in ('followed_daily_plan','hit_daily_loss_threshold','stopped_when_required') then
      if jsonb_typeof(values_json->field)<>'boolean' then raise exception 'Explicit answer required.' using errcode='22023';end if;
    elsif field='daily_rating' then
      if jsonb_typeof(values_json->field)<>'number' or values_json->>field !~ '^[1-5]$' then raise exception 'Invalid rating.' using errcode='22023';end if;
    elsif jsonb_typeof(values_json->field)<>'string' or length(values_json->>field)>4000 then raise exception 'Invalid reflection text.' using errcode='22023';end if;
  end loop;
  execute format('select to_jsonb(t) from public.%I t where user_id=$1 and account_id=$2 and %I=$3 for update',spec->>'table',spec->>'date')
    into before_row using auth.uid(),account_id,period;
  if coalesce(before_row->>'record_version','0') is distinct from request->>'expectedVersion' then raise exception 'Journal version conflict.' using errcode='40001';end if;
  record_id:=coalesce((before_row->>'id')::uuid,gen_random_uuid());
  merged:=coalesce(before_row,'{}'::jsonb)||values_json||jsonb_build_object('id',record_id,'user_id',auth.uid(),'account_id',account_id,spec->>'date',period);
  if before_row is null then
    fields:=array['id','user_id','account_id',spec->>'date']||fields;
    execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning to_jsonb(%I)',spec->>'table',
      (select string_agg(format('%I',f),',') from unnest(fields) f),(select string_agg(format('%I',f),',') from unnest(fields) f),spec->>'table',spec->>'table') into after_row using merged;
  else
    execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1)) where id=$2 returning to_jsonb(%I)',spec->>'table',
      (select string_agg(format('%I',f),',') from unnest(fields) f),(select string_agg(format('%I',f),',') from unnest(fields) f),spec->>'table',spec->>'table') into after_row using merged,record_id;
  end if;
  result:=jsonb_build_object('kind',request->>'kind','record',private.application_wire_record(('public.'||(spec->>'table'))::regclass,after_row));
  perform private.application_record_operation(request,'JOURNAL_'||(request->>'kind'),result,jsonb_build_object('accountId',account_id,'journalId',record_id),
    jsonb_build_object('before',before_row,'after',after_row));return result;
end;$$;
revoke all on function private.application_journal_kind(text),private.application_journal_read(jsonb),private.application_journal_write(jsonb) from public,anon,authenticated,service_role;
