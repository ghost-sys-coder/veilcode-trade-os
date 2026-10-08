begin;
create extension if not exists pgtap with schema extensions;
select plan(43);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','account-mcp@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','account-other@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://trade.example/mcp','account-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
 'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
create function pg_temp.account_request(name text,currency text,p_precision integer,balance jsonb) returns jsonb language sql as $$
 select jsonb_build_object('action','CREATE','operationId',gen_random_uuid(),'values',jsonb_build_object('name',name,'account_type','DEMO',
 'broker_name',null,'platform','OTHER','currency_code',currency,'currency_precision',p_precision,'starting_balance',balance,
 'leverage',null,'started_at','2026-09-01','status','ACTIVE','notes','Original context'));
$$;
create function pg_temp.patch_account(version text,values_json jsonb,reason text default null) returns jsonb language sql as $$
 select private.application_account_write(jsonb_build_object('action','PATCH','operationId',gen_random_uuid(),'id',current_setting('account.fixture.id'),
 'expectedVersion',version,'values',values_json)||case when reason is null then '{}'::jsonb else jsonb_build_object('reason',reason) end);
$$;
select ok(not has_function_privilege('authenticated','private.application_account_write(jsonb)','EXECUTE'),'OAuth has no direct writer access');
select ok(not has_function_privilege('anon','private.application_account_read(jsonb)','EXECUTE'),'anonymous account reads are forbidden');
select is((select count(*)::integer from private.account_currency_codes),176,'versioned ISO registry excludes test/no-currency codes');
select set_config('account.fixture.request',pg_temp.account_request('Account fixture','USD',2,'"1000.005"')::text,true);
select set_config('account.fixture.result',private.application_account_write(current_setting('account.fixture.request')::jsonb)::text,true);
select set_config('account.fixture.id',current_setting('account.fixture.result')::jsonb->'record'->>'id',true);
select is(current_setting('account.fixture.result')::jsonb->'record'->>'starting_balance','1000.01000000','baseline normalizes half-up at configured currency precision');
select is(jsonb_typeof(current_setting('account.fixture.result')::jsonb->'record'->'starting_balance'),'string','stored money crosses the boundary as string');
select is(current_setting('account.fixture.result')::jsonb->'record'->>'record_version','1','account version is an explicit string');
select is(private.application_account_write(current_setting('account.fixture.request')::jsonb),current_setting('account.fixture.result')::jsonb,'retry returns original account result');
select is((select count(*)::integer from private.application_operations),1,'retry creates one effect and one receipt');
select throws_ok($$select private.application_account_write(jsonb_set(current_setting('account.fixture.request')::jsonb,'{values,name}','"Changed retry"'))$$,
 '23505','Operation payload conflict.','changed payload cannot reuse the operation ID');
select throws_ok($$select private.application_account_write(pg_temp.account_request('Zero','USD',2,'"0.001"'))$$,
 '23514','Positive normalized baseline required.','a baseline rounded to zero cannot create an account');
select throws_ok($$select private.application_account_write(pg_temp.account_request('Raw number','USD',2,'1000'))$$,
 '22023','Invalid account values.','numeric JSON cannot masquerade as a monetary string');
select throws_ok($$select private.application_account_write(pg_temp.account_request('Wrong ISO','AAA',2,'"1000"'))$$,
 '23514','Registered account currency required.','arbitrary three-letter currency is rejected');
select is(private.application_account_write(pg_temp.account_request('JPY fixture','JPY',0,'"1000.5"'))->'record'->>'starting_balance','1001.00000000','zero-decimal currency uses account precision');
select is(private.application_account_write(pg_temp.account_request('KWD fixture','KWD',3,'"0.0005"'))->'record'->>'starting_balance','0.00100000','three-decimal currency preserves a small positive baseline');
select throws_ok($$select private.application_account_write(pg_temp.account_request('Storage precision','USD',9,'"0.000000001"'))$$,
 '22003','Unsupported persisted monetary precision.','unsupported persisted scale is rejected rather than silently rounded twice');
select is(pg_temp.patch_account('1','{"name":"Renamed account"}')->'record'->>'record_version','2','metadata patch uses optimistic concurrency');
select is(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->>'notes','Original context','omitted fields remain unchanged');
select is(pg_temp.patch_account('2','{"notes":null}')->'record'->'notes','null'::jsonb,'null clears nullable metadata');
select throws_ok($$select pg_temp.patch_account('1','{"name":"Stale overwrite"}')$$,'40001','Account version conflict.','stale account patch rejected');
select throws_ok($$select pg_temp.patch_account('3','{"starting_balance":"1100"}')$$,'23514','Baseline/date correction requires a reason.','financial baseline edits require an explicit reason');
select is(pg_temp.patch_account('3','{"starting_balance":"1100"}','Recorded funding correction')->'record'->>'starting_balance','1100.00000000','explicit baseline correction is audited');

insert into public.trades(user_id,account_id,instrument_id,status,direction,opened_at,net_pnl)
select 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,id,'OPEN','BUY',clock_timestamp(),999 from public.instruments where symbol='EURUSD' and user_id is null;
insert into public.trades(user_id,account_id,instrument_id,status,direction,opened_at,closed_at,gross_pnl,net_pnl,outcome)
select 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,i.id,'CLOSED','BUY',clock_timestamp()-interval '1 hour',clock_timestamp(),p.pnl,p.pnl,p.outcome
from public.instruments i cross join (values(.015::numeric,'WIN'::public.trade_outcome),(-.005::numeric,'LOSS'::public.trade_outcome)) p(pnl,outcome) where symbol='EURUSD' and user_id is null;
insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,'DEPOSIT',50,clock_timestamp()),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,'WITHDRAWAL',-10,clock_timestamp());
insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at,is_performance_neutral,classification_reason)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,'OTHER',5,clock_timestamp(),false,'Explicit performance adjustment');
insert into public.account_snapshots(user_id,account_id,captured_at,balance,equity,unrealized_pnl)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,clock_timestamp(),9000,10000,1000);
select is(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->>'closed_trade_net_pnl','0.01','open PnL excluded and each closed result is normalized before summing');
select is(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->>'account_adjustments_total','45','all adjustments affect balance but are separated from trading profit');
select is(jsonb_typeof(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->'closed_trade_net_pnl'),'string','aggregated PnL stays a decimal string');
select is(jsonb_typeof(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->'account_adjustments_total'),'string','aggregated adjustments stay a decimal string');
select is(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->>'closed_trade_count','2','closed sample excludes open trade and snapshots');
select throws_ok($$select pg_temp.patch_account('4','{"currency_code":"GBP"}')$$,'23514','Currency history cannot be reinterpreted.','history currency cannot be silently changed');
select throws_ok($$select pg_temp.patch_account('4','{"currency_precision":0}')$$,'23514','Currency history cannot be reinterpreted.','history precision cannot be silently changed');
select throws_ok($$select pg_temp.patch_account('4','{"status":"PASSED"}')$$,'22023','Invalid account command.','normal patch cannot bypass lifecycle events');
select throws_ok($$select pg_temp.patch_account('4','{"user_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'22023','Invalid account command.','caller cannot choose another owner');
select throws_ok($$select private.application_account_read(jsonb_build_object('id',(select id from public.trading_accounts where user_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' limit 1)))$$,
 'P0002','Account not found.','cross-owner IDs reveal no account');
select ok(private.application_account_read('{"limit":1}')->>'nextCursor' is not null,'account lists are bounded and cursor-paginated');
select is(public.get_integration_operation('https://trade.example/mcp','MCP',(current_setting('account.fixture.request')::jsonb->>'operationId')::uuid)->>'status','COMMITTED','existing operation tool recovers an account receipt');
insert into public.account_adjustments(user_id,account_id,type,amount,occurred_at)
select 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,'DEPOSIT',.01,clock_timestamp() from generate_series(1,1001);
select is((private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->>'account_adjustments_total')::numeric,55.01::numeric,'all 1001 repeated adjustments contribute without first-page truncation or drift');
-- Simulate one genuinely legacy unclassified row, not a permitted new insert.
set local session_replication_role=replica;
update public.account_adjustments set is_performance_neutral=null,classification_reason=null,classified_at=null,classified_by_user_id=null
where account_id=current_setting('account.fixture.id')::uuid and user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' and type='OTHER';
set local session_replication_role=origin;
select is(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->>'unclassified_other_count','1','legacy unclassified OTHER is counted explicitly, never assumed neutral');

insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('88888888-8888-4888-8888-888888888888','manual','http://127.0.0.1:9876/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MT5','https://trade.example/api/integrations/v1',true);
insert into private.integration_grants(id,owner_id,client_id,purpose,account_id,resource,authorization_id,status)
values('77777777-7777-4777-8777-777777777777','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','88888888-8888-4888-8888-888888888888','MT5',
 current_setting('account.fixture.id')::uuid,'https://trade.example/api/integrations/v1','mapped-account-fixture','ACTIVE');
insert into private.mt5_connections(owner_id,account_id,grant_id,identity)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',current_setting('account.fixture.id')::uuid,'77777777-7777-4777-8777-777777777777',
 '{"server":"Broker-Demo","login":"987654","terminalInstallationId":"99999999-9999-4999-8999-999999999999","currencyCode":"USD","currencyPrecision":2,"accountKind":"DEMO","positionMode":"HEDGING"}');
select throws_ok($$select pg_temp.patch_account('4','{"starting_balance":"1200"}','Broker baseline correction')$$,
 '23514','Mapped account requires integration reconciliation.','MCP cannot rewrite a mapped account baseline even with a generic reason');
select throws_ok($$select pg_temp.patch_account('4','{"started_at":"2026-08-01"}','Broker funding date correction')$$,
 '23514','Mapped account requires integration reconciliation.','mapped funding-date correction requires its integration workflow');
select set_config('account.fixture.challenge',private.application_account_write(jsonb_set(jsonb_set(pg_temp.account_request('Passed challenge','USD',2,'"1000"'),'{values,account_type}','"PROP_CHALLENGE"'),'{values,status}','"PASSED"'))->'record'->>'id',true);
select throws_ok($$select private.application_account_write(jsonb_build_object('action','PATCH','operationId',gen_random_uuid(),'id',current_setting('account.fixture.challenge'),
 'expectedVersion','1','values',jsonb_build_object('account_type','DEMO')))$$,'23514','Historical account lifecycle type must be preserved.','passed challenge cannot be reinterpreted as demo');

create function pg_temp.fail_account_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture account audit failure.' using errcode='23514'; end;$$;
create trigger fixture_fail_account_audit before insert on private.application_mutation_audits for each row execute function pg_temp.fail_account_audit();
select throws_ok($$select pg_temp.patch_account('4','{"name":"Must roll back"}')$$,'23514','Fixture account audit failure.','failed audit aborts the whole account command');
drop trigger fixture_fail_account_audit on private.application_mutation_audits;
select is(private.application_account_read(jsonb_build_object('id',current_setting('account.fixture.id')))->>'name','Renamed account','record update rolls back with failed receipt/audit');
select throws_ok($$update private.application_mutation_audits set changes='{}'$$,'42501','Integration audit events are append-only.','account audit cannot be rewritten');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_account_read('{"limit":10}')$$,'42501','Integration access denied.','revocation blocks account reads immediately');
select throws_ok($$select private.application_account_write(current_setting('account.fixture.request')::jsonb)$$,'42501','Integration access denied.','revocation blocks idempotent account retries too');
select * from finish();
rollback;
