# MCP capability inventory v1

Prepared 2026-10-07 from master `9e3a803` on `feature/mcp-access`.
Updated 2026-10-09: stateless HTTP, seven contract resources and 80 tools are
implemented. Goals, custom evidence, prop configuration and exact account progress
now share services with the browser, alongside daily/weekly/monthly reflections.
Computed journal summaries, performance/behavior analytics, the realized calendar
and complete filtered CSV export now share validated, owner-scoped services.
Snapshot-aware balance-curve paging now exposes bounded, currency-separated
events with explicit R samples. See [curve verification](MCP_BALANCE_CURVE_VERIFICATION.md).
Self-profile get/patch now shares audited/versioned services with the Settings
form. Hosted profile prerequisites are installed and verified; authenticated
deployment/client verification remains pending. See
[profile verification](MCP_PROFILE_VERIFICATION.md).
Account adjustments/classification, snapshots/lifecycle, canonical
trades/targets/management/corrections/reviews and read-only trade instruments now
join account metadata/balances and strategy/setup/rule workflows. Browser actions
use the same typed services and private transactions. See
[account-event and trade verification](MCP_ACCOUNT_EVENTS_TRADES_VERIFICATION.md).

Owned tag/instrument list/get/create/patch/archive and trade-tag list/assign/remove
now share audited, versioned services with browser tag forms. Global instruments
remain read-only, and referenced specifications are protected. See
[reference verification](MCP_REFERENCES_VERIFICATION.md).

See [reporting verification](MCP_REPORTING_VERIFICATION.md) for date boundaries,
review qualification, exact monetary fixtures and complete export evidence.

MT5 health, complete-history preview, broker revisions, exact manual-match
fingerprints, explicit SOURCE/DISTINCT/LINK/REOPEN/CASH review and import batch/row
reads now reuse the existing MT5 domain and authoritative private workflows.
See [integration-access verification](MCP_INTEGRATION_ACCESS_VERIFICATION.md).

The remaining eight MT5 workflow tools now reuse existing mapping, cash,
publication, approval, policy and fencing implementations. Local unit/database,
real-provider/SDK and browser verification passes. See
[workflow verification](MCP_MT5_WORKFLOW_VERIFICATION.md).

Hosted MCP stays disabled. This increment's approved hosted prerequisites pass
with 54 unchanged application table fingerprints. Screenshot metadata and controlled
private transfers are now implemented; see [private-file verification](MCP_PRIVATE_FILES_VERIFICATION.md).
Reference/configuration/file permanent deletion, local stdio and external clients
remain pending. This is not full MCP
readiness. Balance-curve events,
self-profile preferences and position sizing are already implemented.

## Shared service boundary

The current browser actions own much of the application persistence. MCP must
extract typed commands into application services, leaving the existing actions
as FormData/redirect/revalidation adapters. Do not invoke browser actions with
fabricated FormData, impersonate browser claims, or relax the existing OAuth
table isolation. Both adapters must use the same validated command and domain
calculations; private transactional workflows authorize their verified actor.

Every write requires operationId and an expected record version where updating
existing state. Store the canonical request hash, result and audit atomically.
Decimal quantities are strings. UTC instants and calendar date keys are distinct.
Omission leaves a field unchanged; null clears only an explicitly nullable field.
Lists need stable bounded pagination; export exhausts all matching pages.

## Workflow mapping

Names below describe capability families. Strategy/setup/rule list/get/create/
patch/archive are implemented through the configuration tools; their permanent
deletion actions are not exposed yet. Other rows remain proposed unless named
as implemented above. Every new operation needs service, schema, authorization,
database and protocol evidence before entering the catalog.

| Tool family / operations | Existing adapter or read service | Validation / domain authority | Required evidence |
| --- | --- | --- | --- |
| accounts.list/get/create/patch | accounts actions; get-account-balances; get-account-ledger | tradingAccountSchema; accounts/balance | Owner isolation, precision, baseline edits, versions and retry |
| accounts.snapshots.list/record | progress recordAccountSnapshot | Snapshot schema in progress actions; explicit balance/equity relationship | No snapshot replacement of authoritative balance; exact money |
| accounts.adjustments.list/create/classify | journal createAccountAdjustment/classifyAccountAdjustment | accountAdjustmentSchema; adjustmentClassificationSchema; existing classification RPC | Fixed types neutral, OTHER explicit, immutable reclassification |
| accounts.lifecycle.transition/create_funded_link | progress transitionAccountStatus/createLinkedFundedAccount | Existing lifecycle RPC and prop domain | History, reason, valid transitions and exact challenge link |
| strategies.list/get/create/patch/archive/delete | strategies saveStrategy | strategySchema | Setup relationship, referenced archive, one-use unused deletion |
| setups.list/get/create/patch/archive/delete | strategies saveSetup | setupSchema | Parent ownership, names/IDs, references and archive |
| rules.list/get/create/patch/archive/delete | rules saveTradingRule | tradingRuleSchema | Historical review snapshots never change |
| instruments.list/get/create/patch/archive (implemented; delete pending) | application/references; trade-form references | references/commands and database specification guards | Global read-only; owner isolation; exact pip precision; referenced specifications/history preserved |
| tags.list/get/create/patch/archive and trade-tags.list/assign/remove (implemented; delete pending) | journal saveTag/assignTag/removeTag; application/references | references/commands; normalized DB uniqueness | Case-insensitive per-owner names; both trade/tag versions; receipts/audits and historical archival |
| goals.list/get/create/patch/archive (implemented; permanent delete pending) | progress createGoal/patchGoal/archiveGoal; application/progress | progress/commands and private progress workflows | Ownership, retries, optimistic versions, preserve referenced evidence |
| goals.progress.list/record (implemented) | progress recordCustomGoalProgress; application/progress | Append-only private workflow; decimal/UTC schemas | Automatic goals reject manual evidence; latest current value, not summed increments |
| prop.get/save/progress (implemented) | progress savePropConfig; application/progress | progress/commands, progress/dataset, private exact loader | Account eligibility; complete optional groups; cash-free profit, cash-neutral analytics drawdown; unsupported firm mechanics unavailable |
| trades.list/get/create/patch | saveManualTrade; getManualTradeRecord; getTradeJournalDataset | tradeSchema; financials; lifecycle/protected-plan RPCs | Canonical identity, ownership, open-plan locks, no broker-fact overwrite |
| trades.open/close/cancel | Lifecycle work inside saveManualTrade | Canonical lifecycle and normalized finalized money | Closed-at attribution, no early realized PnL, terminal-state guards |
| trades.targets.replace/record_execution | Target workflows inside saveManualTrade | tradeTargetSchema; atomic target RPCs | Planned targets protected after open; actual management distinct |
| trades.management.list/record | Execution/management workflows inside trade action | Existing execution facts and targets | Separate history from planned-value correction |
| trades.plan.correct/history | correctTradePlanValue; plan-correction panel | Protected plan correction RPC | Reason, original evidence, atomic append/current update and concurrency |
| trades.reviews.execution.save/complete | saveManualTrade execution section | executionReviewSchema; review RPC | Nullable unanswered values and explicit completion |
| trades.reviews.psychology.save/complete | saveManualTrade psychology section | psychologyReviewSchema; review RPC | Reviewed false differs from unanswered |
| trades.reviews.rules.complete/history | saveManualTrade rule section | tradeRuleResultSchema; immutable applicable-rule RPC | Exact applicable IDs/snapshots, completeness and violations |
| trades.reviews.post_trade.save | saveManualTrade review section | tradeReviewSchema | Five canonical grades retained; account/trade ownership |
| journal.daily.get/save/summary (implemented) | daily page; saveDailyLog; application/reporting | dailyLogSchema; journalDate; reporting/commands | Decision-date membership is separate from closed-at realized summary; exact account-period balances |
| journal.weekly.get/save/summary (implemented) | weekly page; saveWeeklyReview; application/reporting | weeklyReviewSchema; journal/periods; reporting/commands | Monday start, explicit owner/account and qualifying R/review samples |
| journal.monthly.get/save/summary (implemented) | monthly page; saveMonthlyReview; application/reporting | monthlyReviewSchema; journal/periods; reporting/commands | Day-one start, persisted reflection unchanged by read-only summary |
| analytics.performance/query/calendar/balance_curve (implemented) | getPerformanceAnalytics; getTradeJournalDataset; application/reporting | analytics/performance; reporting/commands/results/balance-curve | Closed-only results, full ledger independent of trading dimensions, cash-neutral drawdown, currency separation, incomplete-data states, bounded snapshot-aware continuation and fresh authorization |
| analytics.behavior/query (implemented) | getBehaviorAnalytics; application/reporting | analytics/behavior; reporting/evidence/results | Explicitly reviewed cohorts, exact immutable rule IDs, unanswered exclusion and descriptive sample-qualified associations |
| journal.export (implemented) | trades/export route; application/reporting; reporting/export | Shared matchesJournalFilters, CSV escaping and canonical fields | Same active filters; all matching records beyond 1,000, string broker IDs and formula-safe free text |
| calculator.position_size (implemented) | Public calculator component and MCP pure-domain adapter | trading/position-sizing; instrument specifications | Verified figures, precision/volume steps, anonymous calculator preserved |
| screenshots.list/get/upload_request/upload_status/upload_chunk/upload_finish/download (implemented; delete pending) | application/files; files/storage and content; existing screenshot browser | files/commands; private reservation/chunk/finish transactions | Exact owned objects; full byte/hash/type/pixel validation; retries/audits/version/revocation; no signed URLs or arbitrary paths |
| integrations.mt5.list/get/preview/sources/matches/review (implemented) | application/integrations; shared mt5/snapshot and prepare-review; existing browser adapters | Existing reconstruction/finance, SOURCE/DISTINCT/LINK/REOPEN/CASH review, private transactional writer | Actual MCP actor; separate active collector grant for writes; full bridge before bounded paging; history, exact tokens, retries and stale rejection |
| integrations.imports.list/get/rows (implemented) | application/integrations; existing import staging tables | Private owner-derived read, wire decimal/ID strings | User/account isolation; paging; failed batches and unresolved rows retained; no import activation |
| integrations.mt5.grants/map_account/symbol_map/cash_classify/publish/onboarding_approve/publication_policy/control (implemented; hosted prerequisites verified) | application/integrations; existing shared private/browser workflows | mt5/workflow-commands and existing cash/publication/onboarding/fencing algorithms | Explicit schemas, actual MCP receipts/audits, two-grant authority, source/ledger/version, no baseline double-count, approval before policy, fenced control and real local protocol/browser regression |
| settings.profile.get/patch (implemented; hosted prerequisites installed) | saveProfileSettings; application/profile | profile/commands; private profile workflows | Self only, display name/timezone only; omitted/null, exact versions, atomic audit/retry, stale browser edits and revocation; no auth administration |
| operations.get | getIntegrationOperation | Existing operation receipt authorization | Exact operation/purpose/owner binding; unknown retry guidance |

Existing read services accept a browser-authenticated Supabase client. Add verified
actor-aware private reads for MCP; an OAuth client must not gain direct table
access to make these old services work. Preserve each domain algorithm while
separating the data loader from deterministic calculations.

Some requested CRUD operations do not have an existing UI adapter (for example
instrument editing and configuration deletion). Implement explicit
domain workflows and archive policy for these; do not claim a wrapper exists.

## Resources and workflow guidance

The five read-only reporting tools are `tradeos_journal_summary`,
`tradeos_analytics_performance`, `tradeos_analytics_behavior`, `tradeos_calendar`
and `tradeos_journal_export`. All load one repeatable-read snapshot through a
fixed private function after fresh actor/grant validation. Inputs cannot supply
owner IDs, SQL or arbitrary table names. Account selection scopes financial
facts while retaining all owned account choices for browser filter controls.
Aggregate analytics omit event-curve points. `tradeos_analytics_balance_curve`
accepts a required currencyCode, account/accountType/from/to, optional timezone,
pageSize (1–100) and cursor. Return nextCursor unchanged with the same scope;
CURVE_CHANGED requires restarting. Every page freshly checks authorization and
calculates full-history financial bases. CSV exhausts the filtered dataset, not
a visible page. See [curve contract and limitations](MCP_BALANCE_CURVE_VERIFICATION.md).

Reference tools are `tradeos_references_list/get/create/patch/archive`, with
`entity: TAG | INSTRUMENT`, plus `tradeos_trade_tags_list/assign/remove`.
Patch/archive use the reference's string `record_version`. Association changes
require both `expectedVersion` from the trade and `expectedTagVersion` from the
tag; use returned `tradeVersion` before another trade edit. The domain resource
documents global read-only access, protected specifications and historical archive
behavior. None of these tools permanently deletes a reference.

The ten goal/prop tools are `tradeos_goals_get/list/create/patch/archive`,
`tradeos_goal_progress_list/record`, `tradeos_prop_get/save` and
`tradeos_progress_get` (each slash-delimited name denotes separate tools).
Progress uses a typed output schema, a repeatable-read snapshot and complete
account history, without the old Data API row cap. R samples and incomplete
closed results are explicit. Small positive days below a firm threshold are
not break-even. Loss-rule handling of cash movements is not inferred from
generic account analytics: buffers remain unavailable until that firm policy
is modeled. See [goal/prop verification](MCP_GOALS_PROP_VERIFICATION.md).

- `tradeos://v1/catalog`: versioned capabilities, implemented status and schemas.
- `tradeos://v1/domain`: relationships, canonical identifiers and enumerations.
- `tradeos://v1/money`: decimal strings, per-account currency precision, final
  normalization and exact-zero outcome classification.
- `tradeos://v1/workflows`: lifecycle, management versus correction, explicit review
  completion, conflict review and archive/deletion rules.
- `tradeos://v1/reporting`: journal versus realized dates, decisive win-rate
  denominator, break-even rate, R qualification and mixed-currency aggregation.
- `tradeos://v1/integrations`: owned health/provenance, complete-source previews,
  explicit review kinds, separate MCP/collector grants and approved workflow controls.
- `tradeos://v1/files`: exact upload intent, 384 KiB chunks, status/version/retry
  flow, full image validation, bounded downloads and explicit legacy integrity.

Authenticated resources must not return other owners' data. Public discovery and
generic schemas may be public; no user records are included in discovery.

## Deletion and transport gates

One-use browser confirmation must bind entity type, exact ID, version, owner and
expiry. Referenced configuration archives; audit/correction/financial histories
are never deletable. Screenshots use controlled storage objects and metadata.
No arbitrary SQL, file paths, URLs, shell commands or broker execution tools.

Use the official SDK for stateless Streamable HTTP at `/mcp` and local stdio.
Both call the same authenticated application commands. Every request verifies
signature, issuer, expiry, resource audience and live grant. Transport/protocol
tests cover discovery, challenges, schemas, paging, operation lookup, refresh,
revocation and concurrent clients. Real client matrix remains Codex, Claude Code,
ChatGPT, Claude remote and Gemini CLI; unavailable clients remain pending.
