# MCP completion checklist

Updated 2026-10-09 from the actual `feature/mcp-access` implementation, merged
master `6c7a0b7`, user-approved integration plan and latest verification reports.
This checklist separates missing MCP capabilities from delivered MT5 behavior;
it is not a plan to rebuild the completed integrations or core workflows.

## Already delivered — do not rebuild

- Stateless remote HTTP `/mcp`, public discovery, resource-bound Supabase OAuth,
  browser consent, renewable credentials, immediate revocation and operation lookup.
- 80 HTTP tools and seven resources: accounts/balances/events/lifecycle,
  strategies/setups/rules, instruments/tags, goals/prop progress, canonical
  trades/management/corrections/reviews, journals, analytics/calendar/export,
  position sizing, self-profile, MT5/import reads and explicit conflict review,
  screenshot metadata and controlled private upload/download.
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
4. **Local stdio adapter and setup.** Official SDK, same authenticated application
   workflows, resource-bound renewable credentials in protected local storage,
   clean protocol stdout and actionable errors. Ordinary application access must
   not depend on MT5 being online. No AI-provider keys or model API calls.
5. **Real-client/authentication matrix.** Verify Codex, Claude Code, ChatGPT
   Desktop/remote connector, Claude remote and Gemini CLI. Finish pre-registered
   local-client setup and controlled remote registration/discovery compatibility
   where needed. Test actual consent/read/write/refresh/revocation, not discovery
   alone. Record exact versions and unsupported paths; do not assume Gemini
   consumer-app support. User browser consent may be needed for these checks.
6. **Final hosted acceptance and activation.** Verify complete workflow coverage,
   protocol schemas/paging/concurrency/idempotency, owner isolation, review and
   deletion evidence, public calculator/login/manual-trade regressions and all
   required test/static/build commands. Verify the exact hosted build and runbook;
   then release/activate MCP under its separate flag through the approved rollout.
   A feature-branch push or passing SDK test is not full MCP completion.

Items 1 and 2 are implemented; next build is item 3, followed by 4, 5, 6. File deletion cannot ship before
its confirmation boundary. Each increment needs its own tests and report before
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
