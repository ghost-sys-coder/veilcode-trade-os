-- Standard reference instruments only. No broker alias is inferred or approved.
-- These price defaults are not terminal-specific contract/volume specifications.
-- Preserve every pre-existing shared or user-owned instrument unchanged.
insert into public.instruments
  (user_id, symbol, display_name, asset_class, base_currency, quote_currency, pip_size, price_precision, active)
values
  (null, 'AUDUSD', 'Australian Dollar / US Dollar', 'FOREX', 'AUD', 'USD', 0.0001, 5, true),
  (null, 'AUDJPY', 'Australian Dollar / Japanese Yen', 'FOREX', 'AUD', 'JPY', 0.01, 3, true),
  (null, 'EURAUD', 'Euro / Australian Dollar', 'FOREX', 'EUR', 'AUD', 0.0001, 5, true)
on conflict (symbol) where user_id is null do nothing;
