begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is((select count(*)::integer from public.instruments where user_id is null
  and symbol in ('AUDUSD','AUDJPY','EURAUD')),3,'three missing canonical reference instruments exist');
select is((select count(*)::integer from public.instruments where user_id is null
  and symbol in ('AUDUSD','AUDJPY','EURAUD') and active and asset_class='FOREX'),3,'new references are active forex instruments');
select is((select pip_size::text from public.instruments where user_id is null and symbol='AUDJPY'),
  '0.0100000000','JPY pip precision is independent of account money precision');
select is((select price_precision::integer from public.instruments where user_id is null and symbol='AUDUSD'),5,'AUDUSD price precision');
select is((select base_currency||'/'||quote_currency from public.instruments where user_id is null and symbol='EURAUD'),
  'EUR/AUD','EURAUD currency pair');

create temporary table original_catalog as select * from public.instruments;
insert into public.instruments(user_id,symbol,display_name,asset_class,base_currency,quote_currency,pip_size,price_precision,active)
values(null,'AUDUSD','Do not overwrite existing row','FOREX','AUD','USD',0.0001,5,true),
  (null,'AUDJPY','Do not overwrite existing row','FOREX','AUD','JPY',0.01,3,true),
  (null,'EURAUD','Do not overwrite existing row','FOREX','EUR','AUD',0.0001,5,true)
on conflict(symbol) where user_id is null do nothing;
select is((select count(*)::integer from (select * from public.instruments except select * from original_catalog) changed),
  0,'replaying catalog insertion preserves all existing values and timestamps');
select is((select count(*)::integer from (select * from original_catalog except select * from public.instruments) lost),
  0,'catalog insertion removes no instruments');
select ok((select relrowsecurity from pg_class where oid='public.instruments'::regclass),
  'existing instrument ownership RLS remains enabled');
select * from finish();
rollback;
