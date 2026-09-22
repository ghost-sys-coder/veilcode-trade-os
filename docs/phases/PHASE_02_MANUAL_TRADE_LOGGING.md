# Phase 02: Manual Trade Logging

## Objective

Build the complete manual trade logging workflow.

This is the most important data-entry phase of the application.

The user must be able to manually record a planned trade, an open trade or a previously completed trade while preserving the distinction between planned and actual values.

Do not implement analytics dashboards yet.

## Core UX Requirement

The trade form contains many fields.

Do not present it as one giant undifferentiated form.

Use a clear multi-section workflow.

Possible sections:

1. Trade
2. Setup
3. Plan
4. Risk
5. Execution
6. Result
7. Psychology
8. Rules
9. Screenshots
10. Review

Use shadcn Tabs, Accordion, Card or another suitable structure.

Do not hide critical information unnecessarily.

## Draft Support

Allow the user to save a trade as DRAFT.

Do not lose manually entered information because the user navigates away.

## Trade Identification Section

Fields:

### Account

Helper text:

"Choose the trading account this trade belongs to. Account statistics and drawdown calculations will use this selection."

Required.

### Instrument

Helper text:

"Choose the market you traded, for example EURUSD, GBPUSD or XAUUSD."

Required.

Allow searching.

### Direction

Options:

- BUY
- SELL

Helper text:

"BUY means you expected price to rise. SELL means you expected price to fall."

Required.

### Trade Status

Support:

- DRAFT
- PLANNED
- OPEN
- CLOSED
- CANCELED

Explain each state.

### Order Type

Options:

- MARKET
- BUY_LIMIT
- SELL_LIMIT
- BUY_STOP
- SELL_STOP
- OTHER

Provide helper text.

### Planned Date/Time

Explain:

"When you planned or identified the trade."

### Opened Date/Time

Explain:

"When the trade was actually opened."

### Closed Date/Time

Explain:

"When the final part of the position was closed."

Store UTC.

Display the user's configured timezone.

### Trading Session

Options:

- ASIAN
- LONDON
- NEW_YORK
- LONDON_NEW_YORK_OVERLAP
- OTHER

Helper text:

"Select the trading session in which the trade was entered. This lets the application compare your performance across sessions."

## Setup Section

### Strategy

Select from user-defined strategies.

### Setup

Filtered where sensible by strategy.

### Primary Analysis Timeframe

Support at least:

- 1W
- 1D
- 4H
- 1H
- 30M
- 15M
- 5M
- 1M

### Entry Timeframe

Same supported timeframe system.

### Higher Timeframe Bias

Options:

- BULLISH
- BEARISH
- NEUTRAL
- MIXED
- NOT_RECORDED

Helper text:

"Your higher-timeframe directional view before entering the trade."

### Market Condition

Options:

- TRENDING
- RANGING
- BREAKOUT
- REVERSAL
- HIGH_VOLATILITY
- LOW_VOLATILITY
- MIXED
- OTHER

### Trade Thesis

Textarea.

Helper text:

"Explain what you believed the market was likely to do and why. Record the original idea so you can later compare your reasoning with the actual result."

### Entry Reason

Textarea.

Helper text:

"Describe the specific reason you entered at this point rather than earlier or later."

### Confirmation Notes

Textarea.

Helper text:

"Record the confirmation you used before entering, such as structure break, candle close, retest or rejection."

## Plan Section

### Planned Entry Price

Helper text:

"The price at which you intended to enter before the trade was executed."

### Planned Stop Loss

Helper text:

"The price at which your original trade idea would be considered wrong and you intended to exit."

### Planned Take Profit

Helper text:

"The main price target you intended to use before entering."

### Multiple Targets

Allow optional:

- TP1
- TP2
- TP3
- custom additional targets

For each target allow:

- planned target price
- planned position percentage to close

Validate total percentages sensibly.

### Planned Lot Size

Helper text:

"The position size you intended to trade. This is not leverage."

## Risk Section

### Account Balance Before Trade

Auto-populate from derived account balance where possible.

Allow explicit correction only through a clear workflow.

Helper text:

"Your account balance immediately before this trade. Risk percentage is calculated from this value."

### Planned Risk Amount

Example helper:

"If you are willing to lose no more than $250 if the stop is hit, enter $250."

### Planned Risk Percentage

Auto-calculate:

planned_risk_amount / balance_before × 100

If manually overridden, clearly mark the behavior.

Example helper:

"$250 risk on a $100,000 account equals 0.25%."

### Stop Distance

Calculate automatically where instrument metadata permits.

Show unit:

- pips
- points
- price distance

Do not fake pip calculations for instruments without proper metadata.

### Planned Reward Amount

Calculate where possible from price, size and target.

Allow manual value when automatic calculation is unsupported.

### Planned Risk-to-Reward Ratio

Automatically calculate where possible.

Helper text:

"Risk-to-reward compares the amount you planned to lose with the amount you planned to gain. Risking $250 to target $500 is 1:2."

Store numeric reward multiple, for example 2.0.

## Actual Execution Section

### Actual Entry

Keep separate from planned entry.

Helper text:

"The price at which the order actually filled."

### Actual Lot Size

Keep separate from planned lot size.

### Actual Stop Loss

If different from the original planned stop, record separately.

Do not overwrite the planned stop.

### Actual Exit

The final exit price for simple trades.

Partial exits are handled through targets/exits.

### Commission

### Swap

### Other Fees

Provide descriptive helper text.

## Result Section

When a trade is CLOSED:

### Outcome

Support:

- WIN
- LOSS
- BREAK_EVEN
- PARTIAL_WIN
- PARTIAL_LOSS

### Gross PnL

### Net PnL

Calculate:

gross_pnl - commission - swap - other_fees

Allow signed values consistently.

### Pips Result

Optional manual or calculated value.

### Actual R

Calculate:

net_pnl / planned_risk_amount

Show explanatory text.

Example:

"Planned risk was $250 and net profit was $500, so the trade returned +2R."

Do not calculate if planned risk is zero or missing.

### Holding Duration

Calculate from opened_at to closed_at.

### MFE

Optional manual fields:

- amount
- pips
- R

Explain clearly.

### MAE

Optional manual fields:

- amount
- pips
- R

Explain clearly.

## Execution Quality Section

Create yes/no or appropriate controls for:

### Entry According to Plan

"Did you enter where your plan said you should enter?"

### Stop According to Plan

"Did you initially place the stop where the plan required?"

### Target According to Plan

"Was the target based on your original plan?"

### Stop Action

- UNCHANGED
- MOVED_TO_BREAK_EVEN
- TIGHTENED
- WIDENED

Explain each option.

### Closed Early

"Did you exit before the planned target or invalidation for discretionary reasons?"

### Entered Early

"Did you enter before your required setup confirmation occurred?"

### Entered Late

"Did you enter after the intended entry opportunity had already moved away?"

### Chased Price

"Did you enter mainly because price was moving quickly and you feared missing the trade?"

### Added to Position

### Revenge Trade

"Was this trade influenced by an urge to quickly recover a previous loss?"

### Over-Risked

"Did you risk more than your planned or permitted amount?"

### Execution Rating

1 to 5.

Labels:

1 = Poor

2 = Weak

3 = Acceptable

4 = Good

5 = Excellent

Explain that this rates execution discipline, not whether the trade won.

### Execution Notes

## Psychology Section

### Confidence Before Entry

1 to 5.

Explain that confidence is subjective and used for later comparison, not as a quality score.

### Emotion Before

### Emotion During

### Emotion After

Use predefined values plus OTHER.

### Fear Influenced Trade

### Greed Influenced Trade

### FOMO Influenced Trade

### Psychology Notes

## Rule Compliance Section

Load active trading rules for the account/user.

For each rule show:

- rule name
- description
- complied yes/no
- optional note

Make rule descriptions visible.

Do not force inactive rules.

## Screenshot Section

Support drag/drop or file selection.

Categories:

- BEFORE_ENTRY
- AT_ENTRY
- DURING_TRADE
- AT_EXIT
- POST_TRADE_REVIEW

Each screenshot may include:

- timeframe
- captured_at
- caption

Store in Supabase Storage.

Show upload progress and errors.

## Post-Trade Review

For CLOSED trades allow:

### What Went Well?

### What Went Wrong?

### Would You Take This Trade Again?

Options:

- YES
- NO
- ONLY_WITH_CHANGES

### What Should You Do Differently Next Time?

### Lesson Learned

### Trade Quality Grade

- A
- B
- C
- D
- F

Helper text:

"Grade the quality of the decision and execution, not the financial result. A disciplined losing trade can receive an A. A lucky rule-breaking winner can receive a poor grade."

## Planned Data Protection

Once status changes to OPEN:

planned fields must not be silently overwritten.

If the user edits protected planned data:

- require explicit confirmation
- record that a correction occurred
- preserve enough audit metadata to understand the original and corrected value

Use the simplest reliable implementation.

## Automatic Calculations

Create tested deterministic services for:

- planned risk %
- net PnL
- actual R
- holding duration
- planned RR where data supports it
- stop distance where data supports it

Do not bury calculations in React.

## Form Validation

Use Zod.

Validate:

- required account
- required instrument
- valid direction
- sensible dates
- closed_at cannot precede opened_at
- planned risk cannot be negative
- lot sizes cannot be negative
- screenshot metadata
- ratings
- target percentages

Do not prohibit legitimate negative PnL.

## Usability

Because manual logging is repetitive:

- minimize unnecessary clicks
- preserve drafts
- use sensible defaults
- support keyboard navigation where reasonable
- make numeric inputs usable
- do not hide help text for unfamiliar metrics
- make required versus optional fields obvious

## Required Pages

Implement:

/trades/new

/trades/[id]/edit

Trade detail display may begin here if required for review, but full journal is Phase 03.

## Tests

Test:

- draft creation
- planned trade
- open trade
- closed winning trade
- closed losing trade
- break-even trade
- planned risk %
- net PnL
- actual R
- holding duration
- planned versus actual values
- protected planned data
- partial targets
- screenshot upload metadata
- rule results
- psychology
- execution review
- validation failures

## Acceptance Criteria

Phase 02 passes only when:

- complete manual trade form works
- draft saving works
- planned trade works
- open trade works
- closed trade works
- planned and actual values stay separate
- planned risk percentage is correct
- actual R is correct
- net PnL is correct
- screenshots upload successfully
- psychology can be recorded
- execution quality can be recorded
- trading-rule compliance can be recorded
- post-trade review works
- non-obvious fields contain descriptive help
- one React component per file is respected
- shadcn is used for standard UI
- tests pass
- typecheck passes
- lint passes
- production build passes

Stop after Phase 02.
