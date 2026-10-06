# MT5 hosted authentication: real pilot checkpoint

Date: 2026-10-06 (Africa/Kampala). Branch: `feature/mt5-sync`.
Hosted application: `https://tradeos.veilcode.studio`.
Scope: the user-selected `USD100K DEMO` integration only. This is not MT5 release
approval, reconciliation approval or MCP readiness.

## Real consent and protected persistence

The user completed the real account selector and approval in Trade OS. The
loopback callback intentionally returned `text/plain`, "Trade OS connection
approved. You can close this tab." It is not a missing React page. The bounded
receiver exchanged the code using S256, validated account/client/resource claims,
called the live signature/grant-checked session API, and persisted READY credentials
using the existing user-scoped Windows DPAPI vault outside Git.

The helper exited 0. A separate read-only hosted check confirmed ACTIVE,
non-revoked MT5 permission, correct resource and the exact selected account.
There were zero terminal connections at that checkpoint. Tokens, callback codes,
PKCE verifiers and provider response bodies were not logged or committed.

## Actual hosted checks

`node .artifacts/mt5-pilot/run_hosted_auth_check.mjs refresh` exited 0 with seven
checks passing:

1. Live owner/account/client/grant matches the protected credential.
2. Actual provider refresh rotates the refresh token and saves the replacement
   with Windows protection, preserving the grant. Only the cached expiry hint
   was moved conservatively into the past; no JWT was forged or expiry extended.
3. The shared TypeScript verifier cryptographically validates the refreshed token
   against the actual hosted public JWKS, issuer, resource and grant. Wrong issuer
   and wrong resource are rejected without contacting a foreign host.
4. The real OAuth credential sees no workspace account rows via the Data API.
5. Database authorization rejects a wrong resource, HTTP 401/403 with SQLSTATE 42501.
6. An MT5 grant cannot authorize MCP scope, HTTP 401/403 with SQLSTATE 42501.
7. The actual application session endpoint rejects a tampered JWT signature.

The initial check wrapper rejected missing NEXT_PUBLIC settings before any OAuth
request. It was corrected to use the application's existing server-named public
Supabase configuration, with the project URL pinned. No secret fallback was added.
Only the public key is passed privately to the Python check; database credentials
are excluded. Credential IPC to the signature verifier is bounded and never printed.

## Pending browser-assisted gates

- Verify normal direct browser login remains usable and logout still protects the
  workspace. Public calculator and anonymous authorization boundaries already
  passed the deployment report; this is not a substitute for the logged-in check.
- Create the exact demo terminal mapping through the approved browser workflow,
  then prepare local PAUSED outbox and available-history staging/preview.

Browser automation currently fails while loading its request-header policy.
No cookies were extracted, security policy bypassed, browser profile copied,
browser JWT fabricated, or administrative grant substituted. The user was asked
to perform the specific revoke action while remaining checks are prepared.
Browser inventory subsequently recovered, but the attached Chrome profile exposed
only a Trade OS login page, not the user's signed-in settings session. The exact
mapping values and normal sign-out/sign-in check were handed to the user rather
than extracting or transferring authentication between browser profiles.

## Completed real browser revocation

The user clicked the selected MT5 client's normal Revoke access action and reported
`Application access and provider consent revoked.` The subsequent exact command
`node .artifacts/mt5-pilot/run_hosted_auth_check.mjs revoked` exited 0:

- The same cached access token was rejected by the actual application session API.
- The actual provider rejected that credential's refresh request.
- The local protected vault was marked REAUTH_REQUIRED rather than silently
  retrying or treating revoked credentials as usable.

No administrative mutation was substituted for the browser workflow. Fresh consent
was opened using `.artifacts/mt5-pilot/authorize_pilot_pkce_check.py`; its bounded
loopback listener is waiting for user approval. That helper will submit one
intentionally incorrect verifier, require provider rejection, then use the valid
S256 verifier and repeat authoritative account/grant validation before restoring
READY. These latter checks subsequently passed, as recorded below.

## Restored consent and live PKCE rejection

`.artifacts/mt5-runtime/Scripts/python.exe .artifacts/mt5-pilot/authorize_pilot_pkce_check.py`
exited 0 after the user's new approval for the same account. The actual hosted
provider rejected the intentionally wrong verifier and then accepted the correct
S256 exchange. The credential was again accepted only after live signed-token,
owner/account/client/resource/grant validation and Windows-protected persistence.
The user independently reported the success callback.

A read-only hosted check confirmed the same account/resource, ACTIVE grant version
2 and preserved append-only event sequence: APPROVED, ACTIVATED, REVOKED, APPROVED,
ACTIVATED. Normal browser sign-out/sign-in and dedicated terminal mapping were
requested next. The hosted cryptographic/refresh/revocation checks are complete;
the login regression and complete pilot remain pending. No broker capture occurred.

The full hosted authentication gate is not yet complete. Collection/publication
remain stopped; no broker history has been persisted, baseline changed, startup
task installed or MCP enabled by these checks.

## Dedicated terminal identity recheck

The existing read-only `verify_identity.py` exited 0 at
2026-10-06T02:04:30.824Z. It confirmed exact server `Exness-MT5Trial9`, login
`477190850`, DEMO, HEDGING, USD precision 2, dedicated installation/data paths,
terminal build 6230 and SDK 5.0.6231 using the actual adapter's identity guard.
The owned probe had a 30-second parent deadline; only its Python PID could be
terminated on timeout, never the terminal. No history/order/position read occurred.
Observed balance/equity were 102032.53 with zero observed unrealized profit.
These are broker observations, not an approved canonical reconciliation. The
Trade OS opening baseline remains 100000.00.
