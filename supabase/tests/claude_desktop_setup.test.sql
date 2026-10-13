begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','desktop-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','desktop-other@example.test','fixture-only','{}','{}',now(),now());
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://desktop.example/mcp',true)
on conflict(purpose) do update set resource=excluded.resource,enabled=true;
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://desktop.example/api/integrations/v1',false)
on conflict(purpose) do nothing;
insert into private.integration_setup_policies(purpose) values('MT5') on conflict(purpose) do nothing;
update private.integration_setup_policies set enabled=true,claude_desktop_enabled=false where purpose='MCP';
select set_config('desktop.grants.before',(select count(*)::text from private.integration_grants),true);
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'CLAUDE_DESKTOP',null,'https://desktop.example/mcp')$$,
  '42501','Integration setup is disabled.','Desktop defaults off independently of existing MCP');
select is(public.list_integration_setups_v2()->>'desktopEnabled','false','v2 reports disabled Desktop');
select set_config('desktop.codex',public.reserve_integration_setup('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','CODEX',null,'https://desktop.example/mcp')::text,true);
reset role;
update private.integration_setup_policies set claude_desktop_enabled=true where purpose='MCP';
select throws_ok($$update private.integration_setup_policies set claude_desktop_enabled=true where purpose='MT5'$$,'23514',null::text,'Desktop cannot enable MT5');
set local role authenticated;
select set_config('desktop.profile',public.reserve_integration_setup('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CLAUDE_DESKTOP',null,'https://desktop.example/mcp')::text,true);
select is(current_setting('desktop.profile')::jsonb->>'callbackUri','http://127.0.0.1:9884/callback','Desktop callback is server-derived and separate');
select is(current_setting('desktop.profile')::jsonb->>'accountId',null::text,'Desktop has no MT5 account mapping');
select is(public.reserve_integration_setup('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CLAUDE_DESKTOP',null,'https://desktop.example/mcp')->>'createAllowed','false','identical retry cannot register twice');
select throws_ok($$select public.reserve_integration_setup('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CLAUDE_CODE',null,'https://desktop.example/mcp')$$,
  'PT409','Setup operation conflict.','changed client kind is rejected');
select is(jsonb_array_length(public.list_integration_setups()->'profiles'),1,'legacy list preserves old deployments');
select is(public.list_integration_setups() ? 'desktopEnabled',false,'legacy response shape is unchanged');
select is(public.list_integration_setups()->'profiles'->0->>'clientKind','CODEX','legacy profile is still available');
select is(jsonb_array_length(public.list_integration_setups_v2()->'profiles'),2,'v2 exposes both owned profiles');
select is(public.list_integration_setups_v2()->>'desktopEnabled','true','v2 reports Desktop enabled');
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'CLAUDE_DESKTOP','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://desktop.example/mcp')$$,
  '42501','Invalid setup account.','Desktop cannot claim an account mapping');
reset role;
select throws_ok($$update private.integration_setup_profiles set callback_uri='http://127.0.0.1:9880/callback'
where id=(current_setting('desktop.profile')::jsonb->>'id')::uuid$$,'23514',null::text,'database rejects Claude Code callback on Desktop');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method,client_name)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9884/callback','authorization_code,refresh_token','public','none',
'Trade OS CLAUDE_DESKTOP setup ' || (current_setting('desktop.profile')::jsonb->>'id'));
set local role authenticated;
select is(public.reconcile_integration_setup((current_setting('desktop.profile')::jsonb->>'id')::uuid,'1')->>'status','READY','exact public Desktop registration reconciles');
reset role;
select throws_ok($$insert into private.integration_grants(owner_id,client_id,purpose,resource,authorization_id,status)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://desktop.example/mcp','desktop-wrong-owner','PENDING')$$,
'42501','Setup grant binding mismatch.','Desktop provider cannot authorize another owner');
select set_config('request.jwt.claims','{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}',true);
set local role authenticated;
select is(jsonb_array_length(public.list_integration_setups_v2()->'profiles'),0,'other owner sees no profiles');
select throws_ok($$select public.reconcile_integration_setup((current_setting('desktop.profile')::jsonb->>'id')::uuid,'2')$$,
  '42501','Setup profile unavailable.','other owner cannot reconcile Desktop');
reset role;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated","client_id":"ffffffff-ffff-4fff-8fff-ffffffffffff"}',true);
set local role authenticated;
select throws_ok($$select public.list_integration_setups_v2()$$,'42501','A direct browser session is required.','OAuth cannot manage Desktop setup');
select throws_ok($$select public.reserve_integration_setup(gen_random_uuid(),'CLAUDE_DESKTOP',null,'https://desktop.example/mcp')$$,
  '42501','A direct browser session is required.','OAuth cannot provision more Desktop clients');
reset role;
set local role anon;
select throws_ok($$select public.list_integration_setups_v2()$$,'42501',null::text,'anonymous v2 read denied');
reset role;
select is((select count(*)::text from private.integration_grants),current_setting('desktop.grants.before'),'Desktop setup grants no access or changes to existing grants');
select is((select count(*)::integer from private.integration_setup_events where profile_id=(current_setting('desktop.profile')::jsonb->>'id')::uuid),2,'Desktop reserve and registration audit once each');
select * from finish();
rollback;
