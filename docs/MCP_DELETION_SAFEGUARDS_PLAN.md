# MCP deletion safeguards — implementation blueprint

2026-10-09. Branch `feature/mcp-access`, baseline `81e68a2`.
Completion-checklist item 3 only. The user confirmed this blueprint, including
the screenshot cross-system failure behavior. Implementation and destructive
fixtures are local only; hosted rollout requires separate approval after gates.
Existing contract definitions remain authoritative. The user's untracked
`public/snapshots/result-snapshot.png` is untouched.

## What already exists — reuse, do not rebuild

- Verified browser/MCP actor contexts, fresh session/grant/resource checks,
  private allowlisted application transactions, durable operation receipts,
  optimistic versions and append-only mutation audits.
- Strategy/setup/rule, goal and owned tag/instrument archive services. Normal
  authorized archives/writes remain available without a new browser approval.
- Eighty HTTP tools/seven resources, including controlled private screenshots.
- The private upload manifest references screenshot metadata; its complete
  upload identity and immutable chunk/audit evidence must survive deletion.
- No permanent-deletion MCP tools, one-use approval store, browser deletion
  approval page or controlled Storage removal adapter exist.

## Confirmed language

- **Approval:** an explicit action by the currently authenticated browser owner,
  not an assistant-supplied boolean or a visit to a link.
- **One use:** authorization for one exact execution operation on one target;
  identical retries recover that operation, never authorize another deletion.
- **Version:** fresh authoritative state of the exact target. Screenshot state
  must cover its metadata and Storage object revision, not just the trade ID.
- **Referenced:** used by a live or preserved historical relationship, including
  opened-plan corrections, immutable rule snapshots, goal progress and broker
  mappings/provenance. Do not trust current FK references alone.
- **Permanent screenshot removal:** remove original image bytes using Storage
  API and remove normal attachment access; retain audit/receipt/provenance
  metadata only. Merely deleting a Storage database row is not file removal.

## Scope and decisions

Use a fixed entity allowlist: `STRATEGY`, `SETUP`, `RULE`, `GOAL`, `TAG`,
`INSTRUMENT`, `SCREENSHOT`. Global instruments are not mutable. Accounts,
canonical trades, financial executions, adjustments, plan corrections, completed
rule snapshots, import/source history and audits are not deletion targets.

Unused eligible configuration can be removed transactionally. Referenced
configuration archives through the existing domain behavior, returning
`ARCHIVED` explicitly instead of pretending it was deleted. Check references
again under target locks at execution; never cascade away dependent evidence.

Requests bind owner, MCP client, active grant/resource, entity, exact target,
version/fingerprint, reason and the intended execution operation ID. Use separate
durable IDs for request and execution. Proposed approval lifetime: **10 minutes**;
expiry is checked on approval and consumption. No secret bearer confirmation URL.
Knowing the request UUID alone grants no access.

## Confirmed screenshot failure handling

Database writes and Storage removal cannot be one PostgreSQL transaction.
Use a durable two-step deletion rather than reporting completion on an uncertain
HTTP acknowledgement:

1. Freshly authorize the caller, lock/recheck exact approval/target/revision,
   consume that approval once, and commit a private deletion job with immutable
   original metadata/path/revision. Remove the attachment from ordinary reads
   and block overwrite/re-upload while removal is pending. Keep existing upload
   identity and audit history recoverable; do not cascade-delete their records.
2. Outside database locks, remove only the approved original and any explicitly
   associated temporary chunk objects through the server-only Storage API.
   The path list is server-derived and frozen, never a caller prefix or glob.
   Record completion only after verifying the expected objects are absent.

Expose **`PURGE_PENDING`** until physical removal is confirmed, then **`DELETED`**.
If network/process/Storage failure occurs, keep the durable pending state and
allow safe resumption of the same approved job without a second destructive
effect or false success. Do not resurrect a logically deleted attachment.

The initial execution receipt remains immutable; it records the accepted action
and job ID. Status lookup exposes current physical completion. Exact retries
return the original receipt. Recovery must not overwrite that receipt with a
different result. Later grant revocation blocks new client requests; an already
committed removal decision is retained, not silently undone. Define and test the
operator settlement path separately so pending authorized work is not stranded.

This removes image content permanently but preserves permitted historical audit
metadata. It is not a promise of recoverability, a general file cleaner, bucket
emptying, background account deletion or an arbitrary administrator capability.

## Approved build sequence

1. Add strict inspect/request/status/execute schemas and result/error models.
   New generic deletion tools map explicitly to every allowed capability family.
   Omit dangerous types from the schema, not only from UI labels.
2. Add private RLS-deny approval/job tables, indexed dependencies and private
   transactional inspect/request/approve/reject/consume/settle workflows.
   Enforce browser-only approval, current ownership/grant/resource, expiry,
   exact execution binding, one use and immutable transition evidence.
3. Implement configuration delete-or-archive using existing shared writers and
   short transactions. Protect historical references, including JSON snapshots
   and correction chains; do not change unrelated monetary/review contracts.
4. Implement exact screenshot jobs and Storage removal/recovery. Preserve upload
   history without a dangling live-attachment interpretation. Block legacy and
   managed path races and ensure deleted attachments cannot be downloaded through
   new application requests. Do not distribute new signed URLs.
5. Add authenticated browser approval at
   `/settings/integrations/deletions/[requestId]`, using existing UI components.
   Show client, record, parent/account context, version, reason, expiry, references
   and actual delete-versus-archive effect. Approve/reject are explicit actions;
   GET never approves or executes. UI actions remain parsing/navigation adapters.
6. Register tools/resource guidance; update inventory/checklist/counts from code.
   Ordinary writes and existing archive tools remain ungated by this approval.
7. Run local verification, review the increment against contract/architecture/UI,
   write a completion report, and commit/push the MCP branch when ready.

## Required verification

- Owner/other-owner/anonymous, MT5 versus MCP, forged contexts and direct writes.
- Browser-only approval; MCP cannot approve itself. Wrong client/grant/resource,
  changed target/version, expired/rejected/unapproved/reused requests reject.
- Identical and changed-payload retries, lost acknowledgements, concurrent
  consumes, target edits and newly added references; exactly one permitted effect.
- Unused deletion versus referenced archival for every entity family, including
  historical-only references. No cascaded trade/rule/goal/broker/audit loss.
- Managed and legacy screenshots, multiple metadata references to one object,
  changed Storage revisions, pending overwrite/re-upload protection and failed
  physical removals. A successful SQL row change alone is not a purge pass.
- Audit failure rolls back the database action; Storage/settlement faults preserve
  resumability and honest status. Approval/job transition evidence is append-only.
- Real local OAuth/official SDK requests, actual browser approve/reject, Storage
  byte absence, all normal file/upload/download and MT5/manual regressions.
- `npm test`, `npm run test:db`, `npm run typecheck`, `npm run lint`,
  `npm run build`; Python tests/static checks; local advisors and migration replay.
  Record actual commands/results/versions and unresolved operational/client limits.

All destructive fixtures use the disposable local Supabase stack only. No real
account or hosted image deletion is authorized by approving this build. Any new
hosted migration/configuration rollout needs its own approval after local gates;
the previous approval covered the private-file increment, not this migration.
Keep hosted MCP disabled, do not merge master/promote production, and do not start
stdio/external-client work or rebuild MT5 as part of this increment.

## References checked

- [Supabase Storage deletion](https://supabase.com/docs/guides/storage/management/delete-objects):
  use Storage API, not SQL, to remove actual files.
- [Orphaned Storage objects](https://supabase.com/docs/guides/troubleshooting/storage-unexpectedly-high-usage-or-exceed_storage_size_quota-errors-ae21a5):
  deleting metadata alone leaves physical bytes and quota usage behind.
- Installed Next.js **16.3.8** Server Actions guide under
  `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`:
  authenticate/authorize inside every mutation, preserve CSRF protections and
  validate browser form inputs; rendering an approval form is not authorization.
- [Approved integration contract](MCP_INTEGRATION_PLAN.md) and
  [completion checklist](MCP_COMPLETION_CHECKLIST.md).
