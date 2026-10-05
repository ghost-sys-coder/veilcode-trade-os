# MT5 Synchronization Implementation Plan

Branch: `feature/mt5-sync`. Status: MT5-0 in progress; not operationally ready.
Authority: the user-approved plan and [shared roadmap](INTEGRATION_ROADMAP.md).

## Delivery checklist

- [ ] MT5-0: documentation/branches and authentication compatibility.
- [ ] MT5-1: verified actors, shared services, transactional storage/APIs.
- [ ] MT5-2: source reconstruction, finance, identity migrations and fixtures.
- [ ] MT5-3: collector, durable recovery and Windows startup.
- [ ] MT5-4: account onboarding, reconciliation and monitoring UI.
- [ ] MT5-5: full regression gates and 48-hour multi-account demo soak.

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
unit/integration/static checks. Require a 48-hour multi-account demo soak with
controlled interruptions. Record actual start/end, observations, versions and
results; do not manufacture elapsed-time evidence or mark unrun checks passed.

## Reference facts

- [Python integration](https://www.mql5.com/en/docs/python_metatrader5)
- [Position identity/reversal](https://www.mql5.com/en/docs/constants/tradingconstants/positionproperties)
- [Deal properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties)
- [Multiple terminal installations](https://www.metatrader5.com/en/terminal/help/start_advanced/start)
