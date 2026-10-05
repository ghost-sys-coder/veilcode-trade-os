-- Monetary precision follows the configured account, never a fixed scale.
alter table public.account_adjustments alter column amount type numeric;
alter table public.account_adjustments add constraint account_adjustments_amount_finite
  check(amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

create table private.mt5_cash_decisions (
  connection_id uuid not null references private.mt5_connections(id),
  source_ticket text not null,
  source_revision_id bigint not null,
  source_kind text not null default 'DEAL' check(source_kind='DEAL'),
  disposition text not null check(disposition in ('BASELINE_FUNDING','ADJUSTMENT','LINK_EXISTING','ZERO_EFFECT')),
  amount numeric not null check(amount not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  adjustment_id uuid unique references public.account_adjustments(id),
  actor_user_id uuid not null references auth.users(id),
  operation_id uuid not null,
  reason text not null check(length(btrim(reason)) between 8 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,source_ticket),
  foreign key(source_revision_id,connection_id,source_kind,source_ticket)
    references private.mt5_source_revisions(id,connection_id,kind,source_id),
  check((disposition in ('ADJUSTMENT','LINK_EXISTING'))=(adjustment_id is not null)),
  check((disposition='ZERO_EFFECT')=(amount=0)),
  check(disposition<>'BASELINE_FUNDING' or amount>0)
);
create index mt5_cash_decisions_source_idx on private.mt5_cash_decisions(source_revision_id,connection_id,source_kind,source_ticket);
create index mt5_cash_decisions_actor_idx on private.mt5_cash_decisions(actor_user_id);
alter table private.mt5_cash_decisions enable row level security;
revoke all on private.mt5_cash_decisions from public,anon,authenticated;
create trigger mt5_cash_decisions_immutable before update or delete on private.mt5_cash_decisions
  for each row execute function private.reject_integration_audit_mutation();

-- Synced financial evidence cannot be casually edited/deleted. Explicit OTHER
-- performance reclassification still uses the existing audited workflow.
create function private.protect_mt5_cash_adjustment() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.mt5_cash_decisions where adjustment_id=old.id) then
    if tg_op='DELETE' then raise exception 'Broker cash evidence cannot be deleted.' using errcode='42501'; end if;
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id or new.account_id is distinct from old.account_id
      or new.type is distinct from old.type or new.amount is distinct from old.amount or new.occurred_at is distinct from old.occurred_at then
      raise exception 'Broker cash facts require explicit reconciliation.' using errcode='42501';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.protect_mt5_cash_adjustment() from public,anon,authenticated;
create trigger account_adjustments_protect_mt5_cash before update or delete on public.account_adjustments
  for each row execute function private.protect_mt5_cash_adjustment();

create function private.mt5_classify_cash(p_request jsonb,p_proposal jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb; result jsonb; c private.mt5_connections; a public.trading_accounts; r private.mt5_source_revisions;
  v_amount numeric; disposition text:=p_request->>'disposition'; adjustment public.account_adjustments; adjustment_id uuid;
begin
  actor:=private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid);
  result:=private.integration_operation_result(actor,(p_request->>'operationId')::uuid,'MT5_CASH_CLASSIFICATION',p_request);
  if result is not null or p_proposal is null then return result; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or not(p_request ?& array['connectionId','operationId','version','snapshotToken','ledgerToken','sourceTicket','sourceRevisionId','disposition','adjustmentType','isPerformanceNeutral','existingAdjustmentId','reason'])
    or p_request-array['connectionId','operationId','version','snapshotToken','ledgerToken','sourceTicket','sourceRevisionId','disposition','adjustmentType','isPerformanceNeutral','existingAdjustmentId','reason']<>'{}'::jsonb
    or jsonb_typeof(p_request->'reason') is distinct from 'string'
    or jsonb_typeof(p_request->'sourceTicket') is distinct from 'string'
    or jsonb_typeof(p_request->'sourceRevisionId') is distinct from 'string'
    or disposition is null or disposition not in ('BASELINE_FUNDING','ADJUSTMENT','LINK_EXISTING','ZERO_EFFECT')
    or length(btrim(coalesce(p_request->>'reason',''))) not between 8 and 1000 then
    raise exception 'Invalid cash classification.' using errcode='22023';
  end if;
  select * into c from private.mt5_connections where id=(p_request->>'connectionId')::uuid and owner_id=auth.uid()
    and grant_id=(actor->>'grant_id')::uuid and account_id=(actor->>'account_id')::uuid for update;
  if not found then raise exception 'Connection access denied.' using errcode='42501'; end if;
  if c.status not in ('ONBOARDING','ACTIVE','PAUSED') or c.version::text is distinct from p_request->>'version'
    or private.mt5_source_snapshot_token(c.id) is distinct from p_request->>'snapshotToken' then
    raise exception 'Cash preview changed.' using errcode='40001';
  end if;
  select * into a from public.trading_accounts where id=c.account_id and user_id=auth.uid() for update;
  perform 1 from public.trades where account_id=a.id order by id for update;
  perform 1 from public.account_adjustments where account_id=a.id order by id for update;
  if a.currency_code is distinct from c.identity->>'currencyCode' or a.currency_precision is distinct from (c.identity->>'currencyPrecision')::smallint
    or private.mt5_account_ledger_token(a.id) is distinct from p_request->>'ledgerToken' then
    raise exception 'Account ledger changed.' using errcode='40001';
  end if;
  select sr.* into r from private.mt5_source_facts f join private.mt5_source_revisions sr on sr.id=f.current_revision_id
    where f.connection_id=c.id and f.kind='DEAL' and f.source_id=p_request->>'sourceTicket'
      and f.current_revision_id::text=p_request->>'sourceRevisionId' and not f.requires_review;
  if not found or r.payload->>'positionId' is not null or r.payload->>'type' not in
    ('BALANCE','CHARGE','CORRECTION','BONUS','COMMISSION','COMMISSION_DAILY','COMMISSION_MONTHLY','COMMISSION_AGENT_DAILY','COMMISSION_AGENT_MONTHLY','INTEREST','DIVIDEND','DIVIDEND_FRANKED','TAX') then
    raise exception 'Cash source requires review.' using errcode='23514';
  end if;
  v_amount:=round((r.payload->>'profit')::numeric+(r.payload->>'commission')::numeric+(r.payload->>'swap')::numeric+(r.payload->>'fee')::numeric,a.currency_precision);
  if jsonb_typeof(p_proposal->'amount') is distinct from 'string' or v_amount is null or v_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    or v_amount<>(p_proposal->>'amount')::numeric or r.payload->>'occurredAt' is distinct from p_proposal->>'occurredAt'
    or (disposition='ZERO_EFFECT')<>(v_amount=0) then
    raise exception 'Cash amount contradicts source.' using errcode='23514';
  end if;
  if exists(select 1 from private.mt5_cash_decisions where connection_id=c.id and source_ticket=r.source_id) then
    raise exception 'Cash movement already classified; explicit reconciliation required.' using errcode='23514';
  end if;
  if disposition in ('BASELINE_FUNDING','ZERO_EFFECT') then
    if p_request->>'adjustmentType' is not null or p_request->>'isPerformanceNeutral' is not null or p_request->>'existingAdjustmentId' is not null then
      raise exception 'Invalid cash classification.' using errcode='22023';
    end if;
    if disposition='BASELINE_FUNDING' and (r.payload->>'type'<>'BALANCE' or v_amount<=0 or a.starting_balance<=0
      or v_amount+coalesce((select sum(d.amount) from private.mt5_cash_decisions d where d.connection_id=c.id and d.disposition='BASELINE_FUNDING'),0)>a.starting_balance
      or (r.payload->>'occurredAt')::timestamptz>coalesce((select min((s.payload->>'occurredAt')::timestamptz)
        from private.mt5_source_facts f join private.mt5_source_revisions s on s.id=f.current_revision_id where f.connection_id=c.id
          and s.kind='DEAL' and s.payload->>'type' in ('BUY','SELL') and s.payload->>'entry' in ('IN','INOUT')),a.started_at)) then
      raise exception 'Opening funding must be represented in the preserved baseline.' using errcode='23514';
    end if;
  else
    if jsonb_typeof(p_request->'adjustmentType') is distinct from 'string'
      or p_request->>'adjustmentType' not in ('DEPOSIT','WITHDRAWAL','BALANCE_CORRECTION','OTHER')
      or jsonb_typeof(p_request->'isPerformanceNeutral') is distinct from 'boolean'
      or (p_request->>'adjustmentType'<>'OTHER' and (p_request->>'isPerformanceNeutral')::boolean is not true)
      or (p_request->>'adjustmentType'='DEPOSIT' and (r.payload->>'type'<>'BALANCE' or v_amount<=0))
      or (p_request->>'adjustmentType'='WITHDRAWAL' and (r.payload->>'type'<>'BALANCE' or v_amount>=0))
      or (p_request->>'adjustmentType'='BALANCE_CORRECTION' and r.payload->>'type'<>'CORRECTION') then
      raise exception 'Cash adjustment classification contradicts source.' using errcode='23514';
    end if;
    if disposition='LINK_EXISTING' then
      select * into adjustment from public.account_adjustments where id=(p_request->>'existingAdjustmentId')::uuid and account_id=a.id and user_id=auth.uid();
      if not found or adjustment.amount<>v_amount or adjustment.type::text is distinct from p_request->>'adjustmentType'
        or adjustment.is_performance_neutral is distinct from (p_request->>'isPerformanceNeutral')::boolean then
        raise exception 'Existing adjustment does not match this cash movement.' using errcode='23514';
      end if;
      adjustment_id:=adjustment.id;
    else
      if p_request->>'existingAdjustmentId' is not null then raise exception 'Invalid cash classification.' using errcode='22023'; end if;
      if exists(select 1 from public.account_adjustments j where j.account_id=a.id and j.amount=v_amount and j.occurred_at=(r.payload->>'occurredAt')::timestamptz) then
        raise exception 'Possible existing adjustment requires explicit linking.' using errcode='23514';
      end if;
      insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at,notes,is_performance_neutral,classification_reason)
      values(auth.uid(),a.id,(p_request->>'adjustmentType')::public.adjustment_type,v_amount,(r.payload->>'occurredAt')::timestamptz,
        btrim(p_request->>'reason'),(p_request->>'isPerformanceNeutral')::boolean,btrim(p_request->>'reason')) returning id into adjustment_id;
    end if;
  end if;
  insert into private.mt5_cash_decisions(connection_id,source_ticket,source_revision_id,disposition,amount,adjustment_id,actor_user_id,operation_id,reason)
    values(c.id,r.source_id,r.id,disposition,v_amount,adjustment_id,auth.uid(),(p_request->>'operationId')::uuid,btrim(p_request->>'reason'));
  update private.mt5_connections set version=version+1 where id=c.id returning * into c;
  result:=jsonb_build_object('connectionId',c.id,'version',c.version::text,'sourceTicket',r.source_id,'adjustmentId',adjustment_id);
  perform private.record_integration_operation(actor,(p_request->>'operationId')::uuid,'MT5_CASH_CLASSIFICATION',p_request,result,jsonb_build_array(c.id,adjustment_id),
    jsonb_build_object('actorType','BROWSER','sourceRevisionId',r.id::text,'disposition',disposition,'amount',v_amount::text,
      'adjustmentType',p_request->'adjustmentType','isPerformanceNeutral',p_request->'isPerformanceNeutral','existingOccurredAt',adjustment.occurred_at,'reason',btrim(p_request->>'reason')));
  return result;
end;
$$;
revoke all on function private.mt5_classify_cash(jsonb,jsonb) from public,anon,authenticated;

create table private.mt5_onboarding_approvals (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null references private.mt5_connections(id),
  actor_user_id uuid not null references auth.users(id), operation_id uuid not null, request jsonb not null, proof jsonb not null,
  source_token text not null, ledger_token text not null, capture_checkpoint timestamptz not null,
  created_at timestamptz not null default clock_timestamp(), unique(connection_id,operation_id)
);
create index mt5_onboarding_approvals_actor_idx on private.mt5_onboarding_approvals(actor_user_id);
alter table private.mt5_onboarding_approvals enable row level security;
revoke all on private.mt5_onboarding_approvals from public,anon,authenticated;
create trigger mt5_onboarding_approvals_immutable before update or delete on private.mt5_onboarding_approvals
  for each row execute function private.reject_integration_audit_mutation();

create function private.mt5_approve_onboarding(p_request jsonb,p_proposal jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb; result jsonb; c private.mt5_connections; a public.trading_accounts; item jsonb;
  observed private.mt5_source_revisions; ledger numeric; open_cash numeric; approval_id uuid;
begin
  actor:=private.mt5_browser_publication_actor((p_request->>'connectionId')::uuid);
  result:=private.integration_operation_result(actor,(p_request->>'operationId')::uuid,'MT5_ONBOARDING_APPROVAL',p_request);
  if result is not null or p_proposal is null then return result; end if;
  if jsonb_typeof(p_request) is distinct from 'object'
    or not(p_request ?& array['connectionId','operationId','version','snapshotToken','ledgerToken','reason','openingBaseline','availableHistoryConfirmed'])
    or p_request-array['connectionId','operationId','version','snapshotToken','ledgerToken','reason','openingBaseline','availableHistoryConfirmed']<>'{}'::jsonb
    or jsonb_typeof(p_request->'openingBaseline') is distinct from 'string'
    or (p_request->>'openingBaseline') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    or jsonb_typeof(p_request->'reason') is distinct from 'string'
    or p_request->'availableHistoryConfirmed' is distinct from 'true'::jsonb
    or length(btrim(coalesce(p_request->>'reason',''))) not between 8 and 1000 or jsonb_typeof(p_proposal->'episodes') is distinct from 'array' then
    raise exception 'Explicit captured-history approval required.' using errcode='22023';
  end if;
  select * into c from private.mt5_connections where id=(p_request->>'connectionId')::uuid and owner_id=auth.uid()
    and grant_id=(actor->>'grant_id')::uuid and account_id=(actor->>'account_id')::uuid for update;
  if not found then raise exception 'Connection access denied.' using errcode='42501'; end if;
  if c.status not in ('ONBOARDING','ACTIVE','PAUSED') or c.version::text is distinct from p_request->>'version'
    or c.capture_checkpoint is null or private.mt5_source_snapshot_token(c.id) is distinct from p_request->>'snapshotToken'
    or exists(select 1 from private.mt5_capture_progress where connection_id=c.id and received_batch_count<expected_batch_count)
    or exists(select 1 from private.mt5_source_facts where connection_id=c.id and requires_review) then
    raise exception 'Onboarding source requires review.' using errcode='40001';
  end if;
  select * into a from public.trading_accounts where id=c.account_id and user_id=auth.uid() for update;
  perform 1 from public.trades where account_id=a.id order by id for update;
  perform 1 from public.account_adjustments where account_id=a.id order by id for update;
  if a.starting_balance<=0 or a.starting_balance<>round((p_request->>'openingBaseline')::numeric,a.currency_precision)
    or a.currency_code is distinct from c.identity->>'currencyCode' or a.currency_precision is distinct from (c.identity->>'currencyPrecision')::smallint
    or private.mt5_account_ledger_token(a.id) is distinct from p_request->>'ledgerToken' then
    raise exception 'Onboarding account ledger changed.' using errcode='40001';
  end if;
  if exists(select 1 from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id
    where f.connection_id=c.id and f.kind='DEAL' and r.payload->>'positionId' is null and not exists
      (select 1 from private.mt5_cash_decisions d where d.connection_id=c.id and d.source_revision_id=r.id))
    or exists(select 1 from public.account_adjustments where account_id=a.id and type='OTHER' and is_performance_neutral is null) then
    raise exception 'Cash classifications require review.' using errcode='23514';
  end if;
  for item in select value from jsonb_array_elements(p_proposal->'episodes') loop
    if not exists(select 1 from public.trades t join private.mt5_execution_versions v on v.trade_id=t.id and v.execution_version=t.mt5_execution_version
      where t.mt5_connection_id=c.id and t.external_trade_id=item->>'canonicalIdentity' and v.execution=item) then
      raise exception 'Canonical executions must match the current source snapshot.' using errcode='23514';
    end if;
  end loop;
  if (select count(*) from public.trades where mt5_connection_id=c.id)<>jsonb_array_length(p_proposal->'episodes')
    or (select count(distinct value->>'canonicalIdentity') from jsonb_array_elements(p_proposal->'episodes'))<>jsonb_array_length(p_proposal->'episodes')
    or exists(select 1 from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id
      where f.connection_id=c.id and f.kind='DEAL' and r.payload->>'positionId' is not null and not exists
        (select 1 from private.mt5_execution_sources s join private.mt5_execution_versions v on v.id=s.execution_id
          join public.trades t on t.id=v.trade_id and t.mt5_execution_version=v.execution_version
          where s.connection_id=c.id and s.revision_id=r.id)) then
    raise exception 'Every captured execution requires canonical review.' using errcode='23514';
  end if;
  select r.* into observed from private.mt5_source_facts f join private.mt5_source_revisions r on r.id=f.current_revision_id
    where f.connection_id=c.id and f.kind='ACCOUNT' and r.observed_at>=c.capture_checkpoint;
  if not found then raise exception 'Current broker balance observation required.' using errcode='23514'; end if;
  ledger:=a.starting_balance+coalesce((select sum(net_pnl) from public.trades where account_id=a.id and status='CLOSED' and closed_at is not null),0)
    +coalesce((select sum(amount) from public.account_adjustments where account_id=a.id),0);
  select coalesce(sum((v.execution->>'recognizedCash')::numeric),0) into open_cash from private.mt5_execution_versions v
    join public.trades t on t.id=v.trade_id and t.mt5_execution_version=v.execution_version where t.mt5_connection_id=c.id and t.status='OPEN';
  if round(ledger+open_cash,a.currency_precision)<>round((observed.payload->>'balance')::numeric,a.currency_precision)
    or (p_proposal->'bridge'->>'unexplainedDifference')::numeric is distinct from 0::numeric then
    raise exception 'Broker balance remains unreconciled.' using errcode='23514';
  end if;
  insert into private.mt5_onboarding_approvals(connection_id,actor_user_id,operation_id,request,proof,source_token,ledger_token,capture_checkpoint)
    values(c.id,auth.uid(),(p_request->>'operationId')::uuid,p_request,p_proposal,p_request->>'snapshotToken',p_request->>'ledgerToken',c.capture_checkpoint) returning id into approval_id;
  update private.mt5_connections set onboarding_approved_at=clock_timestamp(),version=version+1,
    status=case when status='PAUSED' then 'PAUSED' else 'ACTIVE' end where id=c.id returning * into c;
  result:=jsonb_build_object('connectionId',c.id,'version',c.version::text,'approvalId',approval_id,'reconciliationState','APPROVED_SNAPSHOT');
  perform private.record_integration_operation(actor,(p_request->>'operationId')::uuid,'MT5_ONBOARDING_APPROVAL',p_request,result,jsonb_build_array(c.id,approval_id),
    jsonb_build_object('actorType','BROWSER','reason',btrim(p_request->>'reason'),'openingBaseline',a.starting_balance::text,
      'ledgerBalance',ledger::text,'openCash',open_cash::text,'brokerBalance',observed.payload->>'balance','captureCheckpoint',c.capture_checkpoint));
  return result;
end;
$$;
revoke all on function private.mt5_approve_onboarding(jsonb,jsonb) from public,anon,authenticated;

create function private.mt5_browser_source_page_with_cash(p_connection_id uuid,p_offset integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; decisions jsonb; adjustments jsonb; approval jsonb;
begin
  perform private.require_direct_browser_session();
  result:=private.mt5_browser_source_page_with_mappings(p_connection_id,p_offset,p_limit);
  select coalesce(jsonb_agg(jsonb_build_object('sourceTicket',d.source_ticket,'sourceRevisionId',d.source_revision_id::text,
    'disposition',d.disposition,'amount',d.amount::text,'adjustmentId',d.adjustment_id,'reason',d.reason,'createdAt',d.created_at)
    order by d.source_ticket),'[]'::jsonb) into decisions from
    (select * from private.mt5_cash_decisions where connection_id=p_connection_id order by source_ticket limit p_limit offset p_offset) d;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'type',j.type,'amount',j.amount::text,'occurredAt',j.occurred_at,
    'isPerformanceNeutral',j.is_performance_neutral) order by j.id),'[]'::jsonb) into adjustments from
    (select j.* from public.account_adjustments j join private.mt5_connections c on c.account_id=j.account_id
      where c.id=p_connection_id and j.user_id=auth.uid() order by j.id limit p_limit offset p_offset) j;
  select jsonb_build_object('createdAt',a.created_at,'captureCheckpoint',a.capture_checkpoint,'state',
    case when a.source_token=result->>'snapshotToken' and a.ledger_token=result->>'ledgerToken'
      and a.capture_checkpoint=(result->>'captureCheckpoint')::timestamptz
      and (result->>'incompleteCollections')::integer=0 then 'APPROVED_SNAPSHOT' else 'STALE_APPROVAL' end)
    into approval from private.mt5_onboarding_approvals a where a.connection_id=p_connection_id order by created_at desc,id desc limit 1;
  return result||jsonb_build_object('cashDecisions',decisions,'cashDecisionCount',(select count(*) from private.mt5_cash_decisions where connection_id=p_connection_id),
    'adjustments',adjustments,'adjustmentCount',(select count(*) from public.account_adjustments where account_id=(select account_id from private.mt5_connections where id=p_connection_id)),
    'onboardingApproval',approval);
end;
$$;
revoke all on function private.mt5_browser_source_page_with_cash(uuid,integer,integer) from public,anon;
grant execute on function private.mt5_browser_source_page_with_cash(uuid,integer,integer) to authenticated;
create or replace function public.mt5_browser_source_page(p_connection_id uuid,p_offset integer default 0,p_limit integer default 1000)
returns jsonb language sql security invoker set search_path='' as $$ select private.mt5_browser_source_page_with_cash(p_connection_id,p_offset,p_limit); $$;
