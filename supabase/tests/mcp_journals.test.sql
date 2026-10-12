begin;
create extension if not exists pgtap with schema extensions;
select plan(26);
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
create function pg_temp.journal_request(kind text,p_period text,version text,fields jsonb) returns jsonb language sql as $$
 select jsonb_build_object('kind',kind,'period',p_period,'accountId','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','expectedVersion',version,'operationId',gen_random_uuid(),'values',fields);
$$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','journal-other@example.test','fixture-only','{}','{}',now(),now());
insert into public.trading_accounts(id,user_id,name,account_type,platform,currency_code,currency_precision,starting_balance,started_at)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Other owner','DEMO','OTHER','USD',2,1000,'2026-09-01');
select ok(not has_function_privilege('authenticated','private.application_journal_write(jsonb)','EXECUTE'),'OAuth cannot call private writer directly');
select ok(not has_function_privilege('anon','private.application_journal_read(jsonb)','EXECUTE'),'anonymous cannot read journals');
select is(private.application_journal_read('{"kind":"DAILY","accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","period":"2026-10-08"}')->'record','null'::jsonb,'missing period stays null');
select set_config('journal.request',pg_temp.journal_request('DAILY','2026-10-08','0','{"notes":"Original","followed_daily_plan":false}')::text,true);
select set_config('journal.result',private.application_journal_write(current_setting('journal.request')::jsonb)::text,true);
select is(current_setting('journal.result')::jsonb->'record'->>'record_version','1','version is a string');
select is(current_setting('journal.result')::jsonb->'record'->'followed_daily_plan','false'::jsonb,'deliberate false is retained');
select is(current_setting('journal.result')::jsonb->'record'->'stopped_when_required','null'::jsonb,'missing answer stays null');
select is(private.application_journal_write(current_setting('journal.request')::jsonb),current_setting('journal.result')::jsonb,'retry returns original durable receipt');
select is((select count(*)::integer from public.daily_logs),1,'one effect after retry');
select throws_ok($$select private.application_journal_write(jsonb_set(current_setting('journal.request')::jsonb,'{values,notes}','"Changed"'))$$,'23505','Operation payload conflict.','payload reuse rejected');
select throws_ok($$select private.application_journal_write(pg_temp.journal_request('DAILY','2026-10-08','0','{"notes":"Lost overwrite"}'))$$,'40001','Journal version conflict.','concurrent create cannot replace existing period');
select set_config('journal.updated',private.application_journal_write(pg_temp.journal_request('DAILY','2026-10-08','1','{"notes":null}'))::text,true);
select is(current_setting('journal.updated')::jsonb->'record'->'notes','null'::jsonb,'explicit null clears text');
select is(current_setting('journal.updated')::jsonb->'record'->'followed_daily_plan','false'::jsonb,'omitted answer remains unchanged');
select throws_ok($$select private.application_journal_write(pg_temp.journal_request('DAILY','2026-10-08','1','{"notes":"Stale"}'))$$,'40001','Journal version conflict.','stale update rejected');
select throws_ok($$select private.application_journal_write(pg_temp.journal_request('DAILY','2026-10-08','2','{"starting_balance":"999"}'))$$,'22023','Protected journal field.','reflections cannot rewrite monetary observations');
select throws_ok($$select private.application_journal_write(pg_temp.journal_request('WEEKLY','2026-10-08','0','{"notes":"Wrong day"}'))$$,'22023','Invalid period.','weekly requires Monday');
select throws_ok($$select private.application_journal_write(pg_temp.journal_request('MONTHLY','2026-10-08','0','{"notes":"Wrong day"}'))$$,'22023','Invalid period.','monthly requires first day');
select lives_ok($$select private.application_journal_write(pg_temp.journal_request('WEEKLY','2026-10-05','0','{"what_worked":"Patient entries"}'))$$,'weekly save');
select lives_ok($$select private.application_journal_write(pg_temp.journal_request('MONTHLY','2026-10-01','0','{"focus_next_month":"Consistency"}'))$$,'monthly save');
select is(jsonb_array_length(private.application_journal_read('{"kind":"DAILY","accountId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","limit":1}')->'records'),1,'scoped bounded paging');
select throws_ok($$select private.application_journal_read('{"kind":"DAILY","accountId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","limit":10}')$$,'P0002','Account unavailable.','unowned account cannot be read');
select throws_ok($$select private.application_journal_write(jsonb_set(pg_temp.journal_request('DAILY','2026-10-09','0','{"notes":"Wrong owner"}'),'{accountId}','"dddddddd-dddd-4ddd-8ddd-dddddddddddd"'))$$,'P0002','Account unavailable.','unowned account cannot be mutated');
select is((select count(*)::integer from private.application_operations where operation_kind like 'JOURNAL_%'),4,'durable receipt per successful operation');
create function pg_temp.fail_journal_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure.' using errcode='23514';end;$$;
create trigger fixture_fail_journal_audit before insert on private.application_mutation_audits for each row execute function pg_temp.fail_journal_audit();
select throws_ok($$select private.application_journal_write(pg_temp.journal_request('DAILY','2026-10-08','2','{"notes":"Must roll back"}'))$$,'23514','Fixture audit failure.','audit failure aborts update');
drop trigger fixture_fail_journal_audit on private.application_mutation_audits;
select is((select record_version::text from public.daily_logs),'2','failed audit does not bump version');
select is((select notes from public.daily_logs),null::text,'failed audit preserves reflection');
update private.integration_grants set status='REVOKED',revoked_at=clock_timestamp() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select throws_ok($$select private.application_journal_write(current_setting('journal.request')::jsonb)$$,'42501','Integration access denied.','revocation rejects even retry');
select * from finish();
rollback;
