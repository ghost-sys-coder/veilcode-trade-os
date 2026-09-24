# Phase 06 Completion Report

## Delivered

- Added `/prop` for user-configured prop challenge and funded-account progress.
- Added `/goals` for derived standard goals and append-only custom progress events.
- Added explicit amount/percentage rule modes, loss bases, balance/equity measures, drawdown type, consistency formula, trading-day timezone, and profitable-day threshold.
- Added manual balance/equity/unrealized-PnL snapshots with the exact equation enforced by PostgreSQL.
- Added static daily and maximum loss buffers with clear unavailable states for missing equity and undefined trailing/custom mechanics.
- Added consistency and trading-day calculations using the approved `opened_at` and `closed_at` conventions.
- Added cash-flow-neutral maximum drawdown to the practice summary. Unclassified `OTHER` adjustments make the result unavailable.
- Added atomic account lifecycle transitions with append-only status history, structured failure reasons, and challenge-to-funded account linking.
- Added automatic weekly observations and month-over-month review evidence.
- Removed status changes from ordinary account edits so lifecycle changes cannot bypass the audit workflow.

## Data integrity and security

- RLS is enabled for goal-progress and status-event history.
- Normal application roles can select/insert custom progress but cannot update/delete history.
- Goals with progress history cannot be deleted; they must be retained or made inactive.
- Manual progress is database-restricted to `CUSTOM` goals.
- Prop configuration is database-restricted to `PROP_CHALLENGE` and `FUNDED` accounts.
- Trading-day timezones are validated as IANA timezone names in both the application and database.
- Direct account-status updates are rejected; the approved RPC records the transition and account update atomically.
- Relevant Phase 06 ownership/history foreign keys have covering indexes.

## Verification

- Unit tests: 65 passed.
- Database/RLS pgTAP: 90 passed.
- TypeScript: passed.
- ESLint: passed with no warnings.
- Next.js production build: passed, including `/prop` and `/goals`.
- Browser smoke test: `/prop` rendered authenticated navigation and the valid empty state without an error overlay or console errors. The new routes also return a clean `/login` redirect for unauthenticated requests without querying protected tables.

## Explicit limitations

- `TRAILING` and `OTHER` drawdown rules are recorded but intentionally not presented as authoritative calculations until their exact mechanics are defined.
- `OTHER` consistency formulas are recorded but intentionally not calculated automatically.
- Equity and unrealized PnL remain manual snapshots; balance remains the authoritative historical performance curve.
