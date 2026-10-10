-- Application-mediated private evidence. OAuth table/Storage policies stay denied.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('trade-file-staging','trade-file-staging',false,393216,array['application/octet-stream']);

create table private.file_uploads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id), actor_key text not null,
  grant_id uuid references private.integration_grants(id), resource text,
  trade_id uuid not null, metadata jsonb not null,
  content_type text not null check(content_type in ('image/png','image/jpeg','image/webp')),
  byte_length integer not null check(byte_length between 1 and 10485760),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  version bigint not null default 1 check(version>0),
  status text not null default 'PENDING' check(status in ('PENDING','COMPLETE')),
  expires_at timestamptz not null default (clock_timestamp()+interval '24 hours'),
  screenshot_id uuid unique references public.trade_screenshots(id),
  width integer, height integer, created_at timestamptz not null default clock_timestamp(),
  foreign key(trade_id,owner_id) references public.trades(id,user_id),
  check((status='PENDING' and screenshot_id is null and width is null and height is null)
    or (status='COMPLETE' and screenshot_id is not null and width is not null and height is not null and width>0 and height>0 and width::bigint*height<=16000000))
);
create index file_uploads_owner_cursor on private.file_uploads(owner_id,id);
create index file_uploads_trade on private.file_uploads(trade_id,owner_id);
create index file_uploads_grant on private.file_uploads(grant_id);
create table private.file_upload_chunks (
  upload_id uuid not null references private.file_uploads(id), chunk_index integer not null check(chunk_index between 0 and 26),
  byte_length integer not null check(byte_length between 1 and 393216),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp(),
  primary key(upload_id,chunk_index)
);
alter table private.file_uploads enable row level security;
alter table private.file_upload_chunks enable row level security;
revoke all on private.file_uploads,private.file_upload_chunks from public,anon,authenticated,service_role;
create trigger file_upload_chunks_immutable before update or delete on private.file_upload_chunks
  for each row execute function private.reject_integration_audit_mutation();

-- New managed images cannot be overwritten/removed by the legacy browser API.
-- Server-side exact-target deletion remains a separate, browser-confirmed feature.
create policy managed_screenshot_no_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id<>'trade-screenshots' or name !~ '^[^/]+/[^/]+/mcp/');
create policy managed_screenshot_no_overwrite on storage.objects as restrictive for update to authenticated
  using (bucket_id<>'trade-screenshots' or name !~ '^[^/]+/[^/]+/mcp/')
  with check (bucket_id<>'trade-screenshots' or name !~ '^[^/]+/[^/]+/mcp/');
create policy managed_screenshot_no_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id<>'trade-screenshots' or name !~ '^[^/]+/[^/]+/mcp/');
create function private.file_evidence_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('postgres','supabase_admin') and
    ((tg_op<>'INSERT' and old.storage_path ~ '^[^/]+/[^/]+/mcp/') or (tg_op<>'DELETE' and new.storage_path ~ '^[^/]+/[^/]+/mcp/')) then
    raise exception 'Managed file evidence requires an approved application workflow.' using errcode='42501';
  end if;
  return coalesce(new,old);
end;$$;
create trigger file_evidence_guard before insert or update or delete on public.trade_screenshots
  for each row execute function private.file_evidence_guard();
create trigger application_trade_version after insert or update or delete on public.trade_screenshots
  for each row execute function private.application_bump_trade_version();

create function private.application_file_record(target uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); result jsonb;
begin
  select jsonb_build_object('id',s.id,'tradeId',s.trade_id,'category',s.category,'timeframe',s.timeframe,
    'caption',s.caption,'capturedAt',s.captured_at,'createdAt',s.created_at,'contentType',u.content_type,
    'byteLength',u.byte_length,'sha256',u.sha256,'width',u.width,'height',u.height) into result
    from public.trade_screenshots s left join private.file_uploads u on u.screenshot_id=s.id and u.status='COMPLETE'
    where s.id=target and s.user_id=auth.uid();
  if result is null then raise exception 'Screenshot not found.' using errcode='P0002';end if;
  return result;
end;$$;
create function private.application_file_upload_wire(u private.file_uploads) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('uploadId',u.id,'tradeId',u.trade_id,'version',u.version::text,
    'status',case when u.status='PENDING' and u.expires_at<=clock_timestamp() then 'EXPIRED' else u.status end,
    'expiresAt',u.expires_at,'contentType',u.content_type,'byteLength',u.byte_length,'sha256',u.sha256,
    'metadata',u.metadata,'chunkBytes',393216,'totalChunks',(u.byte_length+393215)/393216,
    'receivedChunks',coalesce((select jsonb_agg(chunk_index order by chunk_index) from private.file_upload_chunks where upload_id=u.id),'[]'::jsonb),
    'screenshotId',u.screenshot_id);
$$;
create function private.application_file_path(u private.file_uploads) returns text
language sql immutable security invoker set search_path='' as $$
  select u.owner_id::text||'/'||u.trade_id::text||'/mcp/'||u.id::text||'/original.'||
    case u.content_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end;
$$;
create function private.application_file_chunk_path(u private.file_uploads,p_index integer,p_hash text) returns text
language sql immutable security invoker set search_path='' as $$
  select u.owner_id::text||'/'||u.trade_id::text||'/'||u.id::text||'/chunks/'||p_index::text||'-'||p_hash||'.part';
$$;

create function private.application_file_read(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); action text:=request->>'action'; u private.file_uploads;
  record jsonb; records jsonb; page_size integer; cursor uuid;
begin
  if jsonb_typeof(request) is distinct from 'object' then raise exception 'Invalid file query.' using errcode='22023';end if;
  if action='LIST' then
    if request-array['action','tradeId','afterId','limit']<>'{}'::jsonb or jsonb_typeof(request->'limit') is distinct from 'number' or request->>'limit' !~ '^[0-9]+$' then raise exception 'Invalid file query.' using errcode='22023';end if;
    page_size:=(request->>'limit')::integer;
    if page_size not between 1 and 100 then raise exception 'Invalid page.' using errcode='22023';end if;
    if request?'tradeId' and not exists(select 1 from public.trades where id=(request->>'tradeId')::uuid and user_id=auth.uid()) then raise exception 'Trade not found.' using errcode='P0002';end if;
    select coalesce(jsonb_agg(private.application_file_record(id) order by id),'[]'::jsonb) into records from
      (select id from public.trade_screenshots where user_id=auth.uid()
        and (request->>'tradeId' is null or trade_id=(request->>'tradeId')::uuid)
        and (request->>'afterId' is null or id>(request->>'afterId')::uuid) order by id limit page_size+1) s;
    if jsonb_array_length(records)>page_size then cursor:=(records->(page_size-1)->>'id')::uuid;records:=records-page_size;end if;
    return jsonb_build_object('records',records,'nextCursor',cursor);
  elsif action in ('GET','DOWNLOAD') then
    if request-array['action','screenshotId']<>'{}'::jsonb then raise exception 'Invalid screenshot query.' using errcode='22023';end if;
    record:=private.application_file_record((request->>'screenshotId')::uuid);
    if action='GET' then return record;end if;
    return jsonb_build_object('record',record,'ownerId',auth.uid(),'storagePath',(select storage_path from public.trade_screenshots where id=(request->>'screenshotId')::uuid and user_id=auth.uid()));
  elsif action='UPLOAD' then
    if request-array['action','uploadId']<>'{}'::jsonb then raise exception 'Invalid upload query.' using errcode='22023';end if;
    select * into u from private.file_uploads where id=(request->>'uploadId')::uuid and owner_id=auth.uid()
      and actor_key=actor->>'actorKey' and grant_id is not distinct from (actor->>'grant_id')::uuid and resource is not distinct from actor->>'resource';
    if not found then raise exception 'Upload not found.' using errcode='P0002';end if;
    return private.application_file_upload_wire(u);
  end if;
  raise exception 'Unsupported file query.' using errcode='22023';
end;$$;

create function private.application_file_validate(request jsonb) returns text
language plpgsql security invoker set search_path='' as $$
declare action text:=request->>'action'; fields text[]; m jsonb:=request->'metadata';
begin
  fields:=case action when 'REQUEST' then array['action','operationId','tradeId','expectedTradeVersion','metadata','contentType','byteLength','sha256']
    when 'CHUNK' then array['action','operationId','uploadId','expectedVersion','chunkIndex','byteLength','sha256']
    when 'FINISH' then array['action','operationId','uploadId','expectedVersion','expectedTradeVersion'] end;
  if fields is null or jsonb_typeof(request) is distinct from 'object' or not(request?&fields) or request-fields<>'{}'::jsonb
    or jsonb_typeof(request->'operationId') is distinct from 'string' then raise exception 'Invalid file command.' using errcode='22023';end if;
  perform (request->>'operationId')::uuid;
  if action in ('REQUEST','FINISH') and (jsonb_typeof(request->'expectedTradeVersion') is distinct from 'string' or request->>'expectedTradeVersion' !~ '^[1-9][0-9]{0,18}$') then raise exception 'Trade version required.' using errcode='22023';end if;
  if action<>'REQUEST' and (jsonb_typeof(request->'expectedVersion') is distinct from 'string' or request->>'expectedVersion' !~ '^[1-9][0-9]{0,18}$') then raise exception 'Upload version required.' using errcode='22023';end if;
  if action in ('REQUEST','CHUNK') and (jsonb_typeof(request->'byteLength') is distinct from 'number' or request->>'byteLength' !~ '^[1-9][0-9]*$'
    or jsonb_typeof(request->'sha256') is distinct from 'string' or request->>'sha256' !~ '^[a-f0-9]{64}$') then raise exception 'Exact file facts required.' using errcode='22023';end if;
  if action='REQUEST' then
    if (request->>'byteLength')::integer not between 1 and 10485760 or jsonb_typeof(request->'contentType') is distinct from 'string' or request->>'contentType' not in ('image/png','image/jpeg','image/webp')
      or jsonb_typeof(m) is distinct from 'object' or not(m?&array['category','timeframe','caption','capturedAt']) or m-array['category','timeframe','caption','capturedAt']<>'{}'::jsonb
      or jsonb_typeof(m->'category') is distinct from 'string'
      or (m->'timeframe'<>'null'::jsonb and jsonb_typeof(m->'timeframe') is distinct from 'string')
      or (m->'caption'<>'null'::jsonb and (jsonb_typeof(m->'caption') is distinct from 'string' or length(m->>'caption')>1000))
      or (m->'capturedAt'<>'null'::jsonb and (jsonb_typeof(m->'capturedAt') is distinct from 'string' or m->>'capturedAt' !~ 'Z$')) then raise exception 'Invalid screenshot metadata.' using errcode='22023';end if;
    perform (m->>'category')::public.screenshot_category,(m->>'timeframe')::public.timeframe,(m->>'capturedAt')::timestamptz;
  elsif action='CHUNK' then
    if jsonb_typeof(request->'chunkIndex') is distinct from 'number' or request->>'chunkIndex' !~ '^[0-9]+$' or (request->>'byteLength')::integer not between 1 and 393216 then raise exception 'Invalid chunk.' using errcode='22023';end if;
  end if;
  return action;
end;$$;

create function private.application_file_prepare(request jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); action text:=private.application_file_validate(request); receipt jsonb;
  u private.file_uploads; chunks jsonb; index_value integer; trade_version text;
begin
  receipt:=private.application_operation_result(request,'FILE_'||action);
  if receipt is not null then return jsonb_build_object('receipt',receipt);end if;
  if action='REQUEST' then
    perform 1 from public.trades where id=(request->>'tradeId')::uuid and user_id=auth.uid() for update;
    if not found then raise exception 'Trade not found.' using errcode='P0002';end if;
    select record_version::text into trade_version from private.application_trade_versions where trade_id=(request->>'tradeId')::uuid;
    if trade_version is distinct from request->>'expectedTradeVersion' then raise exception 'Trade changed.' using errcode='40001';end if;
    return '{}';
  end if;
  select * into u from private.file_uploads where id=(request->>'uploadId')::uuid and owner_id=auth.uid()
    and actor_key=actor->>'actorKey' and grant_id is not distinct from (actor->>'grant_id')::uuid and resource is not distinct from actor->>'resource' for update;
  if not found then raise exception 'Upload not found.' using errcode='P0002';end if;
  if u.status<>'PENDING' or u.expires_at<=clock_timestamp() then raise exception 'Upload no longer pending.' using errcode='23514';end if;
  if u.version::text is distinct from request->>'expectedVersion' then raise exception 'Upload changed.' using errcode='40001';end if;
  if action='CHUNK' then
    index_value:=(request->>'chunkIndex')::integer;
    if index_value not between 0 and (u.byte_length-1)/393216 or (request->>'byteLength')::integer<>least(393216,u.byte_length-index_value*393216) then raise exception 'Chunk size/index conflict.' using errcode='23514';end if;
    if exists(select 1 from private.file_upload_chunks where upload_id=u.id and chunk_index=index_value and (sha256<>request->>'sha256' or byte_length<>(request->>'byteLength')::integer)) then raise exception 'Chunk content conflict.' using errcode='23514';end if;
    return jsonb_build_object('upload',private.application_file_upload_wire(u),'ownerId',u.owner_id,
      'storagePath',private.application_file_chunk_path(u,index_value,request->>'sha256'));
  end if;
  perform 1 from public.trades where id=u.trade_id and user_id=auth.uid() for update;
  if not found then raise exception 'Trade not found.' using errcode='P0002';end if;
  select record_version::text into trade_version from private.application_trade_versions where trade_id=u.trade_id;
  if trade_version is distinct from request->>'expectedTradeVersion' then raise exception 'Trade changed.' using errcode='40001';end if;
  if (select count(*) from private.file_upload_chunks where upload_id=u.id)<>(u.byte_length+393215)/393216
    or exists(select 1 from private.file_upload_chunks where upload_id=u.id and
      (chunk_index>(u.byte_length-1)/393216 or byte_length<>least(393216,u.byte_length-chunk_index*393216))) then
    raise exception 'Upload incomplete.' using errcode='23514';end if;
  select jsonb_agg(jsonb_build_object('chunkIndex',chunk_index,'byteLength',byte_length,'sha256',sha256,
    'storagePath',private.application_file_chunk_path(u,chunk_index,sha256)) order by chunk_index) into chunks from private.file_upload_chunks where upload_id=u.id;
  return jsonb_build_object('upload',private.application_file_upload_wire(u),'ownerId',u.owner_id,'storagePath',private.application_file_path(u),'chunks',chunks);
end;$$;

create function private.application_file_write(request jsonb,proposal jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor jsonb:=private.application_actor(); action text:=private.application_file_validate(request); prepared jsonb;
  u private.file_uploads; result jsonb; screenshot uuid; mime text; size_value integer; stored_hash text;
begin
  prepared:=private.application_file_prepare(request);
  if prepared?'receipt' then return prepared->'receipt';end if;
  if action='REQUEST' then
    insert into private.file_uploads(owner_id,actor_key,grant_id,resource,trade_id,metadata,content_type,byte_length,sha256)
      values(auth.uid(),actor->>'actorKey',(actor->>'grant_id')::uuid,actor->>'resource',(request->>'tradeId')::uuid,
        request->'metadata',request->>'contentType',(request->>'byteLength')::integer,request->>'sha256') returning * into u;
  else
    select * into u from private.file_uploads where id=(request->>'uploadId')::uuid and owner_id=auth.uid();
    select metadata->>'mimetype',(metadata->>'size')::integer,user_metadata->>'tradeOsSha256' into mime,size_value,stored_hash from storage.objects
      where bucket_id=case action when 'CHUNK' then 'trade-file-staging' else 'trade-screenshots' end and name=prepared->>'storagePath';
    if action='CHUNK' then
      if mime is distinct from 'application/octet-stream' or size_value is distinct from (request->>'byteLength')::integer or stored_hash is distinct from request->>'sha256' then raise exception 'Stored chunk facts conflict.' using errcode='23514';end if;
      if not exists(select 1 from private.file_upload_chunks where upload_id=u.id and chunk_index=(request->>'chunkIndex')::integer) then
        insert into private.file_upload_chunks(upload_id,chunk_index,byte_length,sha256) values(u.id,(request->>'chunkIndex')::integer,(request->>'byteLength')::integer,request->>'sha256');
        update private.file_uploads set version=version+1 where id=u.id returning * into u;
      end if;
    else
      if jsonb_typeof(proposal) is distinct from 'object' or proposal-array['byteLength','sha256','contentType','width','height']<>'{}'::jsonb or not(proposal?&array['byteLength','sha256','contentType','width','height'])
        or jsonb_typeof(proposal->'width') is distinct from 'number' or jsonb_typeof(proposal->'height') is distinct from 'number'
        or proposal->>'width' !~ '^[1-9][0-9]*$' or proposal->>'height' !~ '^[1-9][0-9]*$'
        or proposal->>'sha256' is distinct from u.sha256 or proposal->>'contentType' is distinct from u.content_type
        or (proposal->>'byteLength')::integer is distinct from u.byte_length or (proposal->>'width')::integer<1 or (proposal->>'height')::integer<1
        or (proposal->>'width')::bigint*(proposal->>'height')::bigint>16000000 or mime is distinct from u.content_type
        or size_value is distinct from u.byte_length or stored_hash is distinct from u.sha256 then raise exception 'Verified file facts conflict.' using errcode='23514';end if;
      insert into public.trade_screenshots(user_id,trade_id,category,timeframe,storage_path,caption,captured_at)
        values(auth.uid(),u.trade_id,(u.metadata->>'category')::public.screenshot_category,(u.metadata->>'timeframe')::public.timeframe,
          prepared->>'storagePath',u.metadata->>'caption',(u.metadata->>'capturedAt')::timestamptz) returning id into screenshot;
      update private.file_uploads set status='COMPLETE',version=version+1,screenshot_id=screenshot,
        width=(proposal->>'width')::integer,height=(proposal->>'height')::integer where id=u.id returning * into u;
    end if;
  end if;
  result:=jsonb_build_object('action',action,'upload',private.application_file_upload_wire(u),
    'screenshot',case when u.screenshot_id is not null then private.application_file_record(u.screenshot_id) else null end,
    'tradeVersion',case when action='FINISH' then (select record_version::text from private.application_trade_versions where trade_id=u.trade_id) else null end);
  perform private.application_record_operation(request,'FILE_'||action,result,jsonb_build_object('uploadId',u.id,'tradeId',u.trade_id,'screenshotId',u.screenshot_id),
    jsonb_build_object('action',action,'contentType',u.content_type,'byteLength',u.byte_length,'sha256',u.sha256,'chunkIndex',request->'chunkIndex'));
  return result;
end;$$;
revoke all on function private.file_evidence_guard(),private.application_file_record(uuid),private.application_file_upload_wire(private.file_uploads),
  private.application_file_path(private.file_uploads),private.application_file_chunk_path(private.file_uploads,integer,text),
  private.application_file_read(jsonb),private.application_file_validate(jsonb),private.application_file_prepare(jsonb),private.application_file_write(jsonb,jsonb)
  from public,anon,authenticated,service_role;
