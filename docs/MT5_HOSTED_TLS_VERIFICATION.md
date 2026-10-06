# Hosted MT5 connection prerequisites and trusted CA support

Date: 2026-10-06 (Africa/Kampala). Branch: `feature/mt5-sync`.
Baseline: `e955444`, disabled hosted pilot foundation rollout.
This is an incremental fix/report, not full MT5 readiness or successful hosted consent.

## Supplied configuration checks

The user provided the requested settings in the ignored local `.env` file.
Only entry names, presence and validation results were displayed; no values or
passwords were included in logs or committed files. The existing database
credential was used only by a sanitized read-only probe, never on command arguments.

- Client ID resolves in the intended hosted project to an active, pre-registered
  **public** client with token endpoint method `none` and exactly one callback,
  `http://127.0.0.1:9876/callback`. No client secret is required or requested.
- The pooler hostname matches the project's official region and session port
  5432. The endpoint is reachable, fixing the earlier IPv6 DNS obstacle.
- `HOOK_ENABLED` records the user's confirmation. Actual hook execution,
  signed resource claims and live account authorization remain unverified until
  the real hosted browser/PKCE flow is completed; a configuration flag is not proof.
- Initial strict Node TLS failed with `SELF_SIGNED_CERT_IN_CHAIN` before database
  authentication. After the user downloaded `prod-ca-2021.crt` from the selected
  project's Database settings, actual shared-adapter TLS and hostname verification
  passed, followed by authentication. No TLS downgrade was used.
- The last hosted read shows zero integration connections, zero grants,
  disabled MT5 resource and zero trades in the selected pilot account.

## Implemented fix

`publicationDatabaseConfig` now accepts optional server-only
`SUPABASE_DATABASE_CA_CERT`: the public root certificate downloaded from the
selected project's Database settings → SSL Configuration → Download Certificate.
It accepts PEM, CRLF or escaped-newline representation, then parses and canonicalizes
one bounded X.509 certificate. Non-CA, non-self-signed/tampered, not-yet-valid,
expired, malformed, bundled and oversized inputs fail closed with the existing
sanitized configuration error.

Remote connections retain `rejectUnauthorized: true` and the driver's default
hostname verification. URL query options remain rejected so node-postgres cannot
overwrite the verified SSL object. No global Windows trust setting is changed.
Only the explicit disposable loopback test database continues to use non-TLS local
connections. An absent custom CA leaves normal strict runtime trust unchanged.

Optional server-only `SUPABASE_DATABASE_POOLER_HOST` and
`SUPABASE_DATABASE_POOLER_PORT` select an official session pooler on port 5432.
The adapter derives the qualified username from the existing Supabase URL and
substitutes the public endpoint in memory. Partial settings, foreign hosts and
non-Supabase credentials fail closed. The stored secret URL/password are unchanged;
isolated local tests ignore these overrides.

The public certificate is not a broker password, API key or private key. Its
SHA-256 fingerprint is
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
The actual shared-adapter read-only probe confirmed role `postgres`, the private
publication function and the exact pilot account with preserved USD 100000.00
baseline. No ledger mutations occurred.

## Verification

| Command | Result |
| --- | --- |
| `npm test -- tests/integrations/publication-database-config.test.ts` | Final focused PASS: 34 tests |
| `npm test` | Final PASS: 417 tests, 32 files; 34 new connection/CA configuration cases |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: Next.js 16.3.6 production build |
| `npm run test:db` | PASS: 441 rollback-isolated local assertions, ten suites; no hosted fixtures |
| `npm run check:mt5-python` | PASS |
| `npm run test:mt5-python` | PASS: 167 tests, 29.925 seconds |
| `npm run test:integration-browser` | PASS: 43 actual local browser/provider/API checks; Chrome 154.0.8037.93 |
| `node --experimental-strip-types .artifacts/mt5-pilot/verify_pooler_database.mjs` | PASS: actual shared adapter, strict TLS, authenticated project, private publisher and preserved baseline |
| `git diff --check` | PASS |

The unit certificates are public runtime trust anchors, not production keys.
Their parser/self-signature/time checks use actual Node X.509 operations rather
than accepting a mocked certificate. They prove configuration behavior, not that
a particular remote server's chain or hostname has already passed.

## Three-layer review

1. **Plan alignment — PASS for this fix:** maintains the approved strict-TLS,
   server-only credential, no-paid-infrastructure and no-broker-execution contracts.
   No monetary, canonical-trade or behavioral-review definitions changed.
2. **System integrity — PASS:** trust configuration is centralized in the existing
   server adapter boundary, not invented in UI/services; malformed input is
   sanitized and fails closed. Local fixtures remain isolated from production.
3. **Readiness — pending operational gate:** pooler verification is complete;
   hosted consent/token/refresh/revocation and normal
   login regression, followed by mapping/reconciliation and interruption tests.
   Do not enable collection, treat the baseline as reconciled or claim MT5 complete.

Production-only public pooler settings and CA were added using the official Vercel
CLI and stdin. The existing secret database URL was not retrieved or rewritten.
MT5 is configured true for the next deployment to allow browser authorization;
the currently published snapshot remains disabled until promotion. MCP stays false
and collection remains stopped. The private MT5 resource is still disabled at this
checkpoint. No schema, ledger, broker execution/history, startup task, master merge
or MCP implementation changed. This source fix is not deployed yet.

Database, Python and browser checks preceded the final pooler override addition;
the final full unit/typecheck/lint/build run includes that addition.

Provider guidance: [Supabase certificate verification](https://supabase.com/docs/guides/platform/ssl-enforcement#start-of-content),
[node-postgres SSL configuration and URL override behavior](https://node-postgres.com/features/ssl).

## Subsequent authorization-only deployment

Source `ffef448` was pushed on `feature/mt5-sync`, preserving the externally merged
master baseline `85253b9`. Deployment `dpl_Ej1pHWqGCaAfZCdEv2ntz1kF8gcQ`
(`trade-bh2xn0v7t-ghostsyscoders-projects.vercel.app`) reached READY, passed seven
staged checks via official Vercel deployment access, and was explicitly promoted
to `https://tradeos.veilcode.studio`.

The exact private MT5 resource was enabled for browser consent. MT5 authorization
is enabled; MCP remains disabled. There were zero grants and connections before
the consent attempt. No collector is running and no broker history is uploaded.

`node .artifacts/mt5-pilot/verify_rollout_http.mjs https://tradeos.veilcode.studio`
passed all seven anonymous production checks: public calculator/login/consent 200,
integration settings redirect to login, pinned discovery metadata 200, session
GET and capture POST 401. `node .artifacts/mt5-pilot/verify_private_schema.mjs`
confirmed private schema rejection, HTTP 406 / PGRST106.

`vercel logs dpl_Ej1pHWqGCaAfZCdEv2ntz1kF8gcQ --no-follow --no-branch --level error --since 10m --limit 50 --json --non-interactive`
completed successfully with zero error records; log bodies were not displayed.
A read-only hosted check after promotion confirmed zero grants, zero connections,
zero pilot trades and the unchanged normalized 100000.00 opening baseline.

The actual loopback consent helper opened the user's browser, using the existing
PKCE client and Windows-protected credential store. Approval and the remaining
hosted token/refresh/revocation gates are pending, not counted as passed.
Rollback reference: prior promoted `dpl_AJb733ESsNZUjzz6Ci17gofdLJ1k`; disabling
the exact MT5 resource stops authorization/API activity without deleting evidence.
