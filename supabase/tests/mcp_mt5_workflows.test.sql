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

update public.trading_accounts set starting_balance=1000,started_at='2026-01-01' where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
select set_config('integration.mcp.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','client_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
'session_id','11111111-1111-4111-8111-111111111111','exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
'trade_os_grant_id','99999999-9999-4999-8999-999999999999','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
select set_config('request.jwt.claims',current_setting('integration.mcp.claims'),true);

select is(jsonb_array_length(private.application_mt5_grants('{"limit":1}')->'records'),1,'MCP discovers only owned active collector grants');
select ok(not has_function_privilege('authenticated','private.application_mt5_workflow_write(jsonb,jsonb)','EXECUTE'),'Data API cannot bypass verified workflows');
select ok(not has_function_privilege('service_role','private.application_mt5_register_connection_impl(uuid,uuid,jsonb)','EXECUTE'),'extracted mapping core is private');
select set_config('workflow.map',jsonb_build_object('kind','REGISTER','command',jsonb_build_object('grantId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','operationId','00000000-0000-4000-8000-000000000001',
'identity','{"server":"Broker-Demo","login":"9007199254740993","terminalInstallationId":"44444444-4444-4444-8444-444444444444","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"HEDGING"}'::jsonb))::text,true);
select lives_ok($$select private.application_mt5_workflow_prepare(current_setting('workflow.map')::jsonb)$$,'verified mapping prepares without impersonating collector');
select set_config('workflow.mapped',private.application_mt5_workflow_write(current_setting('workflow.map')::jsonb,'{}')::text,true);
select is(current_setting('workflow.mapped')::jsonb->>'status','ONBOARDING','new mapping is not activated');
select is(private.application_mt5_workflow_prepare(current_setting('workflow.map')::jsonb)->'receipt',current_setting('workflow.mapped')::jsonb,'mapping retry recovers original result');
select is((select count(*)::integer from private.mt5_connections),1,'mapping retries have one connection');
select is((select client_id::text from private.integration_operations),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','mapping receipt belongs to MCP client');
select is((select account_id from private.integration_operations),null::uuid,'MCP receipt remains application-wide');
select throws_ok($$select private.application_mt5_workflow_prepare(jsonb_set(current_setting('workflow.map')::jsonb,'{command,identity,login}','"12345"'))$$,'23505',null,'changed mapping retry rejected');
select throws_ok($$select private.application_mt5_workflow_prepare(current_setting('workflow.map')::jsonb||'{"ownerId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}')$$,'22023',null,'caller ownership rejected');

insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select c.id,'DEAL',ticket,'2026-01-03T00:00:00Z',jsonb_build_object('ticket',ticket,'positionId',case when ticket='99' then null else '100' end,
'orderId',case when ticket='99' then null else ticket end,'symbol',case when ticket='99' then null else 'EURUSDm' end,
'type',case when ticket='10' then 'BUY' when ticket='11' then 'SELL' else 'BALANCE' end,
'entry',case when ticket='10' then 'IN' when ticket='11' then 'OUT' else null end,'volume',case when ticket='99' then '0' else '1' end,
'price',case when ticket='10' then '1.1' when ticket='11' then '1.2' else '0' end,
'profit',case when ticket='10' then '0' when ticket='11' then '100' else '1000' end,'commission',case when ticket='10' then '-2' when ticket='11' then '-3' else '0' end,
'swap','0','fee','0','occurredAt',case when ticket='99' then '2026-01-01T00:00:00.000Z' when ticket='10' then '2026-01-01T10:00:00.000Z' else '2026-01-02T10:00:00.000Z' end),
repeat('a',64),1,gen_random_uuid() from private.mt5_connections c cross join unnest(array['10','11','99']) ticket;
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select id,'ACCOUNT','ACCOUNT','2026-01-03T00:00:00Z','{"balance":"1095","equity":"1095","unrealizedPnl":"0","observedAt":"2026-01-03T00:00:00.000Z"}',repeat('b',64),1,gen_random_uuid() from private.mt5_connections;
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,id,observed_at from private.mt5_source_revisions;
update private.mt5_connections set capture_checkpoint='2026-01-03T00:00:00Z';
create function pg_temp.command(kind text,extra jsonb default '{}'::jsonb,operation uuid default gen_random_uuid()) returns jsonb language sql as $$
select jsonb_build_object('kind',kind,'command',(jsonb_build_object('connectionId',c.id,'operationId',operation,'version',c.version::text,
'reason','Approve exact deterministic fixture evidence')||case when kind='CONTROL' then '{}'::jsonb else
jsonb_build_object('snapshotToken',private.mt5_source_snapshot_token(c.id)) end||case when kind in ('CONTROL','SYMBOL_MAPPING') then '{}'::jsonb else
jsonb_build_object('ledgerToken',private.mt5_account_ledger_token(c.account_id)) end)||extra) from private.mt5_connections c;
$$;
select set_config('workflow.symbol',pg_temp.command('SYMBOL_MAPPING',jsonb_build_object('brokerSymbol','EURUSDm','instrumentId',(select id from public.instruments where symbol='EURUSD' and user_id is null)))::text,true);
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.symbol')::jsonb,'{}')$$,'MCP maps captured alias through existing writer');
select is((select version::text from private.mt5_symbol_mappings),'1','one explicit mapping version');
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.symbol')::jsonb,'{}')$$,'symbol retry recovers receipt');
select is((select count(*)::integer from private.mt5_symbol_mapping_events),1,'symbol retry preserves one event');
select set_config('workflow.cash',pg_temp.command('CASH',jsonb_build_object('sourceTicket','99','sourceRevisionId',(select current_revision_id::text from private.mt5_source_facts where source_id='99'),
'disposition','BASELINE_FUNDING','adjustmentType',null,'isPerformanceNeutral',null,'existingAdjustmentId',null))::text,true);
select lives_ok($$select private.application_mt5_workflow_prepare(current_setting('workflow.cash')::jsonb)$$,'cash prepares full consistent snapshot');
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.cash')::jsonb,'{"amount":"1000.00","occurredAt":"2026-01-01T00:00:00.000Z"}')$$,'baseline funding classified without extra deposit');
select is((select count(*)::integer from public.account_adjustments),0,'baseline funding never double-counts');
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.cash')::jsonb,'{"amount":"1000.00","occurredAt":"2026-01-01T00:00:00.000Z"}')$$,'cash retry returns stored result');

create function pg_temp.execution() returns jsonb language sql as $$
select jsonb_build_object('canonicalIdentity',c.id::text||':100:10:BUY','positionId','100','openingDealTicket','10','direction','BUY','symbol','EURUSDm',
'instrumentId',i.id,'status','CLOSED','openedAt','2026-01-01T10:00:00.000Z','closedAt','2026-01-02T10:00:00.000Z','entryPrice','1.1','exitPrice','1.2',
'openedVolume','1','remainingVolume','0','grossPnl','100','commission','5','swap','0','otherFees','0','tradingCredits','0','finalNetPnl','95.00','outcome','WIN',
'usedPartialExits',false,'recognizedCash','95.00','allocations','[]'::jsonb,'sourceRevisions',
(select jsonb_agg(jsonb_build_object('sourceId',source_id,'revisionId',current_revision_id::text) order by source_id) from private.mt5_source_facts where kind='DEAL' and source_id in ('10','11')))
from private.mt5_connections c cross join public.instruments i where i.symbol='EURUSD' and i.user_id is null;
$$;
select set_config('workflow.publish',pg_temp.command('PUBLICATION',jsonb_build_object('openingBaseline','1000','episodeIdentities',jsonb_build_array((select id::text||':100:10:BUY' from private.mt5_connections))))::text,true);
select set_config('workflow.proposal',jsonb_build_object('episodes',jsonb_build_array(pg_temp.execution()),'unresolvedProblemCount',0,'reconciliationState','NOT_APPROVED')::text,true);
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.publish')::jsonb,current_setting('workflow.proposal')::jsonb)$$,'explicit MCP selection publishes through sole financial writer');
select is((select net_pnl from public.trades),95.00::numeric,'gross100 minus2+3 costs is95');
select is((select planned_risk_amount from public.trades),null::numeric,'unknown historical risk is not fabricated');
select is((select source_type::text from public.trades),'MT5','canonical execution retains source identity');
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.publish')::jsonb,current_setting('workflow.proposal')::jsonb)$$,'publication retry returns original result');
select is((select count(*)::integer from public.trades),1,'publication retry never duplicates canonical trade');
select is((select count(*)::integer from private.mt5_execution_versions),1,'publication retry never duplicates execution history');

select throws_ok($$select private.application_mt5_workflow_write(pg_temp.command('POLICY','{"enabled":true}'),'{}')$$,'23514',null,'policy cannot be enabled before explicit onboarding');
select set_config('workflow.approve',pg_temp.command('ONBOARDING','{"openingBaseline":"1000","availableHistoryConfirmed":true}')::text,true);
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.approve')::jsonb,jsonb_build_object('episodes',jsonb_build_array(pg_temp.execution()),'bridge',jsonb_build_object('unexplainedDifference','0.00'),'availableHistoryConfirmed',true))$$,'MCP approves complete reconciled source/ledger snapshot');
select is((select count(*)::integer from private.mt5_onboarding_approvals),1,'approval is immutable evidence');
select set_config('workflow.policy',pg_temp.command('POLICY','{"enabled":true}')::text,true);
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.policy')::jsonb,'{}')$$,'policy enabled only after current approval');
select is((select automatic_publication_baseline from private.mt5_connections),1000::numeric,'policy preserves positive approved opening baseline');
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.policy')::jsonb,'{}')$$,'policy retry is durable');
select is((select count(*)::integer from private.mt5_review_events where review_kind='POLICY'),1,'policy retry has one audit event');
update private.mt5_connections set worker_id='55555555-5555-4555-8555-555555555555',lease_expires_at=clock_timestamp()+interval '1 minute';
select set_config('workflow.pause',pg_temp.command('CONTROL','{"action":"PAUSE"}')::text,true);
create function pg_temp.fail_workflow_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure.' using errcode='23514';end;$$;
create trigger fixture_workflow_audit before insert on private.integration_mutation_audits for each row execute function pg_temp.fail_workflow_audit();
select throws_ok($$select private.application_mt5_workflow_write(current_setting('workflow.pause')::jsonb,'{}')$$,'23514',null,'audit failure aborts control');
drop trigger fixture_workflow_audit on private.integration_mutation_audits;
select is((select worker_id::text from private.mt5_connections),'55555555-5555-4555-8555-555555555555','failed control preserves worker ownership');
select is((select fencing_token from private.mt5_connections),0::bigint,'failed control rolls back fence');
select is((select status from private.mt5_connections),'ACTIVE','failed control rolls back status');
select is((select count(*)::integer from private.integration_operations where operation_id=(current_setting('workflow.pause')::jsonb->'command'->>'operationId')::uuid),0,'failed control leaves no receipt');
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.pause')::jsonb,'{}')$$,'MCP pause uses existing fenced control');
select is((select worker_id from private.mt5_connections),null::uuid,'pause invalidates old worker');
select is((select fencing_token from private.mt5_connections),1::bigint,'pause advances fence exactly once');
select lives_ok($$select private.application_mt5_workflow_write(current_setting('workflow.pause')::jsonb,'{}')$$,'control retry succeeds');
select is((select fencing_token from private.mt5_connections),1::bigint,'control retry does not advance fence again');
select is((select status from private.mt5_connections),'PAUSED','policy enablement does not force collector active');
select is((select count(*)::integer from private.mt5_onboarding_approvals),1,'control preserves approval evidence');
select ok(not exists(select 1 from private.integration_mutation_audits where changes->>'actorType' is distinct from 'MCP'),'all workflow audits attribute actual MCP actor');
select ok(not exists(select 1 from private.integration_operations where purpose<>'MCP' or account_id is not null),'all receipts retain MCP scope');
select throws_ok($$select private.application_mt5_workflow_prepare(current_setting('workflow.pause')::jsonb||'{"ownerId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}')$$,'22023',null,'database rejects injected identity');
select throws_ok($$select private.application_mt5_workflow_prepare(jsonb_set(current_setting('workflow.pause')::jsonb,'{command,operationId}',to_jsonb(gen_random_uuid())))$$,'40001',null,'fresh stale control rejected');
set local role authenticated;
select throws_ok($$select public.mt5_set_connection_state((current_setting('workflow.pause')::jsonb->'command'->>'connectionId')::uuid,'1',gen_random_uuid(),'PAUSE','Forbidden direct OAuth control')$$,'42501',null,'old browser control still rejects OAuth');
reset role;
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where purpose='MT5';
select throws_ok($$select private.application_mt5_workflow_prepare(current_setting('workflow.pause')::jsonb)$$,'42501',null,'collector grant revocation blocks even receipt replay');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where purpose='MCP';
select throws_ok($$select private.application_mt5_grants('{}')$$,'42501',null,'MCP revocation rejects grant discovery immediately');
select set_config('request.jwt.claims',jsonb_build_object('sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd','role','authenticated','session_id','33333333-3333-4333-8333-333333333333','exp',extract(epoch from now())+3600)::text,true);
select is(jsonb_array_length(private.application_mt5_grants('{}')->'records'),0,'other owner cannot discover collector grants');
select throws_ok($$select private.application_mt5_workflow_prepare(current_setting('workflow.pause')::jsonb)$$,'42501',null,'other owner/browser cannot mutate MCP workflow');
select ok(not has_function_privilege('anon','private.application_mt5_workflow_prepare(jsonb)','EXECUTE'),'anonymous users cannot prepare workflows');
select * from finish();
rollback;
