# MT5 transport and terminal-reader verification — interim report

Date: 2026-10-05. Branch: `feature/mt5-sync`; builds on `00bdaa7`.
This is implementation progress, not MT5/MCP completion or rollout approval.

## Delivered and tested

- Resource-bound authenticated Python HTTP transport: HTTPS certificate verification,
  redirects/proxies disabled, bounded strict JSON, live session mapping checks,
  stable redacted error codes. Explicit loopback HTTP opt-in is test-only.
- SQLite v2 adds durable immutable lease request envelopes and receipts. V1 spools
  upgrade without discarding pending collections or capture attempts. Lost lease
  acknowledgements replay their original operation; expired original receipts are
  recorded before a fresh claim. Uncertain capture lookup cannot skip an older page.
- Account-bound uploader renews leases at 30 seconds, checks expiry margin, reuses
  exact capture payloads, and requires a higher live server fence before uncertain
  operation lookup. COMMITTED acknowledges; UNKNOWN preserves and supersedes the
  old attempt atomically for the same collection slot. Auth/TLS/mapping/conflict
  errors require attention; transient retries have jitter capped at 60 seconds.
- Read-only native terminal adapter verifies approved executable/data directory,
  demo status, server/login, currency/precision and position mode. Checks identity
  before and after each history/order/position query and before returning data.
  No auto-discovery, broker credentials, account switching or execution calls.
- History starts at the epoch for first/full capture; incremental reads overlap by
  five minutes. Failed/None reads are not successful empty collections or closure.
  Native floats become validated unrounded source strings; uint64 IDs remain strings.
  Current stops are observations, never original plans. Unsupported/canceled deals,
  credit facilities, reversals and close-by facts remain source evidence for review.

## Actual local API recovery fixtures

Disposable user/client/account/connection, real provider PKCE consent and signed token,
isolated application `127.0.0.1:3100`, local Docker Supabase only. Python receives the
token through stdin; no token in arguments, spool, logs or configuration files.

1. Commit ticket `20`, then deliberately lose the Python acknowledgement. Pending
   page remains on disk. Expire only that fixture's lease; a new worker obtains a
   higher fence, reads COMMITTED and acknowledges the original result. Exactly one
   capture operation and one source revision exist; no second capture is sent.
2. Persist ticket `30` and its request locally without sending it. Expire the fixture
   lease. A new worker gets a higher fence, reads UNKNOWN, stores a new request for
   the same manifest slot, then stages it. The original operation remains absent;
   one source revision exists and the spool has zero pending pages.
3. Restore a current lease for the account-switch fixture. A wrong login commits
   ATTENTION and stages no wrong-account source. All three prior source revisions
   (`10`, `20`, `30`) remain, proving the pause did not discard earlier evidence.

## Native boundary fixtures (no real terminal)

Fake native module exposes documented read functions and fails on any execution or
login call. Switching identity during each query discards the entire prospective
capture and leaves the outbox cursor unchanged. Live/wrong-account/currency/precision,
installation/data-path mismatch, disconnection, failed queries and duplicates fail
closed. Successful empty observations never assert canonical closure.

Source examples: ticket `18446744073709551615` stays exact; profit `0.001` and
commission `-0.0001` stay unrounded strings. Position ID `30` and ticket `31` stay
distinct; stop `1.0875` stays `currentStop`. These are source-normalization checks,
not claims that Python calculates final PnL or that an incomplete trade is realized.
Existing TypeScript financial fixtures remain the calculation authority.

## Commands and results

Environment: Python 3.13.2, Ruff 0.16.10, Node 25.1.0, Chrome 154.0.8037.93,
Next 16.3.6, Supabase CLI 2.95.4, PostgreSQL 17.6, Windows.

| Exact command | Result |
| --- | --- |
| `npm run test:mt5-python` | 76 tests pass |
| `npm run check:mt5-python` | Ruff and compilation pass |
| `npm run test:integration-browser` | 29 real local provider/browser/API/Python checks pass |
| `npm test` | 282 tests, 21 files pass |
| `npm run test:db` | 228 assertions pass, rollback-only local suites |
| `npm run typecheck` | Pass, exit 0 |
| `npm run lint` | Pass, exit 0 |
| `npm run build` | Pass, exit 0; 30 pages; public calculator static |
| `supabase db advisors --local --type security --level warn --fail-on error` | No issues, exit 0 |
| `git diff --check` | Pass |

Local cleanup query verifies zero users, trades, grants, connections, operations,
collections, batches and progress rows. UUID-named test spools/WAL/SHM files are
removed explicitly; production data and normal immutable evidence are not deleted.
Node's module-type warning remains non-fatal; changing the entire package module
mode is outside this feature. No schema changes or hosted queries/writes this increment.

## Review against the approved plan

Plan alignment: MT5-1/2/3 remain in progress; other MT5 and all MCP gates remain
required. System integrity: deterministic TypeScript finance, protected plans,
explicit review completion, canonical-only analytics and database ownership remain
authoritative. No credential leakage or broker execution introduced.

Production readiness is **not passed**. Important outstanding requirements:

- Shared canonical services/publication, persisted trading credits/attribution and
  directional-episode identity migrations. Source staging is not canonical sync.
- Approved onboarding, baseline/manual/symbol conflict review, cash classification,
  reconciliation bridge and monitoring/pause/resume UI.
- PKCE/refresh credential provider with Windows-protected storage, continuous
  poll/retry schedule, single-instance lock, stalled-call supervisor and Task Scheduler.
  Current HTTP timeout is a socket timeout, not a whole-operation deadline.
- Actual dedicated native-terminal verification, disk-full/sleep/wake/reboot and
  locked-session tests, then a real 48-hour multi-account demo soak. Not started.
- Hosted OAuth hook/resource deployment verification and full regression gates.
- MCP capability inventory, services, SDK transports, deletion confirmations and
  requested-client verification after MT5 passes its merge gate. MCP remains parked.

Review caught overly permissive URL configuration, a potential FIFO skip in
uncertain lookup and duplicate orders being coalesced; all were tightened with
regression coverage. The reader also copies its approved identity to prevent caller
mutation of the original dictionary from retargeting it. Missing operational
work is explicitly pending, not replaced by fixture tests or labeled complete.

See [roadmap](INTEGRATION_ROADMAP.md), [MT5 plan](MT5_INTEGRATION_PLAN.md),
[MCP plan](MCP_INTEGRATION_PLAN.md), and [Python contract](../integrations/mt5/README.md).
