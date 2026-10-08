-- Complete owner-scoped repeatable-read reporting data. No new table grants,
-- direct OAuth access, mutations, SQL input or source-specific trade model.
create function private.application_reporting_data(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); selected uuid:=(request->>'accountId')::uuid;
  result jsonb; parts jsonb; table_name text; key_name text;
begin
  if request is null or jsonb_typeof(request)<>'object' or request-array['accountId']<>'{}'::jsonb
    or request ? 'accountId' and (jsonb_typeof(request->'accountId')<>'string' or selected is null)
    then raise exception 'Invalid reporting scope.' using errcode='22023';end if;
  if selected is not null and not exists(select 1 from public.trading_accounts where id=selected and user_id=auth.uid())
    then raise exception 'Account not found.' using errcode='P0002';end if;
  result:=jsonb_build_object('timezone',coalesce((select timezone from public.profiles where id=auth.uid()),'Africa/Kampala'),
    -- Keep all owned account choices available to browser filter controls.
    -- Financial facts below still use the explicitly verified selected scope.
    'accounts',(select coalesce(jsonb_agg(private.application_wire_record('public.trading_accounts',to_jsonb(a)) order by name,id),'[]'::jsonb) from public.trading_accounts a where a.user_id=auth.uid()),
    'instruments',(select coalesce(jsonb_agg(private.application_wire_record('public.instruments',to_jsonb(i)) order by symbol,id),'[]'::jsonb) from public.instruments i where i.user_id is null or i.user_id=auth.uid()),
    'strategies',(select coalesce(jsonb_agg(private.application_wire_record('public.strategies',to_jsonb(s)) order by name,id),'[]'::jsonb) from public.strategies s where s.user_id=auth.uid()),
    'setups',(select coalesce(jsonb_agg(private.application_wire_record('public.setups',to_jsonb(s)) order by name,id),'[]'::jsonb) from public.setups s where s.user_id=auth.uid()),
    'tags',(select coalesce(jsonb_agg(private.application_wire_record('public.tags',to_jsonb(t)) order by name,id),'[]'::jsonb) from public.tags t where t.user_id=auth.uid()),
    'trades',(select coalesce(jsonb_agg(private.application_trade_wire(t) order by t.created_at,t.id),'[]'::jsonb) from public.trades t join public.trading_accounts a on a.id=t.account_id where t.user_id=auth.uid() and a.user_id=auth.uid() and (selected is null or a.id=selected)),
    'adjustments',(select coalesce(jsonb_agg(private.application_wire_record('public.account_adjustments',to_jsonb(e)) order by e.occurred_at,e.id),'[]'::jsonb) from public.account_adjustments e join public.trading_accounts a on a.id=e.account_id where e.user_id=auth.uid() and a.user_id=auth.uid() and (selected is null or a.id=selected)),
    'tradeTags',(select coalesce(jsonb_agg(to_jsonb(l) order by l.trade_id,l.tag_id),'[]'::jsonb) from public.trade_tags l join public.tags g on g.id=l.tag_id join public.trades t on t.id=l.trade_id join public.trading_accounts a on a.id=t.account_id where g.user_id=auth.uid() and t.user_id=auth.uid() and a.user_id=auth.uid() and (selected is null or a.id=selected)),
    'ruleItems',(select coalesce(jsonb_agg(private.application_wire_record('public.trade_rule_review_items',to_jsonb(i)) order by i.review_id,i.display_order,i.id),'[]'::jsonb) from public.trade_rule_review_items i join public.trade_rule_reviews r on r.id=i.review_id join public.trades t on t.id=r.trade_id join public.trading_accounts a on a.id=t.account_id where i.user_id=auth.uid() and r.user_id=auth.uid() and t.user_id=auth.uid() and a.user_id=auth.uid() and (selected is null or a.id=selected)));
  for table_name,key_name in select * from (values('trade_reviews','reviews'),('trade_execution_reviews','execution'),('trade_psychology','psychology'),('trade_rule_reviews','ruleReviews')) x loop
    execute format('select coalesce(jsonb_agg(private.application_wire_record($1,to_jsonb(r)) order by r.trade_id,r.id),''[]''::jsonb) from public.%I r join public.trades t on t.id=r.trade_id join public.trading_accounts a on a.id=t.account_id where r.user_id=$2 and t.user_id=$2 and a.user_id=$2 and ($3 is null or a.id=$3)',table_name)
      into parts using ('public.'||table_name)::regclass,auth.uid(),selected;
    result:=result||jsonb_build_object(key_name,parts);
  end loop;
  return result;
end;$$;
revoke all on function private.application_reporting_data(jsonb) from public,anon,authenticated,service_role;
