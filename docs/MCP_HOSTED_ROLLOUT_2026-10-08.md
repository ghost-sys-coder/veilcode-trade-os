# Hosted journal/progress prerequisites and production redeploy

Date: 2026-10-08. Explicit user approval: apply the two tested prerequisites,
preserve existing data, leave MCP disabled and redeploy master.

## Result

Production master commit `41c824b31c565ff6105870b0d9854d3a90b963b4` is READY.
Deployment: `dpl_gmtKUHq7EB7NJULJQ61R1mArx2Yv`.
URL: https://trade-6oub4udnn-ghostsyscoders-projects.vercel.app
Production alias: https://tradeos.veilcode.studio

Build started at 16:22:48 UTC and deployment completed at 16:23:54 UTC.
Vercel reports build completed in 54 seconds. The log verifies master/41c824b,
the database prerequisite check, Next.js 16.3.6 compilation, TypeScript and
32 generated static pages. The public calculator remains prerendered.

## Approved database changes

Correct Supabase project: `nhwlxcrsivmawwmjiwck`, through the connected
VeilCode Studio account. Applied original committed SQL for:

- `20261008093344_mcp_journal_workflows.sql`
- `20261008101830_mcp_goals_prop_progress.sql`

Both were applied in one transaction with a five-second lock timeout,
30-second statement timeout and exact existing-row fingerprints covering accounts,
trades, adjustments, daily/weekly/monthly reflections, goals, custom-progress
events and prop configuration. Fingerprints omit only the newly added version
and archival fields. Existing records and content were unchanged.

Baseline/post-rollout counts: accounts5, trades21, adjustments0, daily1, weekly1,
monthly0, goals0 and prop configurations1. No hosted fixture tests, deletions,
collector changes, order execution, provider API calls or enablement changes ran.

The first integrity comparison had an operator-precedence error. Its fail-closed
guard rejected the transaction; a follow-up catalog query confirmed zero new
columns, no new functions and no rollout history. After correcting that temporary
comparison, the atomic rollout succeeded and the existing-row check passed.

The temporary tool-generated bundle history `20261008161834` was verified against
its exact SQL and transactionally replaced by the two original source versions
and names, retaining each original source file as a statement. Both final history
entries were verified. No application records were affected by this bookkeeping.

New journal/progress functions are security invoker. EXECUTE is denied to anon,
authenticated and service_role; private typed workflows remain authoritative.

## Verification commands and results

- `npm run check:application-db`: PASS18 functions /11 version-order columns.
- `vercel redeploy trade-e0kjh30wt-ghostsyscoders-projects.vercel.app --target production --scope team_24dtIFqfL1X7RkcGc6gVif0X --non-interactive --no-wait`: accepted after a pre-request user-lookup connection timeout. No duplicate deployment was created.
- `vercel inspect trade-6oub4udnn-ghostsyscoders-projects.vercel.app --wait --timeout 180s --scope team_24dtIFqfL1X7RkcGc6gVif0X --non-interactive`: READY; production alias assigned.
- `vercel inspect trade-6oub4udnn-ghostsyscoders-projects.vercel.app --logs --scope team_24dtIFqfL1X7RkcGc6gVif0X --non-interactive`: database preflight and `npm run build:verified` PASS.
- `node .artifacts/mt5-pilot/verify_rollout_http.mjs https://tradeos.veilcode.studio`: six of seven public checks passed; MT5 discovery request hit a client transport timeout.
- `node .artifacts/mt5-pilot/verify_journal_progress_rollout.mjs`: account/daily/prop login redirects and public MCP discovery passed; three transport timeouts.
- `node --dns-result-order=ipv4first .artifacts/mt5-pilot/verify_journal_progress_rollout.mjs /goals /mcp /.well-known/oauth-protected-resource/api/integrations/v1`: goals login redirect passed; MCP and MT5 discovery remained connection-timeout pending.
- `vercel logs ... --no-follow --no-branch --environment production --level error --since 15m --limit 20 --json`: one error-level record; diagnosed below. Not a clean error scan.

Confirmed unique HTTP checks: calculator/login/consent200; settings/accounts/daily/
goals/prop307 to login; unauthenticated integration session/capture401; public
MCP resource discovery200 with correct resource/issuer. Eleven unique checks passed.
Two remaining checks (disabled MCP response and MT5 discovery) were not passed.
Node reported UND_ERR_CONNECT_TIMEOUT; Windows curl additionally reported an
offline certificate-revocation check. TLS validation was not disabled.
Browser-helper startup failed, so authenticated browser verification is pending.
Previous local unit/database/SDK/browser suites are recorded in the earlier
increment reports; they were not rerun against hosted data or represented as
new production test passes.

## Separate defect and remaining security notice

The runtime record is an anonymous `/journal/daily` request: a login redirect307
coincided with `permission denied for table trades`, SQLSTATE42501. Layout-level
authentication does not stop parallel child rendering from starting the journal
Data API reads. DailyJournalPage queries profiles/trades before creating its
verified browser actor. The database correctly refused the anonymous trade read.
Do not follow the provider hint to grant SELECT to anon. The follow-up code fix
must authenticate before protected page/dataset reads. It is not implemented
by this narrowly approved two-migration rollout.

Hosted security advisors show the existing private deny-by-default no-policy
INFO entries and the existing
[leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No new exposed-function/table warning was introduced. Auth settings were not
changed; enablement is a separate operator decision.

This report records a successful schema/build repair, not full MCP readiness or
a clean authenticated end-to-end gate. Broader MCP coverage, stdio and actual
client verification remain pending. No source commit, master modification or
local-file upload was required for the approved redeploy.

## Subsequent approved authentication-order correction

The user subsequently approved fixing the protected read guard. On
`feature/mcp-access`, daily/weekly/monthly journals, calendar, canonical trade
list and analytics now await the existing `requireUserId()` before creating
their data client or starting any profile/dataset query. The layout guard remains
defense in depth, not an assumed execution barrier. Verified browser actors,
private transactional authorization, ownership/RLS and anonymous table grants
are unchanged. No schema migration, auth-provider change or visual change is
part of this correction.

The installed Next.js16.3.6 authentication guide explicitly states that layouts
do not stop child rendering. The Supabase/architecture review kept the existing
verified-claims guard rather than introducing a second authentication system.
React review retained parallel independent setup only after authentication.

Verification of the correction:

- `npm test`: PASS673 tests /49 files, including23 new regression tests.
- `npm run typecheck`: PASS, also rerun after extending browser coverage.
- `npm run lint`: PASS.
- `npm run build:verified`: PASS; hosted read-only inventory18/11 and Next.js
  build/TypeScript/static generation32/32, public calculator still static.
- `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm`: PASS717
  assertions /19 rollback-isolated local suites; diagnostic setting restored.
- `npm run test:integration-browser`: PASS65 local provider/headless-browser
  checks with Chrome154.0.8037.93 and zero uncaught client errors. Twelve new
  checks cover anonymous redirects and actual signed-in rendering for all six
  corrected pages. Existing public calculator, login/logout, consent, refresh,
  revocation and canonical MT5 fixture publication/recovery regressions pass.
- `git diff --check`: PASS.

The page tests assert zero data-client/profile/dataset calls while authentication
is pending or denied, and show that successful authentication resumes the
original read workflow. Guard tests cover missing/rejected verified claims and
unexpected verification failure, without trusting a raw session.

Both local database and browser gates initially stopped at CLI discovery before
assertions. A credentials-suppressed direct CLI probe then verified a loopback
disposable database; reruns passed. No data reset, production fallback or weaker
authentication was used to recover the tests.

Review: plan alignment PASS, system integrity PASS and tested local readiness
PASS. No unrelated UI, financial, correction, collector or MCP capability change.
The correction is committed locally but not pushed, and is not in the production
deployment recorded above. Hosted verification of this correction requires its
normal source publication/merge/release; full MCP readiness remains pending.
