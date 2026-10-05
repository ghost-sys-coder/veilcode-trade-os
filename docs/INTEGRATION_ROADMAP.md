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
| MT5-0 | Documentation, branches, authentication compatibility | PKCE, refresh, intended-resource binding, revocation and login compatibility | Passed locally: real provider, signed tokens and browser; hosted configuration/deployment unverified |
| MT5-1 | Shared services and transactional import storage | Owner isolation, RLS, atomicity, replay and concurrency tests | In progress: durable source capture, receipts, audits and fenced leases verified; canonical shared workflows pending |
| MT5-2 | Broker reconstruction and financial attribution | Hand-calculated fixtures and migration compatibility | In progress: deterministic episodes/finance fixtures pass; canonical commit/identity migrations pending |
| MT5-3 | Python collector and Windows recovery | Fault injection, account isolation, durable outbox and fencing | In progress: protected PKCE/refresh credentials and supervised upload verified against local API; native process containment and coordinator scheduling fixture-tested; operator CLI, callback listener and startup registration implemented; actual startup invocation and terminals pending |
| MT5-4 | Onboarding, reconciliation and monitoring | Browser verification and controlled demo pilot | Not started |
| MT5-5 | Operational readiness | Full checks plus focused multi-account demo interruption tests; extended soak deferred | Not started |
| MCP-1 | Remaining shared workflows and capability inventory | Each existing feature mapped to a tested service/tool | Parked |
| MCP-2 | Local/remote transport and consent | Protocol, resource authorization and revocation tests | Parked |
| MCP-3 | Client verification and readiness | Required client matrix plus regression checks | Parked |

Authentication is an early hard gate. Verify the configured provider's
discovery, PKCE S256, renewable tokens, resource binding, revocation and
existing login compatibility before broker persistence. Supabase OAuth is
beta: a failed gate requires a plan revision, not weaker authentication.
Do not treat advertised capabilities as proof of an end-to-end flow.

## Verification policy

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
