# Trade OS

Trade OS is a personal trading performance tracker for manual practice, prop-firm accounts, funded accounts, and personal live accounts. It records the plan, execution, result, psychology, and rule compliance of each trade without confusing profitability with trade quality.

The product is manual-first. It does not place trades, generate signals, recommend trades, or embed OpenAI. Later CSV, MT4, MT5, and broker imports will map into the same canonical trade model.

## Current status

Phase 01 is implemented. The application now includes Supabase cookie-based authentication, the canonical database schema and RLS policies, private screenshot storage, starter reference data, strict shared domain/Zod types, deterministic account-balance derivation, and foundational CRUD for accounts, strategies, setups, and trading rules.

Trade entry remains intentionally out of scope until Phase 02.

## Technology

- Next.js 16 App Router and React 19
- strict TypeScript
- Tailwind CSS 4 and shadcn/ui
- Supabase PostgreSQL, Auth, and Storage
- Decimal.js for authoritative financial arithmetic
- Vitest for deterministic domain tests
- npm as the package manager

## Local setup

Requirements:

- Node.js 20.9 or newer
- npm
- a Supabase project for Phase 01 and later

```bash
npm install
copy .env.example .env.local
npm run dev
```

The existing `.env` is local-only and must not be committed. Use `.env.example` as the safe configuration contract. Browser code may receive only the Supabase project URL and publishable/legacy anon key. Service-role and direct-database credentials are server-only. This project also accepts `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` on the server for compatibility with the supplied local environment.

Apply the database migration with the Supabase CLI before using the application. On networks without direct IPv6 database access, use the project-specific Supavisor pooler URL as the CLI `--db-url`.

## Quality commands

```bash
npm run typecheck
npm run lint
npm test
npm run test:db
npm run db:types
npm run build
```

`npm run test:db` requires `TRADE_OS_TEST_DATABASE_URL` to be set to a database connection string. The test suite is transactional and rolls its test records back.

`npm run db:types` requires `TRADE_OS_DATABASE_URL` and regenerates complete schema types by introspecting the live PostgreSQL catalog. This is the Docker-free equivalent used in this project when the official Supabase database-URL generator cannot start its local metadata container.

## Documentation

- [Project contract](docs/PROJECT_CONTRACT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Trading metrics](docs/TRADING_METRICS.md)
- [Database direction](docs/DATABASE.md)
- [Phase specifications](docs/phases)

## Non-negotiable engineering rules

- No more than one React component per file.
- Use shadcn/ui instead of recreating standard UI primitives.
- Keep business and financial logic outside React components.
- Never use JavaScript `number` for authoritative monetary arithmetic.
- Validate external, form, and API inputs with Zod.
- Enable RLS for every user-accessible table and scope records to the authenticated owner.
- Preserve original planned values after a trade becomes `OPEN`.
- Derive analytics from persisted data; never hardcode performance numbers.
- Complete only the active project phase.
