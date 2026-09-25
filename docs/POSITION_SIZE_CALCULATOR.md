# Position Size and Risk Calculator

Phase 08 adds a public, read-only calculator at `/tools/position-size-calculator` and an authenticated continuation endpoint at `/tools/position-size-calculator/continue`.

## Calculation contract

All authoritative arithmetic uses `decimal.js`. The engine lives in `domain/trading/position-sizing.ts`; React components collect inputs and display its result but do not implement formulas.

For a configured instrument:

- stop distance = `abs(entry - stop)`
- quote-currency loss per lot = `stop distance × contract size`
- account-currency loss per lot = `quote loss per lot × quote-to-account rate`
- raw volume = `risk amount ÷ account-currency loss per lot`
- recommended volume = raw volume floored to the configured volume step
- actual normalized risk = recommended volume × account-currency loss per lot
- reward = target distance × contract size × conversion rate × recommended volume
- estimated margin = volume × contract size × entry × conversion rate ÷ leverage

The engine never raises a sub-minimum raw volume to the instrument minimum. Sub-minimum and above-maximum results are explicit unavailable states. Leverage changes estimated margin, not the recommended position size.

## Conversion convention

The quote-to-account rate always means account-currency units per one quote-currency unit.

- account currency equals quote currency: rate is `1`
- account currency equals base currency: rate is `1 ÷ entry`
- otherwise: the user must provide an explicit manual rate

No live or synthetic rate is fabricated. A missing cross-currency rate blocks an authoritative result.

## Public instrument metadata

The initial public instrument specifications are immutable domain configuration in `domain/trading/instrument-specifications.ts`. They do not require anonymous database access. FX instruments use a 100,000-unit contract; XAUUSD uses 100 troy ounces. Initial volume limits are 0.01–100 lots in 0.01 steps. Price and pip precision remain instrument-specific.

## Calculator-to-trade transfer

The public calculator writes no database rows. On explicit user action it stores a versioned Zod-validated draft under `trade-os:position-calculator-draft` in `sessionStorage`. Drafts expire after 24 hours and contain no private account identifiers.

The continuation route checks Supabase claims server-side. Authenticated users continue to `/trades/new?from=position-calculator`; other users are sent to `/login` with a validated internal `next` path. Login and email-confirmation callbacks preserve only safe internal destinations.

The calculator page itself bypasses authentication middleware and remains statically rendered. Its header starts with a crawler-safe `Sign in` link and progressively enhances to `Open dashboard` only after an optional same-origin `/auth/status` request confirms a browser session. Authentication failure never blocks or hides the public calculator.

Inside the private workspace, the user must explicitly select an owned account. The same calculation engine reruns with that account's derived balance, currency, precision, and leverage while preserving the selected percentage or fixed-risk method. Currency differences require a new manual conversion rate where necessary. Only then are the existing manual-trade fields prefilled.

The calculator never saves automatically. Existing server validation, ownership checks, lifecycle rules, and the trade form remain authoritative. A saved calculator-originated record retains canonical source type `MANUAL`; calculator provenance is intentionally session/UI context only. The transfer draft is cleared after successful save or explicit discard.

## Future live-rate integration

A future quote service can supply timestamped quote-to-account rates to the existing engine. It must preserve the same rate direction, surface source and staleness, avoid falling back silently, and keep manual override/audit behavior explicit.
