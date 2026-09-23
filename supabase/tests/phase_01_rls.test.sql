begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

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
  $$select private.correct_trade_plan_value(id, 'planned_stop_loss', '1.096'::jsonb, 'Corrected copied stop') from public.trades where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
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
  $$select private.correct_trade_plan_value(id, 'planned_stop_loss', '1.097'::jsonb, '') from public.trades where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  '22023',
  'A meaningful correction reason is required.',
  'missing correction reason is rejected'
);

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select throws_ok(
  $$select private.correct_trade_plan_value(trade_id, 'planned_stop_loss', '1.097'::jsonb, 'Unauthorized attempt') from phase_01_test_context$$,
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

update public.trades
set status = 'OPEN'
where id = (select trade_id from phase_01_target_context);

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
select lives_ok(
  $$update public.trade_targets set actual_fill_price = 1.21050, actual_close_percentage = 50 where trade_id = (select trade_id from phase_01_target_context)$$,
  'actual partial-exit facts remain editable during trade management'
);
select lives_ok(
  $$select private.correct_trade_plan_value(
      (select trade_id from phase_01_target_context),
      'target.label',
      '"TP1 corrected"'::jsonb,
      'Corrected target label',
      (select id from public.trade_targets where trade_id = (select trade_id from phase_01_target_context))
    )$$,
  'approved target correction succeeds'
);
select is(
  (select label from public.trade_targets where trade_id = (select trade_id from phase_01_target_context)),
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

select * from finish();
rollback;
