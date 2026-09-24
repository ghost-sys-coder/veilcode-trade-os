-- Phase 05 reviewed behavioral evidence and immutable rule-review snapshots.

alter table public.trade_execution_reviews
  add column reviewed_at timestamptz,
  alter column closed_early drop not null,
  alter column closed_early drop default,
  alter column entered_early drop not null,
  alter column entered_early drop default,
  alter column entered_late drop not null,
  alter column entered_late drop default,
  alter column chased_price drop not null,
  alter column chased_price drop default,
  alter column added_to_position drop not null,
  alter column added_to_position drop default,
  alter column revenge_trade drop not null,
  alter column revenge_trade drop default,
  alter column over_risked drop not null,
  alter column over_risked drop default;

alter table public.trade_execution_reviews
  add constraint trade_execution_reviews_completion_requires_answers check (
    reviewed_at is null or (
      entry_according_to_plan is not null and
      stop_according_to_plan is not null and
      target_according_to_plan is not null and
      stop_action is not null and
      closed_early is not null and
      entered_early is not null and
      entered_late is not null and
      chased_price is not null and
      added_to_position is not null and
      revenge_trade is not null and
      over_risked is not null
    )
  );

alter table public.trade_psychology
  add column reviewed_at timestamptz,
  alter column fear_influenced drop not null,
  alter column fear_influenced drop default,
  alter column greed_influenced drop not null,
  alter column greed_influenced drop default,
  alter column fomo_influenced drop not null,
  alter column fomo_influenced drop default;

alter table public.trade_psychology
  add constraint trade_psychology_completion_requires_answers check (
    reviewed_at is null or (
      fear_influenced is not null and
      greed_influenced is not null and
      fomo_influenced is not null
    )
  );

create table public.trade_rule_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_id uuid not null,
  reviewed_at timestamptz not null default now(),
  applicable_rule_count integer not null,
  created_at timestamptz not null default now(),
  constraint trade_rule_reviews_trade_owner_fk foreign key (trade_id, user_id)
    references public.trades(id, user_id) on delete cascade,
  constraint trade_rule_reviews_one_per_trade unique (trade_id),
  constraint trade_rule_reviews_id_owner_unique unique (id, user_id),
  constraint trade_rule_reviews_count_nonnegative check (applicable_rule_count >= 0)
);

create table public.trade_rule_review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id uuid not null,
  rule_id_snapshot uuid not null,
  rule_name text not null,
  rule_description text not null,
  rule_type public.rule_type not null,
  numeric_limit numeric(24, 8),
  account_id_snapshot uuid,
  complied boolean not null,
  notes text,
  display_order integer not null,
  created_at timestamptz not null default now(),
  constraint trade_rule_review_items_review_owner_fk foreign key (review_id, user_id)
    references public.trade_rule_reviews(id, user_id) on delete cascade,
  constraint trade_rule_review_items_name_not_blank check (length(btrim(rule_name)) > 0),
  constraint trade_rule_review_items_description_not_blank check (length(btrim(rule_description)) > 0),
  constraint trade_rule_review_items_order_nonnegative check (display_order >= 0),
  constraint trade_rule_review_items_one_per_rule unique (review_id, rule_id_snapshot),
  constraint trade_rule_review_items_one_per_order unique (review_id, display_order)
);

create index trade_execution_reviews_user_reviewed_idx
  on public.trade_execution_reviews(user_id, reviewed_at)
  where reviewed_at is not null;
create index trade_psychology_user_reviewed_idx
  on public.trade_psychology(user_id, reviewed_at)
  where reviewed_at is not null;
create index trade_rule_reviews_user_reviewed_idx
  on public.trade_rule_reviews(user_id, reviewed_at);
create index trade_rule_review_items_review_idx
  on public.trade_rule_review_items(review_id, display_order);
create index trade_rule_review_items_rule_snapshot_idx
  on public.trade_rule_review_items(user_id, rule_id_snapshot);

alter table public.trade_rule_reviews enable row level security;
alter table public.trade_rule_review_items enable row level security;

create policy trade_rule_reviews_select_own
on public.trade_rule_reviews
for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy trade_rule_review_items_select_own
on public.trade_rule_review_items
for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

revoke all on table public.trade_rule_reviews from anon, authenticated;
revoke all on table public.trade_rule_review_items from anon, authenticated;
grant select on table public.trade_rule_reviews to authenticated;
grant select on table public.trade_rule_review_items to authenticated;

create or replace function private.validate_behavior_review_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trade_status public.trade_status;
begin
  if tg_op = 'UPDATE' and old.reviewed_at is not null then
    new.reviewed_at := old.reviewed_at;
  end if;

  if new.reviewed_at is null then
    return new;
  end if;

  select status into trade_status
  from public.trades
  where id = new.trade_id and user_id = new.user_id;

  if trade_status is distinct from 'CLOSED'::public.trade_status then
    raise exception 'Behavior reviews can only be completed for closed trades.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trade_execution_reviews_validate_completion
before insert or update on public.trade_execution_reviews
for each row execute function private.validate_behavior_review_completion();

create trigger trade_psychology_validate_completion
before insert or update on public.trade_psychology
for each row execute function private.validate_behavior_review_completion();

create or replace function private.complete_trade_rule_review(
  p_trade_id uuid,
  p_results jsonb
)
returns public.trade_rule_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_trade public.trades;
  completed_review public.trade_rule_reviews;
  applicable_count integer;
  submitted_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Rule review results must be a JSON array.' using errcode = '22023';
  end if;

  select * into target_trade
  from public.trades
  where id = p_trade_id and user_id = actor_id
  for update;

  if not found then
    raise exception 'Trade not found.' using errcode = 'P0002';
  end if;

  if target_trade.status <> 'CLOSED' then
    raise exception 'Rule reviews can only be completed for closed trades.' using errcode = '23514';
  end if;

  if exists (select 1 from public.trade_rule_reviews where trade_id = p_trade_id) then
    raise exception 'The rule review is already complete and its snapshot is immutable.' using errcode = '23505';
  end if;

  with submitted as (
    select
      item.value ->> 'trading_rule_id' as rule_id,
      item.value -> 'complied' as complied_value
    from jsonb_array_elements(p_results) as item(value)
  )
  select count(*)::integer into submitted_count from submitted;

  if exists (
    select 1
    from jsonb_array_elements(p_results) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or item.value ->> 'trading_rule_id' is null
      or jsonb_typeof(item.value -> 'complied') is distinct from 'boolean'
  ) then
    raise exception 'Every applicable rule requires an explicit followed or broken result.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select item.value ->> 'trading_rule_id' as rule_id, count(*)
      from jsonb_array_elements(p_results) as item(value)
      group by item.value ->> 'trading_rule_id'
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'A rule may appear only once in a completed review.' using errcode = '22023';
  end if;

  select count(*)::integer into applicable_count
  from public.trading_rules
  where user_id = actor_id
    and active
    and (account_id is null or account_id = target_trade.account_id);

  if submitted_count <> applicable_count or exists (
    select 1
    from public.trading_rules rule
    where rule.user_id = actor_id
      and rule.active
      and (rule.account_id is null or rule.account_id = target_trade.account_id)
      and not exists (
        select 1
        from jsonb_array_elements(p_results) as item(value)
        where item.value ->> 'trading_rule_id' = rule.id::text
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_results) as item(value)
    where not exists (
      select 1
      from public.trading_rules rule
      where rule.id::text = item.value ->> 'trading_rule_id'
        and rule.user_id = actor_id
        and rule.active
        and (rule.account_id is null or rule.account_id = target_trade.account_id)
    )
  ) then
    raise exception 'Completed review must cover the exact applicable rule set.' using errcode = '22023';
  end if;

  insert into public.trade_rule_reviews (user_id, trade_id, applicable_rule_count)
  values (actor_id, p_trade_id, applicable_count)
  returning * into completed_review;

  insert into public.trade_rule_review_items (
    user_id,
    review_id,
    rule_id_snapshot,
    rule_name,
    rule_description,
    rule_type,
    numeric_limit,
    account_id_snapshot,
    complied,
    notes,
    display_order
  )
  select
    actor_id,
    completed_review.id,
    rule.id,
    rule.name,
    rule.description,
    rule.rule_type,
    rule.numeric_limit,
    rule.account_id,
    (item.value ->> 'complied')::boolean,
    nullif(btrim(item.value ->> 'notes'), ''),
    row_number() over (order by lower(rule.name), rule.id)::integer - 1
  from public.trading_rules rule
  join lateral (
    select value
    from jsonb_array_elements(p_results)
    where value ->> 'trading_rule_id' = rule.id::text
  ) item on true
  where rule.user_id = actor_id
    and rule.active
    and (rule.account_id is null or rule.account_id = target_trade.account_id);

  if (select count(*) from public.trade_rule_review_items where review_id = completed_review.id)
      <> completed_review.applicable_rule_count then
    raise exception 'Rule review snapshot could not be completed atomically.' using errcode = '23514';
  end if;

  return completed_review;
end;
$$;

revoke all on function private.complete_trade_rule_review(uuid, jsonb) from public, anon;
grant execute on function private.complete_trade_rule_review(uuid, jsonb) to authenticated;

create or replace function public.complete_trade_rule_review(
  p_trade_id uuid,
  p_results jsonb
)
returns public.trade_rule_reviews
language sql
security invoker
set search_path = ''
as $$
  select private.complete_trade_rule_review(p_trade_id, p_results);
$$;

revoke all on function public.complete_trade_rule_review(uuid, jsonb) from public, anon;
grant execute on function public.complete_trade_rule_review(uuid, jsonb) to authenticated;
