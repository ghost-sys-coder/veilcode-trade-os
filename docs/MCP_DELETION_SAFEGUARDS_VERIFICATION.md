# MCP deletion safeguards — verification

2026-10-10. Branch `feature/mcp-access`, baseline `81e68a2`. Checklist item 3
only, following the user-confirmed [blueprint](MCP_DELETION_SAFEGUARDS_PLAN.md).
Local implementation is verified; hosted prerequisite rollout and Preview are
pending separate approval. Hosted MCP remains disabled. No master merge,
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

Migration `20261009203729_mcp_deletion_safeguards.sql` is recorded only on the
disposable local stack. The local diagnostic wrapper restores hint settings;
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
Production readiness: local gates pass; **hosted prerequisite rollout/Preview
remain pending**, not passed. The release preflight intentionally requires both
new private entry functions before deployment.

The user's separate `domain/mt5/cash.ts` change appeared during verification;
it is preserved and excluded from this commit. Results describe the checked
working tree, not a claim that this unrelated edit was delivered here. The user's
untracked `public/snapshots/result-snapshot.png` is also untouched/excluded.

Before pushing: obtain separate approval to apply the exact tested migration
to the Trade OS project, fingerprint existing tables/control state before/after,
verify private ACL/RLS/Storage policies, keep MCP disabled and verify the exact
feature-branch Preview. Do not merge/promote production or delete hosted fixtures.

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
