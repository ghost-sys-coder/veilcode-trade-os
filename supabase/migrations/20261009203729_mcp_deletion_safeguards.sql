-- Exact-target consent. No public RPCs, broad deletion or Storage SQL removal.
create table private.deletion_requests (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  client_id uuid not null references auth.oauth_clients(id), grant_id uuid not null references private.integration_grants(id),
  grant_version bigint not null, resource text not null,
  entity text not null check(entity in ('STRATEGY','SETUP','RULE','GOAL','TAG','INSTRUMENT','SCREENSHOT')),
  target_id uuid not null, target jsonb not null, original_record jsonb not null,
  reason text not null check(length(btrim(reason)) between 5 and 1000), execution_operation_id uuid not null,
  settle_operation_id uuid not null default gen_random_uuid(), version bigint not null default 1 check(version>0),
  status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','ARCHIVED','PURGE_PENDING','DELETED')),
  expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
  approved_at timestamptz, consumed_at timestamptz, completed_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique(owner_id,client_id,execution_operation_id),
  check((status in ('PENDING','REJECTED') and approved_at is null and consumed_at is null and completed_at is null)
    or (status='APPROVED' and approved_at is not null and consumed_at is null and completed_at is null)
    or (status='PURGE_PENDING' and entity='SCREENSHOT' and approved_at is not null and consumed_at is not null and completed_at is null)
    or (status in ('ARCHIVED','DELETED') and approved_at is not null and consumed_at is not null and completed_at is not null))
);
create index deletion_requests_owner on private.deletion_requests(owner_id,id);
create index deletion_requests_grant on private.deletion_requests(grant_id);
create index deletion_requests_client on private.deletion_requests(client_id);
create index deletion_requests_pending on private.deletion_requests(owner_id,created_at) where status='PURGE_PENDING';
create table private.deletion_objects (
  request_id uuid not null references private.deletion_requests(id),
  bucket text not null check(bucket in ('trade-screenshots','trade-file-staging')), path text not null,
  revision jsonb not null, primary key(bucket,path)
);
create index deletion_objects_request on private.deletion_objects(request_id);
alter table private.deletion_requests enable row level security;
alter table private.deletion_objects enable row level security;
revoke all on private.deletion_requests,private.deletion_objects from public,anon,authenticated,service_role;
create trigger deletion_objects_immutable before update or delete on private.deletion_objects
  for each row execute function private.reject_integration_audit_mutation();
-- A completed upload is historical provenance, not a guarantee of live attachment
-- availability. Retain its exact screenshot ID/hash after approved removal.
alter table private.file_uploads drop constraint file_uploads_screenshot_id_fkey;

create function private.deletion_table(entity text) returns text language plpgsql immutable set search_path='' as $$
begin
  case entity when 'STRATEGY' then return 'strategies';when 'SETUP' then return 'setups';when 'RULE' then return 'trading_rules';
    when 'GOAL' then return 'account_goals';when 'TAG' then return 'tags';when 'INSTRUMENT' then return 'instruments';
    when 'SCREENSHOT' then return 'trade_screenshots';else raise exception 'Invalid deletion entity.' using errcode='22023';end case;
end;$$;
create function private.deletion_reference_count(entity text,target uuid) returns bigint
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); relation regclass:=('public.'||private.deletion_table(entity))::regclass;
  fk record; found_count bigint; total bigint:=0;
begin
  -- Resolve all current FKs (including private broker mappings), including the
  -- ID member of composite owner FKs. Identifiers come only from the DB catalog.
  for fk in select n.nspname,c.relname,a.attname from pg_constraint f
    join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace
    join lateral unnest(f.conkey,f.confkey) keys(source,target) on true
    join pg_attribute a on a.attrelid=f.conrelid and a.attnum=keys.source
    join pg_attribute b on b.attrelid=f.confrelid and b.attnum=keys.target
    where f.contype='f' and f.confrelid=relation and b.attname='id' loop
    execute format('select count(*) from %I.%I where %I=$1',fk.nspname,fk.relname,fk.attname) into found_count using target;
    total:=total+found_count;
  end loop;
  if entity in ('STRATEGY','SETUP') then
    select count(*) into found_count from public.trade_plan_corrections
      where actor_user_id=auth.uid() and field_name=case entity when 'STRATEGY' then 'strategy_id' else 'setup_id' end
        and ((previous_value #>> '{}')=target::text or (new_value #>> '{}')=target::text);
    total:=total+found_count;
  elsif entity='RULE' then
    select count(*) into found_count from public.trade_rule_review_items where user_id=auth.uid() and rule_id_snapshot=target;
    total:=total+found_count;
  end if;
  -- Historical association snapshots in shared audits count, but a record's own
  -- creation/edit/approval audit is not a dependency on itself.
  select count(*) into found_count from private.application_mutation_audits a
    join private.application_operations op on op.id=a.operation_receipt_id
    where actor_user_id=auth.uid() and not(affected_records->>'entity' is not distinct from entity and affected_records->>'id' is not distinct from target::text)
      and not(entity='GOAL' and op.operation_kind in ('GOAL_CREATE','GOAL_PATCH','GOAL_ARCHIVE') and affected_records->>'recordId' is not distinct from target::text)
      and jsonb_path_exists(changes,'$.** ? (@ == $target)',jsonb_build_object('target',target::text));
  total:=total+found_count;
  -- Prior broker mappings and reconciliation decisions remain provenance even
  -- after a live mapping changes. UUID mentions conservatively prevent deletion.
  select count(*) into found_count from private.integration_mutation_audits
    where owner_id=auth.uid() and jsonb_path_exists(changes,'$.** ? (@ == $target)',jsonb_build_object('target',target::text));
  total:=total+found_count;
  return total;
end;$$;
create function private.deletion_target(entity text,target uuid) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); table_name text:=private.deletion_table(entity); row_value jsonb;
  version text; refs bigint:=0; trade_id uuid; account_name text; stored jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2 for update',table_name)
    into row_value using target,auth.uid();
  if row_value is null then raise exception 'Deletion target unavailable.' using errcode='P0002';end if;
  if entity='SCREENSHOT' then
    trade_id:=(row_value->>'trade_id')::uuid;
    if (row_value->>'storage_path') not like auth.uid()::text||'/'||trade_id::text||'/%'
      or length(row_value->>'storage_path')>1024 or (row_value->>'storage_path') !~ '^[A-Za-z0-9._/-]+$'
      or exists(select 1 from unnest(string_to_array(row_value->>'storage_path','/')) part where part in ('','.','..'))
      then raise exception 'Invalid owned file path.' using errcode='42501';end if;
    select jsonb_build_object('id',o.id,'version',o.version,'updatedAt',o.updated_at,'metadata',o.metadata) into stored
      from storage.objects o where bucket_id='trade-screenshots' and name=row_value->>'storage_path' for update;
    if stored is null then raise exception 'File evidence unavailable.' using errcode='P0002';end if;
    version:=encode(extensions.digest((row_value||jsonb_build_object('storage',stored))::text,'sha256'),'hex');
    select count(*)-1 into refs from public.trade_screenshots where storage_path=row_value->>'storage_path';
    if refs>0 then raise exception 'Shared file evidence cannot be purged.' using errcode='23514';end if;
    select a.name into account_name from public.trades t join public.trading_accounts a on a.id=t.account_id where t.id=trade_id and t.user_id=auth.uid();
  else
    version:=row_value->>'record_version';refs:=private.deletion_reference_count(entity,target);
    if entity='GOAL' then select name into account_name from public.trading_accounts where id=(row_value->>'account_id')::uuid and user_id=auth.uid();end if;
  end if;
  return jsonb_build_object('entity',entity,'id',target,'version',version,'name',coalesce(row_value->>'name',row_value->>'title',row_value->>'symbol',row_value->>'caption','Screenshot'),
    'tradeId',trade_id,'accountName',account_name,'referenceCount',refs,'effect',case when refs>0 then 'ARCHIVE' else 'DELETE' end);
end;$$;
create function private.deletion_wire(u private.deletion_requests) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('requestId',u.id,'target',u.target,'clientId',u.client_id,
    'clientName',coalesce((select coalesce(to_jsonb(c)->>'client_name',to_jsonb(c)->>'name') from auth.oauth_clients c where id=u.client_id),'Authorized MCP client'),
    'executionOperationId',u.execution_operation_id,'reason',u.reason,'version',u.version::text,
    'status',case when u.status in ('PENDING','APPROVED') and u.expires_at<=clock_timestamp() then 'EXPIRED' else u.status end,
    'expiresAt',u.expires_at,'approvedAt',u.approved_at,'consumedAt',u.consumed_at,'completedAt',u.completed_at);
$$;
create function private.deletion_scope(u private.deletion_requests) returns void
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor();
begin
  if u.owner_id is distinct from auth.uid() then raise exception 'Deletion access denied.' using errcode='42501';end if;
  if actor->>'actorType'='MCP' and (u.client_id::text is distinct from actor->>'client_id' or u.grant_id::text is distinct from actor->>'grant_id'
    or u.grant_version::text is distinct from actor->>'grant_version' or u.resource is distinct from actor->>'resource') then
    raise exception 'Deletion access denied.' using errcode='42501';end if;
end;$$;
create function private.application_deletion_read(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); u private.deletion_requests; objects jsonb;
begin
  if jsonb_typeof(request) is distinct from 'object' or jsonb_typeof(request->'action') is distinct from 'string' then raise exception 'Invalid deletion query.' using errcode='22023';end if;
  if request->>'action'='INSPECT' then
    if request-array['action','entity','id']<>'{}'::jsonb or not request?&array['action','entity','id'] then raise exception 'Invalid deletion query.' using errcode='22023';end if;
    return private.deletion_target(request->>'entity',(request->>'id')::uuid);
  end if;
  if request->>'action' not in ('STATUS','JOB') or request-array['action','requestId']<>'{}'::jsonb or not request?&array['action','requestId'] then raise exception 'Invalid deletion query.' using errcode='22023';end if;
  select * into u from private.deletion_requests where id=(request->>'requestId')::uuid and owner_id=auth.uid();
  if not found then raise exception 'Deletion request unavailable.' using errcode='P0002';end if;
  perform private.deletion_scope(u);
  if request->>'action'='STATUS' then return private.deletion_wire(u);end if;
  if u.status<>'PURGE_PENDING' then return null;end if;
  select jsonb_agg(jsonb_build_object('bucket',bucket,'path',path) order by bucket,path) into objects from private.deletion_objects where request_id=u.id;
  return jsonb_build_object('requestId',u.id,'ownerId',u.owner_id,'tradeId',u.target->>'tradeId','settleOperationId',u.settle_operation_id,'objects',objects);
end;$$;
create function private.application_deletion_write(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); action text:=request->>'action'; fields text[]; receipt jsonb; u private.deletion_requests;
  target_info jsonb; original jsonb; table_name text; upload private.file_uploads; item record; result jsonb;
begin
  fields:=case action when 'REQUEST' then array['action','operationId','entity','id','expectedVersion','executionOperationId','reason']
    when 'DECIDE' then array['action','operationId','requestId','expectedVersion','decision','acknowledged']
    when 'EXECUTE' then array['action','operationId','requestId'] when 'SETTLE' then array['action','operationId','requestId'] end;
  if fields is null or jsonb_typeof(request) is distinct from 'object' or not request?&fields or request-fields<>'{}'::jsonb
    or exists(select 1 from jsonb_each(request) where key<>'acknowledged' and jsonb_typeof(value)<>'string') then raise exception 'Invalid deletion command.' using errcode='22023';end if;
  if (action in ('REQUEST','EXECUTE') and actor->>'actorType'<>'MCP') or (action='DECIDE' and actor->>'actorType'<>'BROWSER') then raise exception 'Deletion actor denied.' using errcode='42501';end if;
  receipt:=private.application_operation_result(request,'DELETION_'||action);if receipt is not null then return receipt;end if;
  if action='REQUEST' then
    if length(btrim(request->>'reason')) not between 5 and 1000 or (request->>'operationId')::uuid=(request->>'executionOperationId')::uuid then raise exception 'Invalid deletion request.' using errcode='22023';end if;
    target_info:=private.deletion_target(request->>'entity',(request->>'id')::uuid);
    if target_info->>'version' is distinct from request->>'expectedVersion' then raise exception 'Deletion target changed.' using errcode='40001';end if;
    table_name:=private.deletion_table(request->>'entity');
    execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2',table_name) into original using (request->>'id')::uuid,auth.uid();
    insert into private.deletion_requests(owner_id,client_id,grant_id,grant_version,resource,entity,target_id,target,original_record,reason,execution_operation_id)
      values(auth.uid(),(actor->>'client_id')::uuid,(actor->>'grant_id')::uuid,(actor->>'grant_version')::bigint,actor->>'resource',request->>'entity',
        (request->>'id')::uuid,target_info,original,btrim(request->>'reason'),(request->>'executionOperationId')::uuid) returning * into u;
  else
    select * into u from private.deletion_requests where id=(request->>'requestId')::uuid and owner_id=auth.uid() for update;
    if not found then raise exception 'Deletion request unavailable.' using errcode='P0002';end if;
    perform private.deletion_scope(u);
    if action='DECIDE' then
      if u.status<>'PENDING' or (request->>'decision'='APPROVE' and u.expires_at<=clock_timestamp()) then raise exception 'Deletion approval unavailable.' using errcode='23514';end if;
      if request->>'expectedVersion' is distinct from u.version::text then raise exception 'Deletion request changed.' using errcode='40001';end if;
      if request->>'decision' not in ('APPROVE','REJECT') or jsonb_typeof(request->'acknowledged') is distinct from 'boolean'
        or (request->>'decision'='APPROVE' and request->'acknowledged'<>'true'::jsonb) then raise exception 'Explicit deletion approval required.' using errcode='22023';end if;
      if request->>'decision'='APPROVE' then
      perform 1 from private.integration_grants g where g.id=u.grant_id and g.owner_id=auth.uid() and g.client_id=u.client_id and g.status='ACTIVE'
        and g.version=u.grant_version and g.resource=u.resource and g.purpose='MCP' for share;
      if not found or not exists(select 1 from private.integration_resources where purpose='MCP' and resource=u.resource and enabled) then raise exception 'Deletion client unavailable.' using errcode='42501';end if;
      target_info:=private.deletion_target(u.entity,u.target_id);
      if target_info->>'version' is distinct from u.target->>'version' then raise exception 'Deletion target changed.' using errcode='40001';end if;
      end if;
      update private.deletion_requests set status=case request->>'decision' when 'APPROVE' then 'APPROVED' else 'REJECTED' end,
        approved_at=case when request->>'decision'='APPROVE' then clock_timestamp() end,version=version+1 where id=u.id returning * into u;
    elsif action='EXECUTE' then
      if u.execution_operation_id is distinct from (request->>'operationId')::uuid then raise exception 'Deletion execution binding denied.' using errcode='42501';end if;
      if u.status<>'APPROVED' or u.expires_at<=clock_timestamp() then raise exception 'Deletion approval unavailable.' using errcode='23514';end if;
      target_info:=private.deletion_target(u.entity,u.target_id);
      if target_info->>'version' is distinct from u.target->>'version' then raise exception 'Deletion target changed.' using errcode='40001';end if;
      table_name:=private.deletion_table(u.entity);
      if target_info->>'effect'='ARCHIVE' then
        if u.entity in ('STRATEGY','SETUP','RULE') then
          perform private.configuration_write(jsonb_build_object('action','ARCHIVE','entity',u.entity,'operationId',gen_random_uuid(),'id',u.target_id,'expectedVersion',target_info->>'version','reason',u.reason));
        elsif u.entity in ('TAG','INSTRUMENT') then
          perform private.application_reference_write(jsonb_build_object('action','ARCHIVE','entity',u.entity,'operationId',gen_random_uuid(),'id',u.target_id,'expectedVersion',target_info->>'version','reason',u.reason));
        else
          perform private.application_progress_write(jsonb_build_object('action','GOAL_ARCHIVE','operationId',gen_random_uuid(),'id',u.target_id,'expectedVersion',target_info->>'version','reason',u.reason),'{}');
        end if;
        update private.deletion_requests set status='ARCHIVED',target=target_info,consumed_at=clock_timestamp(),completed_at=clock_timestamp(),version=version+1 where id=u.id returning * into u;
      else
        if u.entity='SCREENSHOT' then
          insert into private.deletion_objects(request_id,bucket,path,revision)
            select u.id,'trade-screenshots',u.original_record->>'storage_path',coalesce(jsonb_build_object('id',o.id,'version',o.version,'updatedAt',o.updated_at),'{}')
            from (select 1) placeholder left join storage.objects o on o.bucket_id='trade-screenshots' and o.name=u.original_record->>'storage_path';
          for upload in select * from private.file_uploads where screenshot_id=u.target_id and owner_id=auth.uid() loop
            for item in select * from private.file_upload_chunks where upload_id=upload.id loop
              insert into private.deletion_objects(request_id,bucket,path,revision) values(u.id,'trade-file-staging',private.application_file_chunk_path(upload,item.chunk_index,item.sha256),jsonb_build_object('sha256',item.sha256));
            end loop;
          end loop;
        end if;
        execute format('delete from public.%I where id=$1 and user_id=$2',table_name) using u.target_id,auth.uid();
        update private.deletion_requests set status=case entity when 'SCREENSHOT' then 'PURGE_PENDING' else 'DELETED' end,
          consumed_at=clock_timestamp(),completed_at=case when entity<>'SCREENSHOT' then clock_timestamp() end,version=version+1 where id=u.id returning * into u;
      end if;
    else
      if (request->>'operationId')::uuid is distinct from u.settle_operation_id then raise exception 'Deletion settlement binding denied.' using errcode='42501';end if;
      if u.status<>'PURGE_PENDING' or exists(select 1 from private.deletion_objects d join storage.objects o on o.bucket_id=d.bucket and o.name=d.path where d.request_id=u.id) then raise exception 'File purge not confirmed.' using errcode='23514';end if;
      update private.deletion_requests set status='DELETED',completed_at=clock_timestamp(),version=version+1 where id=u.id returning * into u;
    end if;
  end if;
  result:=jsonb_build_object('action',action,'request',private.deletion_wire(u));
  perform private.application_record_operation(request,'DELETION_'||action,result,jsonb_build_object('entity',u.entity,'id',u.target_id,'deletionRequestId',u.id),
    jsonb_build_object('action',action,'status',u.status,'target',u.target,'reason',u.reason));
  return result;
end;$$;

-- Every retired exact identity stays reserved; legacy browser Storage races must
-- not replace bytes while an authorized purge is pending or after completion.
create function private.file_identity_not_retired(p_bucket text,p_path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  -- False (rather than an exception) preserves direct OAuth read isolation even
  -- when PostgreSQL evaluates this restrictive policy before another predicate.
  if auth.uid() is null or auth.jwt()->>'client_id' is not null then return false;end if;
  perform private.require_direct_browser_session();
  return not exists(select 1 from private.deletion_objects d where d.bucket=p_bucket and d.path=p_path);
end;
$$;
revoke all on function private.file_identity_not_retired(text,text) from public,anon,service_role;
grant execute on function private.file_identity_not_retired(text,text) to authenticated;
create policy retired_file_no_select on storage.objects as restrictive for select to authenticated
  using(private.file_identity_not_retired(bucket_id,name));
create policy retired_file_no_insert on storage.objects as restrictive for insert to authenticated
  with check(private.file_identity_not_retired(bucket_id,name));
create policy retired_file_no_update on storage.objects as restrictive for update to authenticated
  using(private.file_identity_not_retired(bucket_id,name)) with check(private.file_identity_not_retired(bucket_id,name));
create policy retired_file_no_delete on storage.objects as restrictive for delete to authenticated
  using(private.file_identity_not_retired(bucket_id,name));
create function private.retired_screenshot_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.deletion_objects where bucket='trade-screenshots' and path=new.storage_path) then
    raise exception 'Approved file identity is retired.' using errcode='42501';end if;
  return new;
end;$$;
create trigger retired_screenshot_guard before insert or update on public.trade_screenshots
  for each row execute function private.retired_screenshot_guard();
create function private.configuration_deletion_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('postgres','supabase_admin') and not(current_user='supabase_auth_admin' and pg_trigger_depth()>1) then
    if tg_table_name='trade_screenshots' then
      if old.storage_path ~ '^[^/]+/[^/]+/mcp/' then
        raise exception 'Managed file evidence requires an approved application workflow.' using errcode='42501';end if;
    end if;
    raise exception 'Permanent deletion requires an approved application workflow.' using errcode='42501';end if;
  return old;
end;$$;
do $$declare table_name text;begin
  foreach table_name in array array['strategies','setups','trading_rules','account_goals','tags','instruments','trade_screenshots'] loop
    execute format('create trigger approved_deletion_only before delete on public.%I for each row execute function private.configuration_deletion_guard()',table_name);
  end loop;
end;$$;
revoke all on function private.deletion_table(text),private.deletion_reference_count(text,uuid),private.deletion_target(text,uuid),
  private.deletion_wire(private.deletion_requests),private.deletion_scope(private.deletion_requests),private.application_deletion_read(jsonb),
  private.application_deletion_write(jsonb),private.configuration_deletion_guard(),private.retired_screenshot_guard() from public,anon,authenticated,service_role;
