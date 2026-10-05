begin;
create extension if not exists pgtap with schema extensions;
select plan(41);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'publication-fixture@example.test','fixture-only','{}','{}',now(),now());
update public.trading_accounts set starting_balance=1000 where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none');
insert into auth.sessions(id,user_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',clock_timestamp(),clock_timestamp());
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://trade.example/api/integrations/v1',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',
  'MT5',id,'https://trade.example/api/integrations/v1','publication-fixture','ACTIVE'
from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
insert into private.mt5_connections(id,owner_id,account_id,grant_id,identity,capture_checkpoint)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',owner_id,account_id,id,
  '{"server":"Broker-Demo","login":"12345","terminalInstallationId":"22222222-2222-4222-8222-222222222222","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"NETTING"}',
  '2026-01-03T00:00:00Z' from private.integration_grants;
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','DEAL',ticket,'2026-01-03T00:00:00Z',
 jsonb_build_object('ticket',ticket,'positionId','100','orderId',ticket,'symbol','EURUSD.m','type',case when ticket='10' then 'BUY' else 'SELL' end,
   'entry',case when ticket='10' then 'IN' else 'OUT' end,'volume',case when ticket='10' then '1' else '0.5' end,
   'price',case when ticket='10' then '1.123456789012345678' else '1.2' end,
   'occurredAt',case when ticket='10' then '2026-01-01T00:00:00.000Z' else '2026-01-02T00:00:00.000Z' end,
   'profit',case when ticket='10' then '0' else '20' end,'commission',case when ticket='10' then '-2' else '-1' end,
   'swap',case when ticket='10' then '0' else '1' end,'fee','0'),repeat('a',64),1,gen_random_uuid()
from unnest(array['10','11']) ticket;
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,id,observed_at from private.mt5_source_revisions;
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
  'session_id','11111111-1111-4111-8111-111111111111','exp',floor(extract(epoch from clock_timestamp()))+3600)::text,true);

create function pg_temp.request(operation uuid default gen_random_uuid()) returns jsonb language sql as $$
  select jsonb_build_object('connectionId',c.id,'version',c.version::text,'operationId',operation,
    'snapshotToken',private.mt5_source_snapshot_token(c.id),'ledgerToken',private.mt5_account_ledger_token(c.account_id),
    'openingBaseline','1000','reason','Approve verified broker execution history',
    'episodeIdentities',jsonb_build_array(c.id::text||':100:10:BUY')) from private.mt5_connections c;
$$;
create function pg_temp.proposal(closed boolean default false) returns jsonb language sql as $$
  select jsonb_build_object('reconciliationState','NOT_APPROVED','unresolvedProblemCount',1,'episodes',jsonb_build_array(jsonb_build_object(
    'canonicalIdentity',c.id::text||':100:10:BUY','positionId','100','openingDealTicket','10','direction','BUY','symbol','EURUSD.m',
    'instrumentId',i.id,'status',case when closed then 'CLOSED' else 'OPEN' end,'openedAt','2026-01-01T00:00:00.000Z',
    'closedAt',case when closed then '2026-01-03T00:00:00.000Z' end,'entryPrice','1.123456789012345678',
    'exitPrice',case when closed then '1.25' else '1.2' end,'openedVolume','1',
    'remainingVolume',case when closed then '0' else '0.5' end,'grossPnl',case when closed then '100' else '20' end,
    'commission','3','swap','0','otherFees','0','tradingCredits','1','finalNetPnl',case when closed then '98.00' end,
    'outcome',case when closed then 'PARTIAL_WIN' end,'usedPartialExits',true,'recognizedCash',case when closed then '98.00' else '18.00' end,
    'sourceRevisions',(select jsonb_agg(jsonb_build_object('sourceId',f.source_id,'revisionId',f.current_revision_id::text) order by f.source_id)
      from private.mt5_source_facts f where f.connection_id=c.id and f.kind='DEAL'),
    'allocations',jsonb_build_array(jsonb_build_object('dealTicket','10','part','OPEN','volume','1','grossPnl','0','commission','-2','swap','0','fee','0','convention','BROKER_FACT')))))
  from private.mt5_connections c cross join public.instruments i where i.symbol='EURUSD' and i.user_id is null;
$$;

create function pg_temp.mapping(operation uuid default gen_random_uuid(),p_symbol text default 'EURUSD.m',instrument_symbol text default 'EURUSD') returns jsonb language sql as $$
 select jsonb_build_object('connectionId',c.id,'version',c.version::text,'operationId',operation,
 'snapshotToken',private.mt5_source_snapshot_token(c.id),'brokerSymbol',p_symbol,'instrumentId',i.id,
 'reason','Confirmed broker symbol alias') from private.mt5_connections c cross join public.instruments i
 where i.symbol=instrument_symbol and i.user_id is null;
$$;
select ok(not has_function_privilege('authenticated','private.mt5_save_symbol_mapping(jsonb)','EXECUTE'),'browser cannot bypass typed service mapping decisions');
select ok(not has_table_privilege('authenticated','private.mt5_symbol_mappings','SELECT'),'private maps cannot be read directly');
select throws_ok($$select private.mt5_publish_browser(pg_temp.request(),pg_temp.proposal())$$,'40001','Instrument mapping changed.','alias cannot publish without explicit mapping');
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping()||'{"reason":""}')$$,'22023','Invalid symbol mapping decision.','meaningful reason required');
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping()||'{"version":"999"}')$$,'40001','Symbol mapping preview changed.','stale version rejected');
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping()||jsonb_build_object('snapshotToken',repeat('b',64)))$$,'40001','Symbol mapping preview changed.','stale source rejected');
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping(gen_random_uuid(),'UNCAPTURED'))$$,'23514','A captured broker symbol is required.','unknown symbols cannot be approved');
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping()||'{"ownerId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}')$$,'22023','Invalid symbol mapping decision.','arbitrary owner rejected');
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping()||'{"instrumentId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'42501','Instrument access denied.','inaccessible instrument rejected');
select is((select count(*)::integer from private.mt5_symbol_mappings),0,'failed mappings leave no current row');
create function pg_temp.fail_mapping_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure' using errcode='23514'; end; $$;
create trigger injected_mapping_failure before insert on private.mt5_symbol_mapping_events for each row execute function pg_temp.fail_mapping_audit();
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping())$$,'23514','Injected audit failure','mapping and audit commit atomically');
select is((select count(*)::integer from private.mt5_symbol_mappings),0,'failed audit rolls back current map');
select is((select count(*)::integer from private.integration_operations),0,'failed audit stores no durable receipt');
drop trigger injected_mapping_failure on private.mt5_symbol_mapping_events;
select set_config('mt5.mapping_request',pg_temp.mapping('00000000-0000-4000-8000-000000000004')::text,true);
select lives_ok($$select private.mt5_save_symbol_mapping(current_setting('mt5.mapping_request')::jsonb)$$,'explicit alias mapping succeeds');
select is((select version from private.mt5_symbol_mappings),1::bigint,'typed mapping starts at version one');
select lives_ok($$select private.mt5_save_symbol_mapping(current_setting('mt5.mapping_request')::jsonb)$$,'retry uses durable receipt after version changes');
select is((select count(*)::integer from private.mt5_symbol_mapping_events),1,'retry creates one event');
select throws_ok($$select private.mt5_save_symbol_mapping(current_setting('mt5.mapping_request')::jsonb||'{"reason":"Changed mapping reason"}')$$,'23505','Operation payload conflict.','changed retry rejected');
select throws_ok($$update private.mt5_symbol_mappings set reason='Unaudited reason rewrite'$$,'42501','Approved symbol mapping required.','direct mapping updates rejected');
select throws_ok($$delete from private.mt5_symbol_mapping_events$$,'42501',null,'mapping history cannot be deleted');
select lives_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping())$$,'another reason appends a correction version');
select is((select count(*)::integer from private.mt5_symbol_mapping_events),2,'both decisions retained');
select ok((select previous_instrument_id=new_instrument_id from private.mt5_symbol_mapping_events where mapping_version=2),'event preserves previous and current typed instrument');
select lives_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping(gen_random_uuid(),'EURUSD.m','GBPUSD'))$$,'unpublished mapping can be explicitly corrected');
select is((select i.symbol from private.mt5_symbol_mappings m join public.instruments i on i.id=m.instrument_id),'GBPUSD','current read uses corrected typed instrument');
select lives_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping())$$,'fixing an incorrect mapping appends another decision');
select is((select i.symbol from private.mt5_symbol_mapping_events e join public.instruments i on i.id=e.previous_instrument_id where mapping_version=4),'GBPUSD','complete correction chain retains original and intermediate instruments');
select throws_ok($$delete from private.mt5_symbol_mappings$$,'42501','Approved symbol mapping required.','current map cannot be deleted');
select is((public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc')->'symbolMappings'->0->>'version'),'4','owner preview reads latest mapping');
update private.mt5_connections set status='PAUSED';
select lives_ok($$select private.mt5_publish_browser(pg_temp.request(),pg_temp.proposal())$$,'approved alias publishes canonical instrument');
select is((select i.symbol from public.trades t join public.instruments i on i.id=t.instrument_id),'EURUSD','canonical instrument uses selected catalog record');
select is((select execution->>'symbol' from private.mt5_execution_versions),'EURUSD.m','raw broker alias preserved as provenance');
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping(gen_random_uuid(),'EURUSD.m','GBPUSD'))$$,'23514','Published broker symbols cannot be reassigned.','published alias cannot silently change historical instrument');
select is((select count(*)::integer from private.mt5_symbol_mapping_events),4,'rejected reassignment leaves history unchanged');
select is((select status::text from private.mt5_connections),'PAUSED','mapping and publication never resume capture');
update auth.sessions set not_after=clock_timestamp()-interval '1 second';
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping())$$,'42501','Active browser session required.','expired live browser session rejected');
update auth.sessions set not_after=null;
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp();
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping())$$,'42501','Active MT5 grant required.','revocation takes effect immediately');
update private.integration_grants set status='ACTIVE',revoked_at=null;
select set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd'))::text,true);
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping())$$,'42501',null,'non-owner cannot map another account');
select set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'))::text,true);
set local role anon;
select throws_ok($$select private.mt5_save_symbol_mapping('{}')$$,'42501',null,'anonymous cannot invoke mapping workflow');
reset role;
select is((select count(*)::integer from private.mt5_symbol_mapping_events),4,'unauthorized attempts preserve complete mapping history');
select set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('client_id','ffffffff-ffff-4fff-8fff-ffffffffffff'))::text,true);
select throws_ok($$select private.mt5_save_symbol_mapping(pg_temp.mapping())$$,'42501','A direct browser session is required.','collector OAuth token cannot authorize mappings');
select * from finish();
rollback;
