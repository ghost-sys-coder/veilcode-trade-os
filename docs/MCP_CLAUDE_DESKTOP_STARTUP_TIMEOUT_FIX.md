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

Published MCPB 0.1.2: 12,788 bytes, SHA-256
`bd492dfec75441ecb353aed9792669ea0b201b23df892642caff5b638730a474`.

Unchanged companion installer: 59,186,176 bytes, SHA-256
`532bb12fcaacbb4b981e70c2bc5ae176ccd940f77098c9fcb180ad367a32d1d0`.
Unchanged manifest pin:
`ea33b4fb34e21fab55b09ae1e1e18fb6859ac930016c69d8c93d2cfdb21fb34d`.

Published unsigned prerelease: `companion-preview-20261014-b304832`, source
`b30483289996d65049646f41b9bed9046acbf3f6`; release ID `412512915`. Both assets'
server sizes and SHA-256 values match the tested payloads. Complete new MCPB
downloads through the authenticated CLI and public HTTPS verify successfully.

Fresh companion downloads repeatedly interrupted, including bounded HTTPS range
recovery. The user explicitly approved reusing the previously fully downloaded,
hash-verified **identical** companion, together with the new asset's matching
server digest. Its full local hash was checked again before changing metadata.
This is an approved delivery-gate exception for an unchanged artifact, not a
passed fresh installer download. The complete extension verification, sealed
inventory checks and actual-client gates are not waived. Partial verification
downloads remain workspace artifacts; no owner installation was patched.

All six public release values are verified for Preview / `feature/mcp-access`;
four values changed and two installer size/hash values already matched. One
metadata request lost its acknowledgement; readback confirmed the old value
before the bounded retry, and the complete final readback passes. No enablement
flag, secret, production setting or grant changed. Configured deployment
`dpl_Eu16Kxk9uN8hJNx1dSSCWgQWd5bC` is pinned to source `b304832`; its verified
build logs pass 48 database functions and 14 version/order columns. CLI inspection
confirms READY / staging; logs confirm the exact source commit and successful
build. The connected alias assignment failed, with readback proving it had not
taken effect. The authenticated CLI fallback successfully assigned only
`mcp-preview.veilcode.studio` to this verified build. Production was not promoted,
merged, reconfigured or assigned by this delivery.

Post-delivery `node .artifacts/claude-desktop/hosted-readonly-check.mjs` passes all
eight checks: public privacy/calculator/discovery, anonymous setup redirect,
owned Desktop configuration/extension denial without authentication, and MCP
authentication challenges on staging and production. No flags were modified.

The owner's existing authenticated saved setup page was reloaded and visibly
shows `companion-preview-20261014-b304832`, 12.5 KiB, the exact extension hash,
the enabled extension download control and its unchanged active authorization.
The browser download helper timed out and reset; its subsequent browser binding
was unavailable. **A completed automated owner-browser file download is not
claimed.** Complete public/CLI extension bytes are verified independently;
the owner can now download through this saved app page and perform the actual
Desktop restart/read acceptance. No new installer, profile or consent is needed.

App delivery is configured and verified as above. The owner needs only the **new MCPB** from the
existing saved Desktop setup page. Reuse the current companion folder and JSON;
do not reinstall the unchanged companion or create a new profile. Update through
Desktop's extension UI, fully quit/reopen, and run a read-only account call in a
new chat. Repeat consent only if an explicit credential error requires it.

## Review

- Layer 1 — plan alignment: PASS for the scoped startup update and app-led
  distribution; no domain workflow or deferred-client expansion.
- Layer 2 — system integrity: PASS; strict sealed validation and the existing
  protected authenticated adapter remain authoritative.
- Layer 3 — readiness: app delivery PASS with the explicit unchanged-companion
  reuse exception; actual Desktop restart/read and completed owner-browser
  download acceptance remain PENDING (important). This is not full MCP completion.
