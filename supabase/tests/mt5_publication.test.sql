begin;
create extension if not exists pgtap with schema extensions;
select plan(53);
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
 jsonb_build_object('ticket',ticket,'positionId','100','orderId',ticket,'symbol','EURUSD','type',case when ticket='10' then 'BUY' else 'SELL' end,
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
    'canonicalIdentity',c.id::text||':100:10:BUY','positionId','100','openingDealTicket','10','direction','BUY','symbol','EURUSD',
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
select ok(not has_function_privilege('authenticated','private.mt5_publish_browser(jsonb,jsonb)','EXECUTE'),'browser cannot submit financial proposals directly');
select ok(not has_function_privilege('anon','private.mt5_browser_publication_result(jsonb)','EXECUTE'),'anonymous cannot discover operation receipts');
select throws_ok($$select private.mt5_publish_browser(pg_temp.request()||'{"reason":""}',pg_temp.proposal())$$,'22023','Invalid publication approval.','approval requires a meaningful reason');
select throws_ok($$select private.mt5_publish_browser(pg_temp.request()||'{"version":"99"}',pg_temp.proposal())$$,'40001','Source preview changed or capture incomplete.','stale connection rejected');
select throws_ok($$select private.mt5_publish_browser(pg_temp.request()||jsonb_build_object('snapshotToken',repeat('b',64)),pg_temp.proposal())$$,'40001','Source preview changed or capture incomplete.','stale source snapshot rejected');
select throws_ok($$select private.mt5_publish_browser(pg_temp.request()||jsonb_build_object('ledgerToken',repeat('b',64)),pg_temp.proposal())$$,'40001','Account ledger changed.','stale ledger rejected');
select throws_ok($$select private.mt5_publish_browser(pg_temp.request()||'{"openingBaseline":"999"}',pg_temp.proposal())$$,'23514','Preserved positive baseline and account currency required.','existing baseline cannot be rewritten');
select is((select count(*)::integer from public.import_batches),0,'rejected approvals persist no import batches');
update private.mt5_connections set status='PAUSED';
select set_config('mt5.fixture_open_request',pg_temp.request('00000000-0000-4000-8000-000000000001')::text,true);
select lives_ok($$select private.mt5_publish_browser(current_setting('mt5.fixture_open_request')::jsonb,pg_temp.proposal())$$,'explicit approval of frozen PAUSED capture publishes one OPEN canonical trade');
select is((select count(*)::integer from public.trades),1,'one canonical trade created');
select is((select net_pnl from public.trades),null::numeric,'partial cash cannot become realized canonical PnL');
select is((select actual_r from public.trades),null::numeric,'missing original risk is not zero R');
select is((select actual_entry from public.trades),1.123456789012345678::numeric,'market price precision is not rounded to currency or legacy typmod');
select ok((select planned_entry is null and planned_stop_loss is null and planned_risk_amount is null from public.trades),'no original plan fabricated');
select is((select count(*)::integer from private.mt5_execution_sources),2,'durable source revisions linked to publication');
select is((select count(*)::integer from private.mt5_execution_versions),1,'first execution version is immutable evidence');
select lives_ok($$select private.mt5_publish_browser(current_setting('mt5.fixture_open_request')::jsonb,pg_temp.proposal())$$,'lost acknowledgement safely replays original receipt despite changed ledger/version');
select is((select count(*)::integer from private.mt5_execution_versions),1,'identical retry creates no execution revision');
select throws_ok($$select private.mt5_publish_browser(current_setting('mt5.fixture_open_request')::jsonb||'{"reason":"Changed request reason"}',pg_temp.proposal())$$,'23505','Operation payload conflict.','changed operation payload rejected');
select throws_ok($$update private.mt5_execution_versions set execution='{}'$$,'42501',null,'execution versions cannot be rewritten');
select throws_ok($$delete from private.mt5_execution_sources$$,'42501',null,'source attribution cannot be deleted');
select throws_ok($$delete from private.mt5_publication_approvals$$,'42501',null,'approval history cannot be deleted');

-- Final remaining half closes later: total gross 20+80=100, costs 2+1=3,
-- positive swap credit 1 => final 98; partial exit alone was not a final win.
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select connection_id,kind,'12','2026-01-03T00:00:00Z',payload||'{"ticket":"12","orderId":"12","profit":"80","commission":"0","swap":"0","price":"1.3","occurredAt":"2026-01-03T00:00:00.000Z"}',repeat('c',64),1,gen_random_uuid()
from private.mt5_source_revisions where source_id='11';
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,id,observed_at from private.mt5_source_revisions where source_id='12';
select set_config('mt5.fixture_close_request',pg_temp.request('00000000-0000-4000-8000-000000000002')::text,true);
select lives_ok($$select private.mt5_publish_browser(current_setting('mt5.fixture_close_request')::jsonb,pg_temp.proposal(true))$$,'complete closure updates same canonical trade');
select is((select count(*)::integer from public.trades),1,'partial/final closure never duplicates trade');
select is((select net_pnl from public.trades),98::numeric,'final finance matches hand-calculated 100-3+1');
select is((select outcome::text from public.trades),'PARTIAL_WIN','complete positive partially-exited trade is classified after closure');
select is((select mt5_execution_version from public.trades),2::bigint,'current canonical execution version advanced');
select is((select count(*)::integer from private.mt5_execution_versions),2,'both original OPEN and final CLOSED evidence recoverable');
select is((select count(*)::integer from private.mt5_execution_sources),5,'each publication retains its exact two/three source revisions');
select is((select changes->>'actorType' from private.integration_mutation_audits order by created_at limit 1),'BROWSER','audit preserves verified actor type');
select is((select onboarding_approved_at from private.mt5_connections),null::timestamptz,'selected import is not unattended-sync or reconciliation approval');
select is((select count(*)::integer from public.trade_plan_corrections),0,'actual broker execution does not create plan corrections');
select lives_ok($$select private.mt5_publish_browser(pg_temp.request('00000000-0000-4000-8000-000000000003'),pg_temp.proposal(true))$$,'new operation observing identical facts succeeds without rewriting execution');
select is((select count(*)::integer from private.mt5_execution_versions),2,'unchanged repeated observations create no additional execution versions');
select is((select imported_count from public.import_batches where id=(select (result->>'importBatchId')::uuid
  from private.integration_operations where operation_id='00000000-0000-4000-8000-000000000003')),0,'unchanged observation reports zero changed trades');
select is((select count(*)::integer from public.trades),1,'new-operation replay still has one canonical trade');
create function pg_temp.atomic_failure() returns void language plpgsql as $$
declare request jsonb:=pg_temp.request(); proposal jsonb:=pg_temp.proposal(true); item jsonb:=proposal->'episodes'->0;
begin
  request:=jsonb_set(request,'{episodeIdentities}',request->'episodeIdentities'||jsonb_build_array('cccccccc-cccc-4ccc-8ccc-cccccccccccc:100:20:SELL'));
  proposal:=jsonb_set(proposal,'{episodes}',jsonb_build_array(item||'{"recognizedCash":"98"}',item||
    '{"canonicalIdentity":"cccccccc-cccc-4ccc-8ccc-cccccccccccc:100:20:SELL","direction":"SELL","openingDealTicket":"20","instrumentId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}'));
  perform private.mt5_publish_browser(request,proposal);
end;
$$;
select throws_ok($$select pg_temp.atomic_failure()$$,'40001','Instrument mapping changed.','invalid later episode rolls back an earlier valid canonical update');
select is((select mt5_execution_version from public.trades),2::bigint,'earlier update did not survive later failure');
select is((select count(*)::integer from private.mt5_execution_versions),2,'earlier execution evidence also rolled back');
select throws_ok($$select private.mt5_publish_browser(pg_temp.request(),pg_temp.proposal())$$,'23514','A closed trade cannot return to an earlier lifecycle state.','missing positions cannot reopen finalized canonical execution');
select is((select count(*)::integer from private.integration_operations),3,'failed reopen rolls back its batch, approval and operation');
update private.mt5_source_facts set requires_review=true where source_id='12';
select throws_ok($$select private.mt5_publish_browser(pg_temp.request(),pg_temp.proposal(true))$$,'40001','Source execution requires review.','changed financial revision requires review');
update private.mt5_source_facts set requires_review=false;
update auth.sessions set not_after=clock_timestamp()-interval '1 second';
select throws_ok($$select private.mt5_browser_publication_result(pg_temp.request())$$,'42501','Active browser session required.','expired live session blocks publication and receipt lookup');
update auth.sessions set not_after=null;
select set_config('request.jwt.claims',(auth.jwt()||'{"exp":1}')::text,true);
select throws_ok($$select private.mt5_browser_publication_result(pg_temp.request())$$,'42501','Active browser session required.','expired signed-claim context cannot publish');
select set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('exp',floor(extract(epoch from clock_timestamp()))+3600))::text,true);
update private.integration_resources set enabled=false;
select throws_ok($$select private.mt5_browser_publication_result(pg_temp.request())$$,'42501','Active MT5 grant required.','database enablement flag blocks publication immediately');
update private.integration_resources set enabled=true;
select set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('client_id','ffffffff-ffff-4fff-8fff-ffffffffffff'))::text,true);
select throws_ok($$select private.mt5_publish_browser(pg_temp.request(),pg_temp.proposal(true))$$,'42501','A direct browser session is required.','collector OAuth token cannot use browser approval path');
select set_config('request.jwt.claims',(auth.jwt()-'client_id')::text,true);
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp();
select throws_ok($$select private.mt5_browser_publication_result(current_setting('mt5.fixture_close_request')::jsonb)$$,'42501','Active MT5 grant required.','grant revocation immediately blocks retries');
select is((select count(*)::integer from public.import_batches),3,'no rejected mutation left a partial import batch');
select is((select count(*)::integer from private.mt5_publication_approvals),3,'no rejected mutation left a partial approval');
select is((select count(*)::integer from private.integration_mutation_audits),3,'audit count matches committed effects exactly');
select is((select starting_balance from public.trading_accounts where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),1000::numeric,'opening baseline unchanged through publication');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'publication-non-owner@example.test','fixture-only','{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('99999999-9999-4999-8999-999999999999','dddddddd-dddd-4ddd-8ddd-dddddddddddd',clock_timestamp(),clock_timestamp());
select set_config('request.jwt.claims',jsonb_build_object('sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd','role','authenticated',
  'session_id','99999999-9999-4999-8999-999999999999','exp',floor(extract(epoch from clock_timestamp()))+3600)::text,true);
select throws_ok($$select private.mt5_browser_publication_result(pg_temp.request())$$,'42501','Connection access denied.','another genuinely active browser owner cannot access this mapping or receipt');
delete from auth.sessions where id='99999999-9999-4999-8999-999999999999';
select throws_ok($$select private.mt5_browser_publication_result(pg_temp.request())$$,'42501','Active browser session required.','logged-out browser session cannot read a receipt despite unexpired claims');
select * from finish();
rollback;
