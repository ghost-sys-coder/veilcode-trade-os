-- Phase 06 configurable prop-firm rules, progress goals, snapshots, and account lifecycle.

create type public.prop_value_mode as enum ('AMOUNT', 'PERCENT');
create type public.prop_drawdown_type as enum ('STATIC', 'TRAILING', 'OTHER');
create type public.prop_daily_baseline as enum ('STARTING_BALANCE', 'START_OF_DAY_BALANCE', 'START_OF_DAY_EQUITY');
create type public.prop_total_baseline as enum ('STARTING_BALANCE', 'HIGHEST_BALANCE', 'HIGHEST_EQUITY');
create type public.prop_loss_measure as enum ('BALANCE', 'EQUITY');
create type public.prop_consistency_formula as enum ('BEST_DAY_OVER_TOTAL_POSITIVE_PROFIT', 'OTHER');
create type public.prop_trading_day_basis as enum ('OPENED_AT');
create type public.account_failure_reason as enum ('DAILY_LOSS_LIMIT', 'MAXIMUM_LOSS', 'TIME_LIMIT', 'MANUAL_TERMINATION', 'OTHER');

alter table public.trading_accounts
  add column previous_account_id uuid,
  add constraint trading_accounts_previous_owner_fk foreign key (previous_account_id, user_id)
    references public.trading_accounts(id, user_id) on delete restrict,
  add constraint trading_accounts_previous_not_self check (previous_account_id is null or previous_account_id <> id);

alter table public.prop_firm_configs
  drop constraint prop_firm_configs_percentages,
  drop constraint prop_firm_configs_days,
  add column profit_target_mode public.prop_value_mode,
  add column profit_target_value numeric(24, 8),
  add column daily_loss_mode public.prop_value_mode,
  add column daily_loss_value numeric(24, 8),
  add column daily_loss_baseline public.prop_daily_baseline,
  add column daily_loss_measure public.prop_loss_measure,
  add column total_loss_mode public.prop_value_mode,
  add column total_loss_value numeric(24, 8),
  add column total_loss_baseline public.prop_total_baseline,
  add column total_loss_measure public.prop_loss_measure,
  add column drawdown_type public.prop_drawdown_type not null default 'STATIC',
  add column consistency_formula public.prop_consistency_formula,
  add column maximum_trading_days integer,
  add column trading_day_basis public.prop_trading_day_basis not null default 'OPENED_AT',
  add column trading_day_timezone text not null default 'UTC',
  add column profitable_day_min_pnl numeric(24, 8) not null default 0;

update public.prop_firm_configs
set
  profit_target_mode = case when profit_target_percent is not null then 'PERCENT'::public.prop_value_mode end,
  profit_target_value = profit_target_percent,
  daily_loss_mode = case when max_daily_loss_percent is not null then 'PERCENT'::public.prop_value_mode end,
  daily_loss_value = max_daily_loss_percent,
  daily_loss_baseline = case when max_daily_loss_percent is not null then 'STARTING_BALANCE'::public.prop_daily_baseline end,
  daily_loss_measure = case when max_daily_loss_percent is not null then 'BALANCE'::public.prop_loss_measure end,
  total_loss_mode = case when max_total_loss_percent is not null then 'PERCENT'::public.prop_value_mode end,
  total_loss_value = max_total_loss_percent,
  total_loss_baseline = case when max_total_loss_percent is not null then 'STARTING_BALANCE'::public.prop_total_baseline end,
  total_loss_measure = case when max_total_loss_percent is not null then 'BALANCE'::public.prop_loss_measure end,
  consistency_formula = case when consistency_limit_percent is not null then 'BEST_DAY_OVER_TOTAL_POSITIVE_PROFIT'::public.prop_consistency_formula end,
  trading_day_timezone = coalesce(
    (select profile.timezone from public.profiles profile where profile.id = prop_firm_configs.user_id),
    'UTC'
  );

alter table public.prop_firm_configs
  drop column profit_target_percent,
  drop column max_daily_loss_percent,
  drop column max_total_loss_percent,
  add constraint prop_firm_configs_profit_target_pair check (
    (profit_target_mode is null and profit_target_value is null) or
    (profit_target_mode is not null and profit_target_value > 0)
  ),
  add constraint prop_firm_configs_daily_loss_fields check (
    (daily_loss_mode is null and daily_loss_value is null and daily_loss_baseline is null and daily_loss_measure is null) or
    (daily_loss_mode is not null and daily_loss_value > 0 and daily_loss_baseline is not null and daily_loss_measure is not null)
  ),
  add constraint prop_firm_configs_total_loss_fields check (
    (total_loss_mode is null and total_loss_value is null and total_loss_baseline is null and total_loss_measure is null) or
    (total_loss_mode is not null and total_loss_value > 0 and total_loss_baseline is not null and total_loss_measure is not null)
  ),
  add constraint prop_firm_configs_percent_ranges check (
    (profit_target_mode is distinct from 'PERCENT' or profit_target_value <= 100) and
    (daily_loss_mode is distinct from 'PERCENT' or daily_loss_value <= 100) and
    (total_loss_mode is distinct from 'PERCENT' or total_loss_value <= 100) and
    (consistency_limit_percent is null or consistency_limit_percent between 0 and 100)
  ),
  add constraint prop_firm_configs_consistency_pair check (
    (consistency_formula is null and consistency_limit_percent is null) or
    (consistency_formula is not null and consistency_limit_percent is not null)
  ),
  add constraint prop_firm_configs_days check (
    (minimum_trading_days is null or minimum_trading_days >= 0) and
    (maximum_trading_days is null or maximum_trading_days >= 0) and
    (minimum_trading_days is null or maximum_trading_days is null or maximum_trading_days >= minimum_trading_days)
  ),
  add constraint prop_firm_configs_timezone_not_blank check (length(btrim(trading_day_timezone)) > 0),
  add constraint prop_firm_configs_profitable_day_min_nonnegative check (profitable_day_min_pnl >= 0);

alter table public.account_snapshots
  add column unrealized_pnl numeric(24, 8);

update public.account_snapshots
set unrealized_pnl = equity - balance
where equity is not null;

alter table public.account_snapshots
  add constraint account_snapshots_equity_equation check (
    (equity is null and unrealized_pnl is null) or
    (equity is not null and unrealized_pnl is not null and equity = balance + unrealized_pnl)
  );

alter table public.account_goals
  add column title text,
  add column active boolean not null default true,
  add column custom_unit text,
  add constraint account_goals_id_owner_unique unique (id, user_id);

update public.account_goals
set
  title = replace(initcap(goal_type), '_', ' '),
  custom_unit = case
    when goal_type not in (
      'TOTAL_TRADES', 'ACCOUNT_RETURN_PERCENT', 'ACCOUNT_BALANCE', 'CUMULATIVE_R',
      'RULE_COMPLIANCE_PERCENT', 'MAX_DRAWDOWN_AMOUNT', 'MAX_DRAWDOWN_PERCENT',
      'PROFITABLE_DAYS'
    ) then 'units'
    else null
  end,
  goal_type = case
    when goal_type in (
      'TOTAL_TRADES', 'ACCOUNT_RETURN_PERCENT', 'ACCOUNT_BALANCE', 'CUMULATIVE_R',
      'RULE_COMPLIANCE_PERCENT', 'MAX_DRAWDOWN_AMOUNT', 'MAX_DRAWDOWN_PERCENT',
      'PROFITABLE_DAYS', 'CUSTOM'
    ) then goal_type
    else 'CUSTOM'
  end;

alter table public.account_goals
  alter column title set not null,
  add constraint account_goals_title_not_blank check (length(btrim(title)) > 0),
  add constraint account_goals_supported_type check (goal_type in (
    'TOTAL_TRADES', 'ACCOUNT_RETURN_PERCENT', 'ACCOUNT_BALANCE', 'CUMULATIVE_R',
    'RULE_COMPLIANCE_PERCENT', 'MAX_DRAWDOWN_AMOUNT', 'MAX_DRAWDOWN_PERCENT',
    'PROFITABLE_DAYS', 'CUSTOM'
  )),
  add constraint account_goals_target_positive check (target_value > 0),
  add constraint account_goals_custom_unit check (
    (goal_type = 'CUSTOM' and custom_unit is not null and length(btrim(custom_unit)) > 0) or
    (goal_type <> 'CUSTOM' and custom_unit is null)
  );

create table public.account_goal_progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null,
  progress_value numeric(24, 8) not null,
  recorded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  constraint account_goal_progress_events_goal_owner_fk foreign key (goal_id, user_id)
    references public.account_goals(id, user_id) on delete cascade
);

create table public.account_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  previous_status public.account_status,
  new_status public.account_status not null,
  effective_at timestamptz not null,
  failure_reason public.account_failure_reason,
  notes text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint account_status_events_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint account_status_events_change check (previous_status is null or previous_status <> new_status),
  constraint account_status_events_failure_fields check (
    (new_status = 'FAILED' and failure_reason is not null) or
    (new_status <> 'FAILED' and failure_reason is null)
  )
);

insert into public.account_status_events (
  user_id, account_id, previous_status, new_status, effective_at, notes
)
select user_id, id, null, status, started_at::timestamptz, 'Initial status backfill.'
from public.trading_accounts;

create index trading_accounts_previous_owner_idx on public.trading_accounts(previous_account_id, user_id);
create index account_snapshots_account_captured_idx on public.account_snapshots(account_id, captured_at desc);
create index account_goals_account_active_idx on public.account_goals(account_id, active);
create index account_goal_progress_events_goal_owner_idx on public.account_goal_progress_events(goal_id, user_id, recorded_at desc);
create index account_status_events_account_owner_idx on public.account_status_events(account_id, user_id, effective_at desc);

create or replace function private.validate_goal_progress_event()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_goal public.account_goals;
begin
  select * into selected_goal
  from public.account_goals
  where id = new.goal_id and user_id = new.user_id;

  if not found then
    raise exception 'Goal not found.' using errcode = '23503';
  end if;

  if selected_goal.goal_type <> 'CUSTOM' then
    raise exception 'Manual progress events are only valid for custom goals.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger account_goal_progress_events_validate
before insert on public.account_goal_progress_events
for each row execute function private.validate_goal_progress_event();

create or replace function private.validate_prop_firm_config()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  configured_type public.account_type;
begin
  select account_type into configured_type
  from public.trading_accounts
  where id = new.account_id and user_id = new.user_id;

  if configured_type not in ('PROP_CHALLENGE', 'FUNDED') then
    raise exception 'Prop configuration is only valid for prop challenge or funded accounts.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger prop_firm_configs_validate_account
before insert or update on public.prop_firm_configs
for each row execute function private.validate_prop_firm_config();

create or replace function private.validate_account_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous_account public.trading_accounts;
begin
  if new.previous_account_id is null then
    return new;
  end if;

  select * into previous_account
  from public.trading_accounts
  where id = new.previous_account_id and user_id = new.user_id;

  if not found then
    raise exception 'Previous account not found.' using errcode = '23503';
  end if;

  if new.account_type <> 'FUNDED' or previous_account.account_type <> 'PROP_CHALLENGE' or previous_account.status <> 'PASSED' then
    raise exception 'A linked funded account requires a passed prop challenge owned by the same user.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trading_accounts_validate_link
before insert or update of previous_account_id, account_type on public.trading_accounts
for each row execute function private.validate_account_link();

create or replace function private.protect_account_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') and new.status is distinct from old.status then
    raise exception 'Account status changes require the lifecycle workflow.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trading_accounts_protect_lifecycle
before update on public.trading_accounts
for each row execute function private.protect_account_lifecycle();

create or replace function private.record_initial_account_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.account_status_events (
    user_id, account_id, previous_status, new_status, effective_at, actor_user_id, notes
  ) values (
    new.user_id, new.id, null, new.status, new.started_at::timestamptz, auth.uid(), 'Initial account status.'
  );
  return new;
end;
$$;

create trigger trading_accounts_record_initial_status
after insert on public.trading_accounts
for each row execute function private.record_initial_account_status();

create or replace function private.transition_account_status(
  p_account_id uuid,
  p_new_status public.account_status,
  p_effective_at timestamptz,
  p_failure_reason public.account_failure_reason default null,
  p_notes text default null
)
returns public.account_status_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  account_row public.trading_accounts;
  status_event public.account_status_events;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_effective_at is null then
    raise exception 'An effective timestamp is required.' using errcode = '22023';
  end if;

  select * into account_row
  from public.trading_accounts
  where id = p_account_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  if account_row.status = p_new_status then
    raise exception 'The account already has that status.' using errcode = '22023';
  end if;

  if p_new_status = 'PASSED' and account_row.account_type <> 'PROP_CHALLENGE' then
    raise exception 'Only a prop challenge can be marked passed.' using errcode = '23514';
  end if;

  if p_new_status = 'FAILED' and p_failure_reason is null then
    raise exception 'A failure reason is required.' using errcode = '22023';
  elsif p_new_status <> 'FAILED' and p_failure_reason is not null then
    raise exception 'Failure reason is only valid for failed accounts.' using errcode = '22023';
  end if;

  update public.trading_accounts
  set status = p_new_status
  where id = p_account_id;

  insert into public.account_status_events (
    user_id, account_id, previous_status, new_status, effective_at,
    failure_reason, notes, actor_user_id
  ) values (
    actor_id, p_account_id, account_row.status, p_new_status, p_effective_at,
    p_failure_reason, nullif(btrim(p_notes), ''), actor_id
  ) returning * into status_event;

  return status_event;
end;
$$;

revoke all on function private.transition_account_status(uuid, public.account_status, timestamptz, public.account_failure_reason, text) from public, anon;
grant execute on function private.transition_account_status(uuid, public.account_status, timestamptz, public.account_failure_reason, text) to authenticated;

create or replace function public.transition_account_status(
  p_account_id uuid,
  p_new_status public.account_status,
  p_effective_at timestamptz,
  p_failure_reason public.account_failure_reason default null,
  p_notes text default null
)
returns public.account_status_events
language sql
security invoker
set search_path = ''
as $$
  select private.transition_account_status(p_account_id, p_new_status, p_effective_at, p_failure_reason, p_notes);
$$;

revoke all on function public.transition_account_status(uuid, public.account_status, timestamptz, public.account_failure_reason, text) from public, anon;
grant execute on function public.transition_account_status(uuid, public.account_status, timestamptz, public.account_failure_reason, text) to authenticated;

alter table public.account_goal_progress_events enable row level security;
alter table public.account_status_events enable row level security;

revoke all on table public.account_goal_progress_events from anon, authenticated;
revoke all on table public.account_status_events from anon, authenticated;
grant select, insert on table public.account_goal_progress_events to authenticated;
grant select on table public.account_status_events to authenticated;

create policy account_goal_progress_events_select_own
on public.account_goal_progress_events for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy account_goal_progress_events_insert_own
on public.account_goal_progress_events for insert to authenticated
with check ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy account_status_events_select_own
on public.account_status_events for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));
