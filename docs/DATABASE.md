# Database Direction

## Phase boundary

The database is built through ordered, additive migrations. Phase 01 establishes ownership, canonical trading records, private screenshots, and RLS. Phases 02-05 add trade workflows, journal support, classified adjustments, analytics, and immutable behavioral review evidence. Phase 06 adds configurable prop rules, snapshots, goals, and append-only progress/lifecycle history. Phase 07 adds import staging, canonical provenance, import integrity constraints, and advisor-driven foreign-key indexes.

## General conventions

- PostgreSQL UUID primary keys with database-generated defaults.
- `timestamptz` for instants, stored in UTC.
- User timezone stored as an IANA name and applied only at display/input boundaries.
- `numeric`, never floating-point or PostgreSQL `money`, for financial numeric data.
- Currency values returned by Supabase are handled as strings.
- `created_at` and `updated_at` on mutable records; append-only events use `created_at`.
- Foreign keys define explicit deletion behavior. Financial history is not casually cascade-deleted.
- Check constraints protect universally invalid states without rejecting legitimate future broker data.
- Index foreign keys, RLS ownership columns, lifecycle/status filters, and chronological query columns.

## Ownership and RLS

Every user-owned record carries `user_id` directly when that improves safe policy evaluation, or proves ownership through a short indexed relationship. Direct ownership is preferred for central records such as accounts and trades.

For each exposed table:

1. Enable RLS.
2. Revoke broad defaults and grant only required operations to `authenticated`.
3. Create operation-specific policies with an explicit `TO authenticated` clause.
4. Use `USING` for existing-row visibility and `WITH CHECK` for inserted/updated ownership.
5. Add a matching `SELECT` policy for update workflows.
6. Test allowed and denied operations for owner, non-owner, and unauthenticated roles.

Never authorize from `raw_user_meta_data`. Privileged functions belong in an unexposed private schema with a fixed empty `search_path` and narrow execute grants.

## Conceptual tables

### Identity and reference data

- `profiles`: authenticated user profile, display name, and timezone.
- `trading_accounts`: owner, account type/status, platform, ISO currency code, currency precision, starting balance, leverage, dates, and notes.
- `instruments`: symbol, asset class, base/quote currency where applicable, pip size, and price precision.
- `strategies` and `setups`: user-defined trading methodology and repeatable setups.
- `trading_rules`: global or account-specific descriptive/measurable rules.
- `tags` and `trade_tags`: user-managed labeling.

### Canonical trading record

- `trades`: identity, ownership, lifecycle, source, timestamps, context, thesis, immutable-after-open plan, actual execution, costs, final result, and optional excursion values.
- `trade_targets`: planned partial targets and their actual fills/contributions.
- `trade_management_events`: typed facts about what actually changed during execution, such as stop movement, scale-in, or scale-out. These are not plan corrections.
- `trade_plan_corrections`: append-only repairs to incorrectly recorded protected plan data.
- `trade_screenshots`: metadata and private Storage paths.
- `trade_reviews`, `trade_execution_reviews`, and `trade_psychology`: qualitative facts kept separate from financial outcome.
- `trade_rule_results`: per-trade compliance decisions for applicable rules.

### Logs, reviews, and account history

- `daily_logs`, `weekly_reviews`, and `monthly_reviews`: reflections and behavior review; calculated performance is derived rather than redundantly typed.
- `account_adjustments`: signed ledger events for deposits, withdrawals, balance corrections, and other non-trade changes.
- `account_snapshots`: optional manual balance/equity observations.
- `account_goals`: account-specific targets.
- `prop_firm_configs`: user-entered rules for challenge/funded accounts; no vendor rules are hardcoded.

### Import staging and provenance

- `import_batches`: non-manual source, owner/account, source reference, mapping configuration, lifecycle status, row counts, timestamps, and notes.
- `import_batch_rows`: appendable staging facts for original JSON, mapped canonical JSON, validation errors, row status, detected conflict, explicit conflict resolution, and resulting trade.
- Canonical `trades` retain source, batch, external trade/order/position IDs, and controlled raw payload where it materially supports audit or reprocessing.
- Composite foreign keys prevent a trade or staged row from crossing user, account, source, or batch boundaries.
- Unique partial indexes enforce strong external identities within account and source while allowing different providers to reuse identifiers.
- Import tables use operation-specific owner RLS; conflict replacement requires explicit confirmation and a reason.

## Monetary columns

Every trading account stores:

- `currency_code`: validated ISO 4217 code.
- `currency_precision`: explicit non-negative scale; never inferred as always two.
- `starting_balance`: positive fixed-precision numeric.

Money fields use an agreed high-capacity `numeric` declaration and are normalized according to the owning account at finalization boundaries. Price, percentage, R, exchange-rate, pip, and volume columns use separate numeric scales appropriate to their domain.

Costs (`commission`, `swap`, `other_fees`) use one documented sign convention: non-negative costs deducted from gross PnL. Any future rebate/credit needs an explicit representation rather than silently reversing that convention.

## Trade invariants

- `status` is independent from `outcome`.
- Outcome remains null unless status is `CLOSED`.
- Final normalized net PnL and outcome polarity must agree.
- `PARTIAL_WIN`/`PARTIAL_LOSS` require at least one recorded partial exit.
- A partially exited trade with normalized zero final net PnL is `BREAK_EVEN`.
- Open/close timestamps follow chronological order.
- Risk and volume fields that cannot logically be negative are constrained, while result fields may be negative.
- Strategy/setup ownership and relationship consistency are enforced.
- Planned and actual fields remain distinct.

Cross-table invariants that cannot be expressed safely as simple checks belong in transactional private functions and are covered by database tests.

## Planned-value correction model

`trades` stores current corrected values for fast ordinary reads. `trade_plan_corrections` contains, at minimum:

- `id`
- `trade_id`
- allowlisted `field_name`
- typed `previous_value`
- typed `new_value`
- required `reason`
- `actor_user_id`
- `created_at`

The value representation must preserve types. A controlled JSONB envelope with a database-validated type discriminator is acceptable when one column family cannot represent all protected fields; uncontrolled text is not.

Protected fields include planned entry, stop, take profit, lot size, risk amount, risk percentage, reward amount, risk-to-reward, planned partial targets, and original decision context (strategy, setup, thesis, entry reason, and confirmation notes) where implemented.

Normal update privileges/triggers reject protected-column changes once a trade has reached `OPEN`. A narrowly granted RPC performs corrections atomically:

1. Authenticate the caller and verify ownership.
2. Lock and verify the trade and its lifecycle eligibility.
3. Validate the field, typed values, and nonblank reason.
4. Assert the supplied previous value equals the current stored value.
5. Append the correction.
6. Update the current trade value.
7. Commit both or neither.

Correction rows are not deletable through application roles. Ordering uses `created_at` and a stable identifier. An erroneous correction is fixed by appending another event.

Actual trade management must use execution/management events and actual-value fields; it never mutates the historical plan through this correction mechanism.

## Balance and equity

Do not treat mutable `current_balance` as the ledger authority.

```text
derived balance = starting balance
                + sum(final net PnL of closed trades)
                + sum(account adjustments)
```

Adjustments are signed consistently: deposits increase balance, withdrawals decrease it, and a balance correction records an explicit signed delta with a reason. Optional snapshots record observed balance/equity but do not replace ledger reconstruction.

## Storage

The private `trade-screenshots` bucket restricts MIME types and file size. The `{user_id}/{trade_id}/{object_id}` path convention supports simple ownership policies. The database stores object paths and metadata. Storage objects are manipulated through the Storage API, not by directly editing the storage schema.

## Migration and verification policy

- Create migration files through the Supabase CLI rather than inventing timestamps.
- Keep grants, RLS, constraints, functions, and related indexes in reviewed migrations.
- Seed only clearly labeled development/reference data.
- Run database/RLS tests and Supabase advisors before accepting schema work.
- All migrations through Phase 07 are applied to the configured Supabase project and covered by `supabase/tests/phase_01_rls.test.sql` plus deterministic TypeScript tests.
- Regenerate `types/database.ts` from the live catalog with `npm run db:types`; do not maintain a hand-written subset of the schema.

## Current documentation references

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase server-side auth](https://supabase.com/docs/guides/auth/server-side)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
