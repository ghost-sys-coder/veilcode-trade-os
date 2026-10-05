begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'grant-fixture@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled)
values('MT5','https://trade.example/api/integrations/v1',true);
insert into auth.oauth_authorizations(id,authorization_id,client_id,user_id,redirect_uri,scope,resource,code_challenge_method,code_challenge)
values(gen_random_uuid(),'grant-fixture','ffffffff-ffff-4fff-8fff-ffffffffffff','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'http://127.0.0.1:9876/callback','email','https://trade.example/api/integrations/v1','s256',repeat('a',43));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
select throws_ok($$select public.approve_integration_grant('grant-fixture','MT5','00000000-0000-4000-8000-000000000001')$$,
  '42501','Invalid account scope.','a grant cannot target an unowned account');
select throws_ok($$select public.approve_integration_grant('grant-fixture','MCP',null)$$,
  '42501','Resource-bound S256 authorization is required.','wrong resource purpose is denied');
select lives_ok($$select public.approve_integration_grant('grant-fixture','MT5',(select id from public.trading_accounts limit 1))$$,
  'browser-owned account grant succeeds');
select is(jsonb_array_length(public.list_integration_grants()),1,'browser can list its grant');
select lives_ok($$select public.approve_integration_grant('grant-fixture','MT5',(select id from public.trading_accounts limit 1))$$,
  'identical consent retries succeed');
reset role;
select is((select count(*)::integer from private.integration_grant_events),1,'retry appends no duplicate approval');
select is((select version::text from private.integration_grants),'1','retry preserves the grant version');
select throws_ok($$select private.integration_access_token_hook(jsonb_build_object('user_id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'claims',jsonb_build_object('client_id','ffffffff-ffff-4fff-8fff-ffffffffffff')))$$,
  '42501','An active integration grant is required.','pending grants cannot mint integration tokens');
set local role authenticated;
select throws_ok($$select public.activate_integration_grant('grant-fixture','1')$$,'42501','Provider approval is required.',
  'activation cannot bypass provider consent');
reset role;
update auth.oauth_authorizations set status='approved' where authorization_id='grant-fixture';
set local role authenticated;
select lives_ok($$select public.activate_integration_grant('grant-fixture','1')$$,'approved provider consent activates the grant');
select lives_ok($$select public.activate_integration_grant('grant-fixture','1')$$,'activation retry is idempotent');
reset role;
select throws_ok($$delete from private.integration_grant_events$$,'42501','Integration audit events are append-only.','audit evidence cannot be deleted');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select ok((private.integration_access_token_hook(jsonb_build_object('user_id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','claims',
  jsonb_build_object('client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111')))->'claims'->'aud')
  @> '["https://trade.example/api/integrations/v1"]'::jsonb,'hook binds the signed resource audience');
select is(private.integration_access_token_hook('{"claims":{"sub":"fixture"}}'::jsonb),'{"claims":{"sub":"fixture"}}'::jsonb,
  'hook leaves direct browser claims unchanged');
set local role authenticated;
select throws_ok($$select private.integration_access_token_hook('{}'::jsonb)$$,
  '42501',null::text,'authenticated callers cannot invoke the signing hook');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
  'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
  'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/api/integrations/v1'),
  'trade_os_grant_id',(select id from private.integration_grants),'trade_os_grant_version','1',
  'trade_os_resource','https://trade.example/api/integrations/v1')::text,true);
set local role authenticated;
select lives_ok($$select public.authorize_integration('https://trade.example/api/integrations/v1','MT5')$$,'active OAuth session is authorized');
select throws_ok($$select public.authorize_integration('https://wrong.example','MT5')$$,'42501','Integration access denied.','wrong resource is rejected');
select throws_ok($$select public.list_integration_grants()$$,'42501','A direct browser session is required.','OAuth cannot administer grants');
select is((select count(*)::integer from public.trading_accounts),0,'authorized integration still has no direct table access');
reset role;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.revoke_integration_grant((public.list_integration_grants()->0->>'id')::uuid,'2')$$,
  '40001','Grant version conflict.','stale revocation version is rejected');
select lives_ok($$select public.revoke_integration_grant((public.list_integration_grants()->0->>'id')::uuid,'1')$$,'browser revokes its grant');
select lives_ok($$select public.revoke_integration_grant((public.list_integration_grants()->0->>'id')::uuid,'1')$$,'revocation retry succeeds');
reset role;
select is((select count(*)::integer from private.integration_grant_events),3,'revocation retry appends no duplicate audit');
select throws_ok($$select private.integration_access_token_hook(jsonb_build_object('user_id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'claims',jsonb_build_object('client_id','ffffffff-ffff-4fff-8fff-ffffffffffff')))$$,
  '42501','An active integration grant is required.','revoked grant cannot mint refreshed credentials');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
  'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
  'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/api/integrations/v1'),
  'trade_os_grant_id',(select id from private.integration_grants),'trade_os_grant_version','1',
  'trade_os_resource','https://trade.example/api/integrations/v1')::text,true);
set local role authenticated;
select throws_ok($$select public.authorize_integration('https://trade.example/api/integrations/v1','MT5')$$,
  '42501','Integration access denied.','revocation rejects an otherwise unexpired token immediately');
reset role;
select ok(not has_table_privilege('authenticated','private.integration_grants','INSERT'),'direct grant writes are forbidden');
select * from finish();
rollback;
