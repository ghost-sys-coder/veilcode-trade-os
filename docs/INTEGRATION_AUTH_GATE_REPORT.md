# Integration foundation: authentication verification history

Date: 2026-10-05. Branch: `feature/mt5-sync`.
This is an interim implementation report, not MT5/MCP completion or merge approval.

## Current result (supersedes earlier pending observations below)

Local authentication compatibility now passes: actual provider PKCE rejection
and exchange, ES256 signature/issuer/resource verification, rotated refresh,
account-bound grants, immediate application revocation and provider revocation.
Real Chrome browser consent, account-name selection, login redirect, connected
client revocation, logout and anonymous/authenticated public-calculator checks
pass. Approval now has an implementation with PENDING -> provider approval ->
ACTIVE activation; uncertain/invalid acknowledgements fail closed and revoke.

The historical sections below record earlier stages, not the current feature
inventory. [The current foundation report](MT5_FOUNDATION_VERIFICATION.md)
records exact results, source-capture additions and remaining gates. Hosted
configuration/deployment, actual MT5/MCP clients and the demo soak are not
verified. No hosted migration, fixture or broker execution was performed.

## Delivered

- Saved all three approved plans in the documentation commit `b17c14a`.
- Created `feature/mt5-sync` and `feature/mcp-access`; the latter is parked
  at the documentation commit. Original baseline: `412da1c`. On resuming
  local verification, the repository already contained external PR #1's
  merge on `master` at `61ed889`. The MT5 branch was fast-forwarded to that
  commit without resetting user work. That merge is not a passed MT5 gate.
- Added `npm run check:integration-auth`, a read-only public metadata probe.
  It loads the local environment without exposing credentials, pins provider
  endpoints, refuses redirects, limits metadata to 64 KiB and times out at
  ten seconds. It performs no registration, consent, token issuance or writes.
- Added deterministic fixtures for provider pinning, public signing material,
  PKCE/refresh capabilities, malformed metadata and secret-redacted reports.
  This is capability assessment, not cryptographic JWT verification.

## Initial authentication gate observation

The sandboxed probe could not reach the provider. The same command repeated
with network permission reached it: OAuth discovery returned HTTP 404;
public JWKS returned HTTP 200 with an accepted asymmetric public signing key.
Both discovery paths were probed; endpoint capability checks remain failed.

Initially `metadataReady` and `readyForPersistence` were false. The Node script
uses exit 1 for failed metadata and exit 2 for successful metadata with remaining
end-to-end checks pending (npm reports either non-success as exit 1).
This preflight never authorizes persistence itself.

Browser inspection reached the Supabase administrator sign-in page; project
OAuth configuration could not be verified. A 404 alone does not establish
whether OAuth is disabled or another project configuration issue exists.

## After administrator enablement

The administrator confirmed OAuth Server had been disabled, then enabled it
without changing other settings. The authorization path remains the default
`/oauth/consent`. A new network-enabled preflight returned HTTP 200 discovery:
all eleven advertised capability checks passed, including issuer/endpoint
pinning, PKCE S256, renewable/public-client grants and asymmetric JWKS.
`metadataReady` is now true; `readyForPersistence` remains false.

Implemented `/oauth/consent`, a typed provider-bound service and domain
validation. The service verifies direct browser claims and a fresh server user,
rejects OAuth-client sessions, checks request/owner correspondence and rereads
identity/request at action time. Errors and provider data are sanitized.
Callback redirects are limited to a provider-registered HTTPS/loopback
destination and an explicit denial without authorization codes or tokens.

Approval has no implementation in this slice, not merely a disabled button.
An already-consented provider redirect is blocked: Supabase auto-consent must
not bypass future application grant/resource checks. Client registration,
grant persistence, resource-bound JWT verification, access-token hooks,
account-bound integration RLS/RPC authorization, durable application mutation
receipts and revocation checks are still pending. No integration data endpoints
or broker persistence exist yet.

The denial-only service tests use controlled provider fixtures, not a real
registered OAuth client. They are not proof of PKCE/token exchange, refresh
rotation or real-client compatibility. SQL-claims database isolation is now
tested separately below; it is not a real signed-token authorization test.

The following remain pending, not passed:

- Real browser consent, valid PKCE exchange and wrong-verifier rejection.
- Refresh and rotated-credential persistence/reuse handling.
- Intended-resource binding and rejection of wrong-resource tokens.
- Immediate grant revocation and account-scoped integration authorization.
  Legacy direct-write denial now passes local SQL-claims fixtures only.
- Existing login/logout/callback and anonymous calculator browser regression.

## Local verification after Docker recovery

The user relocated Docker's disk image and restarted the workstation. Docker
28.0.1 is responding again. Available space measured approximately 44 GB on
C: and 84 GB on D:; the exact relocated image path was not independently
verified. Local Supabase CLI 2.95.4 and PostgreSQL 17.6 were used. Hosted
Supabase was not used for these tests, migrated or populated with fixtures.

- Enabled OAuth only in local CLI configuration, with an ignored ES256
  signing-key artifact. `npm run prepare:local-auth` generates missing local
  material, validates it and preserves existing keys without logging secrets.
- Added restrictive OAuth policies to 31 public RLS tables and private
  `storage.objects` (32 boundaries). OAuth `client_id` sessions cannot use
  ordinary browser table access, even for the same owner.
- Guarded six legacy business RPC implementations, including their private
  security-definer paths. Their existing signatures, ACLs and search paths
  are preserved. Direct browser behavior still passes the regression suite.
- Extended the database runner to discover all rollback-isolated suites,
  reject incomplete/skipped TAP plans and keep connection details private.
  It never loads production `.env`. Remote databases require an explicit
  disposable-database opt-in and verified TLS. URL query overrides cannot
  redirect a loopback-looking connection or weaken its TLS.
- Replayed all 20 migrations against the verified-empty disposable local
  database. The first replay exposed a hosted-only `rls_auto_enable()` helper
  dependency. Its existing migration now conditionally revokes privileges
  when the helper exists; fresh-local replay passes and hosted restrictions
  remain intact. No already-deployed migration was rerun remotely.
- Fixed two new fixture defects discovered during execution: a nested
  data-modifying CTE and an invalid trade direction. The final suite uses a
  populated canonical trade table, valid `BUY`, and top-level CTEs.

The new 26-assertion suite covers owner/non-owner/anonymous boundaries,
OAuth reads/inserts/updates/deletes, six RPC denials and browser regression.
The existing 100-assertion suite covers trading, monetary normalization,
protected plans, reviews, audits, goals and import staging. Both use
`BEGIN`/`ROLLBACK`; post-test fixture users and trades were zero.

See [local test runbook](LOCAL_INTEGRATION_TESTING.md). No collector, broker
source events or approved integration RPCs are enabled by this migration.

## Checks and environment

Workstation: Python 3.13.2, Node 25.1.0; application Next.js 16.3.6.
No MT5/Python collector or MCP protocol/client tests exist yet in this slice.
The 48-hour demo soak and Windows/VPS operational verification have not begun.

| Command | Result |
| --- | --- |
| `npm test` | Passed: 16 files, 173 tests, including consent/service, login destination and database-runner safety fixtures |
| `npm run typecheck` | Passed, exit 0 |
| `npm run lint` | Passed, exit 0 |
| `npm run build` | Passed, exit 0; 25 pages generated, including `/oauth/consent` |
| `npm run prepare:local-auth` | Passed, exit 0; existing ignored keys preserved |
| `supabase db reset --local` | Passed after portability fix: all 20 migrations; verified-empty local database only |
| `npm run test:db` | Passed with Docker access permission: 26 OAuth + 100 regression assertions, 126 total; sandbox-only retry could not inspect the Docker pipe |
| `supabase db lint --local --schema public,private --level error --fail-on error` | Passed, exit 0; no schema errors |
| `supabase db advisors --local --type security --level warn --fail-on error` | Passed, exit 0; no issues found |
| `supabase migration list --local` | All 20 local migration versions aligned |
| `npm run check:integration-auth` with process-only `SUPABASE_URL=http://127.0.0.1:54321` | All 11 local metadata checks passed; `readyForPersistence=false`; npm exit 1, underlying script exit 2 (pending full gate) |
| `docker info --format '{{.ServerVersion}}'` | Engine recovered: 28.0.1 |
| `git diff --check` | Passed, exit 0 |

HTTP rendering checks against the existing local dev server (anonymous):

- `/oauth/consent`: HTTP 200; consent page with `noindex` and `no-referrer`.
- `/oauth/consent?authorization_id=fixture-id`: HTTP 307 to
  `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dfixture-id`.
- `/tools/position-size-calculator`: HTTP 200, no authentication redirect;
  calculator remains public and is not marked noindex by the consent page.

Visual browser checks failed to start twice because the browser-control
request-header policy could not initialize. Browser verification is pending,
not passed. That earlier Docker engine/disk blocker is resolved; database
tests now pass with access to the local Docker pipe.

### Review: local verification and OAuth isolation slice

Benchmark: the approved integration roadmap, MT5 plan, architecture and
database contracts. This review covers the built isolation/test slice, not a
completed MT5 or MCP integration.

| Layer | Finding |
| --- | --- |
| Plan alignment | Pass for this slice: disposable database tests, OAuth direct-access denial and regression are implemented. MT5-0 remains incomplete. |
| System integrity | Pass for this slice: authoritative RLS/RPC boundaries, normal browser ownership, immutable audits and canonical monetary/review contracts are preserved. No UI or broker execution changes. |
| Production readiness | Release blocked: real OAuth consent/PKCE/refresh, resource-bound grants and immediate revocation are not implemented/verified; browser and real-client verification remain pending. |

No additional defect was identified in this slice after the portability and
fixture fixes. Two critical release-gate categories remain: unfinished
end-to-end authorization and missing real browser/client verification. These
are explicitly pending planned work, not passed tests. Do not enable approval,
register a production client or claim full MT5 readiness. The earlier imprint
record remains in `ui-registry.md`; this slice introduced no UI patterns.

The production database connection was not substituted for the missing test
database. Migrations and fixture transactions ran locally only. Native Node
TypeScript execution emits a module-type performance warning; the preflight
works without changing the application's package module semantics.

## Required next actions

1. OAuth Server enablement is done; keep dynamic client registration off.
   `/oauth/consent` exists locally and does not approve requests. Deployment
   status was not reverified after the external PR merge. Do not register
   production clients or use a deployed consent URL until grant/RLS hardening
   is complete.
2. Docker/local database verification is done. Keep the local signing artifact
   outside Git/logs and follow the runbook; no hosted test fallback is needed.
3. Implement account-bound grants, resource-bound tokens, approved integration
   RLS/RPC checks and revocation; then register a controlled local PKCE client.
   Verify the actual consent/grant workflow,
   and complete every authentication check before broker persistence.
   If required PKCE/resource/revocation behavior is incompatible, revise the
   plan explicitly; never replace it with a shared secret or weaker checks.

MT5 persistence is held at the approved authentication gate. MCP stays parked.
The earlier groundwork was externally merged before this verification resumed;
that repository state is preserved. This slice does not approve full MT5 merge
or rollout and has not pushed changes to `master`.
