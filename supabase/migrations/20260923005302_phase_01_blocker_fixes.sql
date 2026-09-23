-- Close the Phase 01 review gaps without rewriting the applied foundation migration.

create or replace function private.protect_trade_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('OPEN', 'CLOSED') and current_user <> 'postgres' and (
    new.planned_entry is distinct from old.planned_entry or
    new.planned_stop_loss is distinct from old.planned_stop_loss or
    new.planned_take_profit is distinct from old.planned_take_profit or
    new.planned_lot_size is distinct from old.planned_lot_size or
    new.planned_risk_amount is distinct from old.planned_risk_amount or
    new.planned_risk_percentage is distinct from old.planned_risk_percentage or
    new.planned_reward_amount is distinct from old.planned_reward_amount or
    new.planned_risk_reward is distinct from old.planned_risk_reward or
    new.strategy_id is distinct from old.strategy_id or
    new.setup_id is distinct from old.setup_id or
    new.thesis is distinct from old.thesis or
    new.entry_reason is distinct from old.entry_reason or
    new.confirmation_notes is distinct from old.confirmation_notes
  ) then
    raise exception 'Protected planned values require the correction workflow.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trade_targets_protect_plan on public.trade_targets;

create or replace function private.protect_trade_target_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_trade_id uuid;
  parent_status public.trade_status;
begin
  parent_trade_id := case when tg_op = 'INSERT' then new.trade_id else old.trade_id end;
  select status into parent_status from public.trades where id = parent_trade_id;

  if parent_status in ('OPEN', 'CLOSED') and current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      raise exception 'Planned targets cannot be added after a trade has opened.' using errcode = '42501';
    elsif tg_op = 'DELETE' then
      raise exception 'Planned targets cannot be deleted after a trade has opened.' using errcode = '42501';
    elsif new.trade_id is distinct from old.trade_id or
      new.user_id is distinct from old.user_id or
      new.label is distinct from old.label or
      new.planned_price is distinct from old.planned_price or
      new.planned_close_percentage is distinct from old.planned_close_percentage
    then
      raise exception 'Protected planned target values require the correction workflow.' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trade_targets_protect_plan
before insert or update or delete on public.trade_targets
for each row execute function private.protect_trade_target_plan();

alter table public.trade_plan_corrections
  drop constraint trade_plan_corrections_field_name;

alter table public.trade_plan_corrections
  add constraint trade_plan_corrections_field_name check (field_name in (
    'planned_entry', 'planned_stop_loss', 'planned_take_profit', 'planned_lot_size',
    'planned_risk_amount', 'planned_risk_percentage', 'planned_reward_amount',
    'planned_risk_reward', 'strategy_id', 'setup_id', 'thesis', 'entry_reason',
    'confirmation_notes', 'target.label', 'target.planned_price',
    'target.planned_close_percentage'
  ));

create or replace function private.correct_trade_plan_value(
  p_trade_id uuid,
  p_field_name text,
  p_new_value jsonb,
  p_reason text,
  p_trade_target_id uuid default null
)
returns public.trade_plan_corrections
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  trade_row public.trades;
  target_row public.trade_targets;
  previous_value jsonb;
  value_type text;
  correction public.trade_plan_corrections;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'A meaningful correction reason is required.' using errcode = '22023';
  end if;

  select * into trade_row
  from public.trades
  where id = p_trade_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Trade not found.' using errcode = 'P0002';
  end if;

  if trade_row.status not in ('OPEN', 'CLOSED') then
    raise exception 'Corrections are only valid after a trade has opened.' using errcode = '22023';
  end if;

  if p_field_name like 'target.%' then
    select * into target_row
    from public.trade_targets
    where id = p_trade_target_id and trade_id = p_trade_id and user_id = actor_id
    for update;

    if not found then
      raise exception 'Trade target not found.' using errcode = 'P0002';
    end if;

    if p_field_name = 'target.label' then
      value_type := 'text';
      if jsonb_typeof(p_new_value) <> 'string' or length(btrim(p_new_value #>> '{}')) = 0 then
        raise exception 'The corrected target label must be nonblank text.' using errcode = '22023';
      end if;
      previous_value := to_jsonb(target_row.label);
      update public.trade_targets
      set label = p_new_value #>> '{}'
      where id = p_trade_target_id;
    else
      value_type := 'numeric';
      if p_new_value <> 'null'::jsonb and jsonb_typeof(p_new_value) <> 'number' then
        raise exception 'The corrected target value must be numeric or null.' using errcode = '22023';
      end if;

      if p_field_name = 'target.planned_price' then
        if p_new_value = 'null'::jsonb then
          raise exception 'A planned target price cannot be null.' using errcode = '22023';
        end if;
        previous_value := to_jsonb(target_row.planned_price);
        update public.trade_targets
        set planned_price = (p_new_value #>> '{}')::numeric
        where id = p_trade_target_id;
      elsif p_field_name = 'target.planned_close_percentage' then
        previous_value := coalesce(to_jsonb(target_row.planned_close_percentage), 'null'::jsonb);
        update public.trade_targets
        set planned_close_percentage = (p_new_value #>> '{}')::numeric
        where id = p_trade_target_id;
      else
        raise exception 'Unsupported protected target field.' using errcode = '22023';
      end if;
    end if;
  else
    if p_trade_target_id is not null then
      raise exception 'A trade target is only valid for target fields.' using errcode = '22023';
    end if;

    case p_field_name
      when 'planned_entry' then previous_value := coalesce(to_jsonb(trade_row.planned_entry), 'null'::jsonb); value_type := 'numeric';
      when 'planned_stop_loss' then previous_value := coalesce(to_jsonb(trade_row.planned_stop_loss), 'null'::jsonb); value_type := 'numeric';
      when 'planned_take_profit' then previous_value := coalesce(to_jsonb(trade_row.planned_take_profit), 'null'::jsonb); value_type := 'numeric';
      when 'planned_lot_size' then previous_value := coalesce(to_jsonb(trade_row.planned_lot_size), 'null'::jsonb); value_type := 'numeric';
      when 'planned_risk_amount' then previous_value := coalesce(to_jsonb(trade_row.planned_risk_amount), 'null'::jsonb); value_type := 'numeric';
      when 'planned_risk_percentage' then previous_value := coalesce(to_jsonb(trade_row.planned_risk_percentage), 'null'::jsonb); value_type := 'numeric';
      when 'planned_reward_amount' then previous_value := coalesce(to_jsonb(trade_row.planned_reward_amount), 'null'::jsonb); value_type := 'numeric';
      when 'planned_risk_reward' then previous_value := coalesce(to_jsonb(trade_row.planned_risk_reward), 'null'::jsonb); value_type := 'numeric';
      when 'strategy_id' then previous_value := coalesce(to_jsonb(trade_row.strategy_id), 'null'::jsonb); value_type := 'uuid';
      when 'setup_id' then previous_value := coalesce(to_jsonb(trade_row.setup_id), 'null'::jsonb); value_type := 'uuid';
      when 'thesis' then previous_value := coalesce(to_jsonb(trade_row.thesis), 'null'::jsonb); value_type := 'text';
      when 'entry_reason' then previous_value := coalesce(to_jsonb(trade_row.entry_reason), 'null'::jsonb); value_type := 'text';
      when 'confirmation_notes' then previous_value := coalesce(to_jsonb(trade_row.confirmation_notes), 'null'::jsonb); value_type := 'text';
      else raise exception 'Unsupported protected trade field.' using errcode = '22023';
    end case;

    if value_type = 'numeric' and p_new_value <> 'null'::jsonb and jsonb_typeof(p_new_value) <> 'number' then
      raise exception 'The corrected value must be numeric or null.' using errcode = '22023';
    elsif value_type in ('text', 'uuid') and p_new_value <> 'null'::jsonb and jsonb_typeof(p_new_value) <> 'string' then
      raise exception 'The corrected value has the wrong type.' using errcode = '22023';
    end if;

    update public.trades
    set
      planned_entry = case when p_field_name = 'planned_entry' then (p_new_value #>> '{}')::numeric else planned_entry end,
      planned_stop_loss = case when p_field_name = 'planned_stop_loss' then (p_new_value #>> '{}')::numeric else planned_stop_loss end,
      planned_take_profit = case when p_field_name = 'planned_take_profit' then (p_new_value #>> '{}')::numeric else planned_take_profit end,
      planned_lot_size = case when p_field_name = 'planned_lot_size' then (p_new_value #>> '{}')::numeric else planned_lot_size end,
      planned_risk_amount = case when p_field_name = 'planned_risk_amount' then (p_new_value #>> '{}')::numeric else planned_risk_amount end,
      planned_risk_percentage = case when p_field_name = 'planned_risk_percentage' then (p_new_value #>> '{}')::numeric else planned_risk_percentage end,
      planned_reward_amount = case when p_field_name = 'planned_reward_amount' then (p_new_value #>> '{}')::numeric else planned_reward_amount end,
      planned_risk_reward = case when p_field_name = 'planned_risk_reward' then (p_new_value #>> '{}')::numeric else planned_risk_reward end,
      strategy_id = case when p_field_name = 'strategy_id' then (p_new_value #>> '{}')::uuid else strategy_id end,
      setup_id = case when p_field_name = 'setup_id' then (p_new_value #>> '{}')::uuid else setup_id end,
      thesis = case when p_field_name = 'thesis' then p_new_value #>> '{}' else thesis end,
      entry_reason = case when p_field_name = 'entry_reason' then p_new_value #>> '{}' else entry_reason end,
      confirmation_notes = case when p_field_name = 'confirmation_notes' then p_new_value #>> '{}' else confirmation_notes end
    where id = p_trade_id;
  end if;

  insert into public.trade_plan_corrections (
    user_id, trade_id, trade_target_id, field_name, value_type,
    previous_value, new_value, reason, actor_user_id
  ) values (
    actor_id, p_trade_id, p_trade_target_id, p_field_name, value_type,
    previous_value, p_new_value, btrim(p_reason), actor_id
  ) returning * into correction;

  return correction;
end;
$$;

revoke all on function private.correct_trade_plan_value(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function private.correct_trade_plan_value(uuid, text, jsonb, text, uuid) to authenticated;

create or replace function private.normalize_and_validate_trade_outcome()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  account_precision smallint;
  normalized_pnl numeric;
  used_partial_exits boolean;
  expected_outcome public.trade_outcome;
begin
  if new.status <> 'CLOSED' then
    return new;
  end if;

  if new.net_pnl is null or new.outcome is null then
    raise exception 'Closed trades require net PnL and an outcome.' using errcode = '23514';
  end if;

  select currency_precision into account_precision
  from public.trading_accounts
  where id = new.account_id and user_id = new.user_id;

  if not found then
    raise exception 'The trade account could not be resolved.' using errcode = '23503';
  end if;

  normalized_pnl := round(new.net_pnl, account_precision);
  new.net_pnl := normalized_pnl;

  select
    exists (
      select 1
      from public.trade_targets target
      where target.trade_id = new.id
        and target.actual_close_percentage > 0
        and target.actual_close_percentage < 100
    ) or exists (
      select 1
      from public.trade_management_events event
      where event.trade_id = new.id and event.event_type = 'SCALE_OUT'
    )
  into used_partial_exits;

  expected_outcome := case
    when normalized_pnl = 0 then 'BREAK_EVEN'::public.trade_outcome
    when normalized_pnl > 0 and used_partial_exits then 'PARTIAL_WIN'::public.trade_outcome
    when normalized_pnl > 0 then 'WIN'::public.trade_outcome
    when used_partial_exits then 'PARTIAL_LOSS'::public.trade_outcome
    else 'LOSS'::public.trade_outcome
  end;

  if new.outcome <> expected_outcome then
    raise exception 'Outcome conflicts with normalized net PnL or partial-exit history. Expected %.', expected_outcome
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trades_normalize_validate_outcome on public.trades;
create trigger trades_normalize_validate_outcome
before insert or update of status, outcome, net_pnl, account_id on public.trades
for each row execute function private.normalize_and_validate_trade_outcome();
