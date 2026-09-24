-- Preserve the first explicit completion timestamp on execution and psychology reviews.

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
