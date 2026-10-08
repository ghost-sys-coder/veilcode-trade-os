begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reference-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reference-other@example.test','fixture-only','{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now(),now());
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','session_id','22222222-2222-4222-8222-222222222222','exp',extract(epoch from clock_timestamp())+3600)::text,true);
insert into public.trading_accounts(id,user_id,name,account_type,currency_code,currency_precision,starting_balance,started_at)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Reference fixture','DEMO','USD',2,100000,'2026-10-01');
insert into public.instruments(id,user_id,symbol,display_name,asset_class,price_precision)
values('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd','OTHERm','Other owner instrument','FOREX',5);
select throws_ok($$select private.application_reference_read('{"entity":"INSTRUMENT","id":"99999999-9999-4999-8999-999999999999"}')$$,'P0002','Reference not found.','other owner instrument is not readable');
select throws_ok($$select private.application_reference_write('{"entity":"INSTRUMENT","action":"PATCH","operationId":"00000000-0000-4000-8000-000000000098","id":"99999999-9999-4999-8999-999999999999","expectedVersion":"1","values":{"display_name":"Unauthorized edit"}}')$$,'P0002','Reference not found.','other owner instrument is not writable');
select ok(not has_function_privilege('anon','private.application_reference_read(jsonb)','EXECUTE'),'anonymous private reads denied');
select ok(not has_function_privilege('authenticated','private.application_reference_write(jsonb)','EXECUTE'),'browser/OAuth direct RPC writes denied');
select ok(not has_function_privilege('service_role','private.application_trade_tag_write(jsonb)','EXECUTE'),'service API key cannot invoke tag workflow');
select throws_ok($$select private.application_reference_read('{"entity":"profiles","limit":1,"includeArchived":false}')$$,'22023','Invalid reference entity.','table names cannot be injected');
select throws_ok($$select private.application_reference_read('{"entity":"TAG","limit":101,"includeArchived":false}')$$,'22023','Invalid reference query.','pages bounded');
select throws_ok($$select private.application_reference_read('{"entity":"TAG","limit":1,"includeArchived":false,"user_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}')$$,'22023','Invalid reference query.','owner query injection denied');
select set_config('ref.create','{"entity":"TAG","action":"CREATE","operationId":"00000000-0000-4000-8000-000000000001","values":{"name":" FOMO ","color":"#aabbcc"}}',true);
select set_config('ref.result',private.application_reference_write(current_setting('ref.create')::jsonb)::text,true);
select set_config('ref.tag',current_setting('ref.result')::jsonb->'record'->>'id',true);
select is(current_setting('ref.result')::jsonb->'record'->>'name','FOMO','friendly display form trimmed, not lowercased');
select is(current_setting('ref.result')::jsonb->'record'->>'normalized_name','fomo','normalized uniqueness remains DB generated');
select is(current_setting('ref.result')::jsonb->'record'->>'record_version','1','string version returned');
select is(private.application_reference_write(current_setting('ref.create')::jsonb),current_setting('ref.result')::jsonb,'lost-ack replay identical');
select is((select count(*)::integer from private.application_operations),1,'one receipt for replays');
select is((select count(*)::integer from private.application_mutation_audits),1,'one immutable audit for replays');
select throws_ok($$select private.application_reference_write(jsonb_set(current_setting('ref.create')::jsonb,'{values,name}','"Fear"'))$$,'23505','Operation payload conflict.','changed replay payload denied');
select throws_ok($$select private.application_reference_write(jsonb_set(current_setting('ref.create')::jsonb,'{operationId}',to_jsonb(gen_random_uuid()))||jsonb_build_object('values',jsonb_build_object('name','fOmO','color',null)))$$,'23505',null,'same owner case variant rejected');
insert into public.tags(user_id,name) values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','fomo');
select is((private.application_reference_read('{"entity":"TAG","limit":1,"includeArchived":false}')->'records'->0->>'id'),current_setting('ref.tag'),'other owner tags excluded');
select throws_ok($$select private.application_reference_read(jsonb_build_object('entity','TAG','id',(select id from public.tags where user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' limit 1)))$$,'P0002','Reference not found.','cross-owner tag get denied');
select is(private.application_reference_write(jsonb_build_object('entity','TAG','action','PATCH','operationId',gen_random_uuid(),'id',current_setting('ref.tag'),'expectedVersion','1','values',jsonb_build_object('color',null)))->'record'->>'record_version','2','nullable clearing bumps tag version');
select is(private.application_reference_read(jsonb_build_object('entity','TAG','id',current_setting('ref.tag')))->>'name','FOMO','omitted name unchanged');
select is(private.application_reference_read(jsonb_build_object('entity','TAG','id',current_setting('ref.tag')))->'color','null'::jsonb,'color explicitly cleared');
select throws_ok($$select private.application_reference_write(jsonb_build_object('entity','TAG','action','PATCH','operationId',gen_random_uuid(),'id',current_setting('ref.tag'),'expectedVersion','1','values',jsonb_build_object('name','Stale edit')))$$,'40001','Reference version conflict.','stale edit rejected');
select throws_ok($$select private.application_reference_write(jsonb_build_object('entity','TAG','action','CREATE','operationId',gen_random_uuid(),'values',jsonb_build_object('name','Forged owner','color',null,'user_id','dddddddd-dddd-4ddd-8ddd-dddddddddddd')))$$,'22023','Invalid reference values.','owner in values rejected');
select set_config('ref.instrument.command',jsonb_build_object('entity','INSTRUMENT','action','CREATE','operationId',gen_random_uuid(),'values',jsonb_build_object('symbol','TESTm','display_name','Owned fixture','asset_class','FOREX','base_currency','EUR','quote_currency','USD','pip_size','0.0000000001','price_precision',10,'active',true))::text,true);
select set_config('ref.instrument',private.application_reference_write(current_setting('ref.instrument.command')::jsonb)->'record'->>'id',true);
select is(private.application_reference_read(jsonb_build_object('entity','INSTRUMENT','id',current_setting('ref.instrument')))->>'pip_size','0.0000000001','10-place pip size preserved independent of account precision');
select is(jsonb_typeof(private.application_reference_read(jsonb_build_object('entity','INSTRUMENT','id',current_setting('ref.instrument')))->'pip_size'),'string','pip numeric wire is string');
select throws_ok($$select private.application_reference_write(jsonb_set(jsonb_set(current_setting('ref.instrument.command')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())),'{values,pip_size}','0.0001'))$$,'22023','Invalid reference values.','numeric JSON pip size rejected');
select throws_ok($$select private.application_reference_write(jsonb_set(jsonb_set(current_setting('ref.instrument.command')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())),'{values,pip_size}','"0.00000000001"'))$$,'22023','Invalid reference values.','pip precision overflow rejected, not rounded');
select throws_ok($$select private.application_reference_write(jsonb_set(jsonb_set(current_setting('ref.instrument.command')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())),'{values,pip_size}','"0"'))$$,'22023','Invalid reference values.','zero pip rejected');
select set_config('ref.global',(select id::text from public.instruments where user_id is null order by id limit 1),true);
select lives_ok($$select private.application_reference_read(jsonb_build_object('entity','INSTRUMENT','id',current_setting('ref.global')))$$,'global instrument readable');
select throws_ok($$select private.application_reference_write(jsonb_build_object('entity','INSTRUMENT','action','PATCH','operationId',gen_random_uuid(),'id',current_setting('ref.global'),'expectedVersion','1','values',jsonb_build_object('display_name','Forbidden edit')))$$,'P0002','Reference not found.','global patch denied');
select throws_ok($$select private.application_reference_write(jsonb_build_object('entity','INSTRUMENT','action','ARCHIVE','operationId',gen_random_uuid(),'id',current_setting('ref.global'),'expectedVersion','1','reason','Forbidden archival'))$$,'P0002','Reference not found.','global archive denied');
select lives_ok($$select private.application_reference_write(jsonb_build_object('entity','INSTRUMENT','action','PATCH','operationId',gen_random_uuid(),'id',current_setting('ref.instrument'),'expectedVersion','1','values',jsonb_build_object('pip_size','0.0001')))$$,'unused owned specifications editable');
insert into public.trades(id,user_id,account_id,instrument_id,status,direction)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',current_setting('ref.instrument')::uuid,'DRAFT','BUY');
select throws_ok($$select private.application_reference_write(jsonb_build_object('entity','INSTRUMENT','action','PATCH','operationId',gen_random_uuid(),'id',current_setting('ref.instrument'),'expectedVersion','2','values',jsonb_build_object('pip_size','0.01')))$$,'23514','Referenced instrument specifications are immutable.','referenced specifications protected');
select throws_ok($$update public.instruments set price_precision=2 where id=current_setting('ref.instrument')::uuid$$,'23514','Referenced instrument specifications are immutable.','direct update cannot bypass history protection');
select lives_ok($$select private.application_reference_write(jsonb_build_object('entity','INSTRUMENT','action','PATCH','operationId',gen_random_uuid(),'id',current_setting('ref.instrument'),'expectedVersion','2','values',jsonb_build_object('display_name','Improved display label')))$$,'referenced display label remains editable');
select set_config('ref.link',jsonb_build_object('action','ASSIGN','operationId','00000000-0000-4000-8000-000000000002','tradeId','cccccccc-cccc-4ccc-8ccc-cccccccccccc','tagId',current_setting('ref.tag'),'expectedVersion','1','expectedTagVersion','2')::text,true);
select set_config('ref.link.result',private.application_trade_tag_write(current_setting('ref.link')::jsonb)::text,true);
select throws_ok($$select private.application_trade_tag_write(jsonb_set(jsonb_set(current_setting('ref.link')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())),'{tradeId}','"dddddddd-dddd-4ddd-8ddd-dddddddddddd"'))$$,'P0002','Trade not found.','unknown/unowned trade cannot receive tags');
select is(current_setting('ref.link.result')::jsonb->>'tradeVersion','2','tag assignment participates in canonical concurrency');
select is(private.application_trade_tag_write(current_setting('ref.link')::jsonb),current_setting('ref.link.result')::jsonb,'tag link replay identical');
select is((select count(*)::integer from public.trade_tags),1,'one association after replay');
select is(private.application_reference_read('{"entity":"TAG","tradeId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","limit":10,"includeArchived":true}')->'records'->0->>'id',current_setting('ref.tag'),'owned trade tag list');
select throws_ok($$select private.application_trade_tag_write(jsonb_set(current_setting('ref.link')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())))$$,'40001','Reference version conflict.','stale link write denied');
select throws_ok($$select private.application_trade_tag_write(jsonb_set(jsonb_set(current_setting('ref.link')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())),'{tagId}',to_jsonb((select id::text from public.tags where user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' limit 1))))$$,'P0002','Reference not found.','cross-owner tag cannot be assigned');
select throws_ok($$select private.application_reference_write(jsonb_build_object('entity','TAG','action','ARCHIVE','operationId',gen_random_uuid(),'id',current_setting('ref.tag'),'expectedVersion','2','reason',''))$$,'22023','Meaningful archive reason required.','archive requires meaningful reason');
select lives_ok($$select private.application_reference_write(jsonb_build_object('entity','TAG','action','ARCHIVE','operationId',gen_random_uuid(),'id',current_setting('ref.tag'),'expectedVersion','2','reason','Retire label, retain evidence'))$$,'referenced tag archives');
select is(jsonb_array_length(private.application_reference_read('{"entity":"TAG","limit":10,"includeArchived":false}')->'records'),0,'archive excluded from current library');
select is(jsonb_array_length(private.application_reference_read('{"entity":"TAG","tradeId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","limit":10,"includeArchived":true}')->'records'),1,'archived label remains on historical trade');
select throws_ok($$select private.application_trade_tag_write(jsonb_build_object('action','ASSIGN','operationId',gen_random_uuid(),'tradeId','cccccccc-cccc-4ccc-8ccc-cccccccccccc','tagId',current_setting('ref.tag'),'expectedVersion','2','expectedTagVersion','3'))$$,'23514','Tag is unavailable for assignment.','cannot assign archived tag');
select throws_ok($$update public.tags set archived_at=null where id=current_setting('ref.tag')::uuid$$,'23514','Reference is archived.','direct unarchive denied');
select is(private.application_trade_tag_write(jsonb_build_object('action','REMOVE','operationId',gen_random_uuid(),'tradeId','cccccccc-cccc-4ccc-8ccc-cccccccccccc','tagId',current_setting('ref.tag'),'expectedVersion','2','expectedTagVersion','3'))->>'tradeVersion','3','archived tag can be removed through audited workflow');
select lives_ok($$select private.application_reference_write(jsonb_build_object('entity','INSTRUMENT','action','ARCHIVE','operationId',gen_random_uuid(),'id',current_setting('ref.instrument'),'expectedVersion','3','reason','Retire referenced instrument'))$$,'referenced instrument archives without deletion');
select is((select active from public.instruments where id=current_setting('ref.instrument')::uuid),false,'archival deactivates instrument');
select is((select instrument_id::text from public.trades where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'),current_setting('ref.instrument'),'trade reference preserved');
select is(jsonb_array_length(private.application_reference_read('{"entity":"INSTRUMENT","limit":1,"includeArchived":false}')->'records'),1,'instrument page bounded');
select ok(private.application_reference_read('{"entity":"INSTRUMENT","limit":1,"includeArchived":false}')->>'nextCursor' is not null,'instrument continuation available');
create function pg_temp.fail_reference_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure.' using errcode='23514';end;$$;
create trigger fixture_reference_audit before insert on private.application_mutation_audits for each row execute function pg_temp.fail_reference_audit();
select throws_ok($$select private.application_reference_write('{"entity":"TAG","action":"CREATE","operationId":"00000000-0000-4000-8000-000000000099","values":{"name":"Must roll back","color":null}}')$$,'23514','Fixture audit failure.','audit failure aborts creation');
drop trigger fixture_reference_audit on private.application_mutation_audits;
select is((select count(*)::integer from public.tags where name='Must roll back'),0,'failed audit rolls back tag');
select is((select count(*)::integer from private.application_operations where operation_id='00000000-0000-4000-8000-000000000099'),0,'failed audit rolls back receipt');
select throws_ok($$delete from private.application_mutation_audits$$,'42501','Integration audit events are append-only.','tag/instrument audits immutable');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP',null,'https://trade.example/mcp','reference-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
 'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.tags),0,'OAuth has no direct owned tag reads');
select is((select count(*)::integer from public.instruments),0,'OAuth has no direct instrument reads');
reset role;
select set_config('ref.mcp.command','{"entity":"TAG","action":"CREATE","operationId":"00000000-0000-4000-8000-000000000090","values":{"name":"MCP reference","color":null}}',true);
select lives_ok($$select private.application_reference_write(current_setting('ref.mcp.command')::jsonb)$$,'verified MCP uses same writer');
select is((select count(*)::integer from private.application_mutation_audits where actor_type='MCP'),1,'MCP actor and client audited');
select is(public.get_integration_operation('https://trade.example/mcp','MCP','00000000-0000-4000-8000-000000000090')->>'status','COMMITTED','MCP operation lookup returns durable reference receipt');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_reference_read('{"entity":"TAG","limit":1,"includeArchived":false}')$$,'42501','Integration access denied.','revoked grant cannot read');
select throws_ok($$select private.application_reference_write(current_setting('ref.mcp.command')::jsonb)$$,'42501','Integration access denied.','revoked grant cannot replay prior result');
grant execute on function private.application_reference_read(jsonb),private.application_actor() to authenticated;
set local role authenticated;
select throws_ok($$select private.application_reference_read('{"entity":"TAG","limit":1,"includeArchived":false}')$$,'42501','Application access denied.','accidental EXECUTE grant still cannot impersonate server');
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select private.application_reference_read('{"entity":"TAG","limit":1,"includeArchived":false}')$$,'42501','Application access denied.','anonymous actor denied even on server connection');
select * from finish();
rollback;
