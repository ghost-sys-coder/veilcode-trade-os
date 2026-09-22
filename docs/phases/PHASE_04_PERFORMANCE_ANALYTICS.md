# Phase 04: Performance Analytics

## Objective

Build reliable trading performance analytics from persisted trade and account data.

Do not add AI interpretation.

Do not hardcode statistics.

Every metric must have an explicit documented definition and tests.

Read `docs/TRADING_METRICS.md` before implementation.

## Analytics Scope

Create:

/analytics

with deeper sections/routes where useful:

/analytics/overview
/analytics/instruments
/analytics/strategies
/analytics/setups
/analytics/sessions
/analytics/risk
/analytics/time

## Global Filters

Analytics must support filtering by:

- account
- date range
- instrument
- strategy
- setup
- session
- direction
- account type

Avoid duplicating calculation logic for every page.

Create shared analytics services.

## Core Metrics

Calculate:

- total trades
- closed trades
- wins
- losses
- break evens
- win rate
- break-even rate
- gross profit
- gross loss
- net profit
- total fees
- average winner
- average loser
- largest winner
- largest loser
- profit factor
- dollar expectancy
- R expectancy
- average R
- average winning R
- average losing R
- current drawdown
- maximum drawdown
- maximum drawdown %
- recovery factor
- current winning streak
- current losing streak
- maximum winning streak
- maximum losing streak
- average holding duration
- average planned risk %
- total rule violations where available
- rule compliance % where available

## Sample Size

Always expose relevant sample size.

Example:

Win Rate
71.4%
7 trades

Do not display a percentage without making the underlying number of trades discoverable.

## Dashboard

Create or enhance:

/dashboard

Top cards should include:

- current account balance
- net PnL
- return %
- closed trades
- win rate
- profit factor
- R expectancy
- average R
- maximum drawdown
- current streak

When multiple accounts are selected, make currency aggregation safe.

Do not sum different account currencies blindly.

Initially require same-currency grouping or display separate account values.

## Equity Curve

Create balance curve.

X axis:

chronological trade/close time.

Y axis:

derived account balance.

Support:

- balance curve
- cumulative PnL

Where sufficient valid R data exists, also support:

- cumulative R curve

## Drawdown Chart

Create a drawdown-over-time view.

Show:

- amount
- percentage

Do not confuse realized balance drawdown with intraday equity drawdown unless actual equity snapshots exist.

Name metrics precisely.

## Performance by Instrument

For each instrument show:

- trades
- wins
- losses
- win rate
- net PnL
- average R
- R expectancy
- profit factor

## Performance by Strategy

Same important metrics.

## Performance by Setup

Same important metrics.

This is one of the highest-value views.

## Performance by Session

Compare:

- Asian
- London
- New York
- London/New York overlap
- Other

## Direction Analytics

Compare:

- BUY
- SELL

## Time Analytics

Analyze:

- weekday
- month
- hour of entry where useful

Timezone must be handled consistently.

Use the user's selected display timezone.

## Risk Analytics

Create distributions or grouped metrics for:

- planned risk %
- planned RR
- actual R
- trade size if useful

Possible risk buckets:

- <= 0.25%
- > 0.25% to 0.50%
- > 0.50% to 1.00%
- > 1.00%

Make bucket definitions explicit and configurable where sensible.

## Holding Time Analytics

Analyze performance by duration buckets where enough data exists.

Do not create meaningless charts for tiny samples.

## Fees

Show:

- commission
- swap
- other fees
- total fees

Show how fees affect gross versus net results.

## Expected Value

Primary R expectancy:

average actual R across trades with valid R.

Also verify via:

(win rate × average winning R) + (loss rate × average losing R)

where losing R is negative and break-even handling is documented.

Tests should ensure consistent results.

## Profit Factor Safety

If there are no losing trades:

do not display a misleading normal numeric ratio.

Use a clear representation such as:

"No losing trades in selected sample"

or an appropriately modeled null/infinite state.

## Drawdown Algorithm

Create deterministic chronological high-water-mark logic.

Test:

- steadily rising balance
- simple drawdown
- recovery
- new high
- multiple drawdowns
- deposits/withdrawals

Account adjustments must not incorrectly appear as trading profit/loss.

Document how drawdown handles cash adjustments.

## Comparison Periods

Where practical support:

- current week vs prior week
- current month vs prior month

Do not make conclusions from tiny samples.

## Charts

Use shadcn chart components where available.

Do not hand-build chart primitives unnecessarily.

Charts should have:

- useful titles
- axis labels
- tooltips
- empty states
- sample size where relevant

Do not overdecorate.

## Analytics Performance

Avoid loading every database row into client JavaScript for large datasets.

Use appropriate server-side aggregation or efficient queries.

Keep architecture capable of scaling to thousands of trades.

## Tests

Test all critical metrics.

At minimum:

- win rate
- break-even rate
- gross profit
- gross loss
- net profit
- average winner
- average loser
- profit factor
- dollar expectancy
- R expectancy
- average R
- maximum drawdown
- current drawdown
- recovery factor
- streaks
- average risk
- account return %
- group-by instrument
- group-by strategy
- group-by setup
- group-by session
- group-by weekday
- empty dataset
- one trade
- all wins
- all losses
- only break-even trades
- mixed account adjustments

## Acceptance Criteria

Phase 04 passes only when:

- core analytics are implemented
- formulas match documentation
- dashboard shows useful account performance
- balance curve works
- cumulative R works when data supports it
- drawdown works
- instrument analysis works
- strategy analysis works
- setup analysis works
- session analysis works
- direction analysis works
- time analysis works
- risk analysis works
- sample sizes are visible
- multi-currency accounts are not incorrectly combined
- analytics are derived from stored data
- tests pass
- typecheck passes
- lint passes
- production build passes

Stop after Phase 04.
