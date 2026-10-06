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

- Temporarily revoke only this selected grant through normal connected-client UI,
  then verify immediate rejection of the cached access token and provider refresh.
- Restore it through fresh browser consent, also verify rejection of an incorrect
  PKCE verifier against a real authorization code before the valid exchange.
- Verify normal direct browser login remains usable and logout still protects the
  workspace. Public calculator and anonymous authorization boundaries already
  passed the deployment report; this is not a substitute for the logged-in check.
- Create the exact demo terminal mapping through the approved browser workflow,
  then prepare local PAUSED outbox and available-history staging/preview.

Browser automation currently fails while loading its request-header policy.
No cookies were extracted, security policy bypassed, browser profile copied,
browser JWT fabricated, or administrative grant substituted. The user was asked
to perform the specific revoke action while remaining checks are prepared.

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
