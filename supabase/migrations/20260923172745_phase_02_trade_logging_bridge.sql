-- Public API bridge for the audited correction workflow and lifecycle guards.

create or replace function public.correct_trade_plan_value(
  p_trade_id uuid,
  p_field_name text,
  p_new_value jsonb,
  p_reason text,
  p_trade_target_id uuid default null
)
returns public.trade_plan_corrections
language sql
security definer
set search_path = ''
as $$
  select private.correct_trade_plan_value(
    p_trade_id,
    p_field_name,
    p_new_value,
    p_reason,
    p_trade_target_id
  );
$$;

revoke all on function public.correct_trade_plan_value(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.correct_trade_plan_value(uuid, text, jsonb, text, uuid) to authenticated;

create or replace function private.protect_trade_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'CLOSED' and new.status <> 'CLOSED' then
    raise exception 'A closed trade cannot return to an earlier lifecycle state.' using errcode = '23514';
  end if;

  if old.status = 'OPEN' and new.status not in ('OPEN', 'CLOSED') then
    raise exception 'An open trade can only remain open or be closed.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trades_protect_lifecycle on public.trades;
create trigger trades_protect_lifecycle
before update of status on public.trades
for each row execute function private.protect_trade_lifecycle();
