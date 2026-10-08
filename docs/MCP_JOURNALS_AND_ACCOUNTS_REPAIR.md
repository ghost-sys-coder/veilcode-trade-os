# Hosted accounts repair and MCP journal reflections

Date: 2026-10-08. Branch: `feature/mcp-access`, following `1b83f76`.
This is an incremental coverage report, not full MCP completion.

## Hosted defect and approved repair

The hosted `/accounts` adapter called a shared workflow absent from its database.
Read-only introspection showed no `application_account_read`, no account-ledger
or account-event reader and no trading-account `record_version`. The configured
connection separately passed a strict TLS read-only probe. This was deployment
ordering, not an empty account register or an uncertain monetary mutation.

The user explicitly approved the six tested shared-workflow prerequisites. They
were applied atomically to project `nhwlxcrsivmawwmjiwck` through the correct
VeilCode Studio connector, as `application_shared_workflow_prerequisites`:

- `20261008022940_mcp_configuration_workflows`
- `20261008024848_mcp_policy_query_indexes`
- `20261008031835_mcp_account_workflows`
- `20261008035808_mcp_account_events_and_workflow_core`
- `20261008041556_mcp_trade_workflows`
- `20261008044306_mcp_trade_correction_order`

The necessary account/ledger/trade functions were verified afterward. Account
count5, trade count21, adjustment count0, starting-balance sum400000 and closed
PnL sum2482.53 were unchanged. These sums are integrity cross-checks, not a
mixed-currency performance report. The existing connection status remained
ACTIVE; no collector settings or broker facts changed. Hosted MCP is disabled.
The user reloaded the actual hosted page and confirmed accounts load correctly.

The hosted tool initially recorded the atomic bundle as20261008092733. Its
bookkeeping was transactionally split into the six original source versions and
names, preserving each source statement. Guarded reconciliation required exactly
one bundle and no pre-existing source entries; afterward all six names/versions
were verified. This was migration metadata only, not application-data mutation.
No database tests, fixture users, deletions or broker executions ran on hosted
data. New account metadata may stale MT5 ledger approval fingerprints: require
a fresh review, never rewrite an old proof.

## Error handling and release guard

Failed reads now have read-specific retry guidance. Missing functions/tables/
columns are classified as SCHEMA_NOT_READY, while invalid server connection
settings are distinct from transient failure. Raw SQL, secrets and unexpected
exception messages remain suppressed. Account load failures show unavailable
counts and register state rather than fabricated zero accounts.

`npm run check:application-db` checks only fixed schema prerequisites in a
read-only transaction. `--local` discovers the disposable local database without
using hosted environment fallback. This increment expects14 functions and9
version/order columns. Missing inventory or connectivity fails closed.

`vercel.json` sets `npm run build:verified`, running the read-only prerequisite
check before compilation. This intentionally blocks deployments of the new
journal adapters until their reviewed migration is approved/applied to the
target database. It never applies migrations automatically. The current hosted
accounts repair does not depend on deploying this new branch. Vercel supports
the repository build-command override in its
[project configuration](https://vercel.com/docs/project-configuration).

The direct local-to-hosted preflight attempts hit intermittent connection
timeouts; they were not reported as passed. Hosted schema inspection and the
real-user browser confirmation establish the accounts repair. The complete new
manifest passes against disposable local Supabase. Server TLS verification was
not disabled, and no credentials were logged.

## Added coverage

Three tools support DAILY, WEEKLY and MONTHLY persisted reflections:
`tradeos_journals_get`, `tradeos_journals_list`, `tradeos_journals_save`.
The catalog has30 tools and5 contract resources.

Owned account/period reads distinguish a missing entry from an existing one.
Lists use bounded keyset pagination. Writes require operationId and a string
expectedVersion:0 only when the period is absent, otherwise its current version.
Identical retries return the original receipt; altered payloads conflict. Parent
locking serializes concurrent creation. Effects, receipts and before/after
audits are atomic. Omission preserves a value; explicit null clears it; false
remains a deliberate answer. Mondays and month-first dates are enforced in both
the typed boundary and database. Legacy long notes remain readable untruncated;
new text changes are bounded to4000 characters. Monetary observations are read
as strings, cannot be rewritten through reflection tools, and never replace the
authoritative account ledger.

Browser save actions are thin parsing/navigation adapters to these same services.
The real browser test caught initial hydration replacing an immediately filled
textarea. A hydration/pending fieldset guard now prevents accepting edits before
the form is ready; the unchanged Card/Label/Textarea/Button tokens and toolbar
layout are recorded in ui-registry.md. React and imprint review preserved the
existing design language.

Saving a reflection neither closes a trade nor completes its behavioral review.
Journal decision dates and realized closed_at attribution remain unchanged.
Computed daily/weekly/monthly summaries are still a separate pending analytics
capability, not advertised as implemented by these storage tools.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | PASS:616 tests /45 files |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` | PASS:668 assertions /18 suites; unchanged npm test:db runner |
| `npm run test:mcp-integration` | PASS:22 real local OAuth/SDK/browser checks, including all journal kinds |
| `npm run test:integration-browser` | PASS:53 MT5/auth/browser checks |
| `npm run test:mt5-python` | PASS:176 tests |
| `npm run check:mt5-python` | PASS |
| `npm run typecheck`, `npm run lint`, `npm run build` | PASS |
| `npm run replay:local-db` | PASS: empty local database guard and migration replay |
| `npm run check:application-db -- --local` | PASS:14 functions /9 columns |
| `git diff --check` | PASS |
| `supabase db advisors --local --type security --level warn --fail-on warn` | PASS: no issues found |

Journal database suite:26 checks, including cross-owner reads/writes, direct
anonymous/OAuth denial, replay, altered payload, stale versions, period validity,
null/false/omitted values and whole-command rollback on audit failure. The local
diagnostic-hint workaround is restored in finally; no security assertion is
skipped. The sandboxed build could not fetch Google Fonts; the normal authorized
network build passed using the same font dependencies. No font/TLS bypass.

Runtime:Node25.1.0, Python3.13.2, Next16.3.6, official MCP SDK2.3.1,
Chrome154.0.8037.93. Hosted security advisors have no new exposed-table/RPC warning.
Private deny-by-default RLS/no-policy INFO entries are intentional. The existing
leaked-password protection warning remains an operator setting, not changed by
this release; see [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Real-client matrix and remaining work

Read-only version checks found Codex0.147.0, Claude Code2.1.119 and Gemini CLI0.57.0.
These are availability checks, not successful authenticated tool calls. No model
API credentials or model invocations were requested or used.

| Client | Actual authorized read/write verification |
| --- | --- |
| Codex | Pending: local stdio/hosted readiness and client consent |
| Claude Code | Pending: local stdio/hosted readiness and client consent |
| Gemini CLI | Pending: local stdio/hosted readiness and client consent |
| ChatGPT Desktop/remote connector | Pending |
| Claude remote connector | Pending |

Still required: goals/prop, tags/instrument CRUD, analytics/calendar/computed
journal summaries and filtered exports, screenshots/private-file workflows,
MT5/import access, profile, one-use permanent-deletion approval, local stdio and
the full real-client matrix. The new journal migration stays local-only pending
reviewed rollout. Master and feature/mt5-sync remain unchanged; no full MCP merge,
activation or readiness claim is made.
