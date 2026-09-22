# Phase 06: Prop Firm and Progress Tracking

## Objective

Add configurable prop-firm account tracking, goals, milestones and deeper progress review.

Do not hardcode changing prop-firm rules from the internet.

The user must manually configure the rules for their specific account.

## Prop Account Configuration

For accounts of type:

- PROP_CHALLENGE
- FUNDED

allow configuration of:

### Firm Name

Free text or user-managed reference.

### Model / Program

Examples may be manually entered.

### Phase

Examples:

- Challenge
- Verification
- Funded
- Master

Do not assume firm terminology.

### Profit Target

Support:

- percentage
- amount

### Maximum Daily Loss

Support:

- percentage
- amount

### Maximum Total Loss

Support:

- percentage
- amount

### Drawdown Type

Support configurable values such as:

- STATIC
- TRAILING
- OTHER

Do not attempt to implement every proprietary prop calculation automatically unless the necessary rule is explicitly defined.

### Consistency Limit

Optional.

### Minimum Trading Days

Optional.

### Maximum Trading Days

Optional.

### Notes

Allow the user to describe firm-specific rules not represented structurally.

## Prop Dashboard

Create a prop progress view.

For example:

Starting Balance
$100,000

Current Balance
$103,993.80

Net Profit
+$3,993.80

Profit Target
$10,000

Target Progress
39.94%

Display actual values from the configured account.

## Daily Loss Buffer

Where configured, show:

- daily loss limit
- realized loss today
- relevant current risk where available
- remaining buffer

Be very clear about whether the calculation is based only on logged closed trades or also manually entered equity/open risk.

Do not pretend to know broker equity if it has not been entered.

## Maximum Loss Buffer

Show:

- maximum total loss threshold
- current account drawdown relative to configured rule
- remaining buffer

Handle static versus trailing configurations carefully.

If trailing behavior is not fully implemented, do not display an authoritative value.

## Open Trade Limitations

Because manual logging may include OPEN trades, allow manually maintained:

- current unrealized PnL
- current account equity snapshot

Do not automatically invent unrealized PnL from entry price without market data.

## Consistency Tracking

If the configured account has a consistency rule, support:

best_day_profit / total_positive_profit_or_applicable_denominator

Only implement when the user provides the rule definition.

Show the exact formula being used.

Do not hardcode a FundingPips rule as universal.

## Trading Day Tracking

Track:

- unique trading days
- profitable days
- losing days
- break-even days

Allow configuration of what qualifies as a "profitable day" if necessary.

## Goal System

Create:

/goals

Support goals such as:

- total trades
- 25 trades
- 50 trades
- 100 trades
- account return %
- account balance
- cumulative R
- rule compliance %
- maximum drawdown threshold
- profitable days
- custom goal

## Milestones

Display progress toward goals.

Examples:

25 / 100 Trades

3.99% / 10% Account Return

86% / 90% Rule Compliance

Do not use gamification that encourages excessive trading.

A trade-count goal must not encourage taking low-quality trades.

Include appropriate wording such as:

"Trade count is a research sample milestone, not a target requiring extra trades."

## Practice Progress

Create a practice/research summary showing:

- number of trades
- number of reviewed trades
- days practiced
- cumulative R
- account return
- rule compliance
- current maximum drawdown
- strategy/setup sample sizes

## Weekly Review Enhancements

Add automatic observations such as:

- most traded instrument
- best-performing setup
- worst-performing setup
- most broken rule
- average risk %
- average execution rating

Keep these descriptive.

Do not produce prescriptive trading advice automatically.

## Monthly Review Enhancements

Show month-over-month:

- net PnL
- return
- R expectancy
- average R
- max drawdown
- rule compliance
- execution rating
- number of trades

## Account Lifecycle

Support account status transitions:

- ACTIVE
- PAUSED
- PASSED
- FAILED
- CLOSED

For prop challenge accounts, when status becomes PASSED:

do not automatically convert the same account into a FUNDED account.

Provide a workflow to create a new funded account linked to the previous account if desired.

Preserve challenge history.

## Linked Accounts

Allow optional parent/previous-account relation.

Example:

100K FTMO Challenge

→ passed

100K FTMO Funded

This preserves separate performance records.

## Failure Tracking

If a challenge is marked FAILED, allow recording:

- failure date
- reason
- notes

Possible reason categories:

- daily loss limit
- maximum loss
- time limit
- manual termination
- other

Do not delete the account.

## Tests

Test:

- profit target progress
- account return progress
- static daily loss calculations
- static maximum loss calculations
- consistency calculations where configured
- unique trading days
- profitable trading days
- goal progress
- account status transition
- linked challenge/funded accounts
- failure history
- missing equity data
- missing optional prop rules

## Acceptance Criteria

Phase 06 passes only when:

- prop configurations are editable
- no external firm rule is hardcoded as universal
- target progress works
- configured loss buffers work where mathematically supported
- uncertainty is clearly shown when open equity is unknown
- goals work
- milestones work
- account lifecycle works
- challenge-to-funded linking works
- weekly/monthly progress enhancements work
- tests pass
- typecheck passes
- lint passes
- production build passes

Stop after Phase 06.
