# Disposable local integration testing

These commands target the local Docker Supabase project `trade-os`, not hosted
production. Verified on 2026-10-05 with Windows, Docker 28.0.1, Supabase CLI
2.95.4, PostgreSQL 17.6 and Node 25.1.0.

## Preparation

Run from the repository root with Docker's Linux engine working and sufficient
disk space. The Docker disk image was relocated by the user; do not move active
database files manually. No hosted project credentials are needed.

```powershell
npm run prepare:local-auth
supabase start --exclude realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor
npm run prepare:local-db
```

The preparation command creates the ignored `supabase/signing_keys.json` only
when no key exists. It validates ES256 material and does not rotate existing
keys. Never commit, print or share this artifact. Production `.env` is not read
by preparation or database testing. `supabase status` output contains local
credentials; do not paste its full output into logs or reports.

Local services may bind to `0.0.0.0`, including unauthenticated PostgreSQL
metadata administration. Keep the machine behind an appropriate firewall on
a trusted network; do not publish these ports or tunnel admin services. A
future minimal test stack can also exclude `postgres-meta`; it was running
for the recorded verification. No firewall changes were made by this build.

## Schema replay

`supabase db reset --local` deletes local data. Use it only after verifying this
is an empty or explicitly disposable local database, never a populated user
workspace or a hosted database. Prefer `npm run replay:local-db`, which verifies
zero local users, trades, grants, connections, operations, audits and source
revisions before resetting. It refuses a populated database and never loads
production `.env`. All 24 migrations and the seed now replay successfully.

For an existing local database whose data must be kept, use the normal local
migration workflow instead of resetting it.

## Verification

```powershell
npm test
npm run test:db
npm run typecheck
npm run lint
npm run build
npm run test:integration-auth
# With `npm run dev:integration` running in a separate terminal:
npm run test:integration-browser
supabase db lint --local --schema public,private --level error --fail-on error
supabase db advisors --local --type security --level warn --fail-on error
```

The database runner captures local CLI status privately and discovers every
`supabase/tests/*.test.sql` suite. Each suite must begin a transaction and end
with rollback. A missing, incomplete, skipped or failed pgTAP plan fails the
run. Current suites add grant/activation/revocation and durable MT5 capture to
the original OAuth-isolation and regression assertions; the latest exact
counts appear in [the foundation report](MT5_FOUNDATION_VERIFICATION.md).
These suites create fixtures inside their transactions; verify no fixtures
remain afterward. CLI/Docker access permissions may be necessary on Windows.

`TRADE_OS_TEST_DATABASE_URL` is an explicit alternative for a disposable test
database, not a fallback to `.env`. Non-loopback URLs additionally require
`TRADE_OS_TEST_DATABASE_IS_DISPOSABLE=true`, with TLS certificate verification.
Routing/TLS URL query overrides are rejected. Do not set this against the
in-house production database.

Probe only the local OAuth metadata using a process-scoped override, without
editing `.env`:

```powershell
$priorIntegrationUrl = $env:SUPABASE_URL
try {
  $env:SUPABASE_URL = 'http://127.0.0.1:54321'
  npm run check:integration-auth
} finally {
  $env:SUPABASE_URL = $priorIntegrationUrl
}
```

The metadata-only preflight deliberately cannot approve persistence: underlying
script exit 2, npm exit 1, `readyForPersistence=false`. Real-flow evidence comes
from `test:integration-auth` and `test:integration-browser`, not SQL JWT-claim
fixtures or advertised provider capabilities. Those real local flows now pass.
Hosted integrations still default disabled and require separately verified
resource/hook configuration and deployment; no hosted migration was applied.

## Isolated browser app

`npm run dev:integration` privately captures local CLI status, overrides Supabase
configuration only in its child process and starts Next on `127.0.0.1:3100`
with `.next-integration` as its generated directory. It does not edit `.env`,
stop another dev server or reuse `.next`. Local Auth's site URL is port 3100;
restart this project's local stack with backup preserved after changing it.

The browser runner launches a fresh headless Chrome profile, uses a temporary
example.test user/client and removes only their local fixtures. It never saves
browser credentials or prints provider tokens. Screenshots go to ignored
`.artifacts/integration-tests`. Do not run parallel fixture runners: they share
an advisory lock protecting temporary local resource configuration.
The SQL-suite runner now shares that same session lock, held across rollback-isolated
suites and released on disconnect. Migration replay still requires an empty database
and must precede fixture execution, never run alongside a browser runner.

Python foundations have separate `npm run test:mt5-python` and
`npm run check:mt5-python` checks. See the
[project-local tooling and outbox contract](../integrations/mt5/README.md).

## PostgreSQL permission-hint crash workaround

The recorded PostgreSQL 17.6/Supautils build crashed on some denied function
EXECUTE checks instead of returning SQLSTATE 42501. `npm run prepare:local-db`
disables only local enhanced role hints (`supautils.hint_roles = ''`) and
verifies the result. RLS, role privileges and function grants are unchanged;
the tests still invoke the forbidden hook and assert denial.

This is a known upstream diagnostic bug, not a reason to grant access:
[Supabase Postgres issue 2112](https://github.com/supabase/postgres/issues/2112),
[Supautils issue 214](https://github.com/supabase/supautils/issues/214).
The preparation command has no remote option and never prints the local admin
password captured from CLI status. No hosted setting was changed.

## Shutdown and recovery

```powershell
supabase stop --project-id trade-os
```

This stops only this project's stack and preserves its local backup. Do not
use `--all` or `--no-backup` as a routine recovery step. If database testing
cannot discover local services, check Docker and restart this project; never
substitute production credentials to get a green result.
