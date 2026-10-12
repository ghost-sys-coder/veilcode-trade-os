# App-led integration setup — increment 1

Verified 2026-10-12 on `feature/mcp-access`, following the user-approved
[setup UX plan](INTEGRATION_SETUP_UX_PLAN.md). This is **not** completion of the
Windows installer, full client matrix or production MCP activation.

## Delivered

- `/settings/integrations` now links to owned MT5 and AI-client setup flows.
  MT5 uses friendly account names; local MCP offers Codex, Claude Code and
  Gemini CLI configuration profiles. This does not claim actual acceptance
  of every client or support for unverified remote callback paths.
- Verified direct-browser services reserve durable operation IDs and normalized
  request hashes, create one distinct public provider client, and independently
  verify its exact registration before making configuration available.
- Concurrent identical requests and lost acknowledgements cannot create another
  client. Missing/ambiguous provider records remain held for owner-only recovery.
  Setup events are append-only, owner-scoped and bounded to 20 profiles per owner.
- Callback ports are fixed: MT5 9876, Codex 9878, Claude Code 9880, Gemini CLI 9882.
  No caller-supplied owner, resource, callback, secret or provider API key is used.
- Generated downloads are private/no-store public configuration only. MCP reuses
  the existing adapter schema. MT5 uses an explicitly distinct bootstrap format,
  without invented terminal identity, mapped connection ID or running worker.
- Database grant checks bind new setup clients to their owner/purpose/resource
  and MT5 account, including before registration is verified. Existing shared
  clients remain compatible. The consent screen cannot retarget a saved MT5 setup.
- Registration, installation, consent and observed activity are separate UI
  milestones. Missing flags/secret/schema/policy are visible. The unreleased
  companion is explicitly identified, with no fake installer or success button.
- Setup defaults off: `TRADE_OS_INTEGRATION_SETUP_ENABLED` plus separate private
  purpose policies and existing integration flags must all permit it. Enabled
  Vercel builds require setup RPCs and immutable/grant-binding triggers.

## Defects caught and corrected

Concurrent completion could produce a stale expected version. The creator now
re-reads only the same owned READY binding and verifies its provider record,
without repeating registration. Artificial SQLSTATE `40001` caused an API retry
loop; setup uses `PT409`. The migration makes the same narrowly scoped code
replacement in existing grant activation/revocation and the shared MT5 control
implementation, preserving definitions, ACLs and domain checks. Private workflows
executed directly over PostgreSQL keep their existing serialization handling.

This matches [Supabase's documented RPC retry issue](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).
Actual HTTP tests prove stale grant activation/revocation return conflicts without
changing PENDING access or creating audit events.

The initial screenshot test changed caret styles before hydration. Waiting for
the form to be ready removes that harness-induced warning; console checks remain
strict. Database fixtures now upsert their own MCP resource inside their rollback
transaction rather than colliding with a preserved local provider configuration.
No existing local or hosted resource/data was deleted to make tests pass.

## Verification commands and results

| Command | Result |
| --- | --- |
| `npm test -- --maxWorkers=1` | 64 files, 1,127 tests PASS |
| `npm run test:db -- --pending-migrations` via the established local diagnostic helper | 28 suites, 1,121/1,121 assertions PASS; setup 43/43 |
| `npm run test:integration-setup` | 6/6 real local provider/browser checks PASS |
| `npm run test:mcp-stdio` | 10/10 real OAuth/official SDK/native subprocess checks PASS |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, no warnings |
| `npm run build` | PASS; new private setup routes present; calculator remains static |
| `node --experimental-strip-types scripts/check-application-database.mts --local` | PASS; disabled setup preserves the 35-function/14-column baseline |
| Enabled local preflight inside the provider fixture | PASS; 42 functions, 14 columns and both setup guard triggers |
| `git diff --check` | PASS |

Local provider verification covers independent concurrent requests, one committed
client, retry payload/version conflicts, recovery after a committed lost response,
actual UI/profile/download flows, anonymous download denial, database-disabled
setup, keyboard-native selectors, 390px light/dark mobile and dark desktop,
and absence of runtime/console errors. Chrome 154.0.8037.99 and official MCP SDK
2.3.1 were used. The native gate retains 84 tools/eight resources and its exact
5.00-lot fixture; no financial algorithm or trading ledger changed.

All database tests use disposable local Supabase only. Pending schema is injected
per rollback-only suite; provider fixtures temporarily create the schema and
restore original resources, policies and legacy RPC definitions, deleting only
their own generated users/clients/fixture records. Migration history is unchanged.
The stock local database's denial-hint crash workaround disables diagnostic hints
only and restores the setting; it does not relax permissions or assertions.
The existing Node type-stripping module-format advisory remains non-fatal; no
global module-mode change was made to suppress it.

## Review

Plan alignment: PASS for increment 1, not the later installer/client/release gates.
System integrity: PASS; browser/service/database responsibilities and existing
decimal, canonical-trade, review and audit contracts remain unchanged.
Production readiness: local gate PASS; hosted migration/configuration/acceptance
are pending scoped approval, not represented as deployed.

| Before | After | Why |
| --- | --- | --- |
| Operator-prepared client IDs/configuration | Owned guided setup and credential-free downloads | Setup begins inside the app |
| Registration/access/health could be confused | Four explicit milestones and blocked-state guidance | No fabricated connection success |
| Separate new UI styling | Existing warm light/navy dark Card, Button, Label and MutationForm tokens | Consistent desktop/mobile experience |

Imprint recorded these patterns in `ui-registry.md`; React review retained server
data/authorization boundaries, labelled native controls and hydration/pending
mutation protection. No new animation, theme implementation or visual library.

## Remaining and rollout boundary

Next: package the existing Windows collector/stdio adapter, safe setup-file
activation, dedicated-terminal verification, protected credential creation,
explicit startup controls and local pending-upload/health telemetry. Then verify
actual client writes/retries/revocation and supported remote connector onboarding,
remaining terminal/startup operations, and final hosted release gates.

This increment has not changed any hosted database, OAuth clients, Vercel flags,
aliases, production secrets, existing MT5 grants/tasks/terminal, collector intent
or canonical trading data. Production MCP remains disabled. No model inference,
broker execution, paid infrastructure or live-account activation occurred.
Apply the reviewed migration and enable setup only in an approved rollout;
an installer is not released by committing this code.
