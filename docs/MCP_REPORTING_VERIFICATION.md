# MCP reporting increment: verification and release gate

Date: 2026-10-08. Branch: `feature/mcp-access`.
Baseline: merged master `425b1a5` (PR #17), fast-forwarded without a new branch.
This report covers the local reporting increment, not full MCP readiness.
The initial report preceded source publication. The implementation is now pushed
as `e09ca3f` and deployed to the READY branch preview described in the follow-up
below. Authenticated preview reporting checks pass. The user independently
merged PR #18; the resulting production deployment is READY. A separate
authenticated production-browser run has not been claimed.
The user-approved read-only hosted migration is installed and verified.
The user's untracked reference screenshot
is preserved and excluded from implementation changes.

## Delivered capabilities

The HTTP catalog now contains 53 tools and five domain/workflow resources.
Five new read-only tools use the same typed services and domain calculations
as the existing browser journal, analytics and CSV adapters:

| Tool | Contract |
| --- | --- |
| `tradeos_journal_summary` | Daily, Monday-start weekly or day-one monthly account summaries; decision-date membership separate from closed-at realized results |
| `tradeos_analytics_performance` | Qualifying closed-trade metrics and breakdowns, currency-separated money, underlying-trade unitless rates and full-ledger cash-neutral drawdown |
| `tradeos_analytics_behavior` | Explicitly reviewed cohorts, immutable rule-review completeness, all five grades, descriptive associations and qualifying samples |
| `tradeos_calendar` | Realized daily results by final closure date/timezone, separated currencies and independent journal-date counts |
| `tradeos_journal_export` | Every record matching current journal filters/search, canonical persisted fields and identifiers, string decimals and spreadsheet-safe free text |

`services/application/reporting.ts` authorizes a verified actor through the
fixed `REPORTING_DATA` transaction. Pure calculations live in
`domain/reporting/`; browser adapters do not impersonate integration claims.
The private loader takes an optional owned account ID, never an owner ID,
table name or SQL. One repeatable-read snapshot supplies complete history,
without the Data API's thousand-row cap. Explicit account selection limits
financial facts while retaining all owned account choices in browser filters.

## Contract and defect checks

- Monetary wire values remain validated decimal strings. Account precision
  is applied to finalized net PnL before comparison; no near-zero tolerance
  is introduced. Conflicting recorded outcome/net PnL produces an explicit
  correction-required error rather than a fabricated classification.
- Journal filters use `opened_at → planned_at → created_at`. Realized
  summaries, calendar, performance and behavioral attribution use `closed_at`.
  Open trades and partial-exit cash do not become early canonical results.
- Net trading profit excludes account adjustments. Instrument/strategy/setup/
  session/direction filters select trading statistics, never truncate account
  ledger history used for balances and drawdown.
- Money stays separated by currency; same-currency aggregation retains the
  maximum configured precision after per-account net normalization. Mixed
  selections calculate unitless statistics from trades without even forming
  a mixed-currency monetary total or profit factor internally.
- Valid R requires recorded R and positive normalized planned risk; missing R
  is excluded, not replaced by zero. Every R summary exposes its sample size.
- Unknown `OTHER` classification withholds cash-neutral drawdown. Incomplete
  closed history withholds authoritative balances, return and drawdown and
  gives an explicit explanation; the browser hides the incomplete curve.
- Execution/psychology require review timestamps. A reviewed legacy null is
  unanswered, not “no.” Rule completeness requires the timestamp, exact item
  count and distinct immutable applicable rule IDs, including explicit results.
  Post-trade grades/text/lessons require explicit post-trade review completion.
- CSV uses the same builder and filters for browser and MCP, includes canonical
  account/instrument/strategy/setup IDs and source provenance, and ignores page
  parameters. Formula prefixes in free text are escaped without changing valid
  signed decimal strings. Display precision is not substituted for raw evidence.
- Final review found and fixed a selected-account dropdown regression before
  handoff. Database, service and real browser tests retain other owned choices
  while financial facts remain scoped. An explicitly selected calendar does not
  acquire unrelated empty currency groups.
- Immutable timezone formatter instances are bounded and reused; no user data
  is cached. This removed the 1,001-record fixture timeout without relaxing its
  timeout or reducing coverage.

## Independent financial fixtures

| Fixture | Expected and verified result |
| --- | --- |
| Gross `10.20` less commission `0.10` and swap `0.10`, risk `100` | Final USD `10.00`, `0.10R`, `PARTIAL_WIN` only after full closure |
| 1,001 closed trades at `0.01` | USD `10.01`; CSV includes all 1,001 records and broker ID `9007199254740993` unchanged |
| USD win `10.00`, JPY loss `-1`, USD exact-zero trade | Separate monetary totals; two decisive trades give `50.00%` win rate, three closed trades give `33.33%` break-even rate |
| R values `0.1`, absent and `0` | Sample two of three; expectancy `0.05R`, not a three-trade mean with invented zero |
| Same currency with account precisions two and three | `10.00 + 0.001 = 10.001`, not `10.00` |
| Reviewed USD results `0.004` at two places and `0.001` at three places | Normalize first to `0.00` and `0.001`; behavioral aggregate is `0.001`, not `0.005` |
| Starting `1000`, win `10`, loss `-5`, neutral withdrawal `-100` | Balance `905.00`, trading profit `5.00`, drawdown `5.00` before and after cash movement |
| Account ledger includes a second instrument loss `-5`; statistics filter first instrument win `10` | Filtered trading profit `10.00`, whole-account balance `1005.00` |
| UTC closure `2026-10-07T22:30:00Z`, Kampala timezone | Realized date 8 October; independent decision date 5 October |
| USD normalized `0.004` with recorded break-even | Exact normalized `0.00`; recorded win conflicts and is flagged, while `±0.01` remains a win/loss |

## Verification commands and results

All database fixtures run only against disposable loopback Supabase, under
the existing fixture lock and transaction cleanup. No production users/trades
are test fixtures. The database runner discovers the new suite automatically.

| Exact command | Result |
| --- | --- |
| `npm test` | PASS: 746 tests in 51 files, including 43 reporting tests |
| `npm run test:db` | PASS: 809 assertions in 21 suites, including 25 reporting assertions |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, zero warnings |
| `npm run build` | PASS: Next.js 16.3.6 production compilation/typecheck and 32 generated pages |
| `npm run test:mcp-integration` | PASS: 34 real local OAuth/SDK/browser checks |
| `npm run test:integration-browser` | PASS: 65 real local provider/browser/API regression checks |
| `npm run test:mt5-python` | PASS: 176 tests |
| `npm run check:mt5-python` | PASS |
| `node --experimental-strip-types scripts/check-application-database.mts --local` | PASS: 22 functions and 13 version/order columns |
| `npm run check:application-db` | PASS against the approved hosted project: 22 functions and 13 version/order columns |
| `npm run build:verified` | PASS: hosted prerequisite check, production compilation/typecheck and 32 generated pages |
| `supabase db advisors --local --type security --level warn --fail-on error --output json` | PASS: no issues found |
| `git diff --check` | PASS |

For this local Supabase image the permission-error hint extension has a known
crash. The complete `npm run test:db` is invoked by the existing guarded wrapper:

```powershell
node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm |
  Select-String -Pattern '^Suite:','^PASS:','^FAIL:','RESTORED'
exit $LASTEXITCODE
```

It temporarily disables only permission-error diagnostic hints and restores
them in `finally`; authorization assertions are not skipped or weakened.
The local draft function and its canonical migration-history source were
updated atomically during development; no hosted history was changed.

The official MCP SDK is `2.3.1`; headless Chrome is `154.0.8037.93`.
Modern protocol `2026-07-28` and the supported legacy protocol pass. Reporting
tool output agrees with hand calculations, and authenticated browser CSV equals
MCP CSV exactly even with `page=99`. Real OAuth S256, consent, renewable tokens,
direct-table isolation, revoked/expired grants and concurrent browser/MCP
mutations are exercised by the existing suites. Native Windows DPAPI and worker
process tests use controlled fixtures, not a fresh real-broker terminal test.
Browser suites reported zero uncaught client errors and cleaned their fixtures.

## Database and deployment gate

New migration:
`supabase/migrations/20261008182208_mcp_reporting_workflows.sql`.
It adds only `private.application_reporting_data(jsonb)`: security invoker,
empty search path, fresh session/grant checks and explicit owner predicates.
Execution is revoked from public, anonymous, authenticated and API service-key
roles; the verified application server uses its existing private connection.
No public table grants, tables, financial writes or integration enablement change.

The hosted Trade OS project is `nhwlxcrsivmawwmjiwck` under
**VeilCode Studio@Zooloop.tv@gmail.com**. On the user's subsequent “go ahead,”
the reviewed migration was installed there successfully. Its function body
matches the reviewed repository source exactly. An unauthenticated call is
rejected; anonymous/authenticated/service-role EXECUTE is absent, the function
is an invoker and its search path is empty. The provider-generated migration
history version was aligned, with exact source/name/version guards, to the
repository's canonical `20261008182208`; no earlier migration history changed.

Before/after row hashes are identical for accounts, trades and adjustments,
as well as integration resources, grants and complete MT5 connection state.
Counts remain five accounts, 21 trades, zero adjustments, 14 instruments,
zero tags/associations, 86 source facts and 20 MT5 execution versions.
Application operation/audit counts remain one each; reporting creates neither.
There is still no hosted MCP resource enablement. No authenticated test fixture
or fake user session was created in production.

`npm run check:application-db` and `npm run build:verified` both pass with the
existing strict TLS configuration. The prerequisite gate still rejects future
code/schema mismatches. Source publication and the branch-preview deployment are
complete. Authenticated preview reporting verification passes; production release
was independently performed by the user's PR #18 merge. A local build was not
counted as a deployment. Collector controls,
credentials and publication policy are unchanged.

Hosted security advisors show no new notices. The existing 23 private-table
[RLS-without-policy informational notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
describe intentionally closed private tables. The pre-existing
[disabled leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains; no Auth settings were changed under this reporting approval.

## Review and remaining objectives

Plan alignment: PASS for this reporting increment; full MCP scope incomplete.
System integrity: PASS for shared services, explicit actor ownership, precision,
audit/review preservation and existing UI patterns.
Production readiness: local checks and hosted prerequisite/security validation
PASS; source publication and the branch-preview build are complete.
Authenticated preview verification passes. The user's master merge has a READY
production deployment; the functional browser evidence in this report is from
the identical application code in Preview, not a separate Production session.
Do not label the reporting increment released to the production site.

Pending capability families: paginated balance-curve events, browser-confirmed
permanent deletion, private screenshot upload/download, MT5/import access and
review adapters, and profile settings. Local stdio and the requested real Codex,
Claude Code, ChatGPT, Claude remote and Gemini CLI matrix remain pending; official
SDK checks are not substitutes for those clients. No model APIs were invoked.

Complete-history aggregate/CSV responses remain subject to the existing 15-second
database and 20-second client query limits and host response/runtime limits.
Oversized or timed-out reports fail explicitly rather than returning a silently
truncated result. Large-scale response handling and paginated event curves are
not claimed by this increment. No integration activation, master merge,
production fixture, broker order or terminal/startup change was performed.
External changes are the approved read-only hosted function/history alignment,
feature-branch commit/push, approved preview-only settings and rebuild below.

## Hosted preview follow-up: 8–9 October 2026

Implementation commit: `e09ca3f4b3445fe01ffcf27a4f843f3803c993d7`, verified against
GitHub's `feature/mcp-access` head. The original preview failed at the database
prerequisite connection with `ENETUNREACH`, before application compilation.
Environment metadata showed that the shared database URL already applied to
Preview, while the pooler host/port and public CA were Production-only.

The user approved three **Preview + `feature/mcp-access` only** additions:
`SUPABASE_DATABASE_POOLER_HOST`, `SUPABASE_DATABASE_POOLER_PORT` and
`SUPABASE_DATABASE_CA_CERT`. The existing strict configuration verified the
official session pooler, port 5432, correct project-qualified username and CA.
Values were supplied through stdin, never process arguments/logs. Existing
database credentials and all Production variable metadata remained unchanged.
TLS and hostname checks were not weakened; integration flags were not enabled.

The exact reviewed Git deployment was rebuilt successfully:

- Deployment: `dpl_AKiPhcaXZ63gMpvTnM3dDD8Jxiks`.
- URL: https://trade-c2zurhuvi-ghostsyscoders-projects.vercel.app
- Environment/status: Preview / READY; no production promotion.
- Commit/framework: `e09ca3f` / Next.js 16.3.6.
- Duration: approximately 75 seconds, with a clean dependency/build cache.
- Hosted prerequisite check: PASS, 22 functions / 13 version-order columns.
- Compilation/typecheck/static generation: PASS, 32 pages.

The connected-browser runtime failed twice before selecting a browser. Existing
Playwright/Chrome instead provided an isolated visible verification window with
short-lived Vercel access held only in memory, restricted to this exact preview
origin and removed from all other origins. Deployment Protection stayed enabled;
no passwords/tokens or browser authentication state were logged or persisted.

Fourteen distinct hosted read-only checks pass after the user's normal sign-in:
anonymous calculator rendering, anonymous journal protection, signed-in workspace,
scoped performance/account choices, complete CSV, daily/weekly/monthly journals,
calendar, execution/rule/psychology/mistake analytics and filtered browser journal.
The retained-window run emitted 16 PASS lines because the performance check was
repeated during harness diagnostics; these are not 16 distinct checks. It exited
zero, with no uncaught page errors or application 5xx responses.

The failed lookup was a harness assumption, not an application defect: the mapped
account is now labelled **USD100K FTMO ACCOUNT**, not the original USD100K DEMO.
The test was corrected to use the existing connection's immutable account ID,
verified as present in the signed-in account choices. No name, owner or mapping
changed. Two additional harness-only scope errors were fixed without application
changes; the same signed-in browser was retained for subsequent read-only retries.
The bounded server error-log scan returned no errors. The public calculator's
actual heading was used rather than assuming a literal route-name heading.

Browser analytics show USD 2032.53 net trading PnL and USD 102032.53 ledger balance.
CSV with `status=CLOSED&page=99` returns all 20 unique mapped MT5 closed trades,
retains source identifiers as strings and sums exactly to USD 2032.53 through the
central decimal utilities. Daily summary and selected calendar day agree with the
independent CSV closure-date cohort in Africa/Kampala. Selected-account analytics
retain every owned account option, and behavioral pages load without completing
placeholder reviews. Reflection forms and financial/control mutations were not
submitted. Full remote MCP tools remain disabled and are not claimed by this test.

Independent pre-check: five accounts, 21 trades, zero adjustments, 20 demo closed
trades, USD 2032.53 final net PnL. Post-verification account/trade/adjustment, grant
and MT5-connection hashes exactly match the pre-check and earlier hosted baseline.
There is still no enabled hosted MCP resource. Verification reads existing data only;
it does not submit trade/reflection forms, controls or new consent. The user
screenshot is unchanged and private helpers remain in ignored `.artifacts`.

After the evidence-only follow-up `ee95a81` was pushed, read-only remote inspection
found the user's independent PR #18 merge at
`02565eba459dd1d4ad2a6c200e2e536bf66485e2`. Its production deployment
`dpl_4jqis5kJUiaeFwCwhkQLBxeJetVP` is READY, and inspecting
`tradeos.veilcode.studio` confirms that domain resolves to this deployment.
The agent did not merge, promote or change Production settings. The
documentation-only `ee95a81` preview also reached READY; it changes no application
code from the verified `e09ca3f` build. Full MCP activation/client readiness
remains pending regardless of either deployment's build status.
