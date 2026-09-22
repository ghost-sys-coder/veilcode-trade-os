# Phase 00: Project Architecture and Contract

## Objective

Inspect or initialize the project, establish the architecture and document the domain before building functional trading features.

Do not build the complete application in this phase.

Read and follow the opening project contract.

## Repository Audit

Inspect:

- package manager
- Next.js version
- React version
- TypeScript configuration
- Tailwind configuration
- shadcn configuration
- Supabase configuration
- authentication
- testing framework
- lint configuration
- existing components
- directory structure
- environment handling
- existing reusable utilities

Reuse sound infrastructure.

Do not rewrite working code without justification.

## Greenfield Handling

If the repository is empty, initialize the required Next.js application using:

- App Router
- TypeScript
- Tailwind
- ESLint

Then configure shadcn/ui.

Do not build feature pages beyond what is necessary to confirm setup.

## Architectural Boundaries

Establish a structure approximately like:

src/
  app/
  components/
  features/
    accounts/
    trades/
    journal/
    analytics/
    psychology/
    rules/
    strategies/
    prop/
  domain/
    accounts/
    trades/
    analytics/
    risk/
  services/
  lib/
  hooks/
  config/
  types/

supabase/
  migrations/
  seed/

tests/

docs/

Adapt this where the repository already has a better convention.

## Core Domain Concepts

Document these concepts before implementation:

### User

Owns trading data.

### Trading Account

A specific demo, prop challenge, funded or live account.

### Instrument

A tradable market such as EURUSD, GBPUSD, USDJPY or XAUUSD.

### Strategy

A broad trading methodology.

Examples:

- liquidity continuation
- breakout
- reversal

### Setup

A repeatable setup inside a strategy.

Examples:

- liquidity sweep reversal
- break and retest
- trend continuation

### Trade

The canonical trading record.

### Trade Target

Optional TP1, TP2, TP3 or other partial exits.

### Trade Screenshot

Visual evidence captured before, during or after a trade.

### Trade Review

Post-trade qualitative analysis.

### Trading Rule

A user-defined rule such as maximum risk or minimum RR.

### Rule Result

Whether a trade followed or violated a trading rule.

### Daily Log

Manual reflection for one trading day.

### Weekly Review

Weekly reflection and summary.

### Monthly Review

Monthly reflection and summary.

### Account Adjustment

Deposits, withdrawals or manual balance corrections that are not trade PnL.

### Account Snapshot

Optional historical balance/equity snapshot.

### Prop Firm Configuration

Rules and targets for a prop challenge or funded account.

## Trade Lifecycle

Design canonical statuses:

- DRAFT
- PLANNED
- OPEN
- CLOSED
- CANCELED

Do not confuse financial outcome with trade status.

Closed trade outcomes must support:

- WIN
- LOSS
- BREAK_EVEN
- PARTIAL_WIN
- PARTIAL_LOSS

## Source Type

Prepare trades to support:

- MANUAL
- CSV
- MT4
- MT5
- BROKER_API

Only MANUAL is implemented initially.

## Financial Metric Definitions

Create `docs/TRADING_METRICS.md`.

Define precisely:

### Net PnL

gross_pnl - commission - swap - other_fees

### Planned Risk Percentage

planned_risk_amount / account_balance_before_trade × 100

### Actual R

net_pnl / planned_risk_amount

Only calculate if planned_risk_amount > 0.

Example:

planned risk = $250

net profit = $500

actual R = +2R

### Win Rate

Primary win rate:

wins / (wins + losses)

Break-even trades are shown separately.

Document this definition clearly.

### Break-Even Rate

break_even_trades / all_closed_trades

### Profit Factor

sum of positive net PnL / absolute value of sum of negative net PnL

Handle zero losses safely.

### Dollar Expectancy

average net PnL of closed trades.

### R Expectancy

average actual R of trades with valid planned risk.

This is the primary R expectancy definition.

### Average Winner

Average positive net PnL.

### Average Loser

Average absolute loss or clearly display negative average consistently.

Document the convention.

### Maximum Drawdown

Calculate from the chronological balance/equity high-water mark.

Store both:

- amount
- percentage

### Current Drawdown

Difference between current account value and historical high-water mark.

### Recovery Factor

net profit / absolute maximum drawdown

Handle zero drawdown safely.

### Winning Streak

Maximum number of consecutive winning closed trades.

### Losing Streak

Maximum number of consecutive losing closed trades.

### Rule Compliance Rate

Trades with no rule violations / trades that were reviewed for rule compliance.

Also track total number of individual violations.

### MFE

Maximum Favorable Excursion.

The maximum favorable movement achieved while the trade was open.

Initially optional/manual.

### MAE

Maximum Adverse Excursion.

The maximum adverse movement experienced while the trade was open.

Initially optional/manual.

## Planned Data Immutability

Document the rule:

Once a trade becomes OPEN, original planned values are considered historical evidence.

They must not be silently replaced.

If edited later, record:

- previous value
- new value
- changed_at
- reason where appropriate

The implementation may use audit metadata or explicit correction events.

Do not build a giant audit framework unnecessarily in Phase 00, but design for this requirement.

## Account Balance Philosophy

Do not make a mutable `current_balance` field the only source of truth.

Account performance should be reproducible from:

starting balance

plus closed trade net PnL

plus account adjustments

Current displayed balance may be cached later, but calculations must remain reproducible.

## Future Import Compatibility

Reserve conceptual support for:

- source_type
- external_trade_id
- import_batch_id
- external_raw_data where genuinely useful

Do not add unnecessary complexity if fields are not yet required.

Document how future imported data maps into the canonical Trade model.

## UX Philosophy

Desktop first.

Responsive for tablet and reasonable mobile viewing.

Manual logging must be fast despite the large number of fields.

Use progressive disclosure.

Prefer:

- sections
- tabs
- accordion panels
- clear helper text
- tooltips
- auto calculations

Avoid one giant unstructured form.

## Required Documentation

Create:

- docs/PROJECT_CONTRACT.md
- docs/ARCHITECTURE.md
- docs/TRADING_METRICS.md
- docs/DATABASE.md

## Environment

Create `.env.example`.

Prepare only relevant values, including:

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

Do not place actual secrets in the repository.

## Testing Setup

Ensure a testing framework is configured.

Prefer the existing framework.

If none exists, configure an appropriate lightweight TypeScript test framework such as Vitest.

Do not overbuild test infrastructure.

## Acceptance Criteria

Phase 00 is complete only when:

- repository architecture has been inspected
- shadcn is correctly configured
- Supabase architecture is documented
- project domain is documented
- trading metric formulas are documented
- database design direction is documented
- planned versus actual data rules are documented
- future import compatibility is documented
- strict TypeScript works
- lint works
- tests can run
- production build succeeds
- one React component per file remains mandatory

Do not implement trade logging yet.

Stop after Phase 00.
