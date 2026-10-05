begin;
create extension if not exists pgtap with schema extensions;
select plan(36);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'capture-fixture@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://trade.example/api/integrations/v1',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',
  'MT5',id,'https://trade.example/api/integrations/v1','capture-fixture','ACTIVE' from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('mt5.fixture_identity','{"server":"Broker-Demo","login":"12345","terminalInstallationId":"22222222-2222-4222-8222-222222222222","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"NETTING"}',true);
select set_config('mt5.fixture_event','[{"kind":"DEAL","sourceId":"10","observedAt":"2026-01-01T00:00:01.000Z","payload":{"ticket":"10","orderId":"10","positionId":"100","symbol":"EURUSD","occurredAt":"2026-01-01T00:00:00.000Z","type":"BUY","entry":"IN","volume":"1","price":"1.1","profit":"0","commission":"-2","swap":"0","fee":"0"}}]',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
select lives_ok($$select public.mt5_register_connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001',current_setting('mt5.fixture_identity')::jsonb)$$,'browser explicitly maps its demo account');
select lives_ok($$select public.mt5_register_connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001',current_setting('mt5.fixture_identity')::jsonb)$$,'registration retry returns the durable result');
select throws_ok($$select public.mt5_register_connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001',jsonb_set(current_setting('mt5.fixture_identity')::jsonb,'{login}','"99999"'))$$,
  '23505','Operation payload conflict.','changed retry payload is rejected');
select throws_ok($$select public.mt5_register_connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000002',jsonb_set(current_setting('mt5.fixture_identity')::jsonb,'{accountKind}','"LIVE"'))$$,
  '22023','Valid demo identity required.','live account onboarding is rejected');
select throws_ok($$select public.mt5_register_connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000002',jsonb_set(current_setting('mt5.fixture_identity')::jsonb,'{currencyCode}','"GBP"'))$$,
  '22023','Account currency mismatch.','mapping cannot contradict the configured account currency');
reset role;
select set_config('mt5.fixture_connection',(select id::text from private.mt5_connections),true);
select is((select count(*)::integer from private.mt5_connections),1,'one mapped connection exists');
select is((select count(*)::integer from private.integration_mutation_audits),1,'retry emits no duplicate audit');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
  'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
  'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/api/integrations/v1'),
  'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/api/integrations/v1')::text,true);
set local role authenticated;
select throws_ok($$select public.mt5_register_connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),current_setting('mt5.fixture_identity')::jsonb)$$,
  '42501','A direct browser session is required.','collector cannot create its own mapping');
select lives_ok($$select public.mt5_acquire_lease('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','00000000-0000-4000-8000-000000000003')$$,'mapped collector acquires a fenced lease');
select lives_ok($$select public.mt5_acquire_lease('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','00000000-0000-4000-8000-000000000003')$$,'lost lease acknowledgement replays safely');
select throws_ok($$select public.mt5_acquire_lease('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '44444444-4444-4444-8444-444444444444','00000000-0000-4000-8000-000000000004')$$,
  '55P03','Collector lease is held.','replacement worker cannot compete with an active collector');
select throws_ok($$select public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','0','00000000-0000-4000-8000-000000000005',current_setting('mt5.fixture_identity')::jsonb,'2026-01-01T00:00:01.000Z',current_setting('mt5.fixture_event')::jsonb)$$,
  '55000','Collector lease is stale.','stale fencing token cannot upload');
select lives_ok($$select public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','1','00000000-0000-4000-8000-000000000005',current_setting('mt5.fixture_identity')::jsonb,'2026-01-01T00:00:01.000Z',current_setting('mt5.fixture_event')::jsonb)$$,'source facts and checkpoint commit with a durable receipt');
select lives_ok($$select public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','1','00000000-0000-4000-8000-000000000005',current_setting('mt5.fixture_identity')::jsonb,'2026-01-01T00:00:01.000Z',current_setting('mt5.fixture_event')::jsonb)$$,'lost upload acknowledgement causes no duplicate effect');
reset role;
select is((select count(*)::integer from private.mt5_source_revisions),1,'replay preserves one source revision');
select is((select capture_checkpoint from private.mt5_connections),'2026-01-01T00:00:01.000Z'::timestamptz,'checkpoint advances only with committed staging');
select is((select count(*)::integer from public.trades),0,'staging never publishes premature canonical realized performance');
set local role authenticated;
select throws_ok($$select public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','1','00000000-0000-4000-8000-000000000006',current_setting('mt5.fixture_identity')::jsonb,'2026-01-02T00:00:01.000Z',
  jsonb_set(jsonb_set(current_setting('mt5.fixture_event')::jsonb,'{0,sourceId}','"12"'),'{0,payload,ticket}','"12"')
  || '[{"kind":"DEAL","sourceId":"11","observedAt":"2026-01-01T00:00:01.000Z","payload":{}}]'::jsonb)$$,
  '22023','Invalid source event.','invalid later row rolls back the entire capture batch');
reset role;
select is((select count(*)::integer from private.integration_operations),3,'failed batch stores no operation receipt');
select is((select count(*)::integer from private.mt5_source_revisions),1,'invalid later event rolls back the previously inserted valid event');
select is((select capture_checkpoint from private.mt5_connections),'2026-01-01T00:00:01.000Z'::timestamptz,'failed batch cannot advance the checkpoint');
set local role authenticated;
select lives_ok($$select public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','1','00000000-0000-4000-8000-000000000006',current_setting('mt5.fixture_identity')::jsonb,'2026-01-02T00:00:01.000Z',
  jsonb_set(jsonb_set(current_setting('mt5.fixture_event')::jsonb,'{0,payload,commission}','"-3"'),'{0,observedAt}','"2026-01-02T00:00:01.000Z"'))$$,
  'corrected broker financial fact creates an audited revision');
reset role;
select is((select count(*)::integer from private.mt5_source_revisions),2,'original broker payload remains recoverable');
select ok((select requires_review from private.mt5_source_facts),'corrected broker financial record is flagged for review');
select throws_ok($$delete from private.mt5_source_revisions$$,'42501','Integration audit events are append-only.','source evidence is append-only');
select throws_ok($$update private.integration_operations set result='{}'$$,'42501','Integration audit events are append-only.','operation receipts cannot be rewritten');
update private.mt5_connections set lease_expires_at=clock_timestamp()-interval '1 second';
set local role authenticated;
select lives_ok($$select public.mt5_acquire_lease('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '44444444-4444-4444-8444-444444444444','00000000-0000-4000-8000-000000000007')$$,'replacement can take over only after lease expiry');
select throws_ok($$select public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','1','00000000-0000-4000-8000-000000000008',current_setting('mt5.fixture_identity')::jsonb,'2026-01-03T00:00:00.000Z','[]')$$,
  '55000','Collector lease is stale.','old laptop worker cannot write after replacement takeover');
select is(public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '44444444-4444-4444-8444-444444444444','2','00000000-0000-4000-8000-000000000009',
  jsonb_set(current_setting('mt5.fixture_identity')::jsonb,'{login}','"99999"'),'2026-01-03T00:00:00.000Z','[]')->>'status','ATTENTION',
  'unexpected account switching durably pauses instead of redirecting');
reset role;
select is((select status from private.mt5_connections),'ATTENTION','account switch leaves the connection paused');
select is((select capture_checkpoint from private.mt5_connections),'2026-01-02T00:00:01.000Z'::timestamptz,'wrong account does not advance the mapped checkpoint');
select ok(not has_table_privilege('authenticated','private.mt5_source_revisions','INSERT'),'direct source writes are forbidden');
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.mt5_acquire_lease('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,gen_random_uuid(),gen_random_uuid())$$,
  '42501','Integration access denied.','ordinary browser token cannot impersonate a collector');
reset role;
select ok(not has_function_privilege('anon','public.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb)','EXECUTE'),'anonymous source capture is forbidden');
select is(private.mt5_event_valid('{"kind":"POSITION","sourceId":"100","observedAt":"2026-01-01T00:00:00.000Z","payload":{"positionId":"100","ticket":"10","symbol":"EURUSD","direction":null,"volume":"1","entryPrice":"1.1","currentStop":null,"currentTarget":null,"unrealizedPnl":"0","observedAt":"2026-01-01T00:00:00.000Z"}}'::jsonb),false,
  'direct RPC source validation rejects a null position direction');
insert into public.trading_accounts(user_id,name,account_type,currency_code,currency_precision,starting_balance)
select user_id,'Rebound scope fixture',account_type,currency_code,currency_precision,starting_balance from public.trading_accounts
  where id=(select account_id from private.integration_grants);
update private.integration_grants set account_id=(select id from public.trading_accounts where name='Rebound scope fixture'),version=2,updated_at=clock_timestamp();
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('55555555-5555-4555-8555-555555555555','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
  'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','55555555-5555-4555-8555-555555555555',
  'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/api/integrations/v1'),
  'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','2','trade_os_resource','https://trade.example/api/integrations/v1')::text,true);
set local role authenticated;
select throws_ok($$select public.mt5_acquire_lease('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','00000000-0000-4000-8000-000000000003')$$,
  '42501','Operation scope denied.','rebound grants cannot retrieve old-account receipts');
reset role;
select * from finish();
rollback;
