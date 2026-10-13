begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pair-owner@example.test','fixture','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pair-other@example.test','fixture','{}','{}',now(),now());
insert into public.trading_accounts(id,user_id,name,account_type,platform,currency_code,currency_precision,starting_balance)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Pair demo','DEMO','MT5','USD',2,100000);
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://pair.example/api/integrations/v1',true)
on conflict(purpose) do update set resource=excluded.resource,enabled=true;
insert into private.integration_setup_policies(purpose,enabled) values('MT5',true) on conflict(purpose) do update set enabled=true;
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method,client_name)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none','Trade OS MT5_WINDOWS setup aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into private.integration_setup_profiles(id,owner_id,operation_id,request_hash,purpose,client_kind,account_id,resource,callback_uri,client_id,status,version)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',gen_random_uuid(),repeat('a',64),'MT5','MT5_WINDOWS',
'cccccccc-cccc-4ccc-8ccc-cccccccccccc','https://pair.example/api/integrations/v1','http://127.0.0.1:9876/callback','ffffffff-ffff-4fff-8fff-ffffffffffff','READY',2);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MT5',
'cccccccc-cccc-4ccc-8ccc-cccccccccccc','https://pair.example/api/integrations/v1','pair-fixture','ACTIVE');
select set_config('pair.proposal',jsonb_build_object('format','trade-os-mt5-pairing','version',1,
'profileId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ownerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','accountId','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
'clientId','ffffffff-ffff-4fff-8fff-ffffffffffff','observedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'existingConnectionId',null,
'terminal',jsonb_build_object('executable','D:'||chr(92)||'Dedicated'||chr(92)||'terminal64.exe','dataPath','D:'||chr(92)||'Dedicated'||chr(92)||'data',
'portable',false,'dedicatedApproved',true,'identity',jsonb_build_object('server','Demo','login','123','terminalInstallationId','11111111-1111-4111-8111-111111111111',
'currencyCode','USD','currencyPrecision',2,'accountKind','DEMO','positionMode','HEDGING')))::text,true);
select set_config('pair.request',jsonb_build_object('profileId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','profileVersion','2',
'operationId','22222222-2222-4222-8222-222222222222','proposal',current_setting('pair.proposal')::jsonb,'connectionVersion',null,
'reason','Dedicated demo mapping','confirmed',true)::text,true);
set local role anon;
select throws_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.request')::jsonb)$$,'42501',null::text,'anonymous cannot approve pairing');
reset role;
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from private.mt5_setup_pairings$$,'42501',null::text,'browser cannot directly read private pairing rows');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.request')::jsonb,'{confirmed}','false'))$$,'22023',null::text,'acknowledgement required');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.request')::jsonb,'{proposal,ownerId}','"dddddddd-dddd-4ddd-8ddd-dddddddddddd"'))$$,'22023',null::text,'owner injection rejected');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.request')::jsonb,'{proposal,terminal,identity,accountKind}','"LIVE"'))$$,'22023',null::text,'live identity rejected');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.request')::jsonb,'{proposal,terminal,identity,currencyPrecision}','3'))$$,'22023',null::text,'currency mismatch rejected');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.request')::jsonb,'{proposal,observedAt}','"2020-01-01T00:00:00Z"'))$$,'22023',null::text,'stale observation rejected');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.request')::jsonb,'{proposal,terminal,executable}','"D:\\..\\terminal64.exe"'))$$,'22023',null::text,'unsafe path rejected in database');
reset role;
create function pg_temp.fail_pair_audit() returns trigger language plpgsql as $$begin raise exception 'injected pairing audit failure'; end;$$;
create trigger fail_pair_audit before insert on private.integration_mutation_audits for each row execute function pg_temp.fail_pair_audit();
set local role authenticated;
select throws_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.request')::jsonb)$$,'P0001',null::text,'audit failure aborts registration and pairing');
reset role;
select is((select count(*)::integer from private.mt5_setup_pairings),0,'failed approval has no pairing evidence');
select is((select count(*)::integer from private.mt5_connections where account_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),0,'failed approval has no mapped connection');
drop trigger fail_pair_audit on private.integration_mutation_audits;
set local role authenticated;
select lives_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.request')::jsonb)$$,'explicit new mapping succeeds');
select lives_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.request')::jsonb)$$,'identical lost acknowledgement retry succeeds');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.request')::jsonb,'{reason}','"Changed replay"'))$$,'23505',null::text,'changed replay rejected');
select is(public.get_mt5_setup_pairing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null)->'proposal',current_setting('pair.proposal')::jsonb,'browser reads exact approved public observation');
reset role;
select is((select count(*)::integer from private.mt5_connections where account_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),1,'one canonical connection after replay');
select is((select count(*)::integer from private.mt5_setup_pairings),1,'one immutable pairing after replay');
update public.trading_accounts set currency_precision=3 where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
select is(public.get_mt5_setup_pairing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null),null::jsonb,'changed account precision invalidates activation');
reset role;
update public.trading_accounts set currency_precision=2 where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
select isnt(public.get_mt5_setup_pairing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null),null::jsonb,'unchanged matching currency remains eligible');
reset role;
select throws_ok($$delete from private.mt5_setup_pairings$$,'42501',null::text,'pairing evidence cannot be deleted');
select throws_ok($$update private.mt5_setup_pairings set reason='rewrite'$$,'42501',null::text,'pairing evidence cannot be rewritten');
select set_config('pair.connection',(select connection_id::text from private.mt5_setup_pairings),true);
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at) values('33333333-3333-4333-8333-333333333333','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',now(),now());
insert into auth.oauth_consents(id,user_id,client_id,scopes) values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','client_id','ffffffff-ffff-4fff-8fff-ffffffffffff',
'session_id','33333333-3333-4333-8333-333333333333','exp',extract(epoch from now())+3600,'aud','https://pair.example/api/integrations/v1',
'trade_os_resource','https://pair.example/api/integrations/v1','trade_os_grant_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','trade_os_grant_version','1')::text,true);
set local role authenticated;
select lives_ok($$select public.get_mt5_setup_pairing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://pair.example/api/integrations/v1')$$,'matching collector verifies approved pairing');
select throws_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.request')::jsonb)$$,'42501',null::text,'collector cannot approve its own mapping');
reset role;
select set_config('request.jwt.claims','{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.get_mt5_setup_pairing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null)$$,'42501',null::text,'other owner cannot read pairing');
reset role;
-- A second independently consented setup explicitly adopts the same paused identity.
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method,client_name)
values('44444444-4444-4444-8444-444444444444','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none','Trade OS MT5_WINDOWS setup 55555555-5555-4555-8555-555555555555');
insert into private.integration_setup_profiles(id,owner_id,operation_id,request_hash,purpose,client_kind,account_id,resource,callback_uri,client_id,status,version)
select '55555555-5555-4555-8555-555555555555',owner_id,gen_random_uuid(),repeat('b',64),purpose,client_kind,account_id,resource,callback_uri,'44444444-4444-4444-8444-444444444444','READY',2
from private.integration_setup_profiles where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('66666666-6666-4666-8666-666666666666','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','44444444-4444-4444-8444-444444444444','MT5',
'cccccccc-cccc-4ccc-8ccc-cccccccccccc','https://pair.example/api/integrations/v1','pair-adoption','ACTIVE');
select set_config('pair.adopt',jsonb_set(jsonb_set(jsonb_set(jsonb_set(current_setting('pair.request')::jsonb,'{profileId}','"55555555-5555-4555-8555-555555555555"'),
'{proposal,profileId}','"55555555-5555-4555-8555-555555555555"'),'{proposal,clientId}','"44444444-4444-4444-8444-444444444444"'),
'{operationId}','"77777777-7777-4777-8777-777777777777"')::text,true);
select set_config('request.jwt.claims','{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.adopt')::jsonb)$$,'PT409',null::text,'existing connection cannot be silently duplicated or adopted');
reset role;
update private.mt5_connections set status='PAUSED' where id=current_setting('pair.connection')::uuid;
select set_config('pair.adopt',jsonb_set(jsonb_set(current_setting('pair.adopt')::jsonb,'{proposal,existingConnectionId}',to_jsonb(current_setting('pair.connection'))),'{connectionVersion}','"1"')::text,true);
set local role authenticated;
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.adopt')::jsonb,'{connectionVersion}','"99"'))$$,'PT409',null::text,'stale adoption rejected');
select throws_ok($$select public.approve_mt5_setup_pairing(jsonb_set(current_setting('pair.adopt')::jsonb,'{proposal,terminal,identity,login}','"999"'))$$,'PT409',null::text,'account switch cannot become adoption');
reset role;
create trigger fail_pair_audit before insert on private.integration_mutation_audits for each row execute function pg_temp.fail_pair_audit();
set local role authenticated;
select throws_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.adopt')::jsonb)$$,'P0001',null::text,'audit failure aborts adoption');
reset role;
select is((select grant_id::text from private.mt5_connections where id=current_setting('pair.connection')::uuid),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','failed adoption preserves original grant');
select is((select fencing_token::integer from private.mt5_connections where id=current_setting('pair.connection')::uuid),0,'failed adoption rolls back fence');
drop trigger fail_pair_audit on private.integration_mutation_audits;
set local role authenticated;
select lives_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.adopt')::jsonb)$$,'explicit same-terminal paused adoption succeeds');
select lives_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.adopt')::jsonb)$$,'adoption replay is durable');
select is(public.get_mt5_setup_pairing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null),null::jsonb,'superseded binding cannot activate old manifest');
reset role;
select is((select count(*)::integer from private.mt5_connections where account_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),1,'adoption retains original connection identity');
select is((select fencing_token::integer from private.mt5_connections where id=current_setting('pair.connection')::uuid),1,'adoption fences the old worker exactly once');
select is((select status from private.mt5_connections where id=current_setting('pair.connection')::uuid),'PAUSED','adoption does not resume collection');
select is((select grant_id::text from private.mt5_connections where id=current_setting('pair.connection')::uuid),'66666666-6666-4666-8666-666666666666','connection now requires the explicitly adopted grant');
select is((select count(*)::integer from private.integration_mutation_audits where operation_kind='MT5_SETUP_PAIR'),2,'both approvals retain append-only mutation audits');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp(),version=version+1 where id='66666666-6666-4666-8666-666666666666';
set local role authenticated;
select is(public.get_mt5_setup_pairing('55555555-5555-4555-8555-555555555555',null),null::jsonb,'revocation immediately removes activatable mapping');
select throws_ok($$select public.approve_mt5_setup_pairing(current_setting('pair.adopt')::jsonb)$$,'42501',null::text,'revoked consent cannot replay approval');
reset role;
select * from finish();
rollback;
