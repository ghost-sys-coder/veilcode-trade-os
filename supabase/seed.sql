-- Global instrument reference data is inserted idempotently by the Phase 01 migration.
-- Each authenticated user receives the editable 100K demo account, example strategies,
-- and inactive example rules through private.handle_new_user() at signup time.
-- No fake trade results are seeded.

do $$
begin
  raise notice 'Trade OS reference seed is managed by the Phase 01 migration and signup trigger.';
end;
$$;
