alter table private.mt5_connections add column onboarding_approved_at timestamptz;

create function private.mt5_list_connections() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_direct_browser_session();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'accountId',c.account_id,'grantId',c.grant_id,'identity',c.identity,'status',c.status,
    'version',c.version::text,'attentionCode',c.attention_code,'onboardingApprovedAt',c.onboarding_approved_at,
    'lastHeartbeatAt',c.last_heartbeat_at,'lastSyncAt',c.last_sync_at,'captureCheckpoint',c.capture_checkpoint,
    'healthObservedAt',clock_timestamp(),'heartbeatStale',coalesce(c.last_heartbeat_at<clock_timestamp()-interval '120 seconds',false),
    'sourceFactCount',(select count(*) from private.mt5_source_facts f where f.connection_id=c.id),
    'reviewCount',(select count(*) from private.mt5_source_facts f where f.connection_id=c.id and f.requires_review),
    'incompleteCollections',(select count(*) from private.mt5_capture_progress p where p.connection_id=c.id and p.received_batch_count<p.expected_batch_count),
    'missingServerBatches',(select coalesce(sum(p.expected_batch_count-p.received_batch_count),0) from private.mt5_capture_progress p where p.connection_id=c.id),
    'publishedTradeCount',(select count(*) from public.trades t where t.mt5_connection_id=c.id)
  ) order by c.created_at,c.id) from private.mt5_connections c where c.owner_id=auth.uid()),'[]'::jsonb);
end;
$$;

create function private.mt5_source_snapshot_token(p_connection_id uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select encode(extensions.digest(coalesce(string_agg(f.kind||':'||f.source_id||':'||f.current_revision_id::text||':'||f.requires_review::text,
    ',' order by f.kind,f.source_id),'EMPTY'),'sha256'),'hex') from private.mt5_source_facts f where f.connection_id=p_connection_id;
$$;
revoke all on function private.mt5_source_snapshot_token(uuid) from public,anon,authenticated;

create function private.mt5_browser_source_page(p_connection_id uuid,p_offset integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.mt5_connections; result jsonb; account_context jsonb; ledger_token text; existing_trades jsonb;
begin
  perform private.require_direct_browser_session();
  if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'Invalid source page.' using errcode='22023';
  end if;
  select * into c from private.mt5_connections where id=p_connection_id and owner_id=auth.uid() for share;
  if not found then raise exception 'Connection access denied.' using errcode='42501'; end if;
  -- Text casts preserve exact numeric values at the API boundary. These sums
  -- include ALL account rows, never PostgREST's default pagination window.
  select jsonb_build_object('name',a.name,'currencyCode',a.currency_code,'currencyPrecision',a.currency_precision,
    'startingBalance',a.starting_balance::text,'ledgerBalance',
    (a.starting_balance + coalesce((select sum(t.net_pnl) from public.trades t where t.account_id=a.id and t.status='CLOSED' and t.closed_at is not null),0)
      +coalesce((select sum(j.amount) from public.account_adjustments j where j.account_id=a.id),0))::text),
    encode(extensions.digest(a::text||coalesce((select string_agg(t::text,',' order by t.id) from public.trades t where t.account_id=a.id),'')
      ||coalesce((select string_agg(j::text,',' order by j.id) from public.account_adjustments j where j.account_id=a.id),''),'sha256'),'hex')
    into account_context,ledger_token from public.trading_accounts a where a.id=c.account_id and a.user_id=auth.uid();
  if account_context is null then raise exception 'Connection access denied.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'symbol',i.symbol,'direction',t.direction,
    'openedAt',t.opened_at,'closedAt',t.closed_at,
    'canonicalIdentity',case when t.mt5_connection_id=c.id then t.external_trade_id else null end,
    'closedNetPnl',case when t.status='CLOSED' and t.closed_at is not null then t.net_pnl::text else null end) order by t.id),'[]'::jsonb)
    into existing_trades from (select * from public.trades where account_id=c.account_id order by id limit p_limit offset p_offset) t
    join public.instruments i on i.id=t.instrument_id;
  select coalesce(jsonb_agg(jsonb_build_object('kind',r.kind,'sourceId',r.source_id,'revisionId',r.id::text,
    'observedAt',r.observed_at,'requiresReview',page.requires_review,'payload',r.payload) order by r.kind,r.source_id),'[]'::jsonb)
    into result from (select f.* from private.mt5_source_facts f where f.connection_id=c.id order by f.kind,f.source_id limit p_limit offset p_offset) page
    join private.mt5_source_revisions r on r.id=page.current_revision_id;
  return jsonb_build_object('connectionId',c.id,'snapshotToken',private.mt5_source_snapshot_token(c.id),'version',c.version::text,
    'captureCheckpoint',c.capture_checkpoint,'identity',c.identity,'events',result,'account',account_context,'ledgerToken',ledger_token,
    'trades',existing_trades,'tradeCount',(select count(*) from public.trades where account_id=c.account_id),
    'sourceFactCount',(select count(*) from private.mt5_source_facts f where f.connection_id=c.id),
    'incompleteCollections',(select count(*) from private.mt5_capture_progress p where p.connection_id=c.id and p.received_batch_count<p.expected_batch_count));
end;
$$;

create function private.mt5_set_connection_state(p_connection_id uuid,p_expected_version text,p_operation_id uuid,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c private.mt5_connections; g private.integration_grants; actor jsonb; request jsonb; result jsonb; previous_status text;
begin
  perform private.require_direct_browser_session();
  if p_expected_version is null or p_expected_version !~ '^[1-9][0-9]*$' or p_action is null or p_action not in ('PAUSE','RESUME')
    or p_reason is null or length(btrim(p_reason)) not between 8 and 1000 then
    raise exception 'Valid control action, version and reason required.' using errcode='22023';
  end if;
  -- Discover scope without a row lock, then follow capture's grant -> operation
  -- -> connection lock order. Recheck the connection under lock before writing.
  select * into c from private.mt5_connections where id=p_connection_id and owner_id=auth.uid();
  if not found then raise exception 'Connection access denied.' using errcode='42501'; end if;
  select * into g from private.integration_grants where id=c.grant_id and owner_id=auth.uid()
    and account_id=c.account_id and purpose='MT5' and status='ACTIVE' and revoked_at is null for share;
  if not found or not exists(select 1 from private.integration_resources where purpose='MT5' and resource=g.resource and enabled) then
    raise exception 'Active MT5 grant required.' using errcode='42501';
  end if;
  actor := jsonb_build_object('user_id',g.owner_id,'client_id',g.client_id,'grant_id',g.id,'account_id',g.account_id,'purpose',g.purpose,'resource',g.resource);
  request := jsonb_build_object('connectionId',p_connection_id,'version',p_expected_version,'action',p_action,'reason',btrim(p_reason));
  result := private.integration_operation_result(actor,p_operation_id,'MT5_CONTROL',request);
  if result is not null then return result; end if;
  select * into c from private.mt5_connections where id=p_connection_id and owner_id=auth.uid()
    and grant_id=g.id and account_id=g.account_id for update;
  if not found then raise exception 'Connection access denied.' using errcode='42501'; end if;
  if c.version::text<>p_expected_version then raise exception 'Connection version conflict.' using errcode='40001'; end if;
  previous_status := c.status;
  update private.mt5_connections set status=case when p_action='PAUSE' then 'PAUSED' when onboarding_approved_at is null then 'ONBOARDING' else 'ACTIVE' end,
    version=version+1,fencing_token=fencing_token+1,worker_id=null,lease_expires_at=clock_timestamp(),attention_code=null
    where id=c.id returning * into c;
  result := jsonb_build_object('connectionId',c.id,'version',c.version::text,'status',c.status);
  perform private.record_integration_operation(actor,p_operation_id,'MT5_CONTROL',request,result,jsonb_build_array(c.id),
    jsonb_build_object('actorType','BROWSER','actorUserId',auth.uid(),'previousStatus',previous_status,'status',c.status,'reason',btrim(p_reason)));
  return result;
end;
$$;

create function public.mt5_list_connections() returns jsonb language sql security invoker set search_path='' as $$ select private.mt5_list_connections(); $$;
create function public.mt5_browser_source_page(p_connection_id uuid,p_offset integer default 0,p_limit integer default 1000)
returns jsonb language sql security invoker set search_path='' as $$ select private.mt5_browser_source_page(p_connection_id,p_offset,p_limit); $$;
create function public.mt5_set_connection_state(p_connection_id uuid,p_expected_version text,p_operation_id uuid,p_action text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.mt5_set_connection_state(p_connection_id,p_expected_version,p_operation_id,p_action,p_reason); $$;
revoke all on function private.mt5_list_connections(),public.mt5_list_connections(),
  private.mt5_browser_source_page(uuid,integer,integer),public.mt5_browser_source_page(uuid,integer,integer),
  private.mt5_set_connection_state(uuid,text,uuid,text,text),public.mt5_set_connection_state(uuid,text,uuid,text,text) from public,anon;
grant execute on function private.mt5_list_connections(),public.mt5_list_connections(),
  private.mt5_browser_source_page(uuid,integer,integer),public.mt5_browser_source_page(uuid,integer,integer),
  private.mt5_set_connection_state(uuid,text,uuid,text,text),public.mt5_set_connection_state(uuid,text,uuid,text,text) to authenticated;
