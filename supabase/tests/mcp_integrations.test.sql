begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','integration-other@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
select id::uuid,'manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none' from unnest(array[
'ffffffff-ffff-4fff-8fff-ffffffffffff','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']) id;
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://trade.example/api/integrations/v1',true),('MCP','https://trade.example/mcp',true) on conflict(purpose) do update set resource=excluded.resource,enabled=excluded.enabled;
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',
'MT5',id,'https://trade.example/api/integrations/v1','mt5-integration-fixture','ACTIVE' from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('99999999-9999-4999-8999-999999999999','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','MCP',null,'https://trade.example/mcp','mcp-integration-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at) values
('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now(),now()),
('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',null,now(),now()),
('33333333-3333-4333-8333-333333333333','dddddddd-dddd-4ddd-8ddd-dddddddddddd',null,now(),now());
insert into auth.oauth_consents(id,user_id,client_id,scopes) values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','email');
insert into private.mt5_connections(id,owner_id,account_id,grant_id,identity,capture_checkpoint)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',owner_id,account_id,id,
'{"server":"Broker-Demo","login":"9007199254740993","terminalInstallationId":"44444444-4444-4444-8444-444444444444","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"HEDGING"}',
'2026-01-03T00:00:00Z' from private.integration_grants where purpose='MT5';
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','DEAL',ticket,'2026-01-03T00:00:00Z',
jsonb_build_object('ticket',ticket,'positionId','100','orderId',ticket,'symbol','EURUSD','type',case when ticket='10' then 'BUY' else 'SELL' end,
'entry',case when ticket='10' then 'IN' else 'OUT' end,'volume','1','price','1.1','occurredAt',case when ticket='10' then '2026-01-01T00:00:00Z' else '2026-01-02T00:00:00Z' end,
'profit',case when ticket='10' then '0' else '100' end,'commission','-2','swap','0','fee','0'),repeat('a',64),1,gen_random_uuid() from unnest(array['10','9007199254740993']) ticket;
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at,requires_review)
select connection_id,kind,source_id,id,observed_at,true from private.mt5_source_revisions;
insert into public.import_batches(id,user_id,account_id,source_type,status,error_summary)
select '77777777-7777-4777-8777-777777777777',user_id,id,'CSV','FAILED','Fixture validation error' from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into public.import_batch_rows(id,user_id,batch_id,row_number,external_trade_id,raw_data,validation_errors)
values('88888888-8888-4888-8888-888888888888','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','77777777-7777-4777-8777-777777777777',1,'9007199254740993','{"net_pnl":"0.01"}','["Fixture issue"]');
select set_config('integration.mcp.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','client_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
'session_id','11111111-1111-4111-8111-111111111111','exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
'trade_os_grant_id','99999999-9999-4999-8999-999999999999','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
select set_config('request.jwt.claims',current_setting('integration.mcp.claims'),true);
select is(jsonb_array_length(private.application_integration_read('{"action":"MT5_LIST","limit":1}')->'records'),1,'MCP lists only owned connections');
select is(private.application_integration_read('{"action":"MT5_GET","connectionId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}')->'identity'->>'login','9007199254740993','broker login never loses precision');
select is(jsonb_array_length(private.application_integration_read('{"action":"MT5_SNAPSHOT","connectionId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}')->'page'->'events'),2,'full snapshot includes all source facts');
select ok(private.application_integration_read('{"action":"MT5_SOURCES","connectionId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","limit":1}')->>'nextCursor' is not null,'source revisions paginate');
select is(private.application_integration_read('{"action":"MT5_SOURCES","connectionId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","sourceId":"9007199254740993"}')->'records'->0->>'sourceId','9007199254740993','source tickets remain strings');
select is(private.application_integration_read('{"action":"IMPORT_LIST"}')->'records'->0->>'error_summary','Fixture validation error','failed imports/errors retained');
select is(private.application_integration_read('{"action":"IMPORT_ROWS","batchId":"77777777-7777-4777-8777-777777777777"}')->'records'->0->>'external_trade_id','9007199254740993','staged source IDs remain strings');
select throws_ok($$select private.application_integration_read('{"action":"MT5_GET","connectionId":"77777777-7777-4777-8777-777777777777"}')$$,'P0002',null,'unknown connection rejected');
select throws_ok($$select private.application_integration_read('{"action":"MT5_LIST","limit":101}')$$,'22023',null,'database enforces bounded pages');
select throws_ok($$select private.application_integration_read('{"action":"IMPORT_LIST","ownerId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}')$$,'22023',null,'caller cannot supply owner');
select ok(not has_function_privilege('authenticated','private.application_integration_read(jsonb)','EXECUTE'),'no Data API access to private reader');
select ok(not has_function_privilege('service_role','private.application_mt5_review_write(jsonb,jsonb)','EXECUTE'),'service key cannot invoke private writer');
set local role authenticated;
select throws_ok($$select public.mt5_list_connections()$$,'42501',null,'legacy browser RPC still rejects OAuth');
select is((select count(*)::integer from public.import_batches),0,'MCP still cannot read import tables directly');
reset role;
create function pg_temp.integration_review(op uuid default gen_random_uuid()) returns jsonb language sql as $$
select jsonb_build_object('connectionId',c.id,'version',c.version::text,'operationId',op,'snapshotToken',private.mt5_source_snapshot_token(c.id),
'ledgerToken',private.mt5_account_ledger_token(c.account_id),'reason','Verify corrected source evidence','reviewKind','SOURCE','sourceKind','DEAL',
'sourceId','10','sourceRevisionId',f.current_revision_id::text) from private.mt5_connections c join private.mt5_source_facts f on f.connection_id=c.id and f.source_id='10';$$;
select set_config('integration.command',pg_temp.integration_review('00000000-0000-4000-8000-000000000090')::text,true);
select lives_ok($$select private.application_mt5_review_prepare(current_setting('integration.command')::jsonb)$$,'verified MCP prepares source review');
select set_config('integration.result',private.application_mt5_review_write(current_setting('integration.command')::jsonb,'{}')::text,true);
select is(current_setting('integration.result')::jsonb->>'version','2','review advances connection version');
select is((select requires_review from private.mt5_source_facts where source_id='10'),false,'source review applies exactly once');
select is(private.application_mt5_review_prepare(current_setting('integration.command')::jsonb)->'receipt',current_setting('integration.result')::jsonb,'lost acknowledgement replay recovers original receipt');
select is((select count(*)::integer from private.integration_mutation_audits where changes->>'actorType'='MCP'),1,'actual MCP actor audited');
select is((select client_id::text from private.integration_operations where operation_id='00000000-0000-4000-8000-000000000090'),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','receipt belongs to MCP client, not worker');
select is(public.get_integration_operation('https://trade.example/mcp','MCP','00000000-0000-4000-8000-000000000090')->>'status','COMMITTED','normal operation lookup recovers MT5 review');
select throws_ok($$select private.application_mt5_review_prepare(jsonb_set(current_setting('integration.command')::jsonb,'{reason}','"Changed retry payload"'))$$,'23505',null,'changed-payload retry rejected');
select throws_ok($$select private.application_mt5_review_prepare(jsonb_set(current_setting('integration.command')::jsonb,'{operationId}',to_jsonb(gen_random_uuid())))$$,'40001',null,'stale review rejected');
select throws_ok($$select private.mt5_review_request(current_setting('integration.command')::jsonb,'{}')$$,'42501',null,'old private review name still browser-only');
select throws_ok($$select private.mt5_publication_actor(jsonb_build_object('connectionId','cccccccc-cccc-4ccc-8ccc-cccccccccccc'))$$,'42501',null,'MCP cannot enter automatic publication');
select throws_ok($$select private.authorize_integration('https://trade.example/api/integrations/v1','MT5')$$,'42501',null,'MCP token cannot become collector');
select set_config('integration.fail.command',((pg_temp.integration_review()-'sourceId'-'sourceRevisionId')||jsonb_build_object('sourceId','9007199254740993','sourceRevisionId',(select current_revision_id::text from private.mt5_source_facts where source_id='9007199254740993')))::text,true);
-- Cast the setting explicitly; no monetary or identifier numbers are parsed in JS.
create function pg_temp.fail_integration_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure.' using errcode='23514';end;$$;
create trigger fixture_integration_audit before insert on private.integration_mutation_audits for each row execute function pg_temp.fail_integration_audit();
select throws_ok($$select private.application_mt5_review_write(current_setting('integration.fail.command')::jsonb,'{}')$$,'23514',null,'audit failure aborts review');
drop trigger fixture_integration_audit on private.integration_mutation_audits;
select is((select requires_review from private.mt5_source_facts where source_id='9007199254740993'),true,'audit failure rolls back fact update');
select is((select version::text from private.mt5_connections),'2','audit failure rolls back connection version');
select is((select count(*)::integer from private.mt5_review_events),1,'audit failure rolls back review event');
-- A reviewed correction to an already classified cash fact appends only its delta.
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','DEAL','99','2026-01-03T00:00:00Z',
jsonb_build_object('ticket','99','positionId',null,'type','BALANCE','profit',amount,'commission','0','swap','0','fee','0','occurredAt','2026-01-02T00:00:00Z'),repeat('a',64),1,gen_random_uuid()
from unnest(array['10','12.005']) amount;
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,max(id),max(observed_at) from private.mt5_source_revisions where source_id='99' group by connection_id,kind,source_id;
insert into public.account_adjustments(id,user_id,account_id,type,amount,occurred_at)
select '66666666-6666-4666-8666-666666666666',owner_id,account_id,'DEPOSIT',10,'2026-01-02T00:00:00Z' from private.mt5_connections;
insert into private.mt5_cash_decisions(connection_id,source_ticket,source_revision_id,disposition,amount,adjustment_id,actor_user_id,operation_id,reason)
select c.id,'99',(select min(id) from private.mt5_source_revisions where source_id='99'),'ADJUSTMENT',10,
'66666666-6666-4666-8666-666666666666',c.owner_id,gen_random_uuid(),'Original verified funding classification' from private.mt5_connections c;
select set_config('integration.cash.command',((pg_temp.integration_review()-array['sourceKind','sourceId','sourceRevisionId'])||jsonb_build_object(
'reviewKind','CASH','sourceId','99','sourceRevisionId',(select current_revision_id::text from private.mt5_source_facts where source_id='99'),'isPerformanceNeutral',true))::text,true);
select lives_ok($$select private.application_mt5_review_prepare(current_setting('integration.cash.command')::jsonb)$$,'MCP prepares reviewed cash reconciliation');
select throws_ok($$select private.application_mt5_review_write(current_setting('integration.cash.command')::jsonb,'{"amount":"999"}')$$,'23514',null,'invented cash amount rejected');
select is((select count(*)::integer from public.account_adjustments),1,'rejected cash reconciliation has no partial adjustment');
select lives_ok($$select private.application_mt5_review_write(current_setting('integration.cash.command')::jsonb,'{"amount":"12.01"}')$$,'MCP reconciles exact normalized source amount');
select is((select amount from public.account_adjustments where type='OTHER'),2.01::numeric,'only corrected-source delta affects ledger');
select is((select is_performance_neutral from public.account_adjustments where type='OTHER'),true,'explicit cash classification retained');
select is((select amount from private.mt5_cash_decisions),10::numeric,'original classified cash evidence unchanged');
select lives_ok($$select private.application_mt5_review_write(current_setting('integration.cash.command')::jsonb,'{"amount":"12.01"}')$$,'cash retry recovers receipt despite changed ledger');
select is((select count(*)::integer from public.account_adjustments),2,'cash retry never repeats delta');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where purpose='MT5';
select throws_ok($$select private.application_mt5_review_prepare(pg_temp.integration_review())$$,'42501',null,'revoked collector grant blocks new mutations');
select lives_ok($$select private.application_integration_read('{"action":"MT5_LIST"}')$$,'retained read evidence does not reactivate worker');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where purpose='MCP';
select throws_ok($$select private.application_integration_read('{"action":"MT5_LIST"}')$$,'42501',null,'MCP revocation takes effect immediately');
select set_config('request.jwt.claims',jsonb_build_object('sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd','role','authenticated','session_id','33333333-3333-4333-8333-333333333333','exp',extract(epoch from now())+3600)::text,true);
select is(jsonb_array_length(private.application_integration_read('{"action":"MT5_LIST"}')->'records'),0,'other owner cannot list connections');
select throws_ok($$select private.application_integration_read('{"action":"MT5_GET","connectionId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}')$$,'P0002',null,'other owner cannot access connection');
select throws_ok($$select private.application_integration_read('{"action":"IMPORT_GET","batchId":"77777777-7777-4777-8777-777777777777"}')$$,'P0002',null,'other owner cannot access import');
select throws_ok($$select private.application_integration_read('{"action":"IMPORT_ROWS","batchId":"77777777-7777-4777-8777-777777777777"}')$$,'P0002',null,'other owner cannot access staged rows');
select * from finish();
rollback;
