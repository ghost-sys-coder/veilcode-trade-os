begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','deletion-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','deletion-other@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://trade.example/mcp','deletion-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at) values
('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',now(),now()),
('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',null,now(),now());
insert into auth.oauth_consents(id,user_id,client_id,scopes) values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('deletion.mcp',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111','exp',extract(epoch from clock_timestamp())+3600,
 'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
select set_config('deletion.browser',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'session_id','22222222-2222-4222-8222-222222222222','exp',extract(epoch from clock_timestamp())+3600)::text,true);
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
insert into public.strategies(id,user_id,name) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',auth.uid(),'Unused deletion fixture'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc',auth.uid(),'Referenced deletion fixture');
insert into public.setups(id,user_id,strategy_id,name) values('99999999-9999-4999-8999-999999999999',auth.uid(),'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Retained setup');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.deletion_requests'::regclass,'private.deletion_objects'::regclass)),'approval/job tables enforce private RLS');
select ok(not has_function_privilege('authenticated','private.application_deletion_write(jsonb)','execute'),'OAuth cannot approve or execute a private writer directly');
select ok(not has_function_privilege('anon','private.application_deletion_read(jsonb)','execute'),'anonymous cannot inspect private requests');
select ok(not has_function_privilege('service_role','private.application_deletion_write(jsonb)','execute'),'Storage credential cannot invoke deletion workflow');
select throws_ok($$select private.application_deletion_read('{"action":"INSPECT","entity":"ACCOUNT","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')$$,'22023','Invalid deletion entity.','financial entities absent from deletion allowlist');
select throws_ok($$select private.application_deletion_read('{"action":"INSPECT","entity":"STRATEGY","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","ownerId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'22023','Invalid deletion query.','owner injection rejected');
select is(private.application_deletion_read('{"action":"INSPECT","entity":"STRATEGY","id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')->>'effect','DELETE','unused target eligible for deletion');
create function pg_temp.deletion_request(entity text,target uuid,version text) returns jsonb language sql as $$
  select jsonb_build_object('action','REQUEST','operationId',gen_random_uuid(),'entity',entity,'id',target,'expectedVersion',version,'executionOperationId',gen_random_uuid(),'reason','Remove approved fixture');$$;
create function pg_temp.deletion_decide(request_id uuid,decision text default 'APPROVE',ack boolean default true) returns jsonb language sql as $$
  select jsonb_build_object('action','DECIDE','operationId',gen_random_uuid(),'requestId',request_id,'expectedVersion','1','decision',decision,'acknowledged',ack);$$;
select set_config('deletion.request',pg_temp.deletion_request('STRATEGY','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','1')::text,true);
select set_config('deletion.created',private.application_deletion_write(current_setting('deletion.request')::jsonb)::text,true);
select set_config('deletion.id',current_setting('deletion.created')::jsonb->'request'->>'requestId',true);
select is(private.application_deletion_write(current_setting('deletion.request')::jsonb),current_setting('deletion.created')::jsonb,'request retries preserve the exact intent');
select is((select count(*)::int from private.deletion_requests),1,'one request after replay');
select throws_ok($$select private.application_deletion_write(jsonb_set(current_setting('deletion.request')::jsonb,'{reason}','"Changed payload"'))$$,'23505','Operation payload conflict.','changed retry rejected');
select set_config('deletion.execute',jsonb_build_object('action','EXECUTE','operationId',current_setting('deletion.request')::jsonb->>'executionOperationId','requestId',current_setting('deletion.id'))::text,true);
select throws_ok($$select private.application_deletion_write(current_setting('deletion.execute')::jsonb)$$,'23514','Deletion approval unavailable.','unapproved execution rejected');
select throws_ok($$select private.application_deletion_write(pg_temp.deletion_decide(current_setting('deletion.id')::uuid))$$,'42501','Deletion actor denied.','MCP cannot approve itself');
select set_config('request.jwt.claims',current_setting('deletion.browser'),true);
set local role authenticated;
select throws_ok($$delete from public.strategies where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,'42501','Permanent deletion requires an approved application workflow.','direct browser delete cannot bypass approval');
reset role;
select throws_ok($$select private.application_deletion_write(pg_temp.deletion_decide(current_setting('deletion.id')::uuid,'APPROVE',false))$$,'22023','Explicit deletion approval required.','unchecked acknowledgement is not approval');
select set_config('deletion.approve',pg_temp.deletion_decide(current_setting('deletion.id')::uuid)::text,true);
select is(private.application_deletion_write(current_setting('deletion.approve')::jsonb)->'request'->>'status','APPROVED','explicit owner-browser approval succeeds');
select is(private.application_deletion_write(current_setting('deletion.approve')::jsonb)->'request'->>'version','2','lost approval acknowledgement replays without another transition');
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
select throws_ok($$select private.application_deletion_write(jsonb_set(current_setting('deletion.execute')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())))$$,'42501','Deletion execution binding denied.','approval bound to exact execution operation');
create function pg_temp.deletion_audit_failure() returns trigger language plpgsql as $$begin if new.changes->>'action'='EXECUTE' then raise exception 'Deletion fixture audit failure.' using errcode='23514';end if;return new;end;$$;
create trigger deletion_fixture_audit before insert on private.application_mutation_audits for each row execute function pg_temp.deletion_audit_failure();
select throws_ok($$select private.application_deletion_write(current_setting('deletion.execute')::jsonb)$$,'23514','Deletion fixture audit failure.','failed audit rolls back permanent deletion');
drop trigger deletion_fixture_audit on private.application_mutation_audits;
select ok(exists(select 1 from public.strategies where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'failed audit preserves original target');
select is((select status from private.deletion_requests where id=current_setting('deletion.id')::uuid),'APPROVED','failed audit does not consume approval');
select set_config('deletion.executed',private.application_deletion_write(current_setting('deletion.execute')::jsonb)::text,true);
select is(current_setting('deletion.executed')::jsonb->'request'->>'status','DELETED','approved unused target deleted once');
select ok(not exists(select 1 from public.strategies where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'permanent target no longer appears');
select is(private.application_deletion_write(current_setting('deletion.execute')::jsonb),current_setting('deletion.executed')::jsonb,'execution replay returns original receipt after target disappears');
select is((select original_record->>'name' from private.deletion_requests where id=current_setting('deletion.id')::uuid),'Unused deletion fixture','original metadata recoverable in private evidence');
select set_config('deletion.refrequest',pg_temp.deletion_request('STRATEGY','cccccccc-cccc-4ccc-8ccc-cccccccccccc','1')::text,true);
select set_config('deletion.refid',private.application_deletion_write(current_setting('deletion.refrequest')::jsonb)->'request'->>'requestId',true);
select set_config('request.jwt.claims',current_setting('deletion.browser'),true);
select is(private.application_deletion_write(pg_temp.deletion_decide(current_setting('deletion.refid')::uuid))->'request'->>'status','APPROVED','referenced target action can be explicitly reviewed');
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
select is(private.application_deletion_write(jsonb_build_object('action','EXECUTE','operationId',current_setting('deletion.refrequest')::jsonb->>'executionOperationId','requestId',current_setting('deletion.refid')))->'request'->>'status','ARCHIVED','referenced configuration archives rather than cascade deleting');
select ok(exists(select 1 from public.setups where id='99999999-9999-4999-8999-999999999999'),'dependent setup survives');
select ok((select archived_at is not null and not active from public.strategies where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),'canonical archive state preserved');
insert into public.tags(id,user_id,name) values('77777777-7777-4777-8777-777777777777',auth.uid(),'Expired deletion fixture');
select set_config('deletion.expired',private.application_deletion_write(pg_temp.deletion_request('TAG','77777777-7777-4777-8777-777777777777','1'))->'request'->>'requestId',true);
update private.deletion_requests set expires_at=clock_timestamp()-interval '1 second' where id=current_setting('deletion.expired')::uuid;
select is(private.application_deletion_read(jsonb_build_object('action','STATUS','requestId',current_setting('deletion.expired')))->>'status','EXPIRED','expiry explicit, never implicit approval');
select set_config('request.jwt.claims',current_setting('deletion.browser'),true);
select throws_ok($$select private.application_deletion_write(pg_temp.deletion_decide(current_setting('deletion.expired')::uuid))$$,'23514','Deletion approval unavailable.','expired approval rejected');
select is(private.application_deletion_write(pg_temp.deletion_decide(current_setting('deletion.expired')::uuid,'REJECT',false))->'request'->>'status','REJECTED','owner may reject expired pending intent without approving it');
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
-- History without a live FK still forbids destructive removal. In particular,
-- an audit without an entity label must not disappear through SQL NULL logic.
select is(private.application_deletion_read('{"action":"INSPECT","entity":"SETUP","id":"99999999-9999-4999-8999-999999999999"}')->>'effect','DELETE','unreferenced setup has no dependency on its own parent');
select private.application_record_operation(jsonb_build_object('operationId',gen_random_uuid()),'FIXTURE_HISTORY','{}',
  jsonb_build_object('tradeId',gen_random_uuid()),jsonb_build_object('previousSetup','99999999-9999-4999-8999-999999999999'));
select is(private.application_deletion_read('{"action":"INSPECT","entity":"SETUP","id":"99999999-9999-4999-8999-999999999999"}')->>'effect','ARCHIVE','unlabelled historical audit alone preserves previous setup');
insert into auth.sessions(id,user_id,created_at,updated_at) values('33333333-3333-4333-8333-333333333333','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now(),now());
select set_config('request.jwt.claims',jsonb_build_object('sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd','role','authenticated',
  'session_id','33333333-3333-4333-8333-333333333333','exp',extract(epoch from clock_timestamp())+3600)::text,true);
select throws_ok($$select private.application_deletion_read(jsonb_build_object('action','STATUS','requestId',current_setting('deletion.id')))$$,'P0002','Deletion request unavailable.','another owner cannot inspect a known request ID');
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
select throws_ok($$select private.application_deletion_write(pg_temp.deletion_request('INSTRUMENT',(select id from public.instruments where user_id is null limit 1),'1'))$$,'P0002','Deletion target unavailable.','global instruments are not owned deletion targets');
-- SQL verifies metadata/job safety only. Native SDK fixture separately proves
-- physical Storage API removal; no SQL deletion of Storage rows is a purge test.
insert into public.trading_accounts(id,user_id,name,account_type,currency_code,currency_precision,starting_balance)
values('44444444-4444-4444-8444-444444444444',auth.uid(),'Deletion screenshot account','DEMO','USD',2,1000);
insert into public.trades(id,user_id,account_id,instrument_id,direction,status)
values('55555555-5555-4555-8555-555555555555',auth.uid(),'44444444-4444-4444-8444-444444444444',(select id from public.instruments where symbol='EURUSD' and user_id is null),'BUY','DRAFT');
select set_config('deletion.path',auth.uid()::text||'/55555555-5555-4555-8555-555555555555/fixture.png',true);
insert into storage.objects(bucket_id,name,owner_id,metadata) values('trade-screenshots',current_setting('deletion.path'),auth.uid()::text,'{"mimetype":"image/png","size":100}');
insert into public.trade_screenshots(id,user_id,trade_id,category,storage_path)
values('66666666-6666-4666-8666-666666666666',auth.uid(),'55555555-5555-4555-8555-555555555555','AT_ENTRY',current_setting('deletion.path'));
select set_config('deletion.filetarget',private.application_deletion_read('{"action":"INSPECT","entity":"SCREENSHOT","id":"66666666-6666-4666-8666-666666666666"}')::text,true);
select is(length(current_setting('deletion.filetarget')::jsonb->>'version'),64,'screenshot fingerprint includes Storage revision');
select set_config('deletion.filerequest',pg_temp.deletion_request('SCREENSHOT','66666666-6666-4666-8666-666666666666',current_setting('deletion.filetarget')::jsonb->>'version')::text,true);
select set_config('deletion.fileid',private.application_deletion_write(current_setting('deletion.filerequest')::jsonb)->'request'->>'requestId',true);
select set_config('request.jwt.claims',current_setting('deletion.browser'),true);
select private.application_deletion_write(pg_temp.deletion_decide(current_setting('deletion.fileid')::uuid));
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
select set_config('deletion.fileexecute',jsonb_build_object('action','EXECUTE','operationId',current_setting('deletion.filerequest')::jsonb->>'executionOperationId','requestId',current_setting('deletion.fileid'))::text,true);
select is(private.application_deletion_write(current_setting('deletion.fileexecute')::jsonb)->'request'->>'status','PURGE_PENDING','logical screenshot deletion does not claim physical completion');
select ok(not exists(select 1 from public.trade_screenshots where id='66666666-6666-4666-8666-666666666666'),'pending screenshot excluded from application reads');
select is((select count(*)::int from storage.objects where name=current_setting('deletion.path')),1,'database workflow alone never deletes Storage metadata or bytes');
select throws_ok($$select private.application_deletion_write(jsonb_build_object('action','SETTLE','requestId',current_setting('deletion.fileid'),'operationId',(select settle_operation_id from private.deletion_requests where id=current_setting('deletion.fileid')::uuid)))$$,'23514','File purge not confirmed.','settlement cannot complete while approved object remains');
select throws_ok($$update private.deletion_objects set path='outside' where request_id=current_setting('deletion.fileid')::uuid$$,'42501',null,'frozen purge paths cannot be rewritten');
select throws_ok($$delete from private.deletion_objects where request_id=current_setting('deletion.fileid')::uuid$$,'42501',null,'frozen purge evidence cannot be deleted');
select set_config('request.jwt.claims',current_setting('deletion.browser'),true);
set local role authenticated;
select is((select count(*)::int from storage.objects where name=current_setting('deletion.path')),0,'retired file cannot get new authenticated Storage reads');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values('trade-screenshots',current_setting('deletion.path'),auth.uid()::text)$$,'42501',null,'retired exact file cannot be reuploaded');
select throws_ok($$insert into public.trade_screenshots(user_id,trade_id,category,storage_path) values(auth.uid(),'55555555-5555-4555-8555-555555555555','AT_ENTRY',current_setting('deletion.path'))$$,'42501','Approved file identity is retired.','normal metadata insertion cannot resurrect retired attachment');
reset role;
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('12121212-1212-4212-8212-121212121212','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_grants(id,owner_id,client_id,purpose,resource,authorization_id,status)
values('14141414-1414-4414-8414-141414141414',auth.uid(),'12121212-1212-4212-8212-121212121212','MCP','https://trade.example/mcp','other-deletion-client','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('13131313-1313-4313-8313-131313131313',auth.uid(),'12121212-1212-4212-8212-121212121212',now(),now());
insert into auth.oauth_consents(id,user_id,client_id,scopes) values(gen_random_uuid(),auth.uid(),'12121212-1212-4212-8212-121212121212','email');
select set_config('request.jwt.claims',(current_setting('deletion.mcp')::jsonb||jsonb_build_object('client_id','12121212-1212-4212-8212-121212121212',
  'session_id','13131313-1313-4313-8313-131313131313','trade_os_grant_id','14141414-1414-4414-8414-141414141414'))::text,true);
select throws_ok($$select private.application_deletion_read(jsonb_build_object('action','STATUS','requestId',current_setting('deletion.id')))$$,'42501','Deletion access denied.','another authorized client of the same owner cannot read bound approval');
select throws_ok($$select private.application_deletion_write(current_setting('deletion.execute')::jsonb)$$,'42501','Deletion access denied.','another authorized client cannot reuse a consumed execution receipt');
select set_config('request.jwt.claims',current_setting('deletion.mcp'),true);
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_deletion_write(current_setting('deletion.execute')::jsonb)$$,'42501','Integration access denied.','revocation blocks even a committed deletion receipt replay');
select * from finish();
rollback;
