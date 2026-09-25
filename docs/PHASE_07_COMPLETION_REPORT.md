# Phase 07 Completion Report

## 1. What was built

Phase 07 adds an account-scoped import staging architecture, deterministic import provenance and conflict rules, typed CSV parsing and mapping utilities, import history in Settings, final documentation, deterministic analytics fixtures, database assertions, and a complete product audit. Manual entry remains the only enabled trade-creation workflow; no broker or automated-execution integration was added.

The final acceptance record exercised a canonical trade from `PLANNED` through `OPEN` and `CLOSED`, including protected plan evidence, partial-target use, normalized fees and net PnL, execution/psychology/rule/post-trade reviews, daily and weekly journals, account balance updates, realized analytics, prop configuration, and filtered export behavior.

## 2. Architecture

- Next.js 16 App Router and React 19 provide server-rendered pages and validated server actions.
- Domain modules own Decimal.js arithmetic, outcome rules, journal periods, analytics, import parsing, provenance, and conflict handling.
- Service modules perform account-scoped Supabase reads and assemble view datasets.
- PostgreSQL remains the authoritative persistence layer; `numeric` values cross the API boundary as strings.
- Supabase Auth, row-level security, private Storage, and transactional RPCs enforce ownership and protected mutations.
- Canonical trades are shared by manual entry and all future import adapters.

## 3. Database tables

The schema includes `profiles`, `trading_accounts`, `account_adjustments`, `account_adjustment_classifications`, `account_snapshots`, `account_status_events`, `account_goals`, `account_goal_progress_events`, `instruments`, `strategies`, `setups`, `trading_rules`, `trades`, `trade_targets`, `trade_management_events`, `trade_plan_corrections`, `trade_execution_reviews`, `trade_psychology`, `trade_rule_reviews`, `trade_rule_review_items`, `trade_rule_results`, `trade_reviews`, `trade_screenshots`, `tags`, `trade_tags`, `daily_logs`, `weekly_reviews`, `monthly_reviews`, `prop_firm_configs`, `import_batches`, and `import_batch_rows`.

Phase 07 extends canonical trades and import batches with provenance/count fields, adds typed row staging and conflict states, and adds supporting foreign-key indexes identified during the database advisor audit.

## 4. RLS policies

All user-accessible tables are protected by ownership-aware RLS. Import batches require ownership of both the batch and selected account; import rows inherit ownership from their parent batch. Canonical trade relations validate ownership through the trade/account relationship. Private screenshot metadata and Storage paths remain user scoped. The transactional database suite includes cross-user denial, parent ownership, insert/update, and referential-integrity assertions.

## 5. Pages and routes

Verified capabilities are available at `/dashboard`, `/accounts`, `/accounts/[id]`, `/trades`, `/trades/new`, `/trades/[id]`, `/trades/[id]/edit`, `/trades/export`, `/calendar`, `/analytics`, `/analytics/[view]` (overview, instruments, strategies, setups, sessions, risk, time, execution, rules, psychology, and mistakes), `/journal/daily`, `/journal/weekly`, `/journal/monthly`, `/rules`, `/strategies`, `/setups`, `/goals`, `/prop`, and `/settings`.

`/setups` intentionally redirects to the unified strategy/setup management surface.

## 6. Financial metrics implemented

Implemented metrics include authoritative balance, optional equity snapshots, normalized gross/net PnL, fees, actual R, win rate excluding break-even trades, break-even rate, profit factor, currency expectancy, R expectancy with qualifying sample size, average winner/loser, average PnL, cash-flow-neutral drawdown, return, balance and cumulative-R curves, risk distributions, and currency-separated multi-account totals.

The deterministic seven-trade fixture verifies gross profit `4753.39`, gross loss `759.59`, net profit `3993.80`, five wins, two losses, win rate `5/7`, profit factor approximately `6.2578`, average winner `950.678`, average loss magnitude `379.795`, and average PnL approximately `570.542857`.

## 7. Trade-entry workflow

The workflow supports draft/planned/open/closed/canceled states, planned and actual execution fields, partial targets, fees, normalized outcome classification, actual R, management events, and explicit reviews. After `OPEN`, protected planned fields can only change through the append-only correction RPC with a reason; actual trade management does not rewrite original plan evidence.

The acceptance trade closed as `PARTIAL_WIN` with normalized net PnL `USD 450.00`, actual R `1.8R`, grade `A`, and immutable `FULLY_COMPLIANT` rule-review evidence. The account balance changed from `USD 100,000.00` to `USD 100,450.00`.

## 8. Screenshot workflow

The application exposes before-entry, at-entry, and exit screenshot controls backed by the private `trade-screenshots` bucket. File type/size validation, user/trade object paths, private metadata rows, RLS policies, and authenticated/signed access are preserved.

The browser automation sandbox allowed the upload controls and chooser to be exercised but refused local-file attachment before transfer. No unsafe bypass was used. Storage authorization is covered by the database suite and the rendered workflow was inspected; a human smoke test of the three binary uploads remains a recommended deployment check.

## 9. Analytics

Realized analytics use final `closed_at`; open trades contribute no realized results. Instrument, strategy, setup, session, risk, time, calendar, dashboard, and account views all updated from the same closed validation trade. Mixed-currency selections keep monetary metrics separated and aggregate unitless metrics from underlying trades.

## 10. Behavioral analytics

Execution, psychology, rules, and mistakes analytics include only explicitly completed reviews. Placeholder rows and unanswered booleans are excluded. Rule completeness uses the immutable applicable-rule snapshot. Mistake and psychology comparisons are descriptive associations with sample sizes and make no causal or diagnostic claims.

## 11. Prop tracking

A dedicated `PROP_CHALLENGE` acceptance account was configured with a user-defined 10% target and five minimum trading days. The UI correctly reported `USD 0.00 of 10,000.00`, `0.00%`, and `USD 10,000.00` remaining. Prop rules, equity snapshots, loss buffers, trading-day evidence, consistency rules, and append-only status history remain user configured rather than firm hardcoded.

## 12. Import architecture

The import foundation supports account-scoped batch history, per-row validation state, source metadata, external trade/order/position identifiers, raw source payloads, deterministic strong-ID deduplication, explicit conflicts, and canonical-trade linkage. CSV utilities parse quoted input, validate column mappings, reject malformed monetary/date/direction data, and preserve row-level errors.

There is intentionally no commit/import button yet. A provider-specific CSV sample must be reviewed before enabling a mapping-and-commit workflow, and manual review data can never be silently overwritten.

## 13. Tests created

- Decimal, monetary normalization, fee, balance, PnL, outcome, analytics, drawdown, journal, prop, and behavioral unit tests.
- Phase 07 CSV parsing/mapping/provenance/deduplication tests.
- Deterministic seven-trade, drawdown, actual-R, and rule-compliance fixtures.
- A 100-assertion transactional PostgreSQL/RLS suite, including Phase 07 import ownership and integrity cases.
- Browser smoke and exact workflow acceptance across core pages and both themes.

## 14. Test results

- Vitest: 9 test files passed; 76 tests passed.
- PostgreSQL/RLS integration suite: `ok 100` through the connected Supabase SQL channel.
- Supabase performance advisor: no missing foreign-key-index warnings after the Phase 07 index migration; remaining unused-index notices reflect the low-traffic validation dataset.
- Browser acceptance: trade, journals, account ledger, calendar, dashboard, detailed analytics, immutable rule evidence, prop target, and filtered-export query propagation passed.

## 15. Typecheck result

`npm run typecheck` passed with no TypeScript errors.

## 16. Lint result

`npm run lint` passed with no ESLint errors or warnings.

## 17. Build result

`npm run build` passed on Next.js `16.3.6` with all application routes compiled and 22 static/dynamic route entries generated successfully.

## 18. Environment variables

Required browser-safe variables are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`), and `NEXT_PUBLIC_SITE_URL`. Server/tooling variables are `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DIRECT_CONNECTION_URL`, `TRADE_OS_TEST_DATABASE_URL`, and `TRADE_OS_DATABASE_URL`. Secret values must never use the `NEXT_PUBLIC_` prefix or be committed.

## 19. Known limitations

- No signal generation, automated execution, live broker connection, or MT4/MT5 terminal bridge.
- CSV commit remains disabled until a real provider export is mapped and verified.
- Equity/unrealized PnL is manual snapshot data; balance is authoritative.
- Monetary aggregation across currencies requires an explicit future FX conversion layer.
- Supabase leaked-password protection is a project Auth setting that must be enabled separately where supported.
- The local machine could not resolve the direct database hostname for `npm run test:db`; the same SQL suite passed through the connected Supabase SQL channel.
- The automation browser suppressed local upload/download file transfer. The export link now uses explicit download semantics; storage/export logic and authorization were verified independently, and human file-transfer smoke tests remain part of deployment acceptance.

## 20. Future MT5 integration requirements

An MT5 adapter must authenticate without exposing terminal credentials to the browser, translate provider records into staged import rows, retain ticket/order/position IDs and raw payloads, normalize timestamps and account currency, use strong-ID deduplication, surface conflicts for review, preserve manual evidence, support idempotent retries, and promote accepted rows into canonical trades transactionally. It must not place or modify trades unless a future phase explicitly authorizes automated execution.

## 21. Exact local commands

```powershell
npm install
Copy-Item .env.example .env.local
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:db
npm run build
npm start
```

## 22. Exact deployment requirements

1. Create the Vercel project from this repository.
2. Configure browser-safe and server-only environment variables for each environment.
3. Set `NEXT_PUBLIC_SITE_URL` to the production HTTPS origin.
4. Allow that origin and `/auth/callback` in Supabase Auth redirects.
5. Apply all ordered migrations to the intended Supabase project.
6. Confirm the private `trade-screenshots` bucket and its RLS policies.
7. Enable leaked-password protection in Supabase Auth where supported.
8. Run typecheck, lint, unit tests, transactional database tests, and the production build in CI.
9. Perform the signed-in trade, screenshot upload/download, filtered CSV download, analytics, journal, and prop smoke tests against production.

READY_FOR_MANUAL_TRADING_PRACTICE
