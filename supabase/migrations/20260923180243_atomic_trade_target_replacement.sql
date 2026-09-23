-- Replace the editable plan targets in one database statement. Any validation,
-- delete, or insert failure rolls the entire function call back.

create or replace function public.replace_trade_targets(
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
  planned_total numeric;
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

  if trade_status not in ('DRAFT', 'PLANNED', 'CANCELED') then
    raise exception 'Planned targets cannot be replaced after a trade has opened.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_targets) as target
    where jsonb_typeof(target) <> 'object'
      or btrim(coalesce(target ->> 'label', '')) = ''
      or nullif(target ->> 'planned_price', '') is null
  ) then
    raise exception 'Each target requires a label and planned price.' using errcode = '22023';
  end if;

  select coalesce(sum(coalesce(nullif(target ->> 'planned_close_percentage', '')::numeric, 0)), 0)
  into planned_total
  from jsonb_array_elements(p_targets) as target;

  if planned_total > 100 then
    raise exception 'Planned target percentages cannot exceed 100%%.' using errcode = '23514';
  end if;

  delete from public.trade_targets
  where trade_id = p_trade_id and user_id = actor_id;

  insert into public.trade_targets (
    user_id,
    trade_id,
    label,
    planned_price,
    planned_close_percentage,
    actual_fill_price,
    actual_close_percentage,
    pnl_contribution,
    hit_at
  )
  select
    actor_id,
    p_trade_id,
    btrim(target ->> 'label'),
    (target ->> 'planned_price')::numeric,
    nullif(target ->> 'planned_close_percentage', '')::numeric,
    nullif(target ->> 'actual_fill_price', '')::numeric,
    nullif(target ->> 'actual_close_percentage', '')::numeric,
    nullif(target ->> 'pnl_contribution', '')::numeric,
    nullif(target ->> 'hit_at', '')::timestamptz
  from jsonb_array_elements(p_targets) with ordinality as item(target, position)
  order by position;
end;
$$;

revoke all on function public.replace_trade_targets(uuid, jsonb) from public, anon;
grant execute on function public.replace_trade_targets(uuid, jsonb) to authenticated;
