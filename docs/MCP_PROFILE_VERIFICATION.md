# MCP self-profile preferences

Date: 2026-10-09. Branch: `feature/mcp-access`. Profile work follows pushed
balance-curve commit `b8f13b7b473c9dc1f6171b503193e1577355acb1`. Its Git-created
Vercel preview is READY at
`https://trade-mcvqnfddp-ghostsyscoders-projects.vercel.app`.
The agent did not merge master or promote Production.

## Blueprint and agreed scope

The approved capability plan defines profile access as self-owned display-name
and timezone preferences, not authentication administration. Implement two
typed tools, `tradeos_profile_get` and `tradeos_profile_patch`, through the same
verified application services used by the Settings page. The local HTTP catalog
now contains 56 tools and the existing five contract resources.

- Identity comes from the verified actor and a fresh database session/grant
  check. No owner/profile ID is accepted as input.
- Patch only `values.displayName` and/or `values.timezone`. Omitted fields are
  unchanged; null clears the display name only. Empty patches are invalid.
- Display names contain 2–80 Unicode characters after trimming, counting code
  points consistently with PostgreSQL. Read legacy friendly forms without
  truncation. Timezone is a valid IANA name, canonicalized using Intl; null is
  invalid and the database also checks its timezone catalog.
- Require durable `operationId` and current string `expectedVersion`. Receipt,
  preference update, version increment and before/after audit commit atomically.
  Identical retries return the original result; changed payloads and stale
  versions are rejected. Missing profiles are reported, not silently created.
- Read/patch results whitelist profile ID, display name, timezone, creation/
  update instants and string `record_version`. No email, password, tokens,
  authentication metadata, arbitrary SQL, account fields or user administration.
- Timezone affects default reporting grouping/bases, not stored trade instants,
  account currency/precision, explicit report timezone or a configured firm
  trading-day timezone. Explicit behavioral reviews and financial history are
  untouched. Preference updates do not alter Supabase Auth metadata.

## Shared browser and database implementation

`domain/profile/commands.ts` owns schemas; `services/application/profile.ts`
owns verified service adapters; the fixed transaction allowlist invokes private
profile read/write functions. `/settings` loads through this service and embeds
an operation ID/current version in its existing form. Its action only parses,
delegates and revalidates affected reporting pages. It never falls back to a
direct update after a failed or stale private write. Existing styling is unchanged.
Also corrected stale Settings copy that described the already-implemented MT5
read-only collector as a future adapter.

CLI-created migration
`20261008220311_mcp_profile_workflows.sql` adds a positive bigint version column
and trigger plus two SECURITY INVOKER functions with empty search_path. API roles
cannot execute these functions. Existing browser RLS/table grants and signup
trigger remain unchanged, allowing an additive prerequisite rollout without
breaking the older browser settings adapter. Existing restrictive OAuth RLS
continues denying direct profile reads/writes. Normal browser/MCP preference
workflows now share audits; administrative or legacy direct-browser writes are
outside that receipt workflow but still subject to existing RLS and versioning.
No stronger guarantee about legacy direct writers is claimed.

The migration preserves old preference values and timestamps. After explicit
user approval, it is installed on both disposable local Supabase and the correct
hosted Trade OS project. Hosted deployment verification remains pending below.
Generated canonical table types were refreshed from local schema, including
previously omitted version/archive fields from already-applied shared workflows.
Private wire schemas—not generic Data API bigint typings—ensure exact versions.

## Verification

| Command/check | Result |
| --- | --- |
| `npm test` | PASS: 826 tests /54 files, including 30 profile-contract and six browser-adapter tests |
| `npm run test:db` | PASS: 860 assertions /22 suites, including 51 profile assertions |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, no lint warnings |
| `npm run build` | PASS: final source, 32 generated pages |
| `node --experimental-strip-types scripts/check-application-database.mts --local` | PASS: 24 functions /14 bigint version-order columns |
| `npm run build:verified` | PASS after approved hosted migration: 24 functions /14 bigint columns and production build |
| `npm run test:mcp-integration` | PASS: 40 real local OAuth/SDK/browser checks |
| `npm run test:integration-browser` | PASS: 65 real local provider/browser/API regression checks |
| `npm run test:mt5-python` | PASS: 176 tests |
| `npm run check:mt5-python` | PASS |
| Local security/performance advisors | 0 security warnings/errors; 31 inherited CLI auth_rls_initplan warnings, as described below |
| `git diff --check` | PASS; new files checked separately |

The focused pre-installation database command used
`node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm --pending-migrations --suite=mcp_profile.test.sql`.
The full command drops `--pending-migrations --suite=...` after installing the
reviewed migration locally. This invokes `npm run test:db` on loopback only,
rolls back fixture transactions and restores the existing temporary local
diagnostic setting in `finally`. No destructive hosted suite runs.

Profile database evidence covers owner-injection rejection, API-role denial,
explicit null versus omitted preferences, expired/forged/revoked sessions,
read whitelists, stale versions, replay/conflicting payloads, one receipt/audit,
original preference recovery, immutable audits and atomic rollback when audit
insertion fails. Versions 9007199254740993 → 9007199254740994 remain exact strings;
Unicode display-name validation agrees across application/database boundaries.

Real SDK/browser checks use TypeScript MCP SDK 2.3.1, modern 2026-07-28 and legacy
stateless HTTP, and Chrome 154.0.8037.93. Concurrent identical profile writes
produce one durable effect; concurrent distinct edits have exactly one winner.
The real browser reads the MCP-updated name/version, saves through the audited
service and canonicalizes `europe/london` to `Europe/London`. A deliberately stale
browser form cannot overwrite a subsequent MCP clear. Auth identity/creation
instant are unchanged; the fixture's original preferences are restored before
other tests. Revocation blocks both a new profile read and replay of a previously
committed patch. Existing money/trade/review/journal workflows pass as well.

One initial MCP attempt ended with an unclassified local TypeError before the
profile checks completed; it was not counted as a pass. A diagnostic rerun
passed the new profile checks and then exposed an older fixture assertion that
counted all browser audits as strategy audits. The assertion now joins the
receipt's CONFIGURATION_CREATE kind. The complete corrected run passed all
40 checks, with no uncaught browser page errors and fixture cleanup preserved.
The first pgTAP draft also used a data-modifying CTE below the top-level query;
the test was corrected without changing application behavior and all 51
assertions pass. These failed attempts are not hidden as successful runs.

## Advisor interpretation and review

`supabase db advisors --local --type all --level warn --fail-on error --output json`
found no warning/error security issue and 31 inherited
[auth_rls_initplan CLI warnings](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan).
The unchanged shared policy wraps JWT/UID calls in SELECT, as documented in
`20261008024848_mcp_policy_query_indexes.sql`. A read-only profile EXPLAIN under
synthetic planner claims confirms three InitPlan Result nodes and cached
`(InitPlan n).col1` references. No policy was weakened to suppress the warning.
An initial diagnostic assumed the older `$n` plan notation; the helper was
corrected to inspect Parent Relationship = InitPlan instead. No data is loaded
or authorization claim inferred from this planner check.

Review uses the approved profile scope and integration contract:

- Layer 1 — Plan alignment: PASS. Self-owned display name/timezone only, with
  the requested typed MCP tools and shared browser adapters; no auth administration.
- Layer 2 — System integrity: PASS. Verified actors, fresh ownership/grant checks,
  strict schemas, exact versions, private invoker workflows and atomic receipts/audits.
- Layer 3 — Readiness: LOCAL PASS; HOSTED DATABASE PASS; PREVIEW BUILD READY. Full
  local regression and the hosted prerequisites pass, with no unresolved defect
  found in the implemented preference workflow. Authenticated hosted browser and
  external-client results are not inferred from build/SDK checks.

The known Node MODULE_TYPELESS_PACKAGE_JSON warning remains non-blocking.

## Approved hosted prerequisite rollout

On 2026-10-09 the user explicitly approved the additive migration and requested
the code push when ready. Applied exactly the tested SQL to project
`nhwlxcrsivmawwmjiwck` through the VeilCode Studio connection. The provider-created
migration entry `20261008224053` was guardedly aligned to the CLI-created canonical
version `20261008220311`, touching only that newly applied history row after
verifying its name/body and confirming no canonical-version collision.

Before/after SHA-256 snapshots match for all existing profile fields/timestamps
(excluding the intentionally added version column), five accounts, twenty-one
trades, zero adjustments, one grant, resources and existing application receipt/
audit rows. Separate MT5 snapshots match for its connection, eighty-six source
facts, twenty execution versions and forty integration audit rows. No preference,
financial fact, grant, collector control, publication control or audit was rewritten.

Catalog verification confirms both functions are SECURITY INVOKER with empty
search_path and no anon/authenticated/service_role EXECUTE privilege. Profile RLS
is enabled, the version trigger is active, and the existing profile starts at
version one. The hosted read-only prerequisite gate and `build:verified` pass.

Hosted advisors returned the existing RLS INFO, foreign-key/index INFO and
InitPlan warning categories, plus the pre-existing
[leaked-password protection disabled warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No new profile-function exposure was identified in the permission/catalog checks.
Unrelated Auth security settings, policies and indexes were not changed.

## Release boundaries

The balance-curve push is verified READY; the profile increment now has approved,
verified hosted prerequisites and is ready for the requested feature-branch push.
The release guard requires both new private functions and `profiles.record_version`
before deployment. No master merge or Production promotion is authorized here.
MCP remains disabled; existing hosted data and integration controls are unchanged.

The requested feature-branch push completed as
`e241586122bc6d2575c8ca3261e0416702825ddb` (`feat(mcp): add audited self-profile preferences`).
Authenticated Vercel inspection confirms project `prj_J06NUbnHQj38DhAK4YX5poGV5ytz`,
team `team_24dtIFqfL1X7RkcGc6gVif0X`, branch `feature/mcp-access`, exact source SHA
and Preview (non-production) deployment `dpl_3S4SueF4AbgE9YTptXFKjYUZiJKP` are READY.
Build duration was 36.638 seconds. Preview:
`https://trade-dh7eez6s0-ghostsyscoders-projects.vercel.app`.
The post-migration targeted profile/adapter/protocol/prerequisite rerun passes
48 tests across four files. The reference snapshot remains untracked and unchanged;
no private helper, credential or browser authentication artifact was committed.

Full MCP completion still requires integration/import access, controlled
screenshots, permanent-deletion confirmation, local stdio and external client
verification. No Codex/Claude/ChatGPT/Gemini client support is reported passed
merely because the official SDK passes, and no AI-provider key or model call is
used. Hosted authenticated browser verification of the new profile increment
remains pending.
