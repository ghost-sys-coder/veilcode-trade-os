begin;
create extension if not exists pgtap with schema extensions;
select plan(48);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-other@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true) on conflict(purpose) do update set resource=excluded.resource,enabled=excluded.enabled;
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP',null,'https://trade.example/mcp','mcp-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp()),
('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',null,clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('mcp.fixture.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
 'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
select set_config('request.jwt.claims',current_setting('mcp.fixture.claims'),true);
select is(private.application_actor()->>'actorType','MCP','verified MCP uses a live, account-unbound actor');
set local role authenticated;
select is((select count(*)::integer from public.strategies),0,'MCP still cannot read configuration tables directly');
reset role;
select ok(not has_function_privilege('authenticated','private.configuration_write(jsonb)','EXECUTE'),'OAuth cannot call the private writer');
select ok(not has_function_privilege('anon','private.configuration_read(jsonb)','EXECUTE'),'anonymous callers cannot call private reads');
select ok(not has_function_privilege('service_role','private.configuration_write(jsonb)','EXECUTE'),'service-role API tokens cannot call the writer');
select is(private.configuration_read('{"entity":"STRATEGY","limit":1,"includeArchived":false}')->'records'->0->>'user_id',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','private pages are owner-scoped');
select ok(private.configuration_read('{"entity":"STRATEGY","limit":1,"includeArchived":false}')->>'nextCursor' is not null,'bounded pages expose a continuation cursor');
select throws_ok($$select private.configuration_read('{"entity":"STRATEGY","limit":101,"includeArchived":false}')$$,'22023','Invalid configuration query.','unbounded pages rejected');
select throws_ok($$select private.configuration_read('{"entity":"profiles","limit":10,"includeArchived":false}')$$,'22023','Invalid configuration entity.','entity names cannot choose SQL tables');
select set_config('mcp.fixture.create','{"entity":"STRATEGY","action":"CREATE","operationId":"00000000-0000-4000-8000-000000000001","values":{"name":"MCP strategy","description":"Initial plan","active":true}}',true);
select set_config('mcp.fixture.result',private.configuration_write(current_setting('mcp.fixture.create')::jsonb)::text,true);
select set_config('mcp.fixture.strategy',current_setting('mcp.fixture.result')::jsonb->'record'->>'id',true);
select is(current_setting('mcp.fixture.result')::jsonb->'record'->>'record_version','1','creation returns an explicit string version');
select is(jsonb_typeof(current_setting('mcp.fixture.result')::jsonb->'record'->'record_version'),'string','wire versions never become floating-point numbers');
select is(private.configuration_write(current_setting('mcp.fixture.create')::jsonb),current_setting('mcp.fixture.result')::jsonb,'lost-ack retry returns the identical result');
select is((select count(*)::integer from private.application_operations),1,'retry produces one durable effect');
select is((select count(*)::integer from private.application_mutation_audits),1,'retry produces one append-only audit');
select throws_ok($$select private.configuration_write(jsonb_set(current_setting('mcp.fixture.create')::jsonb,'{values,name}','"Changed payload"'))$$,
 '23505','Operation payload conflict.','changed payload using the same operation ID rejected');
select set_config('mcp.fixture.patch',jsonb_build_object('entity','STRATEGY','action','PATCH','operationId','00000000-0000-4000-8000-000000000002',
 'id',current_setting('mcp.fixture.strategy'),'expectedVersion','1','values',jsonb_build_object('description',null))::text,true);
select is(private.configuration_write(current_setting('mcp.fixture.patch')::jsonb)->'record'->>'record_version','2','patch uses optimistic version and advances it');
select is(private.configuration_read(jsonb_build_object('entity','STRATEGY','id',current_setting('mcp.fixture.strategy')))->>'name','MCP strategy','omitted patch fields remain unchanged');
select is(private.configuration_read(jsonb_build_object('entity','STRATEGY','id',current_setting('mcp.fixture.strategy')))->'description','null'::jsonb,'explicit null clears a nullable field');
select throws_ok($$select private.configuration_write(jsonb_set(current_setting('mcp.fixture.patch')::jsonb,'{operationId}','"00000000-0000-4000-8000-000000000003"'))$$,
 '40001','Configuration version conflict.','stale edits cannot overwrite a concurrent update');
select throws_ok($$select private.configuration_write(jsonb_build_object('entity','STRATEGY','action','CREATE','operationId',gen_random_uuid(),
 'values',jsonb_build_object('name','Forged owner','description',null,'active',true,'user_id','dddddddd-dddd-4ddd-8ddd-dddddddddddd')))$$,
 '22023','Invalid configuration values.','caller-supplied owner ID rejected');
select throws_ok($$select private.configuration_write(jsonb_build_object('entity','SETUP','action','CREATE','operationId',gen_random_uuid(),
 'values',jsonb_build_object('name','Bad setup','description',null,'active',true,'strategy_id',(select id from public.strategies where user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' limit 1))))$$,
 '23514','Invalid parent strategy.','setup cannot use another owner parent');
select set_config('mcp.fixture.setup',private.configuration_write(jsonb_build_object('entity','SETUP','action','CREATE','operationId',gen_random_uuid(),
 'values',jsonb_build_object('name','MCP setup','description',null,'active',true,'strategy_id',current_setting('mcp.fixture.strategy'))))->'record'->>'id',true);
select is(private.configuration_read(jsonb_build_object('entity','SETUP','id',current_setting('mcp.fixture.setup')))->>'strategy_id',current_setting('mcp.fixture.strategy'),'setup relationship remains typed and persisted');
select set_config('mcp.fixture.rule',private.configuration_write(jsonb_build_object('entity','RULE','action','CREATE','operationId',gen_random_uuid(),
 'values',jsonb_build_object('name','MCP rule','description','Explicit decimal limit','active',true,'account_id',null,'rule_type','MAX_RISK_PERCENT','numeric_limit','0.00000001')))->'record'->>'id',true);
select is(private.configuration_read(jsonb_build_object('entity','RULE','id',current_setting('mcp.fixture.rule')))->>'numeric_limit','0.00000001','small rule limits remain exact decimal strings');
select throws_ok($$select private.configuration_write(jsonb_build_object('entity','RULE','action','CREATE','operationId',gen_random_uuid(),
 'values',jsonb_build_object('name','Numeric boundary','description','Explicit decimal limit','active',true,'account_id',null,'rule_type','MAX_RISK_PERCENT','numeric_limit',0.1)))$$,
 '23514','Invalid configuration values.','numeric JSON cannot bypass decimal-string boundaries');
select throws_ok($$select private.configuration_read(jsonb_build_object('entity','STRATEGY','id',(select id from public.strategies where user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' limit 1)))$$,
 'P0002','Configuration not found.','cross-owner record IDs do not disclose records');
select is(public.get_integration_operation('https://trade.example/mcp','MCP','00000000-0000-4000-8000-000000000001')->>'status','COMMITTED','MCP operation lookup includes shared workflow receipts');
select is(public.get_integration_operation('https://trade.example/mcp','MCP','00000000-0000-4000-8000-000000000001')->'result',current_setting('mcp.fixture.result')::jsonb,'operation status recovers the original result');

create function pg_temp.fail_config_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure.' using errcode='23514'; end;$$;
create trigger fixture_fail_config_audit before insert on private.application_mutation_audits for each row execute function pg_temp.fail_config_audit();
select throws_ok($$select private.configuration_write(jsonb_build_object('entity','STRATEGY','action','PATCH','operationId','00000000-0000-4000-8000-000000000004',
 'id',current_setting('mcp.fixture.strategy'),'expectedVersion','2','values',jsonb_build_object('name','Must roll back')))$$,
 '23514','Fixture audit failure.','audit failure aborts the entire command');
drop trigger fixture_fail_config_audit on private.application_mutation_audits;
select is(private.configuration_read(jsonb_build_object('entity','STRATEGY','id',current_setting('mcp.fixture.strategy')))->>'name','MCP strategy','failed audit rolls back the record update');
select is((select count(*)::integer from private.application_operations where operation_id='00000000-0000-4000-8000-000000000004'),0,'failed audit rolls back the receipt too');
select set_config('mcp.fixture.archive',jsonb_build_object('entity','STRATEGY','action','ARCHIVE','operationId',gen_random_uuid(),
 'id',current_setting('mcp.fixture.strategy'),'expectedVersion','2','reason','Retire referenced methodology')::text,true);
select is(private.configuration_write(current_setting('mcp.fixture.archive')::jsonb)->'record'->>'active','false','archival explicitly deactivates a referenced strategy');
select ok((select archived_at = updated_at from public.strategies where id=current_setting('mcp.fixture.strategy')::uuid),'strategy archive and last update share one event timestamp');
select is(private.configuration_write(current_setting('mcp.fixture.archive')::jsonb)->'record'->>'updated_at',
  private.configuration_read(jsonb_build_object('entity','STRATEGY','id',current_setting('mcp.fixture.strategy')))->>'updated_at','archive receipt retry preserves the canonical timestamp');
select ok((select (result->'record'->>'archived_at')::timestamptz = (result->'record'->>'updated_at')::timestamptz
  from private.application_operations where operation_id=(current_setting('mcp.fixture.archive')::jsonb->>'operationId')::uuid),'durable archive receipt has consistent timestamps');
select ok((select (a.changes->'after'->>'archived_at')::timestamptz = (a.changes->'after'->>'updated_at')::timestamptz
  from private.application_mutation_audits a join private.application_operations o on o.id=a.operation_receipt_id
  where o.operation_id=(current_setting('mcp.fixture.archive')::jsonb->>'operationId')::uuid),'append-only archive audit captures the same consistent timestamps');
select ok(exists(select 1 from public.setups where id=current_setting('mcp.fixture.setup')::uuid),'archival preserves dependent setup records');
select throws_ok($$select private.configuration_write(jsonb_build_object('entity','STRATEGY','action','PATCH','operationId',gen_random_uuid(),
 'id',current_setting('mcp.fixture.strategy'),'expectedVersion','3','values',jsonb_build_object('active',true)))$$,
 '23514','Configuration is archived.','casual patch cannot reactivate an archived strategy');
select throws_ok($$delete from private.application_mutation_audits$$,'42501','Integration audit events are append-only.','application audit evidence is immutable');
select throws_ok($$update private.application_operations set result='{}'$$,'42501','Integration audit events are append-only.','durable receipts cannot be rewritten');

-- Same writer, same versions, browser session verified independently from MCP.
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'session_id','22222222-2222-4222-8222-222222222222','exp',extract(epoch from clock_timestamp())+3600)::text,true);
select is(private.application_actor()->>'actorType','BROWSER','direct browser uses a distinct verified actor');
select lives_ok($$select private.configuration_write(jsonb_build_object('entity','RULE','action','PATCH','operationId',gen_random_uuid(),
 'id',current_setting('mcp.fixture.rule'),'expectedVersion','1','values',jsonb_build_object('name','Browser and MCP share writer')))$$,'browser adapter shares the typed transactional writer');
select lives_ok($$select private.configuration_write(jsonb_build_object('entity','RULE','action','ARCHIVE','operationId',gen_random_uuid(),
 'id',current_setting('mcp.fixture.rule'),'expectedVersion','2','reason','Archive browser verification rule'))$$,'browser rule archive uses the same timestamp convention');
select ok((select archived_at = updated_at from public.trading_rules where id=current_setting('mcp.fixture.rule')::uuid),'rule archive and last update share one event timestamp');
-- A setup may still be archived after its parent strategy was archived.
select set_config('request.jwt.claims',current_setting('mcp.fixture.claims'),true);
select private.configuration_write(jsonb_build_object('entity','SETUP','action','ARCHIVE','operationId',gen_random_uuid(),
 'id',current_setting('mcp.fixture.setup'),'expectedVersion','1','reason','Archive setup verification fixture'));
select ok((select archived_at = updated_at from public.setups where id=current_setting('mcp.fixture.setup')::uuid),'setup archive and last update share one event timestamp');
select set_config('request.jwt.claims',current_setting('mcp.fixture.claims'),true);
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.configuration_read('{"entity":"RULE","limit":10,"includeArchived":false}')$$,
 '42501','Integration access denied.','revocation blocks private reads immediately');
select throws_ok($$select private.configuration_write(current_setting('mcp.fixture.create')::jsonb)$$,
 '42501','Integration access denied.','revocation blocks even an idempotent receipt retry');
grant execute on function private.configuration_read(jsonb),private.application_actor() to authenticated;
set local role authenticated;
select throws_ok($$select private.configuration_read('{"entity":"RULE","limit":10,"includeArchived":false}')$$,
 '42501','Application access denied.','server-role check fails closed even if a function grant is accidentally added');
reset role;
-- Callers without an archive column keep the original update convention.
create temporary table ordinary_update_fixture(updated_at timestamptz not null);
create trigger ordinary_update_fixture_set_updated_at before update on ordinary_update_fixture
  for each row execute function private.set_updated_at();
insert into ordinary_update_fixture values(clock_timestamp());
update ordinary_update_fixture set updated_at=clock_timestamp();
select is((select updated_at from ordinary_update_fixture),now(),'non-archive trigger callers retain transaction-start timestamps');
select * from finish();
rollback;
