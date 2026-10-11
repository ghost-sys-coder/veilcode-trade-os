# MCP client acceptance: staging preflight

Updated 2026-10-11. Baseline `ab18ade` on `feature/mcp-access` is pushed and
remotely verified. Checklist items 1–4 are delivered; this increment prepares
item 5. Actual AI-client acceptance and production activation are not complete.

## Approved hosted setup

- `mcp-preview.veilcode.studio` is verified on the existing Trade OS project and
  bound only to `feature/mcp-access`. No DNS records, nameservers, production
  domains or MT5 terminal settings were changed.
- After the user explicitly approved removal of this hostname's Vercel login
  gate, an alias-only protection exception was created. Project-wide protection
  and ordinary Preview URLs remain protected. No bypass secret is in any client.
- The branch-only Preview integration origin is `https://mcp-preview.veilcode.studio`.
  Both Preview integration flags remain false. Production configuration is unchanged.
- Rebuilt baseline deployment `dpl_4BUpni2wBrNhLdWRFhgTHBKWH6Q2`, URL
  `trade-6oqc0t0l2-ghostsyscoders-projects.vercel.app`, is READY, target `staging`
  (the Vercel API's Preview target), source `ab18ade72e8ec52d85554acdb12e3ec39277818f`.
  Only the staging alias was pointed to it. This build does not yet contain the
  new consent-handoff code.
- On the user-selected VeilCode Studio Supabase project `nhwlxcrsivmawwmjiwck`,
  `private.integration_resources` now has the MCP resource
  `https://mcp-preview.veilcode.studio/mcp` with **enabled=false**. A guarded
  transaction required no pre-existing MCP resource/active grants and unchanged
  MT5 grant fingerprints. Readback confirmed unchanged MT5 grants and its existing
  enabled production resource. No accounts, trades or collector state were changed.
- Public OAuth client `93aa702b-b214-464b-9b82-7eac91949078`, named
  `Trade OS MCP staging - Codex stdio`, was registered and independently read back:
  public, token authentication `none`, authorization-code/refresh grants, exact
  callback `http://127.0.0.1:9878/callback`. No application grant was created.
  Its public adapter config is ignored at `.artifacts/mcp-clients/codex-stdio.json`;
  it contains no key/token/password. Other actual clients are not registered yet.

## Anonymous staging boundary: 6/6 passed

No cookies, Vercel credentials, bypass headers or redirect following were used.
The bounded probe used standard Node HTTPS with normal certificate verification.

| Request | Verified result |
| --- | --- |
| Staging `/.well-known/oauth-protected-resource/mcp` | 200, exact staging `/mcp` resource and intended Supabase issuer |
| Staging `/mcp` | 401, `INTEGRATION_ACCESS_DENIED` and OAuth challenge |
| Staging `/accounts` | 307 to its application `/login`, not Vercel |
| Staging `/tools/position-size-calculator` | 200, publicly accessible |
| Staging `/oauth/consent` without request | 200, no access approved |
| Ordinary branch Preview `/mcp` | 302 to Vercel login; still protected |

A READY deployment alone, public metadata or these anonymous checks are not
evidence of a hosted authenticated write or an actual AI-client connection.

## Consent handoff implementation

Supabase still sends authorization UI requests to the production site at
`/oauth/consent`. Neither its Site URL nor authorization path was changed.

The new server-side `mcpConsentHandoff` is optional and defaults to off. Its
`TRADE_OS_MCP_CONSENT_HANDOFF_ORIGIN` is an exact HTTPS origin allowlist, not an
integration enablement switch. It requires a verified direct browser identity
and the existing private owned-request, expiry, enabled-resource and S256 checks.
Only MCP requests whose authoritative resource exactly matches that origin's
`/mcp` can be routed. MT5 requests are never routed, and the destination cannot
redirect back to itself.

The handoff forwards only the opaque authorization ID. It does not forward an
authorization code, approve access, create/activate grants, forward cookies or
copy account selections. Staging repeats its own browser/provider, enablement,
resource and grant checks. Production's MCP API can remain disabled throughout.

The first hosted attempt exposed an ownership-binding ordering defect, corrected
by a normal authenticated pending-request details read followed by repeated
private checks. The explicit real-provider first-visit gate now covers that path.
See [release and correction evidence](MCP_CONSENT_RELEASE_VERIFICATION.md); the
older baseline checks below do not claim that first hosted attempt succeeded.

Hosted handoff acceptance is **pending**: the code must first reach the provider's
consent host through a separately approved release, and that host's exact handoff
origin must be configured. Pushing the feature branch does not update production.
Do not change the common production integration origin to staging or bypass any
database/ownership checks to make the flow work.

## Local verification of this increment

Commands below are exact. Direct Node entry points were used after Windows npm
launcher/resource failures; they invoke the same installed scripts/binaries as
the package aliases without weakening assertions. No production test fallback.

| Command | Result |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/integration/consent-handoff.test.ts tests/integration/grant-consent.test.ts tests/integration/oauth-consent.test.ts --maxWorkers=1` | 52 tests, 3 files PASS |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1` | 1043 tests, 62 files PASS; 29 new handoff cases |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test` | All 27 rollback-isolated database suites PASS; local diagnostic setting restored |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS |
| `node node_modules/eslint/bin/eslint.js` | PASS, no warnings |
| `node node_modules/next/dist/bin/next build` | PASS, Next.js 16.3.8 |
| `node --experimental-strip-types scripts/test-integration-oauth.mts --browser` | 65 checks PASS, Chrome 154.0.8037.99 |
| `node --experimental-strip-types scripts/test-mcp-integration.mts` | 72 checks PASS, SDK 2.3.1; real local modern/legacy HTTP and stdio subprocesses |
| `node scripts/run-mcp-python.mjs` | 6 native Windows credential-helper tests PASS |
| `node scripts/run-mcp-python.mjs --check` | Ruff/compileall PASS |
| `git diff --check` | PASS |

The provider/browser gates use disposable users/clients and restore their local
resource rows. They do not use hosted user data or the new hosted staging client.
Real local fixtures include 100 − 2 − 3 = 95 USD canonical closure, exact 5.00-lot
position sizing, 10.00 USD partial win with 0.10R, 5000.00 drawdown preserved across
withdrawal, 95050.00 ledger balance and 12.01 − 10.00 = 2.01 USD cash reconciliation.
These are regression evidence, not newly performed real-terminal activity.

Earlier failed attempts are not counted as passes: parallel unit execution under
low RAM had timed private-file failures; a Windows npm launcher retry failed to
execute; local Supabase initially was unavailable and correctly refused a hosted
fallback; the first browser run found no test server on port 3100. After recovery,
the isolated server uses `.next-integration`, separate from normal development.
All final runs above passed. The existing Node module-type warning is stderr only.

## Actual-client matrix: still pending

Installed version/help checks identified Codex CLI 0.147.0, Claude Code 2.1.119
and Gemini CLI 0.57.0. They are setup observations, not consent/read/write/renewal/
revocation passes. ChatGPT Desktop/remote and Claude remote remain pending too.
Local SDK fixtures do not substitute for these checks. No model inference or
AI-provider API keys were used; the existing Claude/MT5 connection was untouched.

## Remaining release sequence

1. Release the verified consent handoff on the provider's consent host without
   enabling production MCP, using the approved exact staging origin only.
2. Enable the staging resource and MCP-branch Preview flag for controlled
   acceptance, then verify the exact new build. Do not enable MT5 on Preview.
3. Start client authorization normally and obtain owner browser consent. Register
   separate public clients for the remaining paths; do not reuse the MT5 client.
4. Record actual client consent/discovery/read/write/refresh/revocation results and
   exact versions. User-driven AI-client tool use is needed where the client offers
   no no-inference test API; do not invoke model APIs as a shortcut.
5. Finish hosted acceptance and obtain separate production activation authority.

Rollback is scoped: revoke the exact staging alias protection exception to restore
its Vercel gate; keep/return the staging flag and resource to disabled; remove the
handoff setting from its consent host if configured. Retain provenance, grants and
audits, and revoke individual staging application/provider grants explicitly if
necessary. Never sign out/revoke every user or modify MT5 to undo this setup.

References: [Supabase OAuth setup](https://supabase.com/docs/guides/auth/oauth-server/getting-started),
[Vercel domain-specific protection exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions).
