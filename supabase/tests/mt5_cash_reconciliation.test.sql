begin;
create extension if not exists pgtap with schema extensions;
select plan(21);
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

create function pg_temp.review_cash(extra jsonb,operation uuid default gen_random_uuid()) returns jsonb language sql as $$
 select jsonb_build_object('connectionId',c.id,'version',c.version::text,'operationId',operation,
 'snapshotToken',private.mt5_source_snapshot_token(c.id),'ledgerToken',private.mt5_account_ledger_token(c.account_id),'reason','Verified revised broker cash evidence')||extra
 from private.mt5_connections c;
$$;
create function pg_temp.revise_cash(amount text) returns void language plpgsql as $$
declare next_revision bigint;
begin
 insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
 select f.connection_id,f.kind,f.source_id,r.observed_at+interval '1 minute',r.payload||jsonb_build_object('profit',amount),repeat('b',64),1,gen_random_uuid()
 from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id where f.source_id='101'
 returning id into next_revision;
 update private.mt5_source_facts set current_revision_id=next_revision,requires_review=true where source_id='101';
end;
$$;
create function pg_temp.review_extra(review_type text,neutral boolean default true) returns jsonb language sql as $$
 select jsonb_build_object('reviewKind',review_type,'sourceId','101','sourceRevisionId',current_revision_id::text)||
 case when review_type='SOURCE' then '{"sourceKind":"DEAL"}'::jsonb else jsonb_build_object('isPerformanceNeutral',neutral) end
 from private.mt5_source_facts where source_id='101';
$$;
select lives_ok($$select private.mt5_classify_cash(pg_temp.cash_request('101','ADJUSTMENT','DEPOSIT',true),pg_temp.cash_proposal('101'))$$,'original deposit attributed once');
select pg_temp.revise_cash('255');
select throws_ok($$select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('CASH')),'{"amount":"255.00"}')$$,'23514','Reviewed supported cash revision required.','unreviewed cash cannot be reconciled');
select lives_ok($$select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('SOURCE')),'{}')$$,'raw revised cash reviewed explicitly');
select throws_ok($$select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('CASH')),'{"amount":"999"}')$$,'23514','Reconciliation amount contradicts source.','submitted cash amount is corroborated');
select set_config('cash.review',pg_temp.review_cash(pg_temp.review_extra('CASH'),'00000000-0000-4000-8000-000000000080')::text,true);
select lives_ok($$select private.mt5_review_request(current_setting('cash.review')::jsonb,'{"amount":"255.00"}')$$,'reconciliation records only the plus5 normalized delta');
select is((select count(*)::integer from public.account_adjustments),2,'one original deposit and one delta adjustment');
select is((select sum(amount) from public.account_adjustments),255::numeric,'cash not double-counted as a second255 deposit');
select is((select amount from private.mt5_cash_decisions where source_ticket='101'),250::numeric,'original classification remains immutable');
select is((select disposition from private.mt5_current_cash_decisions where source_ticket='101'),'RECONCILED','effective classification is labelled reconciled rather than fabricated original funding');
select is((select amount from private.mt5_current_cash_decisions where source_ticket='101'),255::numeric,'current effective source amount is explicit');
select lives_ok($$select private.mt5_review_request(current_setting('cash.review')::jsonb,'{"amount":"255.00"}')$$,'lost acknowledgement returns the original review receipt');
select is((select count(*)::integer from public.account_adjustments),2,'replay adds no financial effect');
select pg_temp.revise_cash('260');
select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('SOURCE')),'{}');
select lives_ok($$select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('CASH',false)),'{"amount":"260.00"}')$$,'second revision uses current255 basis rather than original250');
select is((select sum(amount) from public.account_adjustments),260::numeric,'second delta is5 not10');
select is((select count(*)::integer from public.account_adjustments where type='OTHER' and is_performance_neutral=false),1,'performance-affecting delta classification is explicit');
select pg_temp.revise_cash('260');
select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('SOURCE')),'{}');
select lives_ok($$select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('CASH')),'{"amount":"260.00"}')$$,'changed nonfinancial source with same normalized amount updates attribution without money');
select is((select count(*)::integer from public.account_adjustments),3,'zero delta creates no invalid zero adjustment');
select pg_temp.revise_cash('261');
select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('SOURCE')),'{}');
select throws_ok($$select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('CASH',null)),'{"amount":"261.00"}')$$,'23514','Reviewed supported cash revision required.','unanswered delta classification is not false');
create function pg_temp.reject_review_audit() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure' using errcode='22023'; end $$;
create trigger fixture_reject_review_audit before insert on private.integration_mutation_audits for each row execute function pg_temp.reject_review_audit();
select throws_ok($$select private.mt5_review_request(pg_temp.review_cash(pg_temp.review_extra('CASH')),'{"amount":"261.00"}')$$,'22023','Injected audit failure','audit failure rolls back reconciliation and delta atomically');
select is((select sum(amount) from public.account_adjustments),260::numeric,'failed reconciliation leaves account ledger unchanged');
select is((select amount from private.mt5_current_cash_decisions where source_ticket='101'),260::numeric,'failed reconciliation leaves effective source interpretation unchanged');
select * from finish();
rollback;
