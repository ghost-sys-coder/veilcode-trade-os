# MCP MT5 workflow verification

2026-10-09. Branch `feature/mcp-access`, baseline `57ab4d5`.
Item 1 of the [completion checklist](MCP_COMPLETION_CHECKLIST.md), using the
[approved increment plan](MCP_MT5_WORKFLOW_PLAN.md). No file/deletion/stdio work.

## Delivered scope

Eight new typed tools bring the catalog to 73 tools / six resources:

| Tool | Authority and effect |
| --- | --- |
| `tradeos_mt5_grants` | Bounded owner-only discovery of already-approved active account grants; no credentials or new consent |
| `tradeos_mt5_map_account` | Exact explicit demo identity, existing grant, account currency/precision and immutable mapping; durable operation |
| `tradeos_mt5_symbol_map` | Observed broker alias → owned/global instrument, with reason/source/version; published identity cannot be reassigned |
| `tradeos_mt5_cash_classify` | Explicit baseline/adjustment/link/zero disposition; central decimal amount; no guessed cash meaning |
| `tradeos_mt5_publish` | Source-backed selected episodes, existing sole canonical writer; no fabricated plans, no implicit reconciliation/policy |
| `tradeos_mt5_onboarding_approve` | Explicit complete-history confirmation and exact reconciled snapshot proof |
| `tradeos_mt5_publication_policy` | Enable/disable account-specific future eligible publication; enable requires current approval, not worker activation |
| `tradeos_mt5_control` | Server PAUSE/RESUME with version/reason and fencing; not OS startup, local intent or broker execution |

Input and output schemas are explicit. ID/version/money boundaries are strings;
grant lists are bounded UUID-keyset pages. Publication identity selections are
deduplicated/sorted before hashing. No user/owner override or calculated financial
proposal is accepted from an MCP caller.

## Shared implementation and security

`domain/mt5/workflow-commands.ts` validates commands/results and uses the existing
cash, publication and onboarding domain algorithms. The verified application
adapter calls fixed private preparation/write functions in one transaction.
Full consistent source evidence is loaded only when a calculation/proof needs it.
Browser registration/control use the same command schemas and preserve the
existing browser-facing `MT5_ONBOARDING_INVALID` error for prohibited live mapping.

Migration `20261009010947_mcp_mt5_workflow_commands.sql` extracts five existing
private workflow bodies once, preserving browser-only wrappers. It extends the
existing sole publication actor path only for explicit selected MCP publication;
forged automatic/collector requests remain rejected. POLICY uses the existing
append-only review implementation through a separate strict command, not the
source/manual-review tool.

Each mutation checks the verified active MCP actor/session/grant plus the relevant
active account-bound MT5 grant. MCP receipts/audits belong to the actual MCP
client with its application-wide null account scope. The collector grant/account
are auxiliary connection references, never substituted as the mutation actor.
New entry points and extracted cores are private SECURITY INVOKER, with empty
search paths and client EXECUTE revoked. No public table/policy/credential changes.

Grant → operation → connection locking, immutable receipt recovery, current
version/source/ledger checks, per-source provenance and financial validation are
retained. Old browser and worker paths remain separate. Audit failure rolls back
status, worker ownership, fence and receipt together. Revocation blocks even
previously committed receipt recovery through a now-unauthorized integration.

## Financial and protocol evidence

Real local OAuth/SDK fixture exercises the overlapping workflow sequence:

1. Discover approved MT5 grant; map demo login `9007199254740993` exactly once;
   pause without starting a worker; explicitly map `EURUSDm` to EURUSD.
2. Source/history and manual DISTINCT/REOPEN/LINK retain one original trade and
   its plan. `100 - 2 - 3 = 95.00 USD`; baseline `1000.00` gives `1095.00`.
3. Classify broker cash `10.00` once. Review corrected source `12.005`, normalize
   once to `12.01`, append only `2.01`; balance `1107.01`, original cash preserved.
4. Publish a second unknown-plan trade: `20 - 2 - 3 = 15.00`. Derived balance is
   `1122.01`; missing original planned risk remains null, not inferred.
5. Policy enablement before onboarding fails. After a matching current broker
   observation and complete snapshot approval, policy enables without resuming
   the paused connection. Retries return the same receipts, no extra trades/audits.
6. Resume server eligibility once; the old worker is cleared and its fence advances
   exactly once. Finish PAUSED with fixture policy disabled. Revocation then blocks
   mutation. Exact isolated fixture is removed; no actual terminal/order is used.

The SQL fixture separately classifies original funding `1000.00` as represented in
the existing opening baseline: zero deposit adjustments, final ledger `1095.00`.
Only an explicitly reconciled complete snapshot permits policy enablement.

CSV/import audit: Settings currently exposes import batch history and says CSV
commit UI is disabled until a broker-specific sample is reviewed. There is no
existing enabled CSV conflict-edit/commit action to expose; existing batch/row
MCP reads remain available. A new CSV ingestion product is not invented here.

## Commands

| Command | Result |
| --- | --- |
| `npm test` | PASS: 884 tests, 56 files |
| `npm run test:db` via the existing local diagnostic wrapper | PASS: 984 assertions, 25 rollback-isolated suites |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: 32 generated pages; public calculator remains static |
| `npm run test:mcp-integration` | PASS: 51 real-provider/SDK/browser checks |
| `npm run test:mcp-integration -- --integration-access-only` | PASS: 15 focused workflow checks, including the finalized strict result schemas |
| `npm run test:integration-browser` | PASS: 65 browser/provider/Python recovery checks; no uncaught client errors |
| `npm run test:mt5-python` | PASS: 176 tests, including native Windows security/containment |
| `npm run check:mt5-python` | PASS |
| `node --experimental-strip-types scripts/check-application-database.mts --local` | PASS: 30 private prerequisites / 14 version columns |
| Local Supabase advisors | No security findings/errors; inherited 31 InitPlan warnings |
| `supabase migration list --local` | New workflow version installed locally |
| `supabase db pull mcp_mt5_workflow_verification --local --schema public,private --yes` | Shadow replay complete, no schema changes found; CLI exit 1 for empty diff, no extra migration |
| `git diff --check` | PASS |

Exact SQL wrapper command:
`node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm`.
The inherited local supautils diagnostic setting is temporarily cleared and
restored in `finally`; permissions/assertions are not weakened. New suite passes
55 assertions, including atomic audit rollback, ownership, private permission,
revocation, stale evidence and stable replay. Existing browser/collector suites pass.

Versions: official MCP SDK 2.3.1, modern pinned `2026-07-28` plus legacy HTTP;
Chrome 154.0.8037.93; Python 3.13.2; Next.js 16.3.6; local PostgreSQL 17.6.
No real Codex/Claude/ChatGPT/Gemini client check or hosted MCP activation is claimed.
The inherited Node MODULE_TYPELESS_PACKAGE_JSON warning is not an application
runtime failure. Broker identity validation was kept intact when correcting the
browser error-contract regression; a fixture expectation now checks persisted
`10.00` rather than its old manual seed's `10` spelling. No rounding rule changed.

## Review and rollout boundary

Plan alignment: PASS for the overlapping item-1 group. System integrity: PASS,
using existing finance/proofs/fencing rather than rebuilding MT5. Local readiness:
PASS; the finalized strict-schema rerun passes. No frontend redesign,
deletion endpoint, grant creation or broker execution is added.

## Approved hosted prerequisite rollout

The user approved installation and feature-branch delivery on 2026-10-09.
Installed the exact tested migration on project `nhwlxcrsivmawwmjiwck` in
VeilCode Studio, then aligned only its newly generated migration-history entry
to repository version `20261009010947`. All 54 public/private application table
counts and deterministic content hashes are identical before and after DDL.
No account, trade, grant, mapping, cash decision, source revision, receipt,
approval, review event, audit or collector-control record was changed.

Hosted readback retains the pilot's 20 published trades, normalized closed PnL
`2032.53`, connection status `ACTIVE` / version `20`, no attention code and the
existing enabled automatic-publication policy. Server ACTIVE is not evidence of
a running local collector: this rollout neither invoked nor resumed that worker.
The MCP resource remains disabled. All eleven new/extracted private functions
are SECURITY INVOKER with empty search paths and EXECUTE denied to anon,
authenticated and service_role. Direct public wrappers retain their browser gate.

`npm run build:verified` PASS against the hosted prerequisites: 30 private
functions / 14 version-order columns, successful type compilation and 32 pages.
The public calculator remains static. No hosted user mutation or real AI-client
test was performed; local real-provider fixtures supply workflow evidence.

Hosted advisors have no ERROR findings or new function-exposure finding. Existing
notices remain: 23 intentionally deny-by-default private RLS tables (INFO),
10 uncovered foreign keys (INFO), 102 unused indexes (INFO),
[31 RLS InitPlan warnings](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan)
and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
No unrelated Auth configuration or index changes were made during this rollout.

Item 1's implementation, hosted prerequisite and code-delivery gates are complete.
`git push origin feature/mcp-access` published code commit
`6c8f1336d07daea2aca860ed1df8b5d81e483f33`. Exact-commit Vercel inspection confirms
Preview `dpl_4AaByThovAyiP8v3fDnhM1Sspwke` is READY on the intended Trade OS project
and feature branch, framework Next.js, build duration 62.444 seconds:
[verified code preview](https://trade-khame1j1e-ghostsyscoders-projects.vercel.app).
The Vercel build log reports successful build completion. The only untracked
worktree file is the user's untouched `public/snapshots/result-snapshot.png`;
credentials and local artifacts were excluded from both commit and push.

Delivery is restricted to `feature/mcp-access` and its Git-created Vercel Preview.
No master merge, production promotion, MCP activation or private-file
implementation is included in this increment. Next build is controlled private
screenshots/files; permanent deletion still waits for its confirmation boundary.
