begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','setup-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','setup-other@example.test','fixture-only','{}','{}',now(),now());
insert into public.trading_accounts(id,user_id,name,account_type,platform,currency_code,currency_precision,starting_balance)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Setup demo','DEMO','MT5','USD',2,100000),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Other demo','DEMO','MT5','USD',2,100000);
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://setup.example/mcp',true),('MT5','https://setup.example/api/integrations/v1',true)
on conflict(purpose) do update set resource=excluded.resource,enabled=true;
insert into private.integration_setup_policies(purpose,enabled) values('MCP',false),('MT5',true)
on conflict(purpose) do update set enabled=excluded.enabled;
select set_config('setup.grants.before',(select count(*)::text from private.integration_grants),true);
set local role anon;
select throws_ok($$select public.list_integration_setups()$$,'42501',null::text,'anonymous setup access denied');
reset role;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from private.integration_setup_profiles$$,'42501',null::text,'direct profile reads denied');
select throws_ok($$insert into private.integration_setup_policies(purpose,enabled) values('MCP',true)$$,'42501',null::text,'browser cannot enable rollout policy');
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'CODEX',null,'https://setup.example/mcp')$$,'42501','Integration setup is disabled.','database flag cannot be bypassed');
reset role;
update private.integration_setup_policies set enabled=true where purpose='MCP';
set local role authenticated;
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'UNKNOWN',null,'https://setup.example/mcp')$$,'22023','Invalid setup request.','unknown client denied');
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'MT5_WINDOWS','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','https://setup.example/api/integrations/v1')$$,'42501','Invalid setup account.','unowned MT5 account denied');
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'CODEX','cccccccc-cccc-4ccc-8ccc-cccccccccccc','https://setup.example/mcp')$$,'42501','Invalid setup account.','MCP cannot take account scope');
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'CODEX',null,'https://evil.example/mcp')$$,'42501','Integration setup is disabled.','caller resource cannot choose another destination');
select set_config('setup.profile',public.reserve_integration_setup('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CODEX',null,'https://setup.example/mcp')::text,true);
select is(current_setting('setup.profile')::jsonb->>'createAllowed','true','first reservation permits exactly one provider create');
select is(current_setting('setup.profile')::jsonb->>'callbackUri','http://127.0.0.1:9878/callback','callback is server derived');
select is(current_setting('setup.profile')::jsonb->>'status','REGISTERING','reservation is not consent or connection');
select is(public.reserve_integration_setup('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CODEX',null,'https://setup.example/mcp')->>'createAllowed','false','identical retry cannot create again');
select throws_ok($$select public.reserve_integration_setup('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CLAUDE_CODE',null,'https://setup.example/mcp')$$,'PT409','Setup operation conflict.','changed payload under operation ID denied');
select is(public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'1')->>'status','REGISTERING','missing provider record remains held');
select throws_ok($$select public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'2')$$,'PT409','Setup version conflict.','stale version denied');
select is(jsonb_array_length(public.list_integration_setups()->'profiles'),1,'owner sees own setup');
reset role;
select is((select count(*)::integer from private.integration_setup_events),1,'retries append no duplicate reservation audit');
select is((select count(*)::text from private.integration_grants),current_setting('setup.grants.before'),'setup grants no application access');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method,client_name)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9878/callback','authorization_code,refresh_token','public','none',
'Trade OS CODEX setup ' || (current_setting('setup.profile')::jsonb->>'id'));
select throws_ok($$insert into private.integration_grants(owner_id,client_id,purpose,resource,authorization_id,status)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://setup.example/mcp','not-ready-owner','PENDING')$$,
'42501','Setup grant binding mismatch.','provider record alone cannot authorize an unverified setup');
select throws_ok($$insert into private.integration_grants(owner_id,client_id,purpose,resource,authorization_id,status)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://setup.example/mcp','not-ready-other','PENDING')$$,
'42501','Setup grant binding mismatch.','another owner cannot authorize a provider record before verification');
set local role authenticated;
select is(public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'1')->>'status','READY','exact public provider record completes registration');
select is(public.reserve_integration_setup('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CODEX',null,'https://setup.example/mcp')->>'version','2','retry returns current string version');
select lives_ok($$select public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'2')$$,'completion replay succeeds without another mutation');
reset role;
select is((select count(*)::integer from private.integration_setup_events),2,'completion is audited once');
select throws_ok($$delete from private.integration_setup_events$$,'42501','Integration audit events are append-only.','setup evidence cannot be deleted');
select throws_ok($$update private.integration_setup_events set event_type='RESERVED'$$,'42501','Integration audit events are append-only.','setup evidence cannot be overwritten');
select throws_ok($$insert into private.integration_grants(owner_id,client_id,purpose,resource,authorization_id,status)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://setup.example/mcp','wrong-owner','PENDING')$$,
'42501','Setup grant binding mismatch.','another owner cannot authorize a reserved public client');
select throws_ok($$insert into private.integration_grants(owner_id,client_id,purpose,resource,authorization_id,status)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://evil.example/mcp','wrong-resource','PENDING')$$,
'42501','Setup grant binding mismatch.','setup cannot grant another resource');
select set_config('request.jwt.claims','{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.list_integration_setups()->'profiles'),0,'other owner sees no setup');
select throws_ok($$select public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'2')$$,'42501','Setup profile unavailable.','other owner cannot recover a profile');
reset role;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated","client_id":"ffffffff-ffff-4fff-8fff-ffffffffffff"}',true);
set local role authenticated;
select throws_ok($$select public.list_integration_setups()$$,'42501','A direct browser session is required.','OAuth clients cannot manage setup profiles');
reset role;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
update auth.oauth_clients set redirect_uris='https://evil.example/callback' where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
set local role authenticated;
select throws_ok($$select public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'2')$$,'42501','Provider registration mismatch.','changed callback invalidates readiness verification');
reset role;
update auth.oauth_clients set redirect_uris='http://127.0.0.1:9878/callback',deleted_at=clock_timestamp() where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
set local role authenticated;
select throws_ok($$select public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'2')$$,'42501','Provider registration unavailable.','deleted provider is not ready');
reset role;
update auth.oauth_clients set deleted_at=null where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
set local role authenticated;
select set_config('setup.mt5',public.reserve_integration_setup(gen_random_uuid(),'MT5_WINDOWS','cccccccc-cccc-4ccc-8ccc-cccccccccccc','https://setup.example/api/integrations/v1')::text,true);
select is(current_setting('setup.mt5')::jsonb->>'callbackUri','http://127.0.0.1:9876/callback','MT5 gets separate registered callback');
select is(current_setting('setup.mt5')::jsonb->>'accountId','cccccccc-cccc-4ccc-8ccc-cccccccccccc','MT5 preserves owned account binding');
reset role;
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method,client_name)
values('abababab-abab-4aba-8aba-abababababab','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','confidential','client_secret_basic',
'Trade OS MT5_WINDOWS setup ' || (current_setting('setup.mt5')::jsonb->>'id'));
set local role authenticated;
select throws_ok($$select public.reconcile_integration_setup((current_setting('setup.mt5')::jsonb->>'id')::uuid,'1')$$,'42501','Provider registration mismatch.','confidential provider cannot complete a public setup');
reset role;
update auth.oauth_clients set client_type='public',token_endpoint_auth_method='none' where id='abababab-abab-4aba-8aba-abababababab';
set local role authenticated;
select lives_ok($$select public.reconcile_integration_setup((current_setting('setup.mt5')::jsonb->>'id')::uuid,'1')$$,'exact MT5 public registration succeeds');
reset role;
select throws_ok($$insert into private.integration_grants(owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','abababab-abab-4aba-8aba-abababababab','MT5','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','https://setup.example/api/integrations/v1','wrong-account','PENDING')$$,
'42501','Setup grant binding mismatch.','MT5 consent cannot retarget the selected account');
update auth.oauth_clients set client_name='Trade OS MT5_WINDOWS setup ' || (current_setting('setup.mt5')::jsonb->>'id')
where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
select throws_ok($$insert into private.integration_grants(owner_id,client_id,purpose,resource,authorization_id,status)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://setup.example/mcp','ambiguous-binding','PENDING')$$,
'42501','Setup grant binding mismatch.','conflicting provider name and pinned client identity fail closed');
update auth.oauth_clients set client_name='Trade OS CODEX setup ' || (current_setting('setup.profile')::jsonb->>'id')
where id='ffffffff-ffff-4fff-8fff-ffffffffffff';
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method,client_name)
values('acacacac-acac-4aca-8aca-acacacacacac','manual','http://127.0.0.1:9878/callback','authorization_code,refresh_token','public','none',
'Trade OS CODEX setup ' || (current_setting('setup.profile')::jsonb->>'id'));
set local role authenticated;
select throws_ok($$select public.reconcile_integration_setup((current_setting('setup.profile')::jsonb->>'id')::uuid,'2')$$,'42501','Ambiguous provider registration.','duplicate provider names remain held');
reset role;
delete from auth.oauth_clients where id='acacacac-acac-4aca-8aca-acacacacacac';
set local role authenticated;
do $$begin for i in 1..18 loop perform public.reserve_integration_setup(gen_random_uuid(),'CODEX',null,'https://setup.example/mcp'); end loop; end$$;
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'CODEX',null,'https://setup.example/mcp')$$,'54000','Setup profile limit reached.','owner quota bounds provider provisioning');
select is(public.reserve_integration_setup('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CODEX',null,'https://setup.example/mcp')->>'createAllowed','false','existing retry still works at quota');
reset role;
select is((select count(*)::text from private.integration_grants),current_setting('setup.grants.before'),'registration tests changed no grants');
select * from finish();
rollback;
