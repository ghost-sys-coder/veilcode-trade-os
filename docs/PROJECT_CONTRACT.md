# Trade OS Project Contract

## Product boundary

Trade OS is a personal trading performance management application. The initial source of truth is manual entry. It will support demo, prop-challenge, funded, and personal-live accounts and analyze profitability, risk, R multiples, drawdown, progress, strategy and setup performance, sessions, instruments, execution, psychology, mistakes, rule compliance, screenshots, and periodic reviews.

Trade OS is separate from automated trading systems. It must not place trades, provide signals, make AI trade recommendations, or include OpenAI in the finished application. Broker, CSV, MT4, and MT5 adapters are later concerns and must populate the same canonical model as manual trades. A generic account-scoped staging, validation, provenance, deduplication, and conflict-review foundation exists so those adapters can be added without weakening the manual record.

Development proceeds one phase at a time. A later-phase feature may not be implemented early unless a small foundation is required to make the active phase correct.

## Required stack

- Next.js App Router and React
- strict TypeScript
- Tailwind CSS and shadcn/ui
- Supabase PostgreSQL, Auth, and Storage
- Zod
- React Hook Form where appropriate
- shadcn chart components/Recharts where appropriate
- a Vercel-compatible architecture
- npm, because it is the established package manager

## Domain language

### Account balance

The authoritative reproducible account value:

`starting balance + closed-trade net PnL + account adjustments`

A cached current balance may be introduced later, but it may never become the only source of truth.

### Equity

`balance + unrealized PnL`

In the manual-first product, equity is optional and may be captured through manual snapshots. It does not replace balance as the authoritative historical performance curve.

### Canonical trade

One logical trading position from planning through final closure, regardless of whether it originates from manual entry, CSV, MT4, MT5, or a future broker integration.

### Closed-trade outcomes

- `WIN`: no partial exits and final normalized net PnL is positive.
- `LOSS`: no partial exits and final normalized net PnL is negative.
- `PARTIAL_WIN`: one or more partial exits were used and final normalized net PnL for the complete trade is positive.
- `PARTIAL_LOSS`: one or more partial exits were used and final normalized net PnL for the complete trade is negative.
- `BREAK_EVEN`: final normalized net PnL for the complete trade is exactly zero, including when partial exits were used.

A profitable partial exit does not determine the outcome. Classification happens only after the canonical trade is fully closed.

### Planned-value correction

Once a trade reaches `OPEN`, original planned values are historical evidence. A correction repairs incorrectly recorded plan data through an explicit, append-only audit event. It is not a trade-management event.

For example, fixing an incorrectly typed original stop is a correction. Moving an actual stop to break-even during the trade is execution history and must not rewrite the original plan.

## Trading principles

- Planned and actual data remain separate.
- Original planned values are never silently overwritten after opening.
- Financial outcome, setup quality, execution quality, psychology, and rule compliance remain independent concepts.
- A disciplined losing trade may be high quality; a profitable rule-breaking trade may be low quality.
- Every unfamiliar trading field must have helper text, a tooltip, or an example.
- Analytics must show sample sizes where omission could mislead.

## Lifecycle and sources

Canonical trade statuses are `DRAFT`, `PLANNED`, `OPEN`, `CLOSED`, and `CANCELED`. Status describes lifecycle, not financial outcome.

Source types are `MANUAL`, `CSV`, `MT4`, `MT5`, and `BROKER_API`. Manual entry is the active production workflow. Phase 07 implements the guarded import architecture and CSV mapping/validation domain layer, but does not expose a commit UI or connect a broker/terminal.

Imported data must pass through an owner- and account-scoped batch. Strong external identifiers provide idempotency; timestamp/symbol fingerprints may raise a review conflict but may not silently merge records. Manual thesis, psychology, screenshots, rules, grades, reviews, and lessons have priority over execution-only broker facts.

## Account types

- `DEMO`
- `PROP_CHALLENGE`
- `FUNDED`
- `PERSONAL_LIVE`

The same trade model and application behavior must work across every account type.

## Money and precision

Each account carries an ISO 4217 `currency_code` and explicit `currency_precision`. PostgreSQL stores money as `numeric`, never floating-point or PostgreSQL `money`. Supabase numeric values cross the application boundary as strings.

Authoritative monetary calculations use the shared decimal utilities. JavaScript `number` is not allowed for PnL, balances, fees, risk amounts, adjustments, currency drawdown, or currency expectancy.

Money, market prices, position volume, percentages, R multiples, exchange rates, and pip values have separate precision rules. Calculations retain sufficient internal precision and round only at defined boundaries. The initial rounding mode is decimal round-half-up.

Outcome classification compares final net PnL after normalization to account-currency precision. There is no near-zero tolerance in the initial product.

## Planned-value protection

The `trades` record keeps the current corrected plan for ordinary reads. After `OPEN`, protected plan changes go through an atomic database correction operation that verifies ownership and eligibility, requires a meaningful reason, appends a correction record, and updates the current value in one transaction.

Protected data includes planned entry, stop, take profit, lot size, risk amount, risk percentage, reward amount, risk-to-reward, partial targets, and original decision context such as thesis, strategy, setup, entry reason, and confirmation notes where applicable.

Correction events cannot be deleted through normal application workflows. A mistaken correction is repaired by another correction.

## React and UI rules

- A React component file contains no more than one React component.
- Helper React components may not be nested in another component file.
- Prefer Server Components; use small Client Components only where interaction requires them.
- Use shadcn/ui for appropriate standard primitives.
- Manual entry uses progressive disclosure rather than one unstructured form.
- The design is desktop-first, tablet-responsive, and reasonably usable on mobile.

## TypeScript and domain logic

- TypeScript remains strict.
- Avoid `any`; document any technically unavoidable use.
- Share domain types rather than duplicating shapes.
- Keep business logic out of React components.
- Put financial calculations in deterministic domain or service functions.
- Validate forms, APIs, and external imports with Zod.
- Unit-test important financial calculations.

## Data and security

- Use Supabase migrations, foreign keys, checks, and appropriate indexes.
- Enable RLS on every table in an exposed schema.
- Associate user-owned records with the authenticated user.
- Use private Supabase Storage for screenshots with ownership policies.
- Never expose service-role or database credentials to browser code.
- Use server-side operations for privileged work.
- Do not use user-editable JWT metadata for authorization.

## Documentation and quality gate

Keep `README.md`, this contract, `ARCHITECTURE.md`, `TRADING_METRICS.md`, and `DATABASE.md` synchronized with implementation.

Every phase ends with type checking, linting, relevant unit and integration tests, and a production build. Critical regressions must be fixed before the phase is complete.
