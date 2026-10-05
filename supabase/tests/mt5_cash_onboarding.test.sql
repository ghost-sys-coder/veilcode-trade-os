begin;
create extension if not exists pgtap with schema extensions;
select plan(54);
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
      from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id where f.connection_id=c.id and f.kind='DEAL' and r.payload->>'positionId'='100'),
    'allocations',jsonb_build_array(jsonb_build_object('dealTicket','10','part','OPEN','volume','1','grossPnl','0','commission','-2','swap','0','fee','0','convention','BROKER_FACT')))))
  from private.mt5_connections c cross join public.instruments i where i.symbol='EURUSD' and i.user_id is null;
$$;

-- Cash facts: opening funding 1000; new deposit 250; withdrawal -50;
-- charge -5 plus fee -0.125 => -5.13 USD. Existing partial cash =18.
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select 'cccccccc-cccc-4ccc-8ccc-cccccccccccc','DEAL',ticket,'2026-01-03T00:00:00Z',
 jsonb_build_object('ticket',ticket,'orderId',null,'positionId',null,'symbol',null,'type',case when ticket='103' then 'CHARGE' else 'BALANCE' end,
 'entry',null,'volume','0','price','0','profit',case ticket when '100' then '1000' when '101' then '250' when '102' then '-50' when '103' then '-5' else '0.004' end,
 'commission','0','swap','0','fee',case when ticket='103' then '-0.125' else '0' end,
 'occurredAt',case when ticket='100' then '2025-12-30T00:00:00.000Z' else '2026-01-03T00:00:00.000Z' end),repeat('a',64),1,gen_random_uuid()
from unnest(array['100','101','102','103','105']) ticket;
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select r.connection_id,r.kind,r.source_id,r.id,r.observed_at from private.mt5_source_revisions r where r.source_id in ('100','101','102','103','105');
create function pg_temp.cash_request(ticket text,disposition text,adjustment_type text default null,neutral boolean default null,existing_id uuid default null,operation uuid default gen_random_uuid()) returns jsonb language sql as $$
 select jsonb_build_object('connectionId',c.id,'version',c.version::text,'operationId',operation,'snapshotToken',private.mt5_source_snapshot_token(c.id),
 'ledgerToken',private.mt5_account_ledger_token(c.account_id),'sourceTicket',ticket,'sourceRevisionId',f.current_revision_id::text,
 'disposition',disposition,'adjustmentType',adjustment_type,'isPerformanceNeutral',neutral,'existingAdjustmentId',existing_id,'reason','Confirmed source cash attribution')
 from private.mt5_connections c join private.mt5_source_facts f on f.connection_id=c.id and f.source_id=ticket and f.kind='DEAL';
$$;
create function pg_temp.cash_proposal(ticket text) returns jsonb language sql as $$
 select jsonb_build_object('amount',round((r.payload->>'profit')::numeric+(r.payload->>'commission')::numeric+(r.payload->>'swap')::numeric+(r.payload->>'fee')::numeric,
 (c.identity->>'currencyPrecision')::integer)::text,'occurredAt',r.payload->>'occurredAt') from private.mt5_source_revisions r
 join private.mt5_source_facts f on f.current_revision_id=r.id join private.mt5_connections c on c.id=r.connection_id where f.source_id=ticket and f.kind='DEAL';
$$;
create function pg_temp.onboarding_request(operation uuid default gen_random_uuid()) returns jsonb language sql as $$
 select pg_temp.request(operation)-'episodeIdentities'||'{"availableHistoryConfirmed":true}'::jsonb;
$$;
create function pg_temp.onboarding_proposal() returns jsonb language sql as $$
 select pg_temp.proposal()||'{"bridge":{"unexplainedDifference":"0.00"}}'::jsonb;
$$;
select ok(not has_function_privilege('authenticated','private.mt5_classify_cash(jsonb,jsonb)','EXECUTE'),'browser cannot submit trusted cash proposals');
select ok(not has_function_privilege('anon','private.mt5_approve_onboarding(jsonb,jsonb)','EXECUTE'),'anonymous cannot approve onboarding');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','ADJUSTMENT','DEPOSIT',false),pg_temp.cash_proposal('101'))$$,'23514','Cash adjustment classification contradicts source.','fixed cash types cannot be performance-affecting');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('102','ADJUSTMENT','DEPOSIT',true),pg_temp.cash_proposal('102'))$$,'23514','Cash adjustment classification contradicts source.','negative deposit rejected');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('103','ADJUSTMENT','OTHER',null),pg_temp.cash_proposal('103'))$$,'23514','Cash adjustment classification contradicts source.','OTHER cannot use unanswered classification');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','ADJUSTMENT','DEPOSIT',true),pg_temp.cash_proposal('101')||'{"amount":"999"}')$$,'23514','Cash amount contradicts source.','financial proposal corroborated against durable source');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','ADJUSTMENT','DEPOSIT',true)||'{"version":"999"}',pg_temp.cash_proposal('101'))$$,'40001','Cash preview changed.','stale cash preview rejected');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','ADJUSTMENT','DEPOSIT',true)||'{"ownerId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}',pg_temp.cash_proposal('101'))$$,'22023','Invalid cash classification.','database rejects arbitrary owner injection');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','ADJUSTMENT','DEPOSIT',true)||'{"adjustmentType":null}',pg_temp.cash_proposal('101'))$$,'23514','Cash adjustment classification contradicts source.','null adjustment type never passes SQL three-valued logic');
select set_config('mt5.cash_funding',pg_temp.cash_request('100','BASELINE_FUNDING',null,null,null,'00000000-0000-4000-8000-000000000010')::text,true);
select lives_ok($$select private.mt5_classify_cash(current_setting('mt5.cash_funding')::jsonb,pg_temp.cash_proposal('100'))$$,'opening funding remains provenance');
select is((select count(*)::integer from public.account_adjustments),0,'baseline funding not counted twice');
select lives_ok($$select private.mt5_classify_cash(current_setting('mt5.cash_funding')::jsonb)$$,'lost cash acknowledgement returns receipt before changed version');
select is((select count(*)::integer from private.mt5_cash_decisions),1,'retry adds no duplicate cash decision');
select throws_ok($$select private.mt5_classify_cash(current_setting('mt5.cash_funding')::jsonb||'{"reason":"Changed funding reason"}')$$,'23505','Operation payload conflict.','changed cash retry rejected');
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','BASELINE_FUNDING'),pg_temp.cash_proposal('101'))$$,'23514','Opening funding must be represented in the preserved baseline.','later funding cannot be absorbed into original baseline');
select lives_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','ADJUSTMENT','DEPOSIT',true),pg_temp.cash_proposal('101'))$$,'classified deposit adds one account adjustment');
select is((select amount from public.account_adjustments where type='DEPOSIT'),250::numeric,'source-derived deposit stored exactly');
insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at)
select owner_id,account_id,'WITHDRAWAL',-50,'2026-01-03T00:00:00Z' from private.mt5_connections;
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('102','ADJUSTMENT','WITHDRAWAL',true),pg_temp.cash_proposal('102'))$$,'23514','Possible existing adjustment requires explicit linking.','manual cash duplicate held for linking');
select lives_ok($$select private.mt5_classify_cash(pg_temp.cash_request('102','LINK_EXISTING','WITHDRAWAL',true,(select id from public.account_adjustments where type='WITHDRAWAL')),pg_temp.cash_proposal('102'))$$,'matching manual adjustment linked explicitly');
select is((select count(*)::integer from public.account_adjustments),2,'linking adds no second withdrawal');
create function pg_temp.fail_cash_audit() returns trigger language plpgsql as $$begin raise exception 'Injected cash audit failure' using errcode='23514'; end;$$;
create trigger injected_cash_failure before insert on private.mt5_cash_decisions for each row execute function pg_temp.fail_cash_audit();
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('103','ADJUSTMENT','OTHER',false),pg_temp.cash_proposal('103'))$$,'23514','Injected cash audit failure','cash adjustment and provenance are atomic');
select is((select count(*)::integer from public.account_adjustments),2,'audit failure rolls back adjustment');
drop trigger injected_cash_failure on private.mt5_cash_decisions;
select lives_ok($$select private.mt5_classify_cash(pg_temp.cash_request('103','ADJUSTMENT','OTHER',false),pg_temp.cash_proposal('103'))$$,'explicit performance-affecting OTHER accepted');
select is((select amount from public.account_adjustments where type='OTHER'),-5.13::numeric,'signed components summed before account precision normalization');
select lives_ok($$select private.mt5_classify_cash(pg_temp.cash_request('105','ZERO_EFFECT'),pg_temp.cash_proposal('105'))$$,'normalized zero preserved as evidence without invalid zero adjustment');
select is((select count(*)::integer from public.account_adjustments),3,'zero effect creates no monetary adjustment');
select throws_ok($$update public.account_adjustments set amount=amount+1 where type='DEPOSIT'$$,'42501','Broker cash facts require explicit reconciliation.','direct broker cash amount rewrite rejected');
select throws_ok($$delete from public.account_adjustments where type='WITHDRAWAL'$$,'42501','Broker cash evidence cannot be deleted.','linked financial evidence protected from deletion');
select lives_ok($$select public.classify_account_adjustment((select id from public.account_adjustments where type='OTHER'),true,'Reviewed cash-only impact evidence')$$,'OTHER remains explicitly reclassifiable via audited workflow');
select is((select count(*)::integer from public.account_adjustment_classifications),1,'classification change retains audit');
select throws_ok($$delete from private.mt5_cash_decisions$$,'42501',null,'cash attribution history is append-only');
select throws_ok($$select private.mt5_approve_onboarding(pg_temp.onboarding_request(),pg_temp.onboarding_proposal())$$,'23514','Canonical executions must match the current source snapshot.','unpublished executions cannot become approved onboarding');
select lives_ok($$select private.mt5_publish_browser(pg_temp.request(),pg_temp.proposal())$$,'all captured execution published before onboarding approval');
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','ACCOUNT','ACCOUNT','2026-01-03T00:00:00Z',
 '{"balance":"1212.87","equity":"1212.87","unrealizedPnl":"0","observedAt":"2026-01-03T00:00:00.000Z"}',repeat('a',64),1,gen_random_uuid());
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,id,observed_at from private.mt5_source_revisions where kind='ACCOUNT';
select throws_ok($$select private.mt5_approve_onboarding(pg_temp.onboarding_request()||'{"availableHistoryConfirmed":false}',pg_temp.onboarding_proposal())$$,'22023','Explicit captured-history approval required.','placeholder confirmation never counts as approval');
select throws_ok($$select private.mt5_approve_onboarding(pg_temp.onboarding_request()||'{"openingBaseline":null}',pg_temp.onboarding_proposal())$$,'22023','Explicit captured-history approval required.','null baseline cannot bypass database approval checks');
create function pg_temp.fail_onboarding_audit() returns trigger language plpgsql as $$begin raise exception 'Injected onboarding audit failure' using errcode='23514'; end;$$;
create trigger injected_onboarding_failure before insert on private.integration_mutation_audits for each row execute function pg_temp.fail_onboarding_audit();
select throws_ok($$select private.mt5_approve_onboarding(pg_temp.onboarding_request(),pg_temp.onboarding_proposal())$$,'23514','Injected onboarding audit failure','onboarding proof and audit are atomic');
select is((select count(*)::integer from private.mt5_onboarding_approvals),0,'failed audit rolls back onboarding proof');
select ok((select onboarding_approved_at is null from private.mt5_connections),'failed audit rolls back completion marker');
drop trigger injected_onboarding_failure on private.integration_mutation_audits;
update private.mt5_connections set status='PAUSED';
select set_config('mt5.onboarding_request',pg_temp.onboarding_request('00000000-0000-4000-8000-000000000011')::text,true);
select lives_ok($$select private.mt5_approve_onboarding(current_setting('mt5.onboarding_request')::jsonb,pg_temp.onboarding_proposal())$$,'1000 +250 -50 -5.13 +18 open cash matches 1212.87 broker balance');
select ok((select onboarding_approved_at is not null from private.mt5_connections),'explicit approval completion timestamp stored');
select is((select status::text from private.mt5_connections),'PAUSED','onboarding never resumes a paused collector');
select is(private.mt5_approve_onboarding(current_setting('mt5.onboarding_request')::jsonb)->>'reconciliationState','APPROVED_SNAPSHOT','lost onboarding acknowledgement replays immutable receipt');
select is((select count(*)::integer from private.mt5_onboarding_approvals),1,'approval retry creates one proof snapshot');
select is(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc')->'onboardingApproval'->>'state','APPROVED_SNAPSHOT','matching source and ledger approval visible');
update private.mt5_connections set capture_checkpoint='2026-01-04T00:00:00Z';
select is(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc')->'onboardingApproval'->>'state','STALE_APPROVAL','new checkpoint cannot reuse approval even if facts are unchanged');
update private.mt5_connections set capture_checkpoint='2026-01-03T00:00:00Z';
insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at)
select owner_id,account_id,'DEPOSIT',1,'2026-01-04T00:00:00Z' from private.mt5_connections;
select is(public.mt5_browser_source_page('cccccccc-cccc-4ccc-8ccc-cccccccccccc')->'onboardingApproval'->>'state','STALE_APPROVAL','new ledger evidence invalidates current reconciliation claim');
select throws_ok($$select private.mt5_approve_onboarding(pg_temp.onboarding_request(),pg_temp.onboarding_proposal())$$,'23514','Broker balance remains unreconciled.','balance discrepancy cannot be approved');
select throws_ok($$delete from private.mt5_onboarding_approvals$$,'42501',null,'approval proof is append-only');
select lives_ok($$delete from public.account_adjustments where amount=1$$,'ordinary unsynced manual adjustments retain existing deletion behavior');
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select connection_id,kind,'104',observed_at,payload||'{"ticket":"104","type":"CREDIT","profit":"100"}',payload_hash,fencing_token,gen_random_uuid()
from private.mt5_source_revisions where source_id='101';
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,id,observed_at from private.mt5_source_revisions where source_id='104';
select throws_ok($$select private.mt5_classify_cash(pg_temp.cash_request('104','ADJUSTMENT','OTHER',true),pg_temp.cash_proposal('104'))$$,'23514','Cash source requires review.','broker credit facility never silently becomes cash or trading credit');
select throws_ok($$select private.mt5_approve_onboarding(pg_temp.onboarding_request(),pg_temp.onboarding_proposal())$$,'23514','Cash classifications require review.','unresolved credit facility blocks authoritative reconciliation');
update public.trading_accounts set currency_precision=20 where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
update private.mt5_connections set identity=identity||'{"currencyPrecision":20}';
insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
select connection_id,kind,'106',observed_at,payload||'{"ticket":"106","type":"CHARGE","profit":"-0.000000000000000001"}',payload_hash,fencing_token,gen_random_uuid()
from private.mt5_source_revisions where source_id='101';
insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at)
select connection_id,kind,source_id,id,observed_at from private.mt5_source_revisions where source_id='106';
select lives_ok($$select private.mt5_classify_cash(pg_temp.cash_request('106','ADJUSTMENT','OTHER',false),pg_temp.cash_proposal('106'))$$,'precision 20 representable small charge remains a nonzero adjustment');
select is((select amount from public.account_adjustments where amount>-0.001 and amount<0),-0.000000000000000001::numeric,'storage preserves account precision without legacy numeric scale drift');
select set_config('request.jwt.claims',(auth.jwt()||jsonb_build_object('client_id','ffffffff-ffff-4fff-8fff-ffffffffffff'))::text,true);
select throws_ok($$select private.mt5_approve_onboarding(pg_temp.onboarding_request(),pg_temp.onboarding_proposal())$$,'42501','A direct browser session is required.','OAuth collector cannot approve onboarding');
select * from finish();
rollback;
