# Phase 03: Trade Journal and Account Tracking

## Objective

Turn manually recorded trades into a useful searchable journal and reliable account history.

Do not implement the full analytics suite yet.

## Trades Page

Create:

/trades

Use a professional shadcn Table or equivalent composition.

Display useful columns:

- date
- account
- instrument
- direction
- strategy
- setup
- session
- status
- outcome
- planned risk %
- planned RR
- net PnL
- actual R
- trade grade

Allow sorting where useful.

## Filters

Support:

- account
- date range
- instrument
- direction
- strategy
- setup
- session
- status
- outcome
- trade grade
- rule compliance
- tags

Keep filters usable.

Use shadcn Select, Popover, Command or suitable components.

## Search

Allow useful search across:

- instrument
- strategy
- setup
- notes
- thesis
- tags

Do not create inefficient wildcard queries without considering indexes.

## Trade Detail Page

Create:

/trades/[id]

Show the complete trade story.

Sections:

### Summary

- instrument
- BUY/SELL
- account
- date
- status
- outcome
- net PnL
- actual R
- grade

### Original Plan

- thesis
- strategy
- setup
- higher timeframe bias
- market condition
- planned entry
- planned stop
- planned target
- planned lot size
- planned risk amount
- planned risk %
- planned RR

### Actual Execution

- actual entry
- actual stop
- actual exit
- actual lot size
- holding duration
- commission
- swap
- fees

### Targets

Show TP1, TP2, TP3 and partial exits.

### Execution Quality

Show all execution review fields.

### Psychology

Show emotions and psychology notes.

### Rule Compliance

Show each rule and whether it was followed.

### Screenshots

Display grouped screenshots:

- before
- entry
- during
- exit
- post-review

Allow full-size inspection.

### Post-Trade Review

Show lesson, what worked, what failed and grade.

## Planned Versus Actual Comparison

Create a clear component comparing:

- planned entry vs actual entry
- planned stop vs actual stop
- planned target vs actual exit
- planned lot size vs actual lot size
- planned risk vs actual result
- planned RR vs actual R

Do not imply different units are directly comparable.

## Account Page

Create:

/accounts/[id]

Show:

- account name
- type
- broker
- platform
- starting balance
- derived current balance
- latest equity snapshot if available
- net trading PnL
- account adjustments
- status
- start date

## Account Balance Timeline

Create chronological balance history from:

- starting balance
- closed trade PnL
- adjustments

Ensure correct ordering.

If multiple trades close at the same timestamp, use deterministic tie-breaking.

## Account Adjustments UI

Allow manual:

- deposit
- withdrawal
- balance correction
- other adjustment

Require notes for BALANCE_CORRECTION.

Do not modify trade history to simulate deposits or withdrawals.

## Daily Journal

Create:

/journal/daily

Allow creating one daily log per account/day.

UI fields:

- trading date
- account
- market conditions
- mental state
- followed daily plan
- hit daily loss threshold
- stopped when required
- daily rating
- lessons
- notes

Automatically show derived day metrics beside the manual reflection:

- trades
- wins
- losses
- break evens
- daily net PnL
- daily R
- total planned risk
- rule violations

Do not require manual duplication of derived values.

## Weekly Review

Create:

/journal/weekly

Automatically summarize:

- starting balance
- ending balance
- net PnL
- return %
- total trades
- wins
- losses
- break evens
- win rate
- average R
- best trade
- worst trade
- rule violations

Manual fields:

- what worked
- what did not
- change next week
- behavior to stop
- behavior to continue
- notes

## Monthly Review

Create:

/journal/monthly

Automatically summarize available core data.

Manual fields:

- what worked
- what did not
- lessons
- focus next month
- notes

Full advanced monthly analytics comes later.

## Calendar View

Create:

/calendar

Show trading days in a monthly calendar.

For each day, where space permits show:

- daily PnL
- trade count
- wins/losses

Use clear positive, negative and neutral states without relying exclusively on color.

Selecting a day should reveal its trades and daily log.

## Tags

Allow tags to be:

- created
- edited
- assigned
- removed
- filtered

## Export

Provide basic CSV export for the user's own trade journal.

Include canonical important trade fields.

Do not implement CSV import yet.

## Corrections

Provide an explicit correction workflow where needed.

A corrected planned value should not erase the fact that a correction occurred.

Display corrected data sensibly without cluttering normal use.

## Empty States

Create useful empty states for:

- no trades
- no daily logs
- no screenshots
- no weekly reviews
- no monthly reviews

## Tests

Test:

- trade filtering
- account balance derivation
- adjustments
- chronological balance timeline
- daily aggregation
- weekly aggregation
- calendar grouping
- CSV export
- planned versus actual comparison
- account ownership
- RLS-sensitive workflows

## Acceptance Criteria

Phase 03 passes only when:

- trade journal is searchable
- filtering works
- trade detail is complete
- screenshots are reviewable
- planned versus actual is visible
- account balances are reproducible
- deposits/withdrawals do not corrupt trade history
- daily logs work
- weekly reviews work
- monthly reviews work
- calendar works
- CSV export works
- tests pass
- typecheck passes
- lint passes
- production build passes

Stop after Phase 03.
