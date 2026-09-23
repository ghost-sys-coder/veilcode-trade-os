create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.account_type as enum ('DEMO', 'PROP_CHALLENGE', 'FUNDED', 'PERSONAL_LIVE');
create type public.account_platform as enum ('MT4', 'MT5', 'TRADINGVIEW', 'WEB', 'OTHER');
create type public.account_status as enum ('ACTIVE', 'PAUSED', 'PASSED', 'FAILED', 'CLOSED');
create type public.asset_class as enum ('FOREX', 'METAL', 'INDEX', 'CRYPTO', 'COMMODITY', 'EQUITY', 'OTHER');
create type public.trade_status as enum ('DRAFT', 'PLANNED', 'OPEN', 'CLOSED', 'CANCELED');
create type public.trade_outcome as enum ('WIN', 'LOSS', 'BREAK_EVEN', 'PARTIAL_WIN', 'PARTIAL_LOSS');
create type public.trade_source as enum ('MANUAL', 'CSV', 'MT4', 'MT5', 'BROKER_API');
create type public.trade_direction as enum ('BUY', 'SELL');
create type public.order_type as enum ('MARKET', 'BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP', 'OTHER');
create type public.trading_session as enum ('ASIAN', 'LONDON', 'NEW_YORK', 'LONDON_NEW_YORK_OVERLAP', 'OTHER');
create type public.timeframe as enum ('1W', '1D', '4H', '1H', '30M', '15M', '5M', '1M');
create type public.market_bias as enum ('BULLISH', 'BEARISH', 'NEUTRAL', 'MIXED', 'NOT_RECORDED');
create type public.market_condition as enum ('TRENDING', 'RANGING', 'BREAKOUT', 'REVERSAL', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'MIXED', 'OTHER');
create type public.rule_type as enum ('DESCRIPTIVE', 'MAX_RISK_PERCENT', 'MIN_RR', 'MAX_TRADES_PER_DAY', 'BEHAVIOR');
create type public.screenshot_category as enum ('BEFORE_ENTRY', 'AT_ENTRY', 'DURING_TRADE', 'AT_EXIT', 'POST_TRADE_REVIEW');
create type public.trade_grade as enum ('A', 'B', 'C', 'D', 'F');
create type public.retake_decision as enum ('YES', 'NO', 'ONLY_WITH_CHANGES');
create type public.stop_action as enum ('UNCHANGED', 'MOVED_TO_BREAK_EVEN', 'TIGHTENED', 'WIDENED');
create type public.trade_emotion as enum ('CALM', 'FOCUSED', 'FEARFUL', 'EXCITED', 'FRUSTRATED', 'IMPATIENT', 'OVERCONFIDENT', 'TIRED', 'OTHER');
create type public.adjustment_type as enum ('DEPOSIT', 'WITHDRAWAL', 'BALANCE_CORRECTION', 'OTHER');
create type public.import_status as enum ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
create type public.management_event_type as enum ('STOP_MOVED', 'TARGET_CHANGED', 'SCALE_IN', 'SCALE_OUT', 'NOTE');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Africa/Kampala',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_timezone_not_blank check (btrim(timezone) <> '')
);

create table public.trading_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type public.account_type not null,
  broker_name text,
  platform public.account_platform not null default 'OTHER',
  currency_code text not null,
  currency_precision smallint not null,
  starting_balance numeric(24, 8) not null,
  leverage numeric(12, 4),
  started_at date not null default current_date,
  status public.account_status not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trading_accounts_name_not_blank check (btrim(name) <> ''),
  constraint trading_accounts_currency_code check (currency_code ~ '^[A-Z]{3}$'),
  constraint trading_accounts_currency_precision check (currency_precision between 0 and 20),
  constraint trading_accounts_starting_balance check (starting_balance > 0),
  constraint trading_accounts_leverage check (leverage is null or leverage > 0),
  constraint trading_accounts_owner_name_unique unique (user_id, name),
  constraint trading_accounts_id_owner_unique unique (id, user_id)
);

create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  symbol text not null,
  display_name text not null,
  asset_class public.asset_class not null,
  base_currency text,
  quote_currency text,
  pip_size numeric(24, 10),
  price_precision smallint not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instruments_symbol_not_blank check (btrim(symbol) <> ''),
  constraint instruments_price_precision check (price_precision between 0 and 20),
  constraint instruments_pip_size check (pip_size is null or pip_size > 0),
  constraint instruments_currency_codes check (
    (base_currency is null or base_currency ~ '^[A-Z]{3}$') and
    (quote_currency is null or quote_currency ~ '^[A-Z]{3}$')
  ),
  constraint instruments_id_owner_unique unique (id, user_id)
);

create unique index instruments_global_symbol_unique on public.instruments (symbol) where user_id is null;
create unique index instruments_user_symbol_unique on public.instruments (user_id, symbol) where user_id is not null;

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  is_example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint strategies_name_not_blank check (btrim(name) <> ''),
  constraint strategies_owner_name_unique unique (user_id, name),
  constraint strategies_id_owner_unique unique (id, user_id)
);

create table public.setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint setups_strategy_owner_fk foreign key (strategy_id, user_id)
    references public.strategies(id, user_id) on delete cascade,
  constraint setups_name_not_blank check (btrim(name) <> ''),
  constraint setups_strategy_name_unique unique (strategy_id, name),
  constraint setups_id_owner_unique unique (id, user_id),
  constraint setups_id_owner_strategy_unique unique (id, user_id, strategy_id)
);

create table public.trading_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  name text not null,
  description text not null,
  rule_type public.rule_type not null default 'DESCRIPTIVE',
  numeric_limit numeric(24, 8),
  active boolean not null default true,
  is_example boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trading_rules_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint trading_rules_name_not_blank check (btrim(name) <> ''),
  constraint trading_rules_description_not_blank check (btrim(description) <> ''),
  constraint trading_rules_numeric_limit check (numeric_limit is null or numeric_limit >= 0),
  constraint trading_rules_id_owner_unique unique (id, user_id)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  source_type public.trade_source not null,
  status public.import_status not null default 'PENDING',
  source_filename text,
  row_count integer,
  imported_count integer not null default 0,
  failed_count integer not null default 0,
  error_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint import_batches_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint import_batches_counts check (
    (row_count is null or row_count >= 0) and imported_count >= 0 and failed_count >= 0
  ),
  constraint import_batches_id_owner_unique unique (id, user_id)
);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  instrument_id uuid not null references public.instruments(id),
  strategy_id uuid,
  setup_id uuid,
  status public.trade_status not null default 'DRAFT',
  outcome public.trade_outcome,
  source_type public.trade_source not null default 'MANUAL',
  external_trade_id text,
  import_batch_id uuid,
  planned_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  timezone_at_entry text,
  direction public.trade_direction not null,
  order_type public.order_type not null default 'MARKET',
  session public.trading_session not null default 'OTHER',
  primary_analysis_timeframe public.timeframe,
  entry_timeframe public.timeframe,
  higher_timeframe_bias public.market_bias,
  market_condition public.market_condition,
  thesis text,
  entry_reason text,
  confirmation_notes text,
  account_balance_before numeric(24, 8),
  planned_entry numeric(24, 10),
  planned_stop_loss numeric(24, 10),
  planned_take_profit numeric(24, 10),
  planned_risk_amount numeric(24, 8),
  planned_risk_percentage numeric(12, 6),
  planned_reward_amount numeric(24, 8),
  planned_risk_reward numeric(18, 8),
  planned_lot_size numeric(18, 8),
  actual_entry numeric(24, 10),
  actual_stop_loss numeric(24, 10),
  actual_exit numeric(24, 10),
  actual_lot_size numeric(18, 8),
  commission numeric(24, 8) not null default 0,
  swap numeric(24, 8) not null default 0,
  other_fees numeric(24, 8) not null default 0,
  gross_pnl numeric(24, 8),
  net_pnl numeric(24, 8),
  pips_result numeric(18, 6),
  actual_r numeric(18, 8),
  mfe_amount numeric(24, 8),
  mfe_pips numeric(18, 6),
  mfe_r numeric(18, 8),
  mae_amount numeric(24, 8),
  mae_pips numeric(18, 6),
  mae_r numeric(18, 8),
  holding_duration_seconds bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trades_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id),
  constraint trades_strategy_owner_fk foreign key (strategy_id, user_id)
    references public.strategies(id, user_id),
  constraint trades_setup_owner_fk foreign key (setup_id, user_id, strategy_id)
    references public.setups(id, user_id, strategy_id),
  constraint trades_import_batch_owner_fk foreign key (import_batch_id, user_id)
    references public.import_batches(id, user_id),
  constraint trades_setup_requires_strategy check (setup_id is null or strategy_id is not null),
  constraint trades_date_order check (closed_at is null or opened_at is null or closed_at >= opened_at),
  constraint trades_non_negative_plan check (
    (account_balance_before is null or account_balance_before > 0) and
    (planned_risk_amount is null or planned_risk_amount >= 0) and
    (planned_risk_percentage is null or planned_risk_percentage >= 0) and
    (planned_reward_amount is null or planned_reward_amount >= 0) and
    (planned_risk_reward is null or planned_risk_reward >= 0) and
    (planned_lot_size is null or planned_lot_size >= 0) and
    (actual_lot_size is null or actual_lot_size >= 0)
  ),
  constraint trades_non_negative_costs check (commission >= 0 and swap >= 0 and other_fees >= 0),
  constraint trades_holding_duration check (holding_duration_seconds is null or holding_duration_seconds >= 0),
  constraint trades_closed_outcome check (
    (status = 'CLOSED' and outcome is not null and net_pnl is not null) or
    (status <> 'CLOSED' and outcome is null)
  ),
  constraint trades_outcome_pnl_consistency check (
    outcome is null or
    (outcome in ('WIN', 'PARTIAL_WIN') and net_pnl > 0) or
    (outcome in ('LOSS', 'PARTIAL_LOSS') and net_pnl < 0) or
    (outcome = 'BREAK_EVEN' and net_pnl = 0)
  ),
  constraint trades_manual_source_external_id check (
    source_type <> 'MANUAL' or import_batch_id is null
  ),
  constraint trades_id_owner_unique unique (id, user_id)
);

create unique index trades_source_external_unique
  on public.trades(account_id, source_type, external_trade_id)
  where external_trade_id is not null;

create table public.trade_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  label text not null,
  planned_price numeric(24, 10) not null,
  actual_fill_price numeric(24, 10),
  planned_close_percentage numeric(12, 6),
  actual_close_percentage numeric(12, 6),
  hit_at timestamptz,
  pnl_contribution numeric(24, 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_targets_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_targets_label_not_blank check (btrim(label) <> ''),
  constraint trade_targets_percentages check (
    (planned_close_percentage is null or planned_close_percentage between 0 and 100) and
    (actual_close_percentage is null or actual_close_percentage between 0 and 100)
  ),
  constraint trade_targets_id_owner_unique unique (id, user_id),
  constraint trade_targets_trade_label_unique unique (trade_id, label)
);

create table public.trade_management_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  event_type public.management_event_type not null,
  occurred_at timestamptz not null,
  price numeric(24, 10),
  volume numeric(18, 8),
  notes text,
  created_at timestamptz not null default now(),
  constraint trade_management_events_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_management_events_volume check (volume is null or volume >= 0)
);

create table public.trade_plan_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  trade_target_id uuid,
  field_name text not null,
  value_type text not null,
  previous_value jsonb not null,
  new_value jsonb not null,
  reason text not null,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint trade_plan_corrections_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id),
  constraint trade_plan_corrections_target_owner_fk foreign key (trade_target_id, user_id)
    references public.trade_targets(id, user_id),
  constraint trade_plan_corrections_field_name check (field_name in (
    'planned_entry', 'planned_stop_loss', 'planned_take_profit', 'planned_lot_size',
    'planned_risk_amount', 'planned_risk_percentage', 'planned_reward_amount',
    'planned_risk_reward', 'strategy_id', 'setup_id', 'thesis', 'entry_reason',
    'confirmation_notes', 'target.planned_price', 'target.planned_close_percentage'
  )),
  constraint trade_plan_corrections_value_type check (value_type in ('numeric', 'text', 'uuid')),
  constraint trade_plan_corrections_reason check (length(btrim(reason)) >= 5),
  constraint trade_plan_corrections_actor_owner check (actor_user_id = user_id),
  constraint trade_plan_corrections_target_shape check (
    (field_name like 'target.%' and trade_target_id is not null) or
    (field_name not like 'target.%' and trade_target_id is null)
  )
);

create table public.trade_screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  category public.screenshot_category not null,
  timeframe public.timeframe,
  storage_path text not null,
  caption text,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  constraint trade_screenshots_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_screenshots_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint trade_screenshots_storage_path_unique unique (storage_path)
);

create table public.trade_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  what_went_well text,
  what_went_wrong text,
  would_take_again public.retake_decision,
  improvement text,
  lesson_learned text,
  trade_quality_grade public.trade_grade,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_reviews_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_reviews_one_per_trade unique (trade_id)
);

create table public.trade_execution_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  entry_according_to_plan boolean,
  stop_according_to_plan boolean,
  target_according_to_plan boolean,
  stop_action public.stop_action,
  closed_early boolean not null default false,
  entered_early boolean not null default false,
  entered_late boolean not null default false,
  chased_price boolean not null default false,
  added_to_position boolean not null default false,
  revenge_trade boolean not null default false,
  over_risked boolean not null default false,
  execution_rating smallint,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_execution_reviews_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_execution_reviews_rating check (execution_rating is null or execution_rating between 1 and 5),
  constraint trade_execution_reviews_one_per_trade unique (trade_id)
);

create table public.trade_psychology (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  confidence_before_entry smallint,
  emotion_before public.trade_emotion,
  emotion_during public.trade_emotion,
  emotion_after public.trade_emotion,
  fear_influenced boolean not null default false,
  greed_influenced boolean not null default false,
  fomo_influenced boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_psychology_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_psychology_confidence check (confidence_before_entry is null or confidence_before_entry between 1 and 5),
  constraint trade_psychology_one_per_trade unique (trade_id)
);

create table public.trade_rule_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  trading_rule_id uuid not null,
  complied boolean not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_rule_results_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_rule_results_rule_owner_fk foreign key (trading_rule_id, user_id)
    references public.trading_rules(id, user_id) on delete cascade,
  constraint trade_rule_results_one_per_rule unique (trade_id, trading_rule_id)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_name_not_blank check (btrim(name) <> ''),
  constraint tags_owner_name_unique unique (user_id, name),
  constraint tags_id_owner_unique unique (id, user_id)
);

create table public.trade_tags (
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (trade_id, tag_id),
  constraint trade_tags_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_tags_tag_owner_fk foreign key (tag_id, user_id)
    references public.tags(id, user_id) on delete cascade
);

create table public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  trading_date date not null,
  starting_balance numeric(24, 8),
  ending_balance numeric(24, 8),
  market_conditions text,
  mental_state text,
  followed_daily_plan boolean,
  hit_daily_loss_threshold boolean,
  stopped_when_required boolean,
  daily_rating smallint,
  lessons text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_logs_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint daily_logs_rating check (daily_rating is null or daily_rating between 1 and 5),
  constraint daily_logs_one_per_day unique (account_id, trading_date)
);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  week_start date not null,
  what_worked text,
  what_did_not text,
  change_next_week text,
  behavior_to_stop text,
  behavior_to_continue text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_reviews_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint weekly_reviews_week_start check (extract(isodow from week_start) = 1),
  constraint weekly_reviews_one_per_week unique (account_id, week_start)
);

create table public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  month date not null,
  what_worked text,
  what_did_not text,
  lessons text,
  focus_next_month text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_reviews_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint monthly_reviews_month_start check (extract(day from month) = 1),
  constraint monthly_reviews_one_per_month unique (account_id, month)
);

create table public.account_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  type public.adjustment_type not null,
  amount numeric(24, 8) not null,
  occurred_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint account_adjustments_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint account_adjustments_amount_nonzero check (amount <> 0)
);

create table public.account_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  captured_at timestamptz not null,
  balance numeric(24, 8) not null,
  equity numeric(24, 8),
  notes text,
  created_at timestamptz not null default now(),
  constraint account_snapshots_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint account_snapshots_values check (balance >= 0 and (equity is null or equity >= 0))
);

create table public.account_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  goal_type text not null,
  target_value numeric(24, 8) not null,
  target_date date,
  achieved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_goals_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint account_goals_type_not_blank check (btrim(goal_type) <> '')
);

create table public.prop_firm_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  firm_name text not null,
  model_name text,
  phase_name text,
  profit_target_percent numeric(12, 6),
  max_daily_loss_percent numeric(12, 6),
  max_total_loss_percent numeric(12, 6),
  consistency_limit_percent numeric(12, 6),
  minimum_trading_days integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prop_firm_configs_account_owner_fk foreign key (account_id, user_id)
    references public.trading_accounts(id, user_id) on delete cascade,
  constraint prop_firm_configs_firm_name_not_blank check (btrim(firm_name) <> ''),
  constraint prop_firm_configs_percentages check (
    (profit_target_percent is null or profit_target_percent >= 0) and
    (max_daily_loss_percent is null or max_daily_loss_percent >= 0) and
    (max_total_loss_percent is null or max_total_loss_percent >= 0) and
    (consistency_limit_percent is null or consistency_limit_percent >= 0)
  ),
  constraint prop_firm_configs_days check (minimum_trading_days is null or minimum_trading_days >= 0),
  constraint prop_firm_configs_one_per_account unique (account_id)
);

create index trading_accounts_user_id_idx on public.trading_accounts(user_id);
create index instruments_user_id_idx on public.instruments(user_id);
create index strategies_user_id_idx on public.strategies(user_id);
create index setups_user_id_idx on public.setups(user_id);
create index setups_strategy_id_idx on public.setups(strategy_id);
create index trading_rules_user_id_idx on public.trading_rules(user_id);
create index trading_rules_account_id_idx on public.trading_rules(account_id);
create index import_batches_user_id_idx on public.import_batches(user_id);
create index import_batches_account_id_idx on public.import_batches(account_id);
create index trades_user_id_idx on public.trades(user_id);
create index trades_account_id_idx on public.trades(account_id);
create index trades_instrument_id_idx on public.trades(instrument_id);
create index trades_strategy_id_idx on public.trades(strategy_id);
create index trades_setup_id_idx on public.trades(setup_id);
create index trades_status_idx on public.trades(status);
create index trades_outcome_idx on public.trades(outcome);
create index trades_opened_at_idx on public.trades(opened_at);
create index trades_closed_at_idx on public.trades(closed_at);
create index trade_targets_trade_id_idx on public.trade_targets(trade_id);
create index trade_targets_user_id_idx on public.trade_targets(user_id);
create index trade_management_events_trade_id_idx on public.trade_management_events(trade_id);
create index trade_management_events_user_id_idx on public.trade_management_events(user_id);
create index trade_plan_corrections_trade_id_idx on public.trade_plan_corrections(trade_id, created_at, id);
create index trade_plan_corrections_user_id_idx on public.trade_plan_corrections(user_id);
create index trade_screenshots_trade_id_idx on public.trade_screenshots(trade_id);
create index trade_screenshots_user_id_idx on public.trade_screenshots(user_id);
create index trade_reviews_user_id_idx on public.trade_reviews(user_id);
create index trade_execution_reviews_user_id_idx on public.trade_execution_reviews(user_id);
create index trade_psychology_user_id_idx on public.trade_psychology(user_id);
create index trade_rule_results_trade_id_idx on public.trade_rule_results(trade_id);
create index trade_rule_results_rule_id_idx on public.trade_rule_results(trading_rule_id);
create index trade_rule_results_user_id_idx on public.trade_rule_results(user_id);
create index trade_tags_user_id_idx on public.trade_tags(user_id);
create index daily_logs_user_id_idx on public.daily_logs(user_id);
create index weekly_reviews_user_id_idx on public.weekly_reviews(user_id);
create index monthly_reviews_user_id_idx on public.monthly_reviews(user_id);
create index account_adjustments_account_time_idx on public.account_adjustments(account_id, occurred_at);
create index account_adjustments_user_id_idx on public.account_adjustments(user_id);
create index account_snapshots_account_time_idx on public.account_snapshots(account_id, captured_at);
create index account_snapshots_user_id_idx on public.account_snapshots(user_id);
create index account_goals_user_id_idx on public.account_goals(user_id);
create index prop_firm_configs_user_id_idx on public.prop_firm_configs(user_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'trading_accounts', 'instruments', 'strategies', 'setups',
    'trading_rules', 'trades', 'trade_targets', 'trade_reviews',
    'trade_execution_reviews', 'trade_psychology', 'trade_rule_results',
    'tags', 'daily_logs', 'weekly_reviews', 'monthly_reviews',
    'account_goals', 'prop_firm_configs'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create or replace function private.protect_trade_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('OPEN', 'CLOSED') and current_user not in ('postgres', 'service_role') and (
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

create trigger trades_protect_plan
before update on public.trades
for each row execute function private.protect_trade_plan();

create or replace function private.protect_trade_target_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_status public.trade_status;
begin
  select status into parent_status from public.trades where id = old.trade_id;

  if parent_status in ('OPEN', 'CLOSED') and current_user not in ('postgres', 'service_role') and (
    new.planned_price is distinct from old.planned_price or
    new.planned_close_percentage is distinct from old.planned_close_percentage
  ) then
    raise exception 'Protected planned target values require the correction workflow.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trade_targets_protect_plan
before update on public.trade_targets
for each row execute function private.protect_trade_target_plan();

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

    value_type := 'numeric';
    if p_new_value <> 'null'::jsonb and jsonb_typeof(p_new_value) <> 'number' then
      raise exception 'The corrected target value must be numeric or null.' using errcode = '22023';
    end if;

    if p_field_name = 'target.planned_price' then
      previous_value := coalesce(to_jsonb(target_row.planned_price), 'null'::jsonb);
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

revoke all on function private.correct_trade_plan_value(uuid, text, jsonb, text, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.correct_trade_plan_value(uuid, text, jsonb, text, uuid) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  demo_account_id uuid;
begin
  insert into public.profiles (id, display_name, timezone)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Africa/Kampala')
  on conflict (id) do nothing;

  insert into public.trading_accounts (
    user_id, name, account_type, platform, currency_code,
    currency_precision, starting_balance, status, notes
  ) values (
    new.id, '100K Demo Practice', 'DEMO', 'OTHER', 'USD',
    2, 100000, 'ACTIVE', 'Starter demo account. Edit or remove it to match your practice account.'
  )
  on conflict (user_id, name) do update set updated_at = now()
  returning id into demo_account_id;

  insert into public.strategies (user_id, name, description, active, is_example)
  values
    (new.id, 'Market Structure', 'Editable example strategy. Activate it only if it matches your process.', false, true),
    (new.id, 'Break and Retest', 'Editable example strategy. Activate it only if it matches your process.', false, true),
    (new.id, 'Trend Continuation', 'Editable example strategy. Activate it only if it matches your process.', false, true)
  on conflict (user_id, name) do nothing;

  insert into public.trading_rules (user_id, account_id, name, description, rule_type, numeric_limit, active, is_example)
  values
    (new.id, demo_account_id, 'Maximum risk per trade', 'Editable example: define the maximum percentage risk allowed on one trade.', 'MAX_RISK_PERCENT', 1, false, true),
    (new.id, demo_account_id, 'Minimum planned RR', 'Editable example: define the minimum planned reward multiple.', 'MIN_RR', 2, false, true),
    (new.id, demo_account_id, 'Maximum trades per day', 'Editable example: limit the number of entries in one trading day.', 'MAX_TRADES_PER_DAY', 3, false, true),
    (new.id, demo_account_id, 'Never widen stop loss', 'Editable example: do not move a stop farther from invalidation to avoid taking a planned loss.', 'BEHAVIOR', null, false, true),
    (new.id, demo_account_id, 'Avoid high-impact news', 'Editable example: follow your documented news-event restrictions.', 'BEHAVIOR', null, false, true),
    (new.id, demo_account_id, 'No revenge trading', 'Editable example: do not enter primarily to recover a previous loss quickly.', 'BEHAVIOR', null, false, true);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

insert into public.instruments (
  user_id, symbol, display_name, asset_class, base_currency,
  quote_currency, pip_size, price_precision, active
) values
  (null, 'EURUSD', 'Euro / US Dollar', 'FOREX', 'EUR', 'USD', 0.0001, 5, true),
  (null, 'GBPUSD', 'British Pound / US Dollar', 'FOREX', 'GBP', 'USD', 0.0001, 5, true),
  (null, 'USDJPY', 'US Dollar / Japanese Yen', 'FOREX', 'USD', 'JPY', 0.01, 3, true),
  (null, 'USDCHF', 'US Dollar / Swiss Franc', 'FOREX', 'USD', 'CHF', 0.0001, 5, true),
  (null, 'USDCAD', 'US Dollar / Canadian Dollar', 'FOREX', 'USD', 'CAD', 0.0001, 5, true),
  (null, 'EURJPY', 'Euro / Japanese Yen', 'FOREX', 'EUR', 'JPY', 0.01, 3, true),
  (null, 'GBPJPY', 'British Pound / Japanese Yen', 'FOREX', 'GBP', 'JPY', 0.01, 3, true),
  (null, 'EURGBP', 'Euro / British Pound', 'FOREX', 'EUR', 'GBP', 0.0001, 5, true),
  (null, 'GBPCHF', 'British Pound / Swiss Franc', 'FOREX', 'GBP', 'CHF', 0.0001, 5, true),
  (null, 'CADJPY', 'Canadian Dollar / Japanese Yen', 'FOREX', 'CAD', 'JPY', 0.01, 3, true),
  (null, 'XAUUSD', 'Gold / US Dollar', 'METAL', 'XAU', 'USD', 0.01, 2, true)
on conflict do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trade-screenshots',
  'trade-screenshots',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'trading_accounts', 'strategies', 'setups', 'trading_rules', 'import_batches',
    'trade_targets', 'trade_management_events', 'trade_screenshots', 'trade_reviews',
    'trade_execution_reviews', 'trade_psychology', 'trade_rule_results', 'tags',
    'trade_tags', 'daily_logs', 'weekly_reviews', 'monthly_reviews',
    'account_adjustments', 'account_snapshots', 'account_goals', 'prop_firm_configs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null and user_id = (select auth.uid()))',
      table_name || '_select_own', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) is not null and user_id = (select auth.uid()))',
      table_name || '_insert_own', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) is not null and user_id = (select auth.uid())) with check ((select auth.uid()) is not null and user_id = (select auth.uid()))',
      table_name || '_update_own', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) is not null and user_id = (select auth.uid()))',
      table_name || '_delete_own', table_name
    );
  end loop;
end;
$$;

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) is not null and id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check ((select auth.uid()) is not null and id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) is not null and id = (select auth.uid()))
  with check ((select auth.uid()) is not null and id = (select auth.uid()));

alter table public.instruments enable row level security;
revoke all on table public.instruments from anon, authenticated;
grant select, insert, update, delete on table public.instruments to authenticated;
create policy instruments_select_accessible on public.instruments for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy instruments_insert_own on public.instruments for insert to authenticated
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy instruments_update_own on public.instruments for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy instruments_delete_own on public.instruments for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

alter table public.trades enable row level security;
revoke all on table public.trades from anon, authenticated;
grant select, insert, update, delete on table public.trades to authenticated;
create policy trades_select_own on public.trades for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));
create policy trades_insert_own on public.trades for insert to authenticated
  with check (
    (select auth.uid()) is not null and user_id = (select auth.uid()) and
    exists (select 1 from public.trading_accounts a where a.id = account_id and a.user_id = (select auth.uid())) and
    exists (select 1 from public.instruments i where i.id = instrument_id and (i.user_id is null or i.user_id = (select auth.uid())))
  );
create policy trades_update_own on public.trades for update to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid()) and
    exists (select 1 from public.trading_accounts a where a.id = account_id and a.user_id = (select auth.uid())) and
    exists (select 1 from public.instruments i where i.id = instrument_id and (i.user_id is null or i.user_id = (select auth.uid())))
  );
create policy trades_delete_own on public.trades for delete to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

alter table public.trade_plan_corrections enable row level security;
revoke all on table public.trade_plan_corrections from anon, authenticated;
grant select on table public.trade_plan_corrections to authenticated;
create policy trade_plan_corrections_select_own on public.trade_plan_corrections for select to authenticated
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

drop policy if exists trade_screenshots_select_own on storage.objects;
drop policy if exists trade_screenshots_insert_own on storage.objects;
drop policy if exists trade_screenshots_update_own on storage.objects;
drop policy if exists trade_screenshots_delete_own on storage.objects;

create policy trade_screenshots_select_own on storage.objects for select to authenticated
using (
  bucket_id = 'trade-screenshots' and
  (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy trade_screenshots_insert_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'trade-screenshots' and
  (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy trade_screenshots_update_own on storage.objects for update to authenticated
using (
  bucket_id = 'trade-screenshots' and
  (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'trade-screenshots' and
  (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy trade_screenshots_delete_own on storage.objects for delete to authenticated
using (
  bucket_id = 'trade-screenshots' and
  (storage.foldername(name))[1] = (select auth.uid())::text
);
