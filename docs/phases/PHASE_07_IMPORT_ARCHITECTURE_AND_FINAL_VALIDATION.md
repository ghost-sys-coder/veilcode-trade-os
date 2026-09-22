# Phase 07: Import Architecture and Final Validation

## Objective

Prepare the application for future external trade imports, validate the complete manual workflow and harden the product for regular demo and eventual live use.

Do not build automated trade execution.

Do not connect to a live broker unless separately requested in a later project phase.

## Import Architecture

Create a clean import framework capable of later supporting:

- CSV
- MT4
- MT5
- broker APIs

Only implement a safe generic architecture and optionally CSV import if it can be completed reliably within this phase.

Do not implement fragile MT4/MT5 bridges in this phase.

## Import Batch Model

Create an import_batches model if not already present.

Include:

- id
- user_id
- account_id
- source_type
- filename or source reference
- started_at
- completed_at
- status
- total_rows
- imported_rows
- skipped_rows
- failed_rows
- notes

## Canonical Mapping

All imported trades must map into the same canonical trade schema used by manual trades.

Do not create separate permanent trade tables for MT5 trades versus manual trades.

Imported records may retain:

- external_trade_id
- external_order_id
- external_position_id
- external_raw_data
- source_type
- import_batch_id

## Deduplication

Design deterministic duplicate detection.

Potential keys may include:

- account
- source
- external trade ID

Do not rely only on timestamp and symbol if a reliable external identifier exists.

## Conflict Handling

If an imported trade appears to match an existing manual trade:

do not silently overwrite it.

Provide one of:

- skip
- review conflict
- link
- explicitly replace with confirmation

Preserve data provenance.

## CSV Import

If implementing CSV now:

Create a mapping step.

The user should be able to map columns such as:

- symbol
- direction
- open time
- close time
- entry
- exit
- stop
- target
- volume
- profit
- commission
- swap

Validate before committing.

Show preview.

Show errors by row.

Never import malformed financial data silently.

## Manual Data Priority

Existing reviewed manual data must not be casually overwritten by imported broker data.

Examples:

- thesis
- psychology
- screenshots
- rule review
- trade grade
- lessons

Broker imports should enrich execution facts, not erase manual reflection.

## Full Product Audit

Audit all implemented phases.

### Account Audit

Verify:

- demo accounts
- prop challenge accounts
- funded accounts
- personal live accounts
- balances
- adjustments
- status changes

### Trade Audit

Verify:

- draft
- planned
- open
- closed
- canceled
- win
- loss
- break-even
- partial outcomes
- partial targets

### Planned Versus Actual Audit

Verify no normal edit flow silently destroys original planned data.

### Analytics Audit

Verify all important formulas against known fixtures.

### Rule Audit

Verify missing rule review is not treated as compliance.

### Psychology Audit

Verify missing psychology data does not create fake categories.

### Screenshot Audit

Verify authorization and private file access.

### RLS Audit

Verify users cannot access another user's records.

### React Audit

Inspect all React files.

No file may contain more than one React component.

Fix violations.

### shadcn Audit

Inspect custom UI primitives.

Where an appropriate shadcn component exists, use it instead of unnecessary hand-built equivalents.

Do not replace domain-specific components merely for the sake of replacement.

### TypeScript Audit

Remove avoidable `any`.

Fix unsafe assumptions.

### Responsive Audit

Verify the application is excellent on desktop and usable on tablet/mobile.

Manual trade entry must remain workable on smaller screens.

## Descriptive Field Audit

Inspect every trade-entry and configuration form.

Every non-obvious field must contain useful explanation.

Specifically verify descriptions for:

- planned risk
- risk %
- risk-to-reward
- actual R
- MFE
- MAE
- profit factor
- expectancy
- drawdown
- rule compliance
- execution rating
- trade grade

Do not accept acronym-only labels.

## Accessibility

Verify:

- labels are associated with controls
- keyboard use is reasonable
- buttons have clear names
- color is not the only status indicator
- dialogs can be navigated correctly
- error messages are understandable

## Performance

Verify common pages do not cause unnecessary full-table client downloads.

Review:

- trade list
- dashboard
- analytics
- screenshots
- filters

Use pagination where appropriate.

## Final Pages

Confirm the product provides:

/dashboard

/trades

/trades/new

/trades/[id]

/calendar

/accounts

/accounts/[id]

/analytics

/analytics/instruments

/analytics/strategies

/analytics/setups

/analytics/sessions

/analytics/risk

/analytics/execution

/analytics/rules

/analytics/psychology

/analytics/mistakes

/journal/daily

/journal/weekly

/journal/monthly

/rules

/strategies

/setups

/goals

/settings

Routes may be organized slightly differently if architecture is cleaner, but all capabilities must exist.

## Final Test Fixtures

Create deterministic fixtures covering:

### Seven-Trade Example

Use a test-only fixture based on:

Wins:

1500
845.92
557.47
1200
650

Losses:

400
359.59

Expected:

gross profit = 4753.39

gross loss = 759.59

net profit = 3993.80

wins = 5

losses = 2

trade count = 7

win rate = 5 / 7 when no break-even trades exist

profit factor approximately 6.2576

average winner = 950.678

average loser magnitude = 379.795

average PnL per trade = approximately 570.542857

Do not use this as production user data.

Use it only as a deterministic analytics test fixture.

### Drawdown Fixture

Create known sequences and expected drawdowns.

### R Fixture

Create known planned risks and net PnL and verify actual R.

### Rule Compliance Fixture

Create compliant, violating and missing-review trades.

## Documentation

Finalize:

README.md

docs/PROJECT_CONTRACT.md

docs/ARCHITECTURE.md

docs/TRADING_METRICS.md

docs/DATABASE.md

Add:

docs/MANUAL_TRADE_WORKFLOW.md

docs/FUTURE_IMPORTS.md

## README

Document:

- project purpose
- stack
- setup
- environment variables
- Supabase setup
- migrations
- seed process
- development command
- testing
- production build
- Vercel deployment
- screenshot storage
- manual trade workflow
- accounts
- analytics
- prop configuration
- import architecture
- known limitations

## Final Automated Checks

Run:

- TypeScript typecheck
- lint
- unit tests
- integration tests
- production build

Do not declare completion with failing critical checks.

## Final End-to-End Manual Test

Verify this exact flow:

1. Sign in.

2. Open the 100K Demo Practice account.

3. Create a strategy.

4. Create a setup.

5. Create trading rules.

6. Start a new trade.

7. Enter planned trade values.

8. Save as PLANNED.

9. Open the trade.

10. Enter actual execution data without destroying the plan.

11. Upload a before-entry screenshot.

12. Upload an at-entry screenshot.

13. Record psychology.

14. Record rule compliance.

15. Close the trade.

16. Enter result and fees.

17. Verify actual R.

18. Complete execution review.

19. Complete post-trade review.

20. Add an exit screenshot.

21. Open trade detail.

22. Verify planned-versus-actual comparison.

23. Verify account balance changes.

24. Verify trade appears in calendar.

25. Verify dashboard analytics update.

26. Verify instrument analytics update.

27. Verify strategy/setup analytics update.

28. Verify execution analytics update.

29. Verify rule analytics update.

30. Verify psychology analytics update.

31. Complete a daily log.

32. Complete a weekly review.

33. Configure a prop challenge account.

34. Verify prop target tracking.

35. Export trade data.

## Final Delivery Report

Report:

1. what was built

2. architecture

3. database tables

4. RLS policies

5. pages/routes

6. financial metrics implemented

7. trade-entry workflow

8. screenshot workflow

9. analytics

10. behavioral analytics

11. prop tracking

12. import architecture

13. tests created

14. test results

15. typecheck result

16. lint result

17. build result

18. environment variables

19. known limitations

20. future MT5 integration requirements

21. exact commands needed to run locally

22. exact deployment requirements

Finish with exactly one:

READY_FOR_MANUAL_TRADING_PRACTICE

or

NOT_READY_FOR_MANUAL_TRADING_PRACTICE

Only return READY_FOR_MANUAL_TRADING_PRACTICE if the complete manual workflow, persistence, analytics and account calculations are functioning correctly.
