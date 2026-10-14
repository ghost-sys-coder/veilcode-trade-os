# Archive timestamp consistency — 2026-10-14

Status: source, local regression gates and approved hosted application PASS.
No installer/extension change is needed for this database fix.

## Reproduction and cause

The actual Claude Desktop create/read/archive acceptance fixture
`3be263e6-c305-4b88-acdc-07e3d02bd136` has version 2 and is inactive/archived.
Its archive operation completed without a retry. Scoped hosted readback confirms
two immutable receipts and two owner/client-bound audits for the predetermined
create/archive operations, with one audited client and the correct target.

The persisted archive timestamp is `2026-10-14T05:46:13.671846Z`, while
`updated_at` is `2026-10-14T05:46:13.381112Z`: a 0.290734-second inversion.
Both originate in PostgreSQL, not the application clock. Archive writers use
`clock_timestamp()`; `private.set_updated_at()` overwrites the update timestamp
with transaction-start `now()`. This also affects setup, rule, goal, tag and
instrument archival. PostgreSQL documents the two clocks separately in its
[current date/time reference](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

## Source fix and boundaries

CLI-generated migration was initially `20261014054903_archive_timestamp_consistency.sql`;
after approved hosted application, its filename was aligned to the provider's
registered version, `20261014060502_archive_timestamp_consistency.sql`, without
changing its SQL. This prevents a duplicate later deployment.
It replaces only the existing private timestamp trigger function. On an archive
transition for the six existing archivable configuration tables, `updated_at`
reuses the chosen `archived_at` event time. A later permitted update to an
archived row cannot move behind its previous update or archive time. Ordinary
updates and callers without archive fields retain their original convention.

The function remains security-invoker with an empty search path; replacement
preserves existing ownership, ACLs and trigger attachment. No new public RPC,
RLS policy, privilege, table, index, schema routing or client-side timestamp is
introduced. Checks use the existing private workflows and atomic audit/receipt
path. Configuration versions still advance only once per successful mutation.

There is deliberately no data backfill. Existing rows, immutable original
receipts, audit evidence and their recorded historical interpretation remain
unchanged. Future writes will use the new convention after hosted application.
The previously observed fixture will therefore retain its historical gap.

## Verification

| Command/check | Result |
| --- | --- |
| `node .artifacts/claude-desktop/archive-before-check.mjs` | Original trigger fails exactly five new timestamp assertions, all 48 assertions execute; entire reproduction rolls back |
| `node .artifacts/claude-desktop/local-db-check.mjs --suite=mcp_configuration.test.sql` | PASS, 48/48 assertions with pending source migration |
| `node .artifacts/claude-desktop/local-db-check.mjs` | PASS, all 30 suites / 1,196 assertions after final test addition |
| `npm test` | PASS, 70 files / 1,209 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS, Next.js 16.3.8 production build |
| Narrow hosted fixture/trigger/receipt/audit reads | Confirmed original defect and actual-client write evidence; no mutation |
| Hosted security advisors (pre-change) | No timestamp-function finding; existing notices below |

The local wrapper executes `scripts/run-db-tests.mjs --pending-migrations` with
four pending migrations inside each suite's rollback transaction. It temporarily
disables only the known crashing Supautils permission-hint formatter and restores
the original local setting afterward. Permissions, RLS and tests are not weakened;
no migration history or fixture data persists. Production `.env` is never used by
these database tests.

New assertions cover all six archive tables, durable receipt consistency, exact
retry readback, append-only audit capture, a later allowed archived-goal update,
and the unchanged non-archive trigger convention. Existing owner isolation,
revocation, concurrency, immutable audit and rollback tests continue to pass.
No browser/native/model API call is substituted for the owner's Desktop evidence.

## Review and rollout

- Plan alignment: PASS for the reported defect; no unrelated integration rebuild.
- System integrity: PASS; authoritative database enforcement, existing private
  function and immutable audit contracts retained. The Supabase/Postgres skills
  guided invoker/search-path review and disposable, rollback-only verification.
- Production readiness: PASS for this scoped fix. The owner approved hosted
  application; the exact private function replacement is installed and verified.

The pre-change advisor report includes an informational
[RLS-enabled/no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
and the existing [leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
The post-application security check reports the same two notices and no finding
for the timestamp function. Neither is introduced by this fix. No auth setting
or access policy was changed.
The unrelated unpublished Desktop 0.1.2 startup candidate remains separate and
is not the demonstrated fix for this timestamp issue.

## Approved hosted application

Only this reviewed function-replacement migration was applied to the specified
hosted Trade OS project. Readback confirms the deployed source, registered version,
unchanged postgres ownership/ACL, security-invoker mode and empty search path.
A transaction-only strategy was inserted/archived to assert exact timestamp
equality and version 2, then rolled back. The probe passed and left zero retained
probe records. No audit/receipt backfill, integration flag change, MT5 resume or
new installer was involved. Other locally pending migrations were not applied.

The owner's separately requested removal of four unused accounts is documented
in the ignored private cleanup artifacts, not embedded as a repeatable schema
migration. It preserves the selected account and its 20 trades and does not
change the timestamp-fix regression result.
