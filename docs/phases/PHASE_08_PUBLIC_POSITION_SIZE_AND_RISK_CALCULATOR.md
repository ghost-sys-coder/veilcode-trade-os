# Phase 08: Public Position Size and Risk Calculator

## Objective

Add a professional public position size and risk calculator to Trade OS.

The calculator must be fully usable without authentication.

It must allow a trader to calculate an appropriate position size using:

- account balance
- account currency
- instrument
- direction
- entry price
- stop-loss price
- selected risk
- optional take-profit price
- optional leverage

The calculator must reuse deterministic Trade OS domain logic.

Do not place financial formulas directly inside React components.

The calculator must also provide a conversion flow that allows a visitor to carry a completed calculation into the authenticated Trade OS manual trade logging workflow.

The intended flow is:

```text
Public Position Calculator
        ↓
Calculate position
        ↓
Log this trade in Trade OS
        ↓
Sign in / Sign up if needed
        ↓
Select actual Trade OS account
        ↓
Recalculate against actual account
        ↓
Prefill manual trade form
        ↓
User reviews and completes trade details
        ↓
Explicitly save trade
```

The calculator must never require authentication merely to calculate a position.

Do not implement automated trade execution.

Do not implement trading signals.

Do not implement AI trading recommendations.

---

## Existing Project Contract

Before implementation, read and preserve:

- `docs/PROJECT_CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/TRADING_METRICS.md`
- `docs/DATABASE.md`
- all relevant existing implementation documentation
- all Phase 00 through Phase 07 architecture decisions

Do not replace established:

- monetary architecture
- decimal arithmetic
- authentication architecture
- account architecture
- canonical trade architecture
- planned-value correction architecture
- analytics definitions
- Supabase ownership model
- RLS protections

---

## Technology Rules

Continue using the existing Trade OS stack:

- Next.js App Router
- React
- strict TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase
- Zod
- existing decimal arithmetic library
- existing test framework

---

## Mandatory React Rule

Use no more than one React component per file.

Do not define local helper React components inside another React component file.

Non-React helpers, constants, schemas and types may be colocated where appropriate.

---

## Mandatory shadcn Rule

Use shadcn/ui wherever an appropriate standard component exists.

Do not manually recreate:

- Button
- Card
- Input
- Select
- Form
- Tabs
- Tooltip
- Alert
- Badge
- Separator
- Accordion
- Dialog
- AlertDialog
- Skeleton
- Popover
- Sheet

or other available shadcn primitives.

Domain-specific calculator components should compose shadcn primitives.

---

# Public Route Architecture

## Required Public Route

Create:

`/tools/position-size-calculator`

This route must be accessible while logged out.

It must not require:

- Supabase authentication
- a Trade OS account
- a configured trading account
- access to private trading records

Existing private routes must remain protected.

---

## Public and Private Boundary

Preserve this conceptual boundary:

```text
PUBLIC

/tools/position-size-calculator

        ↓ optional conversion

AUTHENTICATION

        ↓

PRIVATE TRADE OS

/trades/new
/accounts
/trades
/journal
/analytics
...
```

Do not weaken authentication middleware for private Trade OS routes.

Explicitly permit only the intended public route or route group.

---

## Public Layout

The public calculator should not render the authenticated Trade OS workspace sidebar.

Create or reuse an appropriate public layout.

The page should contain:

- Trade OS branding
- calculator title
- concise explanation
- calculator form
- results panel
- educational explanations
- sign-in link
- conversion CTA
- concise risk disclaimer

The visitor should clearly understand that the calculator is public while the journal and account features are private.

---

# Calculator Inputs

## Account Balance

Required.

Example:

`50000`

Helper text:

> Your account balance before the trade. Trade OS uses this to determine the amount represented by your selected risk.

Validation:

- must be greater than zero
- must use decimal-safe parsing

---

## Account Currency

Required.

Use ISO currency codes.

Support at minimum:

- USD
- EUR
- GBP
- JPY
- AUD
- CAD
- CHF
- NZD

Do not assume USD internally.

The architecture must support adding additional currencies later.

---

## Risk Method

Required.

Options:

- `PERCENTAGE`
- `FIXED_AMOUNT`

Preserve this choice because the conversion workflow must know which value is authoritative later.

---

## Risk Percentage

Displayed when risk method is `PERCENTAGE`.

Example:

`0.5`

meaning:

`0.5%`

Helper text:

> The percentage of your account you are prepared to lose if the stop loss is reached. For example, 0.5% of a $50,000 account is $250.

Calculate:

```text
risk amount =
account balance × risk percentage ÷ 100
```

Use decimal arithmetic.

---

## Fixed Risk Amount

Displayed when risk method is `FIXED_AMOUNT`.

Example:

`250`

Helper text:

> The maximum amount of account currency you intend to lose if the stop loss is reached.

Calculate the equivalent percentage:

```text
risk percentage =
fixed risk amount ÷ account balance × 100
```

---

## Instrument

Required.

Reuse the existing Trade OS instrument model wherever possible.

Support at minimum:

- EURUSD
- GBPUSD
- USDJPY
- USDCHF
- USDCAD
- EURJPY
- GBPJPY
- EURGBP
- GBPCHF
- CADJPY
- XAUUSD

Do not implement independent hardcoded formulas per symbol unless the instrument specification genuinely requires special treatment.

---

## Direction

Required.

Options:

- BUY
- SELL

Helper text:

> BUY means you expect price to rise. SELL means you expect price to fall.

---

## Entry Price

Required.

Helper text:

> The price at which you plan to enter the trade.

Use instrument-specific price precision.

---

## Stop-Loss Price

Required.

Helper text:

> The price at which you plan to exit if the trade idea is wrong.

Validation:

For BUY:

`stop loss < entry`

For SELL:

`stop loss > entry`

Do not silently calculate from an invalid directional stop.

---

## Take-Profit Price

Optional.

Helper text:

> Your planned profit target. If supplied, Trade OS will calculate the potential reward and planned risk-to-reward ratio.

Validation:

For BUY:

`take profit > entry`

For SELL:

`take profit < entry`

---

## Account Leverage

Optional.

Input convention:

For:

`1:100`

the user enters:

`100`

For:

`1:30`

the user enters:

`30`

Helper text:

> Leverage affects the approximate margin your broker may reserve. It does not determine how much of your account you should risk.

Leverage must not change the risk-based position size.

Leverage is used only for margin estimation.

---

# Precision and Arithmetic Rules

## Authoritative Arithmetic

Do not use JavaScript `number` arithmetic for authoritative financial calculations.

Use the project's established decimal arithmetic utilities.

Use the existing monetary architecture.

---

## Separate Precision Domains

Keep separate precision rules for:

- money
- prices
- lot size / volume
- percentages
- exchange rates
- pip values
- R multiples
- contract specifications

Do not normalize all values to account-currency precision.

---

## Monetary Normalization

Maintain higher internal precision during calculations.

Normalize monetary results only at defined boundaries such as:

- displayed final money values
- persisted final money values
- transfer payload money fields where required
- trade form reconciliation

Do not repeatedly round intermediate calculations.

---

# Instrument Specification Architecture

## Required Instrument Metadata

Reuse or extend the existing instrument model to support:

- symbol
- display name
- asset class
- base currency
- quote currency
- price precision
- pip size
- contract size
- minimum volume
- maximum volume
- volume step

Do not assume:

`1 standard lot = $10 per pip`

for every instrument.

That shortcut is valid only in specific currency/account combinations.

---

# Core Position Size Formula

For linear FX-style instruments:

```text
price distance =
absolute(entry price - stop price)

loss per lot in quote currency =
price distance × contract size

loss per lot in account currency =
loss per lot in quote currency × quote-to-account conversion rate

raw position size =
chosen monetary risk
÷
loss per lot in account currency
```

Use decimal arithmetic throughout.

---

## Stop Distance

Calculate:

```text
price distance =
absolute(entry - stop)
```

If the instrument has a pip size:

```text
stop distance in pips =
price distance ÷ pip size
```

Display both where useful.

---

# Currency Conversion

## Case 1: Account Currency Equals Quote Currency

Example:

- instrument: EURUSD
- account currency: USD

Use:

`conversion rate = 1`

No additional input is required.

---

## Case 2: Account Currency Equals Base Currency

Example:

- instrument: USDJPY
- account currency: USD

The loss is naturally denominated in JPY.

Convert JPY risk back to USD using the appropriate reciprocal relationship derived from the instrument price.

Do not use a hardcoded "$10 per pip" assumption.

---

## Case 3: Account Currency Is Neither Base Nor Quote Currency

Example:

- instrument: EURGBP
- account currency: USD

The position loss is denominated in GBP.

A GBP-to-USD conversion rate is required.

The initial calculator must not depend on a paid live-rate API.

Show a conditional field:

`Quote currency to account currency conversion rate`

For EURGBP with a USD account, explain:

> Enter the amount of USD equivalent to one GBP.

Do not guess the conversion rate.

Do not fabricate current market values.

---

## Missing Conversion Data

If a conversion rate is required but unavailable:

do not return a fake position size.

Show:

> A currency conversion rate is required to calculate this position accurately.

Keep the rest of the calculator usable.

---

## Conversion Service

Create a dedicated conversion abstraction.

For example:

```text
domain/
  trading/
    currency-conversion/
```

It should support:

- identity conversion
- instrument-derived conversion
- manually supplied conversion
- future external live-rate provider

Do not couple the position-size engine directly to a future API provider.

---

# XAUUSD

Support XAUUSD explicitly through instrument specifications.

Do not treat XAUUSD like a standard 100,000-unit Forex contract.

Use configured:

- contract size
- price precision
- volume minimum
- volume maximum
- volume step

Add deterministic tests for XAUUSD.

If broker specifications may differ, display a concise note:

> Gold contract specifications can vary by broker. Trade OS uses the configured instrument specification, so verify unusual broker contract settings before placing a trade.

---

# Volume Normalization

## Raw Position Size

Calculate the theoretical raw lot size first.

Example:

`0.62741 lots`

---

## Volume Step

Normalize according to the instrument's volume step.

Example:

Volume step:

`0.01`

Raw position:

`0.62741`

Recommended position:

`0.62`

---

## Risk-Safe Rounding

Round down where necessary.

Do not round position size upward when doing so could exceed the selected risk amount.

Example:

Do not convert:

`0.627`

into:

`0.63`

if `0.63` exceeds the user's risk limit.

---

## Minimum Volume

If the risk-safe calculated volume is below the configured minimum:

do not silently increase it.

Show a warning such as:

> The calculated position size is below this instrument's minimum tradable volume. Using the broker minimum would exceed the selected risk.

Show the calculated theoretical volume where useful.

---

## Maximum Volume

If the calculation exceeds the configured maximum:

cap only if clearly explained.

Do not claim the capped volume still represents the original risk model.

Display:

- raw volume
- maximum permitted volume
- resulting risk

---

# Normalized Actual Risk

After position-size normalization, recalculate:

- estimated monetary risk
- estimated risk percentage

Example:

Requested:

`$250`

Raw volume:

`0.627 lots`

Normalized volume:

`0.62 lots`

Actual estimated risk:

`$247.60`

Display the normalized risk.

This allows the trader to see that safe volume rounding slightly reduced exposure.

---

# Potential Reward and Risk-to-Reward

If take profit is supplied:

Calculate:

```text
target distance =
absolute(take profit - entry)
```

Then calculate potential reward using the normalized position size and relevant currency conversion.

Calculate:

```text
planned RR =
potential reward ÷ normalized estimated risk
```

Display:

- potential reward
- planned R:R

Example:

```text
Estimated risk:
$250

Potential reward:
$500

Planned R:R:
1:2
```

---

# Margin Estimate

If leverage and sufficient conversion information are available, calculate approximate required margin.

Conceptually:

```text
notional position value =
position size × contract size × relevant price/conversion

estimated margin =
notional value ÷ leverage
```

Use the mathematically appropriate instrument/account-currency treatment.

Label clearly:

`Estimated margin required`

Helper text:

> Margin is the amount of account capital the broker may reserve to support the position. It is different from the money you are risking on the trade.

Do not describe margin as risk.

Do not claim the value is exact because broker margin policies may vary.

If required conversion data is unavailable:

show margin as unavailable.

---

# Calculator Results

The most prominent result must be:

## Recommended Position Size

Example:

`0.62 lots`

Also show units where useful.

---

## Supporting Results

Display:

- account balance
- account currency
- selected risk method
- requested risk amount
- requested risk percentage
- normalized estimated risk
- normalized estimated risk percentage
- entry price
- stop price
- stop distance
- stop distance in pips where applicable
- raw position size
- recommended position size
- potential reward if available
- planned R:R if available
- estimated margin if available
- leverage if supplied
- required conversion rate if applicable

Do not overwhelm the primary result.

Use progressive disclosure where appropriate.

---

## Plain-Language Result

Include a short explanation such as:

> With a $50,000 account, 0.5% risk, and this stop-loss distance, approximately 0.62 lots keeps the estimated loss close to your $250 risk limit if the stop is reached.

Generate this from validated calculation output.

---

# Risk Warning

Include concise educational text:

> Position-size estimates depend on instrument specifications, broker contract rules, spread, slippage, commissions and actual execution. Always verify the final order before trading.

Do not turn the page into a large legal disclaimer.

---

# Anonymous Behavior

Anonymous calculator usage must not create:

- Supabase user records
- trading accounts
- trades
- journal entries
- analytics records

The calculator should work without a database write.

---

# Conversion Loop

## Core CTA

After a valid calculation, show:

`Log this trade in Trade OS`

Supporting text may say:

> Carry this position plan into your Trade OS journal, then add your strategy, setup, screenshots, execution review and performance tracking.

This CTA must work for:

- authenticated visitors
- unauthenticated visitors

---

# Transfer Payload

Create a versioned Zod-validated calculator transfer payload.

Include only information relevant to trade prefilling.

Suggested fields:

```text
version

createdAt
expiresAt

instrumentId or symbol

direction

accountCurrency
calculatorAccountBalance

riskMethod
riskPercentage
riskAmount

entryPrice
stopLoss
takeProfit

recommendedLotSize

stopDistance
stopDistancePips

plannedRewardAmount
plannedRiskReward

leverage

conversionRate
```

Optional fields should remain optional.

Do not include private Trade OS account IDs in anonymous payloads.

---

# Transfer Storage

Use browser `sessionStorage` for the initial conversion workflow.

Use a namespaced key such as:

`trade-os:position-calculator-draft`

Do not put the entire transfer payload into the URL.

The payload must:

- use a version
- be validated before storage
- contain `createdAt`
- contain `expiresAt`
- expire automatically
- be discarded if invalid

Use a reasonable expiration period such as 24 hours.

---

# Authenticated Conversion Flow

If the visitor is already signed in:

1. validate calculator input
2. calculate the result
3. generate transfer payload
4. validate transfer payload
5. store it in session storage
6. navigate to the existing manual trade form
7. mark the source as position calculator
8. require actual Trade OS account selection
9. load account data
10. reconcile calculator assumptions against actual account data
11. recalculate where necessary
12. prefill compatible planned trade fields
13. clearly show which values came from the calculator
14. require user review
15. require explicit trade save

Do not automatically create the trade.

---

# Unauthenticated Conversion Flow

If the visitor is logged out:

1. validate calculator input
2. calculate result
3. generate transfer payload
4. store it in session storage
5. redirect to existing authentication
6. preserve an authenticated return destination
7. user signs in or creates an account
8. redirect to the existing trade form
9. retrieve transfer payload
10. validate it again
11. require actual Trade OS account selection
12. reconcile the calculation
13. prefill compatible fields
14. require explicit save

The calculation should survive the authentication round trip within the same browser session.

If the payload disappears:

show a useful message.

Do not break the normal trade form.

---

# Actual Account Selection

A public calculator balance is not authoritative once the user enters the private Trade OS workspace.

Require the user to choose an actual Trade OS trading account.

Load:

- account currency
- derived current balance
- configured leverage if available
- other relevant account metadata

Then recalculate.

---

# Percentage Risk Reconciliation

If the public calculation used percentage risk:

Example:

```text
Calculator balance:
$50,000

Risk method:
Percentage

Risk:
0.5%

Risk amount:
$250
```

If the selected Trade OS account balance is:

`$52,000`

preserve:

`0.5%`

Recalculate:

```text
risk amount =
$260
```

Then recalculate position size.

The percentage is authoritative because that was the user's selected risk method.

---

# Fixed Risk Reconciliation

If the public calculation used fixed risk:

Example:

```text
Fixed risk:
$250
```

Preserve:

`$250`

If actual account balance is:

`$52,000`

recalculate:

```text
risk percentage =
approximately 0.480769%
```

Then recalculate the position size where necessary.

The fixed monetary amount is authoritative because that was the selected method.

---

# Account Balance Difference Warning

If the selected Trade OS account balance differs from the calculator balance:

show a clear reconciliation message.

Example:

```text
Calculator balance:
$50,000

Current Trade OS account balance:
$52,000

Your position size has been recalculated using the current Trade OS account.
```

Where useful show:

- original risk amount
- recalculated risk amount
- original lot size
- recalculated lot size

---

# Account Currency Mismatch

If:

```text
Calculator account currency:
USD

Selected Trade OS account currency:
GBP
```

do not blindly import calculator monetary values.

Re-run the calculation using the actual account currency.

If additional conversion data is required:

request it.

Do not silently guess.

---

# Trade Form Mapping

Where compatible, map:

```text
calculator instrument
→ instrument

direction
→ direction

entry price
→ planned_entry

stop loss
→ planned_stop_loss

take profit
→ planned_take_profit

recommended lot size
→ planned_lot_size

risk amount
→ planned_risk_amount

risk percentage
→ planned_risk_percentage

potential reward
→ planned_reward_amount

planned RR
→ planned_risk_reward
```

Do not populate data that the calculator does not know.

Do not automatically populate:

- strategy
- setup
- trading session
- thesis
- entry reason
- confirmation
- psychology
- execution review
- rule review
- trade grade
- screenshots

Those remain part of the normal Trade OS workflow.

---

# Order Type

Do not assume MARKET order.

Unless the calculator explicitly gains an order-type input, require the user to select order type inside the normal trade form.

Do not invent execution information.

---

# Prefill Indicator

When the trade form was reached from the calculator, show an indicator such as:

`Prefilled from Position Size Calculator`

Helper text:

> Review these values before saving. Trade OS may have recalculated risk and position size using your selected account.

---

# Transfer Lifecycle

After successful trade save:

delete the session-storage payload.

If the user explicitly cancels the conversion:

allow them to discard it.

Expired payloads must be deleted when detected.

Do not leave stale transfer data indefinitely.

---

# No Silent Persistence

Never automatically save a trade merely because:

- the calculator was completed
- CTA was clicked
- authentication completed
- trade form opened
- account was selected

Final trade creation must always require explicit user action.

---

# Domain Service Architecture

Do not place calculation formulas in React.

Create or reuse services approximately equivalent to:

```text
domain/
  trading/
    position-sizing/
    instrument-specification/
    currency-conversion/
    pip-calculation/
    margin-calculation/
```

Adapt this to the existing project architecture.

The public calculator and private reconciliation workflow must use the same deterministic services.

Do not duplicate formulas.

---

# Calculation Result Domain Model

Create a strict result model capable of representing:

- requested risk amount
- requested risk percentage
- normalized estimated risk
- normalized risk percentage
- price distance
- pip distance
- raw position size
- normalized position size
- position units
- potential reward
- planned RR
- estimated margin
- conversion requirements
- warnings
- calculation validity

Keep UI-specific formatting out of the domain result model.

---

# Zod Validation

Validate calculator input.

At minimum enforce:

- account balance > 0
- valid ISO-like account currency
- valid risk method
- risk percentage > 0 when used
- fixed risk amount > 0 when used
- risk amount <= account balance
- valid instrument
- valid direction
- entry price > 0
- stop price > 0
- directionally valid stop
- directionally valid target if supplied
- leverage > 0 when supplied
- conversion rate > 0 when required
- supported instrument specification exists

Do not silently correct invalid trade plans.

Show understandable validation messages.

---

# Risk Percentage Warnings

Do not impose an arbitrary maximum such as 1%.

This is a general utility.

Hard validation:

risk percentage must not exceed 100%.

Provide a non-blocking warning for unusually high risk.

A default warning threshold such as 5% is acceptable if documented.

Example:

> This risk percentage is unusually high. Verify that this is intentional.

Do not automatically modify the value.

---

# Unsupported Instruments

If an instrument exists but does not have sufficient specification for safe calculation:

do not guess.

Show:

> Position sizing is unavailable until this instrument's contract specification has been configured.

---

# UI Requirements

## Desktop Layout

Prefer a balanced two-column layout:

```text
Calculator form        Calculation results
```

Keep the result card visible where practical.

---

## Mobile Layout

Stack:

1. calculator
2. result
3. conversion CTA
4. education

Ensure numeric fields remain usable.

---

## Result Hierarchy

The visually dominant result must be:

`Recommended Position Size`

Secondary metrics should not compete excessively.

---

## Descriptive Fields

Every non-obvious concept must include helper text, tooltip, example or information icon.

Explicitly explain:

- risk percentage
- fixed risk amount
- lot size
- leverage
- stop distance
- pip distance
- conversion rate
- estimated margin
- R:R
- account currency
- volume normalization

---

# Educational Content

Below the calculator include concise sections.

## What is position sizing?

Explain:

> Position sizing determines how large a trade should be based on the amount you are willing to risk and the distance between entry and stop loss.

---

## Why does stop distance affect lot size?

Explain:

> A wider stop normally requires a smaller position to keep the same monetary risk. A tighter stop may allow a larger position while keeping the same risk amount.

---

## What is leverage?

Explain:

> Leverage determines how much market exposure your broker allows relative to your account capital. It affects margin requirements, but it should not determine how much money you risk.

---

## What is risk-to-reward?

Explain with a simple example:

> If you risk $250 to target $500, the planned risk-to-reward ratio is 1:2.

---

# SEO Requirements

Because this is a public tool:

Create suitable metadata.

Suggested page title:

`Forex Position Size Calculator | Trade OS`

Suggested intent for description:

> Calculate Forex lot size from account balance, stop loss and risk percentage. Estimate position size, risk-to-reward and margin with Trade OS.

Do not keyword-stuff.

Use semantic headings.

Ensure the calculator route can be indexed unless the deployment intentionally disables indexing.

Do not make private Trade OS routes indexable because the calculator is public.

---

# Public Navigation

The public layout should expose clear actions such as:

- Position Size Calculator
- Sign in
- Start using Trade OS

Do not force signup before calculation.

---

# Conversion CTA

Primary CTA:

`Log this trade in Trade OS`

Supporting text:

> Carry this position plan into your Trade OS journal, then add your strategy, setup, screenshots, execution review and performance tracking.

---

# Authentication Safety

Verify:

- calculator works logged out
- calculator works logged in
- calculator does not query private trades
- calculator does not query private accounts
- private routes remain protected
- transfer after authentication respects normal ownership rules
- service-role credentials never appear client-side

---

# Tests: Core Position Sizing

Create deterministic unit tests.

## EURUSD with USD Account

Test:

- price distance
- pip distance
- selected risk amount
- raw lot size
- normalized lot size
- actual normalized risk

---

## GBPUSD with USD Account

Verify standard quote-currency behavior.

---

## USDJPY with USD Account

Verify account currency equals base currency.

Verify reciprocal conversion.

Do not use the EURUSD "$10 per pip" shortcut.

---

## EURGBP with USD Account

Verify the system requests GBP-to-USD conversion.

Verify correct calculation when conversion is supplied.

---

## GBPJPY with USD Account

Verify required JPY-to-USD conversion behavior.

---

## XAUUSD with USD Account

Verify configured:

- contract size
- price distance
- risk per lot
- volume normalization
- final risk

---

## Volume Step

Example:

Raw:

`0.627`

Step:

`0.01`

Expected recommended size:

`0.62`

Verify risk-safe downward normalization.

---

## Minimum Volume

Test a calculated volume below broker/instrument minimum.

Ensure the calculator does not silently increase risk.

---

## Maximum Volume

Test a calculated volume above maximum.

Ensure warning/result behavior is explicit.

---

## Percentage Risk

Verify risk amount.

---

## Fixed Risk

Verify derived risk percentage.

---

## BUY Validation

Verify:

- stop below entry
- target above entry

---

## SELL Validation

Verify:

- stop above entry
- target below entry

---

## Optional Take Profit

Verify:

- reward
- R:R

---

## Leverage

Verify changing leverage does not change recommended risk-based position size.

Verify leverage changes only margin estimate.

---

## Missing Conversion

Verify no fake position size is produced.

---

## Decimal Precision

Verify calculations avoid floating-point drift.

---

# Tests: Public Access

Verify:

- logged-out calculator request succeeds
- no redirect to login
- protected workspace still requires authentication
- anonymous calculation writes no trade record
- anonymous calculation writes no trading account record

---

# Tests: Conversion Loop

## Authenticated Flow

Test:

```text
Calculator
→ CTA
→ existing trade form
→ prefilled values
```

---

## Unauthenticated Flow

Test:

```text
Calculator
→ session payload
→ authentication
→ return to trade form
→ payload restored
```

---

## Expired Payload

Must be rejected and cleared.

---

## Invalid Payload

Must be rejected and cleared safely.

---

## Percentage Risk Transfer

Verify percentage remains authoritative after account selection.

---

## Fixed Risk Transfer

Verify fixed amount remains authoritative.

---

## Account Balance Difference

Verify recalculation.

---

## Currency Difference

Verify monetary values are not copied blindly.

---

## Successful Save

Verify transfer payload is cleared.

---

## Cancel Transfer

Verify user can discard transfer data.

---

# Integration Tests

Verify calculator-prefilled trades still use the existing canonical manual trade workflow.

Test that:

- transferred values do not bypass trade Zod validation
- transferred values do not bypass account ownership checks
- planned-value correction architecture still activates normally after OPEN
- calculator source does not alter trade lifecycle rules
- final trade creation still requires explicit save
- canonical trade records remain indistinguishable structurally from normal manual trades except for optional source metadata

---

# Accessibility

Verify:

- labels are attached to inputs
- helper text is understandable
- error messages are accessible
- result changes are announced appropriately where practical
- keyboard navigation works
- color is not the only status indicator
- mobile form controls remain usable

---

# Performance

The calculator should not require unnecessary database or server requests.

Pure deterministic calculations should execute locally or through reusable application logic where safe.

Do not sacrifice correctness merely to avoid a request.

Instrument specifications may be provided from safe public configuration where architecture permits.

---

# Documentation

Create:

`docs/POSITION_SIZE_CALCULATOR.md`

Document:

- calculator purpose
- public/private boundary
- position-sizing formula
- pip calculation
- currency conversion
- XAUUSD handling
- instrument specifications
- volume normalization
- margin estimation
- precision rules
- limitations
- conversion workflow
- session transfer architecture
- payload expiration
- authentication round trip
- account reconciliation
- field mappings
- testing strategy

Update where relevant:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- authentication/middleware documentation

---

# Database Changes

Avoid database changes unless necessary.

The public calculation itself must not require persistence.

If changes are needed for:

- instrument specification metadata
- trade source metadata
- transfer provenance

create proper Supabase migrations.

Do not manually edit production schema outside migration architecture.

---

# Required Route

Create:

`/tools/position-size-calculator`

Reuse:

`/trades/new`

for calculator conversion.

Do not create a second private trade-entry system.

---

# End-to-End Validation

## Public Visitor

Verify:

1. Open `/tools/position-size-calculator` while logged out.
2. No authentication redirect occurs.
3. Enter account balance.
4. Select currency.
5. Select percentage risk.
6. Enter risk percentage.
7. Select EURUSD.
8. Select BUY.
9. Enter entry.
10. Enter stop loss.
11. Enter take profit.
12. Enter leverage.
13. Calculate.
14. Confirm recommended lot size appears.
15. Confirm monetary risk appears.
16. Confirm risk percentage appears.
17. Confirm pip distance appears.
18. Confirm R:R appears.
19. Confirm margin estimate appears.
20. Click `Log this trade in Trade OS`.
21. Authenticate.
22. Return to the existing trade form.
23. Select an actual Trade OS account.
24. Verify account reconciliation.
25. Verify transferred values.
26. Complete remaining journal fields.
27. Explicitly save trade.
28. Verify trade appears in journal.
29. Verify transfer payload is cleared.

---

## Existing Authenticated User

Verify:

1. Sign in.
2. Open public calculator.
3. Complete a calculation.
4. Click `Log this trade in Trade OS`.
5. Confirm no additional authentication is required.
6. Open existing trade form.
7. Select account.
8. Verify recalculation.
9. Complete remaining fields.
10. Save.
11. Verify normal journal behavior.

---

## Cross-Currency Scenario

Test an instrument where account currency differs from both instrument currencies.

Example:

- account: USD
- pair: EURGBP

Confirm:

- conversion input is requested
- no value is guessed
- valid conversion produces a correct result

---

## XAUUSD Scenario

Test XAUUSD against deterministic fixtures.

Verify contract specifications are respected.

---

# Acceptance Criteria

Phase 08 is complete only when all of the following are true:

- public calculator route exists
- logged-out access works
- calculation does not require authentication
- private Trade OS routes remain protected
- account balance works
- account currency works
- percentage risk works
- fixed risk works
- instrument selection works
- BUY calculations work
- SELL calculations work
- entry validation works
- stop validation works
- optional target works
- deterministic position-size service exists
- formulas are outside React components
- decimal arithmetic is used
- precision rules are preserved
- EURUSD tests pass
- GBPUSD tests pass
- USDJPY tests pass
- EURGBP conversion tests pass
- GBPJPY conversion tests pass
- XAUUSD tests pass
- volume minimum is handled
- volume maximum is handled
- volume step is handled
- position size is normalized risk-safely
- actual normalized risk is displayed
- R:R works
- leverage does not change recommended position size
- margin estimate works where sufficient data exists
- missing conversion data blocks authoritative result
- no conversion rate is fabricated
- helper text exists for important fields
- anonymous calculations create no private records
- `Log this trade in Trade OS` CTA works
- authenticated conversion works
- unauthenticated conversion works
- authentication round trip preserves calculator draft
- transfer payload is versioned
- transfer payload is Zod validated
- transfer payload expires
- account selection is required before final private trade creation
- account balance differences trigger recalculation
- account currency differences are handled safely
- percentage-risk transfer preserves percentage method
- fixed-risk transfer preserves fixed amount
- calculator values prefill the existing trade form
- calculator never automatically saves a trade
- trade form validation remains authoritative
- trade ownership checks remain authoritative
- transfer payload clears after successful save
- one React component per file is respected
- shadcn is used wherever an appropriate standard component exists
- unit tests pass
- integration tests pass
- typecheck passes
- lint passes
- production build passes

---

# Completion Report

At the end of Phase 08 report:

1. public routes created
2. components created
3. domain calculation services created
4. instrument metadata changes
5. database migrations, if any
6. position-size formula implemented
7. currency conversion implementation
8. pip calculation implementation
9. XAUUSD implementation
10. volume normalization implementation
11. margin calculation implementation
12. public authentication exclusions
13. conversion-loop architecture
14. session-storage payload schema
15. trade-field mappings
16. account reconciliation behavior
17. tests created
18. test results
19. typecheck result
20. lint result
21. production build result
22. known limitations
23. future live conversion-rate integration opportunities

Finish with exactly one classification:

`PHASE_08_VALIDATED`

or

`PHASE_08_NOT_VALIDATED`

Only return `PHASE_08_VALIDATED` if:

- the public calculator works
- deterministic calculations are correct
- the authentication boundary is correct
- the conversion loop works
- calculator-to-trade reconciliation works
- unit tests pass
- integration tests pass
- typecheck passes
- lint passes
- production build passes

Stop after Phase 08.
