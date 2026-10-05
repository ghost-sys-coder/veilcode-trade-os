-- Match the existing account/shared-decimal precision contract (0..20).
-- Final classification is still normalized by the authoritative outcome trigger,
-- not by a fixed typmod which can erase a representable result first.
-- UPDATE OF trigger dependencies prevent PostgreSQL from changing this typmod.
-- Recreate the exact authoritative trigger inside the migration transaction.
drop trigger trades_normalize_validate_outcome on public.trades;
alter table public.trades
  alter column net_pnl type numeric,
  add constraint trades_final_net_pnl_finite check (
    net_pnl is null or net_pnl not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  );
create trigger trades_normalize_validate_outcome
before insert or update of status,outcome,net_pnl,account_id on public.trades
for each row execute function private.normalize_and_validate_trade_outcome();

create or replace function private.mt5_identity_valid(identity jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(identity) is distinct from 'object' or not identity ?& array['server','login','terminalInstallationId','currencyCode','currencyPrecision','accountKind','positionMode']
    or identity - array['server','login','terminalInstallationId','currencyCode','currencyPrecision','accountKind','positionMode'] <> '{}'::jsonb then return false; end if;
  return jsonb_typeof(identity->'server') = 'string' and length(btrim(identity->>'server')) between 1 and 255
    and identity->>'server' = btrim(identity->>'server')
    and jsonb_typeof(identity->'login') = 'string' and identity->>'login' ~ '^[1-9][0-9]{0,19}$'
    and (identity->>'login')::numeric <= 18446744073709551615
    and jsonb_typeof(identity->'terminalInstallationId') = 'string' and (identity->>'terminalInstallationId')::uuid is not null
    and jsonb_typeof(identity->'currencyCode') = 'string' and identity->>'currencyCode' ~ '^[A-Z]{3}$'
    and jsonb_typeof(identity->'currencyPrecision') = 'number' and identity->>'currencyPrecision' ~ '^(0|[1-9]|1[0-9]|20)$'
    and identity->>'accountKind' in ('DEMO','LIVE','CONTEST') and identity->>'positionMode' in ('HEDGING','NETTING');
exception when data_exception then return false;
end;
$$;
