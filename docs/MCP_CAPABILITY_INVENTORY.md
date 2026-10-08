# MCP capability inventory v1

Prepared 2026-10-07 from master `9e3a803` on `feature/mcp-access`.
Updated 2026-10-08: stateless HTTP, five contract resources and 27 tools are
implemented. Account adjustments/classification, snapshots/lifecycle, canonical
trades/targets/management/corrections/reviews and read-only trade instruments now
join account metadata/balances and strategy/setup/rule workflows. Browser actions
use the same typed services and private transactions. See
[account-event and trade verification](MCP_ACCOUNT_EVENTS_TRADES_VERIFICATION.md).

Hosted MCP stays disabled. Goals, prop configuration, journals, analytics/exports,
tags, remaining instrument CRUD, screenshots/file access, MT5/import reads,
profile settings, permanent deletion, local stdio and external clients remain
pending. The completed workflow family is not full MCP readiness.

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
| instruments.list/get/create/patch/archive/delete | reference instruments; trade-form references | Instrument ownership and specifications | Keep global references read-only; explicit user-owned instruments |
| tags.list/create/patch/delete/assign/remove | journal saveTag/assignTag/removeTag | tagSchema; normalized DB uniqueness | Case-insensitive per-owner uniqueness and trade ownership |
| goals.list/get/create/patch/archive/delete | progress createGoal; getProgressDataset | Goal schema and progress/metrics | Referenced progress preserved; automatic/custom distinctions |
| goals.progress.list/record | progress recordCustomGoalProgress | Existing append-only goal-progress RPC | Automatic goals reject manual progress; exact decimal values |
| prop.get/patch/progress | progress savePropConfig; getProgressDataset | Prop schema and progress/metrics | Trading-day zone, account eligibility, cash-neutral drawdown |
| trades.list/get/create/patch | saveManualTrade; getManualTradeRecord; getTradeJournalDataset | tradeSchema; financials; lifecycle/protected-plan RPCs | Canonical identity, ownership, open-plan locks, no broker-fact overwrite |
| trades.open/close/cancel | Lifecycle work inside saveManualTrade | Canonical lifecycle and normalized finalized money | Closed-at attribution, no early realized PnL, terminal-state guards |
| trades.targets.replace/record_execution | Target workflows inside saveManualTrade | tradeTargetSchema; atomic target RPCs | Planned targets protected after open; actual management distinct |
| trades.management.list/record | Execution/management workflows inside trade action | Existing execution facts and targets | Separate history from planned-value correction |
| trades.plan.correct/history | correctTradePlanValue; plan-correction panel | Protected plan correction RPC | Reason, original evidence, atomic append/current update and concurrency |
| trades.reviews.execution.save/complete | saveManualTrade execution section | executionReviewSchema; review RPC | Nullable unanswered values and explicit completion |
| trades.reviews.psychology.save/complete | saveManualTrade psychology section | psychologyReviewSchema; review RPC | Reviewed false differs from unanswered |
| trades.reviews.rules.complete/history | saveManualTrade rule section | tradeRuleResultSchema; immutable applicable-rule RPC | Exact applicable IDs/snapshots, completeness and violations |
| trades.reviews.post_trade.save | saveManualTrade review section | tradeReviewSchema | Five canonical grades retained; account/trade ownership |
| journal.daily.get/save | daily page; saveDailyLog | dailyLogSchema; journalDate | opened_at then planned_at then created_at; no closed_at substitution |
| journal.weekly.get/save | weekly page; saveWeeklyReview | weeklyReviewSchema; journal/periods | Explicit account, week and owner; deterministic summaries |
| journal.monthly.get/save | monthly page; saveMonthlyReview | monthlyReviewSchema; journal/periods | Explicit account/month; preserved persisted review fields |
| analytics.performance/query/calendar | getPerformanceAnalytics; getTradeJournalDataset; calendar page | analytics/performance; journal/analytics | Closed-only results, R sample sizes, mixed-currency monetary separation |
| analytics.behavior/query | getBehaviorAnalytics | analytics/behavior | Reviewed cohorts only, descriptive associations and sample sizes |
| journal.export | trades/export route; matchesJournalFilters | CSV escaping and canonical fields | Same filter semantics; all matching records, CSV formula safety |
| calculator.position_size | Public calculator component | trading/position-sizing; instrument specifications | Verified figures, precision/volume steps, anonymous calculator preserved |
| screenshots.list/upload_request/upload_finish/download/delete | screenshot-uploader; screenshot metadata | screenshotMetadataSchema; private storage ownership | Bounded content/type/size, controlled object IDs, deletion confirmation |
| integrations.mt5.list/get/preview/review | onboarding, review, symbol-mapping, cash-onboarding services | Existing MT5 domain and private workflows | MCP actor path without browser impersonation; original grant boundaries |
| integrations.imports.list/get | getImportOverview | imports/provenance; CSV mapping/staging | User/account isolation, errors and unresolved rows exposed honestly |
| settings.profile.get/patch | saveProfileSettings | profileSettingsSchema | Display name/timezone only; no credentials or auth administration |
| operations.get | getIntegrationOperation | Existing operation receipt authorization | Exact operation/purpose/owner binding; unknown retry guidance |

Existing read services accept a browser-authenticated Supabase client. Add verified
actor-aware private reads for MCP; an OAuth client must not gain direct table
access to make these old services work. Preserve each domain algorithm while
separating the data loader from deterministic calculations.

Some requested CRUD operations do not have an existing UI adapter (for example
instrument editing, goal editing and configuration deletion). Implement explicit
domain workflows and archive policy for these; do not claim a wrapper exists.

## Resources and workflow guidance

- `tradeos://v1/catalog`: versioned capabilities, implemented status and schemas.
- `tradeos://v1/domain`: relationships, canonical identifiers and enumerations.
- `tradeos://v1/money`: decimal strings, per-account currency precision, final
  normalization and exact-zero outcome classification.
- `tradeos://v1/workflows`: lifecycle, management versus correction, explicit review
  completion, conflict review and archive/deletion rules.
- `tradeos://v1/reporting`: journal versus realized dates, decisive win-rate
  denominator, break-even rate, R qualification and mixed-currency aggregation.

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
