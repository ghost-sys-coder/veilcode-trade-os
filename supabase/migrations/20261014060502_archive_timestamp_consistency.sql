-- Archive writers choose the database wall-clock event time. The foundation
-- trigger previously replaced updated_at with transaction-start now(), which
-- could precede archived_at. Reuse the event time instead of sampling a second
-- clock. No historical rows, operation receipts or audit events are rewritten.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  -- Only these configuration tables have an archive field. Other existing
  -- callers retain the original transaction-time update convention.
  if tg_table_schema = 'public' and tg_table_name in
    ('strategies', 'setups', 'trading_rules', 'account_goals', 'tags', 'instruments') then
    if new.archived_at is not null then
      if new.archived_at is distinct from old.archived_at then
        new.updated_at := new.archived_at;
      else
        -- A later allowed edit must not move the record behind its archive or
        -- previous update, even within an older transaction.
        new.updated_at := greatest(new.updated_at, old.updated_at, new.archived_at);
      end if;
    end if;
  end if;
  return new;
end;
$$;
