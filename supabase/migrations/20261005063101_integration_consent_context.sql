create function private.get_integration_consent_request(p_authorization_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare request auth.oauth_authorizations; configured private.integration_resources;
begin
  perform private.require_direct_browser_session();
  select * into request from auth.oauth_authorizations where authorization_id = p_authorization_id
    and user_id = auth.uid() and expires_at > clock_timestamp() and status::text in ('pending','approved');
  if not found then raise exception 'Invalid authorization request.' using errcode = '42501'; end if;
  select * into configured from private.integration_resources where resource = request.resource and enabled;
  if not found or lower(request.code_challenge_method::text) is distinct from 's256' then
    raise exception 'Resource-bound S256 authorization is required.' using errcode = '42501';
  end if;
  return jsonb_build_object('client_id',request.client_id,'purpose',configured.purpose,
    'resource',configured.resource,'callback',request.redirect_uri,'status',request.status);
end;
$$;
create function public.get_integration_consent_request(p_authorization_id text) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.get_integration_consent_request(p_authorization_id);
$$;
revoke all on function private.get_integration_consent_request(text), public.get_integration_consent_request(text) from public,anon;
grant execute on function private.get_integration_consent_request(text), public.get_integration_consent_request(text) to authenticated;

-- The app grant is inactive until provider approval has actually committed.
-- A lost provider acknowledgement cannot leave a usable half-approved grant.
create function private.activate_integration_grant(p_authorization_id text, p_expected_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g private.integration_grants;
begin
  perform private.require_direct_browser_session();
  select * into g from private.integration_grants where owner_id = auth.uid()
    and authorization_id = p_authorization_id and revoked_at is null for update;
  if not found then raise exception 'Grant unavailable.' using errcode = '42501'; end if;
  if g.version::text <> p_expected_version then raise exception 'Grant version conflict.' using errcode = '40001'; end if;
  if not exists(select 1 from auth.oauth_authorizations a where a.authorization_id = p_authorization_id
    and a.user_id = g.owner_id and a.client_id = g.client_id and a.resource = g.resource and a.status::text = 'approved') then
    raise exception 'Provider approval is required.' using errcode = '42501';
  end if;
  if g.status = 'PENDING' then
    update private.integration_grants set status = 'ACTIVE', updated_at = clock_timestamp() where id = g.id;
    insert into private.integration_grant_events(grant_id,actor_user_id,event_type,version,account_id,resource)
      values(g.id,auth.uid(),'ACTIVATED',g.version,g.account_id,g.resource);
  end if;
  return jsonb_build_object('id',g.id,'version',g.version::text,'status','ACTIVE');
end;
$$;
create function public.activate_integration_grant(p_authorization_id text, p_expected_version text) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.activate_integration_grant(p_authorization_id,p_expected_version);
$$;
revoke all on function private.activate_integration_grant(text,text), public.activate_integration_grant(text,text) from public,anon;
grant execute on function private.activate_integration_grant(text,text), public.activate_integration_grant(text,text) to authenticated;
