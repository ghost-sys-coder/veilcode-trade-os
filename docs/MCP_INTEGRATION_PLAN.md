# Trade OS MCP Access Implementation Plan

Priority refinement 2026-10-13: verify Codex and Claude products first. Gemini
verification is ON HOLD until the user resumes it; it is not a failed or passed
gate and does not block this focused release. Standalone ChatGPT connector work
is queued after the Codex/Claude focus. Preserve the standard client-neutral MCP
catalog and transports; do not remove working deferred-client support.

Current 2026-10-10: updated from consolidated master `853a963`; items 1–4 of
the [completion checklist](MCP_COMPLETION_CHECKLIST.md) are delivered for their
increments. The local stdio adapter forwards all 84 tools/eight resources with
protected renewable credentials and no MT5 runtime dependency. See
[stdio verification](MCP_STDIO_VERIFICATION.md). Actual client matrix and final
hosted acceptance/activation remain pending; the older milestone notes below
are historical, not instructions to rebuild completed features.

Branch: `feature/mcp-access`. Status: updated from master `6c7a0b7` after the
focused demo check passed; stateless HTTP and the strategy/setup/rule shared
list/get/create/patch/archive workflows and account list/get/create/patch with
exact balance access are implemented. Account adjustments/classification,
snapshots/lifecycle and canonical trade/target/management/correction/review
workflows now use shared services. Persisted journal reflections and goal/prop
commands plus exact shared account-progress metrics, owned tag/instrument
workflows and audited trade-tag associations now join computed journal summaries,
performance/behavior analytics, the realized calendar and full filtered CSV export,
bringing local coverage to 80 HTTP tools and seven resources with snapshot-aware
paginated balance-curve events, self-profile preferences, MT5/import access and
controlled screenshot metadata/upload/download. The private-file increment
preserves legacy browser attachments, denies direct OAuth Storage access and
uses server-only credentials; see [private-file verification](MCP_PRIVATE_FILES_VERIFICATION.md).
The nine integration tools reuse existing broker reconstruction/finance and
SOURCE/DISTINCT/LINK/REOPEN/CASH review rather than rebuilding MT5. Health,
raw revision history, complete preview, manual fingerprints and import staging
are owner-scoped; review additionally checks the active account-bound MT5 grant.
Controls, initial mapping/cash classification, selected publication, onboarding
approval and publication policy now have eight strict MCP adapters, verified
locally as one overlapping workflow group. Its approved hosted prerequisites are
installed and verified, preserving all 54 application table fingerprints and
leaving MCP disabled. See [workflow verification](MCP_MT5_WORKFLOW_VERIFICATION.md) and
[integration verification](MCP_INTEGRATION_ACCESS_VERIFICATION.md).
The tested private integration migration is now installed and verified on the
correct hosted project, with 12 unchanged data fingerprints and MCP disabled.
The remaining capability/client/release gates are listed in
[completion checklist](MCP_COMPLETION_CHECKLIST.md). Profile hosted prerequisites are installed
after explicit approval, and pushed profile source `e241586` has a READY Preview
build. Authenticated hosted/client verification and permanent deletion remain
pending. See [profile verification](MCP_PROFILE_VERIFICATION.md) and
[curve verification](MCP_BALANCE_CURVE_VERIFICATION.md). The user-approved read-only reporting migration is
installed on the hosted project; hosted prerequisites and the verified production
build pass. Reporting source `e09ca3f` is pushed and its branch preview is READY;
authenticated preview reporting verification passes. The user's independent
PR #18 merge at master `02565eb` has a READY production deployment; remaining
MCP capabilities and activation/client gates remain pending. See
[reporting verification](MCP_REPORTING_VERIFICATION.md),
[reference verification](MCP_REFERENCES_VERIFICATION.md),
[goal/prop verification](MCP_GOALS_PROP_VERIFICATION.md) and
[journal and accounts repair verification](MCP_JOURNALS_AND_ACCOUNTS_REPAIR.md). See
[the workflow report](MCP_ACCOUNT_EVENTS_TRADES_VERIFICATION.md). The real local MCP
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
  local stdio adapter implemented and locally verified.
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

## Future VPS deployment requirements

Keep the application/API and MT5 collector separately deployable. The future
application host may change without moving the collector into the web process.
MT5 still requires a compatible Windows host with dedicated terminal/worker per
approved account; ordinary MCP application access must work when that host is
offline. No VPS purchase, provisioning or hosting migration is authorized now.

Use deployment configuration and app-generated public setup profiles for origins,
resource URLs and installation paths, not this desktop's drive letters or a
permanent assumption that the staging hostname is the production resource.
Persistent operations, audits, grants and receipts remain database-backed;
process memory must not be the only source of recovery or authorization state.
Preserve HTTPS/resource-bound OAuth, revocation and separate enablement flags on
any new host. Credential renewal and browser/RDP callback behavior on a VPS need
explicit verification; never copy Windows-protected credential blobs as a
portable credential transfer. Reauthorize on the destination host as required.

VPS handover must use a new collector identity and server fence, preserve durable
pending operation IDs/checkpoints, and reconcile before resuming. Verify old-host
write rejection, outage/restart recovery and Windows login/RDP/startup behavior
there. These future-host checks are deferred, not claimed as passed on this PC.

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
| Claude desktop / remote connector | Verify each available supported path, HTTPS discovery, consent and tools; unavailable paths reported explicitly |
| ChatGPT Desktop / remote connector | Queued after current Codex/Claude focus; available connection path, consent and tools |
| Gemini CLI | ON HOLD by user decision; resume connection/tool/workflow verification only when requested |

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
