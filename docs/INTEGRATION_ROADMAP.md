# Trade OS: MT5 Synchronization and MCP Access

Status: approved implementation plan; delivery started on 2026-10-05.
Baseline: clean `master` at `412da1c`. Two feature branches, in addition to
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
4. Merge MT5 only after all required gates, including the 48-hour demo soak.
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
| MT5-0 | Documentation, branches, authentication compatibility | PKCE, refresh, intended-resource binding, revocation and login compatibility | In progress |
| MT5-1 | Shared services and transactional import storage | Owner isolation, RLS, atomicity, replay and concurrency tests | Not started |
| MT5-2 | Broker reconstruction and financial attribution | Hand-calculated fixtures and migration compatibility | Not started |
| MT5-3 | Python collector and Windows recovery | Fault injection, account isolation, durable outbox and fencing | Not started |
| MT5-4 | Onboarding, reconciliation and monitoring | Browser verification and controlled demo pilot | Not started |
| MT5-5 | Operational readiness | Full checks plus 48-hour multi-account soak | Not started |
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
versions, limitations and blockers. MT5 readiness also requires a 48-hour
multi-account demo soak with controlled interruptions. Separate enablement
flags keep integrations off until approved rollout; disabling one stops
new activity but preserves persisted facts, provenance and audits.

See [MT5 plan](MT5_INTEGRATION_PLAN.md) and [MCP plan](MCP_INTEGRATION_PLAN.md).

## Sources

- [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- [Supabase token security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)

## Progress log

- 2026-10-05: approved specification saved; branch setup and authentication
  compatibility verification are the first implementation tasks.
