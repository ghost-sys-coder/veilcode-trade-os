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

## Observed authentication gate

The sandboxed probe could not reach the provider. The same command repeated
with network permission reached it: OAuth discovery returned HTTP 404;
public JWKS returned HTTP 200 with an accepted asymmetric public signing key.
Both discovery paths were probed; endpoint capability checks remain failed.

`metadataReady` and `readyForPersistence` are false. Exit 1 indicates failed
metadata preflight; exit 2 will indicate successful metadata with remaining
end-to-end checks pending. This preflight never authorizes persistence itself.

Browser inspection reached the Supabase administrator sign-in page; project
OAuth configuration could not be verified. A 404 alone does not establish
whether OAuth is disabled or another project configuration issue exists.

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
| `npm test` | Passed after final hardening: 13 files, 123 tests (22 authentication cases) |
| `npm run typecheck` | Passed, exit 0 |
| `npm run lint` | Passed, exit 0 |
| `npm run build` | Passed, exit 0; 24 pages generated |
| `npm run test:db` | Could not run: `TRADE_OS_TEST_DATABASE_URL` missing |
| `npm run check:integration-auth` | Exit 1: metadata gate failed (HTTP 404); network-enabled retry confirmed |
| `docker info --format '{{.ServerVersion}}'` | Local Docker engine pipe unavailable; no disposable database available |
| `git diff --check` | Passed, exit 0 |

The production database connection was not substituted for the missing test
database. No migrations or production test data were created. Native Node
TypeScript execution emits a module-type performance warning; the preflight
works without changing the application's package module semantics.

## Required next actions

1. Project administrator signs in and checks Authentication → OAuth Server.
   Confirm/enable the intended OAuth server using the
   [official setup guide](https://supabase.com/docs/guides/auth/oauth-server/getting-started).
   Do not share passwords or keys in chat. Client registration and consent URL
   configuration must be coordinated with the upcoming consent implementation;
   do not point authorization at an unimplemented route or enable unrestricted
   dynamic client registration as a shortcut.
2. Provide/start a disposable Supabase test database and set
   `TRADE_OS_TEST_DATABASE_URL` locally, without exposing it in Git or reports.
3. Repeat preflight, implement and verify the actual consent/grant workflow,
   and complete every authentication check before broker persistence.
   If required PKCE/resource/revocation behavior is incompatible, revise the
   plan explicitly; never replace it with a shared secret or weaker checks.

MT5 persistence is held at the approved authentication gate. MCP stays parked.
No feature branch has been merged or pushed by this slice.
