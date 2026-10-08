-- Self-owned preferences only. Auth identities, credentials and trading facts
-- are not exposed. Old rows retain their preference values and timestamps.
alter table public.profiles add column record_version bigint not null default 1 check (record_version > 0);
create trigger profile_record_version before insert or update on public.profiles
  for each row execute function private.account_record_version();
-- Normal browser writes now use the same verified server workflow as MCP.
-- Existing browser RLS/grants and the definer signup trigger stay unchanged;
-- OAuth tokens remain blocked from direct tables by existing restrictive RLS.

create function private.application_profile_read(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); result jsonb;
begin
  if request is distinct from '{}'::jsonb then raise exception 'Invalid profile query.' using errcode='22023';end if;
  select jsonb_build_object('id',p.id,'display_name',p.display_name,'timezone',p.timezone,
    'created_at',p.created_at,'updated_at',p.updated_at,'record_version',p.record_version::text)
    into result from public.profiles p where p.id=auth.uid();
  if result is null then raise exception 'Profile unavailable.' using errcode='P0002';end if;
  return result;
end;$$;

create function private.application_profile_write(request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare actor jsonb:=private.application_actor(); receipt jsonb; target public.profiles;
  values_json jsonb:=request->'values'; before_row jsonb; after_row jsonb; result jsonb;
begin
  if jsonb_typeof(request) is distinct from 'object'
    or request-array['operationId','expectedVersion','values']<>'{}'::jsonb
    or not request ?& array['operationId','expectedVersion','values']
    or jsonb_typeof(request->'operationId') is distinct from 'string'
    or jsonb_typeof(request->'expectedVersion') is distinct from 'string'
    or request->>'expectedVersion' !~ '^[1-9][0-9]{0,18}$'
    or (request->>'expectedVersion')::numeric>9223372036854775807
    or jsonb_typeof(values_json) is distinct from 'object' or values_json='{}'::jsonb
    or values_json-array['displayName','timezone']<>'{}'::jsonb
    then raise exception 'Invalid profile command.' using errcode='22023';end if;
  receipt:=private.application_operation_result(request,'PROFILE_PATCH');
  if receipt is not null then return receipt;end if;
  if values_json ? 'displayName' and values_json->'displayName'<>'null'::jsonb then
    if jsonb_typeof(values_json->'displayName')<>'string' or values_json->>'displayName'<>btrim(values_json->>'displayName')
      or length(values_json->>'displayName') not between 2 and 80
      then raise exception 'Invalid display name.' using errcode='22023';end if;
  end if;
  if values_json ? 'timezone' then
    if jsonb_typeof(values_json->'timezone') is distinct from 'string' or length(values_json->>'timezone') not between 1 and 100
      or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=values_json->>'timezone'
        and z.name not like 'posix/%' and z.name not like 'right/%')
      then raise exception 'Invalid profile timezone.' using errcode='22023';end if;
  end if;
  select * into target from public.profiles p where p.id=auth.uid() for update;
  if not found then raise exception 'Profile unavailable.' using errcode='P0002';end if;
  if target.record_version::text is distinct from request->>'expectedVersion'
    then raise exception 'Profile version conflict.' using errcode='40001';end if;
  before_row:=private.application_profile_read('{}');
  update public.profiles set display_name=case when values_json ? 'displayName' then values_json->>'displayName' else target.display_name end,
    timezone=case when values_json ? 'timezone' then values_json->>'timezone' else target.timezone end where id=target.id;
  after_row:=private.application_profile_read('{}');
  result:=jsonb_build_object('action','PATCH','record',after_row);
  perform private.application_record_operation(request,'PROFILE_PATCH',result,jsonb_build_object('profileId',target.id),
    jsonb_build_object('before',before_row,'after',after_row));
  return result;
end;$$;
revoke all on function private.application_profile_read(jsonb),private.application_profile_write(jsonb)
  from public,anon,authenticated,service_role;
