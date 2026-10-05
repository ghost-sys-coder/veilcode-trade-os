begin;
create extension if not exists pgtap with schema extensions;
select plan(39);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'collection-fixture@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://trade.example/api/integrations/v1',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',
  'MT5',id,'https://trade.example/api/integrations/v1','collection-fixture','ACTIVE' from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('mt5.fixture_identity','{"server":"Broker-Demo","login":"12345","terminalInstallationId":"22222222-2222-4222-8222-222222222222","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"NETTING"}',true);
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select set_config('mt5.fixture_connection',public.mt5_register_connection('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),current_setting('mt5.fixture_identity')::jsonb)->>'connectionId',true);
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
  'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
  'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/api/integrations/v1'),
  'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/api/integrations/v1')::text,true);
create function pg_temp.capture(o integer,m jsonb,e jsonb default '[]',t text default '2026-01-01T00:00:00.000Z') returns jsonb
language sql security invoker as $$ select public.mt5_capture('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,
  '33333333-3333-4333-8333-333333333333','1',('00000000-0000-4000-8000-'||lpad(o::text,12,'0'))::uuid,current_setting('mt5.fixture_identity')::jsonb,t,e,m); $$;
select set_config('mt5.manifest','{"id":"66666666-6666-4666-8666-666666666666","index":2,"count":3}',true);
set local role authenticated;
select public.mt5_acquire_lease('https://trade.example/api/integrations/v1',current_setting('mt5.fixture_connection')::uuid,'33333333-3333-4333-8333-333333333333',gen_random_uuid());
select is(pg_temp.capture(1,current_setting('mt5.manifest')::jsonb)->>'collectionComplete','false','last-index batch arriving first does not complete the collection');
select is(pg_temp.capture(1,current_setting('mt5.manifest')::jsonb)->>'checkpoint',null,'initial incomplete history has no authoritative checkpoint');
select throws_ok($$select pg_temp.capture(2,jsonb_set(current_setting('mt5.manifest')::jsonb,'{count}','4'))$$,'23505','Collection manifest conflict.','a collection cannot change its declared size');
select throws_ok($$select pg_temp.capture(2,current_setting('mt5.manifest')::jsonb,'[]','2026-01-02T00:00:00.000Z')$$,'23505','Collection manifest conflict.','a collection cannot change its frozen checkpoint');
select throws_ok($$select pg_temp.capture(2,jsonb_set(current_setting('mt5.manifest')::jsonb,'{index}','3'))$$,'22023','Invalid capture collection.','out-of-range batch index is rejected');
select throws_ok($$select pg_temp.capture(2,jsonb_set(current_setting('mt5.manifest')::jsonb,'{count}','0'))$$,'22023','Invalid capture batch.','zero-sized manifest is rejected');
select throws_ok($$select pg_temp.capture(2,jsonb_set(current_setting('mt5.manifest')::jsonb,'{index}','"0"'))$$,'22023','Invalid capture batch.','untyped manifest index is rejected');
select throws_ok($$select pg_temp.capture(2,null)$$,'22023','Invalid capture batch.','manifest cannot be omitted through direct RPC');
select throws_ok($$select pg_temp.capture(2,jsonb_set(current_setting('mt5.manifest')::jsonb,'{index}','0'),'[{"kind":"DEAL","payload":{}}]')$$,'22023','Invalid source event.','invalid batch does not fill a missing slot');
reset role;
select is((select count(*)::integer from private.mt5_capture_batches),1,'failed batches leave one durable slot');
select is((select count(*)::integer from private.integration_operations where operation_kind='MT5_CAPTURE'),1,'failed batches leave no receipts');
set local role authenticated;
select is(pg_temp.capture(2,jsonb_set(current_setting('mt5.manifest')::jsonb,'{index}','0'))->>'receivedBatchCount','2','non-contiguous uploads remain incomplete');
select is(pg_temp.capture(2,jsonb_set(current_setting('mt5.manifest')::jsonb,'{index}','0'))->>'collectionComplete','false','missing middle batch holds the checkpoint');
select is(pg_temp.capture(90,'{"id":"77777777-7777-4777-8777-777777777777","index":0,"count":1}','[]','2026-01-02T00:00:00.000Z')->>'collectionComplete','true','newer collection can be fully staged independently');
select is(pg_temp.capture(90,'{"id":"77777777-7777-4777-8777-777777777777","index":0,"count":1}','[]','2026-01-02T00:00:00.000Z')->>'checkpoint',null,'newer complete collection cannot skip the older missing slot');
select is(pg_temp.capture(3,jsonb_set(current_setting('mt5.manifest')::jsonb,'{index}','1'))->>'collectionComplete','true','all declared slots complete the collection');
select is(pg_temp.capture(1,current_setting('mt5.manifest')::jsonb)->>'collectionComplete','false','receipt replay returns its original result, not rewritten later state');
select is(pg_temp.capture(4,current_setting('mt5.manifest')::jsonb)->>'receivedBatchCount','3','a new operation retry of an identical slot does not increment the count');
select throws_ok($$select pg_temp.capture(5,current_setting('mt5.manifest')::jsonb,'[{}]')$$,'23505','Collection batch conflict.','an already committed slot cannot replace its event payload');
reset role;
select is((select count(*)::integer from private.mt5_capture_batches),4,'three older slots and one newer slot persist');
select is((select capture_checkpoint from private.mt5_connections),'2026-01-02T00:00:00.000Z'::timestamptz,'filling the old gap promotes already-durable newer coverage');
set local role authenticated;
select is(pg_temp.capture(91,'{"id":"88888888-8888-4888-8888-888888888888","index":0,"count":2}','[]','2025-12-31T00:00:00.000Z')->>'checkpoint','2026-01-02T00:00:00+00:00','late backfill never regresses an existing checkpoint');
select is(pg_temp.capture(92,'{"id":"99999999-9999-4999-8999-999999999999","index":0,"count":1}','[]','2026-01-03T00:00:00.000Z')->>'checkpoint','2026-01-02T00:00:00+00:00','incomplete late backfill holds further progress');
select is(pg_temp.capture(93,'{"id":"88888888-8888-4888-8888-888888888888","index":1,"count":2}','[]','2025-12-31T00:00:00.000Z')->>'checkpoint','2026-01-03T00:00:00+00:00','completed backfill releases the newer durable checkpoint');
reset role;
select throws_ok($$update private.mt5_capture_collections set expected_batch_count=1$$,'42501','Integration audit events are append-only.','manifest cannot be silently rewritten');
select throws_ok($$delete from private.mt5_capture_batches$$,'42501','Integration audit events are append-only.','batch evidence cannot be deleted');
select is(to_regprocedure('public.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb)'),null::regprocedure,'manifest-less public RPC no longer exists');
select is(to_regprocedure('private.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb)'),null::regprocedure,'manifest-less private RPC no longer exists');
select ok(not has_table_privilege('authenticated','private.mt5_capture_batches','INSERT'),'client cannot forge completed slots');
select ok(not has_table_privilege('authenticated','private.mt5_capture_collections','UPDATE'),'client cannot shrink a manifest');
select is((select count(*)::integer from public.trades),0,'complete capture still does not prematurely publish canonical performance');
select ok(not has_table_privilege('authenticated','private.mt5_capture_progress','UPDATE'),'client cannot forge the completion projection');
select is((select count(*)::integer from private.mt5_capture_progress p where p.received_batch_count <> (select count(*) from private.mt5_capture_batches b where b.connection_id=p.connection_id and b.collection_id=p.collection_id)),0,
  'completion projection matches immutable slots after retries, gaps and rollback');
set local role authenticated;
select is(public.get_integration_operation('https://trade.example/api/integrations/v1','MT5','00000000-0000-4000-8000-000000000099')->>'status','UNKNOWN','lookup distinguishes a missing receipt from a committed mutation');
select is(public.get_integration_operation('https://trade.example/api/integrations/v1','MT5','00000000-0000-4000-8000-000000000001')->>'status','COMMITTED','lookup retrieves the owned durable receipt');
select is(public.get_integration_operation('https://trade.example/api/integrations/v1','MT5','00000000-0000-4000-8000-000000000001')->'result'->>'collectionComplete','false','lookup preserves the original immutable result');
select throws_ok($$select public.get_integration_operation('https://trade.example/api/integrations/v1','MT5',null)$$,'22023','Operation ID required.','lookup cannot omit its operation ID');
reset role;
select ok(not has_function_privilege('anon','public.get_integration_operation(text,text,uuid)','EXECUTE'),'anonymous clients cannot inspect operation receipts');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp();
set local role authenticated;
select throws_ok($$select public.get_integration_operation('https://trade.example/api/integrations/v1','MT5','00000000-0000-4000-8000-000000000001')$$,'42501','Integration access denied.','revocation immediately blocks operation lookup');
reset role;
select * from finish();
rollback;
