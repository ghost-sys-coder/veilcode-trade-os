begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
   and not exists (select 1 from pg_policy p where p.polrelid = c.oid
     and p.polname = 'trade_os_direct_browser_only' and not p.polpermissive)),
  0, 'every RLS-enabled workspace table has a restrictive OAuth boundary'
);
select ok(
  exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass
    and polname = 'trade_os_direct_browser_only' and not polpermissive),
  'private screenshot storage has the restrictive OAuth boundary'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.prosecdef and p.prorettype <> 'trigger'::regtype
     and p.prosrc not like '%perform private.require_direct_browser_session();%'
     and p.oid not in ('private.authorize_integration(text,text)'::regprocedure,
       'private.integration_access_token_hook(jsonb)'::regprocedure,
       'private.mt5_acquire_lease(text,uuid,uuid,uuid)'::regprocedure,
       'private.mt5_capture(text,uuid,uuid,text,uuid,jsonb,text,jsonb,jsonb)'::regprocedure,
       'private.get_integration_operation(text,text,uuid)'::regprocedure)),
  0, 'non-trigger private security-definer workflows cannot bypass OAuth isolation'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'oauth-owner@example.test', 'test-only', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'oauth-other@example.test', 'test-only', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

select lives_ok(
  $$select private.require_direct_browser_session()$$,
  'a normal browser user remains eligible for legacy workflows'
);
select is((select count(*)::integer from public.trading_accounts), 1, 'browser owner sees its seeded account only');
select lives_ok(
  $$insert into public.strategies (user_id, name, description)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'OAuth isolation fixture', 'Browser-owned fixture')$$,
  'browser owner can still create configuration'
);
select lives_ok(
  $$insert into public.trades (user_id, account_id, instrument_id, status, direction)
    select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', a.id, i.id, 'PLANNED', 'BUY'
    from public.trading_accounts a cross join public.instruments i
    where a.name = '100K Demo Practice' and i.symbol = 'EURUSD' and i.user_id is null$$,
  'browser owner can create a canonical trade fixture'
);
select is((select count(*)::integer from public.trades), 1,
  'OAuth read isolation is tested against a populated trade table');

select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","client_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","scope":"openid email"}', true);

select is((select count(*)::integer from public.trading_accounts), 0, 'OAuth token cannot directly read even its owner account');
select is((select count(*)::integer from public.profiles), 0, 'OAuth token cannot directly read its owner profile');
select is((select count(*)::integer from public.strategies), 0, 'OIDC scopes do not confer configuration access');
select is((select count(*)::integer from public.instruments), 0, 'OAuth token cannot bypass isolation through reference instruments');
select is((select count(*)::integer from public.trades), 0, 'OAuth token cannot directly read canonical trades');
select throws_ok(
  $$insert into public.strategies (user_id, name, description)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Forbidden OAuth write', 'Must not persist')$$,
  '42501', null::text, 'OAuth token cannot directly insert configuration'
);
with changed as (update public.strategies set name = 'Forbidden update'
  where name = 'OAuth isolation fixture' returning id)
select is(
  (select count(*)::integer from changed),
  0, 'OAuth update cannot affect a browser-owned row'
);
with changed as (delete from public.strategies where name = 'OAuth isolation fixture' returning id)
select is(
  (select count(*)::integer from changed),
  0, 'OAuth delete cannot affect a browser-owned row'
);
select throws_ok(
  $$select private.require_direct_browser_session()$$,
  '42501', 'A direct browser session is required.', 'OAuth session cannot masquerade as browser consent'
);
select throws_ok(
  $$select public.correct_trade_plan_value('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'planned_entry', '1.1', 'Fixture reason', null)$$,
  '42501', 'A direct browser session is required.', 'security-definer plan correction rejects OAuth before reading a trade'
);
select throws_ok(
  $$select public.complete_trade_rule_review('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '[]'::jsonb)$$,
  '42501', 'A direct browser session is required.', 'security-definer review completion rejects OAuth'
);
select throws_ok(
  $$select public.transition_account_status('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ACTIVE', now(), null, 'Fixture reason')$$,
  '42501', 'A direct browser session is required.', 'security-definer lifecycle workflow rejects OAuth'
);
select throws_ok(
  $$select public.replace_trade_targets('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '[]'::jsonb)$$,
  '42501', 'A direct browser session is required.', 'legacy planned-target replacement rejects OAuth'
);
select throws_ok(
  $$select public.update_trade_target_execution('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '[]'::jsonb)$$,
  '42501', 'A direct browser session is required.', 'legacy financial-execution workflow rejects OAuth'
);
select throws_ok(
  $$select public.classify_account_adjustment('dddddddd-dddd-4ddd-8ddd-dddddddddddd', true, 'Fixture reason')$$,
  '42501', 'A direct browser session is required.', 'legacy adjustment classification rejects OAuth'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is((select count(*)::integer from public.strategies where name = 'OAuth isolation fixture'), 1, 'denied OAuth writes/deletes leave browser data unchanged');

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);
select is((select count(*)::integer from public.strategies where name = 'OAuth isolation fixture'), 0, 'non-owner browser still cannot read owner data');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select count(*) from public.trading_accounts$$,
  '42501', null::text, 'anonymous workspace access remains denied'
);

select * from finish();
rollback;
