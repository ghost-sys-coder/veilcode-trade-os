# MCP goals, prop configuration and shared progress

Date: 2026-10-08. Branch: `feature/mcp-access`, following `a797fa1`.
This is incremental coverage, not full MCP readiness. Hosted MCP remains disabled.

## Delivered boundary

Ten tools add goal get/list/create/patch/archive, append-only custom-progress
list/record, prop get/save and computed account progress: 40 HTTP tools total.
Inputs and outputs have explicit schemas. Decimal quantities and versions are
strings; count fields alone use bounded integers. Services require verified
actors; private functions recheck current session/grant, ownership and account
eligibility. Browser actions are parsing/navigation adapters to these services.

`20261008101830_mcp_goals_prop_progress.sql` adds goal/config versions, irreversible
goal archival, history-unit protection, currency-history guards and private
transactional commands/reads. Goal observations advance the goal version.
Account locks precede child locks. Effects, durable receipts and before/after
audits commit atomically; identical retries return the original receipt before
recalculation. Changed payloads and stale versions conflict. No permanent goal
deletion or deletion of evidence is exposed. Existing rule-review snapshots are
not changed. Security-invoker functions have empty search paths and no public,
anonymous, authenticated or service-role EXECUTE grant.

Private progress reads load complete history as exact numeric strings in a
repeatable-read snapshot; the old thousand-row Data API cap is removed. The
account ledger and progress calculations are pure domain utilities shared by
browser/MCP. Ordinary configuration, login, trading and journal semantics remain
unchanged. The UI reuses existing theme tokens, Cards and the aligned toolbar;
native disclosures expose edits/archival. A shared hydration/pending fieldset
protects both progress and journal forms. Timestamp controls explicitly say UTC.
Imprint and React review preserved the existing design language.

## Calculation and missing-evidence rules

- Trading targets and return use closed-at normalized trade profit, not deposits
  or withdrawals; cash-inclusive balance remains separate.
- R excludes missing/nonpositive planned risk, keeps eight fractional digits and
  reports its own sample. Tiny values use plain decimal strings, not exponents.
- Rule compliance requires a completion marker and the exact unique immutable
  rule snapshots. Placeholder rows and open results do not count.
- Drawdown uses the shared cash-neutral curve; its percentage belongs to the
  same high-water observation as the maximum amount. Unclassified OTHER or
  incomplete closure/final PnL makes authoritative drawdown unavailable.
- Incomplete closed results are counted and excluded explicitly, not silently
  presented as zero. CUSTOM without evidence stays unavailable; observations
  record a current value, never an increment to sum.
- Small positive days below the firm threshold remain positive, not break-even.
  Planned/draft trades cannot create executed trading-day evidence.
- Maximum-drawdown goals are limits and report within/exceeded status.
- Trailing/custom loss formulas, missing required equity and unspecified firm
  cash-flow treatment remain unavailable; generic analytics neutrality is not
  silently substituted for a prop firm's policy.

Hand fixture: starting USD1000, deposit1000, closed profit100, closed loss50,
withdrawal100 => balance1950; trading profit50; return5%; profit-target100 is50%
complete. High-water2100 and balance2050 produce maximum drawdown50, percentage
50/2100*100 =2.3810%; the subsequent withdrawal does not create another loss.
Only one of two closed trades has calculable R. The 1001-trade fixture of0.01
per trade totals10.01 with no row truncation or floating-point accumulation.
KWD precision3 normalizes10.0005 to10.001 and0.0005 to0.001; percentage0.00000001
is not currency-rounded. Unrepresentable persisted scales reject, never truncate.

## Verification status

| Command | Result |
| --- | --- |
| `npm test` | PASS650 tests /47 files |
| `node .artifacts/mt5-pilot/local_database_hints.mjs --test --npm` | PASS717 assertions /19 rollback-isolated suites (unchanged npm test:db runner) |
| `npm run test:mcp-integration` | PASS26 real local OAuth/SDK/browser checks, including all goal/prop tools and browser workflows |
| `npm run test:integration-browser` | PASS53 real local MT5/auth/browser checks |
| `npm run test:mt5-python` | PASS176 tests |
| `npm run check:mt5-python` | PASS |
| `npm run typecheck`, `npm run lint`, `npm run build` | PASS |
| `npm run replay:local-db` | PASS: finalized migration replay on guarded empty local database |
| `npm run check:application-db -- --local` | PASS:18 functions /11 version-order columns |
| `git diff --check` | PASS |
| `supabase db advisors --local --type security --level warn --fail-on warn` | PASS: no issues; later CLI telemetry timeout warning did not change exit0 |

The new progress database suite has49 assertions: real other-owner denial,
direct anonymous/OAuth function restrictions, retry conflicts, archival/history,
exact monetary/percentage precision, prop eligibility, complete optional rules,
timezone validation and full rollback on audit failure. The local diagnostic-hint
workaround restores the original configuration in finally; permissions/RLS and
all security assertions remain enabled. Legacy unchanged long notes remain
recoverable and are not truncated; changing firm account type cannot invalidate
its existing configuration.

The real SDK gate caught a transaction-mode regression that rollback-only SQL
tests did not exercise: authorization deliberately locks the grant FOR SHARE,
which PostgreSQL rejects in READ ONLY transactions. Shared reads now use
REPEATABLE READ without READ ONLY and still execute only fixed SELECT workflows.
Grant/revocation locks, ownership and isolation are unchanged. Four dedicated
transaction tests cover this contract, receipt-before-recalculation and safe
rollback errors. The SDK pagination regression was rerun and passed, not skipped.

The local HTTP fixture independently reproduces finalized profit10.00, a single
qualifying R sample and1.00% of a10%-of10000 profit target. Browser append records
current custom progress10 after the prior5 (not15), then edit/archive retains both
events. Browser goal creation and prop edits use the same receipts/audits/versions.
All26 MCP checks finish with zero uncaught browser errors; disposable fixture
users, clients and custom events are cleaned up. Runtime: Node25.1.0, Python3.13.2,
Next16.3.6, official MCP SDK2.3.1 and Chrome154.0.8037.93.

The first Docker reset was interrupted. Recovery now verifies every existing
local user/account/trade/grant/source/audit table is empty, including shared
application receipts, while tolerating tables not yet recreated by the interrupted
reset. A bounded300-second CLI allowance and stage/SQLSTATE-only diagnostics keep
private configuration suppressed. The final full replay passes; no hosted reset
or deletion occurred. Node's existing typeless-module/SDK JSON-notification
warnings are not hidden or reported as browser errors.

## Release gates and remaining work

This migration and the previous new journal migration are local-only: no hosted
rollout approval is inferred from approval of the earlier six prerequisites.
The read-only deployment manifest now requires18 functions and11 version/order
columns. `build:verified` blocks deployment until the target schema is ready;
it never applies migrations automatically. No master merge, collector change,
broker order, model invocation or AI-provider credential was used.

Still pending: tags/instrument CRUD, computed journals, analytics/calendar and
filtered exports, private screenshot workflows, MT5/import access, profile,
one-use deletion approval, stdio and actual Codex/Claude/Gemini/ChatGPT client
verification. SDK/browser checks are not real-client certification. Versions
previously inspected were Codex0.147.0, Claude Code2.1.119 and Gemini CLI0.57.0;
their authorized tool calls remain pending.
