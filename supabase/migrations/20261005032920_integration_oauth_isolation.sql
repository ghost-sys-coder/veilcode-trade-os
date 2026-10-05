-- OAuth scopes do not restrict PostgreSQL access. Until narrowly authorized
-- integration RPCs exist, OAuth sessions have NO direct workspace access.
-- Existing browser ownership policies remain in force for direct sessions.

create function private.require_direct_browser_session()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or (auth.jwt() ->> 'client_id') is not null then
    raise exception 'A direct browser session is required.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_direct_browser_session() from public, anon;
grant execute on function private.require_direct_browser_session() to authenticated;

do $$
declare
  target record;
begin
  for target in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format(
      'create policy trade_os_direct_browser_only on %I.%I as restrictive for all to authenticated
       using ((select auth.jwt() ->> ''client_id'') is null)
       with check ((select auth.jwt() ->> ''client_id'') is null)',
      target.nspname, target.relname
    );
  end loop;
end;
$$;

create policy trade_os_direct_browser_only on storage.objects
as restrictive for all to authenticated
using ((select auth.jwt() ->> 'client_id') is null)
with check ((select auth.jwt() ->> 'client_id') is null);

-- SECURITY DEFINER legacy workflows can bypass RLS. Add the same guard to
-- their executable block, including the public invoker workflows, preserving
-- their typed signatures, existing bodies, ACLs and empty search paths.
-- Scope is explicit; trigger-only and platform/extension routines are not edited.
do $$
declare
  target record;
  original_definition text;
  guarded_body text;
  guarded_count integer := 0;
begin
  for target in
    select p.oid, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where p.prokind = 'f' and l.lanname = 'plpgsql' and (
      (n.nspname = 'private' and p.proname in (
        'correct_trade_plan_value', 'complete_trade_rule_review', 'transition_account_status'
      )) or
      (n.nspname = 'public' and p.proname in (
        'replace_trade_targets', 'update_trade_target_execution', 'classify_account_adjustment'
      ))
    )
  loop
    original_definition := pg_get_functiondef(target.oid);
    guarded_body := regexp_replace(target.prosrc, '\mbegin\M',
      E'begin\n  perform private.require_direct_browser_session();', 'i');
    if guarded_body = target.prosrc then
      raise exception 'Legacy OAuth isolation could not guard an expected workflow.';
    end if;
    execute replace(original_definition, target.prosrc, guarded_body);
    guarded_count := guarded_count + 1;
  end loop;
  if guarded_count <> 6 then
    raise exception 'Legacy OAuth isolation expected six workflows, found %.', guarded_count;
  end if;
end;
$$;
