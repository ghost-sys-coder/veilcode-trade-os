# MCP deletion safeguards — verification

2026-10-10. Branch `feature/mcp-access`, baseline `81e68a2`. Checklist item 3
only, following the user-confirmed [blueprint](MCP_DELETION_SAFEGUARDS_PLAN.md).
Local implementation and the user-approved hosted prerequisites are verified.
Source Preview builds; final runtime recheck follows the Preview configuration
correction below. Hosted MCP remains disabled. No master merge,
production promotion, real-account deletion, stdio or external-client work.

## Delivered behavior

Four typed tools bring the catalog to **84 HTTP tools and eight resources**:

- `tradeos_deletion_inspect`: exact owned target, version, reference count and
  current DELETE/ARCHIVE effect. No mutation or approval.
- `tradeos_deletion_request`: distinct durable request/execution operation IDs,
  reason, target/version and a normal owner-browser URL; not a bearer capability.
- `tradeos_deletion_status`: current approval/expiry/archive/physical purge state.
- `tradeos_deletion_execute`: the pre-bound operation consumes explicit browser
  consent once; identical concurrent/lost-response retries recover its receipt.
- `tradeos://v1/deletions`: schemas, permitted entities, confirmation and recovery.

Eligible entities are owned STRATEGY, SETUP, RULE, GOAL, TAG, INSTRUMENT and
SCREENSHOT. Global instruments, accounts, canonical trades, finances, corrections,
completed review snapshots, broker/import history and audits are not deletion
targets. Referenced configuration archives through existing shared writers,
returning ARCHIVED rather than claiming deletion. Dependencies include current
FKs, immutable rule IDs, original plan-correction UUIDs and preserved shared/
broker mutation evidence. Historical UUID mentions conservatively prevent deletion.
A record's own edit/creation audit is not a dependency on itself.

Approval binds owner/client/grant version/resource/entity/exact target/version/
execution ID, with a **10-minute** lifetime checked at approval and execution.
The authenticated browser at `/settings/integrations/deletions/[requestId]`
shows client, record, account context, version, reference count, reason, bound
execution ID and UTC expiry. GET never approves or executes. An unchecked,
required acknowledgement is keyboard accessible; stale targets disable approval.
Approve/reject adapters use runtime-verified browser contexts and shared services.
MCP cannot approve itself or use another authorized client's request/receipt.

## Physical deletion and audit boundary

Screenshot execution rechecks metadata and locked Storage object revisions,
consumes consent and freezes exact original/chunk identities transactionally.
Attachment metadata is removed from ordinary reads. Its original metadata,
operation/audit chain and completed upload/immutable manifest remain evidence.
Only server-side Storage API removal deletes bytes; SQL never removes Storage
metadata to pretend a purge occurred. All frozen paths validate before any I/O.

The execution receipt remains immutable **PURGE_PENDING**, even if removal
finishes during that request. Status changes to **DELETED** only after Storage
removal acknowledges and a fresh database transaction confirms object absence.
Failures preserve durable pending work. Fresh client authorization is required
before retries; after client revocation, the browser owner can settle only the
already-consumed exact job. API I/O occurs outside short database transactions.

Retired identities cannot be read, overwritten, reuploaded or relinked by normal
browser APIs. Shared attachment paths and unsafe/missing original file identities
are rejected before approval. No bucket/prefix deletion, arbitrary URLs, file paths
or new signed URLs are exposed. Private tables/RPCs deny direct client access;
the narrow restrictive Storage helper enforces the existing browser-only boundary.
Direct permanent configuration deletion is guarded at the database as well.

Completed upload status/old finish receipts are **historical upload completion**,
not proof that a deleted attachment remains available. Screenshot get/download
rejects after logical removal. The first acceptance receipt must not be replaced
with a different result when physical deletion later completes.

## Concrete fixture evidence

- All six unused configuration families delete after actual browser consent;
  two simultaneous execution retries have one durable operation/effect.
- All six referenced families archive; closed trades, applicable immutable rule
  snapshots, tags, custom progress and canonical ledger values remain intact.
- Stale target disables consent; explicit rejection, expired requests, anonymous
  links, another owner and another active same-owner MCP client are denied.
- Injected audit failure rolls back target deletion, consent consumption and
  operation/audit receipts together. Historical unlabelled audits retain references.
- Legacy Storage revision changes invalidate approval. Fresh approval removes
  actual bytes; both privileged download and browser reupload then fail.
- Managed original and its immutable chunk are physically removed through API.
  Injected SETTLE audit failure keeps PURGE_PENDING, rather than claiming completion.
  Revoked client cannot replay; normal browser recovery completes the same job.
  Original metadata, upload COMPLETE status, one chunk manifest and the original
  acceptance receipt remain recoverable after settlement.
- The disposable USD account starts at **1,000.00**; one final closed trade has
  **10.00** gross, zero costs/credits, so **10.00** net and **1,010.00** balance.
  Configuration archives and screenshot deletion leave that ledger unchanged.
- Native checkbox validation/keyboard consent and light/dark token rendering
  pass; 390px mobile has no horizontal overflow. Both browser suites report no
  uncaught client errors. Calculator stays anonymous/static and logged-in controls
  remain correct.

SQL screenshot fixtures prove metadata/transaction/policy behavior only. They
do not claim physical deletion; native SDK/Storage/browser fixtures prove byte
absence separately. All destructive fixtures use disposable loopback Supabase.

## Commands and final results

| Command | Result |
| --- | --- |
| `npm test` | PASS: **983 tests / 60 files** |
| `npm run test:db` through `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` | PASS: **1,078 assertions / 27 suites**, including **48** deletion assertions |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, no warnings |
| `npm run build` | PASS; new dynamic approval route and anonymous static calculator |
| `npm run test:mcp-integration -- --deletions-only` | PASS: **11** focused real OAuth/SDK/Storage/browser checks |
| `npm run test:mcp-integration` | PASS: **66** complete real-provider/SDK/browser checks |
| `npm run test:integration-browser` | PASS: **65** login/public calculator/MT5/browser regressions |
| `npm run test:mt5-python` | PASS: **176** tests |
| `npm run check:mt5-python` | PASS |
| `npm run check:application-db -- --local` | PASS: **35 functions / 14 version-order columns** |
| `node .artifacts/mt5-pilot/check-local-profile-advisors.mjs` | PASS: no security/ERROR findings; 31 existing RLS InitPlan warnings; profile InitPlan preserved |
| `supabase db diff --local --schema public,private` | PASS: full shadow migration replay, no drift, exit 0 |
| `npm audit --omit=dev --json` | PASS: **zero** production vulnerabilities |
| `node .artifacts/mt5-pilot/check-private-file-client-assets.mjs` | PASS: secret absent from **39** client JS/CSS/map assets |
| `git diff --check` | PASS |

Migration `20261009203729_mcp_deletion_safeguards.sql` is recorded on the
disposable local stack and the user-approved hosted Trade OS project. The local diagnostic wrapper restores hint settings;
it does not relax permissions. Final cleanup readback confirms zero fixture
users, grants, operations, deletion requests/jobs, upload manifests and chunks.

Early focused SQL failures (record-field resolution, ambiguous variable and
expected-error mismatch) were fixed. Full regression exposed an unsafe helper
boundary and outdated goal/rule deletion expectations; those were corrected,
not ignored. Invalid version refinements now reject malformed strings instead
of throwing BigInt exceptions. Concurrent heavy build/fixture runs caused test
timeouts; Vitest now caps workers at two without relaxing test/application
deadlines. The final full unit run passes in 19.96s.

Versions: Windows, Node **25.1.0**, Python **3.13.2**, Next.js **16.3.8**,
MCP SDK **2.3.1**, Sharp **0.35.5**, Chrome **154.0.8037.99**, local PostgreSQL
**17.6**, Supabase CLI **2.95.4**. No new dependencies or model API calls.

## Review and release status

Plan alignment: implemented only the confirmed deletion increment; existing
monetary, canonical-trade, review-completion and MT5 contracts are reused.
System integrity: verified shared services/private short transactions, fresh
scope checks, immutable receipts/audits, server-only Storage and existing token
UI primitives. The imprint skill records the approval pattern in `ui-registry.md`.
Release readiness: local gates and approved hosted prerequisites pass. The
release preflight requires both new private entry functions before deployment.
Final Preview runtime verification is recorded separately below; this is not
hosted authenticated deletion-tool acceptance or full MCP activation.

The user's separate `domain/mt5/cash.ts` change appeared during verification;
it is preserved and excluded from this commit. Results describe the checked
working tree, not a claim that this unrelated edit was delivered here. The user's
untracked `public/snapshots/result-snapshot.png` is also untouched/excluded.

## Approved hosted rollout and Preview

- The user separately approved hosted prerequisites, push and Preview verification.
  Target: VeilCode Studio@Zooloop.tv@gmail.com, Trade OS
  `nhwlxcrsivmawwmjiwck`; no other Supabase account/project was used.
- Migration installed with guarded prerequisites. All **56** existing public/private
  application tables plus Storage buckets/objects (**58 total**) retain identical
  row counts and multiset fingerprints immediately before/after. Both new private
  deletion tables are empty. No hosted deletion fixture was created or executed.
- The provider initially recorded `20261010014358`; after an approval-service
  quota interruption, guarded history alignment records canonical
  `20261009203729`, retaining the reviewed source and removing only that alias.
  The interruption did not reapply the migration or change user data.
- RLS is enabled with no client policies on both private tables. No anon,
  authenticated or service-role table/writer/read grants. Four restrictive Storage
  retirement policies, seven protected deletion triggers, the relink guard and
  narrow authenticated-only browser-session helper are present. The upload FK
  removal preserves immutable historical manifests rather than cascading them.
- Hosted MCP has no enabled resource; new request/job counts remain zero. The
  MT5 pilot stays **ACTIVE / v20 / fence 6**, **20** canonical trades,
  **USD +2,032.53**. No collector resume, policy change or broker action.
- `npm run build:verified` passes against hosted prerequisites: **35 functions /
  14 version-order columns**, then the production build. Source
  **466948887f54b6dbd45a90f885739cbdfba67c44** is pushed only to
  `feature/mcp-access`. Initial Preview **dpl_FM3fY8HuXBTTaHSTZmFUJT8jpBf5** is
  READY, project `prj_J06NUbnHQj38DhAK4YX5poGV5ytz`, team
  `team_24dtIFqfL1X7RkcGc6gVif0X`, target null (Preview), build **59.5s**.
  Its log confirms the preflight and new approval route.
- GET checks on that first Preview pass calculator and login redirects but expose
  a missing integration origin: the variables were Production-only. This is an
  environment mismatch, not a failed SQL rollout. No origin validation is relaxed.
- The verified stable branch alias is
  `https://trade-os-git-feature-mcp-access-ghostsyscoders-projects.vercel.app`.
  Only this branch's Preview gets Config variables for that integration origin,
  `TRADE_OS_MCP_ENABLED=false` and `TRADE_OS_MT5_ENABLED=false`. Production settings,
  server secret and application grants are untouched. A fresh deployment must
  receive them before the final smoke check; an existing deployment is immutable.
- Protected Preview checks use existing Vercel CLI authentication without
  disabling Deployment Protection or printing cookies/bypass tokens. Disabled
  integration requests should return the existing **401** access-denied challenge,
  not the smoke harness's earlier assumed 503. Discovery stays publicly available
  behind the outer deployment protection and is bound to the stable Preview origin.

Hosted advisors report no ERROR, no new unindexed FK and the two intended new
private deny-by-default RLS INFO notices (27 total). Pre-existing
[leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
[31 RLS InitPlan warnings](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
and [10 unindexed-FK INFO findings](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
remain recorded. New unused indexes before enablement are not removed.

## Explicit limits

- Already-issued browser signed URLs may remain usable until their expiry or
  physical removal; no new signed URLs are issued for retired attachments. This
  is not a promise to instantly erase already-downloaded/cache copies.
- Pending purge recovery is an explicit same-job client/owner action, not an
  unrelated background garbage collector. Missing/shared/unsafe legacy files
  need deliberate reconciliation; no guessed prefix or bucket-wide purge.
- Unassociated staging/orphan bytes remain outside this deletion job. Upload
  expiry alone is not automatic garbage collection.
- Hosted data-flow acceptance, local stdio, requested actual external clients
  and final activation remain checklist items 4–6. SDK interoperability does not
  prove Codex/Claude/ChatGPT/Gemini connections. Broader MT5/VPS/soak limits remain
  recorded separately; they were not rebuilt or claimed passed here.

Storage deletion uses the API as required by
[Supabase's deletion documentation](https://supabase.com/docs/guides/storage/management/delete-objects).
The new page was checked against the installed Next.js 16.3.8 Server Actions
guide and the confirmed blueprint, not assumptions from older Next.js versions.
