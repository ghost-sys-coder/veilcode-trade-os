# MT5 capture and recovery verification — interim report

Date: 2026-10-05. Branch: `feature/mt5-sync`. Builds on foundation `e2b7347`.
This is milestone progress, not MT5/MCP completion or permission to merge/enable.
Later HTTP-uploader and terminal-reader verification is recorded in
[the transport/reader report](MT5_TRANSPORT_READER_VERIFICATION.md); the pending
items below describe this earlier checkpoint.

## Delivered

- Mandatory typed collection manifests on the capture API. Frozen checkpoint/count,
  immutable batch slots, transactional source revisions/receipt/audit, and complete
  collection gating. Removed both old manifest-less RPC signatures; direct clients
  cannot bypass the gate. Lost acknowledgements replay the immutable original result.
  A newer complete collection cannot advance across an older incomplete one; filling
  the gap promotes already-durable newer coverage. Indexed private progress projections
  avoid recounting all historical slots on each poll and are verified against evidence.
- Account-scoped operation lookup through private authorization and
  `/api/integrations/v1/operations/[operationId]`. Uses the mutation's operation lock;
  revocation and grant rebinding apply to reads too. No request hashes, credentials,
  arbitrary owner arguments or cross-account receipts are exposed.
- Python strict source envelopes/decimal strings/uint64 tickets, demo-only identity,
  and account-bound SQLite WAL/FULL outbox. Whole collections and local capture
  cursor commit together. Server-confirmed progress is separate from captured progress.
- Exact upload envelopes and UUIDs survive restart. A changed lease raises attention
  instead of silently rewriting an uncertain operation. After verified fenced takeover
  and authenticated UNKNOWN lookup, recovery retains the old attempt and commits its
  replacement for the same immutable collection slot. COMMITTED receipts are acknowledged.
- Project-local pinned Ruff development tooling and cross-platform npm verification
  runners. No Python global install, model API keys, broker orders or paid services.

## Collection fixture evidence

Three-slot collection at checkpoint `2026-01-01T00:00:00.000Z`:

| Commit sequence | Received count | Complete | Authoritative checkpoint |
| --- | --- | --- | --- |
| Index 2 first | 1 | false | null |
| Index 0 next | 2 | false | null |
| Index 1 last | 3 | true | frozen checkpoint |
| Original index-2 operation replayed | original 1 | original false | original null in receipt; current connection remains complete |

Changing manifest count/checkpoint or an occupied slot's payload fails SQLSTATE
23505; invalid batches fill no slot and create no receipt. A new operation with an
identical occupied slot adds no source effect/count. Missing batches never progress.
The real HTTP test also completes a newer collection while the older one is incomplete,
then uploads the missing older slots concurrently. It verifies exactly one completion
transition and promotion of the already-durable newer checkpoint. An incomplete late
backfill never regresses an existing checkpoint but holds subsequent progression until
filled. Canonical trades remain untouched by staging.

UNKNOWN is a point-in-time receipt observation, not a guarantee about future requests.
Recovery requires a higher live server fence before lookup: an old worker then cannot
commit later. The future HTTP worker must enforce this ordering and authenticate every
lookup; the outbox is not a substitute for network authorization.

## Environment and final commands

Windows, Python 3.13.2, Ruff 0.16.10 (project-local ignored tools), Node 25.1.0,
Chrome 154.0.8037.93, Next 16.3.6, Supabase CLI 2.95.4, PostgreSQL 17.6.
Local Docker only; isolated app `127.0.0.1:3100`, `.next-integration`.

| Command | Verified result |
| --- | --- |
| `npm test` | 21 files, 282 tests pass |
| `npm run test:db` | 26 grants + 26 isolation + 37 capture + 39 collections/lookup + 100 regression = 228 assertions pass |
| `npm run test:integration-browser` | 27 actual local provider/Chrome/API checks pass; multipart concurrency, cross-collection gaps and operation lookup included |
| `npm run test:mt5-python` | 30 tests pass, including actual child-process abrupt exit, rollback, restart, lost acknowledgement, mapping and fence recovery |
| `npm run check:mt5-python` | Ruff and Python compilation pass |
| `npm run typecheck` | Pass, exit 0 |
| `npm run lint` | Pass, exit 0 |
| `npm run build` | Pass, exit 0; calculator static/public; operation route included; 30 pages generated |
| `npm run replay:local-db` | Verified empty local database; all 24 migrations replayed |
| `npm run prepare:local-db` | Local hint workaround verified; no RLS/EXECUTE changes |
| `supabase db advisors --local --type security --level warn --fail-on error` | No issues, exit 0 |
| `supabase db lint --local --schema public,private --level error --fail-on error` | Pass, exit 0 |
| `git diff --check` | Pass |

Final local cleanup query verified zero users, canonical trades, grants, connections,
operations, collections, batch slots and progress rows. Hosted data was not queried
or altered for these tests; source/audit deletion remains forbidden in normal workflows.

Initial runs caught a PL/pgSQL block-reference error, outdated signature inventory,
a TypeScript union-narrowing error in a test and Python import-order lint findings.
All were corrected and the relevant suites rerun; initial failures are not reported
as passes. A permission-review timeout was retried once; no security downgrade used.
Review additionally caught the cross-collection gap; this was fixed and verified
through both SQL and real HTTP checks. Postgres performance guidance influenced the
partial indexes/projection, while immutable slots remain the recoverable authority.
SQL and browser fixture runners share a session advisory lock to prevent resource
configuration races during verification.

## Review and remaining gates

Plan alignment: MT5-1/2/3 in progress; MCP remains parked as required. System integrity:
source/cursor/receipt/audit atomicity, private authorization, exact-zero money, plans,
nullable reviews and no broker execution are preserved. Production readiness: pending.

- Shared canonical publishing/financial workflows, persisted trading credits and
  directional identity-index migrations still need implementation and verification.
- Onboarding previews/positive baseline approval, symbol/manual conflicts, cash
  classification and reconciliation bridges remain pending. Complete source staging
  alone is not proof of available-history completeness or ledger reconciliation.
- Python broker/HTTP adapters, renewable credentials in Windows-protected storage,
  retry/heartbeat supervisor, single-instance startup and Task Scheduler are pending.
  Disk-full recovery, file access controls and full SQLite/Windows fault matrix need
  additional tests. The outbox tests do not prove the complete collector works.
- No real terminal/account attached. Dedicated demo pilot and 48-hour multi-account
  soak are not started; sleep/wake, reboot-before-login and future VPS/RDP are unverified.
- Hosted OAuth hook/resource configuration and deployment remain unverified. Hosted
  schema/data and the existing manual/Claude-connected terminal were untouched.
- Full MCP services/capability inventory/transports/clients remain required after
  MT5 passes its merge gate. No milestone is relabeled as the complete objective.
- The prior documented development dependency advisory remains open; no blanket
  `npm audit --force` downgrade or claim that the development vulnerability is fixed.

See [Python outbox contract](../integrations/mt5/README.md),
[roadmap](INTEGRATION_ROADMAP.md), [MT5 plan](MT5_INTEGRATION_PLAN.md),
[MCP plan](MCP_INTEGRATION_PLAN.md).
