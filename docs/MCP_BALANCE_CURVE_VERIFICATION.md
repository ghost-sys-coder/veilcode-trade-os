# MCP paginated balance curves

Date: 2026-10-09. Branch: `feature/mcp-access`, updated by fast-forward from the
user's merged master `3a8bef2` (PR #19). This increment adds one tool, bringing
the stateless HTTP catalog to 54 tools and five contract resources. It does not
complete or activate the full MCP integration.

## Implementation blueprint and delivered boundaries

The approved next build is bounded, snapshot-aware balance-curve access. A
client requests `tradeos_analytics_balance_curve` through authenticated `/mcp`;
the verified application service loads a fresh repeatable-read private reporting
snapshot, runs the existing shared financial builder, then pages its result.
No alternate monetary algorithm, direct OAuth table access or persisted server
session is introduced. No migration or new credential/configuration is needed.

- Require one `currencyCode`. Only `filters.account`, `accountType`, `from` and
  `to` are accepted. Instrument, strategy, setup and behavioral filters cannot
  truncate an account ledger. Account scope must be owned and available.
- `timezone` defaults to the profile. `pageSize` defaults to 50, bounded 1–100.
  Dates are civil reporting dates; realized trade placement remains `closed_at`.
- Build full eligible history before slicing points. Pre-period high-water
  marks, cumulative results and cash-flow interpretation survive every page.
  Open trades and partial-exit cash cannot become finalized realized PnL.
- Later portfolio accounts enter as neutral capital at their actual start date.
  Accounts starting after `to` do not add phantom capital to an earlier period.
  Each account's adjustments normalize at its own currency precision before
  same-currency accumulation, just like trade results.
- Points carry UTC timestamps, stable IDs, kind/label, decimal-string balance,
  lifetime-to-point cumulative PnL/R, `cumulativeRSample` and drawdown. Missing
  R remains null and is excluded from that sample, not manufactured as zero.
- `openingBalance` is the first returned series basis (including a synthetic
  period-opening basis), not later portfolio capital. Metadata/current balance
  and drawdown statistics describe the complete selected series, not the page.
- Unclassified OTHER adjustments withhold authoritative drawdown. Incomplete
  closed history withholds current/opening/point balances and cumulative PnL;
  counts and a clear reason remain available. Known valid R retains its explicit
  qualifying sample. Equity observations never replace the balance series.

Shared date fixes: starting dates and synthetic period openings resolve to the
first real instant of the civil date in the reporting timezone, including DST
midnight transitions. A skipped civil date is rejected rather than shifted.
Actual events normalize UTC offsets while retaining database microseconds;
same-instant ordering is adjustment, trade, then stable ID. A baseline or
period-opening START precedes its events. Existing progress drawdown also uses
the configured timezone for its date-only account start.

## Continuation contract

`nextCursor` is validated canonical base64url containing version, content
fingerprint and last point ID. It is a continuation hint, never authorization.
The SHA-256 fingerprint binds the verified owner's selected account identities,
effective filters/timezone and entire financial series, not only visible points.
Changing page size is allowed; otherwise repeat the same effective scope.

Every continuation authorizes the actor/session/grant again in the database,
even when its fingerprint matches. Revocation or an unavailable database cannot
fall back to a cached response. No user financial data is cached in server memory.

- Identical retries produce identical points/cursors and no mutation.
- A changed series/scope returns `CURVE_CHANGED`; restart without a cursor and
  discard the previous page chain. Concurrent pages cannot silently mix data.
- Invalid payloads/encoding/version or nonexistent point IDs return
  `INVALID_CURSOR`, without private error details.
- Unrelated review text or out-of-period financial activity need not invalidate
  an unchanged financial series. This is a content snapshot, not a durable
  historical database snapshot or financial revision identifier.

## Independent fixture calculations

| Fixture | Hand calculation | Verified result |
| --- | --- | --- |
| Closed partial win | 1,000 + 10 | balance 1,010.00; cumulative 10.00; 0.10000000R, sample 1 |
| Loss then withdrawal | 110,000 − 5,000 − 10,000 | balance 95,000.00; drawdown remains 5,000.00 |
| Subsequent win | 95,000 + 50 | balance 95,050.00; drawdown 4,950.00; maximum 5,000.00 |
| Deep pages | 1,000 + 130 × 0.01 | 131 unique points, 1,001.30 balance; 65 valid R values total 0.00650000R |
| Different precision | USD precision 2 adjustment 0.004; precision 3 adjustment 0.001 | normalized 0.00 + 0.001; combined balance 2,000.001 |
| Local opening | 9 October midnight, Africa/Kampala | 8 October 21:00 UTC; pre-period drawdown retained |
| Timestamp ordering | 12:00:00.000000Z win, then .000001Z loss | correct win-before-loss ordering; microseconds retained |

Unit fixtures also cover JPY precision zero, exact-zero normalization, a small
negative precision-three result, missing R, ambiguous/affecting OTHER, incomplete
closure, empty trade history, future accounts, scope/owner/timezone changes,
raw-row reordering, replay, invalid cursors, DST and a skipped civil date.

## Verification evidence

All commands below exited successfully after the relevant fixes:

| Command | Result |
| --- | --- |
| `npm test` | PASS: 790 tests across 52 files, including 44 new curve tests |
| `npm run test:db` via local diagnostic wrapper below | PASS: 809 assertions across 21 rollback-isolated suites |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, no lint warnings |
| `npm run build:verified` | PASS: hosted read-only 22-function/13-column preflight and production build |
| `npm run build` | PASS: final-source production build, 32 generated pages |
| `npm run test:mcp-integration` | PASS: 37 real local OAuth/SDK/browser checks |
| `npm run test:integration-browser` | PASS: 65 real local provider/browser/API regression checks |
| `npm run test:mt5-python` | PASS: 176 tests |
| `npm run check:mt5-python` | PASS |
| `git diff --check` | PASS; new source/doc files checked separately |

The database command was:

```powershell
node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm |
  Select-String -Pattern '^Suite:','^PASS:','^FAIL:','RESTORED'
exit $LASTEXITCODE
```

It invokes `npm run test:db` against local Docker Supabase only. The existing
local permission-diagnostic workaround is restored in `finally`; the run prints
`LOCAL_DIAGNOSTIC_HINT_SETTING_RESTORED`. No hosted destructive testing occurs.

Real MCP checks use official TypeScript SDK 2.3.1, modern protocol 2026-07-28 and
legacy stateless HTTP, with Chrome 154.0.8037.93. The extended fixture verifies
one-point paging and cross-client replay, unknown-account rejection, a real
SQL-backed neutral-withdrawal bridge, local period opening, stale continuation
after a committed cash change, safe malformed-cursor errors and grant revocation
with a previously valid cursor. Existing consent, refresh, resource binding,
manual trade/reviews and browser shared-service workflows also pass. Fixture
cleanup restores local integration settings and removes only its disposable owner.

The first build caught an inferred `unknown` cursor type in the test harness;
an explicit type fixed it and the build was rerun successfully. The known Node
MODULE_TYPELESS_PACKAGE_JSON warning remains non-blocking; package module mode
was not changed just to suppress it.

## Review and operational limits

Review benchmark: this document's blueprint and the approved integration/domain
contracts. Plan alignment, shared-service/ownership/monetary boundaries and
increment readiness pass. No unresolved defect was found in the delivered
increment; full MCP release is still pending the capability/client gates below.

| Full-flow boundary | Evidence |
| --- | --- |
| Client → authenticated HTTP | Official modern/legacy SDK tools discover/call through signed resource-bound OAuth |
| HTTP → private data | Fresh actor/session/grant checks; owner-isolation database tests and real unknown-account/revoked-cursor rejection |
| Data → calculated result | Independent financial fixtures; all shared-domain/unit and database suites pass |
| Result → client/browser | Structured bounded pages/replay/stale errors pass; browser manual/review/login/calculator regressions pass without uncaught page errors |

Output pagination bounds client response size, not database computation: each
page still loads/calculates full eligible history under existing database/time
limits. There is no SQL OFFSET page or false claim of constant-time deep reads.
Large-history optimization and a retained snapshot/export strategy are future
work if production volumes require them. A changing live ledger may require
restarting a page chain; the tool does not freeze or persist history.

No push, deployment, production migration, hosted integration enablement,
collector resume, broker order or real user-account mutation is part of this increment. The
hosted database preflight is read-only. Hosted MCP remains disabled and this new
tool has not been claimed as hosted/external-client verified. Screenshots,
integration/import reads and review workflows, profile, permanent-deletion
confirmation, local stdio and the real-client matrix remain pending.
