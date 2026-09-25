# Manual Trade Workflow

## 1. Prepare the workspace

Create or select a `DEMO`, `PROP_CHALLENGE`, `FUNDED`, or `PERSONAL_LIVE` account. Confirm its ISO currency and currency precision before entering financial facts. Then define the strategy, setup, and trading rules that describe the process being practiced.

## 2. Record the plan

Create a trade in `DRAFT` or `PLANNED` state. Record the instrument, direction, planned timing, entry, stop, target, volume, risk amount/risk percentage, expected reward/R ratio, thesis, entry reason, and optional partial targets.

Planned risk is the currency amount intentionally at risk before entry. Risk percentage compares that amount with the account balance before the trade. Planned risk-to-reward is reward divided by risk; `2` means a displayed `1:2` plan.

Before opening, the normal edit flow may correct the plan. The journal date uses `opened_at`, then `planned_at`, then `created_at`.

## 3. Open and manage the trade

Opening the trade turns the plan into historical evidence. Normal forms may no longer silently change protected planned values. If a recorded plan fact was genuinely typed incorrectly, use **Correct recorded plan value**, give a meaningful reason, and preserve the append-only correction chain.

If the trading decision itself changes while the trade is open—moving a stop, scaling in, or taking a partial exit—record an execution/management event. That is not a plan correction.

Record actual entry, volume, optional maximum favorable excursion (MFE), maximum adverse excursion (MAE), and before-entry/at-entry screenshots. MFE is the greatest favorable movement while open; MAE is the greatest adverse movement. Missing observations stay missing rather than becoming zero.

## 4. Record behavioral evidence

Complete psychology, rule, and execution reviews explicitly. Placeholder rows and unanswered/default-false values do not count as reviewed.

A rule review captures the immutable applicable rule set and an explicit followed/broken result for every rule. Only a complete review with no violations is `FULLY_COMPLIANT`; a completed review with a broken rule is `VIOLATIONS_PRESENT`; incomplete evidence is `NOT_REVIEWED`.

Psychology flags preserve true, false, and unanswered until the section is explicitly completed. Trade grade (`A` through `F`) remains separate from profitability.

## 5. Close the canonical trade

Close only after the full position is finished. Enter the final close time, gross PnL, commission, swap, and other fees. Costs are non-negative inputs and are deducted:

```text
net PnL = gross PnL - commission - swap - other fees
```

The normalized account-currency result determines the outcome. Positive is `WIN` or `PARTIAL_WIN`; negative is `LOSS` or `PARTIAL_LOSS`; exact zero is `BREAK_EVEN`. Partial labels require at least one partial exit and describe the complete trade—not one profitable scale-out.

Actual R is normalized net PnL divided by positive planned risk. Missing/invalid planned risk leaves R unavailable; it is never substituted with zero.

## 6. Review and analyze

Complete the execution and post-trade reviews, add an exit screenshot, and verify the planned-versus-actual comparison. The account balance must reflect starting balance plus closed-trade net PnL plus adjustments.

Realized analytics use `closed_at`, so open trades do not contribute realized PnL, outcomes, R, or balance-curve placement. Review the trade in the journal/calendar, dashboard, instrument/strategy/setup/session/risk analytics, behavioral analytics, and daily/weekly/monthly reflections.

CSV export uses the complete currently filtered journal result set, not only the visible pagination page.

## 7. Prop and progress tracking

For a prop account, enter the provider's actual targets and loss limits rather than relying on hardcoded vendor rules. Balance-derived progress remains authoritative. Optional snapshots can show observed equity/unrealized PnL, and goals/status events preserve append-only history.

## Safety rules

- Never rewrite the original plan to make execution look better.
- Never count an unreviewed behavioral section as a negative answer or compliance.
- Never mix account currencies into one monetary total without explicit FX conversion.
- Never treat deposits, withdrawals, or balance corrections as trading profit.
- Keep screenshots private and use only authenticated/signed access.
