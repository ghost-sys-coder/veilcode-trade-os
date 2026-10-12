begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','report-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','report-other@example.test','fixture-only','{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now(),now());
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','session_id','22222222-2222-4222-8222-222222222222','exp',extract(epoch from clock_timestamp())+3600)::text,true);
insert into public.trading_accounts(id,user_id,name,account_type,currency_code,currency_precision,starting_balance,started_at)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Report fixture','DEMO','USD',2,1000,'2026-10-01'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Other account','DEMO','JPY',0,1000,'2026-10-01');
insert into public.instruments(id,user_id,symbol,display_name,asset_class,price_precision)
values('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','PRIVATE','Other instrument','FOREX',5);
insert into public.tags(user_id,name) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Historical tag'),('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Other secret tag');
insert into public.trades(id,user_id,account_id,instrument_id,status,direction,planned_risk_amount)
select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  (select id from public.instruments where user_id is null order by id limit 1),'DRAFT','BUY',0.01 from generate_series(1,1001) n;
insert into public.trades(id,user_id,account_id,instrument_id,status,direction)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999','DRAFT','BUY');
select set_config('report.rows',private.application_reporting_data('{}')::text,true);
select is(jsonb_array_length(current_setting('report.rows')::jsonb->'accounts'),(select count(*)::integer from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'accounts owner isolated including signup-created baseline');
select is(jsonb_array_length(current_setting('report.rows')::jsonb->'trades'),1001,'all history loaded beyond Data API limit');
select is(jsonb_array_length(current_setting('report.rows')::jsonb->'tags'),1,'tags owner isolated');
select ok(not exists(select 1 from jsonb_array_elements(current_setting('report.rows')::jsonb->'instruments') r where r->>'id'='99999999-9999-4999-8999-999999999999'),'other owner instruments excluded');
select is(jsonb_typeof(current_setting('report.rows')::jsonb->'accounts'->0->'starting_balance'),'string','account numeric never JSON float');
select is(jsonb_typeof(current_setting('report.rows')::jsonb->'trades'->0->'planned_risk_amount'),'string','trade money never JSON float');
select is(jsonb_typeof(current_setting('report.rows')::jsonb->'trades'->0->'record_version'),'string','optimistic versions remain strings');
select is(current_setting('report.rows')::jsonb->'trades'->0->>'planned_risk_amount','0.01000000','tiny money preserved');
select is(jsonb_array_length(private.application_reporting_data('{"accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')->'trades'),1001,'explicit owned account retains full history');
select is(jsonb_array_length(private.application_reporting_data('{"accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')->'accounts'),(select count(*)::integer from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),'selected account retains every owned filter option without another owners account');
select throws_ok($$select private.application_reporting_data('{"accountId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}')$$,'P0002','Account not found.','cross-owner account denied');
select throws_ok($$select private.application_reporting_data('{"user_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'22023','Invalid reporting scope.','owner injection denied');
select throws_ok($$select private.application_reporting_data('{"table":"auth.users"}')$$,'22023','Invalid reporting scope.','arbitrary table input denied');
select throws_ok($$select private.application_reporting_data('{"accountId":null}')$$,'22023','Invalid reporting scope.','null account is not implicit all-accounts permission');
select ok(not has_function_privilege('anon','private.application_reporting_data(jsonb)','EXECUTE'),'anonymous private function denied');
select ok(not has_function_privilege('authenticated','private.application_reporting_data(jsonb)','EXECUTE'),'direct browser/OAuth RPC denied');
select ok(not has_function_privilege('service_role','private.application_reporting_data(jsonb)','EXECUTE'),'API service key has no reporting RPC access');
select is((select prosecdef from pg_proc where oid='private.application_reporting_data(jsonb)'::regprocedure),false,'reporting uses invoker, not definer');
select is((select count(*)::integer from private.application_operations),0,'reads do not create operation receipts');
select is((select count(*)::integer from private.application_mutation_audits),0,'reads do not create mutation evidence');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select private.application_reporting_data('{}')$$,'42501',null,'missing browser session rejected');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','session_id','22222222-2222-4222-8222-222222222222','exp',0)::text,true);
select throws_ok($$select private.application_reporting_data('{}')$$,'42501',null,'expired browser session rejected');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true) on conflict(purpose) do update set resource=excluded.resource,enabled=excluded.enabled;
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP',null,'https://trade.example/mcp','reporting-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
 'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.trades),0,'MCP cannot read tables directly');
reset role;
select is(jsonb_array_length(private.application_reporting_data('{}')->'trades'),1001,'verified MCP uses same complete owner read');
update private.integration_grants set status='REVOKED' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_reporting_data('{}')$$,'42501',null,'revoked grant immediately rejected');
select * from finish();
rollback;
