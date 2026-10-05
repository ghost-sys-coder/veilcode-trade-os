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
workspace or a hosted database. The recorded reset verified zero local users
and trades first. It replayed all 20 migrations and the seed successfully.

For an existing local database whose data must be kept, use the normal local
migration workflow instead of resetting it.

## Verification

```powershell
npm test
npm run test:db
npm run typecheck
npm run lint
npm run build
supabase db lint --local --schema public,private --level error --fail-on error
supabase db advisors --local --type security --level warn --fail-on error
```

The database runner captures local CLI status privately and discovers every
`supabase/tests/*.test.sql` suite. Each suite must begin a transaction and end
with rollback. A missing, incomplete, skipped or failed pgTAP plan fails the
run. The verified total is 126 assertions (26 OAuth isolation, 100 regression).
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

Metadata success still exits nonzero while the full authorization gate is
pending: underlying script exit 2, npm exit 1, `readyForPersistence=false`.
SQL JWT-claim fixtures do not prove actual token signatures, PKCE exchange,
refresh, intended-resource binding or immediate revocation. Consent approval
and MT5 persistence remain disabled until those real-flow checks pass.

## Shutdown and recovery

```powershell
supabase stop --project-id trade-os
```

This stops only this project's stack and preserves its local backup. Do not
use `--all` or `--no-backup` as a routine recovery step. If database testing
cannot discover local services, check Docker and restart this project; never
substitute production credentials to get a green result.
