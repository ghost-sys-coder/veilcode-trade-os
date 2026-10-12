# Controlled MCP consent-host release

Date: 2026-10-11. User approved releasing the verified handoff on production's
consent page while keeping production MCP disabled. This is not production MCP
activation or completion of the actual-client matrix.

## Source and release boundary

Production initially served `cb00d28c561378fe17e7529c44bf9b926d2f1a49` from
`dpl_EYDKapF3KofqUtErWGRXzmVsJG8P`. The remote master matched that commit.
Its tree was compared with tested `46a610cd3188374568be9d99e6760a622add32ce`:
only the approved consent page/service, tests, empty config example and three
documentation files differed. Existing production/user changes were preserved.

An exact Git archive of `46a610c` was used for the release package. No local
credentials, `.env`, untracked user files or AI-provider keys were uploaded.
The package was linked to the existing team/project using public IDs only.
The installed CLI staged it with `deploy --prod --skip-domain --no-wait`; this
did not replace the live site before verification. After it became READY and
passed all staged checks, the exact production-target build was promoted without
a rebuild using the authenticated promotion API.

- Live deployment: `dpl_AhoLhzzTkHG3EhjAasYiHz8sDrf4`.
- Immutable URL: `https://trade-62e5sudr2-ghostsyscoders-projects.vercel.app`.
- Live alias: `https://tradeos.veilcode.studio`.
- Source: `46a610c`; Next.js 16.3.8.
- Build logs: `Application database preflight PASS: 35 functions and 14 version/order columns.`
- Production `TRADE_OS_MCP_ENABLED=false`, MT5 remains true and its integration
  origin remains `https://tradeos.veilcode.studio`.
- New production-only handoff setting is exactly `https://mcp-preview.veilcode.studio`.
  Provider Site URL and `/oauth/consent` path were not changed.

Master was **not merged or rewritten**. Before any future master-based production
deployment, merge the verified handoff through the normal review workflow, or it
would replace this manually staged consent-host code with the older master tree.
Do not report master as consolidated by this release.

## Hosted checks

Protected staged production checks used `vercel curl` with existing CLI
authentication, capturing all credentials/headers privately. Live production
checks used anonymous normal HTTPS without bypass headers or redirect following.

| Boundary | Staged production | Live production |
| --- | --- | --- |
| Public calculator | 200 | 200 |
| Login | 200 | 200 |
| Accounts and daily journal | 307 to application login | 307 to application login |
| Consent without request | 200, no approval | 200, no approval |
| Opaque invalid request without browser session | 307 to login | 307 to login |
| MCP and MT5 discovery | 200, exact production resource/issuer | 200, exact production resource/issuer |
| MCP API without token | 403 intentional wrong-host denial on immutable URL | 401 with OAuth challenge |

Both complete runs passed **9/9** checks. The immutable URL's origin rejection is
the existing hostname-binding contract, not an authentication workaround.
The normal production alias independently passed the expected 401 challenge.

The runtime-log connector returned no usable result; the documented installed
CLI fallback succeeded: `logs dpl_AhoLhzzTkHG3EhjAasYiHz8sDrf4 --no-follow --no-branch
--level error --since 30m --limit 50 --json`. Zero error records were observed in
that bounded deployment/window scan. This is not a long-running monitoring or
authenticated browser-console pass. Monitoring drains were not inspected here.

## Staging-only client acceptance enabled

After the production release passed, the approved staging resource was enabled
with an exact-row/no-active-grant/unchanged-MT5-fingerprint transaction. The MCP
flag was changed to true **only** for Preview `feature/mcp-access`; Preview MT5
remains false. A fresh same-source staging build was created and its exact alias
assigned only after READY verification:

- Deployment: `dpl_4N6uwt5iJCZr9DLFwqxeGYMDwUmU`.
- Immutable URL: `https://trade-miejxcegy-ghostsyscoders-projects.vercel.app`.
- Canonical resource: `https://mcp-preview.veilcode.studio/mcp`.
- Source: `46a610c`; public client ID `93aa702b-b214-464b-9b82-7eac91949078`.

All six anonymous staging boundary checks passed again. The ordinary branch
Preview remains behind Vercel protection; only the user-approved staging hostname
has its exception. MT5 resource/grant fingerprints remained unchanged. No broker
orders, collector restart or terminal changes occurred.

## Consent and client acceptance: pending

### First-visit defect and correction

The user's first hosted visit displayed a disabled “Approval unavailable” form.
The initial router checked private request ownership before the provider's normal
details read had bound a fresh authorization to the browser user. That first RPC
failed; the later page read bound ownership but did not retry the handoff, leaving
the user on production where MCP is intentionally disabled. No access was granted.

The correction uses the normal authenticated provider details read only when the
initial private context check fails. It accepts only a pending request with the
exact request ID/user, then repeats authoritative owner/resource/S256/expiry
validation and matches client/callback before routing. Provider resume-code
responses on this binding fallback must match approved private context and the
registered callback; their codes are discarded, never forwarded. Already-owned
requests still route without another details read. No checks were removed.

Twelve additional unit cases cover binding, reconnects, malformed responses and mismatches. The separate explicit
`npm run test:consent-provider` gate exercises the actual disposable provider and
database: initially unowned first visit routes without approval; plain PKCE,
wrong resource and naturally expired requests reject. All five final checks passed, and its
client/user/resource fixtures were cleaned/restored. A fifth covers first-visit
reconnect after provider consent, discarding its verified resume code instead of
forwarding it. Run this gate sequentially with other provider/browser gates: its
explicit lock check fails immediately before any preparation if another fixture
is active. An earlier concurrent attempt hit the setup deadline and is not counted
as a pass. This gate is excluded from
the pure unit suite and never reads the hosted .env. The original browser request
timed out safely while the correction was verified; a fresh normal request will
be opened after the corrected build is released. Do not revoke/remap MT5.

The first 9/9 anonymous hosted checks did not establish first-visit authenticated
handoff success. That distinction is retained; do not count the disabled-form
attempt as an actual-client pass. Corrected hosted acceptance is still pending.

Final correction verification: full unit suite 1055/1055 across 62 files;
explicit real-provider gate 5/5; browser/provider regression 65/65; MCP SDK/HTTP/
stdio gate 72/72. Typecheck, full lint and production build passed. The 27 database
suites passed earlier in this controlled release; no schema or private RPC was
changed by the binding-order correction. Commands use the same direct Node
entry points recorded in the preflight report, with the new provider command
`node node_modules/vitest/vitest.mjs run --config vitest.consent.config.mts`.

The normal adapter login for `codex-staging` has opened browser consent with a
three-minute, one-use loopback receiver. No code/token/cookie/PKCE verifier was
logged. User browser sign-in and approval are required. An opened window is not
proof of handoff, consent or connection success; record the resulting protected
credential/token/live-tool verification before advancing the matrix.

No actual Codex read/write/refresh/revocation pass is claimed yet. Existing local
SDK/provider/browser/native-helper evidence remains in the staging report and
does not substitute for requested actual AI clients. No model inference was used.

## Corrected hosted receipt, 2026-10-12

Correction source `09e40054ee6055892e410dd50b715227edae54ea` is pushed and
remotely verified. Production deployment `dpl_BPFMhVmrkDX5evNh6bD7cL3PSbaq`
(`trade-45eqxfmj4-ghostsyscoders-projects.vercel.app`) is READY and serves the
normal production alias. Corrected Preview `dpl_FSGGvR26NYQyQTiLTgMhroRWaXCh`
(`trade-79hqk30th-ghostsyscoders-projects.vercel.app`) is READY and serves the
dedicated staging alias. Production's 35-function/14-column database preflight,
9 staged and 9 live boundary checks passed; staging's six checks passed.
The corrected production deployment's bounded 30-minute error-log scan returned
zero records. This is not an all-time monitoring or browser-console pass.

The user subsequently reported the normal callback message, "Trade OS
authorization received. You can close this tab. Check the terminal for connection
verification." Terminal verification succeeded: signed resource-bound token,
Windows-protected storage and a live MCP connection. Hosted readback found exactly
one ACTIVE grant for this Codex client. The MT5 grant fingerprint was unchanged.
No revocation/remapping was needed, and production MCP stayed disabled.

Native Codex discovery/read evidence and the subsequent failed-closed refresh
are recorded separately in [the client checkpoint](MCP_CODEX_CLIENT_VERIFICATION.md).
This corrects the earlier pending hosted-consent checkpoint without changing
the fact that the original disabled-form attempt failed. The entire client matrix
is not complete. Master was last observed at `4b8a3ab` (the user-consolidated
earlier release); source correction `09e4005` still needs normal consolidation
before a future master-based deployment. No master merge was performed here.

## Rollback

The pre-release production build ID above is retained for a scoped rollback if
needed. Disable only the staging MCP flag/resource and revoke only its individual
application/provider grants when required. Remove the production handoff setting
to stop routing; never alter MT5 origin, sessions or collector state to undo MCP.
Application grants and audits/provenance remain preserved. No rollback was needed.
