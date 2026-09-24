begin;

create extension if not exists pgtap with schema extensions;
select plan(57);

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
  (select count(*)::integer from public.instruments where user_id is null),
  11,
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
  (select net_pnl::text from public.trades where id = (select trade_id from phase_01_precision_context)),
  '0.00000000',
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

select * from finish();
rollback;
