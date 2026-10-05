# MT5 handover — work stopped at the user's request

Date: 2026-10-05. This is an incomplete integration, not a release report.

**Historical snapshot:** work subsequently resumed at the user's request.
The publication scaffold described below is now implemented and locally verified;
see [current publication verification](MT5_PUBLICATION_VERIFICATION.md).
The subsequent explicit broker-symbol workflow is also implemented and verified;
see [symbol-mapping verification](MT5_SYMBOL_MAPPING_VERIFICATION.md).
Keep this handover as the record of the earlier stop, not the current worktree status.

## Repository state verified at handover

- Workspace: `D:\FOREX_TRADING\trade-os`.
- Current branch: `feature/mt5-sync`.
- HEAD: `1d7fdd9` — verified onboarding preview and fenced monitoring.
- `feature/mcp-access` was created from documentation checkpoint `b17c14a`
  and is parked; MCP implementation has not started.
- The last push attempts failed connecting to GitHub on port 443. Do not
  assume `1d7fdd9` or the current changes are on the remote.
- Do not reset the worktree or overwrite the external master merges.

## Approved scope and constraints

Read `INTEGRATION_ROADMAP.md`, `MT5_INTEGRATION_PLAN.md`, and
`MCP_INTEGRATION_PLAN.md` before continuing. MT5 precedes MCP. The user deferred
the mandatory 48-hour waiting gate; it is not passed. Actual focused demo-terminal
checks, account isolation, finance, security, and regression gates still apply.

Use the Supabase connection named **VeilCode Studio@Zooloop.tv@gmail.com**.
The hosted Trade OS project is `nhwlxcrsivmawwmjiwck`. Existing verification uses
disposable local Docker/Supabase, not hosted fixtures or destructive production
tests. Never print `.env` secrets, JWTs, passwords, or database connection strings.
No AI-provider API keys or broker order-execution APIs are in scope.

## Committed capabilities

- Local provider verification of browser consent, PKCE, refresh, resource-bound
  signed tokens, application grants, revocation, and ordinary browser login.
- Account-bound MT5 connections and fenced leases; durable operations, receipts,
  audits, source revisions, and complete multi-batch capture checkpoints.
- Read-only Python collector, SQLite outbox, retry/recovery, Windows DPAPI
  credentials, supervised worker containment, operator CLI, and startup installer
  code. This does not mean a real startup task or terminal was installed.
- Central TypeScript directional-episode reconstruction, scale-ins/partial exits/
  reversals, decimal finance, and trading-credit/identity storage migrations.
- Account-mapping UI, owner-only read-only import preview, reconciliation bridge,
  monitoring, and audited pause/resume controls.

Committed preview does **not** publish trades or approve reconciliation. See
`MT5_ONBOARDING_FINANCE_VERIFICATION.md` and the earlier verification reports for
the exact implemented boundaries and historical commands/results.

The previous committed checkpoint was reported as passing: 306 application tests,
283 database assertions (7 suites), 167 Python tests, 37 local browser/provider/API
checks, typecheck, lint, Python static checks, and production build. These are
checkpoint results, **not verification of the current uncommitted changes**, and
not evidence of real broker-terminal testing.

## Uncommitted, untested work — do not deploy

Current changes were preserved without committing or pushing:

- `services/mt5/onboarding.ts`: extracts `getMt5OnboardingSnapshot`, returning the
  full validated source/ledger snapshot; existing preview is now an adapter.
- `domain/mt5/publication.ts`: explicit publication-request schema and preparation
  from durable source revisions. Clients submit decisions, not calculated finance.
- `services/integrations/browser-context.ts`: runtime-provenance browser context
  using verified claims and user identity, with a WeakMap to reject forged contexts.
- `services/integrations/publication-database-config.ts`: proposed strict remote
  TLS / explicit loopback-only local database configuration.
- `services/integrations/publication-database.ts`: proposed server-only, fixed
  parameterized private-function transaction adapter with sanitized errors.
- `services/mt5/publication.ts`: proposed browser publication service and durable
  receipt lookup before reloading a potentially changed ledger.
- `scripts/start-local-integration-app.mjs`: passes the local database URL privately
  to the isolated integration app.
- `package.json`: moves existing `pg` from dev dependencies to runtime dependencies.
  **The lockfile has not been updated.**
- `supabase/migrations/20261005144952_mt5_canonical_publication.sql`: created with
  `supabase migration new`; **currently empty**.

The private database functions referenced by the new adapter do not exist yet:
`private.mt5_publish_browser` and `private.mt5_browser_publication_result`.
No action, page, or endpoint invokes this unfinished service. It has no added
unit/database/browser coverage. Review, complete or replace it before use.

## Next required implementation

1. Implement private, server-only atomic canonical publication: verified actor,
   live session/grant checks, source/ledger/version concurrency, immutable execution
   revisions and allocation provenance, import batches, receipts, and audits.
   Do not expose trusted financial JSON to ordinary authenticated RPC callers.
2. Add explicit onboarding approval, positive baseline acknowledgement without
   rewriting existing baselines, cash/funding classification, symbol mappings,
   manual-match conflict review, and changed-source review. Preserve plans/reviews.
3. Connect browser approval and ongoing collector publication to the shared services.
   Open partial-exit cash must remain outside canonical realized analytics until
   complete closure. Unresolved history/effects must not be called reconciled.
4. Install isolated demo terminals/runtime, obtain browser consent, verify exact
   account mappings, install/invoke startup, and run focused interruption checks.
5. Run all required gates, record actual results, commit and push the MT5 branch.
   Merge only after the expedited required gates; then update the parked MCP branch
   from master and implement/verify MCP independently.

## Terminal evidence rechecked at handover

Existing running terminal (process 15580, product version 5.0.0.6230):

`C:\Program Files\MetaTrader 5\terminal64.exe`

Origin-mapped data folder:

`C:\Users\HP\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075`

This is the existing manual/Claude-connected installation and was left untouched.
No dedicated installation was found in the checked installation roots. No broker
password or saved-login file was read. Do not ask the user to rediscover these paths
or repurpose this terminal. Dedicated terminals and real-demo verification remain
outstanding; no startup task or pilot/soak completion is claimed.
