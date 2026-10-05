-- Durable integration receipts are shared with the later MCP build. They are
-- private, actor-derived, immutable and committed in the same transaction as effects.
create table private.integration_operations (
  owner_id uuid not null references auth.users(id),
  client_id uuid not null references auth.oauth_clients(id),
  operation_id uuid not null,
  grant_id uuid not null references private.integration_grants(id),
  account_id uuid references public.trading_accounts(id),
  purpose text not null check (purpose in ('MT5','MCP')),
  resource text not null,
  operation_kind text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(owner_id,client_id,operation_id)
);
create table private.integration_mutation_audits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  client_id uuid not null,
  operation_id uuid not null,
  operation_kind text not null,
  affected_records jsonb not null check (jsonb_typeof(affected_records) = 'array'),
  changes jsonb not null check (jsonb_typeof(changes) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(owner_id,client_id,operation_id) references private.integration_operations,
  unique(owner_id,client_id,operation_id)
);
create table private.mt5_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  account_id uuid not null,
  grant_id uuid not null references private.integration_grants(id),
  identity jsonb not null,
  status text not null default 'ONBOARDING' check (status in ('ONBOARDING','ACTIVE','PAUSED','ATTENTION')),
  version bigint not null default 1 check (version > 0),
  worker_id uuid,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  last_sync_at timestamptz,
  capture_checkpoint timestamptz,
  attention_code text,
  created_at timestamptz not null default clock_timestamp(),
  unique(owner_id,account_id),
  foreign key(account_id,owner_id) references public.trading_accounts(id,user_id)
);
create unique index mt5_connection_broker_identity on private.mt5_connections(owner_id,(identity->>'server'),(identity->>'login'));
create unique index mt5_connection_terminal on private.mt5_connections(owner_id,(identity->>'terminalInstallationId'));
create index mt5_connection_grant on private.mt5_connections(grant_id);
create table private.mt5_source_revisions (
  id bigint generated always as identity primary key,
  connection_id uuid not null references private.mt5_connections(id),
  kind text not null check (kind in ('DEAL','ORDER','POSITION','ACCOUNT')),
  source_id text not null check (length(source_id) between 1 and 128),
  observed_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  fencing_token bigint not null,
  operation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,connection_id,kind,source_id)
);
create index mt5_source_revision_history on private.mt5_source_revisions(connection_id,kind,source_id,id);
create table private.mt5_source_facts (
  connection_id uuid not null references private.mt5_connections(id),
  kind text not null,
  source_id text not null,
  current_revision_id bigint not null,
  last_observed_at timestamptz not null,
  requires_review boolean not null default false,
  primary key(connection_id,kind,source_id),
  foreign key(current_revision_id,connection_id,kind,source_id) references private.mt5_source_revisions(id,connection_id,kind,source_id)
);
alter table private.integration_operations enable row level security;
alter table private.integration_mutation_audits enable row level security;
alter table private.mt5_connections enable row level security;
alter table private.mt5_source_revisions enable row level security;
alter table private.mt5_source_facts enable row level security;
revoke all on private.integration_operations, private.integration_mutation_audits, private.mt5_connections,
  private.mt5_source_revisions, private.mt5_source_facts from public, anon, authenticated;
create trigger integration_operations_immutable before update or delete on private.integration_operations
  for each row execute function private.reject_integration_audit_mutation();
create trigger integration_mutation_audits_immutable before update or delete on private.integration_mutation_audits
  for each row execute function private.reject_integration_audit_mutation();
create trigger mt5_source_revisions_immutable before update or delete on private.mt5_source_revisions
  for each row execute function private.reject_integration_audit_mutation();

-- Helpers are invokers with no client EXECUTE. Only authenticated workflows
-- running as their verified definer may use them; callers never choose actors.
create function private.integration_operation_result(actor jsonb, operation uuid, kind text, request jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare receipt private.integration_operations;
begin
  if operation is null then raise exception 'Operation ID required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor->>'user_id' || ':' || (actor->>'client_id') || ':' || operation::text,0));
  select * into receipt from private.integration_operations where owner_id = (actor->>'user_id')::uuid
    and client_id = (actor->>'client_id')::uuid and operation_id = operation;
  if found then
    if receipt.grant_id::text is distinct from actor->>'grant_id' or receipt.account_id::text is distinct from actor->>'account_id'
      or receipt.purpose is distinct from actor->>'purpose' or receipt.resource is distinct from actor->>'resource' then
      raise exception 'Operation scope denied.' using errcode = '42501';
    end if;
    if receipt.operation_kind <> kind or receipt.request_hash <> encode(extensions.digest(request::text,'sha256'),'hex') then
      raise exception 'Operation payload conflict.' using errcode = '23505';
    end if;
    return receipt.result;
  end if;
  return null;
end;
$$;
create function private.record_integration_operation(actor jsonb, operation uuid, kind text, request jsonb,
  result jsonb, affected jsonb, changes jsonb) returns void language plpgsql set search_path = '' as $$
begin
  insert into private.integration_operations(owner_id,client_id,operation_id,grant_id,account_id,purpose,resource,operation_kind,request_hash,result)
    values((actor->>'user_id')::uuid,(actor->>'client_id')::uuid,operation,(actor->>'grant_id')::uuid,(actor->>'account_id')::uuid,
      actor->>'purpose',actor->>'resource',kind,encode(extensions.digest(request::text,'sha256'),'hex'),result);
  insert into private.integration_mutation_audits(owner_id,client_id,operation_id,operation_kind,affected_records,changes)
    values((actor->>'user_id')::uuid,(actor->>'client_id')::uuid,operation,kind,affected,changes);
end;
$$;

create function private.mt5_identity_valid(identity jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(identity) is distinct from 'object' or not identity ?& array['server','login','terminalInstallationId','currencyCode','currencyPrecision','accountKind','positionMode']
    or identity - array['server','login','terminalInstallationId','currencyCode','currencyPrecision','accountKind','positionMode'] <> '{}'::jsonb then return false; end if;
  return jsonb_typeof(identity->'server') = 'string' and length(btrim(identity->>'server')) between 1 and 255
    and identity->>'server' = btrim(identity->>'server')
    and jsonb_typeof(identity->'login') = 'string' and identity->>'login' ~ '^[1-9][0-9]{0,19}$'
    and (identity->>'login')::numeric <= 18446744073709551615
    and jsonb_typeof(identity->'terminalInstallationId') = 'string' and (identity->>'terminalInstallationId')::uuid is not null
    and jsonb_typeof(identity->'currencyCode') = 'string' and identity->>'currencyCode' ~ '^[A-Z]{3}$'
    and jsonb_typeof(identity->'currencyPrecision') = 'number' and identity->>'currencyPrecision' ~ '^[0-8]$'
    and identity->>'accountKind' in ('DEMO','LIVE','CONTEST') and identity->>'positionMode' in ('HEDGING','NETTING');
exception when data_exception then return false;
end;
$$;
alter table private.mt5_connections add constraint mt5_connection_identity_valid check (private.mt5_identity_valid(identity) is true);

create function private.mt5_event_valid(event jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare payload jsonb := event->'payload'; kind text := event->>'kind'; required text[]; optional text[] := '{}';
  money text[]; ids text[]; times text[]; field text; value jsonb;
begin
  if jsonb_typeof(event) is distinct from 'object' or not event ?& array['kind','sourceId','observedAt','payload']
    or event - array['kind','sourceId','observedAt','payload'] <> '{}'::jsonb
    or jsonb_typeof(event->'sourceId') is distinct from 'string' or length(event->>'sourceId') not between 1 and 128
    or jsonb_typeof(payload) is distinct from 'object' then return false; end if;
  if kind = 'DEAL' then
    required := array['ticket','orderId','positionId','symbol','occurredAt','type','entry','volume','price','profit','commission','swap','fee'];
    optional := array['reversalAllocation']; money := array['volume','price','profit','commission','swap','fee'];
    ids := array['ticket','orderId','positionId']; times := array['occurredAt'];
    if jsonb_typeof(payload->'type') <> 'string' or length(payload->>'type') not between 1 and 48
      or (payload->'entry' <> 'null'::jsonb and payload->>'entry' not in ('IN','OUT','INOUT','OUT_BY')) then return false; end if;
    if payload ? 'reversalAllocation' then
      value := payload->'reversalAllocation';
      if jsonb_typeof(value) <> 'object' or not value ?& array['closingCommission','openingCommission','closingFee','openingFee']
        or value - array['closingCommission','openingCommission','closingFee','openingFee'] <> '{}'::jsonb then return false; end if;
      for field in select jsonb_object_keys(value) loop
        if jsonb_typeof(value->field) <> 'string' or value->>field !~ '^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$' then return false; end if;
      end loop;
    end if;
  elsif kind = 'ORDER' then
    required := array['ticket','positionId','positionById','symbol','type','state','initialVolume','remainingVolume','price','stopLoss','takeProfit','setupAt','doneAt'];
    money := array['initialVolume','remainingVolume','price','stopLoss','takeProfit']; ids := array['ticket','positionId','positionById']; times := array['setupAt','doneAt'];
    if jsonb_typeof(payload->'type') <> 'string' or length(payload->>'type') not between 1 and 48
      or jsonb_typeof(payload->'state') <> 'string' or length(payload->>'state') not between 1 and 48 then return false; end if;
  elsif kind = 'POSITION' then
    required := array['positionId','ticket','symbol','direction','volume','entryPrice','currentStop','currentTarget','unrealizedPnl','observedAt'];
    money := array['volume','entryPrice','currentStop','currentTarget','unrealizedPnl']; ids := array['positionId','ticket']; times := array['observedAt'];
    if coalesce(payload->>'direction' not in ('BUY','SELL'),true) or (payload->>'volume')::numeric <= 0 or event->'observedAt' <> payload->'observedAt' then return false; end if;
  elsif kind = 'ACCOUNT' then
    required := array['balance','equity','unrealizedPnl','observedAt']; money := array['balance','equity','unrealizedPnl']; ids := '{}'; times := array['observedAt'];
    if event->>'sourceId' <> 'ACCOUNT' or event->'observedAt' <> payload->'observedAt' then return false; end if;
  else return false; end if;
  if not payload ?& required or payload - (required || optional) <> '{}'::jsonb then return false; end if;
  if kind <> 'ACCOUNT' and event->>'sourceId' is distinct from payload->>(case when kind = 'POSITION' then 'positionId' else 'ticket' end) then return false; end if;
  if kind <> 'ACCOUNT' and (payload->'symbol' <> 'null'::jsonb or kind <> 'DEAL')
    and (jsonb_typeof(payload->'symbol') <> 'string' or length(payload->>'symbol') not between 1 and 128) then return false; end if;
  foreach field in array money loop
    if payload->field = 'null'::jsonb and field in ('stopLoss','takeProfit','currentStop','currentTarget') then continue; end if;
    if jsonb_typeof(payload->field) <> 'string' or payload->>field !~ '^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$' then return false; end if;
  end loop;
  foreach field in array ids loop
    if payload->field = 'null'::jsonb and field in ('orderId','positionId','positionById') and kind <> 'POSITION' then continue; end if;
    if jsonb_typeof(payload->field) <> 'string' or payload->>field !~ '^[1-9][0-9]{0,19}$'
      or (payload->>field)::numeric > 18446744073709551615 then return false; end if;
  end loop;
  foreach field in array times loop
    if field = 'doneAt' and payload->field = 'null'::jsonb then continue; end if;
    if jsonb_typeof(payload->field) <> 'string' or payload->>field !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      or (payload->>field)::timestamptz is null then return false; end if;
  end loop;
  return jsonb_typeof(event->'observedAt') = 'string' and event->>'observedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    and (event->>'observedAt')::timestamptz is not null;
exception when data_exception then return false;
end;
$$;

create function private.mt5_register_connection(p_grant_id uuid, p_operation_id uuid, p_identity jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g private.integration_grants; actor jsonb; request jsonb; result jsonb; connection private.mt5_connections;
begin
  perform private.require_direct_browser_session();
  select * into g from private.integration_grants where id = p_grant_id and owner_id = auth.uid()
    and purpose = 'MT5' and status = 'ACTIVE' and revoked_at is null for share;
  if not found then raise exception 'Account-bound MT5 grant required.' using errcode = '42501'; end if;
  if not exists(select 1 from private.integration_resources where purpose = g.purpose and resource = g.resource and enabled) then
    raise exception 'Integration is disabled.' using errcode = '42501'; end if;
  if private.mt5_identity_valid(p_identity) is distinct from true or p_identity->>'accountKind' <> 'DEMO' then
    raise exception 'Valid demo identity required.' using errcode = '22023'; end if;
  if not exists(select 1 from public.trading_accounts where id = g.account_id and user_id = auth.uid()
    and currency_code = p_identity->>'currencyCode' and currency_precision = (p_identity->>'currencyPrecision')::integer) then
    raise exception 'Account currency mismatch.' using errcode = '22023'; end if;
  actor := jsonb_build_object('user_id',g.owner_id,'client_id',g.client_id,'grant_id',g.id,'account_id',g.account_id,'purpose',g.purpose,'resource',g.resource);
  request := jsonb_build_object('grantId',p_grant_id,'identity',p_identity);
  result := private.integration_operation_result(actor,p_operation_id,'MT5_REGISTER',request);
  if result is not null then return result; end if;
  insert into private.mt5_connections(owner_id,account_id,grant_id,identity) values(g.owner_id,g.account_id,g.id,p_identity) returning * into connection;
  result := jsonb_build_object('connectionId',connection.id,'version',connection.version::text,'status',connection.status);
  perform private.record_integration_operation(actor,p_operation_id,'MT5_REGISTER',request,result,jsonb_build_array(connection.id),jsonb_build_object('status',connection.status));
  return result;
end;
$$;

create function private.mt5_acquire_lease(p_resource text, p_connection_id uuid, p_worker_id uuid, p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor jsonb; request jsonb; result jsonb; connection private.mt5_connections;
begin
  actor := private.authorize_integration(p_resource,'MT5');
  request := jsonb_build_object('connectionId',p_connection_id,'workerId',p_worker_id);
  result := private.integration_operation_result(actor,p_operation_id,'MT5_LEASE',request);
  if result is not null then return result; end if;
  select * into connection from private.mt5_connections where id = p_connection_id and owner_id = (actor->>'user_id')::uuid
    and account_id = (actor->>'account_id')::uuid and grant_id = (actor->>'grant_id')::uuid for update;
  if not found then raise exception 'Connection access denied.' using errcode = '42501'; end if;
  if connection.status not in ('ONBOARDING','ACTIVE') or p_worker_id is null then raise exception 'Connection requires attention.' using errcode = '55000'; end if;
  if connection.lease_expires_at > clock_timestamp() and connection.worker_id <> p_worker_id then
    raise exception 'Collector lease is held.' using errcode = '55P03'; end if;
  if connection.worker_id is distinct from p_worker_id or connection.lease_expires_at is null or connection.lease_expires_at <= clock_timestamp() then
    connection.fencing_token := connection.fencing_token + 1;
  end if;
  update private.mt5_connections set worker_id = p_worker_id, fencing_token = connection.fencing_token,
    lease_expires_at = clock_timestamp() + interval '120 seconds', last_heartbeat_at = clock_timestamp()
    where id = connection.id returning * into connection;
  result := jsonb_build_object('connectionId',connection.id,'fencingToken',connection.fencing_token::text,'leaseExpiresAt',connection.lease_expires_at);
  perform private.record_integration_operation(actor,p_operation_id,'MT5_LEASE',request,result,jsonb_build_array(connection.id),
    jsonb_build_object('fencingToken',connection.fencing_token::text,'workerId',p_worker_id));
  return result;
end;
$$;

create function private.mt5_capture(p_resource text, p_connection_id uuid, p_worker_id uuid, p_fencing_token text,
  p_operation_id uuid, p_identity jsonb, p_checkpoint text, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor jsonb; request jsonb; result jsonb; connection private.mt5_connections; event jsonb; observed timestamptz;
  fact private.mt5_source_facts; previous private.mt5_source_revisions; revision_id bigint; payload_hash text; revisions integer := 0; review boolean;
begin
  actor := private.authorize_integration(p_resource,'MT5');
  request := jsonb_build_object('connectionId',p_connection_id,'workerId',p_worker_id,'fencingToken',p_fencing_token,
    'identity',p_identity,'checkpoint',p_checkpoint,'events',p_events);
  result := private.integration_operation_result(actor,p_operation_id,'MT5_CAPTURE',request);
  if result is not null then return result; end if;
  select * into connection from private.mt5_connections where id = p_connection_id and owner_id = (actor->>'user_id')::uuid
    and account_id = (actor->>'account_id')::uuid and grant_id = (actor->>'grant_id')::uuid for update;
  if not found then raise exception 'Connection access denied.' using errcode = '42501'; end if;
  if connection.status not in ('ONBOARDING','ACTIVE') or connection.worker_id is distinct from p_worker_id
    or connection.fencing_token::text is distinct from p_fencing_token
    or connection.lease_expires_at is null or connection.lease_expires_at <= clock_timestamp() then
    raise exception 'Collector lease is stale.' using errcode = '55000'; end if;
  if private.mt5_identity_valid(p_identity) is distinct from true then raise exception 'Invalid MT5 identity.' using errcode = '22023'; end if;
  if connection.identity <> p_identity then
    update private.mt5_connections set status = 'ATTENTION', attention_code = 'MT5_ACCOUNT_IDENTITY_MISMATCH', version = version + 1,
      worker_id = null, lease_expires_at = null, fencing_token = fencing_token + 1 where id = connection.id;
    result := jsonb_build_object('connectionId',connection.id,'status','ATTENTION','code','MT5_ACCOUNT_IDENTITY_MISMATCH');
    perform private.record_integration_operation(actor,p_operation_id,'MT5_CAPTURE',request,result,jsonb_build_array(connection.id),jsonb_build_object('status','ATTENTION','code','MT5_ACCOUNT_IDENTITY_MISMATCH'));
    return result; -- Commit the pause, never store wrong-account events or redirect them.
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 200 or pg_column_size(request) > 1048576
    or p_checkpoint is null or p_checkpoint !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    or p_checkpoint::timestamptz > clock_timestamp() + interval '30 seconds' then
    raise exception 'Invalid capture batch.' using errcode = '22023'; end if;
  if (select count(*) from jsonb_array_elements(p_events)) <> (select count(distinct (e->>'kind',e->>'sourceId')) from jsonb_array_elements(p_events) e) then
    raise exception 'Duplicate source keys in capture batch.' using errcode = '22023'; end if;
  for event in select value from jsonb_array_elements(p_events) loop
    if private.mt5_event_valid(event) is distinct from true then raise exception 'Invalid source event.' using errcode = '22023'; end if;
    observed := (event->>'observedAt')::timestamptz;
    if observed > clock_timestamp() + interval '30 seconds' then raise exception 'Future observation rejected.' using errcode = '22023'; end if;
    payload_hash := encode(extensions.digest((event->'payload')::text,'sha256'),'hex');
    select * into fact from private.mt5_source_facts where connection_id = connection.id and kind = event->>'kind' and source_id = event->>'sourceId';
    previous := null;
    if found then select * into previous from private.mt5_source_revisions where id = fact.current_revision_id; end if;
    if previous.id is null or previous.payload_hash <> payload_hash then
      insert into private.mt5_source_revisions(connection_id,kind,source_id,observed_at,payload,payload_hash,fencing_token,operation_id)
        values(connection.id,event->>'kind',event->>'sourceId',observed,event->'payload',payload_hash,connection.fencing_token,p_operation_id) returning id into revision_id;
      revisions := revisions + 1;
      -- Changed old/equal-timestamp facts and corrected deals require review.
      -- A stale outbox row must never overwrite newer observations.
      review := previous.id is not null and (observed <= fact.last_observed_at or event->>'kind' = 'DEAL');
      insert into private.mt5_source_facts(connection_id,kind,source_id,current_revision_id,last_observed_at,requires_review)
        values(connection.id,event->>'kind',event->>'sourceId',revision_id,observed,review)
        on conflict(connection_id,kind,source_id) do update set
          current_revision_id = case when excluded.last_observed_at > private.mt5_source_facts.last_observed_at then excluded.current_revision_id else private.mt5_source_facts.current_revision_id end,
          last_observed_at = greatest(excluded.last_observed_at,private.mt5_source_facts.last_observed_at),
          requires_review = private.mt5_source_facts.requires_review or excluded.requires_review;
    else
      update private.mt5_source_facts set last_observed_at = greatest(observed,last_observed_at)
        where connection_id = connection.id and kind = event->>'kind' and source_id = event->>'sourceId';
    end if;
  end loop;
  update private.mt5_connections set capture_checkpoint = greatest(capture_checkpoint,p_checkpoint::timestamptz), last_sync_at = clock_timestamp() where id = connection.id returning * into connection;
  result := jsonb_build_object('connectionId',connection.id,'status','STAGED','revisionCount',revisions,'checkpoint',connection.capture_checkpoint,
    'reviewCount',(select count(*) from private.mt5_source_facts where connection_id = connection.id and requires_review));
  perform private.record_integration_operation(actor,p_operation_id,'MT5_CAPTURE',request,result,jsonb_build_array(connection.id),
    jsonb_build_object('sourceRevisionCount',revisions,'status','STAGED'));
  return result;
end;
$$;

create function public.mt5_register_connection(p_grant_id uuid,p_operation_id uuid,p_identity jsonb) returns jsonb
language sql security invoker set search_path = '' as $$ select private.mt5_register_connection(p_grant_id,p_operation_id,p_identity); $$;
create function public.mt5_acquire_lease(p_resource text,p_connection_id uuid,p_worker_id uuid,p_operation_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.mt5_acquire_lease(p_resource,p_connection_id,p_worker_id,p_operation_id); $$;
create function public.mt5_capture(p_resource text,p_connection_id uuid,p_worker_id uuid,p_fencing_token text,
  p_operation_id uuid,p_identity jsonb,p_checkpoint text,p_events jsonb) returns jsonb language sql security invoker set search_path = '' as $$
  select private.mt5_capture(p_resource,p_connection_id,p_worker_id,p_fencing_token,p_operation_id,p_identity,p_checkpoint,p_events);
$$;
revoke all on function private.integration_operation_result(jsonb,uuid,text,jsonb),
  private.record_integration_operation(jsonb,uuid,text,jsonb,jsonb,jsonb,jsonb),private.mt5_identity_valid(jsonb),private.mt5_event_valid(jsonb) from public,anon,authenticated;
revoke all on function private.mt5_register_connection(uuid,uuid,jsonb),private.mt5_acquire_lease(text,uuid,uuid,uuid),
  private.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb),public.mt5_register_connection(uuid,uuid,jsonb),
  public.mt5_acquire_lease(text,uuid,uuid,uuid),public.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb) from public,anon;
grant execute on function private.mt5_register_connection(uuid,uuid,jsonb),private.mt5_acquire_lease(text,uuid,uuid,uuid),
  private.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb),public.mt5_register_connection(uuid,uuid,jsonb),
  public.mt5_acquire_lease(text,uuid,uuid,uuid),public.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb) to authenticated;
