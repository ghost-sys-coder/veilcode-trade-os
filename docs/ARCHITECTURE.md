# Architecture

## System shape

Trade OS is a Vercel-compatible Next.js App Router application backed by Supabase PostgreSQL, Auth, and Storage. The browser renders UI and performs user-authorized actions. Next.js Server Components, Server Actions, and Route Handlers form the trusted application boundary. PostgreSQL remains the authority for ownership, constraints, protected plan corrections, and persisted financial facts.

```text
Browser UI
  -> Next.js App Router
       -> server-side application services
            -> deterministic domain logic
            -> Supabase Auth / PostgreSQL / Storage
```

The default is Server Components. Client Components are limited to interactive controls and never receive a service-role key.

## Source layout

The repository keeps the existing root-level App Router convention supported by Next.js instead of mechanically moving working files into `src`.

```text
app/                 routes, layouts, server actions, route handlers
components/ui/       shadcn primitives
components/          shared composed UI
features/            domain-oriented UI and orchestration
domain/              deterministic business rules and value utilities
  accounts/
  money/
  trades/
services/            application workflows and external adapters
lib/                 framework and vendor integration utilities
hooks/               reusable client hooks
config/              validated application configuration
types/               genuinely cross-domain shared types
supabase/
  migrations/        ordered, reproducible schema changes
  seed/              clearly identified development seed data
  tests/             database and RLS tests
tests/                TypeScript unit and integration tests
docs/                 contracts, architecture, metrics, and phase plans
```

Additional feature directories—accounts, trades, journal, analytics, psychology, rules, strategies, and prop—are introduced only when their phase needs them.

## Dependency direction

Dependencies point inward:

1. React components depend on feature orchestration and domain types.
2. Services coordinate validated inputs, domain functions, and persistence.
3. Domain code depends on neither React nor Supabase.
4. Supabase adapters translate database/API strings into validated domain values.

Important calculations must not exist only inside a component, SQL view, or chart formatter. Domain functions are deterministic and independently testable.

## Supabase boundary

Phase 01 configures separate browser and server clients using `@supabase/ssr`. Browser-safe clients receive only the project URL and publishable key (or legacy anon key). Server-only secrets stay in server-only modules.

Session handling uses cookie-based SSR. Authorization is enforced in PostgreSQL with explicit grants and operation-specific RLS policies. Application checks improve errors and UX but do not replace RLS.

All exposed tables enable RLS. Policies target named roles, check authenticated ownership, and use both `USING` and `WITH CHECK` where appropriate. Columns used by policies are indexed. Views exposed through the Data API use `security_invoker = true` or remain in an unexposed schema.

Privileged `security definer` functions live in a private schema, set a safe empty `search_path`, minimize grants, and verify the caller explicitly.

## Storage architecture

Trade screenshots use the private `trade-screenshots` Supabase Storage bucket. Object paths begin with the authenticated owner ID and then the trade ID. Storage policies cover read, insert, update, and delete separately; replacement/upsert requires select, insert, and update permissions. Application records store the stable object path and metadata, never a permanent public URL.

Downloads use authenticated access or short-lived signed URLs. File type and size restrictions belong on the bucket and in input validation.

## Canonical trade lifecycle

```text
DRAFT -> PLANNED -> OPEN -> CLOSED
   |         |        |
   +---------+--------+-> CANCELED (when valid for the current state)
```

Lifecycle transition rules will be encoded in domain logic and database constraints/functions. `outcome` remains null until the canonical trade is fully `CLOSED`. Partial fills and exits do not close the canonical trade until the remaining position is closed.

## Planned data and corrections

Before `OPEN`, normal validated editing is permitted. On transition to `OPEN`, planned values become protected historical evidence.

After opening:

1. The normal trade update path cannot modify protected fields.
2. The user invokes an explicit “Correct recorded plan value” workflow.
3. A private transactional function verifies authentication, ownership, trade state, allowlisted field, typed old/new values, and a meaningful reason.
4. It appends a `trade_plan_corrections` event and updates the current field on `trades` atomically.
5. Neither operation persists if the other fails.

Correction events are append-only and ordered by timestamp plus identifier. The first event preserves the value that existed when the trade opened; the event chain reconstructs every version.

Changes that actually happened during execution—moving a stop, scaling out, adding to a position—belong to typed trade-management/execution history. They are not corrections.

## Financial calculation boundary

PostgreSQL `numeric` values are treated as strings at the Supabase boundary. Shared decimal utilities parse and calculate at high internal precision. Final money values normalize once to the account’s configured currency precision with round-half-up.

Other numeric domains retain their own precision. Price precision comes from instrument metadata; volume, percentages, R multiples, exchange rates, and pip values are not rounded to currency precision.

Outcome is derived or validated against normalized final net PnL. A conflicting outcome is rejected and shown as a correction requirement rather than silently saved.

## Account performance

Account balance is reproducible from starting balance, closed-trade net PnL, and account adjustments. Chronological calculations use deterministic ordering. Optional snapshots provide historical balance/equity observations but do not replace the ledger-derived balance curve.

## Import compatibility

Manual and imported trades map to the same canonical record. Source metadata (`source_type`, `external_trade_id`, and `import_batch_id`) identifies provenance without creating source-specific trade tables. Raw payloads, when justified, are retained outside core domain fields for troubleshooting and reprocessing.

Imports validate and normalize into canonical commands before persistence. Idempotency uses a source/account/external-ID boundary. Import adapters may not weaken canonical constraints or planned-versus-actual separation.

## Validation and error handling

- Zod validates environment, form, API, and import input at system boundaries.
- Database constraints reject impossible persisted states.
- Domain functions return typed results or intentional domain errors.
- UI errors explain corrective action without exposing secrets or internal SQL.

## Testing strategy

- Unit tests: decimal arithmetic, risk, PnL, R multiples, balances, drawdowns, streaks, and outcome rules.
- Integration tests: services against Supabase and storage behavior.
- Database tests: constraints, lifecycle enforcement, correction atomicity, and RLS allow/deny cases.
- End-to-end tests: critical user workflows when those workflows are implemented.

Async Server Components are tested through integration or end-to-end coverage because Vitest does not support them as isolated units reliably.

## Architecture decision record

- Keep the established root-level application directories.
- Use npm and the existing lockfile.
- Use Decimal.js and string boundaries for money.
- Use append-only correction events plus current values on `trades`.
- Keep trade-management history separate from data corrections.
- Prefer derived balances over a mutable balance field.
- Use private screenshot storage.
- Delay database, auth, and feature implementation until their designated phases.
