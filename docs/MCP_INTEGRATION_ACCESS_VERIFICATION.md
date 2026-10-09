# MCP integration-access increment

Date: 2026-10-09. Branch: `feature/mcp-access`, fast-forwarded from the user's
merged master `6c7a0b77524eb44680a5d7a61b8282506e02b510` before implementation.

## Scope and duplicate-work check

The existing MT5 capture, reconstruction, finance, browser onboarding, publication
and conflict-review implementations were inspected before building. They already
exist and are reused. Existing MCP canonical-trade reads, position sizing,
profile preferences and paginated balance curves are not rebuilt.

This increment adds nine previously missing MCP tools, bringing the stateless
HTTP catalog to 65 tools and six resources:

| Tool | Effect |
| --- | --- |
| `tradeos_mt5_list` | Bounded owned connection health list; optional account filter |
| `tradeos_mt5_get` | One owned connection and its current health |
| `tradeos_mt5_preview` | Complete-source reconstruction/bridge, then bounded episode pages |
| `tradeos_mt5_sources` | Append-only raw revisions with string IDs, current/review flags |
| `tradeos_mt5_matches` | Current exact manual fingerprints and historical decisions |
| `tradeos_mt5_review` | Explicit SOURCE, DISTINCT, LINK, REOPEN or CASH review |
| `tradeos_imports_list` | Owned import batches, including failed/incomplete imports |
| `tradeos_imports_get` | One owned batch and its persisted status/errors |
| `tradeos_import_rows` | Bounded raw/canonical staged rows and unresolved decisions |

`tradeos://v1/integrations` documents relationship, review and provenance rules.
No worker capture/lease API, terminal switching, broker execution, initial
mapping, onboarding approval or publication-policy tool is added here.

## Shared authority and security

`services/application/integrations.ts` accepts verified actor contexts. The fixed
private application transaction allowlist derives ownership from verified claims;
input schemas reject caller owner/grant IDs and unrecognized fields.

`domain/mt5/snapshot.ts` validates complete independent source/trade/mapping/cash/
adjustment/review datasets, matching connection identity, currency precision,
versions and checkpoints. Reads use repeatable-read transactions. Reconstruction,
reconciliation and financial attribution remain the existing MT5 domain code.
`domain/mt5/prepare-review.ts` is used by both browser and MCP review adapters.
The financial writer is shared, not copied.

Migration `20261009001418_mcp_integration_access.sql` extracts existing private
read/review bodies behind separate browser/application boundaries. Legacy RPCs
still require a direct browser session. New entry points are unexposed private
SECURITY INVOKER functions with empty search paths and no PUBLIC, anonymous,
authenticated or service-role EXECUTE permission. No public table, RLS policy,
Auth setting or new model credential is introduced.

Every MCP request freshly checks its resource-bound MCP grant/session/consent.
MT5 review mutations also require an owned demo connection and its separate active
account-bound MT5 grant/resource. Revoking either grant blocks its authorized
activity. Reading retained evidence does not reactivate a paused/revoked worker.
An MCP grant cannot impersonate a collector or enter automatic publication.

Reviews use exact version/source/ledger/manual-trade tokens, meaningful reasons,
durable operation IDs, request hashes and atomic receipts/audits. Identical retries
recover results before stale-evidence checks; changed payloads conflict. MCP
receipts retain their correct application-wide null account scope; the collector
grant/account identity is separate and never substituted as the mutation actor.
SOURCE approval is not publication. LINK changes only verified broker execution,
preserving original plans, manual context and review evidence. CASH handles a
reviewed revision of an already classified cash record, not guessed new funding.

## Paging and financial fixtures

All external list limits are 1–100 (default 50). UUID cursors serve connections,
imports and manual matches; revision cursors are positive integer strings, never
JavaScript numbers. Preview cursors bind the connection and complete financial
snapshot. Malformed cursors are rejected; changed evidence requires a fresh
preview. The bridge is calculated across all evidence before episode pagination.
At more than 100,000 records in an internal dataset, the snapshot fails explicitly
instead of presenting truncated history as complete. Problem summaries expose
their total count and truncation flag.

Hand-calculated deterministic fixtures:

- Two closed episodes: each `100 - 2 - 3 = 95.00 USD`; full proposed change is
  `190.00 USD` even when an episode page contains only one result.
- Real SDK manual LINK: baseline `1000.00`, one closed canonical trade `+95.00`,
  derived balance `1095.00`. Same original trade ID, one execution version,
  unchanged thesis and planned-risk value. SOURCE, DISTINCT, REOPEN and LINK
  append recoverable MCP evidence; linking and receipt retries do not duplicate.
- Reviewed funding correction: original classified `10.00`; new broker value
  `12.005` normalizes once to `12.01`, so only `2.01` is appended with explicit
  performance-neutral classification. Original funding remains recoverable;
  repeated CASH review has one effect. Fixture balance becomes `1107.01`.
- Broker login/ticket `9007199254740993` remains an exact string. Older exit-price
  revision `1.19` remains available beside current `1.2`.

No broker orders or real MT5 terminals are used for these fixtures.

## Commands and evidence

Final verification is against disposable loopback Supabase and the local Next.js
integration app. Production `.env` is never used by fixture/database runners.

| Command | Result |
| --- | --- |
| `npm test` | PASS: 850 tests, 55 files |
| `npm run test:db` through the local diagnostic wrapper below | PASS: 929 assertions, 24 suites |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: 32 generated pages; anonymous calculator remains static |
| `npm run test:mcp-integration -- --integration-access-only` | PASS: 11 focused real-provider/SDK checks |
| `npm run test:mcp-integration` | PASS: 47 real-provider/SDK/browser checks |
| `npm run test:integration-browser` | PASS: 65 real-provider/browser/Python recovery checks; no uncaught client errors |
| `npm run test:mt5-python` | PASS: 176 tests, including native Windows security/containment |
| `npm run check:mt5-python` | PASS |
| `node --experimental-strip-types scripts/check-application-database.mts --local` | PASS: 27 functions, 14 version/order columns |
| `supabase db advisors --local --type all --level warn --fail-on error --output json` | 0 security findings/errors; 31 inherited `auth_rls_initplan` warnings |
| `supabase migration list --local` | New version recorded locally; hosted application not performed |
| `supabase db pull mcp_integration_access_verification --local --schema public,private --yes` | All migrations replayed in shadow database; "No schema changes found"; CLI exits 1 for no diff, no extra migration generated |
| `git diff --check` | PASS |

The full SQL command is
`node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm`.
This existing local-only diagnostic wrapper temporarily clears the inherited
supautils hint-role setting and restores it in `finally`. It invokes the normal
database runner; every suite rolls back and the new suites are auto-discovered.
No production authorization setting is relaxed.

The two new database suites pass 46 and 23 assertions: owner/non-owner access,
legacy OAuth RPC isolation, private permissions, strings/paging, failed imports,
stale decisions, source/cash/link receipts, actual MCP attribution, audit rollback,
preserved plans, original financial evidence and immediate revocation. Existing
MT5, account, monetary, review and RLS suites also pass.

Client versions: official MCP client/server SDK 2.3.1; Chrome 154.0.8037.93;
Next.js 16.3.6; local Supabase/PostgreSQL supplied by the existing test stack.
Modern pinned `2026-07-28` and legacy HTTP discovery are verified. This is not
verification of Codex, Claude Code, ChatGPT, Claude or Gemini client products.

During verification, fixture omissions and a decimal-storage-scale assumption
were corrected without changing monetary rules. Cleanup initially attempted an
invalid MT5 identity rewrite and then hit the legitimate broker-deletion guard;
cleanup now removes only its exact disposable fixture under transaction-local
replica mode. Leftover local fixture user/resource rows were removed and final
suites run sequentially. No application deletion API or constraint was weakened.
Node reports the inherited MODULE_TYPELESS_PACKAGE_JSON warning for `.ts` imports;
no package-wide module-mode change is made as part of this increment.

## Review and release boundaries

Plan alignment: PASS for this scoped access/review increment. The broader MCP
plan remains incomplete. System integrity: PASS—shared monetary/reconstruction
and private transactional authorities, true MCP actor and separate collector
grant, immutable evidence, no new frontend design or public-auth wall.

Production readiness: local and hosted private prerequisites pass. Branch source
publication/Preview inspection and final MCP activation/client gates remain
separate. Hosted MCP remains disabled; hosted mappings, trading data, collector,
automatic-publication policy and credentials are unchanged.

Remaining MCP capability gates: integration controls/initial mapping/onboarding/
publication approval policy, controlled screenshots/files, permanent-deletion
confirmations, local stdio and requested real-client matrix. Existing browser
MT5 workflows remain available. No full MCP completion or hosted readiness is
claimed by this scoped report.

Final review summary: scoped plan alignment and system integrity pass. Local
verification passes with no unresolved code defect in this increment. Hosted
schema installation/verification now passes as recorded below; full MCP release
is not complete.
Architect/review skills kept the build limited to the missing adapter surface;
Supabase guidance kept browser/OAuth permissions separate and verified by SQL,
advisors and schema replay. Recovery guidance isolated test-harness failures
without weakening protected trading facts or rebuilding completed features.

## Approved hosted prerequisite rollout — 2026-10-09

The user requested the push and completion outline following the prerequisite
approval question. Applied the exact already-tested private migration to project
`nhwlxcrsivmawwmjiwck` using the explicitly identified VeilCode Studio connection.
Aligned only its new history entry from tool-generated `20261009005825` to the
canonical repository version `20261009001418`; no earlier history was rewritten.

All 12 before/after fingerprint groups match: profiles, accounts, trades,
adjustments, grants, resources, MT5 connections, current source facts, raw source
revisions, execution versions and both integration/application mutation audits.
The existing connection remains ACTIVE/version 20 with no attention, its approved
publication policy unchanged, 20 canonical trades and USD 2032.53 closed net PnL.
No worker control/capture call, grant activation or trading operation occurred.
There is no enabled MCP resource; existing enablement was not changed.

Hosted permission checks confirm all three new entry points are SECURITY INVOKER,
have empty search paths and deny anon/authenticated/service-role EXECUTE. Strict-TLS
`npm run check:application-db` passes 27 functions/14 columns, and
`npm run build:verified` passes the same hosted guard plus the 32-page production
build. Hosted advisors show
the inherited private deny-by-default RLS INFO notices, FK/index INFO and 31
InitPlan warnings. The pre-existing
[leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains; unrelated Auth settings/policies/indexes were not changed.

The remaining work is explicitly tracked in
[MCP completion checklist](MCP_COMPLETION_CHECKLIST.md), without rebuilding MT5.
