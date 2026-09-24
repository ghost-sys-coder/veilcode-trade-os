-- Phase 04 account-adjustment performance classification and audit history.

alter table public.account_adjustments
  add column is_performance_neutral boolean,
  add column classification_reason text,
  add column classified_at timestamptz,
  add column classified_by_user_id uuid references auth.users(id);

update public.account_adjustments
set
  is_performance_neutral = true,
  classification_reason = 'Fixed by adjustment type.',
  classified_at = created_at,
  classified_by_user_id = user_id
where type in ('DEPOSIT', 'WITHDRAWAL', 'BALANCE_CORRECTION');

alter table public.account_adjustments
  add constraint account_adjustments_fixed_types_neutral check (
    type = 'OTHER' or is_performance_neutral is true
  ),
  add constraint account_adjustments_classification_reason check (
    classification_reason is null or length(btrim(classification_reason)) >= 5
  ),
  add constraint account_adjustments_classification_metadata check (
    (
      is_performance_neutral is null and
      classification_reason is null and
      classified_at is null and
      classified_by_user_id is null
    ) or (
      is_performance_neutral is not null and
      classification_reason is not null and
      classified_at is not null and
      classified_by_user_id = user_id
    )
  );

create table public.account_adjustment_classifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  adjustment_id uuid not null references public.account_adjustments(id) on delete cascade,
  previous_is_performance_neutral boolean,
  new_is_performance_neutral boolean not null,
  reason text not null,
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint account_adjustment_classifications_reason check (length(btrim(reason)) >= 5),
  constraint account_adjustment_classifications_actor_owner check (actor_user_id = user_id)
);

create index account_adjustment_classifications_adjustment_created_idx
  on public.account_adjustment_classifications(adjustment_id, created_at, id);

alter table public.account_adjustment_classifications enable row level security;

create policy account_adjustment_classifications_select_own
on public.account_adjustment_classifications
for select
to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

revoke all on table public.account_adjustment_classifications from anon, authenticated;
grant select on table public.account_adjustment_classifications to authenticated;

create or replace function private.prepare_account_adjustment_classification()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if new.type in ('DEPOSIT', 'WITHDRAWAL', 'BALANCE_CORRECTION') then
    new.is_performance_neutral := true;
    new.classification_reason := 'Fixed by adjustment type.';
    new.classified_at := coalesce(new.classified_at, now());
    new.classified_by_user_id := new.user_id;
    return new;
  end if;

  if new.is_performance_neutral is null then
    raise exception 'OTHER adjustments require an explicit performance classification.' using errcode = '23514';
  end if;

  if new.classification_reason is null or length(btrim(new.classification_reason)) < 5 then
    raise exception 'A meaningful adjustment classification reason is required.' using errcode = '23514';
  end if;

  if actor_id is not null and actor_id <> new.user_id then
    raise exception 'Adjustment classification actor does not own the adjustment.' using errcode = '42501';
  end if;

  new.classification_reason := btrim(new.classification_reason);
  new.classified_at := coalesce(new.classified_at, now());
  new.classified_by_user_id := new.user_id;
  return new;
end;
$$;

create trigger account_adjustments_prepare_classification
before insert on public.account_adjustments
for each row execute function private.prepare_account_adjustment_classification();

create or replace function private.protect_account_adjustment_classification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.type is distinct from old.type or
    new.is_performance_neutral is distinct from old.is_performance_neutral or
    new.classification_reason is distinct from old.classification_reason or
    new.classified_at is distinct from old.classified_at or
    new.classified_by_user_id is distinct from old.classified_by_user_id
  ) and coalesce(current_setting('trade_os.adjustment_classification_workflow', true), '') <> 'on' then
    raise exception 'Adjustment classification changes require the approved workflow.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger account_adjustments_protect_classification
before update on public.account_adjustments
for each row execute function private.protect_account_adjustment_classification();

create or replace function private.audit_account_adjustment_classification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_performance_neutral is distinct from old.is_performance_neutral then
    insert into public.account_adjustment_classifications (
      user_id,
      adjustment_id,
      previous_is_performance_neutral,
      new_is_performance_neutral,
      reason,
      actor_user_id
    ) values (
      new.user_id,
      new.id,
      old.is_performance_neutral,
      new.is_performance_neutral,
      new.classification_reason,
      new.classified_by_user_id
    );
  end if;

  return new;
end;
$$;

create trigger account_adjustments_audit_classification
after update on public.account_adjustments
for each row execute function private.audit_account_adjustment_classification();

create or replace function public.classify_account_adjustment(
  p_adjustment_id uuid,
  p_is_performance_neutral boolean,
  p_reason text
)
returns public.account_adjustments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  adjustment public.account_adjustments;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_is_performance_neutral is null then
    raise exception 'A performance classification is required.' using errcode = '22023';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'A meaningful classification reason is required.' using errcode = '22023';
  end if;

  select * into adjustment
  from public.account_adjustments
  where id = p_adjustment_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Account adjustment not found.' using errcode = 'P0002';
  end if;

  if adjustment.type <> 'OTHER' then
    raise exception 'Fixed adjustment types are always performance-neutral.' using errcode = '22023';
  end if;

  if adjustment.is_performance_neutral is not distinct from p_is_performance_neutral then
    raise exception 'The adjustment already has that performance classification.' using errcode = '22023';
  end if;

  perform set_config('trade_os.adjustment_classification_workflow', 'on', true);

  update public.account_adjustments
  set
    is_performance_neutral = p_is_performance_neutral,
    classification_reason = btrim(p_reason),
    classified_at = now(),
    classified_by_user_id = actor_id
  where id = p_adjustment_id and user_id = actor_id
  returning * into adjustment;

  return adjustment;
end;
$$;

revoke all on function public.classify_account_adjustment(uuid, boolean, text) from public, anon;
grant execute on function public.classify_account_adjustment(uuid, boolean, text) to authenticated;

create index account_adjustments_user_occurred_idx
  on public.account_adjustments(user_id, occurred_at, id);

create index account_adjustments_unclassified_other_idx
  on public.account_adjustments(user_id, account_id, occurred_at)
  where type = 'OTHER' and is_performance_neutral is null;
