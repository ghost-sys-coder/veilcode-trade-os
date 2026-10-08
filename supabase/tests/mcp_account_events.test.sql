begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','events-mcp@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://trade.example/mcp','event-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
 'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
insert into public.trading_accounts(id,user_id,name,account_type,platform,currency_code,currency_precision,starting_balance,started_at)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',auth.uid(),'Events challenge','PROP_CHALLENGE','OTHER','USD',2,1000,'2026-09-01');
create function pg_temp.event_request(action text,values_json jsonb) returns jsonb language sql as $$
 select jsonb_build_object('action',action,'operationId',gen_random_uuid(),'accountId','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')||values_json;
$$;
select ok(not has_function_privilege('authenticated','private.application_account_event_write(jsonb,jsonb)','EXECUTE'),'OAuth cannot call the private event writer directly');
select set_config('events.request',pg_temp.event_request('ADJUSTMENT','{"type":"WITHDRAWAL","amount":"10.005","occurredAt":"2026-10-08T00:00:00Z"}')::text,true);
select set_config('events.result',private.application_account_event_write(current_setting('events.request')::jsonb,'{"amount":"-10.01"}')::text,true);
select is(current_setting('events.result')::jsonb->'record'->>'amount','-10.01','withdrawal is signed and normalized');
select is(jsonb_typeof(current_setting('events.result')::jsonb->'record'->'amount'),'string','money never crosses as a JSON number');
select is(private.application_account_event_write(current_setting('events.request')::jsonb,'{}'),current_setting('events.result')::jsonb,'lost acknowledgement retry returns the same receipt');
select is((select count(*)::integer from public.account_adjustments),1,'retry has one durable cash effect');
select throws_ok($$select private.application_account_event_write(jsonb_set(current_setting('events.request')::jsonb,'{amount}','"20"'),'{}')$$,'23505','Operation payload conflict.','changed retry payload is rejected');
select throws_ok($$select private.application_account_event_write(pg_temp.event_request('ADJUSTMENT','{"type":"DEPOSIT","amount":"10","occurredAt":"2026-10-08T00:00:00Z","isPerformanceNeutral":false}'),'{"amount":"10.00"}')$$,'23514','Fixed adjustments must be neutral.','fixed types cannot be misclassified');
select throws_ok($$select private.application_account_event_write(pg_temp.event_request('ADJUSTMENT','{"type":"OTHER","amount":"1","occurredAt":"2026-10-08T00:00:00Z"}'),'{"amount":"1.00"}')$$,'23514',null,'new OTHER must be classified');
select set_config('events.other',private.application_account_event_write(pg_temp.event_request('ADJUSTMENT','{"type":"OTHER","amount":"5","occurredAt":"2026-10-08T00:00:00Z","isPerformanceNeutral":true,"classificationReason":"Cash-only credit"}'),'{"amount":"5.00"}')->'record'->>'id',true);
select is(private.application_account_event_write(pg_temp.event_request('CLASSIFY',jsonb_build_object('id',current_setting('events.other'),'expectedVersion','1','isPerformanceNeutral',false,'reason','Correct economic classification')),'{}')->'record'->>'record_version','2','classification increments optimistic version');
select is((select count(*)::integer from public.account_adjustment_classifications where adjustment_id=current_setting('events.other')::uuid),1,'classification change is appended; initial interpretation remains in creation audit');
select is((select amount from public.account_adjustments where id=current_setting('events.other')::uuid),5::numeric,'classification never changes cash');
select throws_ok($$select private.application_account_event_write(pg_temp.event_request('CLASSIFY',jsonb_build_object('id',current_setting('events.other'),'expectedVersion','1','isPerformanceNeutral',true,'reason','Stale correction attempt')),'{}')$$,'40001','Adjustment version conflict.','stale classification rejected');
select is(private.application_account_event_write(pg_temp.event_request('SNAPSHOT','{"balance":"1000","unrealizedPnl":"0.2","capturedAt":"2026-10-08T00:00:00Z"}'),'{"balance":"1000.00","equity":"1000.20","unrealizedPnl":"0.20"}')->'record'->>'equity','1000.20000000','snapshot equation uses exact decimal values');
select throws_ok($$select private.application_account_event_write(pg_temp.event_request('SNAPSHOT','{"balance":"1000","equity":"1001","unrealizedPnl":"5","capturedAt":"2026-10-08T00:00:00Z"}'),'{"balance":"1000.00","equity":"1001.00","unrealizedPnl":"1.00"}')$$,'23514','Snapshot contradicts submitted evidence.','contradictory snapshots are flagged');
select is(private.application_account_read('{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')->>'account_adjustments_total','-5.01','equity observations never enter account balance');
select is(private.application_account_event_write(pg_temp.event_request('TRANSITION','{"expectedVersion":"1","status":"PASSED","effectiveAt":"2026-10-08T00:00:00Z","reason":"Challenge completed"}'),'{}')->'record'->>'status','PASSED','lifecycle transition updates the account');
select is((select count(*)::integer from public.account_status_events where account_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),2,'initial and transition history retained');
select is(private.application_account_event_write(pg_temp.event_request('LINK_FUNDED','{"expectedVersion":"2","name":"Separate funded","startingBalance":"10000","platform":"OTHER","startedAt":"2026-10-08"}'),'{"startingBalance":"10000.00"}')->'record'->>'previous_account_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','funded account links without moving challenge history');
select is(jsonb_array_length(private.application_account_event_read('{"accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","kind":"ADJUSTMENTS","limit":1}')->'records'),1,'event lists are bounded');
select ok(private.application_account_event_read('{"accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","kind":"ADJUSTMENTS","limit":1}')->>'nextCursor' is not null,'event list exposes continuation');
select throws_ok($$select private.application_account_event_prepare(pg_temp.event_request('SNAPSHOT','{"accountId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}'))$$,'P0002','Account not found.','unowned or unknown accounts are not accessible');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_account_event_write(current_setting('events.request')::jsonb,'{}')$$,'42501','Integration access denied.','revoked grants cannot replay old event receipts');
select * from finish();
rollback;
