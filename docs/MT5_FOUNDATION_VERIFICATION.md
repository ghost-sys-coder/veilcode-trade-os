# MT5 foundation verification — interim report

Date: 2026-10-05. Branch: `feature/mt5-sync`.
This is progress toward the complete MT5/MCP plan, not release or merge approval.
This records the foundation at `e2b7347`; later collection/outbox evidence is in
[capture and recovery verification](MT5_CAPTURE_RECOVERY_VERIFICATION.md).

## Delivered and verified

- Account-bound private grants, resource-bound signed tokens, S256 PKCE,
  renewable/rotated credentials and immediate revocation. All mutations recheck
  live grant/session/consent ownership inside their database transaction.
  Grant row locks serialize in-flight mutations against revocation.
- Fail-closed PENDING -> provider approval -> ACTIVE consent. Database activation
  requires provider approval; the application validates the exact activation
  acknowledgement before forwarding a code. Original browser tokens are unchanged.
- `/oauth/consent` and `/settings/integrations`, verified in headless Chrome.
  Named account selection is explicit; client UUIDs do not masquerade as account
  names. Provider revocation failures remain distinct from local revocation.
- Public protected-resource metadata and authenticated `/api/integrations/v1/session`.
  The calculator remains statically/publicly accessible; its authenticated header
  resolves through the existing uncached status endpoint, not an auth wall.
- Durable operation hashes/results and append-only mutation audits. Identical
  retries return their original result; changed payloads are rejected. Receipts
  cannot escape the active grant's account/resource/purpose scope.
- Explicit demo-account mapping and account-bound collector leases. Active workers
  exclude competing workers; expired leases receive higher fencing tokens.
- Authenticated lease/capture endpoints, validated UTC/decimal-string/string-ID
  inputs, bounded streamed JSON, private source revisions and current facts.
  Checkpoint, source facts, receipt and audit commit atomically. Unexpected account
  switching commits ATTENTION without persisting wrong-account facts.
- Corrected financial source records retain original revisions and require review.
  Older/equal-timestamp changed facts cannot silently overwrite newer observations.
- Deterministic directional episodes: hedging, scale-ins, partial exits, flattening,
  netting reversals and close-by execution facts. Uncertain/canceled history remains
  flagged, not partly published as canonical performance. Known plans/reviews are
  never fabricated from current broker observations.
- MT5 import matching now uses connection + directional-episode identity, never raw
  position/order IDs alone. Unqualified legacy MT5 matches require review; other
  import sources retain their existing identity safeguards. Database identity-index
  changes still accompany the upcoming canonical-publishing milestone.
- Central non-negative trading-credit support: gross minus costs plus credits.
  Positive signed broker costs/swap map to attributed trading credits; broker CREDIT
  facilities remain unclassified cash provenance, not automatically profit/funding.

## Hand-calculated fixtures

| Fixture | Expected result | Evidence |
| --- | --- | --- |
| Gross 100, commission 2 + 3, fee 0.5, swap credit 1.5 | Net 96.00, WIN | `tests/mt5/reconstruct.test.ts` |
| Partial exit +20 then final exit -25 | Net -5.00, PARTIAL_LOSS only after closure | Same suite |
| Partial exit +20 then final exit -20 | Net 0.00, BREAK_EVEN | Same suite |
| Buy 1 lot with entry commission 2; reverse 3 lots, profit 90, swap cost 3, commission 9, fee 3 | Closing episode: commission 5, fee 1, net 81.00; opening episode carries commission 6, fee 2 | Same suite |
| Close that new sell episode for -10, commission 2 | Net -20.00; combined cash 61.00 | Same suite |
| 100 entries at 0.01 volume, each commission 0.001; gross 0.11 | Total volume 1, commission 0.1, net 0.01 | Same suite |

Explicit broker reversal allocations take precedence. Otherwise costs split by
closing/opening volume without intermediate currency rounding; closing profit/swap
belong to the closing episode. Price/volume precision is separate from money.

## Verification environment and commands

Windows; Python 3.13.2; Node 25.1.0; Chrome 154.0.8037.93; Next 16.3.6;
Supabase CLI 2.95.4; PostgreSQL 17.6. Local Docker only. The isolated app uses
`127.0.0.1:3100` and `.next-integration`; it never substitutes hosted credentials.

| Command | Result |
| --- | --- |
| `npm test` | Passed: 20 files, 272 tests, including negative-zero normalization and connection/episode-aware import matching |
| `npm run test:db` | Passed: 26 grants + 26 OAuth isolation + 36 capture + 100 regression = 188 assertions |
| `npm run test:integration-browser` | Passed: 24 real-provider/browser/API checks, including concurrent upload/replay, changed-payload rejection, fencing and account switch |
| `npm run test:integration-auth` | Passed: 12 standalone real-provider authorization/refresh/revocation checks |
| `npm run typecheck` | Passed, exit 0 |
| `npm run lint` | Passed after excluding the isolated app's generated cache, exit 0 |
| `npm run build` | Passed, exit 0; 30 pages generated; public calculator prerendered |
| `npm run replay:local-db` | Passed after verified-empty local users/trades/grants; all 23 migrations replayed |
| `npm run prepare:local-db` | Passed; local diagnostic workaround verified, no permission changes |
| `supabase db advisors --local --type security --level warn --fail-on error` | Passed with capture schema, exit 0; no issues found |
| `supabase db lint --local --schema public,private --level error --fail-on error` | Passed with capture schema, exit 0 |
| `npm audit --omit=dev --json` | 0 vulnerabilities after moving build-time shadcn to devDependencies |

The browser runner uses a fresh headless profile and an example.test fixture user,
not the user's saved browser or broker credentials. Test cleanup deletes only that
local fixture owner's data in a transaction; normal workflows cannot delete audits
or source history. Screenshots are ignored artifacts under `.artifacts/integration-tests`.
Final cleanup query verified local users, trades, grants, connections and operation
receipts all zero. No fixture was retained in the hosted project or local workspace.

## Operational limitations and remaining work

- Capture is staging/provenance only. Canonical transactional commit, identity-index
  migrations, persisted trading credits, shared financial workflows, conflict review,
  symbol mappings and baseline/ledger reconciliation remain to be implemented.
- Multi-page collection manifests and initial collector SQLite are now implemented
  and tested in the later report. Do not treat complete staging as fully reconciled
  canonical performance; publishing/onboarding remains pending.
- Collector HTTP/broker adapters, renewable credentials in Windows-protected storage, supervision,
  startup/recovery, pause/resume/onboarding UI and operational monitoring are pending.
- No terminal attached, no dedicated installation modified, no broker orders created.
  Dedicated multi-account demo pilot, Windows interruption testing and the required
  48-hour soak have not started. Reboot-before-login/VPS/RDP behavior is pending.
- Hosted OAuth hook/resource configuration and deployment are unverified; integrations
  default disabled outside the isolated test app. No hosted writes were made.
- MCP implementation remains parked until MT5 passes its merge gate; it is still part
  of the active full-build objective, including all workflow families and real clients.
- Development dependency audit still reports the inherited braces recursion advisory
  and its dependents. npm has no patched braces release at the recorded check; the
  proposed `--force` fix downgrades framework/tooling and was not applied. Moving the
  CLI/CSS build dependency out of runtime does not claim the development issue fixed.
  Track [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## Review against the approved plan

Plan alignment: the local authentication gate passes; MT5-1/2 remain in progress.
The full collector, canonical persistence, onboarding and MCP inventory are not
represented as complete. System integrity: private transactional authorization,
decimal boundaries, immutable evidence, manual plans/reviews and no broker execution
are preserved. Production readiness: not ready; the remaining milestone and soak
gates above are mandatory. Do not merge or enable full synchronization on this report.

See [roadmap](INTEGRATION_ROADMAP.md), [MT5 plan](MT5_INTEGRATION_PLAN.md),
[MCP plan](MCP_INTEGRATION_PLAN.md) and [local runbook](LOCAL_INTEGRATION_TESTING.md).
