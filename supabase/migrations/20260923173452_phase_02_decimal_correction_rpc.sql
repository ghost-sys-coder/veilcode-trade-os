-- Keep authoritative corrected numerics as text at the API boundary. PostgreSQL
-- performs the numeric parse before delegating to the audited JSONB workflow.

drop function if exists public.correct_trade_plan_value(uuid, text, jsonb, text, uuid);

create function public.correct_trade_plan_value(
  p_trade_id uuid,
  p_field_name text,
  p_new_value text,
  p_reason text,
  p_trade_target_id uuid default null
)
returns public.trade_plan_corrections
language sql
security invoker
set search_path = ''
as $$
  select private.correct_trade_plan_value(
    p_trade_id,
    p_field_name,
    case
      when p_field_name in ('strategy_id', 'setup_id', 'thesis', 'entry_reason', 'confirmation_notes', 'target.label')
        then to_jsonb(p_new_value)
      else to_jsonb(p_new_value::numeric)
    end,
    p_reason,
    p_trade_target_id
  );
$$;

revoke all on function public.correct_trade_plan_value(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.correct_trade_plan_value(uuid, text, text, text, uuid) to authenticated;
