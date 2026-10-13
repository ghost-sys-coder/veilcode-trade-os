# Installed Claude Code acceptance - 2026-10-13

User-reported app setup, separate browser approval and companion verification
passed. Public setup file was supplied in `D:\FOREX_TRADING\trade-os-installations`:
`tradeos-claude_code-65858572-76ba-48df-a6f7-68f82c730a7e.json`.
The owner-generated profile uses client `e7f9e32f-6c32-44ff-89ea-53003c8e4ba9`,
loopback callback `http://127.0.0.1:9880/callback` and the staging `/mcp` resource.
Independent read-only database verification confirms READY setup, ACTIVE grant,
correct owner/client/purpose/resource binding and no account retargeting.

## Real client and persistent registration

Claude Code **2.1.119** is the actual native executable, not an SDK impersonation.
Matching published Agent SDK **0.2.119** declarations were inspected to confirm
`initialize`, `mcp_status` and `mcp_call` control request shapes. No SDK dependency
was added to the application and no downloaded SDK code was executed.

The checksum-verified installed `companion-eb9c5f33c5b03974/TradeOSMcp.exe` is now
registered as user-scoped `tradeos_staging` using the official `claude mcp add`
command, with the Claude profile ID as its `--profile` argument. Registration
preserved both existing user MCP entries and every project MCP map in 33 scopes.
Codex configuration and MT5 grants/terminals/collector/startup were not modified.

Bounded native CLI verification uses `--bare`, strict inline MCP configuration,
no built-in tools, no persisted session and sanitized environment. Only the exact
registered installed launcher/profile is connected. Model endpoint is an unused
loopback address; no user/model message is sent, no provider key is supplied and
no model inference/API usage occurs. Permanent deletion is never attempted.

## Verification results

| Gate | Result |
| --- | --- |
| User consent / companion access | PASS, user report plus independent active binding readback |
| Installed manifest and launcher hashes | PASS, same published bytes |
| User-scoped native registration | PASS, two user entries / 33 project scopes preserved |
| Actual Claude Code discovery | PASS, 84 tools |
| Actual capabilities/account reads | PASS, structured results and money/version strings |
| Concurrent identical create requests | PASS, one inactive strategy and original receipt |
| Durable status and changed-payload replay | PASS, COMMITTED / OPERATION_CONFLICT |
| Explicit null / omitted-field patch | PASS, description cleared, other values unchanged |
| Concurrent expected-version edits | PASS, one winner / one VERSION_CONFLICT |
| Losing and stale write rollback | PASS, no committed losing/stale effects |
| Original receipt after later updates | PASS, version-1 receipt retained |
| Reasoned archive, retry and readback | PASS, inactive archived version 4 |
| Fresh-process complete replay | PASS, same archived record, no new effects |
| Independent fixture readback | PASS, four receipts / four owner-client-bound audits, one race winner, zero stale receipts |
| Full account dataset before/after each successful write/replay run | PASS, unchanged |
| Native raw resource-control probe | NOT PASSED: no usable resource-list payload; normal Claude resource-path acceptance remains pending |
| Live owner-browser revocation | PASS: existing connected client denied discovery/read/write after owner revocation |
| Reconnection after revocation | PASS: user reconnect/verify, ACTIVE grant version 2 with exact binding, native discovery/account/catalog reads |
| Explicit installed-runtime credential renewal | PASS: refresh completes signed/resource/client validation, encrypted persistence and live discovery |
| Independent native process after renewal | PASS: restored 84-tool discovery/account/catalog reads without another login, zero protocol errors/stderr |

The single fixture `MCP acceptance - Claude 0853af6e`, ID
`ea88978c-1f09-4bee-acbe-2921d44866e3`, remains archived with its audit evidence.
There are no trade references. Four durable effects: create, null-description
patch, winning concurrent patch, archive. No financial, account or trade writes.

Independent readback after user revocation confirms REVOKED grant, revocation
timestamp present, zero receipts for denied operation
`54f3321c-963c-4cf1-bf18-91a4461f56a0`, and the same four fixture receipts/version 4.
The bounded observer closed before requesting companion reconnection, releasing
the single-profile lock. It did not revoke anything itself.

The user subsequently reconnected and independently selected Verify application
access; both returned the real-connection verification message. This is expected:
the shipped CLI login/reconnect path completes browser authorization and then
calls the same live `connectRemote`/tool discovery used by the status check before
showing success. Verify application access repeats that live check; the initial
success is not fabricated or proof of every client/tool workflow.

Independent readback confirms ACTIVE grant version 2, no current revocation, READY
setup and the unchanged owner/client/purpose/resource binding. Actual Claude Code
2.1.119 subsequently passes 84-tool discovery and structured account/catalog
reads with zero protocol errors/stderr. The installed bundled Node/Python adapter
then explicitly renews only this profile's credentials and verifies the live
connection (exit 0, protocol stdout 0 bytes). No validation/tolerance was relaxed,
grant permission changed or new login requested for renewal.
An independent fresh Claude Code process then reads the saved renewed credentials
and passes the same discovery/account/catalog gate without browser interaction.

An early write harness stopped after creation because Claude returns an MCP
domain rejection through a control-error envelope rather than an ordinary tool
result. The harness now recognizes only explicit expected OPERATION_CONFLICT /
VERSION_CONFLICT codes or their exact application messages. Resumed with the
saved operation IDs; did not create another fixture or weaken app validation.
Successful discovery/read/write/restart runs have zero protocol errors/stderr.

## Exact commands

- `claude --version`: 2.1.119.
- `claude mcp add --help`: supported stdio and user-scope options verified.
- `npm view @anthropic-ai/claude-agent-sdk@0.2.119 dist.tarball --json`: matching publisher metadata read only.
- `node .artifacts/mcp-clients/register-installed-claude.mjs`: PASS.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --discover`: PASS.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --read`: PASS.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --write`: initial harness error envelope mismatch, not a full pass.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --write --resume-write`: PASS.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --write --resume-write --restart-replay`: PASS.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --resources`: NOT PASSED, raw control response has no usable list; no general resource-support failure is inferred.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --watch-revocation`: PASS; read before revocation, then same connected process denied protected discovery/read/write, zero protocol errors/stderr.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --read` after owner restoration: PASS.
- `node .artifacts/mcp-clients/check-installed-claude-renewal.mjs`: PASS, explicit refresh with installed runtimes, verified live connection, zero protocol stdout and no provider/model calls.
- `node .artifacts/mcp-clients/claude-companion-check.mjs --registered --read` in a fresh process after renewal: PASS, no new login, zero protocol errors/stderr.

Diagnostics/receipts are ignored local artifacts. No application code or schema
changed, so full application/database/typecheck/lint/build suites were not rerun
for this evidence-only increment. They remain required for final branch readiness.
No new installer, migration, production promotion or VPS provisioning occurred.
Production MCP enablement was not changed. Gemini remains ON HOLD.

## Remaining gates

Independent-client concurrency,
broader tool-family acceptance, normal resource workflow, supported Claude
desktop/remote paths and final production activation remain separate gates.
One adapter per profile remains deliberate; use separate app-generated profiles
for simultaneous clients. Future VPS host/credential/fencing/startup checks are
deferred, not represented as passed by this local restart.

Sources: [Claude Code MCP procedures](https://code.claude.com/docs/en/mcp),
[official publisher Agent SDK repository](https://github.com/anthropics/claude-agent-sdk-typescript).
