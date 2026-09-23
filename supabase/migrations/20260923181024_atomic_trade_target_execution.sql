-- Update partial-exit facts as one transaction so a bad later row cannot leave
-- an earlier target partially saved.

create or replace function public.update_trade_target_execution(
  p_trade_id uuid,
  p_targets jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  trade_status public.trade_status;
  target jsonb;
  target_id uuid;
  actual_total numeric;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  if p_targets is null or jsonb_typeof(p_targets) <> 'array' then
    raise exception 'Targets must be supplied as an array.' using errcode = '22023';
  end if;

  select status into trade_status
  from public.trades
  where id = p_trade_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Trade not found.' using errcode = 'P0002';
  end if;

  if trade_status not in ('OPEN', 'CLOSED') then
    raise exception 'Execution facts are only recorded for open or closed trades.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_targets) as item
    where jsonb_typeof(item) <> 'object'
      or nullif(item ->> 'id', '') is null
  ) then
    raise exception 'Every execution target requires an id.' using errcode = '22023';
  end if;

  select coalesce(sum(coalesce(nullif(item ->> 'actual_close_percentage', '')::numeric, 0)), 0)
  into actual_total
  from jsonb_array_elements(p_targets) as item;

  if actual_total > 100 then
    raise exception 'Actual target percentages cannot exceed 100%%.' using errcode = '23514';
  end if;

  for target in select value from jsonb_array_elements(p_targets)
  loop
    target_id := (target ->> 'id')::uuid;

    update public.trade_targets
    set
      actual_fill_price = nullif(target ->> 'actual_fill_price', '')::numeric,
      actual_close_percentage = nullif(target ->> 'actual_close_percentage', '')::numeric,
      pnl_contribution = nullif(target ->> 'pnl_contribution', '')::numeric,
      hit_at = nullif(target ->> 'hit_at', '')::timestamptz
    where id = target_id and trade_id = p_trade_id and user_id = actor_id;

    if not found then
      raise exception 'Trade target not found.' using errcode = 'P0002';
    end if;
  end loop;
end;
$$;

revoke all on function public.update_trade_target_execution(uuid, jsonb) from public, anon;
grant execute on function public.update_trade_target_execution(uuid, jsonb) to authenticated;
