-- Preserve legacy timestamp/ID ordering on backfill. Future events have a
-- durable append order independent of transaction start time or clock ties.
create sequence private.trade_plan_correction_sequence;
revoke all on sequence private.trade_plan_correction_sequence from public,anon,authenticated,service_role;
alter table public.trade_plan_corrections add column correction_sequence bigint;
with ordered as (select id,row_number() over(order by created_at,id) as position from public.trade_plan_corrections)
  update public.trade_plan_corrections c set correction_sequence=o.position from ordered o where c.id=o.id;
select setval('private.trade_plan_correction_sequence',greatest(coalesce(max(correction_sequence),0),1),coalesce(max(correction_sequence),0)>0) from public.trade_plan_corrections;
alter table public.trade_plan_corrections alter column correction_sequence set default nextval('private.trade_plan_correction_sequence'),
  alter column correction_sequence set not null;
create unique index trade_plan_correction_sequence_unique on public.trade_plan_corrections(correction_sequence);
create index trade_plan_corrections_trade_sequence on public.trade_plan_corrections(trade_id,correction_sequence);

-- The previous migration deliberately shares the read implementation. Change
-- just its fixed ordering clause; no user-provided SQL identifiers are used.
do $$declare definition text;begin
  definition:=pg_get_functiondef('private.application_trade_read(jsonb)'::regprocedure);
  if position('order by created_at,id' in definition)=0 then raise exception 'Expected aggregate ordering missing.'; end if;
  definition:=replace(definition,'order by created_at,id','order by %s');
  definition:=replace(definition,''',table_name)', ''',case when table_name=''trade_plan_corrections'' then ''correction_sequence'' else ''created_at,id'' end,table_name)');
  execute definition;
end;$$;
