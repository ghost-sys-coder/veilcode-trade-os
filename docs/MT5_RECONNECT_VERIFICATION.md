# MT5 OAuth reconnect correction

Date: 2026-10-06 (Africa/Kampala). Branch: `feature/mt5-sync`.
Scope: restore an already-approved connection without revoking access, changing
its account, or widening permissions. This is not full MT5 release approval.

## Diagnosis and approved blueprint

The actual pilot grant remained ACTIVE version 2 and its demo mapping remained
ONBOARDING, but the old global browser logout had removed its OAuth session.
The next authorization request was provider-approved for the selected owner,
resource and loopback callback. Trade OS nevertheless blocked the provider's
already-consented redirect response. The request then expired and the bounded
receiver returned OAUTH_CALLBACK_TIMEOUT. No source facts or trades were written.

The user explicitly approved implementing and testing a reconnect correction.
The [current Supabase reference](https://supabase.com/docs/reference/javascript/oauth-server-getauthorizationdetails)
documents two responses: fresh consent details or an already-consented redirect.
Provider consent alone remains insufficient for Trade OS application access.

## Implementation

- The provider adapter returns an untrusted RESUME_CANDIDATE only after validating
  the direct browser identity. It cannot authorize or forward a code itself.
- The grant service checks the same authorization ID using the existing private
  RPC: direct owner, unexpired pending/approved request, S256 and enabled resource.
  Reconnect specifically requires approved status.
- Exactly one active, non-revoked grant must match client, purpose and configured
  resource. MT5 must retain its existing account; an accountless MCP grant can
  resume only when MCP is separately enabled.
- The granted MT5 account must still be readable through owner RLS. A missing
  account is blocked, never silently replaced with another account.
- The provider callback must match the database-verified registered destination.
  Extra credentials, duplicate code/state, changed destinations and fragments are
  rejected. Only a fully validated result can trigger the page's server redirect.
- Reconnect performs no application grant approval, activation, revocation,
  version change, new account selection or grant audit mutation. A stale approval
  form cannot turn reconnect into an account switch.
- Existing token-hook, resource, session and immediate-revocation enforcement
  remain authoritative at exchange and on every authenticated API request.
- Fresh consent still requires an explicit account selection. Missing, expired or
  invalid requests never become self-authorizing consent pages.

No database migration, production credential change or feature-flag change is
needed. The broker terminal and account opening baseline are untouched.

## Verification checkpoint

- Focused consent/reconnect tests: PASS, 58 tests across 3 files.
- `npm test`: PASS, 453 tests across 34 files.
- `npm run test:db`: PASS, all 10 rollback-isolated disposable local suites.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS, Next.js 16.3.6.
- `npm run check:mt5-python`: PASS.
- `npm run test:mt5-python`: PASS, 167 tests, including native Windows credential
  protection and owned-process recovery. No broker is accessed by these fixtures.

The first browser reconnect run reached 37 checks, then hit a connection-refused
error on the direct local provider navigation. It is not counted as passed. The
reconnect fixture now follows the established first-consent harness: bounded
real-provider HTTP redirect, strict origin/path validation, then actual Chrome
navigation to that exact consent request. Crucially it does not prefetch provider
details, which could consume an already-consented one-use code outside the app.
The isolated auth-only reproduction identified the exact failure: the validated
application redirect reached `127.0.0.1:9876/callback` with a code, but Playwright
route interception applies only to the first URL in an HTTP redirect chain. No
real callback listener was present. The harness now uses an exclusive, bounded
loopback HTTP receiver for both initial consent and reconnect, checks state/host/
method/path, suppresses request values, and closes the owned listener on cleanup.
This changes test infrastructure only; application security checks were retained.

`npm run test:integration-browser -- --auth-only`: PASS, all 24 checks using the
real local provider, Chrome 154.0.8037.93 and Windows-protected Python credentials.
The actual reconnect exchanged S256, cryptographically verified the issued token,
preserved account/grant/version/event count, then survived local browser logout
and provider refresh. Explicit application/provider revocation still rejected
both cached credentials and refresh. Full-suite and hosted outcomes follow below.

`npm run test:integration-browser`: PASS, all 46 checks with Chrome
154.0.8037.93. This includes actual HTTP capture/replay/fencing, source-backed
publication, symbols/cash/onboarding, the same-grant reconnect, browser logout,
refresh and explicit application/provider revocation. No uncaught client runtime
errors occurred. The existing Node module-type warning remains non-fatal.

## Scoped review

- Plan alignment: PASS. Already-approved reconnects reuse the existing account;
  fresh consent and explicit revocation retain their original workflows.
- System integrity: PASS. Consent UI only redirects a verified service result;
  privileged ownership/S256/expiry checks remain in the private database RPC.
  No token forging, browser-cookie extraction, RLS relaxation, service-role
  exposure, financial recalculation or new broker execution capability.
- Automated readiness: PASS. All listed commands passed. The earlier callback
  failures were diagnosed and replaced with actual bounded loopback verification,
  not counted as successful runs or hidden by weakening application checks.

No issues found in the scoped automated review. Hosted reconnection remains a
separate operational verification, not an inferred pass from unit fixtures.

## Pending operational gates

Hosted reconnection, available-history staging, source-backed financial review,
publication approval, unattended startup and the full MT5 release gate are not
completed by these automated tests. MCP remains disabled. No demo-soak or
real-client coverage is claimed without corresponding evidence.
