# MT5 finance, monitoring and read-only onboarding verification

Date: 2026-10-05. Branch: `feature/mt5-sync`. This is an implementation
checkpoint, **not MT5 operational completion or the merge gate**. Hosted
Supabase, existing MT5 terminals and broker accounts were not modified.

## Delivered

- PostgreSQL numeric trading credits and sufficient fee-allocation precision;
  final normalized net is gross minus nonnegative costs plus nonnegative credits.
- Explicit connection/position/opening-deal/direction canonical identity.
  Netting episodes may reuse position/order IDs; legacy imports retain their
  existing uniqueness safeguards.
- Database protection against ordinary overwrites/deletion of synchronized
  execution facts. The future trusted publication workflow is not implemented.
- Account-bound demo mapping through verified browser/application services;
  no caller-supplied owner ID, passwords, live activation or broker orders.
- Private owner-only monitoring/source-page RPCs and API decimal-string
  account context. Ledger sums include all records, not the first API page.
- Audited, idempotent pause/resume with reasons, optimistic connection versions,
  grant/feature checks, consistent grant-operation-connection lock order and
  worker fencing. Unapproved onboarding cannot be activated by resume.
- Snapshot-consistent, paginated read-only preview with deterministic episode
  reconstruction, conservative manual-conflict detection, exact symbol mapping,
  missing-position/history review and a non-authoritative balance bridge.
- Distinct observed balance/equity, closed-PnL changes and open-trade recognized
  cash. Missing observations are unavailable, not zero. Preview never approves
  reconciliation, invents plans/reviews or creates adjustments.
- Desktop and mobile UI using the existing light/dark design tokens, recorded
  through Imprint in `ui-registry.md`. Success confirmations survive rerender.
- CSV financial/provenance columns now include trading credits and MT5 episode
  identifiers while preserving active-filter/all-matching-record export behavior.
- Local type regeneration and rollback-only pending-migration test iteration.

## Exact commands and results

| Command | Result |
| --- | --- |
| `npm test` | PASS: 306 tests in 24 files |
| `npm run test:db -- --pending-migrations` | PASS: 283 assertions; two pending schemas applied per-suite then rolled back |
| `npm run test:db` | PASS: 283 assertions in seven rollback-isolated suites after local application |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: optimized Next.js build; preview route included |
| `npm run test:mt5-python` | PASS: 167 tests, including native Windows DPAPI/process-containment checks |
| `npm run check:mt5-python` | PASS: Ruff checks |
| `npm run test:integration-browser` | PASS: 37 real local browser/provider/API/Python-upload checks |
| `npm run db:types -- --local` | PASS: 31 canonical table definitions, monetary types remain strings |
| `supabase db advisors --local --type security --level warn --fail-on error` | PASS: no issues found |
| `supabase db lint --local --schema public,private --level error --fail-on error` | PASS |
| `supabase migration list --local` | Local schema/history agree on all 26 migration versions |
| `supabase db pull mt5_schema_verification --local --schema public,private --yes` | Replayed all 26 migrations in a shadow database; `No schema changes found`. CLI exits 1 for this no-diff result; no extra migration was created. |

CLI `db query --local --file` rejected multi-statement files with SQLSTATE
42601 before applying them. Both already-tested migration files were instead
applied atomically with the existing PostgreSQL driver, using only privately
captured disposable local status, leaving history unchanged while iterating.
Local history was then recorded with `supabase migration repair
20261005133038 20261005133917 --local --status applied`; schema-pull verification
confirmed equality. Local PostgREST received a schema-cache reload notification.
No reset or hosted migration was used.

Browser verifier defects were fixed before counting the final run: CardTitle is
a div, not a heading; sidebar theme controls were keyboard-activated to avoid
the development overlay. Theme classes were explicitly asserted, not inferred
from screenshot filenames. Application confirmations were moved outside the
remounting forms. The final run had zero uncaught client runtime errors.

## Hand-calculated fixtures

| Fixture | Expected and verified |
| --- | --- |
| Gross 100, costs 3, credits 1 | Final net 98; WIN without partial exits |
| Complete positive partial-managed trade | PARTIAL_WIN; partial profitability alone does not finalize an open trade |
| Complete negative partial-managed trade | PARTIAL_LOSS |
| Gross 1, costs 2, credits 1 with partial exits | Exactly 0; BREAK_EVEN |
| Two costs of 0.005 | Sum before final rounding; USD net -0.01 |
| USD baseline 1000 plus closed gross 100 minus fees 5 | Proposed closed change 95; broker basis 1095 |
| Open partial gross 20 minus entry/exit fees 2 | Bridge cash 18; no finalized PnL/outcome or realized analytic contribution |
| Already-published closed net 95 | No duplicate ledger contribution on preview/replay |
| 1001 deposits of 0.01 | Full ledger change 10.01; no first-page truncation or binary drift |
| JPY precision 0 | Currency-normalized integer money; price/volume remain separate domains |

## Browser evidence and environment

Playwright 1.63.0, installed Chrome channel, disposable fresh profile; Windows,
Node 25.1.0, Python 3.13.2, Supabase CLI 2.95.4 and local PostgreSQL 17.6.
Exact installed Chrome version was not separately recorded. Existing OAuth
client/credential fixture checks still use real provider discovery, S256 exchange,
refresh and immediate application revocation; no AI-provider keys or calls.

Ignored local artifacts were inspected: `mt5-import-preview-dark.png`,
`mt5-import-preview-light.png`, `mt5-monitor-mobile-dark.png` under
`.artifacts/integration-tests`. Desktop viewport 1440×1000; mobile 390×844;
mobile has no page-level horizontal overflow. Tables retain internal scrolling.
Temporary UUID-owned browser/provider/credential fixtures were cleaned up.

## Review and remaining scope

Plan alignment: partial, explicitly disclosed. System integrity: owner-only,
private transactional controls and decimal boundaries verified. This increment
is not a production-readiness claim for the full integration.

Still required: transactional canonical publication and execution revision
audits; onboarding/baseline approval; persistent symbol/conflict and cash
classification decisions; worker local pending-upload reporting; shared final
publication/reconciliation services; dedicated terminal/runtime installation;
actual startup-task installation/invocation; focused real multi-account demo
interruption checks; hosted OAuth/deployment compatibility and final release
gates. MCP remains parked until the MT5 gate passes. The user deferred mandatory
48-hour waiting; extended soak has not run or passed.
