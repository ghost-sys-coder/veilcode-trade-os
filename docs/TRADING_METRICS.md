# Trading Metrics

## Numeric conventions

All currency calculations use decimal arithmetic. PostgreSQL `numeric` values cross the Supabase boundary as strings. Final currency values are normalized to the account’s configured `currency_precision` using decimal round-half-up before persistence where appropriate, balance updates, display, and outcome classification.

Do not repeatedly round intermediate values. Market prices, volumes, percentages, R multiples, exchange rates, and pip values use their own precision rules.

Every analytical presentation includes the relevant sample size when omission could mislead.

## Net PnL

```text
net_pnl = gross_pnl - commission - swap - other_fees
```

Costs are entered as non-negative amounts and deducted. The finalized result is normalized to account-currency precision.

## Closed-trade outcome

Outcome is classified only after the complete canonical trade is closed and final net PnL is normalized:

- positive without partial exits: `WIN`
- negative without partial exits: `LOSS`
- positive with one or more partial exits: `PARTIAL_WIN`
- negative with one or more partial exits: `PARTIAL_LOSS`
- exactly zero, with or without partial exits: `BREAK_EVEN`

There is no near-zero tolerance initially. A profitable partial exit does not make a trade a `PARTIAL_WIN` if the complete trade finishes negative or zero. Persisted outcome and normalized `net_pnl` must agree; a conflict is flagged for correction.

## Planned risk percentage

```text
planned_risk_percentage = planned_risk_amount / account_balance_before_trade * 100
```

Calculate only when `account_balance_before_trade > 0` and planned risk is present. Preserve higher precision for the percentage; do not round it to currency precision.

Example: 250 USD risk on a 100,000 USD balance is `0.25%`.

## Planned risk-to-reward

```text
planned_risk_reward = planned_reward_amount / planned_risk_amount
```

Calculate only when planned risk is positive. Store the reward multiple (`2` for a displayed ratio of `1:2`).

## Actual R

```text
actual_r = net_pnl / planned_risk_amount
```

Calculate only when `planned_risk_amount > 0`. Use final normalized net PnL and the historical planned risk value applicable to the trade. R uses its own precision and is not currency-rounded.

Example: planned risk of 250 USD and net PnL of 500 USD produces `+2R`.

## Win rate

Winning trades are `WIN` plus `PARTIAL_WIN`. Losing trades are `LOSS` plus `PARTIAL_LOSS`.

```text
win_rate = winning_trades / (winning_trades + losing_trades) * 100
```

`BREAK_EVEN` trades are excluded from the denominator. If there are no winning or losing trades, win rate is undefined and displayed as “Not enough data,” not zero.

Always expose the numerator and denominator or sample size.

## Break-even rate

```text
break_even_rate = break_even_trades / all_closed_trades * 100
```

If there are no closed trades, the rate is undefined.

## Profit factor

```text
profit_factor = sum(positive net_pnl) / abs(sum(negative net_pnl))
```

- With positive profit and no losses, report infinity or “No losing trades”; do not divide by zero.
- With neither profit nor loss, the metric is undefined.
- Break-even trades contribute zero but remain part of the displayed closed-trade sample context.

## Dollar expectancy

“Dollar” is the conventional label; display the account currency in the UI.

```text
currency_expectancy = sum(net_pnl for closed trades) / closed_trade_count
```

This is the arithmetic mean final net PnL of all closed trades, including break-even trades.

## R expectancy

```text
r_expectancy = sum(actual_r) / count(trades with valid actual_r)
```

Only trades with positive planned risk and a calculable `actual_r` are included. This is the primary R-expectancy definition. Display its qualifying sample size separately from total closed trades.

## Average winner and loser

```text
average_winner = sum(positive net_pnl) / count(positive net_pnl trades)
average_loser = abs(sum(negative net_pnl) / count(negative net_pnl trades))
```

Average loser is displayed as a positive loss magnitude. Each metric is undefined if its bucket is empty.

## Drawdown

Use the chronological account-value series derived from starting balance, closed-trade PnL, and account adjustments. When events share a timestamp, use a deterministic secondary ordering.

At each point:

```text
high_water_mark = maximum account balance observed through this point
drawdown_amount = high_water_mark - current_balance
drawdown_percentage = drawdown_amount / high_water_mark * 100
```

Drawdown is zero at a new high. Percentage is undefined when the high-water mark is not positive.

### Maximum drawdown

The greatest `drawdown_amount` and its corresponding percentage across the chronological balance curve. Amount and percentage describe the same drawdown observation; do not independently maximize them from different points.

### Current drawdown

The difference between the latest derived balance and the historical high-water mark, with the corresponding percentage.

Optional equity snapshots may support a separate equity-drawdown analysis later. They do not replace the authoritative balance-drawdown series.

## Recovery factor

```text
recovery_factor = net_profit / abs(maximum_drawdown_amount)
```

If maximum drawdown is zero, the result is undefined rather than an arbitrary numeric value.

## Streaks

Order fully closed trades chronologically by `closed_at`, then stable identifier.

- Winning streak: maximum consecutive `WIN` or `PARTIAL_WIN` trades.
- Losing streak: maximum consecutive `LOSS` or `PARTIAL_LOSS` trades.
- `BREAK_EVEN` ends both streaks; it is neither a win nor a loss.

## Rule compliance

```text
rule_compliance_rate = trades_with_zero_violations / trades_reviewed_for_rules * 100
```

A trade is reviewed only when all applicable active rules have an explicit result. Also report the total count of individual violations. If no trades were reviewed, the rate is undefined.

## MFE and MAE

- Maximum Favorable Excursion (MFE): greatest favorable movement reached while a trade was open.
- Maximum Adverse Excursion (MAE): greatest adverse movement experienced while a trade was open.

Both are optional/manual initially and may be represented in currency, pips/points, or R. Each representation retains its own precision and units; missing values must not be treated as zero.

## Analytics date and population

Realized performance uses `closed_at`. A canonical trade contributes its final PnL, outcome, actual R, fees, streak result, and realized balance movement only when its status is `CLOSED` and the complete trade has a final close timestamp. A trade opened on one day and finally closed on another is attributed to the close date.

This does not change the journal-date convention, which remains `opened_at → planned_at → created_at`.

## Trading profit and account cash flow

Trading `net_profit` is the sum of normalized `net_pnl` for qualifying closed trades. Account adjustments are never included in trading net profit:

- deposits are not profit;
- withdrawals are not losses;
- balance corrections are not trading performance;
- `OTHER` adjustments remain account cash events even when their classification makes them performance-affecting for account analytics.

## Adjustment classification and cash-flow-neutral drawdown

`DEPOSIT`, `WITHDRAWAL`, and `BALANCE_CORRECTION` are always performance-neutral. A new `OTHER` adjustment requires an explicit classification:

- `is_performance_neutral = true`: change account cash and shift both the current balance basis and high-water-mark basis by the same amount;
- `is_performance_neutral = false`: change account value without shifting the prior high-water mark, so the movement can create a new high or drawdown;
- `is_performance_neutral = null`: allowed only for legacy `OTHER` records awaiting review.

When a relevant `OTHER` adjustment is unclassified, authoritative cash-flow-neutral drawdown, maximum drawdown, and recovery factor are unavailable. The UI must report the number of adjustments requiring classification rather than assuming either interpretation.

Classification changes use an ownership-checked database workflow and append an audit event. Direct classification-field updates are rejected.

## R-expectancy distribution cross-check

Primary R expectancy is the arithmetic mean of valid `actual_r` values. Its sample size is shown as qualifying R trades out of all closed trades. Missing R is excluded, never replaced with zero.

For the same valid-R population, verify the result with:

```text
(winning-R trade share × average winning R)
+ (losing-R trade share × average losing R)
```

Break-even trades remain in the valid-R population and contribute zero to the weighted result.

## Multi-account currency safety

Monetary analytics may be combined only for accounts with the same ISO currency code. Mixed-currency selections render separate monetary sections. Count-based and unitless metrics may combine currencies, but they are recalculated from the underlying trades; account-level percentages are never averaged.
