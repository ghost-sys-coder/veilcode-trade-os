# Simultaneous Codex / Claude Code acceptance - 2026-10-13

Two actual native client processes ran at the same time using the published
installed `companion-eb9c5f33c5b03974/TradeOSMcp.exe` and their independently
approved app-generated profiles:

| Client | Version | Profile |
| --- | --- | --- |
| Codex CLI | 0.147.0 | 2638fa90-01f6-4450-b3ae-a88eefe51304 |
| Claude Code | 2.1.119 | 65858572-76ba-48df-a6f7-68f82c730a7e |

This is not two calls in one client session and not an SDK-only substitute.
Each bounded client verifies its persistent installed registration and enables
only Trade OS for the test process. No persistent configuration, grant, MT5
terminal/collector/startup or production flag was changed. No model/user message,
provider API key/call, broker operation or permanent deletion was used.

## Results

| Check | Result |
| --- | --- |
| Both native clients connected simultaneously, with distinct profiles | PASS, both discover 84 tools |
| Entire account datasets read through both clients | PASS, identical owner data |
| Claude lookup of Codex-only create operation receipt | PASS, UNKNOWN rather than cross-client receipt disclosure |
| Competing version-1 edits from separate client processes | PASS, exactly one winner/version 2 and one VERSION_CONFLICT |
| Winning/losing clients' operation lookup | PASS, COMMITTED / UNKNOWN respectively |
| Both clients read the shared strategy after the race | PASS, same canonical record/version |
| Claude archives the shared inactive fixture with a reason | PASS, archived version 3 |
| Codex create receipt and Claude archive receipt replay after archival | PASS, immutable original results |
| Account datasets after the mutation sequence | PASS, unchanged for both clients |
| Independent hosted fixture/audit readback | PASS, three receipts/owner-bound audits, two audited clients, zero losing-write receipts |
| Client shutdown / protocol cleanliness | PASS, both controllers close, zero protocol errors |

The single test strategy `MCP acceptance - Codex Claude 149044b5`, ID
`28344478-6ac8-4b0f-ace6-2482d2a8bf7f`, remains inactive and archived with no trade
references. Three durable effects: Codex create, winning Codex patch, Claude
archive. The losing Claude operation is
`99320d82-cda3-4635-a597-c8a5a3985810`; independent readback finds zero receipts.
No account/financial/trade data was mutated. Immutable test evidence is retained.

The Codex process retains the previously documented 822-byte non-protocol
missing/socket diagnostics; Claude has zero stderr. Both have zero controller
stderr/protocol errors. No warning-free entire Codex session is claimed.

## Commands and scope

- `node --check .artifacts/mcp-clients/cross-client-check.mjs`: PASS.
- `node --check .artifacts/mcp-clients/codex-companion-check.mjs`: PASS.
- `node --check .artifacts/mcp-clients/claude-companion-check.mjs`: PASS.
- `node .artifacts/mcp-clients/cross-client-check.mjs`: PASS.
- One narrowly scoped, read-only hosted query checks only this fixture's version,
  archive state, receipt/audit counts, actor ownership, distinct clients and references: PASS.

Ignored local controllers exchange tool requests/results privately over IPC;
they never print account datasets or credentials. Only seven fixed application
tool names are accepted by the peer controllers. Operation IDs are saved before
mutations. No application code/schema changed; full app/database/typecheck/lint/
build suites were not rerun for this evidence-only checkpoint. Final release gates
still require them. Separate profile credential locks remain intact.

## Resource-path diagnosis and remaining acceptance

The earlier Claude raw `mcp_message` resource probe was the wrong diagnostic
transport: matching official publisher SDK 0.2.119 implementation routes that
bridge to **in-process SDK MCP servers**, not this configured native stdio server.
Its acknowledgement is not a resource payload and does not prove an application
resource defect. No resource implementation was rebuilt or removed.

A single bounded probe using Claude's installed read-only
`ListMcpResources` / `ReadMcpResource` built-ins through `mcp_call` returned a
control rejection. That control method's declared tool contract is fully qualified
MCP tool names, so this is not evidence of a failed ordinary Claude resource UI.
Normal client-resource acceptance is still pending, not passed or declared broken.
The actual 84-tool configuration/read/write workflows above remain passing.

Read-only Windows package inventory confirms Claude Desktop is installed as
`Claude` version `2.31226.1.0`. The standard non-Store installation paths were
absent, so those initial path checks are not treated as proof it was uninstalled.
No Desktop configuration, application session or credential was read/changed.
Desktop Chat/local-connector setup must use its own app-generated profile rather
than silently borrowing the live Claude Code profile. Code-tab, Chat-tab and
remote connector acceptance must be distinguished, not inferred from CLI success.

Codex live revocation, normal resource workflow, other Codex/Claude desktop/remote
surfaces, broader family/consent acceptance and final enabled production rollout
remain separate gates. Gemini stays ON HOLD. A same-desktop client race is not
VPS failover/reboot/RDP verification; those future-host operational gates remain
deferred and the fenced architecture is unchanged.

Sources: [official Codex App Server initialization](https://learn.chatgpt.com/docs/app-server#initialization),
[official Claude Agent SDK publisher repository](https://github.com/anthropics/claude-agent-sdk-typescript).
