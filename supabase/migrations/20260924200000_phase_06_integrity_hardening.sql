-- Harden configurable timezones and append-only custom goal progress.

create or replace function private.validate_prop_firm_config()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  configured_type public.account_type;
begin
  select account_type into configured_type
  from public.trading_accounts
  where id = new.account_id and user_id = new.user_id;

  if configured_type not in ('PROP_CHALLENGE', 'FUNDED') then
    raise exception 'Prop configuration is only valid for prop challenge or funded accounts.' using errcode = '23514';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.trading_day_timezone
  ) then
    raise exception 'Trading-day timezone must be a valid IANA timezone.' using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.protect_goal_progress_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Goal progress events are append-only.' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger account_goal_progress_events_append_only
before update or delete on public.account_goal_progress_events
for each row execute function private.protect_goal_progress_events();
