# MCP: verified existing-consent reconnect

2026-10-12. This is a scoped correction to client acceptance, not full MCP
completion. The user explicitly approved implementation and release of this
reconnect path while production MCP remains disabled and MT5 unchanged.

## Root cause and approved contract refinement

The new Codex login reached "No valid authorization request is available."
Hosted readback showed the exact staging resource/callback/S256 request was
already provider-approved before user interaction. The production consent host
still served `09e4005`; staging served the READY `97cad5c` build.

[Supabase's authorization-details contract](https://supabase.com/docs/reference/javascript/oauth-server-getauthorizationdetails)
returns a redirect when provider consent already exists. That read issues a
one-use code rather than merely returning display information. The handoff
discarded this code and sent its now-approved opaque request ID to staging.
Staging's second details read could not recover that code. The earlier provider
fixture tested the routed ID, not the complete reconnect/token exchange, and
therefore missed this defect. The hosted callback timed out; no credential was
saved and no access was revoked/remapped.

Approved distinction:

- New consent: forward **only** the opaque request ID to the allowlisted staging
  consent page. Staging repeats normal checks and handles explicit approval.
- Provider auto-consent: after verified ownership and private enabled-resource,
  S256, expiry, exact client/callback checks, verify exactly one ACTIVE matching
  account-free MCP grant. Recheck private context and unchanged grant ID/version/
  status before returning the provider code **directly to the exact registered
  callback**. Never put the code in the staging URL or logs.
- No application approval, activation, version/audit change, account selection,
  arbitrary redirect or provider-revocation call occurs during reconnect.
- The exception requires the explicit HTTPS consent-host allowlist and exact
  staging resource. Production `/mcp` remains disabled. Token signature/resource/
  session/grant enforcement and each API's live checks remain authoritative.
- Missing, pending, revoked, wrong-purpose/resource/account grants, duplicate
  matching grants, provider/private errors and changed context/version fail closed.
  Provider consent alone is never authority for application access.

The installed Next.js redirect guide was reviewed before the service change;
the existing page calls `redirect` outside the service's error boundary. No UI,
SQL, migration, monetary, trade, review or MT5 implementation changed.

## Local verification

The real disposable-provider fixture now follows the callback through S256 code
exchange and signed resource-bound token verification, rejects code replay and
compares full grant fingerprints/audit counts before and after reconnect. It also
proves provider-only consent cannot create an application grant.

- `node node_modules/vitest/vitest.mjs run --config vitest.consent.config.mts`:
  **6/6 PASS**, including final cleanup and resource restoration.
- Handoff unit coverage increased from 41 to 62 cases; full regression results
  are recorded below after final completion, not inferred from that count.
- Latest reconnect code: targeted ESLint (service/provider fixture/unit fixture)
  and full TypeScript check passed. Production's exact MCP flag was read back as
  `false`; no environment variable was changed.
- The initial full regression run had **1084 PASS / 2 Storage-test timeouts**
  while RAM fell to about 330 MB and lint/provider checks overlapped. It is not a
  pass. No timeout/assertion was relaxed; checks were moved to sequential runs.
- The same two tests timed out again sequentially and one timed out in its
  isolated file run. Both use general deep-object equality on 393216-byte Buffers;
  a local comparison measured native equality at about 0.08 ms versus about
  629 ms for the general comparator (timings are machine-specific, not a service
  benchmark). An equivalent length-plus-native-byte comparison was proposed
  for these test assertions only. The user explicitly approved it: each comparison
  now checks the exact length and native `Buffer.equals`, preserving all byte
  checks and the original timeout. The isolated Storage file then passed **17/17**
  in 3.59 seconds (603 ms test time). No production Storage code changed.
- Production build: `node node_modules/next/dist/bin/next build`: PASS,
  Next.js 16.3.8. No deployment was made by this command.
- Final full unit run, with no competing test/lint process:
  `node node_modules/vitest/vitest.mjs run --maxWorkers=1`:
  **1086/1086 PASS, 62 files**, 96.31 seconds. A prior run with overlapping lint
  had a 15-second legacy SDK fixture timeout; it is not a pass and that timeout
  was not relaxed. Storage's approved byte comparisons remained exact.
- Full lint: `node node_modules/eslint/bin/eslint.js`: PASS. Targeted lint and
  full typecheck also passed; no assertion, timeout or authentication check was
  weakened to complete these gates.
- Read-only hosted fallback after two connector transport failures used the
  already configured session pooler and downloaded CA certificate with strict
  TLS, exact project/hostname validation, bounded requests and a READ ONLY
  transaction. It confirmed one ACTIVE Codex grant, two grant audit events and
  unchanged MT5 grant fingerprint. No credential, owner ID or source payload was
  logged. GitHub remote preflight then failed with a network category (not an
  authentication or certificate category); no push/force operation occurred.
- The first expanded provider run passed six cases but failed fixture cleanup
  because it now created protected grant audits. Cleanup was corrected to use an
  exact disposable user/client and transaction-local trigger suppression on the
  validated loopback database, following the established integration runner.
  The retained fixture's exact resource/owner pattern/time window was independently
  identified; readback confirmed zero fixture users/grants after cleanup. The
  provider's repeated client-delete response was not counted as a successful API
  cleanup; independent absence checks established the final state.

No hosted fixture deletion or production test fallback was used. Local fixture
audit cleanup is not an application/MCP deletion capability.

## Feature review

1. Plan alignment: the user-approved reconnect refinement is implemented; new
   consent still uses opaque-ID staging handoff. Actual multi-client acceptance
   and production MCP activation remain outside this correction.
2. System integrity: server-side consent service reuses direct-browser and grant
   readers, private RPC authority and exact callback validation. No alternate
   owner authority, credential copy, SQL bypass or domain arithmetic was added.
3. Release readiness: provider positive/negative/code-replay checks pass. Full
   static/regression/build and hosted release/reconnect/renewal checks must pass
   before readiness is claimed. No issue is dismissed as an implicit exception.

## Hosted release and retest

### Latest follow-up after network repair

The user pushed `b35c2b6` and repaired connectivity. Read-only GitHub verification
confirmed the exact MCP branch at `b35c2b62d78d9366f1c8206df076dcda45908f64`
and unchanged master at `4b8a3ab6fd28272bde1cd98aa055661805f58326`.
The network-blocked checkpoint below is retained as historical evidence.

- `node .artifacts/mcp-clients/verify-consent-release.mjs --staged --tail --continue-errors`:
  **4/4 PASS**, including the previously unavailable exact 307 consent-to-login
  redirect and 403 `INVALID_MCP_ORIGIN` rejection. Combined with the earlier
  five exact staged passes, every planned staged boundary was verified.
- Fresh project-filtered production/staging alias reads, the exact READY
  production-target `f1770c1` deployment and the production MCP flag `false`
  were checked before promotion. The approved production consent fix was promoted
  without rebuild, domain/protection/config changes or master merge. Alias readback
  confirmed production now serves `dpl_78TAaTRs37QA7Rsi97K5D4J2JZXm`.
  The staging alias still serves `dpl_3nTU2LHnn3Si68LoC8QNbpGs76Au` (`97cad5c`).
- `node .artifacts/mcp-clients/verify-consent-release.mjs`: **9/9 PASS** against
  anonymous live production. Public calculator/login/consent remain accessible;
  accounts and daily journal redirect to login; both discovery documents retain
  their expected resource/issuer; anonymous MCP returns 401 with its challenge.
- Fresh same-grant reconnect completed automatically through the registered
  callback: signed resource-bound validation and live remote tools passed.
  No extra approval form, revoke/remap or application-grant mutation occurred.
- A bounded production error/fatal runtime scan scoped to the exact deployment
  and 30-minute window returned an empty grouped result. This is a bounded
  observation, not a claim of exhaustive monitoring or configured drains.
- `node .artifacts/mcp-clients/run-native-safely.mjs --discover`: actual Codex
  CLI **0.147.0**, **84 tools/eight resources PASS**, isolated to Trade OS.
- The same wrapper with `--read`: actual native capabilities, owner-scoped
  account response and **four domain-resource reads PASS**, zero protocol errors,
  zero model calls and no global configuration writes. Codex's non-protocol stderr
  again included the generic OS-error category; this does not claim a warning-free
  entire Codex session. Requested native tool/resource operations passed.

Renewal is still **not passed**, but its failure is now precisely isolated:

- `node .artifacts/mcp-clients/verify-codex-renewal.mjs` failed closed at
  `TOKEN_VERIFICATION`; no uncertain refresh was replayed.
- A fresh normal reconnect preceded one diagnostic refresh. The original strict
  validator remained authoritative and rejected that token. Separate diagnostic
  inspection verified its signature/issuer/expiry before reporting only validation
  booleans: audience, exact resource/client, owner/session/grant UUIDs, grant-version
  string and authenticated role all passed; **`iatInFuture=true`** was the failing
  check. Tokens and raw claims were never printed or persisted by the diagnostic.
- Three strict-TLS READ ONLY clock comparisons had 190–211 ms round trips and
  put the database approximately **0.86–1.07 seconds ahead** of this desktop.
  `w32tm /query /status` reported the service was not started; `Get-Service W32Time`
  confirmed **Stopped / Manual**. This explains why the faster refresh verification
  rejects a future-issued token while the slower initial exchange can pass.
- The same hosted readback confirmed one ACTIVE Codex grant, unchanged full Codex
  grant fingerprint/two audit events and unchanged MT5 grant fingerprint.
- Windows clock synchronization was requested for explicit approval, not performed.
  No clock tolerance, validation or credential-recovery fallback was added. A final
  normal reconnect restored the protected profile and enabled the native reads.

Next: approve/perform Windows time synchronization, verify clock alignment, then
repeat documented protected renewal and status checks. Actual-client writes/retry/
revocation, other requested clients and final production MCP activation remain
pending. No missing gate is counted as passed.

### Earlier blocked checkpoint (superseded by the follow-up above)

The tested application commit is `f1770c137157c5acfb7890f8d279fa4491437116`
on `feature/mcp-access`. GitHub read-only preflight continues to fail with a
connection category (not DNS, authentication or certificate verification); this
commit has **not been pushed**. The working tree was clean at that checkpoint.

The exact tracked source was staged with existing production settings, without
assigning domains:

- Deployment: `dpl_78TAaTRs37QA7Rsi97K5D4J2JZXm`, **READY**, production target,
  exact source commit `f1770c1`.
- URL: `https://trade-krodrdyso-ghostsyscoders-projects.vercel.app`.
- Hosted build preflight: **35 functions and 14 version/order columns PASS**;
  inspected build logs contained no build errors.
- The initial upload command lost its acknowledgement. A read-only deployment
  listing recovered exactly one matching READY deployment, then an independent
  deployment read verified it. No duplicate deployment was requested.
- Seven exact staged GET checks passed across bounded runs: public calculator,
  login, anonymous accounts/daily-journal login redirects, consent without an ID,
  and both MCP/MT5 protected-resource metadata documents. Resource and issuer
  comparisons were retained.
- Raw requests for the invalid-request consent redirect and immutable-host MCP
  rejection timed out with no HTTP response (`curl` code 28; one CLI invocation
  also reached its process timeout). These are **not passes**. An alternate
  authenticated Vercel fetch followed the invalid-request consent navigation to
  HTTP 200 with `x-matched-path: /login` and the sign-in page; it did not expose
  the original redirect status, so it does not substitute for that exact check.
  The alternate MCP fetch also had a transport failure.
- Protection, expected statuses, authentication and timeouts were not weakened.
  Requests used existing Vercel authentication; no protection setting, domain,
  integration flag, grant or MT5 control state was changed.
- Fresh readback of the project-filtered production alias still pointed to
  `dpl_BPFMhVmrkDX5evNh6bD7cL3PSbaq` (the previous `09e4005` release).
  **No promotion was requested.** The staged READY build is not a production
  release or a completed hosted authentication test.

Pending: the two exact staged checks, scoped production consent-route promotion,
fresh Codex reconnect, protected credential renewal and another actual native
read. Further identical failing network requests are not useful until connectivity
recovers. Production MCP stays off; the existing grant/MT5 fingerprints must
remain unchanged. See
[the preceding Codex checkpoint](MCP_CODEX_CLIENT_VERIFICATION.md) for the already
completed discovery/read checks and the unresolved hosted renewal failure.
