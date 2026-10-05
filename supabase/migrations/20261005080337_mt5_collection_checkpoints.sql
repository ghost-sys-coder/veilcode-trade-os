-- A collection is frozen before upload. Its checkpoint is eligible only after
-- every declared batch is durably staged, regardless of arrival order.
create table private.mt5_capture_collections (
  connection_id uuid not null references private.mt5_connections(id),
  id uuid not null,
  expected_batch_count integer not null check (expected_batch_count between 1 and 100000),
  checkpoint timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,id)
);
create table private.mt5_capture_batches (
  connection_id uuid not null,
  collection_id uuid not null,
  batch_index integer not null check (batch_index >= 0),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null,
  client_id uuid not null,
  operation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(connection_id,collection_id,batch_index),
  foreign key(connection_id,collection_id) references private.mt5_capture_collections,
  foreign key(owner_id,client_id,operation_id) references private.integration_operations
);
-- Mutable read projection, analogous to current source facts. Original manifests
-- and slots remain immutable evidence; only the authorized capture transaction
-- increments this counter under the connection lock.
create table private.mt5_capture_progress (
  connection_id uuid not null,
  collection_id uuid not null,
  checkpoint timestamptz not null,
  expected_batch_count integer not null check (expected_batch_count between 1 and 100000),
  received_batch_count integer not null default 0 check (received_batch_count >= 0 and received_batch_count <= expected_batch_count),
  primary key(connection_id,collection_id),
  foreign key(connection_id,collection_id) references private.mt5_capture_collections
);
create index mt5_capture_pending_checkpoint on private.mt5_capture_progress(connection_id,checkpoint)
  where received_batch_count < expected_batch_count;
create index mt5_capture_complete_checkpoint on private.mt5_capture_progress(connection_id,checkpoint)
  where received_batch_count = expected_batch_count;
create index mt5_capture_batch_receipt on private.mt5_capture_batches(owner_id,client_id,operation_id);
alter table private.mt5_capture_collections enable row level security;
alter table private.mt5_capture_batches enable row level security;
alter table private.mt5_capture_progress enable row level security;
revoke all on private.mt5_capture_collections,private.mt5_capture_batches,private.mt5_capture_progress from public,anon,authenticated;
create trigger mt5_capture_collections_immutable before update or delete on private.mt5_capture_collections
  for each row execute function private.reject_integration_audit_mutation();
create trigger mt5_capture_batches_immutable before update or delete on private.mt5_capture_batches
  for each row execute function private.reject_integration_audit_mutation();

-- Remove the manifest-less entry point, including direct Data API access.
drop function public.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb);
drop function private.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb);
create function private.mt5_capture(p_resource text,p_connection_id uuid,p_worker_id uuid,p_fencing_token text,
  p_operation_id uuid,p_identity jsonb,p_checkpoint text,p_events jsonb,p_collection jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
<<capture_batch>>
declare actor jsonb; request jsonb; result jsonb; connection private.mt5_connections; event jsonb; observed timestamptz;
  fact private.mt5_source_facts; previous private.mt5_source_revisions; revision_id bigint; payload_hash text; revisions integer := 0; review boolean;
  collection_id uuid; batch_index integer; batch_count integer; collection private.mt5_capture_collections;
  slot private.mt5_capture_batches; batch_hash text; received integer; complete boolean; new_slot boolean;
  eligible_checkpoint timestamptz;
begin
  actor := private.authorize_integration(p_resource,'MT5');
  request := jsonb_build_object('connectionId',p_connection_id,'workerId',p_worker_id,'fencingToken',p_fencing_token,
    'identity',p_identity,'checkpoint',p_checkpoint,'events',p_events,'collection',p_collection);
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
    update private.mt5_connections set status = 'ATTENTION',attention_code = 'MT5_ACCOUNT_IDENTITY_MISMATCH',version = version + 1,
      worker_id = null,lease_expires_at = null,fencing_token = fencing_token + 1 where id = connection.id;
    result := jsonb_build_object('connectionId',connection.id,'status','ATTENTION','code','MT5_ACCOUNT_IDENTITY_MISMATCH');
    perform private.record_integration_operation(actor,p_operation_id,'MT5_CAPTURE',request,result,jsonb_build_array(connection.id),jsonb_build_object('status','ATTENTION','code','MT5_ACCOUNT_IDENTITY_MISMATCH'));
    return result;
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 200 or pg_column_size(request) > 1048576
    or p_checkpoint is null or p_checkpoint !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    or p_checkpoint::timestamptz > clock_timestamp() + interval '30 seconds'
    or jsonb_typeof(p_collection) is distinct from 'object' or not p_collection ?& array['id','index','count']
    or p_collection - array['id','index','count'] <> '{}'::jsonb
    or jsonb_typeof(p_collection->'id') is distinct from 'string'
    or jsonb_typeof(p_collection->'index') is distinct from 'number' or p_collection->>'index' !~ '^(0|[1-9][0-9]{0,5})$'
    or jsonb_typeof(p_collection->'count') is distinct from 'number' or p_collection->>'count' !~ '^[1-9][0-9]{0,5}$' then
    raise exception 'Invalid capture batch.' using errcode = '22023'; end if;
  collection_id := (p_collection->>'id')::uuid; batch_index := (p_collection->>'index')::integer; batch_count := (p_collection->>'count')::integer;
  if batch_count > 100000 or batch_index >= batch_count then raise exception 'Invalid capture collection.' using errcode = '22023'; end if;
  select * into collection from private.mt5_capture_collections where connection_id = connection.id and id = collection_id;
  if found then
    if collection.expected_batch_count <> batch_count or collection.checkpoint <> p_checkpoint::timestamptz then
      raise exception 'Collection manifest conflict.' using errcode = '23505'; end if;
  else
    insert into private.mt5_capture_collections(connection_id,id,expected_batch_count,checkpoint)
      values(connection.id,collection_id,batch_count,p_checkpoint::timestamptz);
    insert into private.mt5_capture_progress(connection_id,collection_id,expected_batch_count,checkpoint)
      values(connection.id,collection_id,batch_count,p_checkpoint::timestamptz);
  end if;
  batch_hash := encode(extensions.digest(p_events::text,'sha256'),'hex');
  select * into slot from private.mt5_capture_batches b where b.connection_id = connection.id and b.collection_id = capture_batch.collection_id and b.batch_index = capture_batch.batch_index;
  new_slot := not found;
  if not new_slot and slot.payload_hash <> batch_hash then raise exception 'Collection batch conflict.' using errcode = '23505'; end if;
  if (select count(*) from jsonb_array_elements(p_events)) <> (select count(distinct (e->>'kind',e->>'sourceId')) from jsonb_array_elements(p_events) e) then
    raise exception 'Duplicate source keys in capture batch.' using errcode = '22023'; end if;
  if new_slot then
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
  end if;
  update private.mt5_capture_progress p set received_batch_count = received_batch_count + case when new_slot then 1 else 0 end
    where p.connection_id = connection.id and p.collection_id = capture_batch.collection_id returning received_batch_count into received;
  if not found then raise exception 'Capture progress requires recovery.' using errcode = '55000'; end if;
  complete := received = batch_count;
  -- A newer complete collection cannot jump over an older incomplete one.
  -- Include this slot before insertion: all effects still commit atomically.
  select max(p.checkpoint) into eligible_checkpoint from private.mt5_capture_progress p
    where p.connection_id = connection.id and p.received_batch_count = p.expected_batch_count
      and p.checkpoint < coalesce((select min(pending.checkpoint) from private.mt5_capture_progress pending
        where pending.connection_id = connection.id and pending.received_batch_count < pending.expected_batch_count),'infinity'::timestamptz);
  update private.mt5_connections set capture_checkpoint = greatest(capture_checkpoint,eligible_checkpoint),
    last_sync_at = clock_timestamp() where id = connection.id returning * into connection;
  result := jsonb_build_object('connectionId',connection.id,'status','STAGED','revisionCount',revisions,'checkpoint',connection.capture_checkpoint,
    'collectionId',collection_id,'collectionComplete',complete,'receivedBatchCount',received,
    'reviewCount',(select count(*) from private.mt5_source_facts where connection_id = connection.id and requires_review));
  perform private.record_integration_operation(actor,p_operation_id,'MT5_CAPTURE',request,result,jsonb_build_array(connection.id,collection_id),
    jsonb_build_object('sourceRevisionCount',revisions,'status','STAGED','collectionComplete',complete,'batchIndex',batch_index));
  if new_slot then
    insert into private.mt5_capture_batches(connection_id,collection_id,batch_index,payload_hash,owner_id,client_id,operation_id)
      values(connection.id,collection_id,batch_index,batch_hash,(actor->>'user_id')::uuid,(actor->>'client_id')::uuid,p_operation_id);
  end if;
  return result;
end;
$$;
create function public.mt5_capture(p_resource text,p_connection_id uuid,p_worker_id uuid,p_fencing_token text,
  p_operation_id uuid,p_identity jsonb,p_checkpoint text,p_events jsonb,p_collection jsonb) returns jsonb language sql security invoker set search_path = '' as $$
  select private.mt5_capture(p_resource,p_connection_id,p_worker_id,p_fencing_token,p_operation_id,p_identity,p_checkpoint,p_events,p_collection);
$$;
revoke all on function private.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb,jsonb),public.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb,jsonb) from public,anon;
grant execute on function private.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb,jsonb),public.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb,jsonb) to authenticated;

-- Lookup participates in the same operation lock as mutations. UNKNOWN means
-- no receipt existed at this transactional observation, not a promise that no
-- concurrent/future request can ever commit. Fenced takeover precedes recovery.
create function private.get_integration_operation(p_resource text,p_purpose text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor jsonb; receipt private.integration_operations;
begin
  actor := private.authorize_integration(p_resource,p_purpose);
  if p_operation_id is null then raise exception 'Operation ID required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor->>'user_id' || ':' || (actor->>'client_id') || ':' || p_operation_id::text,0));
  select * into receipt from private.integration_operations where owner_id = (actor->>'user_id')::uuid
    and client_id = (actor->>'client_id')::uuid and operation_id = p_operation_id;
  if not found then return jsonb_build_object('operationId',p_operation_id,'status','UNKNOWN'); end if;
  if receipt.grant_id::text is distinct from actor->>'grant_id' or receipt.account_id::text is distinct from actor->>'account_id'
    or receipt.purpose is distinct from actor->>'purpose' or receipt.resource is distinct from actor->>'resource' then
    raise exception 'Operation scope denied.' using errcode = '42501'; end if;
  return jsonb_build_object('operationId',p_operation_id,'status','COMMITTED','kind',receipt.operation_kind,'result',receipt.result,'createdAt',receipt.created_at);
end;
$$;
create function public.get_integration_operation(p_resource text,p_purpose text,p_operation_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.get_integration_operation(p_resource,p_purpose,p_operation_id); $$;
revoke all on function private.get_integration_operation(text,text,uuid),public.get_integration_operation(text,text,uuid) from public,anon;
grant execute on function private.get_integration_operation(text,text,uuid),public.get_integration_operation(text,text,uuid) to authenticated;
