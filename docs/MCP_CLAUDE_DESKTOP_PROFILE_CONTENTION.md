# Claude Desktop restart: profile contention

Date: 2026-10-14. Branch: `feature/mcp-access`.

## Acceptance result

The owner's actual 0.1.2 fresh-install account read remains PASS. The requested
normal full Quit/Exit and reopen without reinstalling is **FAILED**. Screenshots
show `Server disconnected` and no Trade OS tools in the new chat. This is a
release blocker, not merely a pending check or a missing chat toggle.

Read-only inspection verifies that the installed extension is 0.1.2 and its
`server.mjs` SHA-256 matches the checked-in launcher. No installation, consent,
application data, MT5 process or other integration was changed during diagnosis.

## Direct evidence

The extension's fixed stderr diagnostics are in Claude's `main.log`, not its
per-server MCP log. The diagnostic reader emits only known stage/error labels,
timestamps, elapsed times and byte counts, never protocol bodies or secrets.

At local 14:47:45-50, multiple launch sequences enter VERIFYING, finish complete
installation validation and start native adapters. At 14:47:54, one exits with
`TRADE_OS_MCP_ERROR:PROFILE_BUSY` and CHILD_CLOSED after 4,702 ms, with no output.
Another produces FIRST_OUTPUT after 8,286 ms in the same startup window.
The per-server log records disconnection at 11:47:54.093 UTC, matching local
14:47:54. A similar overlap and rejection is recorded at local 14:46:46.

Windows process metadata independently shows a surviving Desktop-owned
`TradeOSMcp.exe` and packaged Node process from local 14:47:48 in the newly
selected installation. Process metadata was read only; no process was killed.

## Root cause and boundaries

`integrations/mcp/vault.py` holds the profile's exclusive Windows OS lock for
the entire adapter lifetime. That intentionally prevents rotating-token races,
but also rejects another valid transport instance using that same Desktop
profile. Desktop starts overlapping instances; one wins and the chat-side
instance can fail. The exact routing of every instance to Chat/Code/Cowork is
not established and is not needed to demonstrate contention.

This observed failure is not a 45-second validation timeout: current checks
finish and adapters start, followed by an explicit PROFILE_BUSY rejection.
The earlier 65.5-second cold-start delay remains separate historical evidence.
Fresh reinstall can change the winner; it does not resolve the lock design.

## Approved scoped repair

Support concurrent local transports for the same explicitly authorized Desktop
profile while retaining a single serialized credential lifecycle. An exclusive
critical section must cover reloading the latest protected credentials, renewal,
durable invalidation before uncertain rotation, verified save and disconnect.
Do not simply remove the OS lock, copy rotating refresh tokens per process,
retry uncertain refresh requests, bypass sealed validation or weaken revocation.
MT5 collector single-instance/fencing behavior stays unchanged.

Regression gates must include simultaneous initialize/read, synchronized expiry
with only one effective renewal, a loser loading the winner's new token,
process death during rotation, disconnect/revocation, orderly transport cleanup
and repeated actual Desktop restarts without reinstalling. Fixture tests use
disposable protected stores; actual owner tests remain read-only unless separately
approved. Distribute any repair through the application's matched downloads,
not by changing the owner's installed files.

The owner approved implementation. Desktop's registered callback selects
transaction-scoped locking in the Node/Python vault; all other callbacks retain
the original lifetime lock. The OS-protection and MT5 locking implementation is
unchanged. The encrypted format, profile/client/resource/issuer binding and
protected on-disk location stay compatible with existing authorization.

The callback receives only lock-owning store methods. The entire latest-record
load, token validation, durable pre-clear, provider exchange and verified save
are serialized. Every Desktop token use reloads the current protected record;
disconnect and uncertain renewal cannot be bypassed by cached access tokens.
Another instance's already-completed renewal is recognized by both access and
refresh token changes, including an unchanged access-token value. A failed
pre-clear blocks reuse of the same stored record in that running instance.

Only side-effect-free lock acquisition is retried (100 ms intervals, 35-second
bound). Provider/token exchanges are not retried. Lost release acknowledgements
close only that helper; OS ownership releases on process death. There is no lock
file deletion, copied per-process refresh secret or local HTTP credential server.

## Local verification

| Exact command | Result |
| --- | --- |
| `npm test` | 71 files / 1,223 tests PASS |
| `node .artifacts/claude-desktop/local-db-check.mjs` | 30 suites / 1,196 rollback-isolated assertions PASS; four pending migrations injected transactionally; diagnostic setting restored |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS, Next.js 16.3.8 |
| `npm run test:mcp-python` | 12 native Windows tests PASS |
| `npm run check:mcp-python` | Ruff / compile checks PASS |
| `npm run test:companion-python` | 44 tests PASS |
| `npm run check:companion-python` | PASS |
| `npm run test:mt5-python` | 190 tests PASS; fixture-only, no real terminal/orders |
| `npm run check:mt5-python` | PASS |
| `npm run build:companion` | New isolated sealed 961-file bundle PASS; Node 24.21.0 / Python 3.13.16 |
| `npm run build:claude-desktop` | Full sealed verification before/after packaged import PASS; matched extension 0.1.3 |
| `npm run test:companion-native` | 15 install + 69 runtime checks PASS; includes three actual packaged credential helpers and one coordinated renewal; 29,321 ms install / 27,583 ms runtime |
| Cached official `@anthropic-ai/mcpb@2.1.2`: `mcpb validate integrations/claude-desktop/manifest.json` and `mcpb info <artifact>` | Manifest PASS; matched 12.49 KB MCPB accepted; explicitly unsigned |

New TypeScript cases cover overlapping startup, concurrent explicit/proactive
renewal, same-instance coalescing, unchanged-access-token rotation, failed
pre-clear, uncertain-provider response, cached-token disconnect, explicit
reconnect, resource mismatch and live 401/403 denial. A disposable actual Windows
fixture verifies three separate helpers against one DPAPI record. Python cases
add process-death invalidation, clean EOF release, non-owner release rejection,
no credential access without ownership and legacy-lock interoperability.
No fixture used an owner's credential record or changed a grant.

## Artifacts (not yet delivered)

The companion is changed, so this release requires a new matched companion and
MCPB, not an extension-only update. Both must be obtained through the existing
application setup page; retain the public Desktop JSON and protected profile.

- Companion: 59,187,712 bytes, SHA-256
  `66a54ed50f18d4b864f99d33e336efe70e5ee28277fb07e8f5de1f36db2ebfba`.
- MCPB 0.1.3: 12,788 bytes, SHA-256
  `a7339dc3a6d09d41be97a1f4ef693b3c489764c03da1a809fc2ef4f013812e7f`.
- Matched manifest pin:
  `d4ea9c85fed97c682ae0d775b0f7d2283aa453369ccd9e546d94e7c81a73ae97`.

## Review

Plan alignment and system-integrity checks PASS for the scoped local repair.
Readiness remains incomplete until app delivery and actual Desktop repeated
restart acceptance pass. The 0.1.2 normal-restart failure stays recorded; fixture
and packaged success are not actual Desktop UI proof. Resource, prolonged
renewal and live Desktop revocation/reconnect gates remain separate. No hosted
schema, production MCP enablement, MT5 task/collector or other client's installed
configuration changed.
