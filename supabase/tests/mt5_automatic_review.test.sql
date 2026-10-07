begin;
create extension if not exists pgtap with schema extensions;
select plan(31);
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

create function pg_temp.review(kind text,extra jsonb default '{}'::jsonb,operation uuid default gen_random_uuid()) returns jsonb language sql as $$
 select (pg_temp.request(operation)-array['openingBaseline','episodeIdentities'])||jsonb_build_object('reviewKind',kind)||extra;
$$;
select ok(not has_function_privilege('authenticated','private.mt5_publish_execution(jsonb,jsonb)','EXECUTE'),'OAuth/browser roles cannot submit calculated execution proposals');
select ok(not has_function_privilege('authenticated','private.mt5_review_request(jsonb,jsonb)','EXECUTE'),'normal roles cannot bypass verified browser review');
select throws_ok($$select private.mt5_review_request(pg_temp.review('POLICY','{"enabled":true}'),'{}')$$,'23514','Current onboarding approval required.','automatic policy requires current onboarding approval');
update private.mt5_source_facts set requires_review=true where source_id='11';
select set_config('review.request',pg_temp.review('SOURCE',jsonb_build_object('sourceKind','DEAL','sourceId','11','sourceRevisionId',(select current_revision_id::text from private.mt5_source_facts where source_id='11')),'00000000-0000-4000-8000-000000000090')::text,true);
select throws_ok($$select private.mt5_review_request(current_setting('review.request')::jsonb||'{"reason":""}','{}')$$,'22023','Meaningful review reason required.','missing reason rejected');
select throws_ok($$select private.mt5_review_request(current_setting('review.request')::jsonb||'{"version":"99"}','{}')$$,'40001','Review evidence changed.','stale version rejected');
select lives_ok($$select private.mt5_review_request(current_setting('review.request')::jsonb,'{}')$$,'explicit source review succeeds');
select ok(not (select requires_review from private.mt5_source_facts where source_id='11'),'review clears only the selected current hold');
select is((select count(*)::integer from private.mt5_source_revisions),2,'all raw revisions retained');
select lives_ok($$select private.mt5_review_request(current_setting('review.request')::jsonb,'{}')$$,'lost review acknowledgement returns durable result before stale fingerprint checks');
select is((select count(*)::integer from private.mt5_review_events),1,'review retry does not duplicate evidence');
select throws_ok($$select private.mt5_review_request(current_setting('review.request')::jsonb||'{"reason":"Different reason"}','{}')$$,'23505','Operation payload conflict.','changed retry rejected');
select throws_ok($$delete from private.mt5_review_events$$,'42501',null,'review audit cannot be deleted');
insert into public.trades(id,user_id,account_id,instrument_id,status,direction,opened_at,actual_entry,actual_lot_size,thesis,planned_risk_amount)
select '44444444-4444-4444-8444-444444444444',c.owner_id,c.account_id,i.id,'OPEN','BUY','2026-01-01T00:00:00Z',1.1,1,'Preserve original manual thesis',10
from private.mt5_connections c cross join public.instruments i where i.symbol='EURUSD' and i.user_id is null;
create function pg_temp.manual_extra() returns jsonb language sql as $$
 select jsonb_build_object('canonicalIdentity','cccccccc-cccc-4ccc-8ccc-cccccccccccc:100:10:BUY','tradeId',t.id,
 'tradeToken',encode(extensions.digest(t::text,'sha256'),'hex')) from public.trades t where id='44444444-4444-4444-8444-444444444444';
$$;
select lives_ok($$select private.mt5_review_request(pg_temp.review('DISTINCT',pg_temp.manual_extra()),pg_temp.proposal())$$,'distinct-position decision is explicit and audited');
select ok((select private.mt5_distinct_match('cccccccc-cccc-4ccc-8ccc-cccccccccccc','cccccccc-cccc-4ccc-8ccc-cccccccccccc:100:10:BUY',t) from public.trades t),'current manual fingerprint is resolved');
select lives_ok($$select private.mt5_review_request(pg_temp.review('REOPEN',pg_temp.manual_extra()),pg_temp.proposal())$$,'an incorrect distinct decision can be withdrawn by another event');
select ok(not (select private.mt5_distinct_match('cccccccc-cccc-4ccc-8ccc-cccccccccccc','cccccccc-cccc-4ccc-8ccc-cccccccccccc:100:10:BUY',t) from public.trades t),'withdrawal restores match hold');
select lives_ok($$select private.mt5_review_request(pg_temp.review('LINK',pg_temp.manual_extra()),jsonb_set(pg_temp.proposal(),'{episodes,0,linkTradeId}','"44444444-4444-4444-8444-444444444444"'))$$,'same-position review links broker execution to the existing manual trade');
select is((select count(*)::integer from public.trades),1,'linking creates no duplicate trade');
select is((select id::text from public.trades),'44444444-4444-4444-8444-444444444444','link retains original trade ID');
select is((select thesis from public.trades),'Preserve original manual thesis','link preserves original thesis');
select is((select planned_risk_amount from public.trades),10::numeric,'link preserves original planned risk');
select is((select count(*)::integer from private.mt5_execution_versions),1,'link records source execution evidence');
select is((select previous_value->>'source_type' from private.mt5_review_events where review_kind='LINK'),'MANUAL','previous manual record remains recoverable');

insert into private.mt5_onboarding_approvals(connection_id,actor_user_id,operation_id,request,proof,source_token,ledger_token,capture_checkpoint)
select id,owner_id,gen_random_uuid(),'{}','{}',private.mt5_source_snapshot_token(id),private.mt5_account_ledger_token(account_id),capture_checkpoint from private.mt5_connections;
select lives_ok($$select private.mt5_review_request(pg_temp.review('POLICY','{"enabled":true}'),'{}')$$,'current snapshot approval enables only the existing account policy');
select ok((select automatic_publication_baseline=1000 from private.mt5_connections),'automatic baseline fixed to approved opening amount');
update private.mt5_connections set status='ACTIVE',onboarding_approved_at=clock_timestamp(),worker_id='33333333-3333-4333-8333-333333333333',fencing_token=5,lease_expires_at=clock_timestamp()+interval '120 seconds';
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at) values('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes) values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','client_id','ffffffff-ffff-4fff-8fff-ffffffffffff',
 'session_id','22222222-2222-4222-8222-222222222222','exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/api/integrations/v1'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/api/integrations/v1')::text,true);
create function pg_temp.auto_request() returns jsonb language sql as $$
 select pg_temp.request('00000000-0000-4000-8000-000000000099')||jsonb_build_object('workerId','33333333-3333-4333-8333-333333333333','fencingToken','5',
 'operationRequest',jsonb_build_object('connectionId','cccccccc-cccc-4ccc-8ccc-cccccccccccc','captureOperationId','00000000-0000-4000-8000-000000000098'));
$$;
select lives_ok($$select private.mt5_automatic_snapshot(pg_temp.auto_request())$$,'trusted OAuth service reads only its mapped snapshot');
select throws_ok($$select private.mt5_publication_actor(pg_temp.auto_request()||'{"fencingToken":"4"}')$$,'55000','Automatic publication not authorized.','expired worker fence cannot publish');
select lives_ok($$select private.mt5_publish_execution(pg_temp.auto_request(),pg_temp.proposal(true))$$,'approved unattended closure updates the same canonical trade');
select is((select net_pnl from public.trades),98::numeric,'unattended final net equals gross100-cost3+credit1');
select is((select count(*)::integer from public.trades),1,'unattended closure retains canonical identity');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp();
select throws_ok($$select private.mt5_automatic_snapshot(pg_temp.auto_request())$$,'42501','Integration access denied.','revocation immediately denies unattended activity');
select * from finish();
rollback;

