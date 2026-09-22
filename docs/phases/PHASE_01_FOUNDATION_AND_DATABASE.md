# Phase 01: Foundation and Database

## Objective

Implement authentication, database schema, core domain types, seed data and foundational CRUD required by the Trading Performance Tracker.

Read:

- docs/PROJECT_CONTRACT.md
- docs/ARCHITECTURE.md
- docs/TRADING_METRICS.md
- docs/DATABASE.md

Do not implement the complete trade entry interface yet.

## Authentication

Use Supabase Auth.

The application is initially personal/single-user focused, but data ownership must be correctly modeled.

Every user-owned record must be protected by appropriate RLS policies.

## Database Tables

Implement a clean schema for at least the following.

### profiles

Fields may include:

- id
- display_name
- timezone
- created_at
- updated_at

User timezone must be configurable.

Default UI timezone may initially be Africa/Kampala, but store trade timestamps in UTC.

### trading_accounts

Include:

- id
- user_id
- name
- account_type
- broker_name
- platform
- account_currency
- starting_balance
- leverage
- started_at
- status
- notes
- created_at
- updated_at

Account type:

- DEMO
- PROP_CHALLENGE
- FUNDED
- PERSONAL_LIVE

Platform:

- MT4
- MT5
- TRADINGVIEW
- WEB
- OTHER

Status:

- ACTIVE
- PAUSED
- PASSED
- FAILED
- CLOSED

### instruments

Support user-accessible instruments.

Fields:

- id
- symbol
- display_name
- asset_class
- base_currency where applicable
- quote_currency where applicable
- pip_size where applicable
- price_precision
- active

Seed at minimum:

- EURUSD
- GBPUSD
- USDJPY
- USDCHF
- USDCAD
- EURJPY
- GBPJPY
- EURGBP
- GBPCHF
- CADJPY
- XAUUSD

Architecture must allow more.

### strategies

Fields:

- id
- user_id
- name
- description
- active
- created_at
- updated_at

### setups

Fields:

- id
- user_id
- strategy_id
- name
- description
- active
- created_at
- updated_at

### trading_rules

Fields:

- id
- user_id
- account_id nullable
- name
- description
- rule_type
- numeric_limit nullable
- active
- created_at
- updated_at

Rules must support descriptive/manual rules as well as measurable rules.

Seed useful examples only if clearly marked as examples:

- Maximum risk per trade
- Minimum planned RR
- Maximum trades per day
- Never widen stop loss
- Avoid high-impact news
- No revenge trading

Do not enforce example rules globally unless the user activates/configures them.

### trades

Build the canonical trade table.

Include identifiers:

- id
- user_id
- account_id
- instrument_id
- strategy_id nullable
- setup_id nullable

Lifecycle:

- status
- outcome nullable

Source:

- source_type
- external_trade_id nullable
- import_batch_id nullable

Timing:

- planned_at nullable
- opened_at nullable
- closed_at nullable
- timezone_at_entry nullable

Context:

- direction
- order_type
- session
- primary_analysis_timeframe nullable
- entry_timeframe nullable
- higher_timeframe_bias nullable
- market_condition nullable

Trade thesis:

- thesis nullable
- entry_reason nullable
- confirmation_notes nullable

Planned values:

- account_balance_before
- planned_entry
- planned_stop_loss
- planned_take_profit
- planned_risk_amount
- planned_risk_percentage
- planned_reward_amount
- planned_risk_reward
- planned_lot_size

Actual values:

- actual_entry nullable
- actual_stop_loss nullable
- actual_exit nullable
- actual_lot_size nullable

Costs:

- commission
- swap
- other_fees

Result:

- gross_pnl nullable
- net_pnl nullable
- pips_result nullable
- actual_r nullable

Excursion:

- mfe_amount nullable
- mfe_pips nullable
- mfe_r nullable
- mae_amount nullable
- mae_pips nullable
- mae_r nullable

Execution:

- holding_duration_seconds nullable

Review-related fields may be kept in separate tables rather than bloating trades where appropriate.

Use good normalization judgment.

### trade_targets

Support:

- trade_id
- label
- planned_price
- actual_fill_price nullable
- planned_close_percentage nullable
- actual_close_percentage nullable
- hit_at nullable
- pnl_contribution nullable

This permits TP1, TP2, TP3 and future partial exits.

### trade_screenshots

Include:

- id
- trade_id
- category
- timeframe nullable
- storage_path
- caption nullable
- captured_at nullable
- created_at

Categories:

- BEFORE_ENTRY
- AT_ENTRY
- DURING_TRADE
- AT_EXIT
- POST_TRADE_REVIEW

### trade_reviews

Include:

- trade_id
- what_went_well
- what_went_wrong
- would_take_again
- improvement
- lesson_learned
- trade_quality_grade
- reviewed_at

Trade grade:

- A
- B
- C
- D
- F

### trade_execution_reviews

Include or otherwise model:

- entry_according_to_plan
- stop_according_to_plan
- target_according_to_plan
- stop_action
- closed_early
- entered_early
- entered_late
- chased_price
- added_to_position
- revenge_trade
- over_risked
- execution_rating
- notes

Stop action:

- UNCHANGED
- MOVED_TO_BREAK_EVEN
- TIGHTENED
- WIDENED

### trade_psychology

Include:

- confidence_before_entry
- emotion_before
- emotion_during
- emotion_after
- fear_influenced
- greed_influenced
- fomo_influenced
- notes

Emotion options should include:

- CALM
- FOCUSED
- FEARFUL
- EXCITED
- FRUSTRATED
- IMPATIENT
- OVERCONFIDENT
- TIRED
- OTHER

### trade_rule_results

Include:

- trade_id
- trading_rule_id
- complied
- notes nullable

### trade_tags

Create tags and a many-to-many trade/tag relationship.

Tags must be user editable.

### daily_logs

Include:

- user_id
- account_id
- trading_date
- starting_balance nullable
- ending_balance nullable
- market_conditions
- mental_state
- followed_daily_plan nullable
- hit_daily_loss_threshold nullable
- stopped_when_required nullable
- daily_rating nullable
- lessons
- notes

Financial daily statistics should normally be derived from trades, not typed redundantly unless clearly marked as snapshot data.

### weekly_reviews

Include:

- user_id
- account_id
- week_start
- what_worked
- what_did_not
- change_next_week
- behavior_to_stop
- behavior_to_continue
- notes

### monthly_reviews

Include:

- user_id
- account_id
- month
- what_worked
- what_did_not
- lessons
- focus_next_month
- notes

### account_adjustments

Include:

- account_id
- type
- amount
- occurred_at
- notes

Types:

- DEPOSIT
- WITHDRAWAL
- BALANCE_CORRECTION
- OTHER

### account_snapshots

Optional manual snapshots:

- account_id
- captured_at
- balance
- equity
- notes

### account_goals

Include:

- account_id
- goal_type
- target_value
- target_date nullable
- achieved_at nullable
- notes

### prop_firm_configs

Do not yet build full prop UI, but prepare the table.

Include:

- account_id
- firm_name
- model_name
- phase_name
- profit_target_percent nullable
- max_daily_loss_percent nullable
- max_total_loss_percent nullable
- consistency_limit_percent nullable
- minimum_trading_days nullable
- notes

Do not hardcode current FTMO or FundingPips rules into migrations.

## Indexes

Add indexes for frequently queried fields including where appropriate:

- user_id
- account_id
- instrument_id
- opened_at
- closed_at
- status
- outcome
- strategy_id
- setup_id

## Constraints

Add useful database constraints.

Examples:

- risk percentages cannot be negative
- ratings remain within range
- lot size cannot be negative
- percentages in trade targets remain valid
- account starting balance must be greater than zero

Do not make constraints so rigid that valid real broker data cannot be stored later.

## Domain Types

Create shared strict TypeScript types for all core enums and models.

Avoid duplicating database enum strings manually throughout the application.

## Validation Schemas

Create Zod schemas for:

- trading account
- strategy
- setup
- trading rule
- trade
- trade target
- execution review
- psychology review
- trade review
- daily log
- weekly review
- monthly review

## Seed Data

Create development seed data including:

### Demo Account

Name:

100K Demo Practice

Type:

DEMO

Starting balance:

100000 USD

Do not seed fake trade results as if they were the user's real records.

Development-only sample data must be clearly separated.

### Strategies

Seed optional editable examples such as:

- Market Structure
- Break and Retest
- Trend Continuation

Do not assume these are the user's actual strategy.

### Instruments

Seed the required instruments.

## Account Balance Service

Create a deterministic service capable of deriving account balance from:

starting_balance

plus closed-trade net PnL

plus account adjustments

Do not rely exclusively on a manually mutable current-balance column.

Write tests.

## Storage

Create or document the Supabase Storage bucket required for trade screenshots.

Use private/user-controlled access.

## Minimal Foundation UI

Build only enough UI to manage foundational reference data:

- accounts
- strategies
- setups
- trading rules

Use shadcn.

Every React file must contain at most one React component.

## Acceptance Criteria

Phase 01 passes only when:

- Supabase Auth works
- schema migrations succeed
- RLS protects user data
- accounts can be created and edited
- strategies can be created and edited
- setups can be created and edited
- trading rules can be created and edited
- 100K demo account seed exists in development
- account balance derivation works
- screenshots storage architecture exists
- Zod schemas exist
- database types compile
- tests pass
- typecheck passes
- lint passes
- production build passes

Stop after Phase 01.
