alter table public.account_goals add column record_version bigint not null default 1 check(record_version>0),add column archived_at timestamptz;
alter table public.prop_firm_configs add column record_version bigint not null default 1 check(record_version>0);
create trigger goal_record_version before insert or update on public.account_goals for each row execute function private.account_record_version();
create trigger prop_record_version before insert or update on public.prop_firm_configs for each row execute function private.account_record_version();
create index account_goals_owner_cursor on public.account_goals(user_id,account_id,id);
create index account_goal_progress_owner_cursor on public.account_goal_progress_events(user_id,goal_id,id);

create function private.application_goal_protect() returns trigger language plpgsql set search_path='' as $$
begin
  if old.archived_at is not null and (new.archived_at is distinct from old.archived_at or new.active) then raise exception 'Archived goals cannot be reactivated.' using errcode='23514';end if;
  if new.account_id is distinct from old.account_id or new.user_id is distinct from old.user_id then raise exception 'Goal ownership and account are immutable.' using errcode='23514';end if;
  if exists(select 1 from public.account_goal_progress_events where goal_id=old.id)
    and (new.goal_type is distinct from old.goal_type or new.custom_unit is distinct from old.custom_unit) then raise exception 'Goal progress units and type must be preserved.' using errcode='23514';end if;
  if new.archived_at is not null then new.active:=false;end if;return new;
end;$$;
create trigger goal_protect_history before update on public.account_goals for each row execute function private.application_goal_protect();
create function private.application_goal_event_version() returns trigger language plpgsql set search_path='' as $$
begin
  update public.account_goals set record_version=record_version+1 where id=new.goal_id and user_id=new.user_id;
  return new;
end;$$;
create trigger goal_event_version after insert on public.account_goal_progress_events for each row execute function private.application_goal_event_version();
create or replace function private.validate_goal_progress_event() returns trigger language plpgsql set search_path='' as $$
declare goal public.account_goals;
begin
  select * into goal from public.account_goals where id=new.goal_id and user_id=new.user_id for update;
  if not found then raise exception 'Goal not found.' using errcode='23503';end if;
  if goal.goal_type<>'CUSTOM' then raise exception 'Manual progress events are only valid for custom goals.' using errcode='23514';end if;
  if not goal.active or goal.archived_at is not null then raise exception 'Goal is inactive or archived.' using errcode='23514';end if;
  return new;
end;$$;
create function private.application_progress_currency_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.account_type not in ('PROP_CHALLENGE','FUNDED') and exists(select 1 from public.prop_firm_configs where account_id=old.id) then
    raise exception 'Account type must preserve prop configuration.' using errcode='23514';end if;
  if (new.currency_code is distinct from old.currency_code or new.currency_precision is distinct from old.currency_precision)
    and (exists(select 1 from public.account_goals where account_id=old.id and goal_type in ('ACCOUNT_BALANCE','MAX_DRAWDOWN_AMOUNT'))
      or exists(select 1 from public.prop_firm_configs where account_id=old.id)) then
    raise exception 'Currency/precision must preserve goal and prop history.' using errcode='23514';end if;
  return new;
end;$$;
create trigger account_progress_currency_history before update on public.trading_accounts for each row execute function private.application_progress_currency_guard();

create function private.application_progress_read(request jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); kind text:=request->>'kind'; target_goal public.account_goals; selected_account_id uuid;
  table_name text; records jsonb; row_value jsonb; page_size integer; next_cursor uuid;
begin
  if jsonb_typeof(request) is distinct from 'object' or kind is null or kind not in ('GOAL','GOALS','EVENTS','PROP')
    or request-array['kind','id','accountId','goalId','limit','afterId','includeArchived']<>'{}'::jsonb then raise exception 'Invalid progress query.' using errcode='22023';end if;
  if kind='GOAL' then
    if request-array['kind','id']<>'{}'::jsonb then raise exception 'Invalid goal query.' using errcode='22023';end if;
    select * into target_goal from public.account_goals where id=(request->>'id')::uuid and user_id=auth.uid();
    if not found then raise exception 'Goal unavailable.' using errcode='P0002';end if;
    return private.application_wire_record('public.account_goals',to_jsonb(target_goal));
  elsif kind='EVENTS' then
    if request-array['kind','goalId','limit','afterId']<>'{}'::jsonb then raise exception 'Invalid event query.' using errcode='22023';end if;
    select * into target_goal from public.account_goals where id=(request->>'goalId')::uuid and user_id=auth.uid();
    if not found then raise exception 'Goal unavailable.' using errcode='P0002';end if;
    table_name:='account_goal_progress_events';selected_account_id:=target_goal.account_id;
  else
    selected_account_id:=(request->>'accountId')::uuid;
    if not exists(select 1 from public.trading_accounts a where a.id=selected_account_id and a.user_id=auth.uid()) then raise exception 'Account unavailable.' using errcode='P0002';end if;
    if kind='PROP' then
      if request-array['kind','accountId']<>'{}'::jsonb then raise exception 'Invalid prop query.' using errcode='22023';end if;
      select private.application_wire_record('public.prop_firm_configs',to_jsonb(c)) into row_value from public.prop_firm_configs c where c.account_id=selected_account_id and c.user_id=auth.uid();
      return jsonb_build_object('record',row_value);
    end if;
    table_name:='account_goals';
    if request-array['kind','accountId','limit','afterId','includeArchived']<>'{}'::jsonb or jsonb_typeof(request->'includeArchived') is distinct from 'boolean' then raise exception 'Invalid goal page.' using errcode='22023';end if;
  end if;
  if jsonb_typeof(request->'limit') is distinct from 'number' or request->>'limit' !~ '^[0-9]+$' then raise exception 'Invalid page.' using errcode='22023';end if;
  page_size:=(request->>'limit')::integer;if page_size not between 1 and 100 then raise exception 'Invalid page.' using errcode='22023';end if;
  execute format('select coalesce(jsonb_agg(private.application_wire_record($1,to_jsonb(t)) order by id),''[]''::jsonb) from
    (select * from public.%I where user_id=$2 and %s and ($4::uuid is null or id>$4) %s order by id limit $5) t',table_name,
    case when kind='EVENTS' then 'goal_id=$3' else 'account_id=$3' end,
    case when kind='GOALS' and request->'includeArchived'='false'::jsonb then 'and archived_at is null' else '' end)
    into records using ('public.'||table_name)::regclass,auth.uid(),case when kind='EVENTS' then target_goal.id else selected_account_id end,(request->>'afterId')::uuid,page_size+1;
  if jsonb_array_length(records)>page_size then next_cursor:=(records->(page_size-1)->>'id')::uuid;records:=records-page_size;end if;
  return jsonb_build_object('records',records,'nextCursor',next_cursor);
end;$$;

create function private.application_progress_prepare(request jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); receipt jsonb; action text:=request->>'action'; account public.trading_accounts; goal public.account_goals; config public.prop_firm_configs; selected_account_id uuid;
begin
  if action is null or action not in ('GOAL_CREATE','GOAL_PATCH','GOAL_ARCHIVE','GOAL_PROGRESS','PROP_SAVE') then raise exception 'Invalid progress action.' using errcode='22023';end if;
  receipt:=private.application_operation_result(request,action);if receipt is not null then return jsonb_build_object('receipt',receipt);end if;
  if action in ('GOAL_PATCH','GOAL_ARCHIVE','GOAL_PROGRESS') then
    select * into goal from public.account_goals where id=coalesce(request->>'id',request->>'goalId')::uuid and user_id=auth.uid();
    if not found then raise exception 'Goal unavailable.' using errcode='P0002';end if;selected_account_id:=goal.account_id;
  else selected_account_id:=(request->>'accountId')::uuid;end if;
  select * into account from public.trading_accounts a where a.id=selected_account_id and a.user_id=auth.uid() for update;
  if not found then raise exception 'Account unavailable.' using errcode='P0002';end if;
  if goal.id is not null then
    select * into goal from public.account_goals where id=goal.id and user_id=auth.uid() for update;
    if jsonb_typeof(request->'expectedVersion') is distinct from 'string' or goal.record_version::text is distinct from request->>'expectedVersion' then raise exception 'Goal version conflict.' using errcode='40001';end if;
    if goal.archived_at is not null then raise exception 'Goal is archived.' using errcode='23514';end if;
  end if;
  select * into config from public.prop_firm_configs c where c.account_id=account.id and c.user_id=auth.uid() for update;
  if action='PROP_SAVE' then
    if account.account_type not in ('PROP_CHALLENGE','FUNDED') then raise exception 'Prop configuration requires a prop account.' using errcode='23514';end if;
    if jsonb_typeof(request->'expectedVersion') is distinct from 'string' or coalesce(config.record_version::text,'0') is distinct from request->>'expectedVersion' then raise exception 'Prop version conflict.' using errcode='40001';end if;
  end if;
  return jsonb_build_object('account',private.application_account_record_wire(account),'goal',private.application_wire_record('public.account_goals',case when goal.id is null then null else to_jsonb(goal) end),
    'config',private.application_wire_record('public.prop_firm_configs',case when config.id is null then null else to_jsonb(config) end));
end;$$;

create function private.application_progress_numeric_check(p_table regclass,p_values jsonb) returns void language plpgsql set search_path='' as $$
declare key text; row_json jsonb;
begin
  perform private.application_actor();
  if p_table not in ('public.account_goals'::regclass,'public.prop_firm_configs'::regclass) then raise exception 'Invalid progress numeric domain.' using errcode='22023';end if;
  execute format('select to_jsonb(jsonb_populate_record(null::%s,$1))',p_table) into row_json using p_values;
  for key in select attname from pg_catalog.pg_attribute where attrelid=p_table and atttypid='numeric'::regtype and attnum>0 and not attisdropped loop
    if p_values->>key is not null and (jsonb_typeof(p_values->key)<>'string' or (p_values->>key)::numeric<>(row_json->>key)::numeric) then raise exception 'Numeric storage precision conflict.' using errcode='22003';end if;
  end loop;
end;$$;

create function private.application_progress_write(request jsonb,proposal jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); source jsonb:=private.application_progress_prepare(request); action text:=request->>'action';
  fields text[]; field text; merged jsonb; before_row jsonb; after_row jsonb; result jsonb; target_id uuid; table_name text;
  account public.trading_accounts; goal public.account_goals; target numeric; stem text; group_fields text[]; present integer;
begin
  if source ? 'receipt' then return source->'receipt';end if;
  select * into account from public.trading_accounts where id=(source->'account'->>'id')::uuid;
  if jsonb_typeof(request) is distinct from 'object' or request-array['action','operationId','accountId','id','goalId','expectedVersion','values','reason','progressValue','recordedAt','notes']<>'{}'::jsonb then raise exception 'Invalid progress command.' using errcode='22023';end if;
  if action='GOAL_PROGRESS' then
    if request-array['action','operationId','goalId','expectedVersion','progressValue','recordedAt','notes']<>'{}'::jsonb then raise exception 'Invalid progress event.' using errcode='22023';end if;
    select * into goal from public.account_goals where id=(source->'goal'->>'id')::uuid;
    if jsonb_typeof(request->'progressValue') is distinct from 'string' or request->>'progressValue' !~ '^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,20})?$'
      or jsonb_typeof(request->'recordedAt') is distinct from 'string' or request->>'recordedAt' !~ '(Z|\+00:00)$'
      or proposal->>'progressValue' is distinct from request->>'progressValue' then raise exception 'Invalid progress evidence.' using errcode='22023';end if;
    if (request->>'progressValue')::numeric<>(request->>'progressValue')::numeric(24,8) then raise exception 'Unsupported progress precision.' using errcode='22003';end if;
    if request->>'notes' is not null and (jsonb_typeof(request->'notes')<>'string' or length(request->>'notes')>4000) then raise exception 'Invalid notes.' using errcode='22023';end if;
    insert into public.account_goal_progress_events(user_id,goal_id,progress_value,recorded_at,notes) values(auth.uid(),goal.id,(request->>'progressValue')::numeric,(request->>'recordedAt')::timestamptz,request->>'notes')
      returning private.application_wire_record('public.account_goal_progress_events',to_jsonb(account_goal_progress_events)) into after_row;
    select * into goal from public.account_goals where id=goal.id;
    result:=jsonb_build_object('action',action,'record',after_row,'goalVersion',goal.record_version::text);before_row:=source->'goal';
  elsif action='GOAL_ARCHIVE' then
    if request-array['action','operationId','id','expectedVersion','reason']<>'{}'::jsonb or jsonb_typeof(request->'reason') is distinct from 'string' or length(btrim(request->>'reason')) not between 5 and 1000 then raise exception 'Meaningful archive reason required.' using errcode='22023';end if;
    before_row:=source->'goal';update public.account_goals set active=false,archived_at=clock_timestamp() where id=(before_row->>'id')::uuid
      returning private.application_wire_record('public.account_goals',to_jsonb(account_goals)) into after_row;
    result:=jsonb_build_object('action',action,'record',after_row);
  else
    if action='GOAL_CREATE' and request-array['action','operationId','accountId','values']<>'{}'::jsonb or action='GOAL_PATCH' and request-array['action','operationId','id','expectedVersion','values']<>'{}'::jsonb
      or action='PROP_SAVE' and request-array['action','operationId','accountId','expectedVersion','values']<>'{}'::jsonb
      or jsonb_typeof(request->'values') is distinct from 'object' or request->'values'='{}'::jsonb or jsonb_typeof(proposal->'values') is distinct from 'object' then raise exception 'Invalid progress values.' using errcode='22023';end if;
    if action='PROP_SAVE' then
      table_name:='prop_firm_configs';before_row:=source->'config';
      fields:=array['firm_name','model_name','phase_name','profit_target_mode','profit_target_value','daily_loss_mode','daily_loss_value','daily_loss_baseline','daily_loss_measure','total_loss_mode','total_loss_value','total_loss_baseline','total_loss_measure','drawdown_type','consistency_formula','consistency_limit_percent','minimum_trading_days','maximum_trading_days','trading_day_timezone','profitable_day_min_pnl','notes'];
    else table_name:='account_goals';before_row:=source->'goal';fields:=array['title','goal_type','target_value','target_date','custom_unit','notes','active'];end if;
    if (request->'values')-fields<>'{}'::jsonb or (proposal->'values')-fields<>'{}'::jsonb or not (proposal->'values') ?& fields then raise exception 'Protected progress field.' using errcode='22023';end if;
    merged:=coalesce(case when before_row='null'::jsonb then null else before_row end,'{}'::jsonb)||(request->'values');
    if action='PROP_SAVE' then
      foreach stem in array array['profit_target','daily_loss','total_loss'] loop
        if (proposal->'values'->>(stem||'_mode')) is null then group_fields:=case when stem='profit_target' then array[stem||'_mode',stem||'_value'] else array[stem||'_mode',stem||'_value',stem||'_baseline',stem||'_measure'] end;
          select count(*) into present from unnest(group_fields) f where proposal->'values'->>f is not null;
          if present<>0 then raise exception 'Incomplete prop rule.' using errcode='23514';end if;
        else
          group_fields:=case when stem='profit_target' then array[stem||'_mode',stem||'_value'] else array[stem||'_mode',stem||'_value',stem||'_baseline',stem||'_measure'] end;
          select count(*) into present from unnest(group_fields) f where proposal->'values'->>f is not null;
          if present<>array_length(group_fields,1) then raise exception 'Incomplete prop rule.' using errcode='23514';end if;
        end if;
      end loop;
      if (proposal->'values'->>'consistency_formula' is null)<>(proposal->'values'->>'consistency_limit_percent' is null) then raise exception 'Incomplete consistency rule.' using errcode='23514';end if;
    end if;
    foreach field in array fields loop
      if action='PROP_SAVE' and field in ('profit_target_value','daily_loss_value','total_loss_value') and proposal->'values'->>(replace(field,'_value','_mode'))='AMOUNT'
        or action='PROP_SAVE' and field='profitable_day_min_pnl'
        or action<>'PROP_SAVE' and field='target_value' and proposal->'values'->>'goal_type' in ('ACCOUNT_BALANCE','MAX_DRAWDOWN_AMOUNT') then
        if (proposal->'values'->>field)::numeric is distinct from private.application_signed_money(merged->>field,account.currency_precision) then raise exception 'Monetary proposal conflict.' using errcode='23514';end if;
      else
        -- On creation nullable optional config fields default to null, not an invented rule.
        if (proposal->'values'->field) is distinct from coalesce(merged->field,'null'::jsonb) then raise exception 'Progress proposal conflict.' using errcode='23514';end if;
      end if;
      if proposal->'values'->field='null'::jsonb then continue;end if;
      if field='active' then if jsonb_typeof(proposal->'values'->field)<>'boolean' then raise exception 'Invalid active flag.' using errcode='22023';end if;
      elsif field in ('minimum_trading_days','maximum_trading_days') then if jsonb_typeof(proposal->'values'->field)<>'number' then raise exception 'Invalid days.' using errcode='22023';end if;
      elsif jsonb_typeof(proposal->'values'->field)<>'string' or (length(proposal->'values'->>field)>4000 and proposal->'values'->field is distinct from before_row->field) then raise exception 'Invalid progress value.' using errcode='22023';end if;
    end loop;
    if action<>'PROP_SAVE' then
      if length(btrim(proposal->'values'->>'title')) not between 2 and 120 or (proposal->'values'->>'target_value')::numeric<=0
        or proposal->'values'->>'goal_type' in ('TOTAL_TRADES','PROFITABLE_DAYS') and (proposal->'values'->>'target_value')::numeric<>trunc((proposal->'values'->>'target_value')::numeric)
        or proposal->'values'->>'goal_type' in ('RULE_COMPLIANCE_PERCENT','MAX_DRAWDOWN_PERCENT') and (proposal->'values'->>'target_value')::numeric>100 then raise exception 'Invalid goal definition.' using errcode='23514';end if;
    elsif length(btrim(proposal->'values'->>'firm_name')) not between 2 and 120 then raise exception 'Invalid firm name.' using errcode='23514';end if;
    perform private.application_progress_numeric_check(('public.'||table_name)::regclass,proposal->'values');
    target_id:=coalesce((before_row->>'id')::uuid,gen_random_uuid());merged:=(proposal->'values')||jsonb_build_object('id',target_id,'user_id',auth.uid(),'account_id',account.id);
    if before_row is null or before_row='null'::jsonb then
      fields:=array['id','user_id','account_id']||fields;
      execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1) returning private.application_wire_record($2,to_jsonb(%I))',table_name,
        (select string_agg(format('%I',f),',') from unnest(fields) f),(select string_agg(format('%I',f),',') from unnest(fields) f),table_name,table_name) into after_row using merged,('public.'||table_name)::regclass;
    else
      execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1)) where id=$2 returning private.application_wire_record($3,to_jsonb(%I))',table_name,
        (select string_agg(format('%I',f),',') from unnest(fields) f),(select string_agg(format('%I',f),',') from unnest(fields) f),table_name,table_name) into after_row using merged,target_id,('public.'||table_name)::regclass;
    end if;
    result:=jsonb_build_object('action',action,'record',after_row);
  end if;
  perform private.application_record_operation(request,action,result,jsonb_build_object('accountId',account.id,'recordId',after_row->>'id'),jsonb_build_object('before',before_row,'after',after_row,'reason',request->>'reason','goalVersion',result->'goalVersion'));
  return result;
end;$$;

create function private.application_progress_data(request jsonb) returns jsonb language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); selected_account_id uuid:=(request->>'accountId')::uuid; result jsonb;
begin
  if request-array['accountId']<>'{}'::jsonb then raise exception 'Invalid progress scope.' using errcode='22023';end if;
  result:=private.application_account_ledger(jsonb_build_object('id',selected_account_id));
  return result||jsonb_build_object('timezone',coalesce((select timezone from public.profiles where id=auth.uid()),'UTC'),
    'config',(select private.application_wire_record('public.prop_firm_configs',to_jsonb(c)) from public.prop_firm_configs c where c.account_id=selected_account_id and c.user_id=auth.uid()),
    'goals',(select coalesce(jsonb_agg(private.application_wire_record('public.account_goals',to_jsonb(g)) order by created_at desc,id),'[]'::jsonb) from public.account_goals g where g.account_id=selected_account_id and g.user_id=auth.uid()),
    'trades',(select coalesce(jsonb_agg(private.application_trade_wire(t) order by created_at,id),'[]'::jsonb) from public.trades t where t.account_id=selected_account_id and t.user_id=auth.uid()),
    'goalEvents',(select coalesce(jsonb_agg(private.application_wire_record('public.account_goal_progress_events',to_jsonb(e)) order by recorded_at desc,created_at desc,id desc),'[]'::jsonb) from public.account_goal_progress_events e where e.user_id=auth.uid() and e.goal_id in(select id from public.account_goals where account_id=selected_account_id and user_id=auth.uid())),
    'statusEvents',(select coalesce(jsonb_agg(to_jsonb(e) order by effective_at desc,id),'[]'::jsonb) from public.account_status_events e where e.account_id=selected_account_id and e.user_id=auth.uid()),
    'reviews',(select coalesce(jsonb_agg(jsonb_build_object('trade_id',r.trade_id,'reviewed_at',r.reviewed_at)),'[]'::jsonb) from public.trade_reviews r join public.trades t on t.id=r.trade_id where t.account_id=selected_account_id and t.user_id=auth.uid() and r.user_id=auth.uid() and r.reviewed_at is not null),
    'ruleReviews',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from public.trade_rule_reviews r join public.trades t on t.id=r.trade_id where t.account_id=selected_account_id and t.user_id=auth.uid() and r.user_id=auth.uid()),
    'ruleItems',(select coalesce(jsonb_agg(private.application_wire_record('public.trade_rule_review_items',to_jsonb(i))),'[]'::jsonb) from public.trade_rule_review_items i join public.trade_rule_reviews r on r.id=i.review_id join public.trades t on t.id=r.trade_id where t.account_id=selected_account_id and t.user_id=auth.uid() and i.user_id=auth.uid() and r.user_id=auth.uid()),
    'setups',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)),'[]'::jsonb) from public.setups s where s.user_id=auth.uid()));
end;$$;
revoke all on function private.application_goal_protect(),private.application_goal_event_version(),private.application_progress_currency_guard(),
  private.application_progress_read(jsonb),private.application_progress_prepare(jsonb),private.application_progress_numeric_check(regclass,jsonb),private.application_progress_write(jsonb,jsonb),private.application_progress_data(jsonb) from public,anon,authenticated,service_role;
