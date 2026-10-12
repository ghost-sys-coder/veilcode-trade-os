begin;
create extension if not exists pgtap with schema extensions;
select plan(32);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','events-mcp@example.test','fixture-only','{}','{}',now(),now());
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('ffffffff-ffff-4fff-8fff-ffffffffffff','manual','http://127.0.0.1:9877/callback','authorization_code,refresh_token','public','none');
insert into private.integration_resources(purpose,resource,enabled) values('MCP','https://trade.example/mcp',true) on conflict(purpose) do update set resource=excluded.resource,enabled=excluded.enabled;
insert into private.integration_grants(id,owner_id,client_id,purpose,resource,authorization_id,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','MCP','https://trade.example/mcp','event-fixture','ACTIVE');
insert into auth.sessions(id,user_id,oauth_client_id,created_at,updated_at)
values('11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff',clock_timestamp(),clock_timestamp());
insert into auth.oauth_consents(id,user_id,client_id,scopes)
values(gen_random_uuid(),'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff','email');
select set_config('request.jwt.claims',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated',
 'client_id','ffffffff-ffff-4fff-8fff-ffffffffffff','session_id','11111111-1111-4111-8111-111111111111',
 'exp',extract(epoch from clock_timestamp())+3600,'aud',jsonb_build_array('authenticated','https://trade.example/mcp'),
 'trade_os_grant_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','trade_os_grant_version','1','trade_os_resource','https://trade.example/mcp')::text,true);
insert into public.trading_accounts(id,user_id,name,account_type,platform,currency_code,currency_precision,starting_balance,started_at)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',auth.uid(),'Events challenge','PROP_CHALLENGE','OTHER','USD',2,1000,'2026-09-01');

create function pg_temp.trade_request(action text,fields jsonb) returns jsonb language sql as $$
 select jsonb_build_object('action',action,'operationId',gen_random_uuid())||fields;
$$;
select ok(not has_function_privilege('authenticated','private.application_trade_write(jsonb,jsonb)','EXECUTE'),'OAuth cannot directly call trade writer');
select set_config('trade.request',pg_temp.trade_request('CREATE',jsonb_build_object('values',jsonb_build_object('account_id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','instrument_id',(select id from public.instruments where symbol='EURUSD' and user_id is null),'direction','BUY','status','OPEN','opened_at','2026-10-08T01:00:00Z','planned_risk_amount','100','planned_stop_loss','1.08')))::text,true);
select set_config('trade.proposal',(current_setting('trade.request')::jsonb-'action'-'operationId'||jsonb_build_object('values',current_setting('trade.request')::jsonb->'values'||'{"commission":"0","swap":"0","other_fees":"0","trading_credits":"0","order_type":"MARKET","session":"OTHER","net_pnl":null,"outcome":null,"actual_r":null,"holding_duration_seconds":null}'::jsonb))::text,true);
select set_config('trade.result',private.application_trade_write(current_setting('trade.request')::jsonb,current_setting('trade.proposal')::jsonb)::text,true);
select set_config('trade.id',current_setting('trade.result')::jsonb->'record'->>'id',true);
select is(current_setting('trade.result')::jsonb->'record'->>'status','OPEN','creation opens the canonical position');
select is(current_setting('trade.result')::jsonb->'record'->'net_pnl','null'::jsonb,'open trade has no realized PnL');
select is(private.application_trade_write(current_setting('trade.request')::jsonb,'{}'),current_setting('trade.result')::jsonb,'retry returns one trade receipt');
select is((select count(*)::integer from public.trades where id=current_setting('trade.id')::uuid),1,'retry does not duplicate canonical trade');
select throws_ok($$select private.application_trade_write(jsonb_set(current_setting('trade.request')::jsonb,'{values,direction}','"SELL"'),'{}')$$,'23505','Operation payload conflict.','changed retry is rejected');
create function pg_temp.existing_request(action text,fields jsonb) returns jsonb language sql as $$
 select pg_temp.trade_request(action,jsonb_build_object('id',current_setting('trade.id'),'expectedVersion',(select record_version::text from private.application_trade_versions where trade_id=current_setting('trade.id')::uuid))||fields);
$$;
select throws_ok($$select private.application_trade_write(pg_temp.existing_request('PATCH','{"values":{"planned_stop_loss":"1.09"}}'), '{"values":{"planned_stop_loss":"1.09"}}')$$,'23514','Recorded plan is protected.','ordinary post-open plan edit rejected');
select is(private.application_trade_write(pg_temp.existing_request('CORRECT','{"fieldName":"planned_stop_loss","newValue":"1.081","reason":"Recorded decimal correction"}'),'{"values":{},"correctedValue":"1.081"}')->>'action','CORRECT','explicit correction succeeds');
select is((select previous_value::text::numeric from public.trade_plan_corrections where trade_id=current_setting('trade.id')::uuid limit 1),1.08::numeric,'first correction preserves original opened stop');
select is(private.application_trade_write(pg_temp.existing_request('MANAGEMENT','{"event":{"event_type":"STOP_MOVED","occurred_at":"2026-10-08T02:00:00Z","price":"1.085","notes":"Moved stop to break even"}}'),'{"values":{}}')->'record'->>'actual_stop_loss','1.0850000000','stop movement updates current execution, not plan');
select is((select planned_stop_loss from public.trades where id=current_setting('trade.id')::uuid),1.081::numeric,'management leaves corrected plan unchanged');
select is((select count(*)::integer from public.trade_plan_corrections where trade_id=current_setting('trade.id')::uuid),1,'management is not a plan correction');
select throws_ok($$select private.application_trade_write(pg_temp.existing_request('REVIEW','{"reviews":{"psychology":{"values":{"fear_influenced":false},"complete":true}}}'),'{"values":{}}')$$,'23514','Only closed trades can complete reviews.','review cannot complete before closure');
select is(private.application_trade_write(pg_temp.existing_request('REVIEW','{"reviews":{"psychology":{"values":{"fear_influenced":false},"complete":false}}}'),'{"values":{}}')->>'action','REVIEW','draft behavioral answers can be stored');
select is((select fomo_influenced from public.trade_psychology where trade_id=current_setting('trade.id')::uuid),null::boolean,'unanswered is not false');
select is((select reviewed_at from public.trade_psychology where trade_id=current_setting('trade.id')::uuid),null::timestamptz,'placeholder answers are not completed evidence');
select is(private.application_trade_write(pg_temp.existing_request('PATCH','{"values":{"status":"CLOSED","closed_at":"2026-10-08T03:00:00Z","gross_pnl":"10.20","commission":"0.10","swap":"0.10"}}'),
 '{"values":{"status":"CLOSED","closed_at":"2026-10-08T03:00:00Z","gross_pnl":"10.20","commission":"0.10","swap":"0.10","net_pnl":"10.00","outcome":"WIN","actual_r":"0.10000000","holding_duration_seconds":"7200"}}')->'record'->>'net_pnl','10.00','closed net includes exact fee deductions');
select throws_ok($$select private.application_trade_write(pg_temp.existing_request('PATCH','{"values":{"gross_pnl":"-1"}}'),'{"values":{"gross_pnl":"-1","net_pnl":"-1.2","outcome":"WIN","actual_r":"-0.012"}}')$$,'23514','Finalization contradicts financial evidence.','contradictory outcome is not accepted');
select is(private.application_trade_write(pg_temp.existing_request('REVIEW','{"reviews":{"psychology":{"values":{"fear_influenced":false,"greed_influenced":false,"fomo_influenced":true},"complete":true}}}'),'{"values":{}}')->>'action','REVIEW','explicit complete behavioral review succeeds');
select ok((select reviewed_at is not null from public.trade_psychology where trade_id=current_setting('trade.id')::uuid),'completion timestamp persists');
select throws_ok($$select private.application_trade_prepare(jsonb_build_object('action','PATCH','operationId',gen_random_uuid(),'id',current_setting('trade.id'),'expectedVersion','1','values','{}'::jsonb))$$,'40001','Trade version conflict.','child mutations invalidate stale expected versions');
select is(jsonb_typeof(private.application_trade_read(jsonb_build_object('id',current_setting('trade.id')))->'trade'->'record_version'),'string','concurrency versions are strings');
insert into public.trading_rules(id,user_id,name,description,rule_type) values('34343434-3434-4434-8434-343434343434',auth.uid(),'Draft answer rule','Explicit applicable rule','DESCRIPTIVE');
select private.application_trade_write(pg_temp.existing_request('REVIEW','{"reviews":{"rules":{"results":[{"trading_rule_id":"34343434-3434-4434-8434-343434343434","complied":false,"notes":"Original draft note"}],"complete":false}}}'),'{"values":{}}');
select is((select complied from public.trade_rule_results where trade_id=current_setting('trade.id')::uuid and trading_rule_id='34343434-3434-4434-8434-343434343434'),false,'explicit false remains an answered draft, not completed evidence');
select private.application_trade_write(pg_temp.existing_request('REVIEW','{"reviews":{"rules":{"results":[{"trading_rule_id":"34343434-3434-4434-8434-343434343434","complied":false}],"complete":false}}}'),'{"values":{}}');
select is((select notes from public.trade_rule_results where trade_id=current_setting('trade.id')::uuid and trading_rule_id='34343434-3434-4434-8434-343434343434'),'Original draft note','omitted rule note stays unchanged');
select private.application_trade_write(pg_temp.existing_request('REVIEW','{"reviews":{"rules":{"results":[{"trading_rule_id":"34343434-3434-4434-8434-343434343434","complied":null}],"complete":false}}}'),'{"values":{}}');
select is((select count(*)::integer from public.trade_rule_results where trade_id=current_setting('trade.id')::uuid and trading_rule_id='34343434-3434-4434-8434-343434343434'),0,'explicit null restores unanswered state before rule review completion');
select ok(exists(select 1 from private.application_mutation_audits a where a.changes->'beforeRelated'->'ruleResults' @> '[{"complied":false,"notes":"Original draft note"}]' and a.changes->'afterRelated'->'ruleResults'='[]'::jsonb),'cleared draft answer remains recoverable in immutable before/after audit');
select is(private.application_trade_write(pg_temp.existing_request('CORRECT','{"fieldName":"planned_stop_loss","newValue":"1.082","reason":"Second recorded stop correction"}'),'{"values":{},"correctedValue":"1.082"}')->>'action','CORRECT','multiple corrections remain append-only');
select is(private.application_trade_read(jsonb_build_object('id',current_setting('trade.id')))->'corrections'->0->>'previous_value','1.0800000000','stable append order keeps original opened value first');
select is(jsonb_typeof(private.application_trade_read(jsonb_build_object('id',current_setting('trade.id')))->'corrections'->0->'correction_sequence'),'string','correction ordering crosses the wire without bigint loss');
create function pg_temp.fail_trade_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture trade audit failure.' using errcode='23514'; end;$$;
create trigger fixture_fail_trade_audit before insert on private.application_mutation_audits for each row execute function pg_temp.fail_trade_audit();
select throws_ok($$select private.application_trade_write(pg_temp.existing_request('CORRECT','{"fieldName":"planned_stop_loss","newValue":"1.083","reason":"Must roll back correction"}'),'{"values":{},"correctedValue":"1.083"}')$$,'23514','Fixture trade audit failure.','failed audit rolls back correction and current value together');
drop trigger fixture_fail_trade_audit on private.application_mutation_audits;
select is((select planned_stop_loss from public.trades where id=current_setting('trade.id')::uuid),1.082::numeric,'failed correction leaves current value unchanged');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_trade_read(jsonb_build_object('id',current_setting('trade.id')))$$,'42501','Integration access denied.','revocation blocks trade reads immediately');
select * from finish();
rollback;
