begin;
create extension if not exists pgtap with schema extensions;
select plan(28);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'monitor-fixture@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://trade.example/api/integrations/v1',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',
 'MT5',id,'https://trade.example/api/integrations/v1','monitor-fixture','ACTIVE'
from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into private.mt5_connections(id,owner_id,account_id,grant_id,identity,worker_id,fencing_token,lease_expires_at)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',owner_id,account_id,id,
 '{"server":"Broker-Demo","login":"12345","terminalInstallationId":"22222222-2222-4222-8222-222222222222","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"NETTING"}',
 '33333333-3333-4333-8333-333333333333',1,clock_timestamp()+interval '120 seconds' from private.integration_grants;
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','ACCOUNT','ACCOUNT','2026-01-01T00:00:00Z',
 '{"balance":"1000","equity":"1001","unrealizedPnl":"1","observedAt":"2026-01-01T00:00:00.000Z"}',repeat('a',64),1,gen_random_uuid());
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,id,observed_at from private.mt5_source_revisions;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.mt5_list_connections()),1,'owner sees its mapped connection');
select is(public.mt5_list_connections()->0->>'sourceFactCount','1','monitor reports durable source count');
select is(public.mt5_list_connections()->0->>'publishedTradeCount','0','captured facts are not published trades');
select is(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->'events'->0->>'kind','ACCOUNT','preview reads typed durable evidence');
select is(jsonb_array_length(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1,1)->'events'),0,'paging does not replay the first row');
select set_config('mt5.fixture_snapshot',public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->>'snapshotToken',true);
select throws_ok($$select public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1001)$$,'22023','Invalid source page.','page size is bounded');
select throws_ok($$select public.mt5_browser_source_page('dddddddd-dddd-4ddd-8ddd-dddddddddddd',0,1)$$,'42501','Connection access denied.','unknown connection denied');
select throws_ok($$select public.mt5_set_connection_state('cccccccc-cccc-4ccc-8ccc-cccccccccccc','1',gen_random_uuid(),'PAUSE','')$$,
 '22023','Valid control action, version and reason required.','meaningful reason required');
select is(public.mt5_set_connection_state('cccccccc-cccc-4ccc-8ccc-cccccccccccc','1','00000000-0000-4000-8000-000000000001','PAUSE','Operator review pause')->>'status','PAUSED','explicit pause succeeds');
select is(public.mt5_set_connection_state('cccccccc-cccc-4ccc-8ccc-cccccccccccc','1','00000000-0000-4000-8000-000000000001','PAUSE','Operator review pause')->>'version','2','identical retry returns original receipt');
select throws_ok($$select public.mt5_set_connection_state('cccccccc-cccc-4ccc-8ccc-cccccccccccc','1','00000000-0000-4000-8000-000000000001','RESUME','Operator review pause')$$,
 '23505','Operation payload conflict.','changed retry payload rejected');
select throws_ok($$select public.mt5_set_connection_state('cccccccc-cccc-4ccc-8ccc-cccccccccccc','1',gen_random_uuid(),'RESUME','Resume capture explicitly')$$,
 '40001','Connection version conflict.','stale browser version rejected');
reset role;
select is((select fencing_token from private.mt5_connections),2::bigint,'browser pause fences the prior worker');
select ok((select worker_id is null and lease_expires_at<=clock_timestamp() from private.mt5_connections),'pause clears worker ownership');
select is((select count(*)::integer from private.integration_operations),1,'retry and rejected controls create no extra receipts');
select is((select changes->>'actorType' from private.integration_mutation_audits),'BROWSER','audit identifies the browser actor');
update private.mt5_connections set last_heartbeat_at=clock_timestamp();
select is(private.mt5_source_snapshot_token('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),current_setting('mt5.fixture_snapshot'),'heartbeat alone does not invalidate source preview');
update private.mt5_source_facts set requires_review=true;
select isnt(private.mt5_source_snapshot_token('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),current_setting('mt5.fixture_snapshot'),'review-state changes invalidate source preview');
set local role authenticated;
select set_config('mt5.fixture_ledger',public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->>'ledgerToken',true);
select is(jsonb_typeof(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->'account'->'startingBalance'),'string','monetary baseline crosses API as decimal string');
reset role;
insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at)
select c.owner_id,c.account_id,'DEPOSIT',.01,clock_timestamp() from private.mt5_connections c cross join generate_series(1,1001);
set local role authenticated;
select is((public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->'account'->>'ledgerBalance')::numeric
  -(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->'account'->>'startingBalance')::numeric,10.01::numeric,
  'ledger includes all 1001 adjustments without floating drift or first-page truncation');
select isnt(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->>'ledgerToken',current_setting('mt5.fixture_ledger'),'cash adjustment changes invalidate account snapshot');
select is(jsonb_array_length(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)->'trades'),0,'trade context is explicitly paginated and empty');
select is(public.mt5_set_connection_state('cccccccc-cccc-4ccc-8ccc-cccccccccccc','2','00000000-0000-4000-8000-000000000002','RESUME','Resume capture explicitly')->>'status','ONBOARDING','resume cannot bypass onboarding approval');
select set_config('request.jwt.claims','{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}',true);
select is(jsonb_array_length(public.mt5_list_connections()),0,'non-owner cannot discover another account connection');
select throws_ok($$select public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,1)$$,'42501','Connection access denied.','non-owner cannot read source payloads');
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated","client_id":"ffffffff-ffff-4fff-8fff-ffffffffffff"}',true);
select throws_ok($$select public.mt5_list_connections()$$,'42501','A direct browser session is required.','collector cannot use browser discovery');
reset role;
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp();
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.mt5_set_connection_state('cccccccc-cccc-4ccc-8ccc-cccccccccccc','3',gen_random_uuid(),'RESUME','Resume capture explicitly')$$,
 '42501','Active MT5 grant required.','revoked grant prevents further activity immediately');
reset role;
select ok(not has_function_privilege('anon','public.mt5_list_connections()','EXECUTE'),'anonymous discovery is forbidden');
select * from finish();
rollback;
