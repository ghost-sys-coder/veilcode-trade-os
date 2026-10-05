-- Keep the exposed RPC wrapper least-privileged; the audited private function
-- performs its own ownership checks under SECURITY DEFINER.

alter function public.correct_trade_plan_value(uuid, text, jsonb, text, uuid)
  security invoker;

-- This platform event-trigger helper is invoked by PostgreSQL, never by an API
-- caller. Remove inherited API execution privileges.
-- Hosted projects may provide it; fresh local Supabase databases do not.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
