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

## Confirmed pilot review decisions

The user confirmed EURUSDm represents EURUSD and that USD 100000.00 was the
initial demo funding. The signed-in workspace became accessible to the supported
browser interface, so the existing audited forms were used—not privileged SQL
mutations or the collector's restricted OAuth credential.

The opening funding was recorded as BASELINE_FUNDING. The separate broker
correction had exactly-zero profit, commission, swap and fee and was recorded
as ZERO_EFFECT, preserving evidence without an adjustment. The confirmed
EURUSDm-to-EURUSD mapping was saved at mapping version 1 with a meaningful reason.
Read-only hosted verification confirmed both cash decisions, unchanged 100000.00
baseline, zero account adjustments and zero canonical trades. No grant revocation,
account reselection, publication or collector resumption occurred.

Only the explicitly confirmed symbol was mapped. The other eleven aliases remain
pending verification; AUDUSD, AUDJPY and EURAUD are not in this account's available
catalog. The actual preview also exposed raw SDK volume strings such as
2.7199999999999998. A correct volume-display boundary must be established separately
from account-currency precision before publication; no source evidence was rounded
away or monetary results changed to hide it. These are pending review/build items,
not a claim of completed onboarding or MT5 readiness.

Private visual proof is stored under the ignored `.artifacts/mt5-pilot` directory
and excluded from Git and deployments. The live review tab is left open for the
next approval stage.

## Catalog and volume-display follow-up — 2026-10-07

Added standard shared AUDUSD, AUDJPY and EURAUD references through
`20261006164120_mt5_catalog_completion.sql`, first verified transactionally in
the disposable local database, then applied by migration to the hosted trade-os
project. A hosted read confirmed currencies, pip sizes, price precision and
active status. Existing references are preserved on conflict. Matching public
calculator presets remain generic defaults, not verified broker specifications.
No suffix mapping is inferred; the other eleven pilot aliases remain pending.

The onboarding table now uses `domain/trading/volume-display.ts`. It rounds only
presentation to at most eight fractional digits, independently of currency
precision. For example, captured `2.7199999999999998` displays `≈2.72`, and
`1.3900000000000001` displays `≈1.39`. Exact source text remains available in
the title and accessible label. Nonzero amounts that would display as zero
retain their exact value instead. Source facts, reconstruction, execution
publication, money, outcome classification and closure rules are unchanged.
This is not a broker volume-step rule or a near-zero tolerance.

Verification commands and results:

- `npm test`: PASS, 470 tests in 35 files.
- `npm run test:db -- --pending-migrations`: PASS, 449 assertions in 11
  rollback-isolated suites; eight new catalog assertions cover reference values,
  replay preservation and RLS. Initial CLI status timed out; Docker was healthy,
  privately captured local status worked, and the direct command subsequently
  passed. The old eleven-instrument assertion was updated to explicitly verify
  the fourteen required reference symbols.
- `supabase migration up --local`: PASS, only the pending catalog migration.
- `npm run typecheck`, `npm run lint`, `npm run build`: PASS.
- `npm run check:mt5-python`: PASS.
- `npm run test:mt5-python`: PASS, 167 tests.
- `npm run test:integration-browser`: PASS, 47 checks using Chrome
  154.0.8037.93 and disposable local provider/database fixtures. Exact-volume
  access, rounding disclosure, both themes, publication, logout, reconnect,
  revocation and public calculator regressions were checked. No uncaught client
  runtime errors. Node emitted its existing typeless-module performance warning.
- Hosted migration application and reference-data readback: PASS.
- Security advisor: existing deny-by-default private-table informational notices
  and existing leaked-password-protection warning; no new permissions or policies.
- Performance advisor: existing unindexed foreign keys, per-row auth-policy
  initialization warnings and unused-index notices. This seed-only migration
  creates no keys, policies or indexes. Track these separately; do not remove
  evidence-protecting indexes or broaden RLS to silence notices. References:
  [foreign-key indexes](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys),
  [RLS initialization](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan),
  [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Current live verification is **pending**, not passed: the protected pilot vault
is REAUTH_REQUIRED after an uncertain token exchange. Credential-free checks
using the actual Python transport timed out against both public hosts. Curl over
IPv4 reached Trade OS once, while Supabase discovery timed out; public DNS
resolved. This does not establish a provider outage or an application auth bug.
Do not replay uncertain refresh tokens/codes, revoke the active mapping to work
around it, disable TLS verification, or resume capture until fresh authorization
and live binding verification succeed. Local pilot metadata now marks the gate
incomplete rather than retaining a stale success.

Read-only hosted verification confirmed the grant remains ACTIVE/version 2,
the opening baseline remains USD 100000, source facts remain 86 and canonical
trades remain zero. No further broker reads, mapping approvals, canonical
publication, collector resumption, startup task or MCP activation occurred.
The display implementation is locally verified. Vercel target inspection confirmed
`ghostsyscoders-projects/trade-os`, project `prj_J06NUbnHQj38DhAK4YX5poGV5ytz`.
Hosted UI deployment is pending staged-deployment checks, not claimed live here.

Implementation commit `8a09d1b` was pushed successfully to `feature/mt5-sync`.
`vercel deploy --prod --skip-domain --yes --non-interactive --meta
tradeOsRollout=mt5-catalog-volume-display` uploaded the reviewed source but exited
1 on `connect ETIMEDOUT` to the Vercel deployment-creation API. No deployment ID
or URL was returned and no promotion was performed. A read-only metadata lookup
returned no candidate URL/state. Check that rollout metadata before retrying;
do not claim a hosted build, post-deploy checks or an error-log scan passed.

Review: plan alignment and system integrity PASS for this scoped catalog/display
fix; local browser readiness PASS. Hosted display readiness and real terminal
metadata verification remain PENDING because of the network/authentication gate.
No merge or MCP release gate is satisfied by these local checks alone.

## Restored session, verified symbols and ready preview — 2026-10-07

The user loaded public Supabase discovery successfully in their browser. The
actual Python transport initially timed out while curl succeeded. Windows proxy
presence checks were false. A credential-free per-address diagnostic then reached
both Supabase addresses over strict hostname-verified TLS; one Trade OS address
timed out at TCP while the other returned HTTP 200. These observations establish
intermittent reachability, not a proven provider outage or an auth-configuration
defect. No DNS, proxy, firewall, certificate or security setting was changed.

A fresh same-grant PKCE reconnect opened the normal browser. The user confirmed
the callback success message. The first subsequent account checks returned
INTEGRATION_UNAVAILABLE; a sanitized, read-only READY-session check then exited
0, returned HTTP 200 and verified the same owner/account/client and grant.
The protected vault is READY and local gate metadata was restored. No uncertain
refresh token or code was replayed. Hosted readback confirms ACTIVE grant version
2 with the same five grant audit events, not a new grant or broader permission.

The bounded dedicated-terminal probe verified the exact DEMO/HEDGING identity
and all twelve symbols at 2026-10-07T09:38:21.712572+00:00. The final probe record
reported verified=true, twelve specification rows, no broker execution and no
source-fact modification; stderr was empty. The PowerShell parent returned 1
despite that complete record, so that invocation is not claimed as a passed
command. The diagnostic launcher was replaced with a bounded `spawnSync` wrapper
that checks the actual child status, stderr, complete final record and exact
symbol set. `node .artifacts/mt5-pilot/run_symbol_probe.mjs` then exited 0, reported
childExitCode=0 and verified the same twelve specifications at
2026-10-07T10:02:21.355890+00:00, without execution or source changes. This resolves
the diagnostic reporting defect. Operational worker supervision is a separate
already-tested implementation; this is not a startup-task test.

Metadata confirms the forex base/profit currency pairs and 100000-unit contracts.
XAUUSDm is Gold vs US Dollar with base XAU, profit USD, a 100-unit contract and
three price digits. All observed volume steps are 0.01; observed maxima are 200
lots except USDJPYm at 300. Generic calculator defaults are not substituted for
these broker facts. Identity mapping does not normalize broker prices or volume.

The existing EURUSDm mapping was preserved. The eleven other mappings were saved
through the signed-in normal browser forms, each with metadata-backed reasons,
not a privileged mutation or a forged browser context. Read-only hosted SQL
confirmed twelve current mappings at version 1, unchanged 86 source facts, zero
canonical trades, zero adjustments and the USD 100000 opening baseline. UI
submissions were checked by newly visible mapping history before proceeding;
the first inconclusive pointer activation was recovered using the same operation
and payload through keyboard activation, without duplicate mapping events.

Independent read-only SQL grouped the actual captured hedging facts by position:
each of the twenty groups has exactly two deals, one IN and one OUT, with
positive and exactly equal entered/exited volume. For this specific fixture,
profit plus signed commission, swap and fee matches normalized net PnL for every
group. All captured commission, swap and fee components are zero. This is a
fixture cross-check, not a replacement for directional-episode reconstruction.
The central TypeScript decimal utilities independently verified the source
financial components and returned:

- Twenty closed groups; ten wins, ten losses, zero break-even.
- Primary decisive win rate 50%; no missing-R values fabricated.
- Normalized net profit USD 2032.53.
- Preserved baseline USD 100000.00 plus profit = USD 102032.53.

The live browser preview corroborated that captured balance basis, observed
balance/equity USD 102032.53, open-trade recognized cash USD 0.00, unexplained
difference USD 0.00, zero reconstruction issues, zero unresolved cash and twenty
eligible groups. This references the frozen 2026-10-06 captured snapshot, not a
claim about the current broker balance or complete lifetime history.

Commands: `verify_ready_pilot.py` PASS/exit 0;
`verify_preview_fixture.mjs` PASS/exit 0. The direct-pooler financial-audit helper
failed at CONNECTION; the independent hosted read-only connector query succeeded
instead. No TLS downgrade or production test mutation was used. Private fixtures
and visual evidence remain ignored and excluded from deployment. No application
source changed during this continuation; prior local regression results above
remain historical evidence rather than newly rerun checks.

Next gate: explicit user approval of these twenty historical canonical trades
and the unchanged baseline. No publication, reconciliation approval, collector
resumption, startup installation, production promotion, branch merge or MCP
activation occurred. The normal preview tab is left open for that decision.
