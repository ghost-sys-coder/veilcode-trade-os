# Phase 05: Execution, Psychology and Rule Analysis

## Objective

Turn execution quality, behavior, psychology and trading-rule compliance into measurable performance dimensions.

The goal is to determine whether trading behavior is helping or hurting results.

Do not treat psychology as a medical assessment.

This is trading behavior tracking only.

## Execution Analytics

Create:

/analytics/execution

Analyze fields including:

- entry according to plan
- stop according to plan
- target according to plan
- moved stop
- widened stop
- closed early
- entered early
- entered late
- chased price
- added to position
- revenge trade
- over-risked
- execution rating

For each category show where meaningful:

- trade count
- win rate
- average R
- R expectancy
- net PnL

Example question the UI should answer:

"How do trades where I entered early perform compared with trades where I followed my entry plan?"

## Rule Compliance Analytics

Create:

/analytics/rules

Show:

- total reviewed trades
- fully compliant trades
- non-compliant trades
- compliance %
- total individual violations
- most frequently broken rules

For each rule show:

- times evaluated
- times followed
- times broken
- break rate
- average R when followed
- average R when broken
- net PnL when followed
- net PnL when broken

Do not imply causation.

Present observed differences.

## Rule-Following Versus Rule-Breaking

Create a prominent comparison:

RULE-FOLLOWING TRADES

versus

RULE-BREAKING TRADES

Compare:

- trades
- win rate
- average R
- R expectancy
- profit factor
- net PnL

This is one of the most important analytics in the application.

## Psychology Analytics

Create:

/analytics/psychology

Analyze:

### Emotion Before Trade

Show performance grouped by:

- calm
- focused
- fearful
- excited
- frustrated
- impatient
- overconfident
- tired
- other

### Confidence

Group by confidence score 1 to 5.

Show:

- sample size
- average R
- win rate

Do not claim that high confidence predicts outcomes.

### FOMO

Compare FOMO-influenced versus non-FOMO trades.

### Fear

Compare fear-influenced versus non-fear trades.

### Greed

Compare greed-influenced versus non-greed trades.

### Revenge Trading

Compare flagged revenge trades with normal trades.

## Trade Quality

Create analytics by:

- A
- B
- C
- D
- F

Show whether objectively better-rated execution corresponds to better long-term outcomes.

## Outcome Versus Quality Matrix

Create a useful comparison such as:

- winning A trade
- losing A trade
- winning poor-quality trade
- losing poor-quality trade

The user should be able to distinguish:

good process / bad result

from

bad process / lucky result

## Mistake Tracking

Create a derived mistake taxonomy from recorded fields.

Examples:

- early entry
- late entry
- chased price
- stop widened
- early exit
- over-risked
- revenge trade
- FOMO
- rule violation

Create:

/analytics/mistakes

For each mistake show:

- count
- percentage of reviewed trades
- total PnL
- average R
- estimated observed impact

Do not invent counterfactual profit.

Do not claim:

"This mistake cost exactly $X"

unless the data genuinely supports that calculation.

Prefer:

"Trades with this mistake produced X net PnL and Y average R."

## Notes and Review Search

Allow searching post-trade review text and lessons.

Optional useful view:

Most recent lessons learned.

Do not use AI summarization.

## Daily Behavior

Enhance daily journal views with:

- rule violations that day
- execution ratings
- revenge/FOMO indicators
- day rating

Allow weekly review to surface:

- most common mistake
- rule most often broken
- average execution rating

## Descriptive UI

Every behavioral metric must explain what it means.

Example:

"Rule compliance rate is the percentage of reviewed trades where no enabled trading rule was marked as broken."

## Tests

Test:

- compliance rate
- rule-following vs rule-breaking grouping
- individual rule statistics
- execution flag grouping
- confidence grouping
- emotion grouping
- trade grade grouping
- mistake counts
- empty states
- partially reviewed trades

Do not treat missing review data as rule compliance.

Missing data must be distinguishable from "No violation."

## Acceptance Criteria

Phase 05 passes only when:

- execution analytics work
- rule analytics work
- psychology analytics work
- mistake analytics work
- trade quality analytics work
- missing behavioral data is handled correctly
- rule-following versus rule-breaking comparison works
- sample size is visible
- no medical or psychological diagnosis is made
- tests pass
- typecheck passes
- lint passes
- production build passes

Stop after Phase 05.
