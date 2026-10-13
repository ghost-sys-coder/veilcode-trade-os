-- Explicit direct-browser pairing only. Public files are observations, not grants.
create table private.mt5_setup_pairings (
  profile_id uuid primary key references private.integration_setup_profiles(id),
  owner_id uuid not null references auth.users(id),
  connection_id uuid not null references private.mt5_connections(id),
  grant_id uuid not null references private.integration_grants(id),
  operation_id uuid not null,
  proposal jsonb not null,
  reason text not null check(length(btrim(reason)) between 8 and 1000),
  approved_at timestamptz not null default clock_timestamp()
);
create index mt5_setup_pairings_owner on private.mt5_setup_pairings(owner_id);
create index mt5_setup_pairings_connection on private.mt5_setup_pairings(connection_id);
create index mt5_setup_pairings_grant on private.mt5_setup_pairings(grant_id);
alter table private.mt5_setup_pairings enable row level security;
revoke all on private.mt5_setup_pairings from public,anon,authenticated,service_role;
create trigger mt5_setup_pairings_immutable before update or delete on private.mt5_setup_pairings
  for each row execute function private.reject_integration_audit_mutation();

create function private.mt5_pairing_path_valid(path text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(length(path) between 4 and 2048 and left(path,1)~'^[A-Za-z]$'
    and substring(path from 2 for 2)=chr(58)||chr(92)
    and position(chr(58) in substring(path from 3))=0 and path!~'[[:cntrl:]<>|?*"]'
    and not exists(select 1 from unnest(string_to_array(path,chr(92))) with ordinality as p(value,n)
      where n>1 and (value in ('','.','..') or value~'[. ]$')),false);
$$;
create function private.mt5_pairing_view(p private.mt5_setup_pairings) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('proposal',p.proposal,'connectionId',p.connection_id,
    'operationId',p.operation_id,'reason',p.reason,'approvedAt',p.approved_at);
$$;
revoke all on function private.mt5_pairing_path_valid(text),private.mt5_pairing_view(private.mt5_setup_pairings) from public,anon,authenticated,service_role;

create function private.approve_mt5_setup_pairing(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  profile private.integration_setup_profiles; g private.integration_grants;
  connection private.mt5_connections; pairing private.mt5_setup_pairings;
  proposal jsonb:=p_request->'proposal'; terminal jsonb:=proposal->'terminal';
  actor jsonb; result jsonb; old_grant uuid; old_fence bigint;
begin
  perform private.require_direct_browser_session();
  if jsonb_typeof(p_request) is distinct from 'object'
    or p_request-array['profileId','profileVersion','operationId','proposal','connectionVersion','reason','confirmed']<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(p_request))<>7
    or jsonb_typeof(p_request->'reason') is distinct from 'string'
    or jsonb_typeof(p_request->'profileVersion') is distinct from 'string'
    or p_request->'confirmed' is distinct from 'true'::jsonb
    or length(btrim(p_request->>'reason')) not between 8 and 1000
    or p_request->>'operationId' is null then raise exception 'Invalid pairing request.' using errcode='22023'; end if;
  select * into profile from private.integration_setup_profiles where id=(p_request->>'profileId')::uuid and owner_id=auth.uid() for update;
  if not found or profile.purpose<>'MT5' or profile.status<>'READY' then
    raise exception 'Owned MT5 setup required.' using errcode='42501'; end if;
  if not exists(select 1 from private.integration_resources r join private.integration_setup_policies s using(purpose)
    where r.purpose='MT5' and r.resource=profile.resource and r.enabled and s.enabled) then
    raise exception 'Integration setup is disabled.' using errcode='42501'; end if;
  select * into g from private.integration_grants where owner_id=auth.uid() and client_id=profile.client_id
    and purpose='MT5' and account_id=profile.account_id and resource=profile.resource and status='ACTIVE' and revoked_at is null for share;
  if not found then raise exception 'Active setup grant required.' using errcode='42501'; end if;
  actor:=jsonb_build_object('user_id',g.owner_id,'client_id',g.client_id,'grant_id',g.id,'account_id',g.account_id,'purpose',g.purpose,'resource',g.resource);
  result:=private.integration_operation_result(actor,(p_request->>'operationId')::uuid,'MT5_SETUP_PAIR',p_request);
  if result is not null then return result; end if;
  if profile.version::text is distinct from p_request->>'profileVersion' then raise exception 'Setup version conflict.' using errcode='PT409'; end if;
  if jsonb_typeof(proposal) is distinct from 'object' or (select count(*) from jsonb_object_keys(proposal))<>9
    or proposal-array['format','version','profileId','ownerId','accountId','clientId','observedAt','existingConnectionId','terminal']<>'{}'::jsonb
    or proposal->>'format' is distinct from 'trade-os-mt5-pairing' or proposal->'version' is distinct from '1'::jsonb
    or proposal->>'profileId' is distinct from profile.id::text or proposal->>'ownerId' is distinct from auth.uid()::text
    or proposal->>'accountId' is distinct from profile.account_id::text or proposal->>'clientId' is distinct from profile.client_id::text
    or jsonb_typeof(terminal) is distinct from 'object' or (select count(*) from jsonb_object_keys(terminal))<>5
    or terminal-array['executable','dataPath','identity','dedicatedApproved','portable']<>'{}'::jsonb
    or terminal->'dedicatedApproved' is distinct from 'true'::jsonb or jsonb_typeof(terminal->'portable') is distinct from 'boolean'
    or not private.mt5_pairing_path_valid(terminal->>'executable') or not private.mt5_pairing_path_valid(terminal->>'dataPath')
    or lower(right(terminal->>'executable',15)) is distinct from chr(92)||'terminal64.exe'
    or private.mt5_identity_valid(terminal->'identity') is distinct from true or terminal->'identity'->>'accountKind'<>'DEMO'
    or proposal->>'observedAt' is null or proposal->>'observedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$'
    or (proposal->>'observedAt')::timestamptz>clock_timestamp()+interval '5 seconds'
    or (proposal->>'observedAt')::timestamptz<clock_timestamp()-interval '15 minutes'
    then raise exception 'Invalid or expired terminal proposal.' using errcode='22023'; end if;
  if not exists(select 1 from public.trading_accounts a where a.id=profile.account_id and a.user_id=auth.uid()
    and a.currency_code=terminal->'identity'->>'currencyCode' and a.currency_precision=(terminal->'identity'->>'currencyPrecision')::integer) then
    raise exception 'Account currency mismatch.' using errcode='22023'; end if;
  if exists(select 1 from private.mt5_setup_pairings where profile_id=profile.id) then raise exception 'Setup already paired.' using errcode='PT409'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mt5-setup-pair:'||profile.account_id::text,0));
  select * into connection from private.mt5_connections where owner_id=auth.uid() and account_id=profile.account_id for update;
  if found then
    if proposal->>'existingConnectionId' is distinct from connection.id::text
      or p_request->>'connectionVersion' is distinct from connection.version::text
      or connection.identity is distinct from terminal->'identity' or connection.status<>'PAUSED'
      or connection.attention_code is not null or connection.lease_expires_at>clock_timestamp() then
      raise exception 'Explicit paused same-terminal adoption required.' using errcode='PT409'; end if;
    if exists(select 1 from private.mt5_capture_progress where connection_id=connection.id and received_batch_count<expected_batch_count) then
      raise exception 'Incomplete capture must be recovered first.' using errcode='PT409'; end if;
    old_grant:=connection.grant_id;old_fence:=connection.fencing_token;
    update private.mt5_connections set grant_id=g.id,version=version+1,fencing_token=fencing_token+1,
      worker_id=null,lease_expires_at=null,last_heartbeat_at=null
      where id=connection.id returning * into connection;
  else
    if proposal->'existingConnectionId' is distinct from 'null'::jsonb or p_request->'connectionVersion' is distinct from 'null'::jsonb then
      raise exception 'Existing mapping unavailable.' using errcode='PT409'; end if;
    result:=private.mt5_register_connection(g.id,md5('mt5-setup-register:'||profile.id::text||(p_request->>'operationId'))::uuid,terminal->'identity');
    select * into connection from private.mt5_connections where id=(result->>'connectionId')::uuid;
  end if;
  insert into private.mt5_setup_pairings(profile_id,owner_id,connection_id,grant_id,operation_id,proposal,reason)
    values(profile.id,auth.uid(),connection.id,g.id,(p_request->>'operationId')::uuid,proposal,btrim(p_request->>'reason')) returning * into pairing;
  result:=private.mt5_pairing_view(pairing);
  perform private.record_integration_operation(actor,(p_request->>'operationId')::uuid,'MT5_SETUP_PAIR',p_request,result,
    jsonb_build_array(profile.id,connection.id),jsonb_build_object('actorType','BROWSER','reason',pairing.reason,
    'previousGrantId',old_grant,'grantId',g.id,'previousFence',old_fence,'fence',connection.fencing_token::text,
    'adopted',old_grant is not null,'status',connection.status));
  return result;
end;$$;

create function private.get_mt5_setup_pairing(p_profile_id uuid,p_resource text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile private.integration_setup_profiles; pairing private.mt5_setup_pairings; actor jsonb;
begin
  if auth.jwt()->>'client_id' is null then perform private.require_direct_browser_session();
  else actor:=private.authorize_integration(p_resource,'MT5'); end if;
  select * into profile from private.integration_setup_profiles where id=p_profile_id and owner_id=auth.uid();
  if not found or profile.purpose<>'MT5' or profile.status<>'READY' then raise exception 'Owned MT5 setup required.' using errcode='42501'; end if;
  if not exists(select 1 from private.integration_resources r join private.integration_setup_policies s using(purpose)
    where r.purpose='MT5' and r.resource=profile.resource and r.enabled and s.enabled) then
    raise exception 'Integration setup is disabled.' using errcode='42501'; end if;
  if actor is not null and (actor->>'client_id'<>profile.client_id::text or actor->>'account_id'<>profile.account_id::text) then
    raise exception 'Pairing access denied.' using errcode='42501'; end if;
  select p.* into pairing from private.mt5_setup_pairings p join private.integration_grants g on g.id=p.grant_id
    join private.mt5_connections c on c.id=p.connection_id
    join public.trading_accounts a on a.id=c.account_id and a.user_id=c.owner_id
    where p.profile_id=profile.id and g.status='ACTIVE' and g.revoked_at is null and c.grant_id=g.id
      and c.identity=p.proposal->'terminal'->'identity'
      and a.currency_code=c.identity->>'currencyCode' and a.currency_precision=(c.identity->>'currencyPrecision')::integer;
  if not found then return null; end if;
  return private.mt5_pairing_view(pairing);
end;$$;
create function public.approve_mt5_setup_pairing(p_request jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.approve_mt5_setup_pairing(p_request); $$;
create function public.get_mt5_setup_pairing(p_profile_id uuid,p_resource text) returns jsonb
language sql security invoker set search_path='' as $$ select private.get_mt5_setup_pairing(p_profile_id,p_resource); $$;
revoke all on function private.approve_mt5_setup_pairing(jsonb),private.get_mt5_setup_pairing(uuid,text),
  public.approve_mt5_setup_pairing(jsonb),public.get_mt5_setup_pairing(uuid,text) from public,anon,service_role;
grant execute on function private.approve_mt5_setup_pairing(jsonb),private.get_mt5_setup_pairing(uuid,text),
  public.approve_mt5_setup_pairing(jsonb),public.get_mt5_setup_pairing(uuid,text) to authenticated;
