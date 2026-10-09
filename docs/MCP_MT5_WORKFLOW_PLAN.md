# MCP remaining MT5 workflow increment

2026-10-09, `feature/mcp-access`, baseline `57ab4d5`. Implements item 1 of the
approved completion checklist only; no files/deletion/stdio/client rollout work.
User approved one completed increment at a time, grouping overlapping workflows.

Blueprint ready. Decisions retain their approved meanings: mapping binds an
already-consented account grant to an explicit demo terminal identity; publication
persists selected source-backed canonical executions; onboarding approves a
specific complete reconciled snapshot; policy authorizes future eligible capture
publication without starting the collector. Pause/resume changes server eligibility
and fences old workers, not OS processes. MCP remains a separate actual actor.

Build eight tools: owned MT5-grant discovery, account mapping, symbol mapping,
initial cash classification, selected publication, snapshot onboarding approval,
publication policy and server connection control. No new financial algorithm,
broker execution, implicit classification, silent baseline change, arbitrary owner
ID or client-created execution proposal. Existing browser workflows remain gated.

Shared private implementations serve the browser and verified MCP adapters. Writes
check both the current MCP session/grant and relevant active MT5 account grant.
Receipts belong to the actual MCP client, with its application-wide scope. Preserve
original collector grant IDs only for connection checks, not actor impersonation.
Preparing and committing use one short transaction, exact snapshot/ledger/version
checks, operation ID replay and append-only audit. Domain utilities calculate all
cash, canonical finance and reconciliation proposals from a complete snapshot.

Verification groups mapping → cash → selected publication → approval → policy,
then fencing controls, so dependencies are tested end-to-end. Include malformed
commands, owner/non-owner/anonymous/collector roles, replay, changed payloads,
concurrency, revoked grants, stale evidence, impossible policy enablement, preserved
plans/balances/audits and old browser regression. Use disposable local fixtures;
never resume the real collector or mutate hosted trading data for these tests.

Complete unit/database/typecheck/lint/build, official SDK and browser gates, plus
Python regression/static checks. Report hosted migration/activation/client checks
separately; they are not passed by local tests. User snapshot is preserved.
