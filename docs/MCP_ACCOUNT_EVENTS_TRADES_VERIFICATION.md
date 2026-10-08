# MCP account events and canonical trade workflows

Date: 2026-10-08. Branch: `feature/mcp-access`, following `3cd5abe`.
Scope: adjustments/classification, snapshots, account lifecycle/funded links,
then canonical trades, targets, management, plan corrections and reviews.
This report does not declare the entire MCP integration ready for deployment.

## Delivered

The HTTP catalog now exposes 27 tools and five contract resources. Fifteen
additional tools cover account-event history, adjustment creation/classification,
snapshots, lifecycle/funded links, canonical trade list/get/create/patch,
planned/executed targets, actual management, recorded-plan correction, reviews
and a read-only instrument catalog. Lists are owner-scoped and cursor-paginated.

Browser actions are parsing/navigation/revalidation adapters to the same typed
application services. The private transactional boundary verifies the actor,
locks current records, checks versions, runs central decimal calculations and
commits effects, durable request hashes/results and mutation audits together.
Receipts are checked before recalculation: identical retries recover the original
result; changed payloads cannot reuse an operation ID. Review/target audits retain
before and after child state, including cleared uncompleted rule answers.
Repeated inline selectors have unique label/control IDs, preventing one row's
label from opening another row's dropdown.

The approved correction, target, classification, rule-review and lifecycle
implementations are shared rather than duplicated. Their existing public/browser
RPCs retain OAuth denial; private server implementations require verified grants.
Direct OAuth table/storage access is still denied. No arbitrary SQL, ownership,
credentials, database administration or broker-execution tool is exposed.

### Account events

Deposits are positive, withdrawals negative, and all fixed adjustment types are
performance-neutral. New OTHER requires an explicit classification and reason;
reclassification preserves cash and appends history. Legacy null classifications
remain visible rather than assumed neutral. Lifecycle changes require a reason
and expected version; FAILED requires its structured reason. A funded link
requires an owned PASSED challenge and creates a separate positive baseline.

Snapshots enforce equity = balance + unrealized PnL and never update the ledger.
The browser ledger now reads exact PostgreSQL numeric strings and all matching
financial rows, avoiding the Data API row cap and floating-point conversion.
Legacy closed results without closure dates remain in exact totals; the timeline
explicitly reports incomplete placement instead of guessing dates or losing PnL.
Prop account current-balance display/snapshot defaults use the exact shared
account balance. No mixed-currency monetary total is introduced.

### Canonical trades

New records are MANUAL. Existing import/source identities are preserved.
Open trades have no authoritative realized net PnL, outcome or R. Closure
requires timestamps and gross PnL; costs and credits remain nonnegative and
net/outcome/R are centrally derived. Fee/gross components retain calculation
precision; only finalized net PnL is normalized before exact-zero classification.
Prices, volumes, percentages and R retain separate precision rules. Values not
representable in their storage domain are rejected, never silently truncated.

Account/instrument/direction and recorded planned values lock after OPEN.
Corrections preserve typed original/previous/new values, require reasons and
remain append-only. Durable correction_sequence orders future appends independently
of transaction start time; backfill preserves the legacy timestamp/ID order.
An originally unknown/null value is displayed as unknown, not replaced by the
latest correction. Private trade versions also change when child evidence changes,
without adding a column to the MT5-fingerprinted trades row.

Actual stop movement uses a separate management event and leaves the plan intact.
Partial exits stay within the canonical position and classify only at complete
closure. Broker-synchronized execution fields, including stored derived execution
metrics, remain protected; ordinary assistant writes cannot replace them.

Execution/psychology completion is explicit and requires closed trades plus all
required answers. Unanswered/null and deliberate false remain different. Rules
complete only against the exact applicable set and preserve immutable snapshots.
Uncompleted rule answers may explicitly be cleared to null; the previous answer
remains audited. Completed snapshots cannot be rewritten. All five quality grades
remain canonical. Unchanged timestamp fractions are preserved during unrelated
browser edits; UTC accepts Z and PostgreSQL's +00:00, not local offsets.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | PASS: 587 tests / 43 files |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` (executes `npm run test:db`) | PASS: 642 assertions / 17 suites |
| `npm run test:mcp-integration` | PASS: 21 real local OAuth/SDK/browser checks |
| `npm run test:integration-browser` | PASS: 53 existing MT5/auth/browser checks |
| `npm run test:mt5-python` | PASS: 176 tests |
| `npm run check:mt5-python` | PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: 32 generated pages plus dynamic routes; calculator stays static/public |
| `npm run replay:local-db` | PASS: empty-database guard, full local migration replay; hosted database untouched |
| `git diff --check` | PASS |

Runtime: Node 25.1.0, Python 3.13.2, Next.js 16.3.6, official MCP SDK 2.3.1,
Chrome 154.0.8037.93. Both legacy and 2026-07-28 MCP HTTP negotiation are tested.
Local Supabase Auth performs real consent, S256, refresh, resource binding,
revocation and browser-only logout; this is not mocked-token protocol evidence.

The existing local PostgreSQL diagnostic-hint crash workaround is temporary and
restored in finally. Every security assertion runs unchanged; none is skipped.
A fixture-lock wait previously exceeded the SQL-suite timeout; coordination now
has its own bounded 180-second timeout, with 60 seconds restored for actual SQL.
The approval-service usage interruption was retried through normal approval,
not bypassed. Transient fixture expectation/selector failures and the ledger
variable ambiguity were corrected before the passing run.

Hand-checked fixtures:

- Withdrawal 10.005 at USD precision2 becomes -10.01; retries have one effect.
- Snapshot balance1000 + unrealized0.20 = equity1000.20; contradictory evidence
  fails and snapshots do not affect authoritative balance.
- Final gross10.20 - commission0.10 - swap0.10 = net10.00; risk100 produces0.10R.
  A recorded partial exit yields PARTIAL_WIN only after final closure.
- Gross1.004 - fee0.005 = 0.999, normalized once to USD1.00, not0.99.
- Net+0.01 wins, net-0.01 loses, exact normalized zero is BREAK_EVEN even with
  partial exits. JPY precision0 and KWD precision3 are independently tested.
- 1001 × 0.01 contributes10.01 without drift/page loss; the browser ledger reads
  all1004 fixture adjustments. 9007199254740993.01 remains an exact string.
- A failed completion or audit leaves closure, correction, targets, versions,
  receipt and evidence unchanged. Stored opened_at21.333 seconds survives an
  unrelated browser review edit unchanged.

## Review and release boundaries

Plan alignment: PASS for the complete account-event/lifecycle/trade scope.
System integrity: PASS for shared services, decimal/UTC boundaries, ownership,
protected plans, explicit reviews and immutable evidence. React/imprint review
keeps existing theme tokens and records the management form in ui-registry.md.
Local readiness: PASS for the listed gates. No hosted migration, merge, MCP
activation, real broker order or collector-state change occurred in this scope.

Apply reviewed migrations before deploying the adapted browser code. Account
version metadata from the earlier account increment can invalidate an old MT5
ledger approval fingerprint; require fresh review, never rewrite old proof.
The private trade-version table avoids an additional full-trades-row schema change.
The real USD100K DEMO collector remains outside these fixture tests.

Full MCP release still requires the remaining inventory families, permanent
deletion confirmation, local stdio and the actual requested external-client
matrix. Hosted feature flags stay disabled pending those gates. Production
readiness and unavailable real-client verification are not reported as passed.
