# Integration foundation: authentication preflight

Date: 2026-10-05. Branch: `feature/mt5-sync`.
This is an interim implementation report, not MT5/MCP completion or merge approval.

## Delivered

- Saved all three approved plans in the documentation commit `b17c14a`.
- Created `feature/mt5-sync` and `feature/mcp-access`; the latter is parked
  at the documentation commit. `master` remains at `412da1c`.
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
grant persistence, resource-bound JWT verification, access-token hooks, RLS
hardening, durable application mutation receipts and revocation checks are
still pending. No integration data endpoints or broker persistence exist yet.

The denial-only service tests use controlled provider fixtures, not a real
registered OAuth client. They are not proof of PKCE/token exchange, refresh
rotation, database isolation or real-client compatibility.

The following remain pending, not passed:

- Real browser consent, valid PKCE exchange and wrong-verifier rejection.
- Refresh and rotated-credential persistence/reuse handling.
- Intended-resource binding and rejection of wrong-resource tokens.
- Immediate grant revocation, account-scoped RLS and denied direct writes.
- Existing login/logout/callback and anonymous calculator browser regression.

## Checks and environment

Workstation: Python 3.13.2, Node 25.1.0; application Next.js 16.3.6.
No MT5/Python collector or MCP protocol/client tests exist yet in this slice.
The 48-hour demo soak and Windows/VPS operational verification have not begun.

| Command | Result |
| --- | --- |
| `npm test` | Passed: 15 files, 161 tests (including consent boundary/service fixtures and login destination regression) |
| `npm run typecheck` | Passed, exit 0 |
| `npm run lint` | Passed, exit 0 |
| `npm run build` | Passed, exit 0; 25 pages generated, including `/oauth/consent` |
| `npm run test:db` | Could not run: `TRADE_OS_TEST_DATABASE_URL` missing |
| `npm run check:integration-auth` | Discovery now HTTP 200; metadata passed, end-to-end gate pending; npm exit 1, underlying script exit 2 |
| `docker info --format '{{.ServerVersion}}'` | Local Docker engine pipe unavailable; no disposable database available |
| `git diff --check` | Passed, exit 0 |

HTTP rendering checks against the existing local dev server (anonymous):

- `/oauth/consent`: HTTP 200; consent page with `noindex` and `no-referrer`.
- `/oauth/consent?authorization_id=fixture-id`: HTTP 307 to
  `/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dfixture-id`.
- `/tools/position-size-calculator`: HTTP 200, no authentication redirect;
  calculator remains public and is not marked noindex by the consent page.

Visual browser checks failed to start twice because the browser-control
request-header policy could not initialize. Browser verification is pending,
not passed. Docker was also checked with permission outside the sandbox:
the `dockerDesktopLinuxEngine` pipe was absent. The test database blocker is
not just sandbox permissions.

### Interim review

- Plan alignment: this is MT5-0 consent groundwork, not the full integration;
  approvals, grants, resource binding and real OAuth exchange remain pending.
- System integrity: service/domain boundaries, verified owner, sanitized
  provider responses, existing login redirect rules and UI tokens preserved.
  The imprint skill recorded consent patterns in `ui-registry.md`.
- Production readiness: do not enable approval, register a production client
  or merge MT5 until database isolation/resource/revocation gates pass.
  Missing visual/real-client/disposable-database checks are release blockers.

The production database connection was not substituted for the missing test
database. No migrations or production test data were created. Native Node
TypeScript execution emits a module-type performance warning; the preflight
works without changing the application's package module semantics.

## Required next actions

1. OAuth Server enablement is done; keep dynamic client registration off.
   `/oauth/consent` now exists locally, but it is not deployed to the production
   Site URL, and it does not approve requests. Do not register production
   clients or use a deployed consent URL until grant/RLS hardening is complete.
2. Start the installed Docker Desktop Linux engine for a disposable local
   Supabase database, or provide a disposable Supabase test database and set
   `TRADE_OS_TEST_DATABASE_URL` locally, without exposing it in Git or reports.
3. Implement account-bound grants, resource-bound tokens, restrictive OAuth
   RLS/RPC checks and revocation; then register a controlled PKCE test client.
   Verify the actual consent/grant workflow,
   and complete every authentication check before broker persistence.
   If required PKCE/resource/revocation behavior is incompatible, revise the
   plan explicitly; never replace it with a shared secret or weaker checks.

MT5 persistence is held at the approved authentication gate. MCP stays parked.
No feature branch has been merged or pushed by this slice.
