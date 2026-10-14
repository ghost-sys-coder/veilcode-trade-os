# Claude Desktop startup timeout — 2026-10-14

Branch: `feature/mcp-access`. Extension candidate: 0.1.2. This is a scoped
launcher update, not a new MCP implementation or production activation.

## Observed failure and limits of the diagnosis

After the owner fully quit Desktop, its application and Desktop-specific
launcher/Node/vault processes exited without forced termination. The next genuine
fresh start failed: initialization arrived at `07:32:12.835Z`, but the native
adapter was not created until `07:33:18.382Z`, roughly 65.5 seconds later. Desktop
reported a timeout and closed the transport without receiving a server response.
The delay precedes the authenticated native adapter; sleep, expired permissions
and a missing hosted endpoint are not established causes.

The extension previously checked the complete sealed installation serially
before forwarding initialization. A same-installation, read-only warm benchmark
measured 2,046 ms for the released serial verifier and 705 ms for the bounded
parallel candidate. This confirms an improvement, not a reproduction of the
65-second cold-start stall or proof of every source of that stall.

An earlier pause-only candidate was not a proven fix. The current candidate
additionally reduces verification latency, records safe startup stages and
bounds waiting for the first response. Actual Desktop restart acceptance remains
pending; SDK and stream-shim success must not be substituted for it.

## Source changes

- Verify all files and linked ancestors with at most four concurrent checks;
  drain each batch before propagating a failure. Keep the release pin, hashes,
  size bounds, extra-file rejection and selected/imported setup equality checks.
  No trust cache, skipped checks or integrity exceptions.
- Pause input before asynchronous validation and pipe it only after the verified
  native child is ready. Regression tests preserve the exact initialization and
  subsequent request bytes, including already-flowing input.
- Apply a 45-second startup deadline, checked during verification and enforced
  while waiting for the first child output. This is not a successful-access marker.
  Fixed stderr stages contain elapsed time and byte counts only, never payloads,
  credentials, paths or account/client identifiers.
- Close the extension's own utility host when its owned native child exits;
  a retained MessagePort must not keep a failed extension alive. Shutdown or
  timeout does not terminate Desktop or another client's adapter.
- Reuse the unchanged sealed companion, existing Desktop setup and protected
  authorization. No owner installation, grant, MT5 terminal/task or collector
  state was modified by these tests.

## Verification

| Exact command / check | Result |
| --- | --- |
| `npm test` | 70 files / 1,211 tests passed after final launcher change |
| `node .artifacts/claude-desktop/local-db-check.mjs` | 30 suites / 1,196 assertions passed; wraps the existing database runner with four pending migrations inside rollback transactions; local diagnostic setting restored |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed, Next.js 16.3.8 |
| `npm run build:claude-desktop` | Packaged Python and complete sealed inventory checks passed |
| Cached official `@anthropic-ai/mcpb@2.1.2`: `mcpb validate integrations/claude-desktop/manifest.json` | Passed |
| Same pinned CLI: `mcpb info <candidate artifact>` | Accepted, 12.49 KB, explicitly unsigned |
| `node .artifacts/claude-desktop/verify-fresh-desktop.mjs --candidate` | First output 9,953 ms; 84 tools, 8 resources; read-only account call returned the one preserved account; clean child exit |
| Same command with `--host-shim` | First output 7,900 ms; same discovery and account result; clean child exit |

Both preflights used the actual packaged candidate and the owner's existing
authorized Desktop profile. They did not invoke model APIs or application writes.
An initial direct probe and initial stream-shim probe exited with the sanitized
`UNAVAILABLE` diagnostic before output; subsequent bounded read-only retries
passed. Public application/discovery reads returned HTTP 200. These transient
failures remain recorded; their exact network leg is not established.

Desktop version: 2.37337.1.0. Packaged Node: 24.21.0; Python: 3.13.16. The shim
reproduces the inspected utility-host stream boundary but is not the actual
Claude UI. Prior real Desktop discovery/read/controlled create-and-archive
evidence remains valid. Fresh restart, renewal, resource reads and live
revocation/reconnect still require their own actual-client evidence.

## Artifacts and delivery gate

Candidate MCPB: 12,788 bytes, SHA-256
`bd492dfec75441ecb353aed9792669ea0b201b23df892642caff5b638730a474`.

Unchanged companion installer: 59,186,176 bytes, SHA-256
`532bb12fcaacbb4b981e70c2bc5ae176ccd940f77098c9fcb180ad367a32d1d0`.
Unchanged manifest pin:
`ea33b4fb34e21fab55b09ae1e1e18fb6859ac930016c69d8c93d2cfdb21fb34d`.

Release is pending. Publish a new immutable unsigned prerelease with this MCPB
and the unchanged installer; verify complete downloaded bytes before updating
the six public branch-only Preview release metadata values. Production flags,
secrets and domains are outside this delivery. No local installation patch.

Once app delivery is verified, the owner needs only the **new MCPB** from the
existing saved Desktop setup page. Reuse the current companion folder and JSON;
do not reinstall the unchanged companion or create a new profile. Update through
Desktop's extension UI, fully quit/reopen, and run a read-only account call in a
new chat. Repeat consent only if an explicit credential error requires it.

## Review

- Layer 1 — plan alignment: PASS for the scoped startup update and app-led
  distribution; no domain workflow or deferred-client expansion.
- Layer 2 — system integrity: PASS; strict sealed validation and the existing
  protected authenticated adapter remain authoritative.
- Layer 3 — readiness: PENDING (important): actual Desktop restart acceptance
  and verified app delivery. This candidate is not a full MCP completion claim.
