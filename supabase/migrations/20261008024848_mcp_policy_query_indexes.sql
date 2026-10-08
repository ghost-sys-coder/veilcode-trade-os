-- Stable owner-scoped keyset pages and private audit foreign-key lookups.
create index strategies_owner_cursor_idx on public.strategies(user_id,id);
create index setups_owner_cursor_idx on public.setups(user_id,id);
create index trading_rules_owner_cursor_idx on public.trading_rules(user_id,id);
create index application_operations_grant_idx on private.application_operations(grant_id);
create index application_audits_actor_idx on private.application_mutation_audits(actor_user_id,created_at,id);
create index application_audits_client_idx on private.application_mutation_audits(client_id);

-- No OAuth policy relaxation. The CLI's current auth_rls_initplan warning on
-- (select auth.jwt() ->> 'client_id') is a false positive: local EXPLAIN shows
-- an InitPlan result, not per-row JWT evaluation. Keep the existing isolation.
