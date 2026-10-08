# Trade OS MCP Access Implementation Plan

Branch: `feature/mcp-access`. Status: updated from master `32306e5` after the
focused demo check passed; stateless HTTP and the strategy/setup/rule shared
list/get/create/patch/archive workflows and account list/get/create/patch with
exact balance access are implemented. The real local MCP
OAuth/consent/refresh/revocation gate passes. Remaining application workflows,
permanent deletion, local stdio, external-client verification and hosted
activation remain pending. See
[capability inventory](MCP_CAPABILITY_INVENTORY.md).
The user requested same-day MT5/MCP delivery on 2026-10-05 and removed the mandatory
48-hour soak wait. MT5 correctness/security and focused demo checks remain required;
extended soak is deferred rather than reported as passed.
Authority: the user-approved plan and [shared roadmap](INTEGRATION_ROADMAP.md).

## Delivery checklist

- [x] Update branch from `master` after the user's MT5 merge; pending operational
  evidence remains explicitly recorded.
- [ ] Extend shared services across remaining user-facing workflows.
- [ ] Versioned capability inventory, resources, schemas and tool tests.
- [ ] Official TypeScript SDK and stateless HTTP foundation implemented;
  local stdio adapter pending.
- [ ] Resource-bound OAuth, browser consent and connected-client management.
- [ ] Protocol/browser/client verification and full regression checks.

No separate foundation implementation. No MCP feature work before the MT5
merge gate. No model-provider API credentials, model invocations or fees
introduced by this application integration.

## Transports and identity

Use the official TypeScript SDK. Serve stateless Streamable HTTP at `/mcp`
through the existing Next.js Node runtime. Supply a local stdio adapter calling
the same authenticated application workflows. Ordinary app access must not
depend on the MT5 desktop being online. Do not keep authorization or MCP
sessions only in server memory.

Publish protected-resource metadata and OAuth challenges. Validate signature,
issuer, expiry, intended resource and active application grant on every
request. Use existing Supabase Auth browser consent and renewable credentials;
prefer pre-registered local clients and controlled dynamic registration where
remote clients need it. Test PKCE, refresh, audience/resource binding and
revocation. OAuth scopes alone are not database permissions.

Discovery is public; user data is protected. Preserve anonymous public
calculator access. Never expose database/service-role credentials to clients.

## Capability inventory

Version the inventory and map each existing user-facing capability to its
application service, resource/tool, input/result schema, validation and test.

| Family | Required workflows |
| --- | --- |
| Accounts | Account records, balances, snapshots, adjustments/classification |
| Methodology | Strategies, setups, trading rules, instruments, tags |
| Progress | Goals/progress, prop configuration, account lifecycle |
| Trades | Create/edit, open/close, targets, management events |
| Corrections | Explicit protected-plan corrections with reason/version checks |
| Reviews | Execution, psychology, rule snapshots/results, post-trade review |
| Journals | Daily, weekly and monthly logs/reviews |
| Analysis | Analytics, calendar, filtered exports, position sizing |
| Screenshots | Metadata, controlled private upload/download |
| Integrations | MT5 state, imports, conflict review |

Resources expose domain structures, relationships, enumerations, precision
rules and workflow guidance. Tools have explicit schemas and structured
results. Lists paginate; exports include all matching records. Omitted patch
fields mean unchanged; null clears only fields where clearing is valid.

Do not expose arbitrary SQL, shell execution, credentials, database
administration or broker execution. Do not fetch arbitrary screenshot URLs;
use controlled private-file upload/download workflows and existing ownership
policies.

## Mutations, concurrency and deletion

Normal authorized writes require no extra browser approval. Reuse durable
operation receipts and optimistic concurrency. Add operation-status lookup
for uncertain retries and simultaneous clients. Return explicit typed errors,
not UI redirects, for protocol clients.

Permanent deletion requires browser approval and a one-use confirmation bound
to exact target/version. Delete unused configuration; archive referenced
strategies, setups, rules or goals and report the actual operation. Preserve
historical references and immutable rule snapshots; add archive support
where an existing entity lacks it.

Never delete plan corrections, financial execution history or audit evidence
through MCP. Preserve explicit review-completion markers and nullable
unanswered values. Do not silently replace broker-synchronized execution
facts with assistant data. Normal writes cannot bypass protected-plan RPCs.

## Verification matrix

Test transports, discovery, schema validation, pagination/export scope,
structured errors, replay, concurrency, consent, revoked/expired tokens,
wrong-resource tokens, owner isolation and destructive confirmation binding.
Test every capability family against the same services used by the UI.

| Client | Required check |
| --- | --- |
| Codex | Local/remote connection, discovery and authorized read/write |
| Claude Code | Local/remote connection and workflow verification |
| ChatGPT Desktop / remote connector | Available connection path, consent and tools |
| Claude remote connector | HTTPS discovery, consent and tools |
| Gemini CLI | Connection, tools and workflow verification |

Gemini consumer-app support is not assumed. Record client versions, supported
connection paths, account policies, commands and results. Client availability
does not prove authorization or successful tool execution. Do not call a
provider's model API to run protocol tests. Missing real-client verification
is pending, not passed.

Run the roadmap's unit/database/typecheck/lint/build commands plus protocol,
browser and regression tests. Preserve manual trading, review semantics,
analytics/mixed-currency boundaries, screenshots, login redirects and the
public calculator. Roll out with an independent enablement flag; disabling
access preserves application records and audits.

## References

- [Official MCP SDKs](https://modelcontextprotocol.io/docs/sdk)
- [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/)
