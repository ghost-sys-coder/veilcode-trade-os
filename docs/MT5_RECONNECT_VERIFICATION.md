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

## Hosted rollout and real reconnect

Source `d95be83` was pushed on `feature/mt5-sync`. The candidate built successfully
using `vercel deploy --prod --skip-domain --yes --non-interactive --meta tradeOsRollout=verified-grant-reconnect`.
`vercel inspect https://trade-opss3am8j-ghostsyscoders-projects.vercel.app`
confirmed READY deployment `dpl_xeZLyn4cSf4wxdeRJxfiJotGKM7S` (Next.js 16.3.6).
All eight staged checks through protected-deployment `vercel curl` passed;
deployment protection was not disabled and the user's reference screenshot
remained unavailable publicly (404).

`vercel promote https://trade-opss3am8j-ghostsyscoders-projects.vercel.app --yes --non-interactive`
succeeded. The seven live public/security checks and private-schema 406/PGRST106
check passed again. A bounded error-only ten-minute log scan succeeded with zero
error records; log bodies were suppressed. Rollback target is
`dpl_5DDGBdDVhF8jWYjbKzfFBoyP9NKH`.

The real `authorize_pilot.py` exited 0: existing browser/provider consent resumed
the selected account, performed S256 exchange, verified live account/client/grant
binding and saved READY credentials with Windows protection. No user revocation,
new account selection, administrative consent mutation or fake token was used.

Read-only before/after hosted evidence: ACTIVE grant version 2, five grant audit
events and the original ONBOARDING mapping version 1 all remained unchanged.
OAuth session count changed from 0 to 1. Source facts and published trades stayed
0, and opening baseline stayed 100000.00. Actual hosted refresh/signature/resource/
isolation checks (`run_hosted_auth_check.mjs refresh`) passed all seven again.

Normal browser login/logout was previously confirmed by the user; post-fix logout
isolation and refresh were tested against the real local provider/browser. A
separate post-fix hosted browser logout was not performed or claimed. The collector
still checks live authorization on every operation and remains stopped until the
explicitly mapped, account-bound one-shot staging helper is invoked.

## Pending operational gates

Hosted reconnection and one-shot history staging are verified below. Source-backed
financial review, publication approval, unattended startup and the full MT5
release gate remain pending. MCP remains disabled. No demo-soak or real-client
coverage is claimed without corresponding evidence.

## Actual demo history staging

After restored live authorization and the approved browser mapping were verified,
`capture_pilot_once.py` exited 0. It verified binding and acquired a fenced server
lease before reading the approved dedicated demo terminal. The actual supervised
reader retrieved all broker-available history and current-position observations,
froze one SQLite upload page, and committed that page durably through the API.

Both local and server checkpoints are `2026-10-06T03:46:23.337Z`; pending uploads
are 0. Local coordinator mode stayed PAUSED; no continuous collector or startup
task was enabled. No broker order was placed, modified or canceled.

The read-only hosted confirmation showed 86 source facts: 42 deals, 43 orders and
one account observation. No position facts were present in this captured snapshot.
The collection had 1 expected and 1 received batch. There were zero source
revision flags requiring review, but that is not canonical publication,
behavioral-review completion or proof of financial reconciliation.

The existing opening baseline remained 100000.00, account adjustments remained
0 and canonical trades remained 0. A second invocation returned alreadyStaged,
the same checkpoint and PAUSED mode without another capture or publication.
The next step is explicit source-backed preview, cash/symbol/conflict resolution
where needed, and user approval—not automatic publication of these source facts.
