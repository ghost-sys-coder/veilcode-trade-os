-- Cover composite ownership and Phase 07 import foreign keys in their declared
-- column order. These indexes support both referential checks and the user-scoped
-- reads used throughout the application.

create index if not exists daily_logs_account_owner_idx
  on public.daily_logs (account_id, user_id);

create index if not exists import_batches_account_owner_idx
  on public.import_batches (account_id, user_id);

create index if not exists import_batch_rows_batch_owner_idx
  on public.import_batch_rows (batch_id, user_id);

create index if not exists import_batch_rows_conflict_owner_idx
  on public.import_batch_rows (conflict_trade_id, user_id);

create index if not exists import_batch_rows_imported_owner_idx
  on public.import_batch_rows (imported_trade_id, user_id);

create index if not exists import_batch_rows_resolved_by_idx
  on public.import_batch_rows (resolution_confirmed_by_user_id);

create index if not exists monthly_reviews_account_owner_idx
  on public.monthly_reviews (account_id, user_id);

create index if not exists prop_firm_configs_account_owner_idx
  on public.prop_firm_configs (account_id, user_id);

create index if not exists setups_strategy_owner_idx
  on public.setups (strategy_id, user_id);

create index if not exists trade_execution_reviews_trade_owner_idx
  on public.trade_execution_reviews (trade_id, user_id);

create index if not exists trade_management_events_trade_owner_idx
  on public.trade_management_events (trade_id, user_id);

create index if not exists trade_plan_corrections_actor_idx
  on public.trade_plan_corrections (actor_user_id);

create index if not exists trade_plan_corrections_target_owner_idx
  on public.trade_plan_corrections (trade_target_id, user_id);

create index if not exists trade_plan_corrections_trade_owner_idx
  on public.trade_plan_corrections (trade_id, user_id);

create index if not exists trade_psychology_trade_owner_idx
  on public.trade_psychology (trade_id, user_id);

create index if not exists trade_reviews_trade_owner_idx
  on public.trade_reviews (trade_id, user_id);

create index if not exists trade_rule_results_rule_owner_idx
  on public.trade_rule_results (trading_rule_id, user_id);

create index if not exists trade_rule_results_trade_owner_idx
  on public.trade_rule_results (trade_id, user_id);

create index if not exists trade_screenshots_trade_owner_idx
  on public.trade_screenshots (trade_id, user_id);

create index if not exists trade_tags_tag_owner_idx
  on public.trade_tags (tag_id, user_id);

create index if not exists trade_tags_trade_owner_idx
  on public.trade_tags (trade_id, user_id);

create index if not exists trade_targets_trade_owner_idx
  on public.trade_targets (trade_id, user_id);

create index if not exists trades_account_owner_idx
  on public.trades (account_id, user_id);

create index if not exists trades_import_identity_idx
  on public.trades (import_batch_id, user_id, account_id, source_type);

create index if not exists trades_setup_owner_idx
  on public.trades (setup_id, user_id, strategy_id);

create index if not exists trades_strategy_owner_idx
  on public.trades (strategy_id, user_id);

create index if not exists trading_rules_account_owner_idx
  on public.trading_rules (account_id, user_id);

create index if not exists weekly_reviews_account_owner_idx
  on public.weekly_reviews (account_id, user_id);
