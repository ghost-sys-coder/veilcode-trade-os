# MT5 selected canonical publication verification

Date: 2026-10-05. Branch: `feature/mt5-sync`.
This verifies an implementation increment, **not completion of the MT5 or MCP build**.

## Implemented boundary

- Browser approval selects eligible directional episodes, acknowledges the existing
  positive opening baseline and supplies a meaningful reason and durable operation ID.
  It submits no calculated financial facts or arbitrary owner IDs.
- Verified browser context is runtime-branded; signed claims and live provider user
  identity must agree. The private database transaction also checks the live non-OAuth
  session, owner, bound active account grant, resource enablement and demo identity.
- Central TypeScript reconstruction reads durable validated source revisions. The
  private invoker publisher is inaccessible to browser/collector database roles.
  Only fixed parameterized calls from the server-only PostgreSQL adapter are allowed.
- Publication locks the connection, account and existing ledger rows, verifies source
  and ledger fingerprints, then commits canonical execution, import batch, immutable
  execution/source attribution, approval, audit and operation receipt together.
  Identical retries return the original receipt; changed retry payloads are rejected.
- OPEN and CLOSED observations update the same canonical identity. Unchanged facts
  do not create extra execution versions. Broker market prices/volume retain numeric
  precision independent of account currency. Planned values and reviews remain untouched.
- Publication of a frozen PAUSED snapshot does not resume its collector. Unresolved
  groups remain staged. Selection approval never sets `onboarding_approved_at`, marks
  reconciliation approved or authorizes unattended imports.
- Journal monetary display now uses shared account-precision normalization; exported
  raw canonical numeric strings remain unchanged.

Database transport: existing `SUPABASE_DIRECT_CONNECTION_URL` for deployment, with
TLS certificate verification and bounded timeouts. No browser secret exposure.
The isolated local app explicitly receives `TRADE_OS_LOCAL_DATABASE_URL`; missing
local configuration fails closed instead of falling back to hosted `.env` credentials.

## Hand-calculated fixtures

| Fixture | Calculation | Verified result |
| --- | --- | --- |
| Partial exit before closure | Opening commission -2; partial gross +20, commission -1, swap credit +1 | Broker cash +18; canonical trade OPEN, net PnL/outcome/R null |
| Complete partially managed trade | Gross 20 + 80; costs 2 + 1; credit 1 | `100 - 3 + 1 = 98`, `PARTIAL_WIN`, one canonical trade, two recoverable execution versions |
| Actual browser final closure | Gross 100; opening commission 2; closing commission 3 | `95.00` USD, `WIN`; same ID as preceding OPEN record |
| Browser balance bridge | Preserved baseline 1000 + closed result 95 + three other open-trade fees (-2 each) | Canonical ledger 1095; observed broker basis 1089; difference 0, still NOT_APPROVED |
| Separate price precision | Source market price with 18 fractional places | Preserved exactly, not rounded to money precision |
| Journal currency display | USD precision 2 / JPY 0 / KWD 3 | Account-specific normalization; OPEN null stays null; exact zero stays zero |

## Exact verification commands and results

All tests used disposable local Docker/Supabase or fixtures. No hosted user data,
broker orders, terminal configuration or production migrations were changed.

| Command | Result |
| --- | --- |
| `npm test` | PASS: 345 tests, 28 files |
| `npm run test:db` | PASS: 336 assertions, 8 rollback-isolated suites |
| `npm run test:db -- --suite=mt5_publication.test.sql` | PASS: all 53 publication assertions |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: production Next.js build |
| `npm run check:mt5-python` | PASS: static checks |
| `npm run test:mt5-python` | PASS: 167 tests, 27.761 seconds |
| `npm run test:integration-browser` | PASS: 40 actual local provider/browser/API checks; disposable fixtures cleaned |
| `supabase db lint --local --schema public,private --level error` | PASS: no function errors |
| `supabase db pull mt5_publication_verify --local --schema public,private` | All 27 migrations replayed in shadow DB; “No schema changes found.” CLI exited 1 for the no-diff result, not recorded as exit-0 success |
| `git diff --check` | PASS |

Database suite counts: grants 26; OAuth isolation 26; capture 37; collections 39;
finance 27; monitoring 28; publication 53; original regression/RLS 100.

Runtime versions: Node 25.1.0; npm 11.6.2; Python 3.13.2; Next.js 16.3.6;
Supabase CLI 2.95.4; Playwright 1.63.0; actual Chrome 154.0.8037.93.
Screenshots under ignored `.artifacts/integration-tests/` cover publication dark,
light and 390px-wide light layouts; no document-level horizontal overflow.
No uncaught browser runtime errors. A pre-existing `MODULE_TYPELESS_PACKAGE_JSON`
script warning remains nonfatal. CLI telemetry timeouts are not database failures.
An unnecessary `npx supabase --version` failed fetching npm under sandbox restrictions;
the installed `supabase --version` provided the recorded CLI version instead.

## Review

### Layer 1 — Plan alignment: increment PASS; full integration ISSUES FOUND

This increment implements the planned source-backed canonical publication and
financial/audit contracts without broker execution or invented plans.
Critical remaining scope: automatic approved synchronization, complete onboarding
approval, cash classification/baseline attribution, conflict/source-review resolution,
and actual dedicated-terminal multi-account pilot. MCP remains parked as specified.

### Layer 2 — System integrity: PASS for this increment

Components contain presentation/form submission only; services authorize and coordinate;
domain utilities calculate finance; PostgreSQL enforces ownership, concurrency and
atomic evidence. Server-only database access is fixed/parameterized and never exposed
through an arbitrary SQL API. Imprint recorded the selection form's existing semantic
tokens and shared primitives in `ui-registry.md`; no alternate rounding or color system.

### Layer 3 — Production readiness: ISSUES FOUND

Local rollback, expiry/logout/revocation, stale previews, changed retries, immutable
history, exact price precision and ordinary journal regression checks pass.
Deployment/direct database connectivity, hosted resource configuration, dedicated
demo terminal, actual startup task execution and focused real interruption tests are
pending. The existing manually operated/Claude-connected terminal remains untouched.
Extended 48-hour soak is explicitly deferred by the user, not passed or required to
wait before further implementation. Do not merge or label the whole integration ready.

Two review layers contain remaining integration/release gaps. They are documented
requirements, not dismissed defects. No additional browser approval was invented for
ordinary writes; this explicit history approval belongs to initial MT5 onboarding.

## References

- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase session semantics](https://supabase.com/docs/guides/auth/sessions)
- [node-postgres transaction ownership](https://node-postgres.com/features/transactions)

This report supersedes the unfinished publication scaffold described in the historical
[handover](MT5_HANDOVER.md), without erasing that earlier stop record.
