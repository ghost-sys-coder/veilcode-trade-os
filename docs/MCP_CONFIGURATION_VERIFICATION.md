# MCP configuration and real OAuth checkpoint

Date: 2026-10-08. Branch: `feature/mcp-access`.
This is a verified increment, not completion of the full MCP integration.
Hosted MCP remains disabled; these migrations were applied only locally.

## Delivered

Eight tools and five contract resources now include strategy/setup/rule
list/get/create/patch/archive, using explicit JSON schemas. Configuration reads
use owner-scoped, bounded ID-cursor pagination. Numeric rule limits and 64-bit
record versions cross MCP as strings. Omitted patch fields stay unchanged;
explicit null clears nullable fields only. Permanent deletion is not exposed.

Existing browser actions now perform form parsing/navigation/revalidation only,
delegating to the same typed application services used by MCP. Forms carry a
stable per-render operation ID and the version originally displayed. Archived
records show disabled, explicit labels; archived parents are not new setup
choices. Existing design tokens/layout are preserved and recorded in the UI
registry. Legacy examples still become personal records when deliberately saved.

Private invoker-only functions accept no submitted owner identity. Runtime
contexts must have verified provenance, and database transactions recheck live
browser sessions or MCP grants. These functions have no public RPC wrapper and
are not executable by anonymous/authenticated/service-role API callers. OAuth
direct-table restrictions and existing protected financial/review RPCs remain
unchanged. Server DB role checks also fail closed if an EXECUTE grant is added
accidentally. No broker execution or model-provider API is used.

Mutations lock the target version and durable operation key. Normalized request
hash, result, record change and actor/client/before/after audit commit atomically.
Identical retries recover the original result; changed commands with the same
ID conflict. Receipts and audits are append-only. MCP operation-status lookup
includes these receipts, without exposing browser receipts or another grant's
scope. No credentials or tokens are stored in audits.

## Exact verification

| Command | Result |
| --- | --- |
| `npm test` | PASS: 520 tests / 40 files |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` (executes `npm run test:db`) | PASS: all 541 assertions / 14 suites; existing local image workaround restored afterward |
| `npm run test:mcp-integration` | PASS: 12 real local provider/HTTP/browser checks |
| `npm run test:integration-browser` | PASS: all 53 existing provider/MT5/browser checks |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: 32 generated pages plus dynamic MCP/discovery routes |
| `npm run test:mt5-python` / `npm run check:mt5-python` | PASS: 176 tests; Python static checks |
| `supabase db advisors --local --type all --level warn --output json` | 31 existing OAuth-policy initplan linter false positives; no other WARN/ERROR |
| `supabase db pull mcp_configuration_verified --local --yes` | Shadow replay passed; eight legacy MT5 body diffs were verified as line-ending-only, then the redundant generated file/local history entry were removed |
| `git diff --check` | PASS |

The new database suite has 40 checks: ownership, no direct OAuth reads, private
function permissions, typed decimal boundaries, keyset paging, target versions,
retry/hash conflict, null/omission semantics, cross-owner references, archival,
immutable audits/receipts, rollback after injected audit failure, shared browser
commands and immediate revocation. The existing 501 assertions still pass.

The disposable Supabase image has the previously documented supautils
permission-denial crash; no application permissions or assertions were weakened.
The ignored diagnostic wrapper disables only its local hint feature during the
unchanged database runner and restores the exact default afterward. This is not
a hosted database change or a claim that the stock image issue is resolved.

Real-client library: official TypeScript SDK 2.3.1, modern protocol 2026-07-28
and legacy negotiation. Browser: Chrome 154.0.8037.93, fresh headless profile.
Provider: local Supabase Auth with real signed tokens, not mocked authorization.
The fixture registers/removes one public OAuth client and one exact-owner user;
test records/audits are removed only in this disposable local fixture. No
production identity, credential file, terminal, grant or broker order is changed.

Real tests cover browser application-wide consent without MT5 account selection,
S256 rejection/acceptance, signed intended-resource tokens, MT5 resource rejection,
renewable credentials, current-browser-only logout, server kill switch and live
revocation. SDK calls verify list/get/create/patch/archive, exact decimals and
operation lookup. Simultaneous identical uploads produce one receipt; concurrent
same-version edits have one winner. A loaded browser form cannot overwrite a
newer MCP edit. Archived strategy references remain available to history.

Hand calculation remains USD100000 × 1% = USD1000 risk; EURUSD stop distance
0.002 × contract100000 = USD200 per lot; recommended volume = 5.00 lots.
The rule fixture's 0.00000001 limit remains exactly that string.

## Review findings and corrections

The real development HTTP check revealed Next normalizes its Request URL to
localhost despite an incoming loopback Host of 127.0.0.1. Validate the actual Host
against the configured resource and keep Origin checks; never trust
X-Forwarded-Host. The test suite includes spoofed Host rejection and normalized
Request acceptance. DNS-rebinding protection is not disabled.

A rule patch initially encountered its unchanged numeric value as JSON numeric
inside SQL. The merge now uses the typed wire representation before validating
the patch. Both browser and MCP rule edits preserve exact decimal boundaries.

The CLI advisor reports `auth_rls_initplan` for the existing
`(select auth.jwt() ->> 'client_id')` policy. PostgreSQL EXPLAIN shows InitPlan 1
and a filter referencing its result, confirming statement-once evaluation.
These are linter false positives, not permission defects; do not relax or
rewrite correct isolation to silence them. Add owner/cursor and audit foreign
key indexes for the new reads and evidence tables.

Shadow replay reproduced both MCP migrations. Its generated diff included only
eight existing MT5 function bodies because of CRLF/LF differences. Each body was
compared against the original migrations (including the shared-writer extraction
replacements); all eight matched after line-ending normalization. The redundant
generated migration was removed and only its local auto-created history entry
reverted. No MT5 function or hosted schema was changed.

React/imprint review confirms no extra hooks, client-side privileged imports,
new visual tokens or layout drift. Shared service/schema/permission and recovery
reviews pass for this increment. The dependency limitations in
[initial foundation evidence](MCP_FOUNDATION_VERIFICATION.md) remain unchanged.

## Remaining work

Accounts, trades/financial finalization, corrections, explicit reviews, journals,
goals/prop, analytics/exports, private screenshots, tags/instruments and integration
review families still need their shared service/tool implementations. Permanent
deletion requires the planned one-use browser confirmation. Local stdio with
renewable protected credentials and real Codex/Claude Code/ChatGPT/Claude/Gemini
CLI checks remain pending. Hosted OAuth/client configuration and rollout are
separate from this real local gate; do not advertise `/mcp` as ready in production.
