begin;

create extension if not exists pgtap with schema extensions;
select plan(100);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.trading_accounts'::regclass),
  'trading_accounts has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.trades'::regclass),
  'trades has RLS enabled'
);
select ok(
  (select not public from storage.buckets where id = 'trade-screenshots'),
  'trade screenshot bucket is private'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@example.test', 'test-only', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

select is(
  (select count(*)::integer from public.trading_accounts where name = '100K Demo Practice'),
  1,
  'new user receives the 100K demo account'
);
select is(
  (select count(*)::integer from public.strategies where is_example),
  3,
  'new user receives three editable example strategies'
);
select is(
  (select count(*)::integer from public.trading_rules where is_example),
  6,
  'new user receives six inactive example rules'
);
select is(
  (select count(*)::integer from public.instruments where user_id is null and symbol in
    ('EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','EURJPY','GBPJPY','EURGBP','GBPCHF','CADJPY','XAUUSD','AUDUSD','AUDJPY','EURAUD')),
  14,
  'required global instruments are available'
);

select lives_ok(
  $$insert into public.trading_accounts (user_id, name, account_type, platform, currency_code, currency_precision, starting_balance)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RLS Test Account', 'DEMO', 'OTHER', 'USD', 2, 100000)$$,
  'owner can insert an account'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is(
  (select count(*)::integer from public.trading_accounts where name = 'RLS Test Account'),
  0,
  'another user cannot read the owner account'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
insert into public.trades (
  user_id, account_id, instrument_id, status, direction,
  planned_entry, planned_stop_loss, planned_risk_amount
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  a.id,
  i.id,
  'OPEN',
  'BUY',
  1.10000,
  1.09500,
  250
from public.trading_accounts a
cross join public.instruments i
where a.name = 'RLS Test Account' and i.symbol = 'EURUSD';

create temporary table phase_01_test_context as
select id as trade_id
from public.trades
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select throws_ok(
  $$update public.trades set planned_stop_loss = 1.09600 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',
  'Protected planned values require the correction workflow.',
  'direct protected updates are rejected after OPEN'
);

select lives_ok(
  $$select public.correct_trade_plan_value(id, 'planned_stop_loss', '1.096', 'Corrected copied stop') from public.trades where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'approved correction succeeds'
);

select is(
  (select count(*)::integer from public.trade_plan_corrections where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1,
  'correction history is appended'
);
select is(
  (select planned_stop_loss::text from public.trades where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '1.0960000000',
  'current planned value is updated atomically'
);

select throws_ok(
  $$select public.correct_trade_plan_value(id, 'planned_stop_loss', '1.097', '') from public.trades where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '22023',
  'A meaningful correction reason is required.',
  'missing correction reason is rejected'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select throws_ok(
  $$select public.correct_trade_plan_value(trade_id, 'planned_stop_loss', '1.097', 'Unauthorized attempt') from phase_01_test_context$$,
  'P0002',
  'Trade not found.',
  'unauthorized correction is rejected'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
set local role service_role;
select throws_ok(
  $$update public.trades set planned_stop_loss = 1.09700 where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '42501',
  'Protected planned values require the correction workflow.',
  'service role cannot bypass protected plan values'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

insert into public.trades (
  user_id, account_id, instrument_id, status, direction,
  planned_entry, planned_stop_loss, planned_risk_amount
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  a.id,
  i.id,
  'PLANNED',
  'BUY',
  1.20000,
  1.19500,
  250
from public.trading_accounts a
cross join public.instruments i
where a.name = 'RLS Test Account' and i.symbol = 'EURUSD';

create temporary table phase_01_target_context as
select id as trade_id
from public.trades
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and planned_entry = 1.20000;

insert into public.trade_targets (
  user_id, trade_id, label, planned_price, planned_close_percentage
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  trade_id,
  'TP1',
  1.21000,
  50
from phase_01_target_context;

select lives_ok(
  $$select public.replace_trade_targets(
      (select trade_id from phase_01_target_context),
      '[{"label":"TP1","planned_price":"1.21000","planned_close_percentage":"50"},{"label":"TP2","planned_price":"1.22000","planned_close_percentage":"50"}]'::jsonb
    )$$,
  'editable planned targets can be replaced atomically'
);
select is(
  (select count(*)::integer from public.trade_targets where trade_id = (select trade_id from phase_01_target_context)),
  2,
  'atomic target replacement persists the complete valid set'
);
select throws_ok(
  $$select public.replace_trade_targets(
      (select trade_id from phase_01_target_context),
      '[{"label":"Invalid","planned_price":"1.23000","planned_close_percentage":"101"}]'::jsonb
    )$$,
  '23514',
  'Planned target percentages cannot exceed 100%.',
  'invalid target replacement is rejected'
);
select is(
  (select string_agg(label, ',' order by label) from public.trade_targets where trade_id = (select trade_id from phase_01_target_context)),
  'TP1,TP2',
  'a rejected target replacement preserves the previous complete set'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select throws_ok(
  $$select public.replace_trade_targets(
      (select trade_id from phase_01_target_context),
      '[]'::jsonb
    )$$,
  'P0002',
  'Trade not found.',
  'another user cannot replace trade targets'
);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

update public.trades
set status = 'OPEN'
where id = (select trade_id from phase_01_target_context);

select throws_ok(
  $$update public.trades set status = 'DRAFT' where id = (select trade_id from phase_01_target_context)$$,
  '23514',
  'An open trade can only remain open or be closed.',
  'an open trade cannot regress to a pre-open lifecycle state'
);

select throws_ok(
  $$insert into public.trade_targets (user_id, trade_id, label, planned_price, planned_close_percentage)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', trade_id, 'TP2', 1.22000, 50 from phase_01_target_context$$,
  '42501',
  'Planned targets cannot be added after a trade has opened.',
  'planned targets cannot be inserted after OPEN'
);
select throws_ok(
  $$delete from public.trade_targets where trade_id = (select trade_id from phase_01_target_context)$$,
  '42501',
  'Planned targets cannot be deleted after a trade has opened.',
  'planned targets cannot be deleted after OPEN'
);
select throws_ok(
  $$update public.trade_targets set planned_price = 1.21100 where trade_id = (select trade_id from phase_01_target_context)$$,
  '42501',
  'Protected planned target values require the correction workflow.',
  'planned target values cannot be directly updated after OPEN'
);
select throws_ok(
  $$select public.update_trade_target_execution(
      (select trade_id from phase_01_target_context),
      jsonb_build_array(
        jsonb_build_object('id', (select id from public.trade_targets where trade_id = (select trade_id from phase_01_target_context) and label = 'TP1'), 'actual_fill_price', '1.21050', 'actual_close_percentage', '50'),
        jsonb_build_object('id', (select id from public.trade_targets where trade_id = (select trade_id from phase_01_target_context) and label = 'TP2'), 'actual_close_percentage', '51')
      )
    )$$,
  '23514',
  'Actual target percentages cannot exceed 100%.',
  'invalid execution target updates are rejected atomically'
);
select is(
  (select count(*)::integer from public.trade_targets where trade_id = (select trade_id from phase_01_target_context) and actual_close_percentage is not null),
  0,
  'rejected execution facts leave every target unchanged'
);
select lives_ok(
  $$select public.update_trade_target_execution(
      (select trade_id from phase_01_target_context),
      jsonb_build_array(
        jsonb_build_object('id', (select id from public.trade_targets where trade_id = (select trade_id from phase_01_target_context) and label = 'TP1'), 'actual_fill_price', '1.21050', 'actual_close_percentage', '50'),
        jsonb_build_object('id', (select id from public.trade_targets where trade_id = (select trade_id from phase_01_target_context) and label = 'TP2'))
      )
    )$$,
  'actual partial-exit facts are saved atomically during trade management'
);
select lives_ok(
  $$select public.correct_trade_plan_value(
      (select trade_id from phase_01_target_context),
      'target.label',
      'TP1 corrected',
      'Corrected target label',
      (select id from public.trade_targets where trade_id = (select trade_id from phase_01_target_context) and label = 'TP1')
    )$$,
  'approved target correction succeeds'
);
select is(
  (select label from public.trade_targets where trade_id = (select trade_id from phase_01_target_context) and planned_price = 1.21000),
  'TP1 corrected',
  'target correction updates the current planned value'
);

insert into public.trading_accounts (
  user_id, name, account_type, platform, currency_code, currency_precision, starting_balance
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Precision Test Account', 'DEMO', 'OTHER', 'KWD', 3, 100000
);

insert into public.trades (
  user_id, account_id, instrument_id, status, direction, planned_entry
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  a.id,
  i.id,
  'OPEN',
  'BUY',
  1.30000
from public.trading_accounts a
cross join public.instruments i
where a.name = 'Precision Test Account' and i.symbol = 'EURUSD';

create temporary table phase_01_precision_context as
select id as trade_id
from public.trades
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and planned_entry = 1.30000;

select lives_ok(
  $$update public.trades set status = 'CLOSED', net_pnl = 0.0004, outcome = 'BREAK_EVEN'
    where id = (select trade_id from phase_01_precision_context)$$,
  'final PnL is normalized at account currency precision before classification'
);
select is(
  (select net_pnl from public.trades where id = (select trade_id from phase_01_precision_context)),
  0::numeric,
  'normalized break-even PnL is persisted as exact zero'
);
select lives_ok(
  $$update public.trades set net_pnl = 0.001, outcome = 'WIN'
    where id = (select trade_id from phase_01_precision_context)$$,
  'small positive PnL representable at currency precision remains a win'
);
select throws_ok(
  $$update public.trades set outcome = 'PARTIAL_WIN'
    where id = (select trade_id from phase_01_precision_context)$$,
  '23514',
  'Outcome conflicts with normalized net PnL or partial-exit history. Expected WIN.',
  'partial win is rejected without a recorded partial exit'
);
select throws_ok(
  $$update public.trades set status = 'CLOSED', net_pnl = 20, outcome = 'WIN'
    where id = (select trade_id from phase_01_target_context)$$,
  '23514',
  'Outcome conflicts with normalized net PnL or partial-exit history. Expected PARTIAL_WIN.',
  'ordinary win is rejected when partial exits were used'
);
select lives_ok(
  $$update public.trades set status = 'CLOSED', net_pnl = 20, outcome = 'PARTIAL_WIN'
    where id = (select trade_id from phase_01_target_context)$$,
  'positive complete-trade PnL with a partial exit becomes PARTIAL_WIN'
);
select lives_ok(
  $$update public.trades set net_pnl = 0, outcome = 'BREAK_EVEN'
    where id = (select trade_id from phase_01_target_context)$$,
  'a partially managed trade with zero final PnL becomes BREAK_EVEN'
);
select throws_ok(
  $$update public.trades set status = 'OPEN', outcome = null where id = (select trade_id from phase_01_target_context)$$,
  '23514',
  'A closed trade cannot return to an earlier lifecycle state.',
  'a closed trade cannot regress to OPEN'
);

select lives_ok(
  $$insert into public.tags (user_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Phase03Tag')$$,
  'owner can create a journal tag'
);
select is(
  (select normalized_name from public.tags where name = 'Phase03Tag'),
  'phase03tag',
  'tag display form is preserved while normalized form is generated'
);
select throws_ok(
  $$insert into public.tags (user_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'phase03tag')$$,
  '23505',
  'duplicate key value violates unique constraint "tags_owner_normalized_name_unique"',
  'tag names are unique case-insensitively for one user'
);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is(
  (select count(*)::integer from public.tags where name = 'Phase03Tag'),
  0,
  'another user cannot read owner tags'
);
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok(
  $$insert into public.daily_logs (user_id, account_id, trading_date, notes)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, '2026-09-23', 'Phase 03 daily log'
    from public.trading_accounts where name = 'RLS Test Account'$$,
  'owner can create one account-day journal log'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.account_adjustment_classifications'::regclass),
  'adjustment classification history has RLS enabled'
);

select lives_ok(
  $$insert into public.account_adjustments (
      user_id, account_id, type, amount, occurred_at, is_performance_neutral
    )
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'DEPOSIT', 100, now(), false
    from public.trading_accounts where name = 'RLS Test Account'$$,
  'fixed adjustment types are normalized on insert'
);

select is(
  (select is_performance_neutral from public.account_adjustments where type = 'DEPOSIT' and amount = 100),
  true,
  'a deposit cannot persist as performance-affecting'
);

select throws_ok(
  $$insert into public.account_adjustments (user_id, account_id, type, amount, occurred_at)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'OTHER', 25, now()
    from public.trading_accounts where name = 'RLS Test Account'$$,
  '23514',
  'OTHER adjustments require an explicit performance classification.',
  'a new OTHER adjustment cannot remain unclassified'
);

select lives_ok(
  $$insert into public.account_adjustments (
      user_id, account_id, type, amount, occurred_at,
      is_performance_neutral, classification_reason
    )
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'OTHER', 25, now(), true, 'Broker cash rebate'
    from public.trading_accounts where name = 'RLS Test Account'$$,
  'an explicitly classified OTHER adjustment is accepted'
);

create temporary table phase_04_adjustment_context as
select id as adjustment_id
from public.account_adjustments
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and type = 'OTHER' and amount = 25;

select throws_ok(
  $$update public.account_adjustments
    set is_performance_neutral = false
    where id = (select adjustment_id from phase_04_adjustment_context)$$,
  '42501',
  'Adjustment classification changes require the approved workflow.',
  'direct adjustment classification updates are rejected'
);

select lives_ok(
  $$select public.classify_account_adjustment(
      (select adjustment_id from phase_04_adjustment_context),
      false,
      'Treat rebate as account performance'
    )$$,
  'the approved adjustment classification workflow succeeds'
);

select is(
  (select is_performance_neutral from public.account_adjustments where id = (select adjustment_id from phase_04_adjustment_context)),
  false,
  'the current OTHER classification is updated atomically'
);

select is(
  (select count(*)::integer from public.account_adjustment_classifications where adjustment_id = (select adjustment_id from phase_04_adjustment_context)),
  1,
  'a classification change appends one audit event'
);

select throws_ok(
  $$select public.classify_account_adjustment(
      (select adjustment_id from phase_04_adjustment_context),
      true,
      ''
    )$$,
  '22023',
  'A meaningful classification reason is required.',
  'a classification change requires a meaningful reason'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select throws_ok(
  $$select public.classify_account_adjustment(
      (select adjustment_id from phase_04_adjustment_context),
      true,
      'Unauthorized reclassification'
    )$$,
  'P0002',
  'Account adjustment not found.',
  'another user cannot classify the owner adjustment'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select throws_ok(
  $$delete from public.account_adjustment_classifications
    where adjustment_id = (select adjustment_id from phase_04_adjustment_context)$$,
  '42501',
  'permission denied for table account_adjustment_classifications',
  'normal deletion attempts are rejected for append-only audit history'
);
select is(
  (select count(*)::integer from public.account_adjustment_classifications where adjustment_id = (select adjustment_id from phase_04_adjustment_context)),
  1,
  'classification audit history remains append-only through RLS'
);

select throws_ok(
  $$select public.classify_account_adjustment(
      (select id from public.account_adjustments where type = 'DEPOSIT' and amount = 100),
      false,
      'Invalid fixed-type classification'
    )$$,
  '22023',
  'Fixed adjustment types are always performance-neutral.',
  'fixed adjustment types cannot be reclassified'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.trade_rule_reviews'::regclass),
  'completed rule reviews have RLS enabled'
);

insert into public.trades (
  user_id, account_id, instrument_id, status, direction, opened_at, closed_at,
  gross_pnl, net_pnl, outcome
)
select
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', a.id, i.id, 'CLOSED', 'BUY',
  now() - interval '2 hours', now(), 25, 25, 'WIN'
from public.trading_accounts a
cross join public.instruments i
where a.name = 'RLS Test Account' and i.symbol = 'EURUSD';

create temporary table phase_05_context as
select id as trade_id
from public.trades
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and gross_pnl = 25
order by created_at desc
limit 1;

select lives_ok(
  $$insert into public.trade_execution_reviews (user_id, trade_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select trade_id from phase_05_context))$$,
  'an unanswered execution placeholder can be saved as a draft'
);

select is(
  (select reviewed_at is null from public.trade_execution_reviews where trade_id = (select trade_id from phase_05_context)),
  true,
  'an execution placeholder is not completed evidence'
);

select throws_ok(
  $$update public.trade_execution_reviews set reviewed_at = now()
    where trade_id = (select trade_id from phase_05_context)$$,
  '23514',
  'new row for relation "trade_execution_reviews" violates check constraint "trade_execution_reviews_completion_requires_answers"',
  'execution completion requires every explicit answer'
);

select lives_ok(
  $$update public.trade_execution_reviews set
      entry_according_to_plan = true, stop_according_to_plan = true,
      target_according_to_plan = false, stop_action = 'UNCHANGED',
      closed_early = false, entered_early = false, entered_late = false,
      chased_price = false, added_to_position = false, revenge_trade = false,
      over_risked = false, reviewed_at = now()
    where trade_id = (select trade_id from phase_05_context)$$,
  'explicit false execution answers can complete a closed-trade review'
);

select lives_ok(
  $$insert into public.trade_psychology (
      user_id, trade_id, fear_influenced, greed_influenced, fomo_influenced, reviewed_at
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select trade_id from phase_05_context), false, false, false, now()
    )$$,
  'explicit false psychology answers complete a closed-trade review'
);

insert into public.trading_rules (user_id, account_id, name, description, active)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', id, 'Phase 05 immutable rule', 'Wait for the required confirmation close.', true
from public.trading_accounts where name = 'RLS Test Account';

create temporary table phase_05_rule_context as
select id as rule_id from public.trading_rules where name = 'Phase 05 immutable rule';

select throws_ok(
  $$select public.complete_trade_rule_review((select trade_id from phase_05_context), '[]'::jsonb)$$,
  '22023',
  'Completed review must cover the exact applicable rule set.',
  'rule review completion rejects a missing applicable result'
);

select lives_ok(
  $$select public.complete_trade_rule_review(
      (select trade_id from phase_05_context),
      jsonb_build_array(jsonb_build_object(
        'trading_rule_id', (select rule_id from phase_05_rule_context),
        'complied', false,
        'notes', 'Entered before confirmation'
      ))
    )$$,
  'the exact applicable rule set completes atomically'
);

select is(
  (select applicable_rule_count from public.trade_rule_reviews where trade_id = (select trade_id from phase_05_context)),
  1,
  'completed review stores its applicable-rule count'
);

select is(
  (select count(*)::integer from public.trade_rule_review_items where rule_id_snapshot = (select rule_id from phase_05_rule_context)),
  1,
  'completed review stores the actual applicable rule ID and result'
);

update public.trading_rules set name = 'Phase 05 renamed rule' where id = (select rule_id from phase_05_rule_context);
select is(
  (select rule_name from public.trade_rule_review_items where rule_id_snapshot = (select rule_id from phase_05_rule_context)),
  'Phase 05 immutable rule',
  'later rule edits do not rewrite the immutable review snapshot'
);

delete from public.trading_rules where id = (select rule_id from phase_05_rule_context);
select is(
  (select count(*)::integer from public.trade_rule_review_items where rule_id_snapshot = (select rule_id from phase_05_rule_context)),
  1,
  'later rule deletion does not erase historical review evidence'
);

select throws_ok(
  $$delete from public.trade_rule_review_items where review_id in (
      select id from public.trade_rule_reviews where trade_id = (select trade_id from phase_05_context)
    )$$,
  '42501',
  'permission denied for table trade_rule_review_items',
  'normal workflows cannot delete immutable rule snapshots'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select throws_ok(
  $$select public.complete_trade_rule_review((select trade_id from phase_05_context), '[]'::jsonb)$$,
  'P0002',
  'Trade not found.',
  'another user cannot complete the owner rule review'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.account_goal_progress_events'::regclass),
  'goal progress events have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.account_status_events'::regclass),
  'account status events have RLS enabled'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok(
  $$insert into public.trading_accounts (
      user_id, name, account_type, platform, currency_code, currency_precision, starting_balance
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Phase 06 Challenge', 'PROP_CHALLENGE', 'MT5', 'USD', 2, 100000
    )$$,
  'owner can create a prop challenge'
);

select throws_ok(
  $$update public.trading_accounts set status = 'PASSED' where name = 'Phase 06 Challenge'$$,
  '42501',
  'Account status changes require the lifecycle workflow.',
  'direct lifecycle changes are rejected'
);

select lives_ok(
  $$select public.transition_account_status(
      (select id from public.trading_accounts where name = 'Phase 06 Challenge'),
      'PASSED', now(), null, 'Challenge criteria verified.'
    )$$,
  'the lifecycle RPC transitions the challenge atomically'
);

select is(
  (select count(*)::integer from public.account_status_events event
    join public.trading_accounts account on account.id = event.account_id
    where account.name = 'Phase 06 Challenge' and event.previous_status = 'ACTIVE' and event.new_status = 'PASSED'),
  1,
  'the lifecycle transition appends one audit event'
);

select lives_ok(
  $$insert into public.trading_accounts (
      user_id, name, account_type, platform, currency_code, currency_precision, starting_balance, previous_account_id
    ) select user_id, 'Phase 06 Funded', 'FUNDED', platform, currency_code, currency_precision, starting_balance, id
      from public.trading_accounts where name = 'Phase 06 Challenge'$$,
  'a funded account can link to a passed challenge'
);

select throws_ok(
  $$insert into public.prop_firm_configs (user_id, account_id, firm_name)
    select user_id, id, 'Invalid demo config' from public.trading_accounts where name = 'RLS Test Account'$$,
  '23514',
  'Prop configuration is only valid for prop challenge or funded accounts.',
  'prop configuration is rejected for non-prop accounts'
);

select throws_ok(
  $$insert into public.prop_firm_configs (user_id, account_id, firm_name, trading_day_timezone)
    select user_id, id, 'Timezone test', 'Not/A_Timezone' from public.trading_accounts where name = 'Phase 06 Challenge'$$,
  '23514',
  'Trading-day timezone must be a valid IANA timezone.',
  'prop configuration rejects an invalid trading-day timezone'
);

select lives_ok(
  $$insert into public.prop_firm_configs (
      user_id, account_id, firm_name, profit_target_mode, profit_target_value,
      drawdown_type, trading_day_timezone
    ) select user_id, id, 'Configured firm', 'PERCENT', 10, 'STATIC', 'Africa/Kampala'
      from public.trading_accounts where name = 'Phase 06 Challenge'$$,
  'owner can save an explicit prop configuration'
);

select throws_ok(
  $$insert into public.account_snapshots (user_id, account_id, captured_at, balance, equity, unrealized_pnl)
    select user_id, id, now(), 100000, 100100, 50 from public.trading_accounts where name = 'Phase 06 Challenge'$$,
  '23514',
  'new row for relation "account_snapshots" violates check constraint "account_snapshots_equity_equation"',
  'equity snapshots must satisfy balance plus unrealized PnL'
);

insert into public.account_goals (user_id, account_id, title, goal_type, target_value)
select user_id, id, 'Automatic trade sample', 'TOTAL_TRADES', 100
from public.trading_accounts where name = 'Phase 06 Challenge';

select throws_ok(
  $$insert into public.account_goal_progress_events (user_id, goal_id, progress_value)
    select user_id, id, 10 from public.account_goals where title = 'Automatic trade sample'$$,
  '23514',
  'Manual progress events are only valid for custom goals.',
  'automatic goals reject manual progress events'
);

insert into public.account_goals (user_id, account_id, title, goal_type, target_value, custom_unit)
select user_id, id, 'Study hours', 'CUSTOM', 50, 'hours'
from public.trading_accounts where name = 'Phase 06 Challenge';

select lives_ok(
  $$insert into public.account_goal_progress_events (user_id, goal_id, progress_value, notes)
    select user_id, id, 4.5, 'First study block' from public.account_goals where title = 'Study hours'$$,
  'custom goals accept append-only manual progress'
);

select throws_ok(
  $$delete from public.account_goals where title = 'Study hours'$$,
  '23503',
  'update or delete on table "account_goals" violates foreign key constraint "account_goal_progress_events_goal_owner_fk" on table "account_goal_progress_events"',
  'deleting a goal cannot cascade-delete its progress history'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is(
  (select count(*)::integer from public.account_goal_progress_events),
  0,
  'another user cannot read owner goal progress'
);
select is(
  (select count(*)::integer from public.account_status_events event
    join public.trading_accounts account on account.id = event.account_id
    where account.name = 'Phase 06 Challenge'),
  0,
  'another user cannot read owner lifecycle events'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select throws_ok(
  $$select public.transition_account_status(
      (select id from public.trading_accounts where name = 'Phase 06 Funded'),
      'FAILED', now(), null, null
    )$$,
  '22023',
  'A failure reason is required.',
  'failed transitions require a reason'
);

select lives_ok(
  $$select public.transition_account_status(
      (select id from public.trading_accounts where name = 'Phase 06 Funded'),
      'FAILED', now(), 'MAXIMUM_LOSS', 'Maximum loss confirmed.'
    )$$,
  'failed transitions preserve reason and notes'
);

select is(
  (select failure_reason::text from public.account_status_events event
    join public.trading_accounts account on account.id = event.account_id
    where account.name = 'Phase 06 Funded' and event.new_status = 'FAILED'),
  'MAXIMUM_LOSS',
  'failure history retains the structured reason'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.import_batch_rows'::regclass),
  'import batch staging rows have RLS enabled'
);

select throws_ok(
  $$insert into public.import_batches (user_id, account_id, source_type)
    select user_id, id, 'MANUAL' from public.trading_accounts where name = 'RLS Test Account'$$,
  '23514',
  'new row for relation "import_batches" violates check constraint "import_batches_import_source_only"',
  'manual trades cannot create an import batch'
);

select lives_ok(
  $$insert into public.import_batches (
      user_id, account_id, source_type, source_filename, row_count, mapping_config
    ) select user_id, id, 'CSV', 'phase-07.csv', 1, '{"symbol":"Symbol"}'::jsonb
      from public.trading_accounts where name = 'RLS Test Account'$$,
  'owner can create a CSV import batch'
);

select throws_ok(
  $$insert into public.trades (
      user_id, account_id, instrument_id, status, source_type, external_trade_id, direction
    ) select a.user_id, a.id, i.id, 'DRAFT', 'CSV', 'missing-batch', 'BUY'
      from public.trading_accounts a cross join public.instruments i
      where a.name = 'RLS Test Account' and i.symbol = 'EURUSD'$$,
  '23514',
  'new row for relation "trades" violates check constraint "trades_import_source_requires_batch"',
  'an imported canonical trade requires a batch'
);

select throws_ok(
  $$insert into public.trades (
      user_id, account_id, instrument_id, status, source_type, external_trade_id, import_batch_id, direction
    ) select a.user_id, a.id, i.id, 'DRAFT', 'MT5', 'wrong-source', b.id, 'BUY'
      from public.trading_accounts a
      join public.import_batches b on b.account_id = a.id
      cross join public.instruments i
      where a.name = 'RLS Test Account' and i.symbol = 'EURUSD'$$,
  '23503',
  'insert or update on table "trades" violates foreign key constraint "trades_import_batch_identity_fk"',
  'an imported trade must match its batch account and source'
);

select lives_ok(
  $$insert into public.import_batch_rows (
      user_id, batch_id, row_number, status, deduplication_key, raw_data, canonical_data
    ) select user_id, id, 2, 'VALID', 'account:CSV:trade:42',
      '{"Ticket":"42"}'::jsonb, '{"symbol":"EURUSD"}'::jsonb
      from public.import_batches where source_filename = 'phase-07.csv'$$,
  'owner can stage a validated import row'
);

select throws_ok(
  $$insert into public.import_batch_rows (user_id, batch_id, row_number, status, raw_data)
    select user_id, id, 3, 'INVALID', '{}'::jsonb
      from public.import_batches where source_filename = 'phase-07.csv'$$,
  '23514',
  'new row for relation "import_batch_rows" violates check constraint "import_batch_rows_invalid_has_errors"',
  'invalid staged rows require explicit validation errors'
);

select throws_ok(
  $$insert into public.import_batch_rows (
      user_id, batch_id, row_number, status, raw_data, conflict_trade_id, conflict_resolution
    ) select b.user_id, b.id, 4, 'CONFLICT', '{}'::jsonb, c.trade_id, 'REPLACE'
      from public.import_batches b cross join phase_01_test_context c
      where b.source_filename = 'phase-07.csv'$$,
  '23514',
  'new row for relation "import_batch_rows" violates check constraint "import_batch_rows_replace_requires_confirmation"',
  'replace conflict resolution requires explicit confirmation and reason'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is(
  (select count(*)::integer from public.import_batches where source_filename = 'phase-07.csv'),
  0,
  'another user cannot read owner import batches'
);
select is(
  (select count(*)::integer from public.import_batch_rows),
  0,
  'another user cannot read owner staged import rows'
);

select * from finish();
rollback;
