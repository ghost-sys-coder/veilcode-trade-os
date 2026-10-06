# MT5 Synchronization Implementation Plan

Branch: `feature/mt5-sync`. Status: MT5-0 passed locally; MT5-1/2 in progress;
not operationally ready. Hosted rollout and actual terminal verification pending.
Authority: the user-approved plan and [shared roadmap](INTEGRATION_ROADMAP.md).

Hosted pilot update (2026-10-06): strict pooler TLS, actual user consent,
signed resource/account/grant checks, refresh rotation, wrong-PKCE rejection,
immediate revocation and fresh consent restoration have passed. Normal browser
login regression and terminal mapping are pending; broker history capture has
not started. See [hosted authentication evidence](MT5_HOSTED_AUTH_VERIFICATION.md).

## Delivery checklist

- [x] MT5-0: documentation/branches and local authentication compatibility.
- [ ] MT5-1: verified actors, shared services, transactional storage/APIs.
- [ ] MT5-2: source reconstruction, finance, identity migrations and fixtures.
- [ ] MT5-3: collector, durable recovery and Windows startup.
- [ ] MT5-4: account onboarding, reconciliation and monitoring UI.
- [ ] MT5-5: full regression gates and focused multi-account demo interruption checks.
  Mandatory 48-hour soak waiting was deferred by the user on 2026-10-05; no soak
  completion is claimed.

MT5-3 increment: protected renewable credentials, bounded native-worker supervision
and the local polling/heartbeat/reconciliation coordinator are implemented. New
spools start PAUSED; explicit attention survives restart. A new worker ID per
coordinator lifetime preserves laptop/VPS fencing without changing old operation
envelopes. Operational commands, loopback consent and explicit Task Scheduler
registration are implemented; actual startup installation/invocation and real-terminal
checks remain pending. Extended soak is deferred. Exact verification and limitations:
[credentials/supervision report](MT5_CREDENTIALS_SUPERVISION_VERIFICATION.md).

MT5-2/4 increment: canonical episode identity and trading-credit storage,
owner-only account mapping/monitoring, read-only history preview, balance bridge,
and audited fenced browser pause/resume are verified locally. The preview never
publishes trades, silently matches manual positions, changes a baseline, or
approves reconciliation. Approval/publication and classification workflows remain
pending. Exact results and limitations:
[onboarding/finance verification](MT5_ONBOARDING_FINANCE_VERIFICATION.md).

Subsequent MT5-2/4 increment: explicit selected-trade approval now publishes
eligible canonical OPEN/CLOSED records atomically with immutable source attribution,
execution revisions, approval evidence and operation receipts. This is verified
through the actual local browser and normal journal. Frozen PAUSED capture can be
approved without resuming a collector. Unclassified cash and conflicts stay staged;
onboarding/reconciliation and unattended publication are not approved by this action.
See [publication verification](MT5_PUBLICATION_VERIFICATION.md).

Further MT5-2/4 increment: explicit broker-symbol decisions now resolve aliases
and ambiguous catalog matches through typed private current mappings and
append-only correction history. Mapping requires an instrument and reason; every
decision checks the live owner/session/grant and source/version fingerprints.
Approved aliases preserve raw broker execution identity while using the selected
canonical instrument. Published aliases cannot be reassigned; manual overlaps
remain held. Mapping never changes financial units or approves reconciliation.
See [symbol-mapping verification](MT5_SYMBOL_MAPPING_VERIFICATION.md).

Further MT5-2/4 increment: cash movements now support explicit baseline-funding,
new-adjustment, existing-adjustment-link and normalized-zero decisions. Signed
source components are calculated centrally and corroborated by the database.
Fixed types are performance-neutral; OTHER needs an explicit true/false answer.
Financial facts become protected; OTHER interpretation changes retain the
existing audit workflow. Captured-history approval requires all executions
published, all cash resolved and a fresh exact-zero normalized balance bridge.
Its immutable proof becomes stale on changed source/ledger/checkpoint evidence.
It never resumes a paused collector or enables unattended canonical publication.
Revised cash, credit facilities and manual trade conflicts still require further
reconciliation workflows. See
[cash/onboarding verification](MT5_CASH_ONBOARDING_VERIFICATION.md).

Do not begin authenticated broker persistence until MT5-0 passes. A failed
authentication gate requires an explicit plan revision, not a static shared
secret, service-role exposure or unbound user token as a substitute.

## Architecture and account isolation

```text
Dedicated account terminal -> dedicated Python worker -> SQLite outbox
  -> authenticated /api/integrations/v1 endpoints
  -> staging/provenance + deterministic domain reconstruction
  -> private transactional RPCs -> canonical trades and account ledger
```

Use one terminal installation and worker per approved account. Leave the
existing manually operated/Claude-connected terminal unchanged. Bind owner,
Trade OS account, broker server, login and terminal installation explicitly;
verify currency/precision, demo/live status and hedging/netting mode.

An unexpected switch pauses the worker, never redirects data. New accounts
require explicit onboarding; do not assume Python enumerates saved logins.
Initial rollout is demo-only. Never implement or invoke broker order
placement, modification or cancellation, including during tests.

## Source storage and canonical identity

Store original broker orders/deals/observations as audited provenance, not
parallel source-specific trade models. Execution identity is connection plus
deal ticket. Canonical identity is connection plus position identifier plus
a deterministic directional-episode identity.

Scale-ins and partial exits remain within one episode until flat or reversal.
A reversal ends the old canonical trade and starts a new one even if MT5
retains the position identifier. Revise MT5-specific position/order unique
indexes and matching rules; retain other sources' existing safeguards.

Repeated observations update broker facts on the existing canonical record.
Changed source records preserve raw revisions and reconciliation audit.
Handle reversed/canceled deals explicitly rather than silently skipping a
known ID. Current ticket numbers, timestamps or symbols alone are not safe
canonical identities.

Stage manual matches, missing opening history, ambiguous symbol mappings
and unsupported events for review. Never close a trade solely because a
positions query fails or returns no rows. Require complete execution evidence.

## Monetary mapping and attribution

Convert broker numerics through validated decimal-string boundaries. Shared
TypeScript domain functions own authoritative calculations; PostgreSQL uses
`numeric`. Preserve separate currency, price and volume precision rules.

Existing commission/swap/other-fee columns remain non-negative costs. Add an
explicit non-negative trading-credit amount (default zero) and attribution:

`final net PnL = gross PnL - commission - swap - other fees + trading credits`

Broker credit facilities are not automatically trading credits or deposits.
For reversal deals assign closing profit/swap to the closing episode. Prefer
explicit broker allocation; otherwise split transaction-wide commission/fees
proportionally by closing/opening volume and label the allocation convention.
Keep intermediate precision and normalize only final money values.

Outcomes are assigned only after complete closure: positive normalized net
PnL is winning, negative losing, exactly zero break-even. Partial exits choose
the partial winning/losing labels only for the final complete trade. Open
trades contribute no realized PnL/R/results to canonical analytics.

Original planned values stay unknown unless evidence supports them. Do not
invent risk or copy the current stop into the original plan. Missing behavioral
answers/reviews remain missing. Management observations and later broker
execution updates do not create plan corrections or overwrite manual context.

## Onboarding and reconciliation

Default to all broker-available history and current positions. Preview and
approve per account: grouped trades, conflicts, cash movements, missing
history and proposed baseline. New accounts require a positive approved
opening baseline. Funding represented in that baseline stays source evidence
and is not also counted as an adjustment. Existing baselines are preserved;
discrepancies require explicit reconciliation.

Display observed broker balance/equity separately from the canonical
starting-balance + closed-PnL + adjustments ledger. Show the bridge for
already-recognized partial-exit cash/fees on still-open canonical trades.
Do not use unrealized PnL or account cash movements as trading net profit.

Confidently classified cash movements may become adjustments. Ambiguous
movements remain staged until classification. Fixed neutral adjustment
types retain their constraints; new OTHER entries need explicit true/false.
Preserve classification audits and the existing drawdown-unavailable behavior.
Incomplete history or unresolved financial effects are never called reconciled.

## Recovery defaults and runbook requirements

| Setting | Default |
| --- | --- |
| Poll interval | 15 seconds |
| Heartbeat | 30 seconds |
| Stale threshold | 120 seconds |
| Transient retry | Exponential backoff with jitter, capped at 60 seconds |
| Wider reconciliation | Daily, in addition to reconnect overlap |

SQLite stores account-scoped captured events and pending uploads. Server
checkpoints advance only after durable commit; unresolved rows must be
durably staged before progression. Lost acknowledgements cause safe replay.
The capture protocol now requires `collection: { id, index, count }` on every
batch (zero-based index, count 1..100000, at most 200 events per batch). The
collection checkpoint/count are frozen; an immutable slot is committed with
its source facts, receipt and audit. Only all declared slots advance the
server checkpoint. An original receipt is never rewritten after completion.
Operation lookup returns COMMITTED with that original result, or UNKNOWN at
the lookup's transactional observation. Unknown alone never authorizes a new
operation: recovery first needs a new server fence preventing old writes.
Reconnect, verify identity, replay uploads, retrieve overlapping history,
reconcile positions, then resume polling.

Use Task Scheduler at sign-in, single-instance protection, restart-on-failure
and a supervisor for stalled calls. Account/auth failures require attention,
not endless transient retries. Store renewable credentials in Windows-protected
storage outside Git/logs. Never restart or switch the user's shared terminal.

Server leases need fencing: an expired old worker cannot write after a
replacement laptop/VPS collector claims the connection. Reboot-before-login,
locked-session and RDP behavior require actual Windows verification. VPS
purchase/configuration is not included now.

The integration settings page must expose mapping, preview, conflicts,
classification, pause/resume, last heartbeat/successful sync, pending uploads
and actionable errors. The runbook must document install, consent, startup,
rotation/revocation, outage recovery, spool recovery and future VPS handover.

## Test matrix and acceptance

- Account isolation: concurrent accounts, reused tickets, switches, unknown
  accounts, broker-server/login differences and currency mismatches.
- Reconstruction: hedging, scale-ins, partial closes, full closes, reversals,
  close-by events, source revisions and missing entry history.
- Hand-calculated finance: fee deductions/credits, proportional reversal
  allocation, zero classification, multiple precisions and no decimal drift.
- Baselines: opening funding, historical imports, existing manual matches,
  incomplete history and partial-exit reconciliation without double-counting.
- Durable effects: replay, concurrent batches, changed operation-ID payloads,
  partial transaction rollback and committed-but-unacknowledged uploads.
- Fault injection: network loss, lag, worker crash, MT5 restart, sleep/wake,
  SQLite failure/recovery, expired leases and laptop/VPS overlap.
- Security: owner/non-owner/anonymous access, restricted OAuth clients,
  expired/revoked sessions, direct-write rejection and protected plans.
- Browser/regression: manual entry, reviews, analytics, screenshots, login and
  public calculator behavior unchanged.

Use disposable test databases and controlled demo terminals, never broker
orders or destructive production tests. Run all roadmap commands plus Python
unit/integration/static checks. The user removed the mandatory 48-hour waiting gate
on 2026-10-05 to prioritize same-day MT5 and MCP delivery. Run focused multi-account
demo interruption checks; retain extended soak as a deferred operational follow-up.
Record actual start/end, observations, versions and
results; do not manufacture elapsed-time evidence or mark unrun checks passed.

## Reference facts

- [Python integration](https://www.mql5.com/en/docs/python_metatrader5)
- [Position identity/reversal](https://www.mql5.com/en/docs/constants/tradingconstants/positionproperties)
- [Deal properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties)
- [Multiple terminal installations](https://www.metatrader5.com/en/terminal/help/start_advanced/start)
