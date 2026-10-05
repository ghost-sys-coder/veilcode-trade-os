-- Monetary attribution is calculated centrally in TypeScript. Persist sufficient
-- precision here: currency rounding is only applied to final net PnL, not each
-- proportionally allocated commission/fee. Legacy rows/values remain unchanged.
alter table public.trades
  alter column gross_pnl type numeric,
  alter column commission type numeric,
  alter column swap type numeric,
  alter column other_fees type numeric,
  add column trading_credits numeric not null default 0,
  add column mt5_connection_id uuid,
  add column mt5_opening_deal_ticket text,
  add column mt5_used_partial_exits boolean not null default false,
  add column mt5_execution_version bigint not null default 0,
  add constraint trades_trading_credits_valid check (
    trading_credits >= 0 and trading_credits not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  ),
  add constraint trades_financial_components_finite check (
    (gross_pnl is null or gross_pnl not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
    and commission not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    and swap not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
    and other_fees not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  );
alter table private.mt5_connections add constraint mt5_connection_record_owner_account_unique unique(id,owner_id,account_id);
alter table public.trades
  add constraint trades_mt5_connection_owner_fk foreign key(mt5_connection_id,user_id,account_id)
    references private.mt5_connections(id,owner_id,account_id),
  add constraint trades_mt5_episode_identity check (
    (mt5_connection_id is null and mt5_opening_deal_ticket is null and not mt5_used_partial_exits and mt5_execution_version = 0)
    or (mt5_connection_id is not null and source_type = 'MT5' and mt5_execution_version > 0
      and mt5_opening_deal_ticket is not null and mt5_opening_deal_ticket ~ '^[1-9][0-9]{0,19}$'
      and mt5_opening_deal_ticket::numeric <= 18446744073709551615
      and external_position_id is not null and external_position_id ~ '^[1-9][0-9]{0,19}$'
      and external_position_id::numeric <= 18446744073709551615
      and external_trade_id is not null and external_trade_id = mt5_connection_id::text || ':' || external_position_id || ':' || mt5_opening_deal_ticket || ':' || direction::text
      and status in ('OPEN','CLOSED') and opened_at is not null and actual_entry is not null and actual_lot_size is not null and actual_lot_size > 0
      and gross_pnl is not null and (status = 'CLOSED' or (net_pnl is null and actual_r is null)))
  );
create index trades_mt5_connection_idx on public.trades(mt5_connection_id) where mt5_connection_id is not null;
create unique index trades_mt5_episode_unique on public.trades(mt5_connection_id,external_position_id,mt5_opening_deal_ticket,direction)
  where mt5_connection_id is not null;
-- Broker position/order identifiers can legitimately occur in several netting
-- episodes. Only explicitly synchronized MT5 trades opt out of the old uniqueness.
drop index public.trades_source_external_position_unique;
create unique index trades_source_external_position_unique on public.trades(account_id,source_type,external_position_id)
  where external_position_id is not null and mt5_connection_id is null;
drop index public.trades_source_external_order_unique;
create unique index trades_source_external_order_unique on public.trades(account_id,source_type,external_order_id)
  where external_order_id is not null and mt5_connection_id is null;

create function private.protect_mt5_execution() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare permitted boolean := current_user in ('postgres','service_role')
  and current_setting('trade_os.mt5_publication_trade',true) = coalesce(new.id,old.id)::text;
begin
  if tg_op = 'DELETE' then
    if old.mt5_connection_id is not null then
      raise exception 'Synchronized execution evidence cannot be deleted.' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.mt5_connection_id is not null and permitted is distinct from true then
      raise exception 'Approved MT5 publication required.' using errcode = '42501';
    end if;
    return new;
  end if;
  if (old.mt5_connection_id is not null or new.mt5_connection_id is not null)
    and row(new.account_id,new.user_id,new.instrument_id,new.source_type,new.import_batch_id,new.external_trade_id,
      new.external_order_id,new.external_position_id,new.mt5_connection_id,new.mt5_opening_deal_ticket,new.mt5_execution_version,
      new.mt5_used_partial_exits,new.status,new.direction,new.opened_at,new.closed_at,new.actual_entry,new.actual_exit,
      new.actual_lot_size,new.actual_stop_loss,new.actual_r,new.holding_duration_seconds,new.gross_pnl,new.net_pnl,new.outcome,new.commission,new.swap,new.other_fees,new.trading_credits,new.external_raw_data)
    is distinct from row(old.account_id,old.user_id,old.instrument_id,old.source_type,old.import_batch_id,old.external_trade_id,
      old.external_order_id,old.external_position_id,old.mt5_connection_id,old.mt5_opening_deal_ticket,old.mt5_execution_version,
      old.mt5_used_partial_exits,old.status,old.direction,old.opened_at,old.closed_at,old.actual_entry,old.actual_exit,
      old.actual_lot_size,old.actual_stop_loss,old.actual_r,old.holding_duration_seconds,old.gross_pnl,old.net_pnl,old.outcome,old.commission,old.swap,old.other_fees,old.trading_credits,old.external_raw_data)
    and permitted is distinct from true then
    raise exception 'Synchronized execution facts require approved publication.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_mt5_execution() from public,anon,authenticated;
create trigger trades_mt5_execution_guard before insert or update or delete on public.trades
  for each row execute function private.protect_mt5_execution();

-- Preserve legacy partial-exit evidence. For broker synchronization, the typed
-- flag is protected by the publication boundary and never inferred from a single
-- profitable partial fill. Broker exits do not fabricate planned target rows.
create or replace function private.normalize_and_validate_trade_outcome() returns trigger
language plpgsql set search_path = '' as $$
declare account_precision smallint; normalized_pnl numeric; used_partial_exits boolean; expected_outcome public.trade_outcome;
begin
  if new.status <> 'CLOSED' then return new; end if;
  if new.net_pnl is null or new.outcome is null then
    raise exception 'Closed trades require net PnL and an outcome.' using errcode = '23514';
  end if;
  select currency_precision into account_precision from public.trading_accounts where id = new.account_id and user_id = new.user_id;
  if not found then raise exception 'The trade account could not be resolved.' using errcode = '23503'; end if;
  normalized_pnl := round(new.net_pnl,account_precision);
  new.net_pnl := normalized_pnl;
  if new.mt5_connection_id is not null then
    if normalized_pnl <> round(new.gross_pnl - new.commission - new.swap - new.other_fees + new.trading_credits,account_precision) then
      raise exception 'Final broker PnL contradicts financial components.' using errcode = '23514';
    end if;
    used_partial_exits := new.mt5_used_partial_exits;
  else
    select exists(select 1 from public.trade_targets t where t.trade_id = new.id
      and t.actual_close_percentage > 0 and t.actual_close_percentage < 100)
      or exists(select 1 from public.trade_management_events e where e.trade_id = new.id and e.event_type = 'SCALE_OUT')
      into used_partial_exits;
  end if;
  expected_outcome := case when normalized_pnl = 0 then 'BREAK_EVEN'::public.trade_outcome
    when normalized_pnl > 0 and used_partial_exits then 'PARTIAL_WIN'::public.trade_outcome
    when normalized_pnl > 0 then 'WIN'::public.trade_outcome
    when used_partial_exits then 'PARTIAL_LOSS'::public.trade_outcome else 'LOSS'::public.trade_outcome end;
  if new.outcome <> expected_outcome then
    raise exception 'Outcome conflicts with normalized net PnL or partial-exit history. Expected %.',expected_outcome using errcode = '23514';
  end if;
  return new;
end;
$$;
