# Installed Codex mutation gate - 2026-10-13

Scope: actual Codex CLI 0.147.0 through the published, installed
`companion-eb9c5f33c5b03974/TradeOSMcp.exe`, persistent `tradeos_staging`
registration and approved profile `2638fa90-01f6-4450-b3ae-a88eefe51304`.
Only this server is enabled in the bounded acceptance process. Existing client
configuration, grants, MT5 terminals, collector/startup state and production MCP
enablement are unchanged. No model turn or provider API key/call is used.

## Controlled fixture and results

One new, inactive strategy: `MCP acceptance - Codex e4ede916`, ID
`f2719a37-202a-4b6b-9ec9-eea011c3d47d`. It is now archived, not permanently
deleted. No setups or trades reference it; its receipts/audits are retained.
Test operation IDs were saved before mutations for deterministic recovery.

| Check | Result |
| --- | --- |
| Concurrent identical creation requests | PASS: identical original receipt, one strategy/version 1 |
| Operation-status lookup | PASS: COMMITTED |
| Changed payload with same operation ID | PASS: OPERATION_CONFLICT, no extra effect |
| Omitted fields / explicit nullable description | PASS: name/active preserved, description cleared, version 2 |
| Two concurrent edits with the same expected version | PASS: one winner/version 3, one VERSION_CONFLICT |
| Losing and separately stale write | PASS: UNKNOWN/no durable receipt; no overwrite |
| Replay original create after later edits | PASS: original version-1 receipt remains recoverable |
| Reasoned archive and identical retry | PASS: archived/version 4, same receipt |
| Archived-record readback | PASS |
| Fresh Codex process replays the same complete operation set | PASS: no additional receipts/audits or record changes |
| Complete account dataset before/after each successful run | PASS: unchanged |
| Independent hosted database readback | PASS: four receipts, four owner/client-bound MCP audits; zero rejected-write receipts |

The four durable effects are create, description patch, winning concurrent patch
and archive. The first successful run and fresh-process replay both have zero
protocol errors. Non-protocol stderr categories remain `missing`/`socket`, as in
the earlier read check; no warning-free whole client session is claimed.

## Commands

- `node --check .artifacts/mcp-clients/codex-companion-check.mjs`: PASS.
- `node .artifacts/mcp-clients/codex-companion-check.mjs --installed --registered --write`: stopped before mutation when a second thread tried to launch the same credential profile.
- `node .artifacts/mcp-clients/codex-companion-check.mjs --installed --registered --write --resume-write`: PASS.
- `node .artifacts/mcp-clients/codex-companion-check.mjs --installed --registered --write --resume-write --restart-replay`: PASS.
- Two narrowly scoped, read-only Supabase queries checked only this fixture's
  receipts, actor/client-bound audits, archived state and references: PASS.

The harness is an ignored local diagnostic, not application behavior or a new
tool implementation. No product code/schema was changed; full application,
database, lint/typecheck/build gates were not rerun for this evidence-only step.
These remain required for final branch readiness or any implementation changes.

## Boundaries and remaining acceptance

The shipped credential design intentionally permits one running adapter per
profile to prevent rotating-refresh-token races. Two Codex threads attempting
separate adapters with the same profile are not supported. The initial test was
corrected to issue competing application requests through one authorized native
session; no lock was removed or weakened. Separate simultaneous client adapters
need distinct app-generated profiles. This is not proof of two concurrent hosts
or independent client grants; those scenarios remain separate acceptance checks.

Fresh-process replay demonstrates durable recovery, not a manufactured network
loss/lost-acknowledgement fault injection. This focused gate tests configuration
mutations; it does not prove every tool family or model-directed workflow passed.
Financial/account/trade/review data was not mutated. One archived test strategy
and its immutable evidence intentionally remain; there was no permanent deletion.

Actual owner-browser Codex revocation/reconnection, broader client acceptance,
Claude consent/registration/read/write/renewal/revocation and final production
activation are pending. Gemini remains ON HOLD. Future VPS handover remains
fenced and deferred, not claimed as tested by a local process restart.

Claude Code 2.1.119 is installed. The app has an owned READY Claude Code setup;
its separate browser approval and installed-profile verification are the next
user step. Codex credentials must not be reused as Claude credentials.

Sources for client procedures: [Codex App Server](https://learn.chatgpt.com/docs/app-server),
[Claude Code MCP](https://code.claude.com/docs/en/mcp).
