begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','files-owner@example.test','fixture-only','{}','{}',now(),now()),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','files-other@example.test','fixture-only','{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values
('22222222-2222-4222-8222-222222222222','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',now(),now()),
('33333333-3333-4333-8333-333333333333','dddddddd-dddd-4ddd-8ddd-dddddddddddd',now(),now());
select set_config('files.browser',jsonb_build_object('sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','role','authenticated','session_id','22222222-2222-4222-8222-222222222222','exp',extract(epoch from clock_timestamp())+3600)::text,true);
select set_config('request.jwt.claims',current_setting('files.browser'),true);
insert into public.trading_accounts(id,user_id,name,account_type,broker_name,platform,currency_code,currency_precision,starting_balance,started_at)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','File fixture','DEMO','Fixture','MT5','USD',2,1000,'2026-10-01');
insert into public.trades(id,user_id,account_id,instrument_id,direction,status)
values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
(select id from public.instruments where symbol='EURUSD' and user_id is null),'BUY','DRAFT');
select ok(not (select public from storage.buckets where id='trade-file-staging'),'staging bucket is private');
select is((select file_size_limit::integer from storage.buckets where id='trade-file-staging'),393216,'staging object byte limit');
select is((select file_size_limit::integer from storage.buckets where id='trade-screenshots'),10485760,'existing image limit unchanged');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.file_uploads'::regclass,'private.file_upload_chunks'::regclass)),'private manifest RLS enabled');
select ok(not has_function_privilege('anon','private.application_file_read(jsonb)','EXECUTE'),'anonymous private read denied');
select ok(not has_function_privilege('authenticated','private.application_file_write(jsonb,jsonb)','EXECUTE'),'browser/OAuth direct writer denied');
select ok(not has_function_privilege('service_role','private.application_file_write(jsonb,jsonb)','EXECUTE'),'API secret cannot call private file writer');
select ok((select bool_and(not prosecdef) from pg_proc where oid in ('private.application_file_read(jsonb)'::regprocedure,'private.application_file_prepare(jsonb)'::regprocedure,'private.application_file_write(jsonb,jsonb)'::regprocedure)),'file entry points are security invoker');
select throws_ok($$select private.application_file_read('{"action":"LIST","limit":101}')$$,'22023','Invalid page.','database bounds lists');
select throws_ok($$select private.application_file_read('{"action":"LIST"}')$$,'22023','Invalid file query.','missing limit cannot create an unbounded query');
select throws_ok($$select private.application_file_read('{"action":"LIST","limit":1,"ownerId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')$$,'22023','Invalid file query.','owner cannot be injected');
select set_config('files.request','{"action":"REQUEST","operationId":"00000000-0000-4000-8000-000000000001","tradeId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","expectedTradeVersion":"1","metadata":{"category":"AT_ENTRY","timeframe":null,"caption":"Recorded chart evidence","capturedAt":null},"contentType":"image/png","byteLength":3,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',true);
select throws_ok($$select private.application_file_write(current_setting('files.request')::jsonb||'{"storagePath":"../escape"}', '{}')$$,'22023','Invalid file command.','caller cannot choose a path');
select throws_ok($$select private.application_file_write(jsonb_set(current_setting('files.request')::jsonb,'{byteLength}','10485761'), '{}')$$,'22023','Invalid screenshot metadata.','database enforces total file limit');
select throws_ok($$select private.application_file_write(jsonb_set(current_setting('files.request')::jsonb,'{expectedTradeVersion}','"2"'), '{}')$$,'40001','Trade changed.','stale trade reservation rejected');
select set_config('files.result',private.application_file_write(current_setting('files.request')::jsonb,'{}')::text,true);
select set_config('files.id',current_setting('files.result')::jsonb->'upload'->>'uploadId',true);
select is(private.application_file_write(current_setting('files.request')::jsonb,'{}'),current_setting('files.result')::jsonb,'reservation retries preserve exact identity');
select is((select count(*)::integer from private.file_uploads),1,'one reservation after replay');
select is((select count(*)::integer from public.trade_screenshots),0,'reservation is not attached evidence');
select throws_ok($$select private.application_file_write(jsonb_set(current_setting('files.request')::jsonb,'{sha256}',to_jsonb(repeat('b',64))), '{}')$$,'23505','Operation payload conflict.','changed reservation retry rejected');
select set_config('files.chunk',jsonb_build_object('action','CHUNK','operationId','00000000-0000-4000-8000-000000000002','uploadId',current_setting('files.id'),'expectedVersion','1','chunkIndex',0,'byteLength',3,'sha256',repeat('b',64))::text,true);
select throws_ok($$select private.application_file_write(current_setting('files.chunk')::jsonb,'{}')$$,'23514','Stored chunk facts conflict.','missing physical chunk cannot commit');
select is((select count(*)::integer from private.file_upload_chunks),0,'failed chunk leaves no manifest effect');
select set_config('files.chunk.path',private.application_file_prepare(current_setting('files.chunk')::jsonb)->>'storagePath',true);
insert into storage.objects(bucket_id,name,metadata,user_metadata) values('trade-file-staging',current_setting('files.chunk.path'),'{"size":3,"mimetype":"application/octet-stream"}',jsonb_build_object('tradeOsSha256',repeat('b',64)));
select set_config('files.chunk.result',private.application_file_write(current_setting('files.chunk')::jsonb,'{}')::text,true);
select is(current_setting('files.chunk.result')::jsonb->'upload'->>'version','2','recorded chunk advances upload version');
select is(private.application_file_write(current_setting('files.chunk')::jsonb,'{}'),current_setting('files.chunk.result')::jsonb,'old-version exact chunk replay recovers receipt');
select is((select count(*)::integer from private.file_upload_chunks),1,'one chunk after replay');
select throws_ok($$update private.file_upload_chunks set sha256=repeat('c',64)$$,'42501','Integration audit events are append-only.','chunk facts are immutable');
select set_config('files.finish',jsonb_build_object('action','FINISH','operationId','00000000-0000-4000-8000-000000000003','uploadId',current_setting('files.id'),'expectedVersion','2','expectedTradeVersion','1')::text,true);
select throws_ok($$select private.application_file_write(current_setting('files.finish')::jsonb,'{}')$$,'23514','Verified file facts conflict.','unverified finalization rejected');
select set_config('files.original.path',private.application_file_prepare(current_setting('files.finish')::jsonb)->>'storagePath',true);
insert into storage.objects(bucket_id,name,metadata,user_metadata) values('trade-screenshots',current_setting('files.original.path'),'{"size":3,"mimetype":"image/png"}',jsonb_build_object('tradeOsSha256',repeat('a',64)));
select set_config('files.proof',jsonb_build_object('byteLength',3,'sha256',repeat('a',64),'contentType','image/png','width',1,'height',1)::text,true);
create function pg_temp.file_audit_failure() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure.' using errcode='23514';end;$$;
create trigger fixture_file_audit before insert on private.application_mutation_audits for each row execute function pg_temp.file_audit_failure();
select throws_ok($$select private.application_file_write(current_setting('files.finish')::jsonb,current_setting('files.proof')::jsonb)$$,'23514','Fixture audit failure.','audit failure aborts finalization');
drop trigger fixture_file_audit on private.application_mutation_audits;
select is((select count(*)::integer from public.trade_screenshots),0,'audit failure rolls back metadata');
select is((select record_version::text from private.application_trade_versions where trade_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),'1','audit failure rolls back trade version');
select is((select status from private.file_uploads),'PENDING','audit failure preserves resumable upload');
select is((select count(*)::integer from private.application_operations where operation_id='00000000-0000-4000-8000-000000000003'),0,'audit failure rolls back receipt');
select set_config('files.finish.result',private.application_file_write(current_setting('files.finish')::jsonb,current_setting('files.proof')::jsonb)::text,true);
select is(current_setting('files.finish.result')::jsonb->'upload'->>'status','COMPLETE','valid proof attaches canonical evidence');
select is(current_setting('files.finish.result')::jsonb->>'tradeVersion','2','attachment advances canonical concurrency version');
select is(private.application_file_write(current_setting('files.finish')::jsonb,'{}'),current_setting('files.finish.result')::jsonb,'committed finish replay does not require repeat byte proof');
select is((select count(*)::integer from public.trade_screenshots),1,'one attachment after replay');
select is(jsonb_array_length(private.application_file_read('{"action":"LIST","limit":1}')->'records'),1,'owned metadata lists successfully');
select is(private.application_file_read(jsonb_build_object('action','UPLOAD','uploadId',current_setting('files.id')))->>'status','COMPLETE','status does not confuse staging with completion');
set local role authenticated;
select is((select count(*)::integer from public.trade_screenshots),1,'ordinary browser retains own evidence reads');
update storage.objects set metadata='{}' where name=current_setting('files.original.path');
reset role;
select is((select metadata->>'mimetype' from storage.objects where name=current_setting('files.original.path')),'image/png','managed image cannot be overwritten through browser Storage');
set local role authenticated;
select throws_ok($$delete from public.trade_screenshots$$,'42501','Managed file evidence requires an approved application workflow.','browser cannot bypass managed evidence deletion boundary');
select throws_ok($$insert into public.trade_screenshots(user_id,trade_id,category,storage_path) values(auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AT_ENTRY',current_setting('files.original.path'))$$,
  '42501','Managed file evidence requires an approved application workflow.','browser cannot forge managed evidence metadata');
insert into public.trade_screenshots(id,user_id,trade_id,category,storage_path) values('99999999-9999-4999-8999-999999999999',auth.uid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','AT_ENTRY',auth.uid()::text||'/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/legacy.png');
select throws_ok($$update public.trade_screenshots set storage_path=current_setting('files.original.path') where id='99999999-9999-4999-8999-999999999999'$$,
  '42501','Managed file evidence requires an approved application workflow.','legacy metadata cannot be reassigned into managed evidence');
select throws_ok($$insert into storage.objects(bucket_id,name) values('trade-screenshots',auth.uid()::text||'/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/mcp/forged.png')$$,
  '42501','new row violates row-level security policy "managed_screenshot_no_insert" for table "objects"','browser cannot prepopulate managed originals');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd','role','authenticated','session_id','33333333-3333-4333-8333-333333333333','exp',extract(epoch from clock_timestamp())+3600)::text,true);
select throws_ok($$select private.application_file_read(jsonb_build_object('action','UPLOAD','uploadId',current_setting('files.id')))$$,'P0002','Upload not found.','another owner cannot inspect upload');
select is(jsonb_array_length(private.application_file_read('{"action":"LIST","limit":1}')->'records'),0,'another owner sees no metadata');
select set_config('request.jwt.claims',current_setting('files.browser'),true);
select throws_ok($$delete from private.application_mutation_audits$$,'42501','Integration audit events are append-only.','file audit evidence cannot be deleted');
select * from finish();
rollback;
