# Future Import Adapters

## Current boundary

Phase 07 supplies the generic import foundation: account-scoped batches, staged rows, canonical mapping, validation errors, provenance, strong external identifiers, deterministic duplicate detection, explicit conflict states, RLS, and batch history. The CSV parser and mapping domain are tested, but no provider-specific commit UI is enabled.

No MT4/MT5 terminal bridge, live broker API, automated execution, or background synchronization is implemented.

## Required adapter contract

Every adapter must:

1. identify the authenticated user and destination account;
2. create a non-manual import batch with source/reference metadata;
3. preserve the original row/payload;
4. map fields into the canonical trade vocabulary;
5. parse decimals as validated strings, never JavaScript numbers;
6. normalize timestamps with explicit timezone semantics;
7. validate direction, lifecycle, price/volume precision, fees, and close completeness;
8. stage row errors without silently importing malformed data;
9. deduplicate with account + source + strongest available external ID;
10. require review for fingerprint-only matches or manual-trade conflicts;
11. persist canonical trades and row outcomes atomically;
12. retain a complete provenance link from canonical trade to source row and batch.

Imports may enrich broker execution facts. They may not silently erase manual thesis, psychology, screenshots, rule snapshots/results, reviews, grades, mistakes, or lessons.

## CSV enablement checklist

Before exposing CSV commit for a broker, obtain representative exports covering winners, losses, break-even, fees, swaps, partial closes, canceled/pending orders, and daylight-saving transitions. Confirm:

- delimiter, quoting, encoding, and duplicate-header behavior;
- source timezone and whether timestamps carry offsets;
- commission/swap sign conventions;
- whether one position produces multiple deal/order rows;
- stable trade, position, and order identifiers;
- symbol aliases and account-currency conversion fields;
- partial-close aggregation rules;
- corrected/reversed trade behavior.

Then add an explicit mapping preview, row-level errors, conflict review, a commit summary, and idempotent retry tests.

## MT4 and MT5 requirements

A safe MetaTrader integration needs an authenticated export/bridge with versioning, per-account identity, stable ticket/position/deal IDs, terminal/server timezone handling, symbol normalization, partial-deal aggregation, commission/swap capture, reconnect/retry semantics, and a durable checkpoint. MT4's order model and MT5's order/deal/position model require separate adapters even though both produce canonical trades.

The bridge must be read-only with respect to trading unless a separate future project explicitly authorizes execution. Secrets must remain server-side and be rotatable. Every retry must be idempotent.

## Broker API requirements

Review the provider's authentication, scopes, pagination, rate limits, webhooks, historical retention, correction events, and sandbox behavior. Prefer read-only scopes. Store external cursors and provider IDs in the import boundary, not in React state. Reconcile webhook and polling paths through the same staging/idempotency rules.

## Conflict policy

- `SKIP`: retain the staged row and explain why it was not imported.
- `REVIEW`: hold a possible match for user inspection.
- `LINK`: attach provenance to the confirmed canonical trade without overwriting protected manual evidence.
- `REPLACE`: available only with explicit confirmation and reason, within a narrowly defined transactional workflow.

Timestamp plus symbol is never sufficient for silent replacement. If a future adapter cannot provide a reliable external identifier, it must prefer review over automation.
