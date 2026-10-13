# MCP completion checklist

Updated 2026-10-10 from the actual `feature/mcp-access` implementation, merged
master `853a963`, user-approved integration plan and latest verification reports.
This checklist separates missing MCP capabilities from delivered MT5 behavior;
it is not a plan to rebuild the completed integrations or core workflows.

## Already delivered — do not rebuild

- Stateless remote HTTP `/mcp`, public discovery, resource-bound Supabase OAuth,
  browser consent, renewable credentials, immediate revocation and operation lookup.
- 84 HTTP tools and eight resources: accounts/balances/events/lifecycle,
  strategies/setups/rules, instruments/tags, goals/prop progress, canonical
  trades/management/corrections/reviews, journals, analytics/calendar/export,
  position sizing, self-profile, MT5/import reads and explicit conflict review,
  screenshot metadata, controlled private upload/download and browser-approved
  configuration/screenshot deletion (hosted prerequisites and Preview verified).
- Verified shared services, central decimal calculations, private transactions,
  durable retries, optimistic concurrency and immutable mutation evidence.
- MT5 health, complete preview/balance bridge, broker revisions, exact manual
  match fingerprints, SOURCE/DISTINCT/LINK/REOPEN/CASH review, import batches/rows.
- Correct hosted private prerequisites for this increment, with integration
  enablement and all existing data/control state preserved.

The official SDK passes both modern and legacy HTTP. This is **not** evidence
that every requested real AI client has connected successfully.

## Remaining implementation and acceptance

1. **Remaining integration workflow adapters.** Expose existing browser MT5
   mapping, initial cash classification, snapshot onboarding approval, selected
   canonical publication, pause/resume and publication-policy workflows through
   typed MCP services. Retain demo/ownership/grant/version/reason/fencing checks.
   No terminal-switching, capture/lease impersonation or broker-execution tools.
   Existing MT5 implementations are reused; they are not missing MT5 features.
   Audit any user-facing import conflict action against the capability inventory.
   **Complete:** eight typed tools pass local unit/database/provider/browser gates;
   the user-approved hosted prerequisite rollout passes with all 54 application
   table fingerprints unchanged and MCP still disabled. See
   [workflow evidence](MCP_MT5_WORKFLOW_VERIFICATION.md). Do not rebuild this group.
2. **Controlled screenshots/private files.** Metadata/list plus controlled
   upload-request, validated upload-finish and bounded private download. Preserve
   owner/trade relations, content/size/type limits, exact object IDs, retry/audit
   contracts and revocation. No arbitrary URL fetching or local-path access.
   **Complete for this increment:** seven tools, exact-byte image validation, resumable immutable
   chunks, atomic attachment/audits and legacy compatibility. Local 59-check
   OAuth/SDK gate passes. Approved hosted prerequisites preserve all 54 existing
   application tables; the sensitive secret is scoped only to the MCP-branch
   Preview, with MCP disabled. See [private-file evidence](MCP_PRIVATE_FILES_VERIFICATION.md)
   for deployment evidence and explicit retention/client limitations.
3. **Permanent deletion safeguards.** One-use browser approval bound to owner,
   client, entity, exact target/version and expiry. Delete only unused eligible
   configuration; archive referenced strategies/setups/rules/goals and report
   archival. Screenshot deletion uses the same exact-target approval. Never
   delete plan corrections, execution/financial history or audit evidence.
   **Complete for this increment:** four tools plus the deletions resource;
   unused delete/referenced archive, physical Storage purge, immutable execution
   receipts and owner-browser recovery after revocation. Approved hosted
   prerequisites preserve all 56 existing application tables plus Storage;
   the pushed, configured Preview passes 7/7 GET checks with MCP disabled. Actual
   hosted authenticated/client acceptance remains item 6, not a claimed pass. See
   [deletion evidence](MCP_DELETION_SAFEGUARDS_VERIFICATION.md).
4. **Local stdio adapter and setup.** Official SDK, same authenticated application
   workflows, resource-bound renewable credentials in protected local storage,
   clean protocol stdout and actionable errors. Ordinary application access must
   not depend on MT5 being online. No AI-provider keys or model API calls.
   **Implemented and locally verified:** transport-only authenticated forwarding,
   S256 loopback browser login, reused Windows DPAPI/ACL/OS locks, serialized
   fail-closed renewable credentials and clean SDK stdout. Modern/legacy real
   subprocess, retry/version, kill-switch and native Windows gates pass. See
   [stdio evidence](MCP_STDIO_VERIFICATION.md) and [setup](../integrations/mcp/README.md).
   Real AI-client and hosted activation acceptance remain items 5–6.
5. **Real-client/authentication matrix.** Current priority, updated 2026-10-13:
   verify Codex, Claude Code and supported Claude desktop/remote paths. Gemini
   CLI is ON HOLD by user decision, not passed and not a blocker for this focused
   release. Standalone ChatGPT connector work stays queued after this focus.
   Keep standard MCP support for later verification. Finish pre-registered
   local-client setup and controlled remote registration/discovery compatibility
   where needed. Test actual consent/read/write/refresh/revocation, not discovery
   alone. Record exact versions and unsupported paths; do not assume Gemini
   consumer-app support. User browser consent may be needed for these checks.
   **Simultaneous native-client checkpoint, 2026-10-13:** actual separate Codex
   and Claude Code processes pass shared owner reads, client-scoped operation
   lookup, one-winner concurrent edit, canonical readback and cross-client
   archival/replay. Three receipts/audits across two clients; test fixture archived
   and account data unchanged. This clears the independent-client concurrency
   gate for these installed profiles, not VPS or other desktop/remote surfaces.
   Resource-control probe was an SDK-only bridge, not an application failure;
   normal resource acceptance remains pending. See
   [cross-client evidence](MCP_CROSS_CLIENT_VERIFICATION.md).
   **Installed Claude Code checkpoint, 2026-10-13:** separate user consent and
   verified grant binding pass. Native 2.1.119 is persistently registered, preserving
   two user entries / 33 project scopes. Actual discovery/read/configuration-write,
   retry/version/concurrent-edit and restart replay gates pass; one inactive
   fixture is archived with four receipts/audits and account data unchanged.
   Live owner revocation denies the already-connected client discovery/read/write;
   independent readback confirms no denied-write receipt. Raw resource-control
   probe is not a passed resource workflow. Owner reconnection restores ACTIVE
   grant version 2; native reads and installed credential renewal pass.
   Independent-client concurrency and other Claude surfaces remain
   pending. See [Claude Code evidence](MCP_CLAUDE_CODE_VERIFICATION.md).
   **Installed Codex mutation checkpoint, 2026-10-13:** configuration writes,
   durable status/replay, changed-payload rejection, null/omission, concurrent
   version conflict and reasoned archival pass, including a fresh-process replay.
   One inactive fixture is archived with four receipts/audits; account data is
   unchanged. Same-profile parallel adapters are intentionally rejected;
   competing requests passed within one authorized session. Broader family and
   live revocation checks remain pending. Claude Code's separate app-led consent
   is next; no model/API calls or Gemini work occurred. See
   [mutation evidence](MCP_CODEX_MUTATION_VERIFICATION.md).
   **Partial actual-client acceptance, 2026-10-12:** staging-only enablement and
   the corrected production consent handoff are released. The user-approved Codex
   stdio grant passes signed/live connection, native 84-tool/eight-resource
   discovery and actual native read checks. The approved existing-consent fix is
   released; fresh same-grant reconnect and native reads pass. User-approved
   Windows clock synchronization resolved the future-issued-token failure;
   protected renewal, separate-process status and native reads after renewal pass
   with strict validation unchanged. Actual-client writes/revocation and the other
   requested clients remain pending. Production MCP is still disabled. See
   [current Codex evidence](MCP_CODEX_CLIENT_VERIFICATION.md).
   **Installed-package checkpoint, 2026-10-13:** the user completed the current
   app-downloaded companion setup. The native relay flush correction passes
   82 native checks. The installed launcher is persistently registered as
   `tradeos_staging`, preserving all eight existing Codex entries; actual CLI
   discovery exposes 84 tools/eight resources and installed owner/domain reads
   pass. This completes installation/registration for that profile, not the
   remaining mutation/revocation or multi-client matrix. See
   [packaged acceptance](MCP_COMPANION_CODEX_ACCEPTANCE.md).
   Existing-consent handoff correction and fresh hosted retest are tracked in
   [reconnect verification](MCP_RECONNECT_VERIFICATION.md); the code must not
   discard a provider-issued one-use reconnect code or treat routed IDs as
   proof of complete authorization.
6. **Final hosted acceptance and activation.** Verify complete workflow coverage,
   protocol schemas/paging/concurrency/idempotency, owner isolation, review and
   deletion evidence, public calculator/login/manual-trade regressions and all
   required test/static/build commands. Verify the exact hosted build and runbook;
   then release/activate MCP under its separate flag through the approved rollout.
   A feature-branch push or passing SDK test is not full MCP completion.

Items 1–4 are delivered for their increments. Actual client acceptance is item 5,
then final hosted release is item 6. The user additionally confirmed app-led setup
for both integrations. Its owned-profile/UI/configuration increment now passes
local gates, but is not hosted/enabled. Windows companion distribution is next;
client acceptance must use the finished onboarding, not operator-only JSON/CLI.
See [setup plan](INTEGRATION_SETUP_UX_PLAN.md) and
[increment evidence](INTEGRATION_SETUP_VERIFICATION.md).
File deletion cannot ship
without its confirmation boundary. Each increment needs its own tests and report before
moving on. Inventory/resource counts update from implementation, not estimates.

## MT5 completion boundary

MT5's requested single-demo rollout was accepted before MCP began: dedicated
terminal/account identity, staging/reconstruction/reconciliation, publication,
conflict review, protected restart recovery and Windows task recovery are built.
The focused hosted pilot retained 20 unique canonical trades and USD +2032.53;
no broker orders were created. See
[MT5 final readback](MT5_AUTOMATIC_REVIEW_VERIFICATION.md).

Broader operational limits remain separately recorded: real additional terminals,
actual sign-in/reboot/locked-session behavior, future VPS/RDP operation, local
pending-upload telemetry to the monitoring page and the user-deferred extended
soak. These are not reasons to rebuild MT5 or re-run completed milestones, and
they must not be reported as verified. No live-account or wider rollout is
authorized merely by completing MCP.

## Completion rule

MCP is complete only when the remaining capabilities and required actual client
paths are implemented/verified, hosted acceptance passes and the authorized
enablement/operational setup is finished. Unavailable client checks remain
explicit pending items, not fabricated passes. No new monetary infrastructure,
paid bridge API, model API credential, automatic trading or third feature branch
is introduced.
