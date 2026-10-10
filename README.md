# Trade OS

Trade OS is a private, manual-first trading performance system for demo, prop-challenge, funded, and personal-live accounts. It keeps the original trade plan separate from execution, result, psychology, rules, screenshots, and review evidence so profitable trading and disciplined trading are never treated as the same thing.

The application does not place trades, generate signals, recommend trades, or connect to a live broker. Phase 07 adds a guarded import foundation, but manual entry remains the active source of truth.

## Stack

- Next.js 16 App Router, React 19, and strict TypeScript
- Tailwind CSS 4, shadcn/ui, Base UI, and Recharts
- Supabase PostgreSQL, Auth, and private Storage
- Decimal.js for authoritative financial arithmetic
- Zod and React Hook Form for boundary validation
- Vitest plus transactional PostgreSQL/RLS tests
- npm and Vercel-compatible deployment

## Local setup

Requirements: Node.js 20.9 or newer, npm, and a Supabase project.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The local `.env`/`.env.local` files must never be committed.

### Environment variables

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser safe | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser safe | Preferred public project key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser safe | Legacy fallback public key |
| `NEXT_PUBLIC_SITE_URL` | Browser safe | Auth callback origin, such as `http://localhost:3000` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged server operations where explicitly required |
| `SUPABASE_DIRECT_CONNECTION_URL` | Server only | Migration/type-generation database connection |
| `TRADE_OS_TEST_DATABASE_URL` | Test process only | Transactional database-test connection |
| `TRADE_OS_DATABASE_URL` | Tooling only | Catalog-driven database type generation |

Only the URL and publishable/anon key may use the `NEXT_PUBLIC_` prefix. Never expose service-role or database credentials to the browser.

## Supabase setup and migrations

Link the CLI to the intended Supabase project, then apply the ordered migrations:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

If a network cannot reach the direct IPv6 database endpoint, use the project-specific Supavisor pooler connection supported by the CLI. The migrations create Auth-backed profiles, accounts, canonical trades, correction and behavioral histories, analytics support, prop/goals tracking, private screenshot policies, and the Phase 07 import staging architecture.

There is intentionally no production trade seed. `supabase/seed/README.md` documents that policy; test fixtures live only in automated tests. Starter instruments and the `100K Demo Practice` account are created by the authenticated application bootstrap where applicable.

## Development and quality commands

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run test:db
npm run db:types
npm run build
npm start
```

`npm run test:db` is transactional and requires `TRADE_OS_TEST_DATABASE_URL`. `npm run db:types` uses the project catalog and preserves PostgreSQL `numeric` values as strings; do not replace those finance-safe boundary types with JavaScript numbers.

## Product workflow

1. Create or select a trading account.
2. Define strategies, setups, and trading rules.
3. Record a draft or planned trade with risk, targets, and decision context.
4. Open the canonical trade; planned evidence becomes protected.
5. Record actual execution, management events, screenshots, psychology, and rule results without rewriting the plan.
6. Close the full position, enter gross PnL and non-negative costs, and let normalized net PnL determine the outcome.
7. Complete execution and post-trade reviews.
8. Review the journal, calendar, analytics, account balance, prop progress, and periodic logs.
9. Export all trades matching the active journal filters as canonical CSV data.

See [Manual trade workflow](docs/MANUAL_TRADE_WORKFLOW.md) for field-level details.

## Accounts, analytics, and prop tracking

The same canonical model supports `DEMO`, `PROP_CHALLENGE`, `FUNDED`, and `PERSONAL_LIVE` accounts. Balance is reproducible from starting balance, closed-trade net PnL, and adjustments. Equity is optional snapshot data and never replaces the historical balance curve.

Realized analytics use `closed_at` and include win/break-even rates, profit factor, currency and R expectancy, drawdown, strategy/setup/instrument/session/risk breakdowns, and explicitly reviewed execution, rules, psychology, and mistake cohorts. Mixed-currency selections keep money separated by currency.

Prop configuration is user-owned rather than vendor-hardcoded. Targets, loss buffers, snapshots, goals, status changes, and append-only progress events are tracked without turning estimated equity into authoritative realized balance.

## Screenshots

Trade images use the private `trade-screenshots` Supabase Storage bucket. Objects are scoped by user and trade, file type/size is validated, and access uses authenticated requests or short-lived signed URLs. Database rows store stable object paths and metadata, never public URLs.

## Import architecture

CSV, MT4, MT5, and broker data must pass through an account-scoped batch and row-staging model before becoming canonical trades. The Phase 07 foundation provides typed CSV parsing/mapping, row validation, provenance, deterministic strong-ID deduplication, explicit conflict states, and RLS-protected batch history.

The commit UI and broker adapters remain intentionally disabled until a real provider export is reviewed. Imports may enrich execution facts but cannot silently replace manual thesis, psychology, screenshots, rule evidence, reviews, grades, or lessons. See [Future imports](docs/FUTURE_IMPORTS.md).

## Integration status

The focused MT5 demo rollout was accepted before MCP implementation began. Account
isolation, reconstruction, reconciliation, publication, conflict review and protected
restart recovery are built. Broader terminal/VPS/startup limits and the user-deferred
extended soak remain documented, not reported as passed.

`feature/mcp-access` implements 84 stateless HTTP tools and eight resources using
resource-bound OAuth and verified shared services. Controlled private screenshots
require server-only `SUPABASE_SECRET_KEY` (never `NEXT_PUBLIC_*`). Permanent deletion
uses exact-target one-use browser consent; referenced configuration archives.
Screenshot execution reports `PURGE_PENDING` until physical removal is confirmed.
Deletion prerequisites still require hosted rollout approval. Local stdio,
actual external-client checks and hosted activation remain separate
gates. Hosted MCP stays disabled. See the
[completion checklist](docs/MCP_COMPLETION_CHECKLIST.md) and
[private-file verification](docs/MCP_PRIVATE_FILES_VERIFICATION.md) and
[deletion-safeguards verification](docs/MCP_DELETION_SAFEGUARDS_VERIFICATION.md).

Run `npm run test:mt5-python` and `npm run check:mt5-python` using the
[Python development setup](integrations/mt5/README.md). Local-only browser/API tests
use the disposable Supabase stack described in [the local runbook](docs/LOCAL_INTEGRATION_TESTING.md).
See [integration roadmap](docs/INTEGRATION_ROADMAP.md) and the current
[credentials/supervision verification](docs/MT5_CREDENTIALS_SUPERVISION_VERIFICATION.md).

## Deployment to Vercel

1. Create a Vercel project from this repository.
2. Configure the browser-safe and server-only variables above for the intended environments.
3. Set `NEXT_PUBLIC_SITE_URL` to the production HTTPS origin.
4. Add that origin and `/auth/callback` URL to the Supabase Auth redirect allow-list.
5. Apply all Supabase migrations before promoting the deployment.
6. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` in CI.
7. Verify the private screenshot bucket and RLS policies in the production Supabase project.

## Known limitations

- No automated execution, signals, live-account activation or operational MT4 bridge.
- Private upload staging currently retains temporary bytes; expiry is not automatic garbage collection.
- CSV commit is not exposed until a broker-specific mapping can be validated safely.
- Equity and unrealized PnL are manual snapshots; realized balance remains authoritative.
- Monetary aggregation across currencies requires a future explicit FX-conversion layer.
- Supabase leaked-password protection is a project Auth setting and must be enabled separately on plans that support it.

## Documentation

- [Project contract](docs/PROJECT_CONTRACT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Trading metrics](docs/TRADING_METRICS.md)
- [Manual trade workflow](docs/MANUAL_TRADE_WORKFLOW.md)
- [Future imports](docs/FUTURE_IMPORTS.md)
- [Phase specifications](docs/phases)

## Non-negotiable engineering rules

- One React component per component file.
- Use shadcn/ui for appropriate standard primitives.
- Keep domain and financial logic outside React components.
- Never use JavaScript `number` for authoritative money arithmetic.
- Validate form, API, database-bound, and import input.
- Protect every user-accessible table with ownership-aware RLS.
- Preserve the original planned record after a trade opens.
- Derive analytics from persisted facts, never hardcoded display numbers.
