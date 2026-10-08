# MCP account workflow checkpoint

Date: 2026-10-08. Branch: `feature/mcp-access`, following `60db5bf`.
Verified increment only; full MCP completion and hosted activation remain pending.

## Delivered

Four additional tools bring the catalog to twelve: `tradeos_accounts_list`,
`tradeos_accounts_get`, `tradeos_accounts_create` and `tradeos_accounts_patch`.
Lists use bounded owner-scoped ID-cursor pages. Monetary values and record
versions are strings; amounts are calculated through the central decimal/balance
domain. Each account retains its own currency; no mixed-currency monetary total.

Account reads separate starting balance, closed-trade PnL, cash adjustments and
derived balance. Open PnL and snapshots never replace realized results or the
ledger. Legacy unclassified OTHER count is explicit; these tools do not calculate
drawdown or assume a classification.

Account creation requires a positive normalized baseline and explicit precision.
The registered-code snapshot comes from [SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml),
published 2026-09-17 and retrieved 2026-10-08: 176 allowed codes after excluding
XTS (test) and XXX (no currency). App and DB validate the same snapshot. Precision
is configured explicitly, never inferred from this registry. Historical existing
codes remain readable; unrelated metadata patches do not silently migrate them.

Patches preserve omissions and accept null only for nullable fields. Currency or
precision cannot reinterpret financial history. Baseline/date corrections require
an audited reason; mapped MT5 baseline/date/type changes require integration
reconciliation rather than this generic tool. Status and previous-account links
cannot be patched through metadata; separate lifecycle tools remain pending.
Passed-challenge/funded-link and existing prop-configuration types are protected.

Private transactional receipt/audit helpers were extracted from the existing
configuration workflow, not duplicated. They derive the verified actor internally,
preserve request hashes/results and commit changes/evidence atomically. The shared
TypeScript transaction accepts only fixed workflow names, not SQL/table/role/owner
inputs. OAuth table isolation, live grant checks and private function permissions
remain authoritative. Configuration regression still passes after extraction.

The browser account action now delegates to the same service. Its register
exhausts bounded pages and preserves exact strings, including amounts/versions
beyond JavaScript's safe-integer range. The form retains its existing design;
only hidden operation/version fields and a matching correction-reason field are
added. React/imprint review is recorded in `ui-registry.md`.

## Commands and results

| Command | Result |
| --- | --- |
| `npm test` | PASS: 546 tests / 41 files |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` (runs `npm run test:db`) | PASS: 584 assertions / 15 suites; diagnostic setting restored |
| `npm run test:mcp-integration` | PASS: 15 real local OAuth/SDK/browser checks |
| `npm run test:integration-browser` | PASS: all 53 existing MT5/auth/browser checks |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: 32 generated pages plus dynamic routes |
| `supabase db advisors --local --type all --level warn --output json` | Only the same 31 previously EXPLAIN-verified policy linter false positives; no new WARN/ERROR |
| `git diff --check` | PASS |

Official SDK 2.3.1 verifies both legacy and 2026-07-28 HTTP. Fresh isolated browser:
Chrome 154.0.8037.93. The provider is real local Supabase Auth, not mocked JWTs.
No model API, real broker order, hosted fixture or production identity is used.

The new DB suite has 43 checks: owner/role isolation, currency registry, decimal
boundaries, JPY/KWD precision, retry/hash conflicts, versions, omission/null,
baseline reasons, immutable audit rollback, mapped-account guards, historical
type preservation and revocation. Repeated 1001 × 0.01 adjustments contribute
10.01 without truncation/drift. Existing configuration/MT5/security tests pass.

Hand calculations: DB fixture 1100 + (0.02 - 0.01) + (50 - 10 + 5) = 1145.01;
the repeated deposits then produce 1155.02. The real HTTP fixture starts with
100000.005 normalized to 100000.01, closes +1.005 to +1.01 and -0.005 to -0.01:
100000.01 + 1.00 + 45.00 = 100046.01. Open 999 and snapshot balance999000/equity1000000
are excluded. JPY1000.5 at precision0 becomes1001; KWD0.0005 at precision3 becomes0.001.

## Review and rollout limits

Plan alignment and system review pass for account metadata/balance access. This
does not claim account adjustment/snapshot/lifecycle tools or trade writes exist.
Private schemas keep RLS and default-deny ACLs; no public security-definer wrapper
or weaker OAuth permission was introduced. Errors expose bounded domain messages,
not raw database exceptions or credentials.

The existing baseline column is numeric(24,8). A configured precision above eight
is not silently clamped: any normalized value not exactly representable is rejected
as MONEY_STORAGE_LIMIT before persistence. Leverage follows its separate numeric
precision, not currency precision. Wider monetary storage is a separate migration
decision, not a rounding workaround.

Adding account record_version changes the full-row MT5 ledger fingerprint at
deployment. Existing snapshot approval may become stale; preserve the evidence
and require a fresh review rather than rewriting its old fingerprint. Starting
balances and existing publication policy are not modified by this migration.

Only local schema was changed. Apply the reviewed migrations before deploying
these browser adapters; do not treat an unmigrated hosted preview as ready. Hosted
MCP stays disabled. The known local supautils image workaround and development
dependency notices remain documented in prior checkpoints, not marked resolved.

Next: account adjustments/classification, snapshots and lifecycle; trade workflows
and the remaining catalog families; local stdio/protected renewable credentials;
real external Codex/Claude/ChatGPT/Gemini clients and hosted rollout. None of those
pending gates is reported as passed.
