begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'finance-fixture@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://trade.example/api/integrations/v1',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',
  'MT5',id,'https://trade.example/api/integrations/v1','finance-fixture','ACTIVE'
from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into private.mt5_connections(id,owner_id,account_id,grant_id,identity)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',owner_id,account_id,id,
  '{"server":"Broker-Demo","login":"12345","terminalInstallationId":"22222222-2222-4222-8222-222222222222","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"NETTING"}'
from private.integration_grants;
insert into public.import_batches(id,user_id,account_id,source_type,status)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',owner_id,account_id,'MT5','PROCESSING' from private.mt5_connections;

-- Only fixture-owned postgres code sets this marker. The real publication RPC
-- will be private/server-only, validate ownership/source versions and set it.
create function pg_temp.episode(ticket text, direction public.trade_direction, final_net numeric default null,
  final_outcome public.trade_outcome default null, partial boolean default false, gross numeric default 0,
  commission numeric default 0, credit numeric default 0) returns uuid language plpgsql as $$
declare tid uuid := gen_random_uuid();
begin
  perform set_config('trade_os.mt5_publication_trade',tid::text,true);
  insert into public.trades(id,user_id,account_id,instrument_id,status,outcome,source_type,direction,
    import_batch_id,external_trade_id,external_position_id,external_order_id,mt5_connection_id,
    mt5_opening_deal_ticket,mt5_execution_version,mt5_used_partial_exits,opened_at,closed_at,
    actual_entry,actual_lot_size,gross_pnl,commission,trading_credits,net_pnl)
  select tid,c.owner_id,c.account_id,i.id,case when final_net is null then 'OPEN'::public.trade_status else 'CLOSED'::public.trade_status end,
    final_outcome,'MT5',direction,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',c.id::text||':100:'||ticket||':'||direction::text,
    '100','900',c.id,ticket,1,partial,'2026-01-01T00:00:00Z',case when final_net is not null then '2026-01-02T00:00:00Z'::timestamptz end,
    1.1,1,gross,commission,credit,final_net
  from private.mt5_connections c cross join public.instruments i where i.symbol='EURUSD' and i.user_id is null;
  perform set_config('trade_os.mt5_publication_trade','',true);
  return tid;
end;
$$;
select lives_ok($$select pg_temp.episode('10','BUY',98,'WIN',false,100,3,1)$$,'gross 100 minus cost 3 plus credit 1 equals net 98');
select lives_ok($$select pg_temp.episode('11','SELL')$$,'same broker position and order can start another directional episode');
select is((select count(*)::integer from public.trades),2,'reversal episodes remain distinct canonical trades');
select throws_ok($$select pg_temp.episode('11','SELL')$$,'23505',null,'replaying a canonical identity cannot duplicate a trade');
select lives_ok($$select pg_temp.episode('12','BUY',10,'PARTIAL_WIN',true,10)$$,'complete positive trade with partial exits is PARTIAL_WIN');
select lives_ok($$select pg_temp.episode('13','SELL',-10,'PARTIAL_LOSS',true,-10)$$,'complete negative trade with partial exits is PARTIAL_LOSS');
select lives_ok($$select pg_temp.episode('14','BUY',0,'BREAK_EVEN',true,1,2,1)$$,'partially managed complete zero net is BREAK_EVEN');
select throws_ok($$select pg_temp.episode('15','BUY',10,'WIN',false,11)$$,'23514','Final broker PnL contradicts financial components.','contradictory broker net rejected');
select throws_ok($$select pg_temp.episode('15','BUY',10,'WIN',true,10)$$,'23514',
  'Outcome conflicts with normalized net PnL or partial-exit history. Expected PARTIAL_WIN.','partial trade cannot claim ordinary win');
select lives_ok($$select pg_temp.episode('16','BUY',-.01,'LOSS',false,0,.01)$$,'small currency-normalized negative result stays a loss');
select lives_ok($$select pg_temp.episode('17','BUY',.01,'WIN',false,0,0,.01)$$,'small currency-normalized credit stays a win');
select lives_ok($$select pg_temp.episode('18','BUY',-.01,'LOSS',false,0,.005+.005)$$,'allocation components are summed before final money rounding');
select lives_ok($$select pg_temp.episode('19','BUY',null,null,true,20,2)$$,'open partial cash exists without finalized net PnL');
select is((select net_pnl from public.trades where mt5_opening_deal_ticket='19'),null::numeric,'open partial cash cannot contribute realized PnL');
select is((select trading_credits from public.trades where mt5_opening_deal_ticket='10'),1::numeric,'explicit trading credit is persisted');
select ok((select bool_and(planned_entry is null and planned_risk_amount is null and planned_stop_loss is null and actual_r is null)
  from public.trades),'broker data does not fabricate historical plans or missing R');
select throws_ok($$select pg_temp.episode('20','BUY',0,'BREAK_EVEN',false,0,0,-1)$$,'23514',null,'negative trading credit rejected');
select throws_ok($$select pg_temp.episode('20','BUY',0,'BREAK_EVEN',false,0,0,'NaN')$$,'23514',null,'nonfinite monetary value rejected');
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.trades set net_pnl=97 where mt5_opening_deal_ticket='10'$$,
  '42501','Synchronized execution facts require approved publication.','normal owner cannot overwrite synchronized final PnL');
select lives_ok($$insert into public.trade_management_events(user_id,trade_id,event_type,occurred_at,notes)
  select user_id,id,'NOTE',clock_timestamp(),'User supplied post-trade journal note'
  from public.trades where mt5_opening_deal_ticket='10'$$,'explicit post-trade journal notes remain available');
select throws_ok($$update public.trades set confirmation_notes='Rewritten original rationale' where mt5_opening_deal_ticket='10'$$,
  '42501','Protected planned values require the correction workflow.','original decision evidence remains protected');
select throws_ok($$delete from public.trades where mt5_opening_deal_ticket='10'$$,
  '42501','Synchronized execution evidence cannot be deleted.','broker financial evidence cannot be deleted');
select set_config('trade_os.mt5_publication_trade',(select id::text from public.trades where mt5_opening_deal_ticket='10'),true);
select throws_ok($$update public.trades set commission=4 where mt5_opening_deal_ticket='10'$$,
  '42501','Synchronized execution facts require approved publication.','spoofing the marker does not confer trusted server role');
reset role;
select set_config('trade_os.mt5_publication_trade','',true);
select throws_ok($$update public.trades set trading_credits=2 where mt5_opening_deal_ticket='10'$$,
  '42501','Synchronized execution facts require approved publication.','even privileged unapproved updates are rejected');
select ok((select indpred is not null from pg_index where indexrelid='public.trades_source_external_position_unique'::regclass),
  'legacy import position uniqueness remains a partial index');
select ok((select count(*)=0 from public.trade_plan_corrections),'broker exits do not become plan corrections');
select is((select count(*)::integer from public.trades where status='CLOSED'),7,'rejected inserts leave no partial trade writes');
select * from finish();
rollback;
