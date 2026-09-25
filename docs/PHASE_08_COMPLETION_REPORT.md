# Phase 08 Completion Report

## 1. Public routes created

- `/tools/position-size-calculator` — statically rendered public calculator
- `/tools/position-size-calculator/continue` — server-side authentication bridge into the private trade form

## 2. Components created

- public route-group layout with Trade OS identity, theme control, and sign-in entry
- public position-size calculator
- authenticated calculator reconciliation bridge
- successful-save transfer cleanup component

Each new React file exports one component.

## 3. Domain calculation services created

`domain/trading/position-sizing.ts` owns deterministic position sizing, currency conversion, pip distance, volume normalization, reward, and margin calculations. `domain/trading/calculator-transfer.ts` owns the versioned Zod transfer contract and expiry validation.

## 4. Instrument metadata changes

Added domain-owned public specifications for EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, EURJPY, GBPJPY, EURGBP, GBPCHF, CADJPY, and XAUUSD, plus eight supported account currencies and explicit currency precision.

## 5. Database migrations

None. The public calculator performs no anonymous database access and the private record remains a canonical manual trade.

## 6. Position-size formula

Implemented risk amount divided by converted loss per lot. Percentage risk derives from the reconciled balance; fixed risk preserves the explicit fixed amount.

## 7. Currency conversion

Quote-to-account convention is account-currency units per one quote-currency unit. Quote currency uses 1, base currency uses the reciprocal entry price, and cross-currency cases require an explicit manual rate. Missing rates block the result.

## 8. Pip calculation

Stop distance uses absolute price distance divided by the instrument-specific pip size. Price and pip precision stay separate from monetary precision.

## 9. XAUUSD implementation

XAUUSD uses contract size 100, pip size 0.01, price precision 2, and the same risk-safe volume pipeline as FX.

## 10. Volume normalization

Raw volume is floored to the configured step. Below-minimum results are never silently raised; above-maximum results are never silently capped. Both block an authoritative recommendation and explain the boundary.

## 11. Margin calculation

Estimated margin uses normalized volume, contract size, entry, quote-to-account conversion, and leverage. Leverage does not affect recommended position size.

## 12. Public authentication exclusions

The calculator is outside the authenticated `(app)` layout and returns HTTP 200 without a user session. Private routes retain their existing server-side `requireUserId` protection.

## 13. Conversion-loop architecture

The public CTA stores the valid plan locally, the continuation route checks authentication, login preserves a validated internal return destination, and the private bridge requires explicit account selection before recalculating with account-owned facts.

## 14. Session-storage payload schema

Key: `trade-os:position-calculator-draft`. Version: 1. Validation: Zod. Lifetime: 24 hours. Scope: current browser tab/session. No account IDs or other private identifiers are stored by the public tool.

## 15. Trade-field mappings

- symbol → owned instrument ID
- direction → direction
- entry → planned entry
- stop → planned stop loss
- target → planned take profit
- normalized volume → planned lot size
- normalized actual risk → planned risk amount
- normalized reward → planned reward amount

The final persisted `source_type` remains `MANUAL`.

## 16. Account reconciliation behavior

The user must explicitly choose an account. Reconciliation reruns the same domain engine with derived balance, currency precision, and account leverage. Percentage risk recalculates from the account balance; fixed risk retains its method and value. A changed currency requires a fresh manual conversion when it is neither base nor quote.

## 17. Tests created

Added deterministic unit coverage for FX and XAUUSD, quote/base/cross conversions, BUY and SELL validation, percentage and fixed risk, minimum/maximum/step handling, JPY precision, reward, margin, leverage independence, transfer expiry, safe redirects, and private reconciliation behavior.

## 18. Test results

12 test files passed; 100 tests passed. The integration suite covers account-balance recalculation, percentage and fixed-risk preservation, and changed-currency conversion blocking.

## 19. Typecheck result

Passed: `tsc --noEmit`.

## 20. Lint result

Passed: ESLint with zero errors and zero warnings.

## 21. Production build result

Passed: Next.js 16.3.6 Turbopack production build. The public calculator is emitted as a static route and the auth continuation as a dynamic server route.

## 22. Known limitations

- Initial instrument coverage is intentionally limited to the documented public configuration.
- Cross-currency conversion is manual; no live quote feed is inferred.
- Broker-specific contract or lot constraints that differ from the public specification require a future metadata source.
- Calculator provenance is intentionally not persisted in Phase 08.

## 23. Future live conversion-rate integration

A future rate adapter can provide timestamped conversion values to the existing calculation engine without changing its formula. It should expose provider, quote timestamp, staleness, and rate direction; fail closed when unavailable; and keep manual override explicit.

## Verification evidence

- unauthenticated HTTP request to the public route returned 200 and rendered the calculator content
- browser-tested in light and dark themes
- browser-tested EURUSD calculation: USD 10,000 at 1% risk, 50-pip stop → 0.20 lots and USD 100 actual risk
- browser-tested authenticated handoff and explicit account selection
- browser-tested reconciliation: USD 100,450 account at 1% risk → 2.00 lots and USD 1,000 actual normalized risk
- browser console: no errors or warnings
- no database write was performed during calculator or reconciliation verification

PHASE_08_VALIDATED
