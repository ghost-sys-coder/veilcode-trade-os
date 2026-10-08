begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','profile-owner@example.test','fixture-only','{}','{"display_name":"Owner Trader"}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','profile-other@example.test','fixture-only','{}','{"display_name":"Other Trader"}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now(),now());
select set_config('profile.browser.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','session_id','22222222-2222-4222-8222-222222222222','exp',extract(epoch from clock_timestamp())+3600)::text,true);
select set_config('request.jwt.claims',current_setting('profile.browser.claims'),true);
select set_config('profile.original',private.application_profile_read('{}')::text,true);
select is(current_setting('profile.original')::jsonb->>'id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','read is self-owned');
select is(current_setting('profile.original')::jsonb->>'record_version','1','existing signup initializes version one');
select is(jsonb_typeof(current_setting('profile.original')::jsonb->'record_version'),'string','version wire is a string');
select ok(not (current_setting('profile.original')::jsonb ?| array['email','password','raw_user_meta_data','raw_app_meta_data','session_id']),'read excludes credentials and auth metadata');
select ok(not has_function_privilege('anon','private.application_profile_read(jsonb)','EXECUTE'),'anonymous private reads denied');
select ok(not has_function_privilege('authenticated','private.application_profile_write(jsonb)','EXECUTE'),'browser/OAuth cannot call private write directly');
select ok(not has_function_privilege('service_role','private.application_profile_write(jsonb)','EXECUTE'),'service API key cannot invoke profile workflow');
select ok((select relrowsecurity from pg_class where oid='public.profiles'::regclass),'profile RLS remains enabled');
select ok((select bool_and(not prosecdef) from pg_proc where oid in ('private.application_profile_read(jsonb)'::regprocedure,'private.application_profile_write(jsonb)'::regprocedure)),'workflows are security invoker');
select throws_ok($$select private.application_profile_read('{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'22023','Invalid profile query.','caller cannot select another owner');
select throws_ok($$select private.application_profile_read('null')$$,'22023','Invalid profile query.','null query rejected');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":"1","values":{}}')$$,'22023','Invalid profile command.','empty patch rejected');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":"1","values":{"timezone":"UTC"},"user_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'22023','Invalid profile command.','owner injection rejected');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":"1","values":{"password":"fixture-only"}}')$$,'22023','Invalid profile command.','auth fields are not patchable');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":1,"values":{"timezone":"UTC"}}')$$,'22023','Invalid profile command.','numeric versions rejected');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":"1","values":{"displayName":123}}')$$,'22023','Invalid display name.','non-string name rejected');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":"1","values":{"displayName":" A "}}')$$,'22023','Invalid display name.','untrimmed invalid name rejected');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":"1","values":{"timezone":null}}')$$,'22023','Invalid profile timezone.','timezone cannot be cleared');
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000009","expectedVersion":"1","values":{"timezone":"not/real"}}')$$,'22023','Invalid profile timezone.','invalid timezone rejected at database boundary');
select set_config('profile.command','{"operationId":"00000000-0000-4000-8000-000000000001","expectedVersion":"1","values":{"displayName":"Updated Trader"}}',true);
select set_config('profile.result',private.application_profile_write(current_setting('profile.command')::jsonb)::text,true);
select is(current_setting('profile.result')::jsonb->'record'->>'record_version','2','valid patch advances version');
select is(current_setting('profile.result')::jsonb->'record'->>'timezone','Africa/Kampala','omitted timezone unchanged');
select is(private.application_profile_write(current_setting('profile.command')::jsonb),current_setting('profile.result')::jsonb,'identical retry returns original result');
select is((select count(*)::integer from private.application_operations where operation_id='00000000-0000-4000-8000-000000000001'),1,'one durable receipt after replay');
select throws_ok($$select private.application_profile_write(jsonb_set(current_setting('profile.command')::jsonb,'{values,displayName}','"Changed retry"'))$$,'23505','Operation payload conflict.','changed payload cannot reuse operation ID');
select throws_ok($$select private.application_profile_write(jsonb_set(current_setting('profile.command')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())))$$,'40001','Profile version conflict.','stale new operation cannot overwrite current preferences');
select is(private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000002","expectedVersion":"2","values":{"displayName":null}}')->'record'->'display_name','null'::jsonb,'explicit null clears name');
select is(private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000003","expectedVersion":"3","values":{"timezone":"America/New_York"}}')->'record'->>'record_version','4','timezone update shares concurrency contract');
select is((select display_name from public.profiles where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),null::text,'omitted name remains null');
select is((select display_name from public.profiles where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),'Other Trader','other owner not mutated');
select is(private.application_profile_read('{}')->>'created_at',current_setting('profile.original')::jsonb->>'created_at','creation instant preserved');
select is((select raw_user_meta_data from auth.users where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),' {"display_name":"Owner Trader"}'::jsonb,'preferences do not modify auth metadata');
select is((select count(*)::integer from private.application_mutation_audits where actor_user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),3,'every committed preference change has one audit');
select ok((select a.changes->'before'->>'display_name'='Owner Trader' and a.changes->'after'->>'display_name'='Updated Trader' and a.affected_records->>'profileId'='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' from private.application_mutation_audits a join private.application_operations o on o.id=a.operation_receipt_id where o.operation_id='00000000-0000-4000-8000-000000000001'),'audit recovers original and current preferences with self target');
create function pg_temp.fail_profile_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure.' using errcode='23514';end;$$;
create trigger fixture_profile_audit before insert on private.application_mutation_audits for each row execute function pg_temp.fail_profile_audit();
select throws_ok($$select private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000099","expectedVersion":"4","values":{"timezone":"UTC"}}')$$,'23514','Fixture audit failure.','audit failure aborts preference write');
drop trigger fixture_profile_audit on private.application_mutation_audits;
select is(private.application_profile_read('{}')->>'timezone','America/New_York','failed audit rolls back profile change');
select is(private.application_profile_read('{}')->>'record_version','4','failed audit rolls back version');
select is((select count(*)::integer from private.application_operations where operation_id='00000000-0000-4000-8000-000000000099'),0,'failed audit rolls back receipt');
select throws_ok($$delete from private.application_mutation_audits where actor_user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$$,'42501','Integration audit events are append-only.','preference audits cannot be deleted');
-- Ordinary browser reads/RLS are preserved; no migration-induced login wall.
set local role authenticated;
select is((select count(*)::integer from public.profiles),1,'direct browser sees only its own profile');
reset role;
select set_config('request.jwt.claims',jsonb_set(current_setting('profile.browser.claims')::jsonb,'{exp}','1')::text,true);
select throws_ok($$select private.application_profile_read('{}')$$,'42501','Application access denied.','expired direct session rejected');
select set_config('request.jwt.claims',jsonb_set(current_setting('profile.browser.claims')::jsonb,'{sub}','"dddddddd-dddd-4ddd-8ddd-dddddddddddd"')::text,true);
select throws_ok($$select private.application_profile_read('{}')$$,'42501','Application access denied.','forged subject cannot borrow another session');

insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP',null,'https://trade.example/mcp','profile-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
 'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.profiles),0,'OAuth cannot directly read profiles');
update public.profiles set timezone='UTC';
reset role;
select is(private.application_profile_read('{}')->>'timezone','America/New_York','OAuth direct write has no effect');
select lives_ok($$select private.application_profile_read('{}')$$,'verified MCP reads its own profile through shared workflow');
select set_config('profile.mcp.command','{"operationId":"00000000-0000-4000-8000-000000000090","expectedVersion":"4","values":{"timezone":"UTC"}}',true);
select lives_ok($$select private.application_profile_write(current_setting('profile.mcp.command')::jsonb)$$,'verified MCP uses same profile writer');
select is((select count(*)::integer from private.application_mutation_audits where actor_type='MCP' and client_id='ffffffff-ffff-4fff-8fff-ffffffffffff'),1,'MCP actor/client recorded without credentials');
select is(public.get_integration_operation('https://trade.example/mcp','MCP','00000000-0000-4000-8000-000000000090')->>'status','COMMITTED','operation lookup returns committed profile receipt');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_profile_read('{}')$$,'42501','Integration access denied.','revoked grant cannot read profile');
select throws_ok($$select private.application_profile_write(current_setting('profile.mcp.command')::jsonb)$$,'42501','Integration access denied.','revoked grant cannot replay a committed preference write');
select set_config('request.jwt.claims',current_setting('profile.browser.claims'),true);
alter table public.profiles disable trigger profile_record_version;
update public.profiles set record_version=9007199254740993 where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
alter table public.profiles enable trigger profile_record_version;
select is(private.application_profile_read('{}')->>'record_version','9007199254740993','unsafe-for-JavaScript version remains exact');
select is(private.application_profile_write('{"operationId":"00000000-0000-4000-8000-000000000091","expectedVersion":"9007199254740993","values":{"displayName":"😀😀"}}')->'record'->>'record_version','9007199254740994','Unicode and bigint concurrency agree at the database boundary');
select * from finish();
rollback;
