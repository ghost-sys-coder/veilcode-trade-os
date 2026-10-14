begin;
create extension if not exists pgtap with schema extensions;
select plan(51);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','journals-mcp@example.test','fixture-only','{}','{}',now(),now());
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
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',auth.uid(),'Journal fixture','DEMO','OTHER','USD',2,1000,'2026-09-01');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other-progress@example.test','fixture-only','{}','{}',now(),now());
insert into public.trading_accounts(id,user_id,name,account_type,platform,currency_code,currency_precision,starting_balance,started_at)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Other owner','DEMO','OTHER','USD',2,1000,'2026-09-01'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc',auth.uid(),'Prop fixture','PROP_CHALLENGE','OTHER','KWD',3,1000,'2026-09-01');

create function pg_temp.goal_request(kind text,fields jsonb,goal_id uuid default null,version text default null) returns jsonb language sql as $$
 select jsonb_build_object('action',kind,'operationId',gen_random_uuid())||case when kind='GOAL_CREATE' then jsonb_build_object('accountId','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') else jsonb_build_object('id',goal_id,'expectedVersion',version) end||jsonb_build_object('values',fields);
$$;
select ok(not has_function_privilege('authenticated','private.application_progress_write(jsonb,jsonb)','EXECUTE'),'OAuth cannot call the private writer');
select ok(not has_function_privilege('anon','private.application_progress_data(jsonb)','EXECUTE'),'anonymous cannot read metrics');
select set_config('goal.request',pg_temp.goal_request('GOAL_CREATE','{"title":"Custom sample","goal_type":"CUSTOM","target_value":"25.00000001","target_date":null,"custom_unit":"hours","active":true,"notes":null}')::text,true);
select set_config('goal.result',private.application_progress_write(current_setting('goal.request')::jsonb,jsonb_build_object('values',current_setting('goal.request')::jsonb->'values'))::text,true);
select set_config('goal.id',current_setting('goal.result')::jsonb->'record'->>'id',true);
select is(current_setting('goal.result')::jsonb->'record'->>'record_version','1','goal version is an exact string');
select is(current_setting('goal.result')::jsonb->'record'->>'target_value','25.00000001','custom target preserves non-currency precision');
select is(private.application_progress_write(current_setting('goal.request')::jsonb,'{}'),current_setting('goal.result')::jsonb,'retry returns original receipt without recalculating');
select throws_ok($$select private.application_progress_write(jsonb_set(current_setting('goal.request')::jsonb,'{values,title}','"Changed"'),'{}')$$,'23505','Operation payload conflict.','changed retry rejected');
select is((select count(*)::integer from public.account_goals),1,'one durable goal');
select set_config('goal.event',jsonb_build_object('action','GOAL_PROGRESS','operationId',gen_random_uuid(),'goalId',current_setting('goal.id'),'expectedVersion','1','progressValue','-0.00000001','recordedAt','2026-10-08T00:00:00Z','notes','Reviewed progress')::text,true);
select set_config('goal.event.result',private.application_progress_write(current_setting('goal.event')::jsonb,'{"progressValue":"-0.00000001"}')::text,true);
select is(current_setting('goal.event.result')::jsonb->>'goalVersion','2','evidence append changes goal concurrency version');
select is(current_setting('goal.event.result')::jsonb->'record'->>'progress_value','-0.00000001','custom evidence uses its own precision');
select is(private.application_progress_write(current_setting('goal.event')::jsonb,'{}'),current_setting('goal.event.result')::jsonb,'event retry is durable');
select is((select count(*)::integer from public.account_goal_progress_events),1,'one append after retry');
select throws_ok($$select private.application_progress_write(pg_temp.goal_request('GOAL_PATCH','{"title":"Stale"}',current_setting('goal.id')::uuid,'1'),'{}')$$,'40001','Goal version conflict.','stale patch rejected');
select throws_ok($$update public.account_goals set custom_unit='USD' where id=current_setting('goal.id')::uuid$$,'23514','Goal progress units and type must be preserved.','history cannot be silently reinterpreted');
select is(jsonb_array_length(private.application_progress_read('{"kind":"GOALS","accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","limit":1,"includeArchived":false}')->'records'),1,'bounded owned goal page');
select is(jsonb_array_length(private.application_progress_read(jsonb_build_object('kind','EVENTS','goalId',current_setting('goal.id'),'limit',1))->'records'),1,'bounded owned event page');
select lives_ok($$select private.application_progress_data('{"accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}')$$,'exact progress loader can read current owner');
select throws_ok($$select private.application_progress_read('{"kind":"GOALS","accountId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","limit":10,"includeArchived":false}')$$,'P0002','Account unavailable.','unowned account denied');
select throws_ok($$select private.application_progress_write('{"action":"PROP_SAVE","operationId":"22222222-2222-4222-8222-222222222222","accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","expectedVersion":"0","values":{"firm_name":"Firm"}}','{}')$$,'23514','Prop configuration requires a prop account.','demo cannot receive prop rules');
select lives_ok($$select private.application_progress_write(jsonb_build_object('action','GOAL_ARCHIVE','operationId',gen_random_uuid(),'id',current_setting('goal.id'),'expectedVersion','2','reason','Retire research goal'),'{}')$$,'referenced goal archives rather than deletes');
select ok((select archived_at = updated_at from public.account_goals where id=current_setting('goal.id')::uuid),'goal archive and last update share one event timestamp');
select is((select count(*)::integer from public.account_goal_progress_events),1,'archive preserves evidence');
select throws_ok($$update public.account_goals set active=true,archived_at=null where id=current_setting('goal.id')::uuid$$,'23514','Archived goals cannot be reactivated.','archive cannot silently undo history');
select is(jsonb_array_length(private.application_progress_read('{"kind":"GOALS","accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","limit":10,"includeArchived":false}')->'records'),0,'default page excludes archived records');
select is(jsonb_array_length(private.application_progress_read('{"kind":"GOALS","accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","limit":10,"includeArchived":true}')->'records'),1,'archive remains accessible explicitly');
select throws_ok($$select private.application_progress_write(jsonb_build_object('action','GOAL_PROGRESS','operationId',gen_random_uuid(),'goalId',current_setting('goal.id'),'expectedVersion','3','progressValue','1','recordedAt','2026-10-08T00:00:00Z'),'{"progressValue":"1"}')$$,'23514','Goal is archived.','archived goal cannot gain new evidence');

select throws_ok($$select private.application_progress_data('{"accountId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'P0002','Account not found.','metrics cannot read a real other-owner account');
select throws_ok($$select private.application_progress_write(jsonb_build_object('action','GOAL_CREATE','operationId',gen_random_uuid(),'accountId','dddddddd-dddd-4ddd-8ddd-dddddddddddd','values',current_setting('goal.request')::jsonb->'values'),'{}')$$,'P0002','Account unavailable.','goal cannot be created for another owner');
select throws_ok($$select private.application_progress_read('{"kind":"GOALS","accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","limit":101,"includeArchived":true}')$$,'22023','Invalid page.','page limit is database-enforced');
select set_config('prop.values','{"firm_name":"Explicit firm","model_name":null,"phase_name":null,"profit_target_mode":"AMOUNT","profit_target_value":"10.0005","daily_loss_mode":null,"daily_loss_value":null,"daily_loss_baseline":null,"daily_loss_measure":null,"total_loss_mode":null,"total_loss_value":null,"total_loss_baseline":null,"total_loss_measure":null,"drawdown_type":"STATIC","consistency_formula":null,"consistency_limit_percent":null,"minimum_trading_days":null,"maximum_trading_days":null,"trading_day_timezone":"UTC","profitable_day_min_pnl":"0.0005","notes":null}',true);
create function pg_temp.prop_request(fields jsonb,version text default '0') returns jsonb language sql as $$
 select jsonb_build_object('action','PROP_SAVE','operationId',gen_random_uuid(),'accountId','cccccccc-cccc-4ccc-8ccc-cccccccccccc','expectedVersion',version,'values',fields);
$$;
select set_config('prop.request',pg_temp.prop_request(current_setting('prop.values')::jsonb)::text,true);
select set_config('prop.proposal',jsonb_build_object('values',current_setting('prop.values')::jsonb||'{"profit_target_value":"10.001","profitable_day_min_pnl":"0.001"}'::jsonb)::text,true);
select set_config('prop.result',private.application_progress_write(current_setting('prop.request')::jsonb,current_setting('prop.proposal')::jsonb)::text,true);
select is(current_setting('prop.result')::jsonb->'record'->>'record_version','1','prop creation has a string concurrency version');
select is(current_setting('prop.result')::jsonb->'record'->>'profit_target_value','10.00100000','prop amount uses account three-decimal precision');
select is(current_setting('prop.result')::jsonb->'record'->>'profitable_day_min_pnl','0.00100000','positive day boundary uses account precision');
select is(private.application_progress_write(current_setting('prop.request')::jsonb,'{}'),current_setting('prop.result')::jsonb,'prop lost-ack retry returns committed result');
select is((select count(*)::integer from public.prop_firm_configs),1,'one prop effect after replay');
select throws_ok($$select private.application_progress_write(pg_temp.prop_request('{"notes":"Stale"}'),'{}')$$,'40001','Prop version conflict.','prop stale creation rejected');
select set_config('prop.percent.request',pg_temp.prop_request('{"profit_target_mode":"PERCENT","profit_target_value":"0.00000001"}','1')::text,true);
select set_config('prop.percent.proposal',jsonb_build_object('values',(current_setting('prop.result')::jsonb->'record')-array['id','user_id','account_id','record_version','trading_day_basis','created_at','updated_at']||'{"profit_target_mode":"PERCENT","profit_target_value":"0.00000001"}'::jsonb)::text,true);
select set_config('prop.percent.result',private.application_progress_write(current_setting('prop.percent.request')::jsonb,current_setting('prop.percent.proposal')::jsonb)::text,true);
select is(current_setting('prop.percent.result')::jsonb->'record'->>'profit_target_value','0.00000001','percentage precision is not currency-rounded');
select is(current_setting('prop.percent.result')::jsonb->'record'->>'record_version','2','prop patch advances version');
select is(current_setting('prop.percent.result')::jsonb->'record'->>'firm_name','Explicit firm','omitted prop field unchanged');
select is(private.application_progress_read('{"kind":"PROP","accountId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}')->'record',current_setting('prop.percent.result')::jsonb->'record','prop reader returns exact owned snapshot');
select throws_ok($$update public.trading_accounts set currency_precision=2 where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$,'23514','Currency/precision must preserve goal and prop history.','currency changes cannot reinterpret firm amounts');
select throws_ok($$select private.application_progress_write(pg_temp.prop_request('{"notes":"Overprecision","profit_target_value":"0.000000001"}','2'),jsonb_build_object('values',(current_setting('prop.percent.proposal')::jsonb->'values')||'{"notes":"Overprecision","profit_target_value":"0.000000001"}'::jsonb))$$,'22003','Numeric storage precision conflict.','unsupported percentage precision fails instead of rounding');
select throws_ok($$select private.application_progress_write(pg_temp.prop_request('{"daily_loss_mode":"AMOUNT"}','2'),jsonb_build_object('values',(current_setting('prop.percent.proposal')::jsonb->'values')||'{"daily_loss_mode":"AMOUNT"}'::jsonb))$$,'23514','Incomplete prop rule.','incomplete optional rule rejected at database boundary');
select throws_ok($$select private.application_progress_write(pg_temp.prop_request('{"trading_day_timezone":"Invalid/Zone"}','2'),jsonb_build_object('values',(current_setting('prop.percent.proposal')::jsonb->'values')||'{"trading_day_timezone":"Invalid/Zone"}'::jsonb))$$,'23514','Trading-day timezone must be a valid IANA timezone.','invalid timezone rejected by database');
create function pg_temp.reject_progress_audit() returns trigger language plpgsql as $$begin raise exception 'Injected audit failure.' using errcode='P0001';end;$$;
create trigger reject_progress_audit before insert on private.application_mutation_audits for each row execute function pg_temp.reject_progress_audit();
select throws_ok($$select private.application_progress_write(pg_temp.prop_request('{"notes":"Audit must succeed"}','2'),jsonb_build_object('values',(current_setting('prop.percent.proposal')::jsonb->'values')||'{"notes":"Audit must succeed"}'::jsonb))$$,'P0001','Injected audit failure.','failed audit rolls back entire prop command');
drop trigger reject_progress_audit on private.application_mutation_audits;
select is((select record_version::text from public.prop_firm_configs),'2','failed audit leaves version unchanged');
select is((select notes from public.prop_firm_configs),null,'failed audit leaves values unchanged');
select is((select count(*)::integer from private.application_operations where operation_kind='PROP_SAVE'),2,'failed prop writes leave no receipt');
update public.prop_firm_configs set notes=repeat('n',5000);
select set_config('prop.legacy.proposal',jsonb_build_object('values',(current_setting('prop.percent.proposal')::jsonb->'values')||jsonb_build_object('notes',repeat('n',5000),'firm_name','Updated explicit firm'))::text,true);
select lives_ok($$select private.application_progress_write(pg_temp.prop_request('{"firm_name":"Updated explicit firm"}','3'),current_setting('prop.legacy.proposal')::jsonb)$$,'partial patch preserves legacy long notes');
select is((select length(notes) from public.prop_firm_configs),5000,'unchanged legacy notes are never truncated');
select throws_ok($$update public.trading_accounts set account_type='DEMO' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$,'23514','Account type must preserve prop configuration.','account edits cannot invalidate configured prop eligibility');
-- Goals allow some inactive metadata updates after archival. The shared
-- timestamp trigger must not regress to this transaction's earlier start time.
update public.account_goals set updated_at=now()-interval '1 day' where id=current_setting('goal.id')::uuid;
select ok((select updated_at >= archived_at from public.account_goals where id=current_setting('goal.id')::uuid),'later allowed archived-goal update cannot move behind its archive event');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_progress_write(current_setting('goal.request')::jsonb,'{}')$$,'42501','Integration access denied.','revocation applies to retries');
select * from finish();
rollback;
