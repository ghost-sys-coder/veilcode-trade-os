# Trade OS: MT5 Synchronization and MCP Access

Status: approved implementation plan; delivery started on 2026-10-05.
Original baseline: clean `master` at `412da1c`. Two feature branches, in addition to
`master`: `feature/mt5-sync` and `feature/mcp-access`.

## Authority and boundaries

The user-approved integration plan extends, rather than replaces,
`PROJECT_CONTRACT.md`, `ARCHITECTURE.md`, `DATABASE.md`, `TRADING_METRICS.md`,
and `FUTURE_IMPORTS.md`. Preserve canonical trades, decimal/string money
boundaries, exact-zero final outcomes, protected plans, explicit behavioral
review completion, historical rule snapshots, ownership and audit history.

- MT5 first, with dedicated terminals and workers per approved account.
- Default onboarding: all available broker history plus current positions,
  previewed and approved per account.
- Netting positions use directional episodes; referenced configuration is
  archived rather than cascade-deleted.
- MCP supplies local stdio and authenticated remote Streamable HTTP access.
- No model API calls/credentials, paid bridge APIs, paid infrastructure
  purchase, automatic live-account activation or broker execution.
- Existing manual/Claude-connected MT5 installations remain untouched.
- A future Windows VPS must use the same interfaces and fenced collector
  leases; provisioning it is outside this build.

## Branch ownership and delivery sequence

1. Create `feature/mt5-sync` from the baseline and commit all three plan files.
2. Create `feature/mcp-access` from that documentation commit and park it.
3. Implement shared integration foundations and MT5 only on the MT5 branch.
4. Merge MT5 only after its required correctness/security gates and focused
   demo-terminal interruption checks. On 2026-10-05 the user removed the mandatory
   48-hour soak wait to prioritize same-day MT5 and MCP delivery.
5. Update the MCP branch from the validated `master`, then implement MCP.
6. Validate MCP independently before its merge. No third foundation branch,
   duplicated foundation implementation or premature MCP feature work.

## Shared foundation

Extract the account, trade, financial-finalization, correction and import
workflows needed by MT5 into typed application services. UI actions retain
form parsing, navigation and revalidation; deterministic calculations stay
in domain modules. MCP later extends this service boundary to other features.

Services receive a verified actor context; caller-supplied owner IDs are not
authorization. Add versioned JSON endpoints under `/api/integrations/v1`:
decimal values and broker IDs are strings, instants are UTC, and inputs are
validated with Zod. Keep database ownership checks, constraints and private
transactional RPCs authoritative.

Mutation operation IDs, request hashes and results are durable and atomic
with their effects. Identical retries return the original result; changed
payloads using the same ID are rejected. Use optimistic concurrency and
append-only mutation audits containing actor, client, operation, record IDs
and changes, never secrets.

Use existing Supabase Auth for browser consent and renewable integration
sessions. Add account-bound MT5 grants and full authorized MCP grants, with
immediate application-level revocation checks. OAuth scopes alone do not
restrict database access: grants, RLS and RPC checks must enforce it.

## Milestones and release gates

| ID | Deliverable | Gate | Initial status |
| --- | --- | --- | --- |
| MT5-0 | Documentation, branches, authentication compatibility | PKCE, refresh, intended-resource binding, revocation and login compatibility | Passed locally and hosted: real S256, signed resource binding, refresh, revocation and same-grant reconnect; browser-only logout isolation verified with the real local provider |
| MT5-1 | Shared services and transactional import storage | Owner isolation, RLS, atomicity, replay and concurrency tests | In progress: durable source capture, receipts, audits and fenced leases verified; canonical shared workflows pending |
| MT5-2 | Broker reconstruction and financial attribution | Hand-calculated fixtures and migration compatibility | In progress: deterministic episodes/finance fixtures and migrations pass locally; source-backed manual canonical publication verified; automatic publication and reviewed-source resolution pending |
| MT5-3 | Python collector and Windows recovery | Fault injection, account isolation, durable outbox and fencing | In progress: protected PKCE/refresh credentials and supervised upload verified against local API; native process containment and coordinator scheduling fixture-tested; operator CLI, callback listener and startup registration implemented; actual startup invocation and terminals pending |
| MT5-4 | Onboarding, reconciliation and monitoring | Browser verification and controlled demo pilot | In progress: account/symbol mapping, explicit cash attribution, captured-history snapshot approval, balance bridge, monitoring, fenced controls and publication pass local browser checks; source/manual financial-conflict resolution and real demo pilot pending |
| MT5-5 | Operational readiness | Full checks plus focused multi-account demo interruption tests; extended soak deferred | Not started |
| MCP-1 | Remaining shared workflows and capability inventory | Each existing feature mapped to a tested service/tool | In progress: 80 HTTP tools / seven resources cover accounts/events/lifecycle, trades/reviews, configuration, journals, progress, references/tags, reporting/export, snapshot-aware balance curves, profile, MT5/import reads/review plus mapping/cash/publication/approval/policy/control and controlled screenshot metadata/upload/download. Permanent deletion remains pending; see MCP_CAPABILITY_INVENTORY.md and MCP_PRIVATE_FILES_VERIFICATION.md |
| MCP-2 | Local/remote transport and consent | Protocol, resource authorization and revocation tests | In progress: official SDK stateless HTTP and real local browser consent/S256/refresh/resource binding/revocation pass; local stdio and hosted activation pending |
| MCP-3 | Client verification and readiness | Required client matrix plus regression checks | In progress: modern/legacy SDK and existing browser regression pass; requested real external clients pending |

Authentication is an early hard gate. Verify the configured provider's
discovery, PKCE S256, renewable tokens, resource binding, revocation and
existing login compatibility before broker persistence. Supabase OAuth is
beta: a failed gate requires a plan revision, not weaker authentication.
Do not treat advertised capabilities as proof of an end-to-end flow.

## Verification policy

Latest increment: source-backed cash attribution and captured-history approval
are implemented with immutable evidence and transactional receipts/audits.
Opening funding is provenance rather than a second deposit; an existing manual
cash record can be explicitly linked. Unsupported credit facilities and revised
financial facts remain held for reconciliation. Approval is bound to source,
ledger and capture checkpoint, and becomes stale on changed evidence; it does
not authorize unattended canonical updates. See
[cash/onboarding verification](MT5_CASH_ONBOARDING_VERIFICATION.md).

Use deterministic fixtures, disposable databases and controlled demo
terminals. Never create broker orders or destructively test production
accounts. Extend the database-test runner to execute the new suites.

At each branch completion run `npm test`, `npm run test:db`,
`npm run typecheck`, `npm run lint`, and `npm run build`. Add Python tests and
static checks, MCP protocol tests, browser tests and real-client checks.
Missing Windows/client verification is pending, not passed.

Reports record exact commands/results, fixture calculations, client
versions, limitations and blockers. The originally required 48-hour multi-account
demo soak is now deferred by explicit user instruction, not recorded as passed.
Use focused recovery and real-demo interruption checks for the expedited gate.
Security, monetary accuracy, isolation and regression gates remain required;
same-day delivery is a priority, not a claim that unfinished capabilities are ready.
Separate enablement
flags keep integrations off until approved rollout; disabling one stops
new activity but preserves persisted facts, provenance and audits.

See [MT5 plan](MT5_INTEGRATION_PLAN.md) and [MCP plan](MCP_INTEGRATION_PLAN.md).

## Sources

- [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- [Supabase token security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)

## Progress log

- 2026-10-09: at the user's request to complete one group at a time, implemented
  the remaining eight overlapping MT5 workflow adapters, reusing existing cores.
  Catalog is now 73 tools/six resources. Local 884 unit tests, 984 database
  assertions, 51 full MCP checks, 65 browser checks and 176 Python tests pass,
  with static checks/build and schema replay. After user approval, installed the
  exact hosted migration, aligned its new history entry to `20261009010947` and
  verified 54 unchanged application table fingerprints, eleven private function
  gates and the 30-function/14-column hosted verified build. MCP stays disabled;
  no real collector or hosted data changed. See
  [workflow verification](MCP_MT5_WORKFLOW_VERIFICATION.md).

- 2026-10-09: on the user's requested push/completion outline, installed only
  the tested integration-access private migration on the identified hosted
  VeilCode Studio project. All 12 protected data fingerprints match; permissions,
  27-function/14-column hosted guard and `build:verified` pass. MCP remains
  disabled and MT5 state unchanged. Added
  [the six-part completion checklist](MCP_COMPLETION_CHECKLIST.md), explicitly
  separating pending MCP capabilities/client rollout from the accepted MT5
  single-demo implementation and its deferred broader operational checks.

- 2026-10-09: verified the latest branch/remote source before implementation,
  then fast-forwarded the existing MCP branch to merged master `6c7a0b7`.
  Added only the missing nine MCP MT5/import access tools and sixth resource.
  Existing canonical reconstruction, central decimal finance, browser review and
  private transactional writer are shared, not duplicated. New migration
  `20261009001418` is tested/applied only to disposable local Supabase; hosted
  schema, enablement and collector state are unchanged. Controls, first-time
  mappings, onboarding/publication approvals, files, destructive confirmations,
  stdio and real external clients remain separate unfinished gates. See
  [integration-access evidence](MCP_INTEGRATION_ACCESS_VERIFICATION.md).

- 2026-10-09: after explicit user approval, installed the tested additive profile
  migration on the correct hosted Trade OS project and aligned only its new
  history entry to canonical version `20261008220311`. Existing profile fields,
  accounts/trades/adjustments, grants/resources, MT5 facts/control and audits have
  identical before/after hashes. Private-function access/version/RLS checks and
  hosted `build:verified` (24 functions /14 bigint columns) pass. Pushed profile
  source `e241586` on the requested feature branch; exact-commit Vercel inspection
  confirms its Preview deployment is READY. No master merge, Production promotion,
  real-user preference change or integration enablement. See
  [profile rollout evidence](MCP_PROFILE_VERIFICATION.md).

- 2026-10-09: at the user's request, committed/pushed the verified balance-curve
  increment as `b8f13b7` on the existing MCP branch; its Git-created Vercel Preview
  is READY. Continued with self-profile preferences, two typed HTTP tools (56
  total), shared Settings adapters, exact optimistic versions and transactional
  receipts/audits. The additive profile migration is installed only on disposable
  local Supabase; hosted approval/release remains pending. No master merge,
  Production promotion or hosted integration-control change by the agent. See
  [profile verification](MCP_PROFILE_VERIFICATION.md).

- 2026-10-09: fast-forwarded the existing MCP branch from the user's merged
  master `3a8bef2`. Added `tradeos_analytics_balance_curve` (54 HTTP tools),
  currency-separated bounded pages, fresh authorization and a full-series
  content fingerprint that rejects stale continuation. Shared curve fixes
  preserve local civil-date openings, microsecond event order and per-account
  adjustment precision, and exclude future account funding from earlier periods.
  No new migration, deployment or integration-control changes. Verification
  evidence and remaining client/capability gates are recorded in
  [curve verification](MCP_BALANCE_CURVE_VERIFICATION.md).

- 2026-10-09: after user approval, added only the verified pooler host/port and
  public CA to `feature/mcp-access` Preview; production settings/credentials
  remained unchanged. Rebuilt pushed reporting commit `e09ca3f` to READY and
  passed 14 distinct hosted read-only browser checks using normal user sign-in.
  The mapped account's current label is USD100K FTMO ACCOUNT; immutable-ID lookup
  verified twenty closed trades, USD2032.53 profit and USD102032.53 balance.
  Complete CSV, journal/calendar and behavior reads pass. Before/after financial,
  grant and connection hashes are identical. Read-only inspection found the
  user's independent PR #18 merge at master `02565eb` serving the production
  domain with a READY build. The agent did not merge/promote Production.
  MCP remains disabled; remaining capabilities/client gates are pending. See
  [reporting evidence](MCP_REPORTING_VERIFICATION.md).

- 2026-10-08: verified the user's merged master at `425b1a5` and fast-forwarded
  the existing MCP branch. Added five shared reporting tools and exact schemas,
  owner-scoped complete history reads and the shared browser/MCP CSV builder.
  Corrected incomplete rule-review qualification, unanswered behavioral cohorts,
  account-filter choices, dimension-independent ledgers and incomplete-result
  balance/drawdown states. Local security, financial, real OAuth/browser and
  regression gates pass. After user approval, the private read-only reporting
  migration was installed on the correct hosted project; prerequisites and
  `build:verified` pass. Account/trade/adjustment and integration-control hashes
  are unchanged. No collector or integration enablement changed. Local stdio,
  remaining capability families and external-client verification remain pending.
  See [reporting evidence](MCP_REPORTING_VERIFICATION.md).

- 2026-10-08: merged the latest verified MT5 fix/evidence to master `32306e5`
  and updated the existing MCP branch. Added the official SDK2.3.1 stateless
  HTTP foundation, MCP resource discovery/challenge, five contract resources,
  capabilities/decimal position sizing/operation lookup. Legacy and current
  protocol tests pass. Verified 493 application tests, 53 browser/provider/API
  regressions, typecheck, lint and build; production dependency audit is clean
  after compatible patches. Eight unpatched development glob-tool notices
  remain documented. MCP stays disabled in production. Typed CRUD, local stdio,
  actual MCP consent and the external client matrix remain pending. See
  [MCP foundation evidence](MCP_FOUNDATION_VERIFICATION.md).

- 2026-10-08: user approved the current snapshot and enabled automatic publication
  for USD100K DEMO. The bounded dedicated-terminal capture passed on the hosted
  path, advanced checkpoint to 2026-10-07T21:20:56.220Z, and preserved 20 unique
  trades / 20 execution versions / USD +2032.53 with zero adjustments, holds or
  incomplete collections. Collector ended PAUSED with no attention and zero
  pending uploads; its verified scheduler task was restored. Automatic changed
  execution and conflict review pass local fixture/browser checks; actual unchanged
  history was verified without creating orders. The three requested final MT5
  capabilities are cleared for this focused demo rollout. Remaining native reboot,
  extra-terminal and monitoring limitations are documented rather than passed.
  MCP continues from the merged foundation.

- 2026-10-07: commit `690c3f7` pushed; the automatic-publication/review migration
  applied to the correct hosted project. The READY Vercel build was smoke-tested
  and promoted to the production site. Hosted ledger remains 20 trades and
  USD +2032.53; policy initially off. Browser-control infrastructure is unavailable,
  so the user received the existing-account link for normal snapshot/policy
  activation. Collector readback remains PAUSED with zero pending uploads. The
  final bounded hosted capture is pending; no MT5 merge or MCP activation yet.

- 2026-10-07: implemented explicit account-specific automatic publication with
  transactional capture/receipts, immutable broker-source review, manual
  distinct/link/withdrawal decisions and revised-cash delta reconciliation.
  Verified 485 application tests, 501 database assertions, 52 browser/provider/API
  checks and 176 Python tests, plus typecheck, lint and production build. The local
  Supabase permission-error hint extension crashes; unchanged security assertions
  pass with diagnostic hints temporarily disabled and restored. Installed the
  dedicated demo Windows startup task and verified automatic recovery after
  coordinator termination; PAUSED intent and zero pending uploads survived.
  Hosted rollout/final capture and broader operational limitations remain pending.
  See [verification](MT5_AUTOMATIC_REVIEW_VERIFICATION.md). MCP remains parked.

- 2026-10-06: same-grant reconnect fix `d95be83` pushed and deployed. The actual
  USD100K DEMO credential reconnected without revocation or new account selection,
  preserving grant version 2, mapping version 1 and five grant audit events.
  Hosted security/refresh checks pass. Verified 453 application tests, all 10
  database suites, 46 real local browser/provider checks and 167 Python tests,
  plus typecheck, lint and build. First actual dedicated-terminal snapshot durably
  staged 86 source facts with zero pending uploads and matching checkpoints.
  Collector stays PAUSED; no canonical trades/adjustments published or opening
  baseline changed. Source-backed preview/publication and operational interruption
  gates remain pending; MCP stays parked. See
  [reconnect verification](MT5_RECONNECT_VERIFICATION.md).

- 2026-10-05: precision/runtime checkpoint `464b0d4` committed and pushed.
  Implemented explicit broker-symbol approval, typed current mappings, append-only
  correction chains, source/version checks and durable atomic receipts. Approved
  aliases publish into canonical instruments while retaining raw broker identities;
  manual overlaps remain held and published symbols cannot be reassigned. Verified
  354 application tests, 387 database assertions (9 suites), 41 browser/provider/API
  checks and 167 Python tests, plus typecheck, lint, build and local SQL/security
  checks. All 29 migrations replay with no schema diff. No hosted migration,
  existing terminal change, merge or MCP implementation. Cash classification,
  full onboarding approval, automated publication and real-demo pilot remain
  pending. See [symbol-mapping verification](MT5_SYMBOL_MAPPING_VERIFICATION.md).
- 2026-10-05: publication checkpoint `ab0919e` pushed successfully. Subsequent review
  aligned MT5 identity and final-PnL persistence with the account's 0..20 configured
  precision contract; legacy typmod regression reproduced and corrected. All 28
  local migrations replay with no schema diff. Latest checks: 347 application tests,
  346 database assertions, 40 browser/provider/API checks and 167 Python tests in
  both base and isolated SDK runtimes. Prepared official pinned SDK/NumPy on D:
  without shared-Python or terminal changes. Native startup XML validation passed;
  actual task registration and demo attachment remain pending. See the updated
  [publication/runtime report](MT5_PUBLICATION_VERIFICATION.md).
- 2026-10-05: resumed after the user's stop request. Implemented explicit selected-trade
  publication from stored source revisions through central TypeScript reconstruction
  and a private atomic PostgreSQL publisher. Replays, concurrent-change rejection,
  immutable execution attribution, live-session/grant checks and preserved baselines
  pass locally. Fixed journal monetary display to honor account precision. Verified
  345 application tests, 336 database assertions (8 suites), 167 Python tests and
  40 real local provider/browser/API checks, plus typecheck, lint, build and SQL/Python
  static checks. All 27 migrations replay in a shadow database with no schema diff.
  Selected publication does not approve reconciliation or unattended synchronization.
  No hosted deployment, real terminal attachment, merge or MCP implementation occurred.
  See [publication verification](MT5_PUBLICATION_VERIFICATION.md).
- 2026-10-05: credentials/supervision checkpoint `cba5579` committed and pushed on
  `feature/mt5-sync`; no merge. Added strict local operator commands, bounded
  loopback consent receiver and explicit sign-in Task Scheduler registration.
  Python tests now 167; local browser/provider/API suite still passes 33 after
  the hidden coordinator/console worker fix. Found the existing terminal/data path
  through read-only inspection and left it unchanged. Actual startup/demo pilot,
  runtime package, canonical publication and onboarding remain pending; MCP queued.
  See [operator verification](MT5_OPERATOR_VERIFICATION.md).
- 2026-10-05: user superseded the mandatory 48-hour soak waiting gate and requested
  expedited MT5 and MCP delivery today. Extended soak remains recommended follow-up,
  not a blocker or a passed test. Focused interruption and correctness/security
  checks remain required. Latest local provider/browser/supervised-worker rerun
  passes all 33 checks after native job containment; approval service is available.
- 2026-10-05: approved specification saved; branch setup and authentication
  compatibility verification are the first implementation tasks.
- 2026-10-05: documentation committed as `b17c14a` on `feature/mt5-sync`;
  `feature/mcp-access` created at that commit and parked. `master` unchanged.
- 2026-10-05: read-only, secret-redacted authentication preflight implemented.
  Network-enabled discovery returned HTTP 404; public JWKS succeeded.
  Administrative dashboard requires login. This is evidence of unavailable
  discovery, not proof that PKCE/resource binding is supported or unsupported.
  No integration persistence, migrations, terminal configuration or broker
  reads/writes have been enabled. See [verification report](INTEGRATION_AUTH_GATE_REPORT.md).
- 2026-10-05: administrator enabled OAuth Server with `/oauth/consent`.
  Discovery now returns HTTP 200 and all advertised capability checks pass.
  Built the consent page and verified-browser service boundary, with safe
  rejection and no approval implementation until account-bound grants, resource
  validation and database isolation are verified. Already-consented code
  redirects are blocked rather than bypassing the application grant gate.
  Disposable-database and real-client verification remain pending.
- 2026-10-05: Docker recovered after the user relocated its disk image. Local
  Supabase replayed all 20 migrations; 26 OAuth-isolation and 100 regression
  assertions pass and roll back. Application tests: 173; typecheck, lint and
  production build pass. Added local asymmetric signing-key preparation and
  a safe all-suite database runner. Hosted data/schema were untouched.
  See [local test runbook](LOCAL_INTEGRATION_TESTING.md).
- 2026-10-05: repository inspection found external PR #1 already merged the
  earlier groundwork into `master` at `61ed889`. Fast-forwarded the MT5 branch
  to preserve that state; MCP remains parked at `b17c14a`. The partial merge
  is not MT5 completion: consent approval, account grants, resource binding,
  revocation, real-client tests and the demo soak remain release gates.
- 2026-10-05: preserved external PR #2's merge at `21deda8`, then returned the
  in-progress worktree from `master` to `feature/mt5-sync` and fast-forwarded
  that feature branch. MCP remains parked. Added active account-bound grants,
  resource signing hook, immediate revocation and browser consent/management.
  Local real-provider/Chrome verification now passes, including concurrent
  authenticated capture uploads. Source capture remains staging-only; no MT5
  terminal has been attached. See [current foundation report](MT5_FOUNDATION_VERIFICATION.md).
- 2026-10-05: added frozen multi-batch manifests, immutable slots and authenticated
  operation-status lookup. Server checkpoints cannot advance on incomplete collections,
  even when the final index arrives first. Added the Python account-bound SQLite
  outbox, exact durable upload envelopes and fenced uncertain-upload recovery.
  Verified 282 application tests, 228 database assertions, 27 browser/API checks and
  30 Python tests plus static checks; no broker terminal or hosted project changed.
  See [capture/recovery report](MT5_CAPTURE_RECOVERY_VERIFICATION.md).
- 2026-10-05: added resource-bound Python HTTP transport, durable lease retries,
  fenced upload recovery and the dedicated read-only demo-terminal adapter. Real
  Python/local-provider/API verification covers committed lost acknowledgements
  and UNKNOWN recovery; no terminal was opened. Verified 76 Python tests, 29
  browser/API checks, 282 application tests and 228 database assertions, plus
  static checks/build. All operational and merge gates remain required; MCP parked.
  See [transport/reader report](MT5_TRANSPORT_READER_VERIFICATION.md).
- 2026-10-05: implemented user-scoped Windows DPAPI credentials, public-client PKCE,
  renewable tokens, protected vault ACLs, bounded capture/upload subprocesses and
  the polling/heartbeat/reconciliation coordinator. Local outbox version 3 preserves
  all old pending operations, with durable pause/attention and append-only control
  and collector-generation evidence. Every coordinator lifetime has a new worker
  ID, including a copied VPS spool. Native tests prove supervisor death terminates
  only its contained Python worker, not a breakaway terminal stand-in. Verified
  146 Python tests, 282 application tests and 228 database assertions. Real local
  provider/browser/API checks passed 33 before the final containment addition;
  that final Docker/browser rerun is pending an approval-service usage-limit reset.
  No terminal, hosted migration, merge, deployment or MCP implementation occurred.
  See [credentials/supervision report](MT5_CREDENTIALS_SUPERVISION_VERIFICATION.md).
- 2026-10-07: restored the existing pilot OAuth session without changing its
  account/grant/version or five grant audit events. Verified dedicated demo
  specifications and all twelve explicit symbol mappings through normal audited
  browser forms. Independent source and central-decimal checks reconcile twenty
  captured closed trades (ten wins, ten losses) to USD +2032.53 and the captured
  USD 102032.53 balance basis, with zero unresolved source/cash problems. The
  preserved baseline remains USD 100000; no canonical trades are published.
  Explicit publication/approval, display-fix rollout and operational release
  gates remain pending. MCP stays parked. See
  [current pilot evidence](MT5_RECONNECT_VERIFICATION.md).
- 2026-10-07: the user approved publication of the twenty reviewed historical
  closed trades. The normal transactional browser workflow published them once;
  hosted readback confirmed twenty unique identities, forty provenance links,
  ten wins/ten losses and USD +2032.53 net PnL. The user also approved correcting
  the account start date from 5 October to the verified original-funding date,
  21 September 2026. The normal account edit and fresh ledger confirm the
  correction, chronological closure placement and unchanged USD 102032.53
  derived balance. The existing settings edit is not an append-only integration
  RPC; its approval/evidence are documented explicitly in the pilot report.
  Collector remains PAUSED, pending uploads zero. Final onboarding approval,
  operational verification and display-fix rollout remain pending; MCP disabled.
- 2026-10-07: returned to the existing MT5 branch containing the failover fix;
  credential-safe diagnostics distinguished intermittent TCP failures from OAuth
  rejection. Fresh same-grant PKCE/token/session checks passed and saved READY
  credentials. The approved bounded dedicated-demo restart recovered the preserved
  uncertain upload under fence 5, retained identical frozen facts and ended PAUSED
  with no pending pages. Local/server checkpoint 2026-10-07T14:51:30.826Z matches
  hosted readback. Twenty canonical identities, USD +2032.53 profit, baseline/date
  and the zero-difference bridge are unchanged. Current snapshot approval and other
  implementation/operational gates remain pending; no startup or MCP activation.
  See [failover and recovery evidence](MT5_FAILOVER_VERIFICATION.md).
- 2026-10-07: the user explicitly approved the recovered snapshot. The normal
  browser workflow recorded a second append-only onboarding proof at
  2026-10-07T15:20:40.495176+00:00 for checkpoint 2026-10-07T14:51:30.826Z.
  Independent readback confirms source and ledger fingerprints match; twenty
  trades, USD +2032.53 profit and zero adjustments are unchanged. Read-only
  SQLite inspection confirms PAUSED, no attention and no pending uploads.
  Corrected contradictory approval-page guidance and hid the duplicate approval
  form only when the current snapshot is approved; stale/unapproved snapshots
  still require explicit approval. Remaining release gates and MCP stay pending.
